// The Coordinators — Control Room (client)
//
// No framework, no build step. Three views over four endpoints.

import { esc, renderMarkdown } from '/markdown.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  window: '7d',
  askWindow: '7d',
  windows: [
    { id: '7d', label: 'Last 7 days' },
    { id: '30d', label: 'Last 30 days' },
    { id: '90d', label: 'Last 90 days' },
    { id: 'mtd', label: 'This month' },
  ],
  askAvailable: false,
  reportText: '',
  running: false,
};

const PRESETS = [
  "Give me this week's report",
  'What needs my attention?',
  "How's Meta looking?",
  "How's screening looking?",
  "What's my CPA?",
  'Which roles are stalling?',
];

/* --------------------------------------------------------------- format -- */

const compact = (n) => {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e5) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
};

const format = (value, kind) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  if (kind === 'money') {
    return Math.abs(value) < 100 && value !== 0
      ? `$${value.toFixed(2)}`
      : `$${compact(value)}`;
  }
  if (kind === 'pct') {
    const rounded = Math.round(value * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
  }
  return compact(value);
};

/** Delta gets an arrow as well as a colour, so direction never rests on hue. */
function deltaMarkup(delta, kind, good) {
  if (typeof delta !== 'number' || Number.isNaN(delta)) return '';
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '■';
  const magnitude =
    kind === 'points'
      ? `${Math.abs(delta).toFixed(1)} pts`
      : `${Math.abs(Math.round(delta))}%`;
  let cls = '';
  if (good && delta !== 0) cls = (delta > 0) === (good === 'up') ? 'is-good' : 'is-bad';
  return `<div class="tile-delta ${cls}">${arrow} ${magnitude} vs previous period</div>`;
}

/* ------------------------------------------------------------- requests -- */

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    showGate();
    throw new Error('signed out');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
  return body;
}

/* ------------------------------------------------------------------ gate -- */

function showGate() {
  $('#gate').hidden = false;
  $('#app').hidden = true;
  $('#gate-password')?.focus();
}

function showApp() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
}

$('#gate-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('#gate-error');
  error.hidden = true;
  try {
    const out = await api('/api/session', {
      method: 'POST',
      body: JSON.stringify({ password: $('#gate-password').value }),
    });
    state.askAvailable = Boolean(out.askAvailable);
    $('#gate-password').value = '';
    showApp();
    boot();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});

$('#sign-out').addEventListener('click', async () => {
  await fetch('/api/session', { method: 'DELETE' });
  location.reload();
});

/* ------------------------------------------------------------------ nav -- */

const VIEWS = ['dashboard', 'ask', 'systems'];

/** Views are hash-routed, so a tab survives a refresh and can be bookmarked. */
function showView(view, { reload = false } = {}) {
  const target = VIEWS.includes(view) ? view : 'dashboard';
  $$('.rail-link').forEach((l) => l.classList.toggle('is-active', l.dataset.view === target));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === target));
  if (target === 'systems' && reload) loadSystems();
}

$$('.rail-link').forEach((link) => {
  link.addEventListener('click', () => {
    location.hash = link.dataset.view;
  });
});

window.addEventListener('hashchange', () =>
  showView(location.hash.slice(1), { reload: true })
);

function buildWindowPicker(node, current, onPick) {
  node.innerHTML = state.windows
    .map(
      (w) =>
        `<button type="button" data-win="${w.id}" class="${w.id === current ? 'is-active' : ''}">${w.label}</button>`
    )
    .join('');
  $$('button', node).forEach((btn) =>
    btn.addEventListener('click', () => {
      $$('button', node).forEach((b) => b.classList.toggle('is-active', b === btn));
      onPick(btn.dataset.win);
    })
  );
}

/* ------------------------------------------------------------- dashboard -- */

const STAGE_COUNT = 8;

function renderFunnel(funnel) {
  return `<div class="funnel">${funnel
    .map((stage, i) => {
      const step = Math.min(i + 1, STAGE_COUNT);
      const value = stage.available
        ? `<div class="stage-value">${format(stage.value, stage.format)}</div>`
        : `<div class="stage-value is-blank" title="This system did not answer">—</div>`;
      return `<div class="stage" style="--stage: var(--stage-${step})">
        <div class="stage-label">${esc(stage.label)}</div>
        ${value}
        <div class="stage-source">${esc(stage.available ? stage.source : 'unavailable')}</div>
      </div>`;
    })
    .join('')}</div>
  <p class="funnel-caption">Each stage is reported by a different system and counts a different population — this is the shape of the funnel, not one cohort followed through it.</p>`;
}

function renderCaveats(caveats) {
  if (!caveats?.length) return '';
  return caveats
    .map(
      (caveat) => `<div class="caveat caveat-${caveat.severity}">
        <span class="dot dot-${caveat.severity === 'warning' ? 'unconfigured' : 'muted'}"></span>
        <div>
          <strong>${esc(caveat.title)}</strong>
          <span>${esc(caveat.text)}</span>
        </div>
      </div>`
    )
    .join('');
}

function renderAttention(items) {
  if (!items.length) return '';
  return `<div class="attention">
    <h2>Needs attention</h2>
    <ul>${items
      .map(
        (item) => `<li>
          <span class="num">${format(item.value, item.format)}</span>
          <span>${esc(item.label.toLowerCase())}</span>
          <span class="who">· ${esc(item.system)}</span>
        </li>`
      )
      .join('')}</ul>
  </div>`;
}

/* A system that answers with an error is not the same as one that never answers.
   The label carries that distinction; the dot never carries meaning alone. */
const STATUS_LABELS = {
  ready: 'answering',
  unconfigured: 'not configured',
  unauthorized: 'key rejected',
  timeout: 'timed out',
  unreachable: 'unreachable',
  upstream_error: 'erroring',
  bad_json: 'bad response',
};

function statusChip(status, ms, reason) {
  const label = STATUS_LABELS[status === 'down' ? reason : status] || STATUS_LABELS[status] || 'not responding';
  return `<span class="status"><span class="dot dot-${status}"></span>${label}${
    typeof ms === 'number' ? `<span class="ms">${ms}ms</span>` : ''
  }</span>`;
}

function renderSection(section) {
  const tiles = section.tiles.length
    ? `<div class="tiles">${section.tiles
        .map(
          (tile) => `<div class="tile ${tile.attention && tile.value > 0 ? 'is-attention' : ''} ${
            tile.derived ? 'is-derived' : ''
          }">
            <div class="tile-label">${esc(tile.label)}</div>
            <div class="tile-value">${format(tile.value, tile.format)}</div>
            ${deltaMarkup(tile.delta, tile.deltaKind, tile.good)}
            ${tile.note ? `<div class="tile-note">${esc(tile.note)}</div>` : ''}
          </div>`
        )
        .join('')}</div>`
    : `<div class="card-empty">${
        section.status === 'ready'
          ? 'Answered, but none of the fields this dashboard reads were present.'
          : esc(section.error || 'data unavailable')
      }</div>`;

  return `<section class="card">
    <div class="card-head">
      <div>
        <h2 class="card-title">${esc(section.name)}</h2>
        <p class="card-blurb">${esc(section.blurb)}</p>
      </div>
      ${statusChip(section.status, section.ms, section.reason)}
    </div>
    ${tiles}
  </section>`;
}

async function loadDashboard() {
  const body = $('#dash-body');
  body.innerHTML = '<div class="loading">Asking every system…</div>';
  try {
    const data = await api(`/api/dashboard?window=${encodeURIComponent(state.window)}`);
    const label = state.windows.find((w) => w.id === data.window)?.label ?? data.window;
    $('#dash-sub').textContent = `Money in at the top, people out at the bottom · ${label.toLowerCase()}`;

    body.innerHTML =
      renderFunnel(data.funnel) +
      renderCaveats(data.caveats) +
      renderAttention(data.attention) +
      data.sections.map(renderSection).join('') +
      (data.unavailable.length
        ? `<p class="loading">Not available this run: ${data.unavailable.map(esc).join(', ')}.</p>`
        : '');
  } catch (err) {
    if (err.message === 'signed out') return;
    body.innerHTML = `<div class="callout callout-error"><strong>Couldn't load the dashboard.</strong><span>${esc(
      err.message
    )}</span></div>`;
  }
}

/* --------------------------------------------------------------- systems -- */

async function loadSystems() {
  const body = $('#systems-body');
  body.innerHTML = '<div class="loading">Probing…</div>';
  try {
    const data = await api('/api/systems');
    updateRailHealth(data);

    body.innerHTML = `<div class="table-wrap"><table class="systems">
      <thead><tr>
        <th>System</th><th>Status</th><th>Latency</th><th>What to do</th>
      </tr></thead>
      <tbody>${data.systems
        .map(
          (sys) => `<tr>
            <td>
              <div class="sys-name">${esc(sys.name)}${sys.askOnly ? ' <span class="who">· ask only</span>' : ''}</div>
              <div class="sys-blurb">${esc(sys.blurb)}</div>
            </td>
            <td>${statusChip(sys.status, undefined, sys.reason)}</td>
            <td class="num">${typeof sys.ms === 'number' ? `${sys.ms} ms` : '—'}</td>
            <td class="fix">${fixHint(sys)}</td>
          </tr>`
        )
        .join('')}</tbody>
    </table></div>
    <p class="loading">${data.ready} of ${data.total} answering · checked ${new Date(
      data.checkedAt
    ).toLocaleTimeString()}</p>`;
  } catch (err) {
    if (err.message === 'signed out') return;
    body.innerHTML = `<div class="callout callout-error"><strong>Couldn't probe the systems.</strong><span>${esc(
      err.message
    )}</span></div>`;
  }
}

function fixHint(sys) {
  if (sys.status === 'ready') return "Nothing — it's answering.";
  if (sys.status === 'unconfigured') {
    return `Set ${(sys.missing || []).map((v) => `<code>${esc(v)}</code>`).join(' and ')} in this app's environment.`;
  }
  if (sys.reason === 'unauthorized') {
    return `The key here was rejected. Two ends have to match — check <code>REPORTING_API_KEY</code> in that app's own Vercel project.`;
  }
  if (sys.reason === 'timeout' || sys.reason === 'unreachable') {
    return `No response from the host. Check it's still deployed.${
      sys.error ? ` <span class="who">(${esc(sys.error)})</span>` : ''
    }`;
  }
  // It answered — so its own message is the most useful thing we can show.
  return sys.error
    ? `The host answered with an error: <span class="who">${esc(sys.error)}</span>`
    : 'The host answered, but not with something this app could read.';
}

function updateRailHealth(data) {
  const down = data.total - data.ready;
  const dot = down === 0 ? 'ready' : down >= data.total / 2 ? 'down' : 'unconfigured';
  $('#rail-health').innerHTML = `<span class="dot dot-${dot}"></span><span>${data.ready}/${data.total} answering</span>`;
}

/* ------------------------------------------------------------------- ask -- */

function setRunning(running) {
  state.running = running;
  $('#ask-submit').disabled = running;
  $('#ask-submit').textContent = running ? 'Running…' : 'Run';
}

function pushActivity(text, cls = '') {
  const log = $('#ask-activity');
  log.hidden = false;
  const row = document.createElement('div');
  row.className = 'activity-row';
  row.innerHTML = `<span class="dot dot-${cls || 'muted'}"></span><span class="what">${esc(text)}</span>`;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
  return row;
}

let paintQueued = false;
function paintReport(finished = false) {
  if (paintQueued && !finished) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    const node = $('#ask-report');
    node.hidden = false;
    node.innerHTML = renderMarkdown(state.reportText) + (finished ? '' : '<span class="cursor"></span>');
  });
}

async function runAsk(question) {
  if (state.running || !question.trim()) return;

  state.reportText = '';
  $('#ask-activity').innerHTML = '';
  $('#ask-activity').hidden = true;
  $('#ask-report').hidden = true;
  $('#ask-footer').hidden = true;
  setRunning(true);

  const started = Date.now();
  const windowLabel = state.windows.find((w) => w.id === state.askWindow)?.label;

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, window: windowLabel }),
    });

    if (res.status === 401) return showGate();
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const pending = new Map();
    let buffer = '';
    let truncated = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let split;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const line = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;

        let event;
        try {
          event = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }

        if (event.type === 'text') {
          state.reportText += event.text;
          paintReport();
        } else if (event.type === 'tool') {
          pending.set(event.target, pushActivity(event.target));
        } else if (event.type === 'tool_done') {
          const row = pending.get(event.target);
          if (row) {
            row.querySelector('.dot').className = `dot dot-${event.failed ? 'down' : 'ready'}`;
            if (event.ms) row.insertAdjacentHTML('beforeend', `<span class="ms">${event.ms}ms</span>`);
            pending.delete(event.target);
          }
        } else if (event.type === 'notice') {
          pushActivity(event.text, 'unconfigured');
        } else if (event.type === 'done') {
          truncated = event.finishReason && event.finishReason !== 'STOP' ? event.finishReason : null;
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      }
    }

    paintReport(true);
    if (truncated) {
      $('#ask-report').insertAdjacentHTML(
        'beforeend',
        `<div class="callout callout-warn"><strong>This report stopped early.</strong><span>The model finished with <code>${esc(
          truncated
        )}</code>, so what's above may be incomplete. Try a narrower question or a single system.</span></div>`
      );
    }
    if (state.reportText.trim()) {
      $('#ask-footer').hidden = false;
      $('#ask-meta').textContent = `${Math.round((Date.now() - started) / 1000)}s`;
    }
  } catch (err) {
    $('#ask-report').hidden = false;
    $('#ask-report').innerHTML =
      renderMarkdown(state.reportText) +
      `<div class="callout callout-error"><strong>The run stopped.</strong><span>${esc(err.message)}</span></div>`;
  } finally {
    setRunning(false);
  }
}

$('#ask-form').addEventListener('submit', (event) => {
  event.preventDefault();
  runAsk($('#ask-input').value);
});

$('#ask-input').addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    runAsk($('#ask-input').value);
  }
});

$('#ask-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(state.reportText);
  $('#ask-copy').textContent = 'Copied';
  setTimeout(() => ($('#ask-copy').textContent = 'Copy report'), 1600);
});

$('#ask-download').addEventListener('click', () => {
  const blob = new Blob([state.reportText], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `coordinators-report-${new Date().toISOString().slice(0, 10)}.md`;
  link.click();
  URL.revokeObjectURL(url);
});

$('#dash-refresh').addEventListener('click', loadDashboard);
$('#systems-refresh').addEventListener('click', loadSystems);

/* ------------------------------------------------------------------ boot -- */

function boot() {
  buildWindowPicker($('#window-picker'), state.window, (win) => {
    state.window = win;
    loadDashboard();
  });
  buildWindowPicker($('#ask-window'), state.askWindow, (win) => {
    state.askWindow = win;
  });

  $('#ask-chips').innerHTML = PRESETS.map(
    (preset) => `<button type="button" class="chip">${esc(preset)}</button>`
  ).join('');
  $$('#ask-chips .chip').forEach((chip) =>
    chip.addEventListener('click', () => {
      $('#ask-input').value = chip.textContent;
      location.hash = 'ask';
      runAsk(chip.textContent);
    })
  );

  $('#ask-unavailable').hidden = state.askAvailable;
  $('#ask-form').hidden = !state.askAvailable;
  $('#ask-chips').hidden = !state.askAvailable;

  loadDashboard();
  loadSystems();

  // A question can be carried in the URL — /?q=What+needs+my+attention — so a
  // recurring ask can be bookmarked instead of retyped every Monday.
  const asked = new URLSearchParams(location.search).get('q');
  if (asked && state.askAvailable) {
    showView('ask');
    $('#ask-input').value = asked;
    runAsk(asked);
  } else {
    showView(location.hash.slice(1));
  }
}

(async function start() {
  try {
    const session = await fetch('/api/session').then((r) => r.json());
    state.askAvailable = Boolean(session.askAvailable);
    if (session.signedIn) {
      showApp();
      boot();
    } else {
      showGate();
      if (!session.passwordConfigured) {
        const error = $('#gate-error');
        error.textContent = 'APP_PASSWORD is not set on this deployment, so nobody can sign in yet.';
        error.hidden = false;
      }
    }
  } catch {
    showGate();
  }
})();
