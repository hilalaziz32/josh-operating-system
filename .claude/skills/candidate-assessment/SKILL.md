---
name: candidate-assessment-reporting
description: Reports on The Coordinators' proctored candidate assessment app - screening volume and completion rates, where candidates drop out of the funnel, score distribution and Fit/Pass rates, which competencies the applicant pool is weakest in, how far human reviewers move the AI's scores, and per-candidate or per-assessment results. Use for questions about screening throughput, assessment performance, candidates awaiting review, or whether the AI scoring can be trusted.
---

# Candidate Assessment reporting

Wraps the read-only reporting API of the candidate assessment system: the app
that sends applicants a private link, records a 30-minute proctored job
simulation (webcam, screen and a mock patient call), scores it against a rubric
with AI, and hands a reviewer a dashboard to audit and override.

This skill answers questions about **the shape of screening**, not about
individual candidate material. It can tell you that eleven people were scored
this week, that the pool is weakest on Attention to Detail, and that three
candidates are sitting unreviewed. It cannot show you what a candidate wrote or
said, and it should not be asked to.

## Setup

Two environment variables:

| Variable | Meaning |
|---|---|
| `ASSESSMENT_REPORTING_URL` | Base origin of the deployed app, e.g. `https://assesment.coordinators.pro`. No trailing path. |
| `ASSESSMENT_REPORTING_KEY` | This system's reporting API key. Repo-specific, not shared with other systems. |

`query.py` is standard-library Python 3.8+. No pip install.

## How to run it

```sh
python .claude/skills/candidate-assessment/query.py                              # default report, last 7 days
python .claude/skills/candidate-assessment/query.py --window 30d                 # any of: 24h 7d 30d 90d 12m all
python .claude/skills/candidate-assessment/query.py --from 2026-08-01 --to 2026-08-08
python .claude/skills/candidate-assessment/query.py --section funnel             # one section only
python .claude/skills/candidate-assessment/query.py --assessment-id <id>         # scope everything to one assessment
python .claude/skills/candidate-assessment/query.py --candidate-id <id>          # one candidate's result summary
python .claude/skills/candidate-assessment/query.py --section candidates --top 5 # highest scorers in the window
python .claude/skills/candidate-assessment/query.py --section health             # is the system reachable
```

Sections: `report` (default, merges summary + funnel + scores + ai), `summary`,
`funnel`, `scores`, `ai`, `candidates`, `assessments`, `health`.

**Always pass a date window.** For "this week" use `--window 7d`, for "this
month" `--window 30d`, for "how are we doing overall" `--window all`. The
default is 7d.

## Endpoints it calls

Every documented endpoint on the API is used. Base path `/api/v1/reporting`,
authenticated with `X-API-Key`.

| Endpoint | Used for |
|---|---|
| `GET /health` | Availability probe before anything else. Distinguishes "system down" from "a quiet week". Produces no report bullet of its own; `--section health` surfaces it directly. |
| `GET /summary` | The core bullets: volume, completion rate, fit rate, average score, and the change against the previous window of equal length. |
| `GET /funnel` | Where candidates are lost, and the single biggest drop-off stage. |
| `GET /scores` | Score distribution, Pass/Borderline/Fail split, and the weakest and strongest competency across the pool. |
| `GET /ai-vs-reviewer` | How often reviewers override the AI, in which direction, and whether the gap is narrowing. |
| `GET /candidates` | Top scorers in the window (`--section candidates`), and the names behind "awaiting review". |
| `GET /candidates/{id}` | One candidate's score summary and category performance (`--candidate-id`). |
| `GET /assessments` | Which assessments exist, their thresholds and lifetime volume (`--section assessments`). |
| `GET /assessments/{id}` | One assessment's rubric shape and windowed performance (`--assessment-id` with `--section assessments`). |

## Output format

Exactly this, so several systems' output can be merged without reformatting:

```
### Candidate Assessment
- <insight bullet>
- <insight bullet>
(data window: last 7 days, source: Candidate Assessment)
```

Bullets are **insights**, never a record dump: what moved, what is trending,
what needs attention. A bullet that just restates a number without a comparison
or a consequence is not worth emitting.

If the API is unreachable, the key is rejected, or the request times out, the
output is exactly:

```
### Candidate Assessment
- data unavailable
```

## Reading the numbers correctly

Four things will produce a wrong report if ignored.

1. **Two different pass lines exist and they disagree.** The platform-wide
   rule is Fit at 7.0/10. The customer's own rubric puts Pass at 40/50, which is
   8.0/10. A candidate can be "Fit" and "Borderline" simultaneously. Report the
   Fit rate by default and name the rubric band only when asked; never merge
   them into one "pass rate".

2. **Pending criteria drag scores down.** Three criteria per assessment
   ("navigates without fumbling" and similar) can only be scored by a human
   watching the screen recording, and count as zero until someone does. On this
   rubric that is 9 of 50 points, so an unreviewed candidate's score is a
   **floor, not a verdict**. When `pending.criteriaAwaitingHumanReview` is
   high, say so alongside any average.

3. **The AI scoring has never been validated against real candidate data.**
   The `/ai-vs-reviewer` numbers are the closest thing to evidence either way.
   A large mean gap means the AI is not yet trustworthy on its own, and the
   report should say that rather than presenting AI scores as settled.

4. **"Opened" is not "applied".** The funnel starts when someone opens their
   private link and enters their details, so drop-off between opened and
   started is people who were invited and did not begin.

## What this skill will not return

Candidate answer documents, recordings, call or answer transcripts, the grader's
verbatim evidence quotes, reviewer notes, and the assessment content itself
(task sheet, answer sheet, answer key, individual rubric criterion wording) are
not exposed by the API and cannot be retrieved here. Candidate email addresses
are omitted unless `--include-contact` is passed, which should only be used when
someone specifically needs to contact an applicant.
