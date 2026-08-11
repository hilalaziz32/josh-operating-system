# The Coordinators — reporting playbook

Josh asks a question in plain English. Claude works out which systems can answer it, asks each one,
and hands back a single report. No "which tab was that in".

Every system in The Coordinators' stack exposes a read-only `/api/v1/reporting/` API. Each has a
skill in this repo that knows how to call it and how to turn the response into insight. One master
skill sits on top and does the routing and the merging.

There are two front doors onto the same playbook:

| | For | What it is |
|---|---|---|
| **[Control Room](#the-control-room-the-web-app)** | Josh | A web app on Vercel. Open a URL, see the funnel; ask a question, get the report. |
| **Claude Code** | whoever maintains this | The terminal. Full run of the skills, plus everything else Claude Code can do. |

## The Control Room (the web app)

The deployed UI. Three views:

- **Dashboard** — the funnel end to end, money in at the top and people out at the bottom, pulled
  live from all eight systems in one parallel sweep. Every figure is labelled with the system that
  reported it. Nothing is averaged, reconciled or recomputed.
- **Ask** — the same plain-English question box as the terminal, running the playbook server-side on
  the Gemini API. The report streams in as it's written.
- **Systems** — a live probe of every reporting API, with what to do about anything that isn't
  answering. This supersedes `preflight.sh`, which can only tell you a key is *present*.

The dashboard also carries **caveats**: rules transcribed from [MEMORY.md](MEMORY.md) that fire
against the live data. A $0 cost-per-lead gets flagged as meaningless rather than good; two systems
disagreeing about screening volume get shown side by side rather than quietly averaged. When a
MEMORY.md entry is fixed at the source, delete its rule in
[api/dashboard.js](api/dashboard.js) along with the entry.

### Deploying it

```bash
vercel                       # from the repo root — zero config, no build step, no dependencies
```

Then set the environment variables in the Vercel project: every key from `.env` (so the app can
reach the reporting APIs), plus `APP_PASSWORD`. Until `APP_PASSWORD` is set **nobody can sign in** —
it fails closed rather than putting live business data on an open URL. `GEMINI_API_KEY` is
optional and switches the Ask console on; without it the other two views work unchanged.

`api/ask.js` is configured for a 300-second ceiling, which needs a Vercel plan with Fluid compute.
On Hobby the cap is 60s and a full seven-system report will be cut off — single-system questions
still fit comfortably.

### Running it locally

```bash
npm run dev                  # http://localhost:4321 — reads .env, no Vercel CLI needed
```

## How Josh uses it

Open the Control Room and ask. Or open Claude Code in this folder and ask — same playbook.

```bash
cd "josh - operating system"
claude
# then just ask:
#   give me this week's report
```

Claude finds the skills automatically — they live in `.claude/skills/`, which is where Claude Code
looks. Josh never names a skill, never picks a system, never touches a URL. He asks the question he
was going to ask anyway. (`/coordinators-reporting` forces the playbook explicitly, if it ever doesn't
trigger on its own.)

| Ask | What happens |
|---|---|
| "Give me this week's report" | All six systems, last 7 days, merged into one report with a "what matters this week" section on top |
| "How's Meta looking?" | Just the Meta Ads section |
| "How's screening looking?" | Both screening systems (they're different apps — see below) |
| "What needs my attention?" | All six, filtered down to just the problems |
| "Full picture for June" | All six, scoped to 1–30 June |
| "Cost per lead this month vs last?" | Meta Ads, scoped to the months asked for |
| "Which roles are stalling?" | HELM Ops and the Forms Platform, since both have a view on it |

Anything about time ("this month", "last quarter", "since June 1") is passed through to every system
in the run, so the whole report covers the same window. Say nothing about time and it defaults to the
last 7 days.

If a system is down or unconfigured, its section reads `- data unavailable` and the rest of the
report ships anyway. A gap is never allowed to take down the report.

## MEMORY.md

[MEMORY.md](MEMORY.md) is the repo's accumulated knowledge: what each field actually means, which
numbers are known to be soft, which zeros are artefacts rather than results. The master skill reads it
before every report and passes it down to each sub-skill.

**When you learn something durable about these systems, put it there.** When a defect it warns about
gets fixed, delete the entry. A stale warning is worse than no warning.

## What's in here

| Skill | System | Answers |
|---|---|---|
| [.claude/skills/master/](.claude/skills/master/) | — | **The entry point.** Routes the question, runs the sub-skills, merges the report |
| [.claude/skills/meta-ads/](.claude/skills/meta-ads/) | Meta Stats | Ad spend, true cost per lead, campaign and creative performance, wasted spend |
| [.claude/skills/forms-platform/](.claude/skills/forms-platform/) | forms.coordinators.pro | Applications, qualified conversion, role demand, the unreviewed backlog |
| [.claude/skills/candidate-inventory/](.claude/skills/candidate-inventory/) | Candidate Inventory | Offshore candidate supply, intake trend, country and skill concentration, ingest failures |
| [.claude/skills/screening-assessments/](.claude/skills/screening-assessments/) | Screening App | Assessment volume, recruiter pass rates, channel and sourcer performance, anti-cheat |
| [.claude/skills/video-interview/](.claude/skills/video-interview/) | Screening App (video) | AI-scored spoken interviews, AI pass/fail recommendations, AI-vs-human calibration |
| [.claude/skills/candidate-assessment/](.claude/skills/candidate-assessment/) | Candidate Assessment | Proctored 30-min job simulation, AI-scored rubric, competency breakdown, funnel drop-off, reviewer-vs-AI overrides |
| [.claude/skills/helm-ops/](.claude/skills/helm-ops/) | HELM Ops "Signal" | Recruiting funnel, hires, open roles, time to placement, staffing forecast |
| [.claude/skills/cpa/](.claude/skills/cpa/) | Meta × Airtable (cross-system) | True cost per acquisition — Meta spend joined to confirmed orders. Cost per order/placement, ROAS when data allows |

The master skill orders sections by the funnel — Meta Ads → Forms → Inventory → Screening →
Video Interview → HELM Ops — so a full report reads top to bottom as money in, people out.

### The two screening skills

`screening-assessments` and `video-interview` are **two different apps** on two different
deployments, with two different sets of env vars. They both happen to ship with the frontmatter name
`screening-app-reporting` and both emit a `### Screening App` heading, so the master skill relabels
them on merge (`### Screening App (Assessments)` and `### Video Interview`). The sub-skill files are
untouched. If they're ever renamed at the source, drop the relabel rule from
[.claude/skills/master/SKILL.md](.claude/skills/master/SKILL.md).

## Configuration

### From a fresh clone

The repo ships **no keys** — `.env` is gitignored and never leaves a machine. To wire up a clone:

```bash
cp .env.example .env      # then open .env and paste the real keys in
bash .claude/skills/master/scripts/preflight.sh   # confirm each system reads "ready"
```

The real keys live wherever your team keeps secrets (a password manager, not this repo). Two ends
have to match for a system to work: the key in your `.env`, **and** the same key set as
`REPORTING_API_KEY` in that system's own Vercel project. If a system reports `data unavailable` even
though `.env` is filled in, the server side is the thing that's missing — see
[MEMORY.md](MEMORY.md).

### The variables

Each system reads its own URL and API key from the environment. Nothing is hardcoded and no key is
ever printed.

| System | Env vars |
|---|---|
| Meta Ads | `META_STATS_API_URL`, `META_STATS_API_KEY` |
| Forms Platform | `FORMS_REPORTING_API_KEY` (URL defaults to `https://forms.coordinators.pro`) |
| Candidate Inventory | `CANDIDATE_INVENTORY_API_URL`, `CANDIDATE_INVENTORY_API_KEY` |
| Screening App (Assessments) | `SCREENING_API_BASE_URL`, `SCREENING_API_KEY` |
| Video Interview | `SCREENING_APP_URL`, `SCREENING_APP_API_KEY` |
| Candidate Assessment | `ASSESSMENT_REPORTING_URL`, `ASSESSMENT_REPORTING_KEY` |
| HELM Ops (Signal) | `HELM_OPS_BASE_URL`, `HELM_OPS_API_KEY` |
| Airtable (for cross-system CPA / order joins) | `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID` |

Check what's wired up:

```bash
bash .claude/skills/master/scripts/preflight.sh
```

It prints each system as `ready` or `MISSING` (with the vars it's missing), never the key values.
Anything `MISSING` will report as `- data unavailable` until its vars are set.

## Privacy

Every one of these APIs redacts candidate contact details by default — names, emails, phones,
recordings, free-text answers — and every one documents a flag that would lift the redaction. **The
skills never pass those flags.** This is a reporting surface: it deals in counts, rates and trends.
Pulling a specific person's details is a deliberate one-off lookup, not something a weekly report
should ever do.

## Adding a new system

Each system's repo generates its own reporting skill against its own live API. To bring one into the
playbook:

1. **Drop the folder in** as `.claude/skills/<system-name>/`, with its `SKILL.md` inside.
2. **Add a row to the catalog** in [.claude/skills/master/SKILL.md](.claude/skills/master/SKILL.md) — what it covers,
   and the words Josh would use when he wants it. That table is what the routing reads.
3. **Slot it into the funnel order** in the same file's merge section, so it lands in a sensible place
   in a full report.
4. **Add its env vars** to `SYSTEMS` in [.claude/skills/master/scripts/preflight.sh](.claude/skills/master/scripts/preflight.sh)
   and to the config table above.

No other code changes. The new system's skill is responsible for its own API calls, its own date
mapping, and its own output — the master skill only needs to know it exists and when to ask it.

The contract every sub-skill must hold up, in exchange for the master skill leaving it alone:

- Emit a `### <System Name>` block: insight bullets, then a `(data window: …, source: …)` footer.
- Bullets are **insights** — what changed, what's trending, what needs attention — never a dump of
  records.
- Accept a date window, and cover exactly that window.
- When the API is unreachable, unconfigured, or returns errors, emit exactly `- data unavailable`
  under the heading. Never error out, never guess a number.
