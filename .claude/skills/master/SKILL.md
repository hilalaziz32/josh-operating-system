---
name: coordinators-reporting
description: The Coordinators' reporting playbook — routes a plain-language question to the right system(s) and merges their answers into one report. Use for any ask that spans systems ("give me this week's report", "how are we doing", "full picture", "what needs my attention") or when it isn't obvious which system owns the answer. Covers Meta ads, the forms platform, candidate inventory, screening assessments, AI video interviews, and HELM Ops. Single-system asks ("how's Meta looking") route straight through to that one system.
---

# The Coordinators — reporting playbook

Josh asks a question in plain language. This skill decides which systems can answer it, gets
each system's own reporting skill to answer for its system, and merges the results into one
report. It never calls an API itself and never computes a number — the sub-skills own that.

## Read `MEMORY.md` first — every time

`MEMORY.md` at the repo root holds what we know about these systems: what a field actually means,
which numbers are known-soft, which zeros are artefacts rather than results. **Read it before you
route, and again before you synthesize.** It is the difference between a report that is confidently
wrong and one that is right.

Concretely, it will stop you from: reading a zero as a business result when the Meta ad account is
simply switched off; quoting an order count from a field that disagrees with the real one; or
averaging two systems that disagree when the disagreement *is* the finding.

Three rules that override everything else below:

1. **One dead system never kills the report.** A system that returns `- data unavailable` is
   reported as unavailable and the rest of the report ships. There is no failure mode in which
   Josh gets an error instead of a report.
2. **Never invent, average, or reconcile a number.** Every figure in the final report must
   appear verbatim in a sub-skill's bullets. If two systems disagree, say so and name both.
3. **Apply `MEMORY.md`'s caveats to the bullets you merge.** A sub-skill only sees its own system,
   so it cannot know that its number is contradicted elsewhere. You can. That's your job.

## The catalog

Six reporting systems, each with its own skill under `.claude/skills/`, its own API and env vars,
emitting its own `### <System>` block — plus one cross-system skill (**CPA**) that joins two of them.

| System | Skill | Covers | Reach for it when Josh asks about |
|---|---|---|---|
| **Meta Ads** | `.claude/skills/meta-ads/` | Ad spend, real cost-per-lead (from CRM, not pixel), campaign/creative performance, wasted spend, alerts | ads, spend, cost per lead, CPL, Facebook/Instagram, campaigns, creatives, paid leads |
| **Forms Platform** | `.claude/skills/forms-platform/` | forms.coordinators.pro submissions, qualified conversion, which roles pull applicants, pending-review backlog, testimonials | applications, form submissions, intake volume, qualified candidates, role demand |
| **Candidate Inventory** | `.claude/skills/candidate-inventory/` | Offshore remote-only healthcare candidate supply, intake volume/trend, country and skill concentration, RecruiterFlow stages, ingest failures | candidate supply, the bench, sourcing volume, where candidates come from, ingest failures |
| **Screening App (Assessments)** | `.claude/skills/screening-assessments/` | Intelligence / Big Five / verbal / writing assessments, recruiter pass-fail, channel and sourcer performance, anti-cheat | screening throughput, pass rates, which channel or sourcer converts, review backlog |
| **Video Interview** | `.claude/skills/video-interview/` | Writing task + Big Five + **AI-scored spoken interview**, AI pass/fail recommendations, AI-vs-reviewer calibration, anti-cheat | video/spoken interviews, AI scoring, is the AI trustworthy, who's waiting on a decision |
| **HELM Ops (Signal)** | `.claude/skills/helm-ops/` | Airtable recruiting funnel: screenings, candidate flow and hires, supply/demand spend, open-role pipeline, time-to-placement, staffing forecast | hires, open roles, roles slipping, time to placement, how many sourcers we need |
| **CPA** (cross-system) | `.claude/skills/cpa/` | True cost per acquisition: Meta spend joined to confirmed orders in Airtable. Cost per order, cost per placement, lead→order conversion, ROAS when data allows | CPA, CAC, cost per client/order, "are the ads profitable", return on ad spend, ROAS |

**CPA is different from the other six.** It calls no single reporting API — it runs a deterministic
script that joins Meta Ads spend to Airtable orders. It is an **all-time** metric (the order side
can't be reliably date-windowed — see its skill and MEMORY.md), so it does **not** join the weekly
report. Route to it only for CPA/CAC/cost-per-order/ROAS questions.

### The two screening systems — read this before routing

`.claude/skills/screening-assessments/` and `.claude/skills/video-interview/` are **different systems on different
deployments**, but both ship with `name: screening-app-reporting` in their frontmatter and both
emit a `### Screening App` heading. That is a known collision in the source repos.

- Route on **substance, not the word "screening"**: AI scoring, spoken interview, calibration, or
  "is the AI any good" → Video Interview. Channels, sourcers, recruiter pass-fail, intelligence or
  verbal scores → Screening App (Assessments).
- A bare **"how's screening looking"** is ambiguous, so **run both** and present both blocks.
- **Relabel on merge** (see [Merging](#merging-the-report)). Never edit the sub-skill files.

## Routing

Work out the window first (below), then the systems.

| Ask | Systems |
|---|---|
| "this week's report", "how are we doing", "the full picture", "weekly report", "state of the business" | **All six** |
| "what needs my attention", "anything on fire" | **All six**, but keep only the bullets that name a backlog, a failure, a slipping role, a rising cost, or an alert |
| A named system ("how's Meta looking", "how's the inventory") | Just that one |
| "how's screening looking" | Both screening systems |
| A topic that maps to one system via the catalog table | Just that one |
| "what's my CPA", "cost per order/client", "are the ads profitable", "ROAS" | **CPA only** — never bundled into a weekly report |
| A topic two systems both touch (e.g. "cost per candidate" — Meta Ads and HELM Ops both have a version) | Both, and say which number came from which system |
| Something no system covers | Say so plainly. Do not stretch a system to cover it. |

When in doubt, include the system. A section Josh skims past is cheaper than a section he needed
and didn't get.

## The window

Whatever Josh said about time applies to **every** system in the run — pass it through, don't let a
sub-skill fall back to its own default.

Each sub-skill has its own param name for this (`preset=`, `days=`, `window=`, `from`/`to`), and each
already documents its own mapping. So **pass the window in plain language** and let each sub-skill
map it. State it explicitly, e.g. *"Window: this month."*

| Josh says | Pass through as | Note |
|---|---|---|
| nothing at all | "the last 7 days" | The default. Say so in the report footer. |
| "this week", "this past week" | "the last 7 days" | |
| "this month" | "this month" | Calendar month to date, not a rolling 30 days, unless he says "last 30 days". |
| "last month" | "last month" | |
| "today" | "today" | Meta's rolling presets end *yesterday*, so a "today" Meta section may be thin or empty. Expect it. |
| "this quarter", "last 90 days" | "the last 90 days" | |
| an explicit range | the ISO dates, e.g. "2026-06-01 to 2026-06-30" | |

Other filters pass through the same way: a role, a job, a campaign, a country. Give the sub-skill the
plain-language filter and let it map it to its own param. If a filter only makes sense for some
systems (a campaign name means nothing to Candidate Inventory), apply it where it applies and note in
the footer that the other sections are unfiltered.

## Running the systems

Run `scripts/preflight.sh` first when doing a multi-system report. It tells you which systems have
their env vars set, so you know up front which sections will come back unavailable. It is a
convenience, not a gate — a system that passes preflight can still be down, and the sub-skill will
say so.

Then **invoke each system's skill in parallel, one subagent per system** (a single message with one
Agent call per system). They are independent; running them in series makes Josh wait six times as
long for nothing.

Give each subagent exactly this:

- The path to its `SKILL.md` (`.claude/skills/<system>/SKILL.md`), and an instruction to follow it exactly.
- **An instruction to read `MEMORY.md` first** and apply anything in it that touches its system. The
  sub-skill files themselves don't mention `MEMORY.md` — they're generated at their source repos and
  we don't edit them — so this instruction is the only thing that carries our accumulated knowledge
  into the subagent. Don't drop it.
- The window, in plain language, plus any filter that applies to it.
- An instruction to **return only its `### <System>` block** — the heading, the bullets, and the
  `(data window: …, source: …)` footer. No preamble, no commentary.

Treat a subagent that errors, times out, or returns something that isn't a well-formed block the
same as `- data unavailable`. Do not retry more than once.

## Merging the report

Order the sections by the funnel, so the report reads top to bottom as money in → people out:

1. `### Meta Ads` — what we spent to get attention
2. `### Forms Platform` — who applied
3. `### Candidate Inventory` — who's on the bench
4. `### Screening App (Assessments)` — who got screened
5. `### Video Interview` — who got interviewed
6. `### HELM Ops (Signal)` — who got hired, and what's still open

The **CPA** section is not in this list on purpose: it's an all-time cross-system metric, not a
weekly funnel stage, so it never appears in a "give me the report" bundle. If Josh asks for CPA
alongside the weekly report, add its `### CPA` block at the very end, after HELM Ops, as a clearly
separate all-time figure — and keep its `(basis: all-time, …)` footer, which correctly differs from
the others' `(data window: …)`.

Paste each system's block **verbatim** — bullets and footer exactly as the sub-skill produced them.
The only edits permitted:

- **Rewrite the heading of the two screening sections** to `### Screening App (Assessments)` and
  `### Video Interview`, because both arrive as `### Screening App` and two identical headings in one
  report is unreadable. Rewrite the `source:` in their footers to match. Nothing else changes.
- Drop a section entirely **only** if the run was a single-system ask (then there's nothing to merge —
  just return the block).

Then put a synthesis on top. The whole report:

```
## The Coordinators — <window> report

**What matters this week**
- <cross-system insight>
- <cross-system insight>
- <cross-system insight>

### Meta Ads
- ...
(data window: ..., source: Meta Ads)

### Forms Platform
- ...
(data window: ..., source: Forms Platform)

... remaining sections in funnel order ...

_Not available this run: <System>, <System>._
```

The trailing "Not available this run" line appears only when at least one system returned
`- data unavailable`. Those systems still get their block in the body (heading + the one line) — the
footer line is so Josh can see at a glance that a gap is a gap, not a zero.

### Writing "what matters this week"

Three to five bullets. This is the only part of the report Josh is guaranteed to read, so it earns
its place by saying something **no single system could have told him**.

- Every claim must trace back to a bullet in a section below. **No new numbers**, no arithmetic
  across systems, no estimates.
- Prefer a **chain across systems** over a restatement of one. The funnel is the story: spend buys
  leads, leads become applications, applications become screenings, screenings become hires. A number
  moving at one stage while its neighbour moves the other way is the most valuable thing you can
  surface. Examples of the shape (not a checklist — find what's actually there):
  - CPL rising in Meta Ads while lead volume falls, *and* screening pass rate drops → we are paying
    more for worse candidates.
  - Forms applications up while Screening volume is flat → applications are piling up unscreened.
  - Screening passing plenty of people while HELM Ops shows open roles with no candidates → the
    handoff between screening and placement is where things are stalling.
  - Healthy top-of-funnel everywhere but a growing review backlog in either screening system → the
    bottleneck is a human decision, not supply.
- **Then anything that needs Josh to act**: a backlog, a failing ingest, a role past its target date,
  wasted ad spend, a stale sync. Name the system it came from.
- If two systems report the same quantity and disagree (both screening systems report volume; HELM
  Ops has its own screening count from Airtable; Meta Ads and HELM Ops both have a cost-per-something),
  **do not reconcile them**. State both with their sources. They're measuring different things at
  different points and the difference is often the finding.
- If a section is unavailable and it would have been load-bearing for one of these chains, say the
  chain is unverifiable rather than asserting half of it.
- Nothing genuinely cross-cutting to say? Say the funnel looks steady and lead with the single most
  important thing that did move. Don't manufacture a narrative.

## Worked examples

**"Give me this week's report"** → window: last 7 days. Preflight, then all six systems in parallel,
merge in funnel order, synthesis on top.

**"How's Meta looking this month?"** → window: this month. Only `.claude/skills/meta-ads/`. Return its
`### Meta Ads` block as-is. No synthesis section — there's nothing to synthesize against.

**"How's screening looking?"** → window: last 7 days (nothing said). Both screening systems in
parallel. Two blocks, relabeled, plus a short synthesis if they say something interesting together
(e.g. both backlogs growing).

**"What needs my attention?"** → all six, last 7 days. Merge, then keep only the bullets that name a
problem. If a system has nothing wrong, its section says so in one line rather than being dropped —
"nothing needing attention" is information.

**"Full picture for June"** → window: 2026-06-01 to 2026-06-30. All six. Note in the footer that Meta
Ads alerts always describe the trailing 7 days regardless of the requested window — that's by design
in that system, not a contradiction with the June numbers.

## Privacy

Every sub-skill redacts candidate contact details by default and every one of them documents a flag
that would lift the redaction. **Never pass those flags.** This playbook produces aggregate reporting;
it has no reason to name a person or print an email, and a report is exactly the wrong place for it.
If Josh wants a specific person's details, that's a deliberate one-off lookup against that system, not
a reporting run.
