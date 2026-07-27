---
name: screening-app-reporting
description: Reports on candidate screening for The Coordinators' assessment app (writing task, Big Five personality, and AI-scored spoken interviews). Covers assessment volume and completion/drop-off rates, AI pass/fail recommendations and scores, the backlog of candidates awaiting a human decision, AI-vs-reviewer score calibration, and anti-cheat integrity flags, per job or across all roles. Use for questions about screening volume, candidate throughput, how many candidates are waiting to be reviewed, whether the AI scoring is trustworthy yet, or recent submissions.
---

# Screening App reporting

Query the read-only reporting API of the **screening app**: the system where a
candidate opens one link and completes a multi-part assessment (an optional
writing task, a Big Five personality test, and a spoken interview scored by AI).

Use this for questions like "how's screening volume looking", "how many
candidates are waiting on me", "is the AI scoring accurate yet", "did anyone get
flagged for cheating", or as one input into a wider weekly report.

## Two facts that shape every answer

1. **The AI never decides.** It scores and recommends pass/fail; a human always
   makes the final call. "AI recommended pass" is never "hired", and a backlog of
   unreviewed candidates is a real blocker that will not clear itself.
2. **Anti-cheat signals never disqualify.** They are logged for a human to weigh.
   Report a flagged candidate as "worth a look", never as "a cheat".

## Setup

Two env vars, both required:

| Var | Value |
| --- | --- |
| `SCREENING_APP_URL` | Base URL of the deployment, e.g. `https://screening.example.com` |
| `SCREENING_APP_API_KEY` | This repo's reporting API key |

If either is missing, or the API is unreachable, output exactly:

```
### Screening App
- data unavailable
```

Do not retry in a loop, do not guess numbers, and do not error out.

## How to query

Every endpoint is `GET`, lives under `$SCREENING_APP_URL/api/v1/reporting/`, and
is authed with the `x-api-key` header. Call them with curl and read the JSON.

```bash
curl -s -H "x-api-key: $SCREENING_APP_API_KEY" \
  "$SCREENING_APP_URL/api/v1/reporting/stats?days=7"
```

Every endpoint accepts a date window and a `job_id` (uuid) scope:

| Param | Meaning |
| --- | --- |
| `days=7` | Rolling window: the last 7 days. **This is how you answer "this week".** |
| `from` / `to` | Explicit ISO 8601 window, when a specific range is asked for. |
| `job_id` | Scope everything to a single role. |
| `limit` / `offset` | List endpoints only. Default limit 50, max 200. |

Map the ask to a window: "this week" or "recently" is `days=7`, "this month" is
`days=30`, "today" is `days=1`, "this quarter" is `days=90`. With no window
param an endpoint reports over **all time**. When the user gives no timeframe,
use `days=7` and say so in the footer.

Responses use a shared envelope: `{ "data": ..., "meta": {...}, "errors": [] }`.
Read `data`. On failure, `errors[0].code` is one of `unauthorized`, `not_found`,
`invalid_param`, `rate_limited`, `query_failed`, `reporting_disabled`.

## Endpoints

### `stats` — start here, it answers most questions

`GET /api/v1/reporting/stats?days=7`

Returns the funnel, AI outcomes, decision counts, a per-job breakdown, and a
comparison against the previous period of the same length:

```json
{
  "funnel": { "started": 24, "completed": 18, "in_progress": 2, "dropped_off": 4,
              "completion_rate_pct": 75, "drop_off_rate_pct": 17 },
  "ai": { "evaluated": 18, "evaluation_errors": 1, "pass": 7, "fail": 11,
          "pass_rate_pct": 39, "pass_threshold": 8,
          "avg_interview_score": 6.8, "avg_writing_score": 7.1 },
  "decisions": { "approved": 5, "rejected": 9,
                 "awaiting_review_in_window": 4, "awaiting_review_all_time": 6 },
  "vs_previous_period": { "started_pct_change": 60, "completion_rate_pct": 8,
                          "drop_off_rate_pct": -5, "avg_interview_score": 0.4,
                          "ai_pass_rate_pct": -6 },
  "by_job": [ { "job_id": "…", "title": "Senior Care Coordinator", "started": 16,
                "completed": 13, "completion_rate_pct": 81, "awaiting_review": 3,
                "avg_interview_score": 7.1 } ]
}
```

`vs_previous_period` is what lets you say what **changed**, not just what the
totals are. It is `null` when no window was given. `awaiting_review_all_time` is
deliberately not window-scoped: a candidate waiting three weeks is still waiting.

### `calibration` — is the AI trustworthy yet?

`GET /api/v1/reporting/calibration?days=30`

Per part (`spoken_interview` and `writing`, calibrated separately):
`scored_pairs`, `avg_gap_mae` (average gap between the AI's score and the human
reviewer's), `ai_bias` (positive = AI scores higher), `ai_bias_direction`,
`within_1_pct`, `weekly_avg_gap`, and for the interview `pass_fail_agreement_pct`.

Only candidates the admin has **personally scored** count here. If `scored_pairs`
is 0, the AI's accuracy is **unknown**, not good. Say so plainly.

### `violations` — anti-cheat

`GET /api/v1/reporting/violations?days=7`

`total_violations`, `candidates_flagged`, `by_type` (`tab_switch`, `copy_paste`,
`developer_tools`, `screenshot_attempt`, `screen_share_stopped`,
`multiple_monitors`), `flagged_candidates` ranked by count, and paginated
`events`. Aggregates cover the whole window; only `events` pages.

### `candidates` — individual submissions

`GET /api/v1/reporting/candidates?needs_review=true&limit=5`

Filters: `job_id`, `status` (`pending|in_progress|completed|evaluating|evaluated|error`),
`final_decision` (`pending|approved|rejected`), `ai_recommendation` (`pass|fail`),
`min_score` / `max_score` (0-10, AI interview score), `needs_review=true` (finished
but no human decision yet, which is the queue the admin actually works from).

Each row carries `scores` (interview_overall, interview_behaviour, interview_role,
writing), `ai_recommendation`, `reviewer` (final_decision and the human's own
scores), `awaiting_review`, and `dropped_off`.

`GET /api/v1/reporting/candidates/{id}` gives one submission in full: scores per
part, the AI summary, Big Five trait percentages, answer counts, integrity flags,
and the reviewer's decision.

### `jobs` — roles

`GET /api/v1/reporting/jobs?is_open=true&days=7` lists roles with the candidate
activity each took in the window. `GET /api/v1/reporting/jobs/{id}` accepts a
**slug as well as a uuid** (the slug is what appears in share links) and returns
the job's config, question mix, all-time funnel, and average scores per part.

Each job carries `recruiterflow_job_id`, the id of the same role in
RecruiterFlow (the ATS this app pushes results into). **Use it as the join key**
when combining this system's numbers with RecruiterFlow's for the same role. It
is `null` on jobs that were never linked to the ATS.

Full response shapes: `app/api/v1/reporting/README.md` in this repo.

## Output format

Always produce exactly this shape, so a master report can merge it with other
systems:

```
### Screening App
- <insight bullet>
- <insight bullet>
(data window: last 7 days, source: screening-app)
```

Bullets are **insights**, not a record dump: what changed, what is trending, what
needs attention. Lead with anything that needs a human to act (a review backlog, a
drop-off spike, failed evaluations). Never list every candidate. Never print a
candidate's email.

A good default set of bullets, in this order, dropping any that do not apply:

1. **Volume**, with direction of travel from `vs_previous_period.started_pct_change`.
2. **Completion and drop-off**, flagging it when drop-off is 30% or higher.
3. **Review backlog** (`decisions.awaiting_review_all_time`), because it blocks hiring.
4. **AI outcomes**: pass rate, average score, and any `evaluation_errors` needing a re-run.
5. **Which role is driving the numbers** from `by_job`, and any role converting badly.
6. **Calibration**: the average gap and pass/fail agreement, or that it is unknown.
7. **Integrity flags**, always framed as "worth a look", never as an accusation.

Example:

```
### Screening App
- 24 candidates started and 18 completed, up 60% on the previous 7 days.
- Completion rate 75% (up 8 pts vs the previous period), with 4 dropping off (17%).
- 6 completed candidates are waiting on a human decision. The AI never decides, so they are blocked until reviewed.
- AI recommended pass for 39% of scored candidates (7 pass, 11 fail), average interview score 6.8/10.
- 1 candidate failed AI evaluation and needs a re-run, so that submission has no scores yet.
- Most activity: Senior Care Coordinator (16 started, 81% completion). Intake Specialist is converting poorly: only 38% of 8 starters finished.
- AI vs reviewer on the spoken interview: average gap 0.83 points across 12 scored candidates, scoring higher than you by 0.42. Pass/fail agreement 83%.
- 3 candidates tripped anti-cheat signals (14 events, mostly tab switch). Logged for review only, nobody is auto-disqualified.
(data window: last 7 days, source: screening-app)
```

If there was no activity in the window, say so in one bullet rather than printing
a wall of zeroes.

## Notes

- Candidate names come back shortened (`Maria G.`) and emails masked by default.
  Do not try to defeat that, and keep contact details out of reports.
- Writing answers, interview transcripts, and audio are never exposed by this API.
  If asked for them, point the user to the admin review page instead.
- No em dashes in the output. Use commas or periods.
