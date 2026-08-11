// The numbers, straight from the systems that own them.
//
// One parallel sweep of every system's summary endpoint, turned into tiles. No
// arithmetic happens here and nothing is reconciled across systems: each figure
// is a value one API returned, labelled with the system it came from. Where two
// systems disagree, the dashboard shows both — that gap is usually the finding.

import { json, query } from '../lib/http.js';
import { guard } from '../lib/auth.js';
import { DEFAULT_WINDOW, FUNNEL, SYSTEMS, WINDOWS, resolve } from '../lib/systems.js';
import { autoTiles, callSystem, extractTiles, pickFirst, statusOf } from '../lib/upstream.js';

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  const requested = String(query(req).window || DEFAULT_WINDOW);
  const window = WINDOWS.some((w) => w.id === requested) ? requested : DEFAULT_WINDOW;

  const sections = await Promise.all(
    SYSTEMS.map(async (system) => {
      const { missing, configured } = resolve(system);
      const shell = { id: system.id, name: system.name, blurb: system.blurb, missing };

      if (!configured) {
        return { ...shell, status: 'unconfigured', tiles: [], error: `Not configured: ${missing.join(', ')}` };
      }

      const out = await callSystem(system, system.summary.path, system.summary.params(window));
      if (!out.ok) {
        return { ...shell, status: statusOf(out), tiles: [], error: out.error, reason: out.reason };
      }

      let tiles = extractTiles(system, out.data);
      // Systems whose response fields aren't documented get tiles built from the
      // response's own keys, so the labels stay traceable to the payload.
      if (system.autoTileFrom) {
        const declared = new Set(tiles.map((t) => t.label));
        for (const tile of autoTiles(out.data, system.autoTileFrom)) {
          if (!declared.has(tile.label)) tiles.push(tile);
        }
      }

      return {
        ...shell,
        status: 'ready',
        tiles,
        windowLabel: out.meta?.window?.label ?? null,
        raw: out.data,
        ms: out.ms,
      };
    })
  );

  const byId = Object.fromEntries(sections.map((s) => [s.id, s]));

  // The funnel strip. A system that didn't answer leaves a gap, never a zero —
  // "we don't know" and "nobody applied" are different facts.
  const funnel = FUNNEL.map((node) => {
    const section = byId[node.system];
    const available = section?.status === 'ready';
    const value = available ? pickFirst(section.raw, node.paths) : undefined;
    return {
      label: node.label,
      format: node.format,
      source: section?.name ?? node.system,
      value: typeof value === 'number' ? value : undefined,
      available: available && typeof value === 'number',
    };
  });

  const caveats = buildCaveats(byId);

  // Anything a tile flagged as an action item, hoisted so it can't be missed.
  const attention = [];
  for (const section of sections) {
    for (const tile of section.tiles) {
      if (tile.attention && typeof tile.value === 'number' && tile.value > 0) {
        attention.push({ system: section.name, label: tile.label, value: tile.value, format: tile.format, note: tile.note });
      }
    }
  }
  attention.sort((a, b) => b.value - a.value);

  // Strip the raw payloads before responding — they were only needed to build
  // the funnel, and some carry more detail than a dashboard should ship.
  for (const section of sections) delete section.raw;

  return json(res, 200, {
    window,
    windows: WINDOWS,
    funnel,
    caveats,
    attention,
    sections,
    unavailable: sections.filter((s) => s.status !== 'ready').map((s) => s.name),
    generatedAt: new Date().toISOString(),
  });
}

/**
 * The things a number on this page won't tell you on its own.
 *
 * Each rule is transcribed from a durable entry in MEMORY.md and fires only on
 * the live data — no rule invents a figure, and none of them reconcile anything.
 * When MEMORY.md's corresponding entry is fixed at the source, delete the rule.
 */
function buildCaveats(byId) {
  const out = [];
  const ready = (id) => (byId[id]?.status === 'ready' ? byId[id].raw : null);

  // MEMORY.md: the Meta ad account was disabled 2026-07-02, and `cost_per_lead`
  // divides by CRM leads — so at zero spend it reads $0.00, which is meaningless
  // rather than good. A zero anywhere below Meta in the funnel may just be this.
  const meta = ready('meta-ads');
  if (meta) {
    const spend = pickFirst(meta, ['current.spend']);
    if (spend === 0) {
      out.push({
        severity: 'warning',
        title: 'Meta spend is $0 for this window',
        text:
          'Cost per lead therefore reads $0, which is meaningless rather than good. ' +
          'Check whether the ad account is still disabled before reading any zero further down the funnel as a business result.',
      });
    }
  }

  // MEMORY.md: the Screening App and HELM Ops have been observed reporting very
  // different screening counts for the same week. Report both, name both, never
  // average them — the gap is usually the finding.
  const screening = ready('screening-assessments');
  const helm = ready('helm-ops');
  if (screening && helm) {
    const a = pickFirst(screening, ['totals.completed']);
    const b = pickFirst(helm, ['current.screenings.completed']);
    if (typeof a === 'number' && typeof b === 'number' && a !== b) {
      out.push({
        severity: 'note',
        title: 'Two systems disagree on screenings',
        text:
          `The Screening App counts ${a} completed this window; HELM Ops counts ${b}. ` +
          'They measure at different points in the process and are known to disagree. Both are shown as reported; neither has been reconciled.',
      });
    }
  }

  return out;
}
