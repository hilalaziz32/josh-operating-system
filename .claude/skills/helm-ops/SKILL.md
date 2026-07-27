---
name: helm-ops-signal-reporting
description: Reports on the HELM recruiting funnel from the Ops/Signal system — screening volume and pass rates, candidate flow and hires, sourcing/ad spend and cost per candidate, open-role pipeline and time-to-placement, plus the deterministic staffing forecast (how many sourcers and candidates each open role needs). Use for questions about recruiting throughput, funnel health, roles that are slipping, or "how's screening/hiring looking this week/month".
---

# HELM Ops (Signal) — reporting skill

This skill answers questions about the HELM recruiting funnel by calling the read-only
reporting API of the HELM Ops Analyst ("Signal") app — a Next.js service over a live
Airtable base for a healthcare-admin staffing agency.

Every figure the API returns is computed deterministically from that base. **No LLM sits
between the data and you**, so the numbers are auditable and stable. Your job is to call
the endpoints, read the response, and turn it into insight bullets. Never compute a number
the API didn't give you.

## Configuration

Read these from the environment. **Never hardcode the key, never print it.**

| Env var | Meaning |
|---|---|
| `HELM_OPS_BASE_URL` | Base URL of the deployed app, e.g. `https://helm-ops-analyst.vercel.app` |
| `HELM_OPS_API_KEY` | This repo's reporting API key |

Auth is a header on every request: `x-api-key: $HELM_OPS_API_KEY`.

If either variable is missing, treat the system as unreachable (see **Failure** below).

## What this system knows about

- **Roles** — open reqs, their specialty/EMR/function, how long they've been open, whether
  they've slipped past target, and time-to-placement once filled.
- **Screenings** (`Screening Daily`) — screenings completed and passed, per day, per role.
- **Candidates** — pipeline stage and hires. *Personal details are stripped by the API.*
- **Spend** — two sides: supply (job-post spend → candidates) and demand (ad spend → orders).
- **Staffing forecast** — the system's own deterministic answer to "how many sourcers and
  candidates does each open role need", clamped to 1–6 sourcers per role.

## How to answer a question

### 1. Start with `/summary` — it usually answers the whole question in one call.

```bash
curl -sS -H "x-api-key: $HELM_OPS_API_KEY" \
  "$HELM_OPS_BASE_URL/api/v1/reporting/summary?days=7"
```

**Date range is always supported**, and every "this week / last month / since June 1" ask
maps onto it:

| Ask | Params |
|---|---|
| "this week", default | `?days=7` (the default if omitted) |
| "this month" / "last 30 days" | `?days=30` |
| "in June" | `?from=2026-06-01&to=2026-06-30` |

`/summary` returns the window **and the equal-length window immediately before it**, plus a
`trend` block that has already done the comparison. Use it — that's what makes a bullet an
insight instead of a number. Key fields:

- `data.current` / `data.prior` — `screenings {completed, passed, pass_rate}`,
  `candidates {added, hired}`, `spend {supply_usd, demand_usd, total_usd, cost_per_candidate, cost_per_order}`, `roles_opened`, `leads_added`
- `data.trend` — `screenings_completed {absolute, percent}`, `pass_rate_points`
  (percentage **points**, not percent), `candidates_added`, `hired`, `spend_total_usd`.
  A `percent` of `null` means there was nothing to compare against — say "new" or give the
  absolute, don't print an infinite percentage.
- `data.pipeline` — `roles_open`, `roles_placed`, `by_status`,
  `median_time_to_placement_days`, `placements_measured`, `oldest_open_role`
- `data.needs_attention` — `roles_past_target_date`, `open_roles_with_no_screenings`,
  `open_roles_with_no_candidates` (each with role names). **This is where the best bullets are.**
- `data.staffing_forecast` — `sourcers_needed_across_open_roles`, `candidates_to_source_across_open_roles`
- `data.data_confidence` — `High` / `Medium` / `Low` per rate. **Read this before quoting anything.**

### 2. Drill down only if the question needs it.

All GET, all under `/api/v1/reporting/`, all with the same `x-api-key` header.

| Endpoint | Use it when |
|---|---|
| `/roles?open=true` | You need to name the open roles. Filters: `open`, `status`, `specialty`, `emr`, `function`, `q`, `sort=name`, `limit`, `offset` |
| `/roles/{id}` | Everything about one role: cross-table footprint, comparable past roles |
| `/screenings?days=N&role_id=…` | Screening detail day by day |
| `/candidates?days=N&stage=…&hired=true` | Candidate flow. Add `all=true` for the whole pipeline, not just the window |
| `/spend?days=N&side=supply\|demand` | Where the money went and what it bought |
| `/predictions/{roleId}` | The five operating answers for one role (sourcers, interviewers, candidates to source, time to placement, supply-vs-demand), each with a range and a confidence |

Full parameter reference: `app/api/v1/reporting/README.md` in this repo.

Responses are always `{ data, meta, errors }`. Lists paginate via
`meta.pagination.next_offset` (follow it until `null`; default 50 rows, max 200).

## Output format — produce exactly this

```
### HELM Ops (Signal)
- <insight bullet>
- <insight bullet>
- ...
(data window: last 7 days, source: HELM Ops (Signal))
```

Bullets are **insights, not records** — what moved, what's trending, what needs attention.
Never dump rows. Aim for 4–8 bullets. Good ones look like:

- "Screening volume is up: 143 completed this week vs 98 the week before (+46%)."
- "Screening pass rate is 22%, down 3.8 points on the prior week — worth a look at the bar."
- "22 new candidates entered the pipeline and 1 was hired."
- "Spend was $3,300 ($2,400 finding candidates, $900 on ads), about $34 per candidate."
- "2 open roles are past their target date: Cardiology Coordinator is 18 days over."
- "3 open roles have had no screenings at all yet: Front Desk Lead, RCM Analyst, Scheduler II."
- "To cover every open role the system estimates 12 sourcers and 187 candidates to source."

Rules:

- **Lead with what changed.** A bare count with no comparison is a weak bullet; `data.trend`
  hands you the comparison, so use it.
- **Respect confidence.** This base holds only a few months of history, so most rates come
  back `Low`. When they do, add a bullet saying the numbers are rough guides, not promises.
  Never present a `Low`-confidence figure as a hard forecast.
- **No jargon.** Say "based on 143 past screenings", not "n=143". No "median", no
  "confidence interval", no formulas — this matches the app's own voice.
- **Never invent a figure.** Every number must appear in an API response.

## Failure

If the API is unreachable, unconfigured, or returns an error envelope (`errors` is
non-null), output exactly this and nothing else — do not error out, do not guess:

```
### HELM Ops (Signal)
- data unavailable
```

Error codes you may see: `401 unauthorized` (bad/missing key), `429 rate_limited` (over 120
requests/minute — back off), `503 data_source_unconfigured` (the server has no Airtable
token set), `404 not_found` (no such role id).

## Data handling

Candidate names, emails, phone numbers, resume/attachment links and free-text notes are
**redacted server-side** and never reach this skill; each candidate row lists what was
withheld in `redacted_fields`. Deal in counts and rates only. Do not attempt to
re-identify anyone, and do not ask for the redaction to be lifted.
