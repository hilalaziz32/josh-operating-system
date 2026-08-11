// The systems board: is each reporting API actually answering right now?
//
// This is a live probe, not an env-var check. `preflight.sh` can only tell you a
// key is present; this tells you the key works, the host is up, and how slow it
// is. A system can pass preflight and still be dead.

import { json } from '../lib/http.js';
import { guard } from '../lib/auth.js';
import { AIRTABLE, SYSTEMS, resolve } from '../lib/systems.js';
import { callSystem, statusOf } from '../lib/upstream.js';

async function probeAirtable(env = process.env) {
  const key = env[AIRTABLE.keyVar];
  const base = env[AIRTABLE.urlVar];
  const missing = [];
  if (!base) missing.push(AIRTABLE.urlVar);
  if (!key) missing.push(AIRTABLE.keyVar);
  if (missing.length) {
    return { status: 'unconfigured', missing, error: `Not configured: ${missing.join(', ')}` };
  }

  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(`https://api.airtable.com/v0/meta/bases/${base}/tables`, {
      headers: { authorization: `Bearer ${key}` },
      signal: ac.signal,
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      return { status: 'down', ms, httpStatus: res.status, error: `HTTP ${res.status}` };
    }
    return { status: 'ready', ms, httpStatus: res.status };
  } catch (err) {
    return {
      status: 'down',
      ms: Date.now() - started,
      error: err?.name === 'AbortError' ? 'No response in 15s' : String(err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  const results = await Promise.all(
    SYSTEMS.map(async (system) => {
      const { missing, configured } = resolve(system);
      const base = {
        id: system.id,
        name: system.name,
        blurb: system.blurb,
        urlVar: system.urlVar,
        keyVar: system.keyVar,
        missing,
      };

      // A documented keyless liveness endpoint still tells us the host is alive
      // even when the key is missing, which is a more useful distinction than
      // collapsing both into "unconfigured".
      if (!configured && !system.probe?.noKey) {
        return { ...base, status: 'unconfigured', error: `Not configured: ${missing.join(', ')}` };
      }

      const out = await callSystem(system, system.probe.path, {
        ...system.probe.params,
        ...(system.probe.noKey ? { __noKey: true } : {}),
      });

      return {
        ...base,
        status: configured ? statusOf(out) : 'unconfigured',
        ms: out.ms,
        httpStatus: out.status,
        error: out.ok ? null : out.error,
        reason: out.ok ? null : out.reason,
      };
    })
  );

  const airtable = await probeAirtable();
  results.push({
    id: AIRTABLE.id,
    name: AIRTABLE.name,
    blurb: AIRTABLE.blurb,
    urlVar: AIRTABLE.urlVar,
    keyVar: AIRTABLE.keyVar,
    askOnly: true,
    missing: airtable.missing || [],
    ...airtable,
  });

  const ready = results.filter((r) => r.status === 'ready').length;
  return json(res, 200, { systems: results, ready, total: results.length, checkedAt: new Date().toISOString() });
}
