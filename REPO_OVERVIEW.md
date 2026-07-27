# The Coordinators — Reporting Playbook (Repo Overview)

## What it is
A **Claude Code skills repo** (not application code). It turns plain-English questions from Josh Klenoff (CEO of *The Coordinators*, a healthcare-admin staffing agency) into merged, read-only business reports. There's no UI — the interface is opening Claude Code in this folder and asking a question.

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
- **Config**: each system reads its own URL + API key from `.env` (gitignored). Run `.claude/skills/master/scripts/preflight.sh` to see which are `ready` vs `MISSING`.
- **Privacy**: reporting only — counts/rates/trends. Skills never pass redaction-lifting flags to pull individual candidate PII.
- **Resilience**: a down/unconfigured system reports `- data unavailable`; it never takes down the whole report.

## Files
- `README.md`, `MEMORY.md` — docs
- `.claude/skills/*/SKILL.md` — the seven skills
- `.env` — live keys (gitignored)
