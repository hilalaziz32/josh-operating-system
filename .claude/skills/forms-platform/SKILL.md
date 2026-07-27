---
name: forms-platform-reporting
description: Reports on candidate application volume, week-over-week trends, qualified-candidate conversion, which job roles are attracting applicants, the pending-review backlog, candidate profile trends (healthcare specialties, EMR/EHR systems), contactability, and video/audio testimonial activity from the Forms Platform (forms.coordinators.pro) — the system that collects healthcare-experience intake, per-role job applications, and testimonials for The Coordinators. Use for questions about form submissions, applicant/intake volume, qualified candidates, role demand, or the unreviewed submission backlog.
---

# Forms Platform reporting

Read-only reporting for **forms.coordinators.pro**, the multi-form submission
platform for The Coordinators. Answers "how many applicants came in, for which
roles, how many qualified, and what's waiting on us."

## What this system holds

Admins create forms with no schema migration, so **treat the form list as
dynamic — never hardcode it**. Today it includes a `details` healthcare-experience
intake (country, EMR/EHR systems, specialties, roles), a candidate funnel form,
and a video/audio testimonial form.

Applicants can pick a **job (role)** on a form; the chosen `job_id` is stored on
the submission and the `jobs` table maps it to a role name — so "which roles are
pulling applicants" is a first-class question here.

**Status lifecycle:** `pending → reviewed → qualified → published → archived`.

Two statuses carry most of the signal:

- **`pending`** — unreviewed work sitting in the queue.
- **`qualified`** — the conversion event. Marking a submission qualified is what
  fires its n8n automation, so it is the closest thing this system has to a
  "good candidate found" metric. **Lead with it.**

## Configuration

| Env var | Purpose |
| --- | --- |
| `FORMS_REPORTING_BASE_URL` | Defaults to `https://forms.coordinators.pro`. |
| `FORMS_REPORTING_API_KEY` | Required. Reporting key for this repo. |

## How to call it

All endpoints are under `$FORMS_REPORTING_BASE_URL/api/v1/reporting/`, authed with
a bearer token. **GET only — this surface cannot mutate anything.**

```bash
curl -s -H "Authorization: Bearer $FORMS_REPORTING_API_KEY" \
  "https://forms.coordinators.pro/api/v1/reporting/stats?window=7d"
```

**Start with `/stats`.** One call answers almost every question below. Only reach
for the other endpoints when `/stats` doesn't cover the ask.

| Endpoint | Use it for |
| --- | --- |
| `GET /stats` | **The primary call.** Volume, change vs the previous equal-length period, status mix, per-role split with qualified counts, per-form split, daily series, contactability, media rollup, top categorical answers. |
| `GET /forms` | Form catalog + lifetime counts. Use to spot **active forms with zero activity** in the window. |
| `GET /jobs` | Roles with applications + qualified counts. "Which roles are we filling, which are stalling." |
| `GET /submissions` | Individual submissions — filter by `form`, `job`, `status`, date range. Drill-downs only. |
| `GET /submissions/{id}` | One submission. |
| `GET /media` | Uploaded video/audio/file assets. |

Shared params: `window` (`7d`/`30d`/`24h`) **or** `from`/`to` (never both — passing
both is a `400`), `form` (slug), `job` (job_id), `status`, `limit` (≤200), `offset`.

**Mapping plain-language asks to a window:** "this week" → `window=7d` (the
default), "this month" → `30d`, "today" → `24h`. Anything else → explicit
`from`/`to` ISO dates. Always scope to a window — never report all-time numbers
when the user asked about a period.

Every response uses the same envelope:

```jsonc
{ "data": …, "meta": { "window": …, "pagination": … }, "errors": null }
```

On failure `data` is `null` and `errors` is populated. Rate limit: 120 req/min.

## Key fields in `/stats`

- `submissions.total`, `submissions.change` → `{ previous_period, delta, change_pct }`
- `submissions.by_status` → includes `qualified`
- `submissions.by_form` → `{ name, submissions, share_pct }`
- `submissions.by_job` → `{ job_id, job_name, applications, qualified, qualified_pct }`
- `pipeline` → `{ pending_all_time, qualified_in_window, qualified_all_time, qualification_rate_pct }`
- `contactability` → `{ with_email_pct, with_phone_pct }`
- `media` → `{ total, by_type, avg_duration_seconds }`
- `ratings` → `{ count, average }`
- `top_answers` → `[{ field_label, values: [{ value, count }] }]` — specialties, EMR systems
- `meta.truncated` → `true` means the window exceeded 5,000 submissions and the
  aggregate is partial. Say so; narrow the window for exact figures.

## Privacy — read before widening a query

Candidate PII (**names, emails, phone numbers, free-text answers, and the media
URLs that play back a person's face and voice**) is **redacted by default**.
`/stats` returns no personal data at all — only counts and rates.

Build insights from the aggregates. Do **not** try to defeat the redaction, and do
not pass `include_pii=true` unless the user explicitly asked for individual
candidate contact details (it returns `403 pii_disabled` unless the deployment
opts in).

## Output format

Emit exactly this. Bullets are **insights** — what changed, what's trending, what
needs attention — never a dump of individual records.

```
### Forms Platform
- <insight bullet>
- <insight bullet>
- ...
(data window: last 7 days, source: Forms Platform)
```

Derive bullets in roughly this priority order, skipping any that have no data:

1. **Headline volume + trend** — total submissions, and the direction vs the
   previous period (`change.change_pct`, `change.delta`).
2. **Qualified conversion** — `qualified_in_window`, `qualification_rate_pct`, and
   `qualified_all_time`. This is the money metric; if it's zero, say so plainly.
3. **Role demand** — top roles from `by_job`. Flag any role with meaningful
   application volume but **zero qualified** — that's a stalling role.
4. **Backlog** — `pending_all_time`, the clearest "needs attention" signal.
5. **Throughput** — how much of the window was actioned (reviewed + qualified +
   published) vs left pending.
6. **Contactability** — `with_email_pct` / `with_phone_pct`, if either is below 100%.
7. **Candidate profile trends** — `top_answers` (top specialties, EMR systems).
8. **Media/testimonials** — count by type, average duration.
9. **Dormant forms** — cross-reference `/forms` (`is_active: true`) against
   `by_form`; an active form with zero submissions is worth a line.

Compare against the previous period wherever the data allows — a number with no
direction is not an insight.

**If the API is unreachable, the key is missing, or the response carries errors,
return exactly:**

```
### Forms Platform
- data unavailable
```

That is intentional: a dead endpoint must degrade to one line, not break the wider
report this is being merged into. **Never invent numbers to fill the gap.**
