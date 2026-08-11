// The Ask console.
//
// The terminal version of this system works because a model reads the playbook,
// decides which systems can answer, calls their APIs and merges the result. This
// route is that same loop, server-side, on the Gemini API: the model gets
// MEMORY.md and the master skill as its system instruction, and two tools — read
// another skill, or GET a reporting endpoint. Keys stay here; the model only
// ever names a system.
//
// Output streams back as it's produced, so Josh sees the report building rather
// than a spinner.

import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson } from '../lib/http.js';
import { guard } from '../lib/auth.js';
import { AIRTABLE, SYSTEMS, byId, resolve } from '../lib/systems.js';
import { callSystem, validPath } from '../lib/upstream.js';

// Overridable so the loop can be pointed at a gateway, proxy, or a test double.
const BASE = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const endpoint = () => `${BASE}/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`;

const MAX_TURNS = 12;      // tool round-trips before we stop and report what we have
const MAX_TOOL_CALLS = 40; // hard ceiling across the whole run
const MAX_RESULT_CHARS = 24000;

// ---------------------------------------------------------------- playbook ---

const roots = [process.cwd(), path.join(process.cwd(), '..'), '/var/task'];
const cache = new Map();

async function readRepoFile(rel) {
  if (cache.has(rel)) return cache.get(rel);
  for (const root of roots) {
    try {
      const text = await fs.readFile(path.join(root, rel), 'utf8');
      cache.set(rel, text);
      return text;
    } catch {
      /* try the next root */
    }
  }
  cache.set(rel, null);
  return null;
}

const skillPath = (skill) => path.join('.claude', 'skills', skill, 'SKILL.md');

async function systemPrompt() {
  const memory = await readRepoFile('MEMORY.md');
  const master = await readRepoFile(skillPath('master'));

  const roster = SYSTEMS.map((s) => {
    const { configured, missing } = resolve(s);
    const state = configured ? 'configured' : `NOT CONFIGURED (missing ${missing.join(', ')})`;
    return `- \`${s.id}\` — ${s.name}. ${s.blurb} [${state}]`;
  }).join('\n');

  const airtableState =
    process.env[AIRTABLE.keyVar] && process.env[AIRTABLE.urlVar] ? 'configured' : 'NOT CONFIGURED';

  return [
    'You are the reporting playbook for The Coordinators, answering a question from Josh Klenoff, the CEO.',
    '',
    'You are running as a web service, not in a terminal. You cannot run scripts, spawn subagents, or read',
    "the filesystem. You have exactly two tools: `read_playbook` to read a system's skill file, and",
    '`query_system` to GET one of its reporting endpoints. Everything the playbook says about subagents,',
    'parallel skill invocation or shell scripts translates to: call `query_system` yourself, several times,',
    'for whichever systems the question needs.',
    '',
    '## Systems you can query',
    '',
    roster,
    `- \`airtable\` — ${AIRTABLE.blurb} [${airtableState}] (use \`query_system\` with system "airtable"; path is a table name)`,
    '',
    'A system marked NOT CONFIGURED will return an error. Report it as `- data unavailable` and move on.',
    '',
    '## How to work',
    '',
    '1. Decide which systems the question needs, using the catalog in the playbook below.',
    '2. Call `read_playbook` for each system you are going to query — it documents that system\'s',
    '   endpoints, its date-window params, and how to read its fields correctly. Do not guess an',
    '   endpoint or a field name.',
    '3. Call `query_system` for the data you need. Prefer one summary call per system; drill down only',
    '   when the question actually requires it. Independent systems can be called in the same turn.',
    '4. Write the report in the format the playbook specifies.',
    '',
    'Be efficient — you are answering live and Josh is waiting. Do not call endpoints you will not quote.',
    '',
    '## Privacy',
    '',
    'Never request individual candidate contact details. Flags that would lift PII redaction are stripped',
    'server-side, so asking for them only wastes a call.',
    '',
    '## Formatting',
    '',
    'Reply in Markdown. Do not narrate your tool calls — the interface already shows them. Do not describe',
    'what you are about to do. Open with the report itself.',
    '',
    '---',
    '',
    '# MEMORY.md — read this before you route and again before you synthesise',
    '',
    memory || '(MEMORY.md could not be read on this deployment. Say so if a caveat would have mattered.)',
    '',
    '---',
    '',
    '# The master playbook',
    '',
    master || '(The master skill could not be read on this deployment. Fall back on the roster above.)',
  ].join('\n');
}

// ------------------------------------------------------------------- tools ---

const SYSTEM_IDS = SYSTEMS.map((s) => s.id);

// Gemini's Schema is the OpenAPI subset: uppercase type names, and no
// `additionalProperties`. So the free-form query parameters travel as a JSON
// string and are parsed here — one well-defined failure mode instead of a
// schema-dialect mismatch.
const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'read_playbook',
        description:
          "Read one system's reporting skill: its endpoints, date-window parameters, response fields, and " +
          'the rules for reading its data correctly. Call this before querying a system you have not read yet.',
        parameters: {
          type: 'OBJECT',
          properties: {
            system: {
              type: 'STRING',
              description: 'Which system\'s playbook to read.',
              enum: [...SYSTEM_IDS, 'cpa', 'master'],
            },
          },
          required: ['system'],
        },
      },
      {
        name: 'query_system',
        description:
          'GET one reporting endpoint on one system and return its JSON. Read-only.',
        parameters: {
          type: 'OBJECT',
          properties: {
            system: {
              type: 'STRING',
              description: 'Which system to query.',
              enum: [...SYSTEM_IDS, 'airtable'],
            },
            path: {
              type: 'STRING',
              description:
                'The part of the URL after /api/v1/reporting/ — for example "summary", "stats", "channels", ' +
                '"calibration", "candidates/123". For system "airtable" this is a table name such as "Roles" or "Leads". ' +
                'Never include a query string here.',
            },
            params: {
              type: 'STRING',
              description:
                'Query parameters as a JSON object string, e.g. {"preset":"last_7d"} or {"days":"7"} or ' +
                '{"window":"30d"}. Use {} when the endpoint needs none. Each system names its window ' +
                'parameter differently — read its playbook first.',
            },
          },
          required: ['system', 'path'],
        },
      },
    ],
  },
];

async function queryAirtable(table, params = {}) {
  const key = process.env[AIRTABLE.keyVar];
  const base = process.env[AIRTABLE.urlVar];
  if (!key || !base) return { ok: false, error: 'Airtable is not configured.' };
  if (!/^[A-Za-z0-9 _-]{1,60}$/.test(table)) return { ok: false, error: `Refused table name: ${table}` };

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  if (!qs.has('pageSize')) qs.set('pageSize', '100');

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20000);
  try {
    const res = await fetch(`https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}?${qs}`, {
      headers: { authorization: `Bearer ${key}` },
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    return { ok: true, body: text };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

/** The model may hand `params` back as a JSON string or, if it ignores the declared type, an object. */
function readParams(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function runTool(name, args = {}) {
  if (name === 'read_playbook') {
    const id = args.system;
    // This label must match `describe()` below — the UI pairs the start and
    // done events by it.
    const display = `${id} playbook`;
    const skill = id === 'cpa' || id === 'master' ? id : byId(id)?.skill;
    if (!skill) return { display, text: `No such system: ${id}`, failed: true };
    const text = await readRepoFile(skillPath(skill));
    return {
      display,
      text: text || `The skill file for ${id} is not readable on this deployment.`,
      failed: !text,
    };
  }

  if (name === 'query_system') {
    const id = args.system;
    const endpointPath = args.path;
    const params = readParams(args.params);
    const display = `${id} · ${endpointPath}`;

    if (id === 'airtable') {
      const out = await queryAirtable(endpointPath, params);
      return {
        display,
        text: out.ok ? out.body.slice(0, MAX_RESULT_CHARS) : `Error: ${out.error}`,
        failed: !out.ok,
      };
    }

    const system = byId(id);
    if (!system) return { display, text: `No such system: ${id}`, failed: true };
    if (!validPath(endpointPath)) return { display, text: `Refused path: ${endpointPath}`, failed: true };

    const out = await callSystem(system, endpointPath, params);
    if (!out.ok) return { display, text: `Error (${out.reason}): ${out.error}`, failed: true };

    const body = JSON.stringify({ data: out.data, meta: out.meta });
    return {
      display,
      text:
        body.length > MAX_RESULT_CHARS
          ? `${body.slice(0, MAX_RESULT_CHARS)}\n…[truncated: narrow the window or request fewer rows]`
          : body,
      ms: out.ms,
    };
  }

  return { display: name, text: `Unknown tool: ${name}`, failed: true };
}

// ------------------------------------------------------------- model stream ---

/**
 * One streamed turn against `:streamGenerateContent?alt=sse`.
 *
 * Text arrives incrementally and is pushed through `onText`; function calls
 * arrive whole. Returns the model turn's parts, ready to append to `contents`.
 */
async function streamTurn(contents, systemInstruction, onText) {
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      tools: TOOLS,
      generationConfig: { temperature: 0, maxOutputTokens: 8192 },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    let message = detail.slice(0, 400);
    try {
      message = JSON.parse(detail)?.error?.message || message;
    } catch {
      /* keep the raw body */
    }
    throw new Error(`Gemini API ${res.status}: ${message}`);
  }

  let text = '';
  const calls = [];
  let finishReason = null;
  let blockReason = null;
  let buffer = '';

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);

      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;

      let chunk;
      try {
        chunk = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }

      if (chunk.error) throw new Error(chunk.error.message || 'stream error');
      blockReason = chunk.promptFeedback?.blockReason ?? blockReason;

      const candidate = chunk.candidates?.[0];
      if (!candidate) continue;
      finishReason = candidate.finishReason ?? finishReason;

      for (const part of candidate.content?.parts || []) {
        if (typeof part.text === 'string' && part.text) {
          text += part.text;
          onText(part.text);
        }
        if (part.functionCall) calls.push(part.functionCall);
      }
    }
  }

  if (blockReason) throw new Error(`Gemini blocked the request: ${blockReason}`);

  // Rebuild the model turn so the next request carries its own context.
  const parts = [];
  if (text) parts.push({ text });
  for (const call of calls) parts.push({ functionCall: call });

  return { parts, calls, finishReason };
}

// ------------------------------------------------------------------- route ---

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'method_not_allowed' }));
  }

  if (!process.env.GEMINI_API_KEY) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(
      JSON.stringify({
        error: 'no_model_key',
        message: 'GEMINI_API_KEY is not set on this deployment, so the Ask console is switched off.',
      })
    );
  }

  const { question, window } = await readJson(req);
  const asked = String(question || '').trim();
  if (!asked) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'empty_question' }));
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;
  req.on('close', () => {
    closed = true;
  });
  const send = (event) => {
    if (closed || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const instruction = await systemPrompt();
    const prompt = window ? `${asked}\n\n(Window: ${window}.)` : asked;
    const contents = [{ role: 'user', parts: [{ text: prompt }] }];

    let toolCalls = 0;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (closed) return;

      const { parts, calls } = await streamTurn(contents, instruction, (text) => send({ type: 'text', text }));

      // An empty turn has nothing to append and nothing to act on.
      if (!parts.length) break;
      contents.push({ role: 'model', parts });
      if (!calls.length) break;

      if (toolCalls + calls.length > MAX_TOOL_CALLS) {
        send({ type: 'notice', text: 'Tool-call ceiling reached — reporting on what came back.' });
        contents.push({
          role: 'user',
          parts: calls.map((call) => ({
            functionResponse: {
              name: call.name,
              ...(call.id ? { id: call.id } : {}),
              response: { result: 'Budget exhausted. Write the report from what you already have.' },
            },
          })),
        });
        continue;
      }

      // The systems are independent, so query them together rather than in turn.
      const responses = await Promise.all(
        calls.map(async (call) => {
          send({ type: 'tool', name: call.name, target: describe(call) });
          const out = await runTool(call.name, call.args || {});
          send({ type: 'tool_done', target: out.display, ms: out.ms ?? null, failed: Boolean(out.failed) });
          return {
            functionResponse: {
              name: call.name,
              ...(call.id ? { id: call.id } : {}),
              // `response` must be an object, so the payload rides in a field.
              response: { result: out.text },
            },
          };
        })
      );
      toolCalls += calls.length;
      contents.push({ role: 'user', parts: responses });
    }

    send({ type: 'done' });
  } catch (err) {
    send({ type: 'error', message: String(err?.message || err) });
  } finally {
    if (!res.writableEnded) res.end();
  }
}

const describe = (call) =>
  call.name === 'read_playbook'
    ? `${call.args?.system} playbook`
    : `${call.args?.system} · ${call.args?.path}`;
