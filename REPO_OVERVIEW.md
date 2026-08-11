# The Coordinators — Reporting Playbook (Repo Overview)

## What it is
A **Claude Code skills repo** with a thin web app on top. It turns plain-English questions from Josh Klenoff (CEO of *The Coordinators*, a healthcare-admin staffing agency) into merged, read-only business reports.

Two front doors, one playbook:
- **Control Room** (`public/` + `api/`) — a Vercel app. Password-gated, no build step, no dependencies. Dashboard (live funnel across all systems), Ask (the playbook run server-side, streamed), Systems (live API probes).
- **Claude Code** — open the folder, ask. Full skill run.

## How it works
- Every backend system exposes a read-only `/api/v1/reporting/` API.
- Each system has a **skill** in `.claude/skills/` that knows how to call its API and turn the response into insight.
- A **master skill** (`.claude/skills/master/SKILL.md`) sits on top: it routes the question to the right systems, runs them, and merges the output into one report — ordered along the funnel (money in → people out).

## The systems (funnel order)
| Skill | System | Covers |
|---|---|---|
| meta-ads | Meta Stats | Ad spend, true cost-per-lead, creative performance |
| forms-platform | forms.coordinators.pro | Applications, qualified conversion, backlog |
| candidate-inventory | Candidate Inventory | Offshore candidate supply, intake, ingest failures |
| screening-assessments | Screening App | Assessment volume, pass rates, anti-cheat |
| video-interview | Screening App (video) | AI-scored interviews, AI-vs-human calibration |
| helm-ops | HELM Ops "Signal" | Recruiting funnel, hires, staffing forecast |

## Two sides of the business (key mental model)
- **Demand** — Meta ads bring in *clients* (leads → orders → roles). "Leads" = demand.
- **Supply** — sourcing brings in *candidates* to fill roles. "Candidates" = supply.

Attribution chain: `Meta spend → GHL CRM lead → Airtable Leads row → Airtable Role = confirmed order`.
A **confirmed order = a Roles record whose `Lead` link is set** (not a checkbox).

## Important conventions
- **MEMORY.md** is the accumulated ground-truth: field semantics (stable) and known data defects (re-check, delete when fixed). Read before producing any report.
- **Two screening skills** are separate apps sharing a frontmatter name; the master skill relabels them on merge.
- **Config**: each system reads its own URL + API key from `.env` (gitignored). `.claude/skills/master/scripts/preflight.sh` shows which are `ready` vs `MISSING` — but it only checks that env vars exist. The app's **Systems** view actually probes each API, so it can tell a missing key from a rejected one from a dead host.
- **Privacy**: reporting only — counts/rates/trends. Skills never pass redaction-lifting flags to pull individual candidate PII.
- **Resilience**: a down/unconfigured system reports `- data unavailable`; it never takes down the whole report.

## Files
- `README.md`, `MEMORY.md` — docs
- `.claude/skills/*/SKILL.md` — the eight skills
- `.env` — live keys (gitignored); on Vercel these are project environment variables
- `lib/` — the app's shared core: `systems.js` (the catalog: env vars, auth style, window mapping, which response fields are safe to put on a tile), `upstream.js` (the only code that holds a key or calls an upstream; strips PII flags server-side), `auth.js` (signed-cookie password gate), `http.js`
- `api/` — `session.js`, `systems.js` (live probes), `dashboard.js` (parallel KPI sweep + MEMORY.md-derived caveats), `ask.js` (Gemini function-calling loop, SSE-streamed)
- `public/` — the client. No framework, no build step
- `dev.js` — local server that reproduces Vercel's routing (`npm run dev`)
