---
name: screening-app-reporting
description: Reports on candidate screening volume, pass/fail rates, funnel drop-off, sourcer and channel performance, assessment scores (intelligence, Big Five personality, verbal, writing), and anti-cheat integrity flags from The Coordinators' Screening App. Use when asked about screening throughput, how many candidates were screened or passed in a period, which sourcing channels or sourcers are converting, how many submissions are awaiting recruiter review, or candidate assessment score trends.
---

# Screening App — Reporting

Read-only reporting over the Screening App: the Next.js + Supabase system where
candidates take intelligence, personality (Big Five), verbal and writing
assessments via a tokenised link, and recruiters pass or fail them.

This skill answers questions about **the screening funnel** — volume, outcomes,
where candidates come from, and where they drop off. It does **not** cover
downstream hiring stages, client pipeline, or outreach; other systems own those.

## Setup

Two environment variables:

- `SCREENING_API_BASE_URL` — e.g. `https://<the-deployed-app>.vercel.app`
- `SCREENING_API_KEY` — this repo's reporting key

Auth is the header `x-api-key: $SCREENING_API_KEY` (or
`Authorization: Bearer $SCREENING_API_KEY`) on every request.

If either variable is missing, or the API cannot be reached, return exactly:

```
### Screening App
- data unavailable
```

Never error out, and never invent numbers.

## How to answer a question

1. **Always call `/summary` first.** It carries the headline totals *and* the
   same figures for the preceding period, which is what turns a number into an
   insight. Pass the window the user asked for.
2. **Call the supporting endpoints you need** for the specific question — they
   all accept the same date filters, so pass the same window.
3. **Write insight bullets**, in the output format below.

```bash
curl -s -H "x-api-key: $SCREENING_API_KEY" \
  "$SCREENING_API_BASE_URL/api/v1/reporting/summary?window=7d"
```

## Endpoints

All under `/api/v1/reporting/`, all **GET-only**.

| Endpoint | Use it for |
| --- | --- |
| `summary` | Headline totals, rates, and change vs the previous period. **Start here.** |
| `channels` | Volume + pass rate per sourcing channel. "Which channel converts best?" |
| `sourcers` | Volume + pass rate per sourcer. "Who's delivering?" |
| `trends` | Volume/outcomes bucketed by `day`/`week`/`month`. "How's volume trending?" |
| `jobs` | Per-role screening funnel. "Which roles are we screening for?" |
| `tests` | Per-assessment funnel. |
| `violations` | Anti-cheat flags, aggregated by type. "Is anyone cheating?" |
| `submissions`, `submissions/{id}` | Individual attempts. |
| `candidates`, `candidates/{id}` | Individual candidates. |
| `health` | Liveness. The only endpoint needing no key. |

### Date filtering — supported on every endpoint

This is how "this week" / "this month" questions get answered:

- `?window=24h | 7d | 30d | 90d | mtd | qtd | ytd | all` (also any `<n>d`)
- `?from=2026-07-01&to=2026-07-11` — ISO date or datetime; overrides `window`

`summary` additionally returns `change_vs_previous`, comparing the window
against the immediately preceding window of equal length. **Use it** — it's the
difference between "616 screenings" and "616 screenings, up 109%".

### Other filters

- `summary`, `trends`: `job_id`, `sourcer_id`
- `trends`: `granularity=day|week|month`
- `submissions`: `status` (`in_progress`|`submitted`|`passed`|`failed`|`abandoned`),
  `disqualified`, `job_id`, `test_id`, `sourcer_id`, `country`, `referral_source`,
  `ai_scored`, `exported`, `has_violations`, `sort`, `order`
- `jobs`, `sourcers`, `tests`: `active`
- `violations`: `type`
- Pagination on all list endpoints: `limit` (1–200, default 50), `offset`

### Response envelope

Every endpoint returns:

```json
{ "data": ..., "meta": { "window": {...}, "pagination": {...} }, "errors": [] }
```

On error, `data` is `null` and `errors` carries `[{ "code", "message" }]`.

## Reading the data correctly

Getting these wrong produces confidently incorrect reporting:

- **`status` is the state of an attempt, not a score:** `in_progress` (started),
  `submitted` (finished, awaiting a recruiter verdict), `passed` / `failed`
  (the recruiter's verdict), `abandoned` (started, never finished).
- **`completed` = passed + failed + awaiting_review.**
- **Pass rate is over *decided* attempts only** (`passed / (passed + failed)`),
  so a growing review backlog doesn't artificially depress it. A large
  `awaiting_review` is a **review backlog** — an action item for the recruiting
  team, not a quality problem. Say so.
- **`disqualified` is separate from `failed`** — the attempt was voided (e.g.
  anti-cheat), not judged poor. Don't fold it into the pass rate.
- Score ranges: intelligence ≈ 0–155; personality and each Big Five trait 0–100;
  verbal and writing 0–5.

## Output format

```
### Screening App
- <insight bullet>
- <insight bullet>
- ...
(data window: last 7 days, source: Screening App)
```

Bullets are **insights** — what changed, what's trending, what needs attention —
never a dump of records. Good bullets to reach for, when the data supports them:

- Volume with its direction of travel (`summary.totals.started` +
  `change_vs_previous.started_pct`)
- Pass rate and its movement in points (`rates.pass_rate_pct` +
  `change_vs_previous.pass_rate_points`)
- The review backlog, if `awaiting_review > 0`
- Abandonment, when it's material (say, ≥15% on a non-trivial volume) — usually
  the largest funnel leak
- The top channel by volume, with its pass rate — and any channel bringing
  volume but converting badly
- The best-converting sourcer, over a large enough sample to mean something
- Anti-cheat flags, only when the layer actually fired
- Trend direction from `trends`, when there's enough history to say

Real example:

```
### Screening App
- 616 screenings started, up 108.8% vs the previous period — 507 completed, 109 abandoned.
- Pass rate 28.3% (113 passed / 287 failed), −12.4 pts vs the previous period.
- 107 completed submissions awaiting recruiter review.
- 17.7% of candidates started but never finished — the largest funnel leak.
- Top channel: LinkedIn (313 candidates, 50.8% of volume, 13.5% pass rate).
- Best-converting sourcer: Fernanda (36.7% pass rate across 67 candidates).
- 72 submissions flagged by anti-cheat (most common: tab_switch).
- Weekly volume is trending down: 65 in the latest week vs a 138.7 average in prior weeks.
(data window: last 30 days, source: Screening App)
```

## Candidate PII

The API **withholds candidate contact details by default**: no email, no Upwork
profile URL, no recordings, no written answers, no AI review notes. Candidate
*name* and *country* are returned.

Contact details require an explicit `?include_contact=1` on `submissions` or
`candidates`. **Do not set it for reporting questions** — aggregate reporting
never needs it. It exists only for a deliberate, case-by-case lookup.
