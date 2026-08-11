// The catalog every server route reads from.
//
// One entry per reporting system: where it lives, how it authenticates, how a
// plain window maps onto its own params, and which fields of its response are
// safe to put on a dashboard tile.
//
// The tile paths here are transcribed from each system's SKILL.md, not guessed.
// Where a field name wasn't documented, the tile is deliberately absent rather
// than approximated — a blank tile is honest, a wrong number is not.

/** Auth styles the upstreams use. Header names are case-insensitive over HTTP. */
const XKEY = 'x-api-key';
const BEARER = 'bearer';

/** ISO date (UTC) helpers for windows an upstream can't express as a preset. */
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};
const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};
const daysSinceMonthStart = () =>
  Math.max(1, Math.round((Date.now() - monthStart().getTime()) / 86400000));

/** The windows the UI offers. Everything downstream maps from one of these. */
export const WINDOWS = [
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'mtd', label: 'This month' },
];

export const DEFAULT_WINDOW = '7d';

const fromTo = (win) => ({
  from: iso(win === 'mtd' ? monthStart() : daysAgo(Number(win.replace('d', '')))),
  to: iso(new Date()),
});

export const SYSTEMS = [
  {
    id: 'meta-ads',
    name: 'Meta Ads',
    blurb: 'Ad spend, true cost per lead, campaign and creative performance.',
    skill: 'meta-ads',
    urlVar: 'META_STATS_API_URL',
    keyVar: 'META_STATS_API_KEY',
    auth: XKEY,
    // `/health` isn't documented here, so the summary call doubles as the probe.
    probe: { path: 'summary', params: { preset: 'last_7d' } },
    summary: {
      path: 'summary',
      params: (w) => ({
        preset: { '7d': 'last_7d', '30d': 'last_30d', '90d': 'last_90d', mtd: 'this_month' }[w],
      }),
    },
    // crm_leads, never pixel_leads — the pixel systematically under-counts here.
    tiles: [
      { label: 'Ad spend', paths: ['current.spend', 'spend'], format: 'money', delta: ['deltas.spend'], good: null },
      { label: 'Leads', paths: ['current.crm_leads', 'crm_leads'], format: 'int', delta: ['deltas.crm_leads'], good: 'up', note: 'From the CRM, not the Meta pixel.' },
      { label: 'Cost per lead', paths: ['current.cost_per_lead', 'cost_per_lead'], format: 'money', delta: ['deltas.cost_per_lead'], good: 'down' },
      { label: 'Impressions', paths: ['current.impressions'], format: 'int', delta: ['deltas.impressions'], good: null },
    ],
  },
  {
    id: 'forms-platform',
    name: 'Forms Platform',
    blurb: 'Applications, qualified conversion, role demand, review backlog.',
    skill: 'forms-platform',
    urlVar: 'FORMS_REPORTING_BASE_URL',
    keyVar: 'FORMS_REPORTING_API_KEY',
    urlDefault: 'https://forms.coordinators.pro',
    auth: BEARER,
    probe: { path: 'stats', params: { window: '7d' } },
    summary: {
      path: 'stats',
      params: (w) => (w === '7d' || w === '30d' ? { window: w } : fromTo(w)),
    },
    tiles: [
      { label: 'Submissions', paths: ['submissions.total'], format: 'int', delta: ['submissions.change.change_pct'], good: 'up' },
      { label: 'Qualified', paths: ['pipeline.qualified_in_window'], format: 'int', good: 'up' },
      { label: 'Qualified rate', paths: ['pipeline.qualification_rate_pct'], format: 'pct', good: 'up' },
      { label: 'Pending review', paths: ['pipeline.pending_all_time'], format: 'int', good: 'down', attention: true, note: 'All-time backlog, not window-scoped.' },
    ],
  },
  {
    id: 'candidate-inventory',
    name: 'Candidate Inventory',
    blurb: 'Offshore candidate supply, intake trend, ingest failures.',
    skill: 'candidate-inventory',
    urlVar: 'CANDIDATE_INVENTORY_API_URL',
    keyVar: 'CANDIDATE_INVENTORY_API_KEY',
    auth: XKEY,
    probe: { path: 'summary', params: { days: 7 } },
    summary: {
      path: 'summary',
      params: (w) => (w === 'mtd' ? fromTo(w) : { days: Number(w.replace('d', '')) }),
    },
    // Only `needs_attention.unprocessed_backlog` is documented by name. The rest
    // fall through to auto-tiles built from the response's own keys.
    tiles: [
      { label: 'Ingest backlog', paths: ['needs_attention.unprocessed_backlog'], format: 'int', good: 'down', attention: true, note: 'Raw rows waiting on the structuring cron.' },
    ],
    autoTileFrom: ['totals', 'window'],
  },
  {
    id: 'screening-assessments',
    name: 'Screening App (Assessments)',
    blurb: 'Assessment volume, recruiter pass rates, channels and sourcers.',
    skill: 'screening-assessments',
    urlVar: 'SCREENING_API_BASE_URL',
    keyVar: 'SCREENING_API_KEY',
    auth: XKEY,
    probe: { path: 'health', params: {}, noKey: true },
    summary: {
      path: 'summary',
      params: (w) => ({ window: w === 'mtd' ? 'mtd' : w }),
    },
    tiles: [
      { label: 'Started', paths: ['totals.started'], format: 'int', delta: ['change_vs_previous.started_pct'], good: 'up' },
      { label: 'Completed', paths: ['totals.completed'], format: 'int', good: 'up' },
      { label: 'Pass rate', paths: ['rates.pass_rate_pct'], format: 'pct', delta: ['change_vs_previous.pass_rate_points'], deltaKind: 'points', good: 'up', note: 'Over decided attempts only.' },
      { label: 'Awaiting review', paths: ['totals.awaiting_review'], format: 'int', good: 'down', attention: true },
    ],
  },
  {
    id: 'video-interview',
    name: 'Video Interview',
    blurb: 'AI-scored spoken interviews and AI-vs-reviewer calibration.',
    skill: 'video-interview',
    urlVar: 'SCREENING_APP_URL',
    keyVar: 'SCREENING_APP_API_KEY',
    auth: XKEY,
    probe: { path: 'stats', params: { days: 7 } },
    summary: {
      path: 'stats',
      params: (w) => ({ days: w === 'mtd' ? daysSinceMonthStart() : Number(w.replace('d', '')) }),
    },
    tiles: [
      { label: 'Started', paths: ['funnel.started'], format: 'int', delta: ['vs_previous_period.started_pct_change'], good: 'up' },
      { label: 'Completion', paths: ['funnel.completion_rate_pct'], format: 'pct', delta: ['vs_previous_period.completion_rate_pct'], deltaKind: 'points', good: 'up' },
      { label: 'AI pass rate', paths: ['ai.pass_rate_pct'], format: 'pct', delta: ['vs_previous_period.ai_pass_rate_pct'], deltaKind: 'points', good: null },
      { label: 'Awaiting review', paths: ['decisions.awaiting_review_all_time'], format: 'int', good: 'down', attention: true, note: 'All-time, deliberately not window-scoped.' },
    ],
  },
  {
    id: 'candidate-assessment',
    name: 'Candidate Assessment',
    blurb: 'Proctored 30-minute job simulation, AI-scored against a rubric.',
    skill: 'candidate-assessment',
    urlVar: 'ASSESSMENT_REPORTING_URL',
    keyVar: 'ASSESSMENT_REPORTING_KEY',
    auth: XKEY,
    probe: { path: 'health', params: {}, noKey: true },
    summary: {
      path: 'summary',
      params: (w) => (w === 'mtd' ? fromTo(w) : { window: w }),
    },
    // This API is camelCase where the others are snake_case.
    tiles: [
      { label: 'Opened', paths: ['totals.opened'], format: 'int', good: 'up', note: 'Invited candidates who opened their link.' },
      { label: 'Completed', paths: ['totals.completed'], format: 'int', good: 'up' },
      { label: 'Fit rate', paths: ['totals.fitRate'], format: 'pct', good: 'up', note: 'Platform Fit at 7.0/10 — not the customer rubric Pass at 40/50.' },
      { label: 'Awaiting review', paths: ['needsAttention.awaitingReview'], format: 'int', good: 'down', attention: true },
    ],
  },
  {
    id: 'helm-ops',
    name: 'HELM Ops (Signal)',
    blurb: 'Recruiting funnel, hires, open roles, staffing forecast.',
    skill: 'helm-ops',
    urlVar: 'HELM_OPS_BASE_URL',
    keyVar: 'HELM_OPS_API_KEY',
    auth: XKEY,
    probe: { path: 'summary', params: { days: 7 } },
    summary: {
      path: 'summary',
      params: (w) => (w === 'mtd' ? fromTo(w) : { days: Number(w.replace('d', '')) }),
    },
    tiles: [
      { label: 'Screenings', paths: ['current.screenings.completed'], format: 'int', delta: ['trend.screenings_completed.percent'], good: 'up' },
      { label: 'Hired', paths: ['current.candidates.hired'], format: 'int', delta: ['trend.hired.percent'], good: 'up' },
      { label: 'Open roles', paths: ['pipeline.roles_open'], format: 'int', good: null },
      { label: 'Roles past target', paths: ['needs_attention.roles_past_target_date.length', 'needs_attention.roles_past_target_date'], format: 'count', good: 'down', attention: true },
    ],
  },
];

/**
 * Airtable is not a reporting API like the others — it has no `/api/v1/reporting`
 * surface and no dashboard tiles. It exists here so the Ask console can answer
 * CPA questions, which need the Meta-spend-to-confirmed-order join.
 */
export const AIRTABLE = {
  id: 'airtable',
  name: 'Airtable (orders)',
  blurb: 'The helm ops base. Used only for the cross-system CPA join.',
  keyVar: 'AIRTABLE_API_KEY',
  urlVar: 'AIRTABLE_BASE_ID',
  askOnly: true,
};

export const byId = (id) => SYSTEMS.find((s) => s.id === id);

/** Resolve a system's base URL + key from the environment. Values never leave the server. */
export function resolve(system, env = process.env) {
  const url = (env[system.urlVar] || system.urlDefault || '').replace(/\/+$/, '');
  const key = env[system.keyVar] || '';
  const missing = [];
  if (!url) missing.push(system.urlVar);
  if (!key) missing.push(system.keyVar);
  return { url, key, missing, configured: missing.length === 0 };
}

/**
 * The funnel strip: money in at the top, people out at the bottom.
 * Each node names the system it came from, so nothing on screen is unattributed.
 */
export const FUNNEL = [
  { label: 'Spend', system: 'meta-ads', paths: ['current.spend'], format: 'money' },
  { label: 'Leads', system: 'meta-ads', paths: ['current.crm_leads'], format: 'int' },
  { label: 'Applications', system: 'forms-platform', paths: ['submissions.total'], format: 'int' },
  { label: 'Qualified', system: 'forms-platform', paths: ['pipeline.qualified_in_window'], format: 'int' },
  { label: 'Screened', system: 'screening-assessments', paths: ['totals.completed'], format: 'int' },
  { label: 'Interviewed', system: 'video-interview', paths: ['funnel.completed'], format: 'int' },
  { label: 'Assessed', system: 'candidate-assessment', paths: ['totals.completed'], format: 'int' },
  { label: 'Hired', system: 'helm-ops', paths: ['current.candidates.hired'], format: 'int' },
];
