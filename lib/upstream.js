// Talking to the eight reporting APIs.
//
// Everything that reaches an upstream goes through `callSystem`, which is the
// one place that holds a key, the one place that can time out, and the one place
// that enforces the privacy rule — server-side, so it is a property of the
// system rather than an instruction a model is trusted to follow.

import { resolve } from './systems.js';

const TIMEOUT_MS = 15000;

/**
 * Flags that would lift candidate-PII redaction on one upstream or another.
 * This app is a reporting surface: counts, rates and trends. It has no reason to
 * name a person, so these are stripped rather than merely never sent.
 */
const PII_FLAGS = /^(include_pii|include_contact|include_personal|pii|contact|unredacted)$/i;

/**
 * Endpoints that return one row per person.
 *
 * Stripping the redaction-lifting flags is not enough on its own: these
 * endpoints return candidate **names** by default, flags or no flags. This is a
 * reporting surface — it answers "how many are waiting", not "who". Every
 * awaiting-review count this app quotes comes from an aggregate endpoint, so
 * blocking these costs no reporting ability.
 *
 * A system that redacts people server-side before the data leaves it (HELM Ops)
 * is exempt, declared per-system rather than special-cased here.
 */
const PERSON_LEVEL = /^(candidates|submissions|responses|attempts|people)(\/|$)/i;

/** Read a dotted path out of an object. `a.b.length` works on arrays. */
export function pick(obj, path) {
  let cur = obj;
  for (const part of String(path).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** First path that resolves to something real. Absence stays absent — never 0. */
export function pickFirst(obj, paths = []) {
  for (const p of paths) {
    const v = pick(obj, p);
    if (v !== undefined && v !== null && !Number.isNaN(v)) return v;
  }
  return undefined;
}

function authHeaders(system, key) {
  if (!key) return {};
  return system.auth === 'bearer'
    ? { authorization: `Bearer ${key}` }
    : { 'x-api-key': key };
}

function cleanParams(params = {}) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (k.startsWith('__')) continue; // ours, not the upstream's — never forwarded
    if (PII_FLAGS.test(k)) continue; // dropped on purpose — see above
    out[k] = String(v);
  }
  return out;
}

/** Reporting paths are a closed shape: lowercase segments, no traversal. */
export function validPath(path) {
  return typeof path === 'string' && /^[a-z0-9][a-z0-9/_-]*$/.test(path) && !path.includes('..');
}

/**
 * GET one reporting endpoint.
 *
 * Never throws. A dead upstream is a reportable fact, not an exception — the
 * whole system is built so one gap can't take down the page.
 */
export async function callSystem(system, path, params = {}, env = process.env) {
  const started = Date.now();
  const { url, key, missing, configured } = resolve(system, env);

  if (!validPath(path)) {
    return { ok: false, reason: 'bad_path', ms: 0, error: `Refused path: ${path}` };
  }
  if (PERSON_LEVEL.test(path) && !system.redactsPeopleServerSide) {
    return {
      ok: false,
      reason: 'person_level_blocked',
      ms: 0,
      error:
        `Refused: /${path} returns one row per candidate, and this is a reporting surface — ` +
        `it reports counts, rates and queues, never who is in them. Use the aggregate endpoint ` +
        `(summary/stats) for the count, and tell the reader to open the app itself to action ` +
        `individual candidates. Do not name candidates in your answer.`,
    };
  }
  // `noKey` probes (documented liveness endpoints) only need the URL.
  if (!url || (!configured && !params.__noKey)) {
    return {
      ok: false,
      reason: 'unconfigured',
      ms: 0,
      missing,
      error: `Not configured: ${missing.join(', ')}`,
    };
  }

  const qs = new URLSearchParams(cleanParams(params)).toString();
  const target = `${url}/api/v1/reporting/${path}${qs ? `?${qs}` : ''}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      method: 'GET',
      headers: { accept: 'application/json', ...authHeaders(system, key) },
      signal: ac.signal,
    });
    const ms = Date.now() - started;
    const text = await res.text();

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'bad_json', status: res.status, ms, error: text.slice(0, 200) };
    }

    // Shared envelope: { data, meta, errors }. A populated `errors` is a failure
    // even on a 200.
    const errors = body?.errors;
    const hasErrors = Array.isArray(errors) ? errors.length > 0 : Boolean(errors);

    if (!res.ok || hasErrors) {
      const detail = Array.isArray(errors) ? errors[0]?.message || errors[0]?.code : errors?.message;
      return {
        ok: false,
        reason: res.status === 401 || res.status === 403 ? 'unauthorized' : 'upstream_error',
        status: res.status,
        ms,
        error: detail || `HTTP ${res.status}`,
      };
    }

    return {
      ok: true,
      status: res.status,
      ms,
      data: body?.data !== undefined ? body.data : body,
      meta: body?.meta ?? null,
    };
  } catch (err) {
    const ms = Date.now() - started;
    const aborted = err?.name === 'AbortError';
    return {
      ok: false,
      reason: aborted ? 'timeout' : 'unreachable',
      ms,
      error: aborted ? `No response in ${TIMEOUT_MS / 1000}s` : String(err?.message || err),
    };
  }
}

/** Turn a system's declared tile specs into rendered-ready values. */
export function extractTiles(system, data) {
  const tiles = [];
  for (const spec of system.tiles || []) {
    let value = pickFirst(data, spec.paths);
    // `format: 'count'` means "this path may hand back a list; show its length".
    if (spec.format === 'count' && Array.isArray(value)) value = value.length;
    if (value === undefined) continue;
    if (typeof value === 'object') continue; // never render a blob as a number

    const delta = spec.delta ? pickFirst(data, spec.delta) : undefined;
    tiles.push({
      label: spec.label,
      value,
      format: spec.format === 'count' ? 'int' : spec.format,
      delta: typeof delta === 'number' ? delta : undefined,
      deltaKind: spec.deltaKind || 'pct',
      good: spec.good ?? null,
      attention: Boolean(spec.attention),
      note: spec.note || null,
    });
  }
  return tiles;
}

/**
 * Fallback tiles for a system whose response field names weren't documented.
 *
 * These are labelled with the API's own key names, humanised but not renamed, so
 * what's on screen is traceable to what came back. That's the difference between
 * showing data and inventing a metric.
 */
export function autoTiles(data, sections = [], limit = 4) {
  const out = [];
  for (const section of sections) {
    const node = pick(data, section);
    if (!node || typeof node !== 'object') continue;
    for (const [key, value] of Object.entries(node)) {
      if (out.length >= limit) return out;
      if (typeof value !== 'number') continue;
      const looksPct = /(_pct|rate|percent)$/i.test(key);
      out.push({
        label: humanise(key),
        value,
        format: looksPct ? 'pct' : 'int',
        good: null,
        attention: false,
        note: `${section}.${key}`,
        derived: true,
      });
    }
  }
  return out;
}

const humanise = (key) =>
  key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\bpct\b/i, '%')
    .replace(/^./, (c) => c.toUpperCase());

/** Map a failure reason onto the three states the UI actually draws. */
export function statusOf(result) {
  if (result.ok) return 'ready';
  if (result.reason === 'unconfigured') return 'unconfigured';
  return 'down';
}
