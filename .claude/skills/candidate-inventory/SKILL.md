---
name: candidate-inventory-reporting
description: Reports on the offshore remote-only healthcare candidate inventory — inventory size and healthcare split, new-candidate intake volume and trend, country/category/skill concentration, RecruiterFlow pipeline stages, and ingest failures needing attention. Use for questions about candidate supply, sourcing volume, where candidates are coming from, or what is stuck in the inventory pipeline.
---

# Candidate Inventory — Reporting

Read-only reporting over the Candidate Inventory: a searchable inventory of
**offshore, remote-only healthcare candidates**, structured from RecruiterFlow by
AI. Answers questions about candidate **supply** (how many, where, what skills)
and **intake** (how many arrived, trending up or down, what failed).

This skill only reads. It cannot change candidate data.

## Setup

Two env vars must be set:

- `CANDIDATE_INVENTORY_API_URL` — base URL of the deployment (no trailing slash)
- `CANDIDATE_INVENTORY_API_KEY` — the reporting API key

If either is missing, or the API is unreachable, output exactly:

```
### Candidate Inventory
- data unavailable
```

Do not error, do not retry more than once, do not invent numbers.

## How to call

Every endpoint is a `GET` under `/api/v1/reporting/`, authed with a header.
Use `curl` (or any HTTP client):

```bash
curl -s -H "X-API-Key: $CANDIDATE_INVENTORY_API_KEY" \
  "$CANDIDATE_INVENTORY_API_URL/api/v1/reporting/summary?days=7"
```

Every response uses the same envelope — read `data`, check `errors`:

```jsonc
{ "data": { ... }, "meta": { "window": {...}, "truncated": false }, "errors": [] }
```

If `errors` is non-empty, or the HTTP status is not 200, treat it as unreachable
and emit the `data unavailable` block above.

## The two inventories (important)

Always be explicit about which one you are reporting on:

- `inventory=future_potential` (**default**) — the curated pool: RecruiterFlow
  "Future Potential" stage only, remote-capable candidates only. This is the
  bench of people available to place.
- `inventory=all` — every RecruiterFlow stage, everyone kept. Use this for
  pipeline/funnel questions and total-volume questions.

Add `segment=healthcare` or `segment=non` to split healthcare from non-healthcare.
Default is both.

## Date window

Every endpoint takes a window, which is how "this week" / "this month" asks are served:

- `?days=7` — rolling window back from now (default 7; `/intake` defaults to 30)
- `?from=2026-07-01&to=2026-07-31` — explicit range (bare dates cover the whole UTC day)

Map the ask: "this week" → `days=7`, "this month" → `days=30`, "today" → `days=1`,
"last quarter" → `days=90`.

## Endpoints

| Endpoint | Use it for |
|---|---|
| `/summary?inventory=&segment=&days=` | **Start here for any general ask.** Whole-inventory totals, what arrived/changed in the window, top countries + categories, failures, backlog. |
| `/intake?days=&interval=day\|week` | Volume over time + `trend` vs the previous equal-length window (`direction`: up/down/flat) + ingest `success_rate`. Use for "how's volume looking". |
| `/breakdowns?dimension=&top=` | Concentration by `country`, `category`, `seniority`, `work_mode`, `availability`, `employment_type`, `skills`, and (on `inventory=all`) `stage`, `sub_stage`, `emr`, `specialties`, `functions`. Omit `dimension` for all of them. |
| `/pipeline?inventory=all` | Recruiting funnel: candidates per stage + `qualified` (the placeable bench). **Requires `inventory=all`.** |
| `/review-queue?days=&error_type=` | Ingest failures needing attention, rolled up `by_error_type`. |
| `/candidates?...&limit=` | Paginated drill-down list. Use only to name specific people when asked. Filters: `country`, `category`, `skill`, `seniority`, `work_mode`, `min_years`, and (on `inventory=all`) `stage`, `emr`, `specialty`, `function`. |
| `/candidates/{id}` | One candidate, by UUID or RecruiterFlow `prospect_id`. |
| `/taxonomy` | Code → label map. |

For a normal "give me the report" ask, `/summary` plus `/intake` is enough. Add
`/pipeline` only if the question is about the funnel, and `/breakdowns` only if
it is about concentration.

### Codes → words

Endpoints return codes (`PHL`, `RN_CASE_MGMT`, `REMOTE_EXPERIENCED`). Never print
raw codes in bullets. Call `/taxonomy` to resolve category and skill codes to
labels; render country codes as country names (`PHL` → Philippines) and work modes
in plain words (`REMOTE_EXPERIENCED` → remote-experienced).

## Reading the data

- `summary.totals` = the **whole inventory**, all time. `summary.window` = only
  what happened **inside the window**. Never conflate them.
- `intake.trend.pct_change` / `.direction` is the trend signal. `direction:
  "unknown"` means the previous window was empty — say "no prior-period baseline",
  do not report a percentage.
- `intake.totals.success_rate` is the share of ingest *attempts* that produced a
  usable row. A drop here means the pipeline is rejecting or failing more.
- `needs_attention.unprocessed_backlog` is raw rows waiting on the 5-minute
  structuring cron. A number that stays high across runs means the cron is stuck.
- `NOT_REMOTE_CAPABLE` failures are **expected and healthy** — that is the
  remote-only business rule rejecting onsite-only people, not a bug. `PARSE_FAIL`
  / `API_ERROR` / `VALIDATION_FAIL` are real problems. Do not report them the same way.
- In `/breakdowns`, `skills` / `emr` / `specialties` / `functions` are multi-valued —
  one candidate lands in several buckets, so shares sum above 1.
- In `/pipeline`, `stage` is **one bucket per candidate** (Fully Qualified,
  Assessment Passed, Interview Passed, Screen Passed, New / Sourced, Disqualified),
  so the counts partition the inventory and sum to the total. `qualified` is
  everyone who cleared screening — the placeable bench, and usually the number
  worth leading with. `sub_stage` is granular legacy detail, present only on older
  rows, so never present it as a complete second funnel.
- If `meta.truncated` is `true`, the scan hit its row cap: counts are a **floor**.
  Say so.

## Output format

Always output exactly this shape, and nothing else:

```
### Candidate Inventory
- <insight bullet>
- <insight bullet>
- ...
(data window: <e.g. "last 7 days">, source: Candidate Inventory)
```

Bullets are **insights** — what changed, what is trending, what needs attention.
Never dump records. Aim for 3-6 bullets. Lead with the one that matters most
(usually the trend or the thing that is broken), not with a total.

Each bullet should carry a number **and** its meaning. Prefer comparison
(vs. the previous window, or as a share of the whole) over a bare count.

**Good:**

```
### Candidate Inventory
- Intake is up 18% week over week: 212 new candidates vs 180 the week before, averaging 30/day.
- The Philippines now supplies 45% of new arrivals, up from a 38% share of the standing inventory — sourcing is concentrating.
- Ingest success rate held at 95%; the 9 rejections were all onsite-only candidates, which is the remote-only rule working as intended.
- Needs attention: 3 parse failures this week, and a backlog of 41 raw rows still waiting on the structuring cron.
- Standing bench is 8,214 candidates (84% healthcare), across 47 countries.
(data window: last 7 days, source: Candidate Inventory)
```

**Bad** (record dump, raw codes, no insight):

```
- Maria Santos, PHL, RN_CASE_MGMT, 8 years
- Total: 8214
- PHL: 3120
```

## Privacy

Candidate contact details (email, phone, LinkedIn, address) are withheld by
default and require `?include_contact=1`. **Do not pass that flag** unless the
user explicitly asks for a specific person's contact information. Reporting
bullets never need it — they are aggregates, and naming individuals is almost
never the right answer to a reporting question.
