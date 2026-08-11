# MEMORY — what we know about these systems

Durable facts learned the hard way. **Read this before producing any report or answering any
cross-system question.** It exists so nobody re-derives the same thing twice, and so nobody quotes a
number that looks clean but isn't.

Two kinds of entry here:

- **Semantics** — what a field actually means. These are stable. Trust them.
- **Known defects** — bugs and gaps in the source data. These *should* get fixed; **re-check before
  relying on one**, and if you find it fixed, delete the entry.

Last verified: **2026-07-13**.

---

## Business context

The Coordinators — a healthcare-admin staffing agency. Josh Klenoff, CEO, is the reader of every
report this repo produces. Two sides to the business, and most confusion comes from mixing them up:

- **Demand** — Meta ads bring in *clients* (leads → orders → roles to fill).
- **Supply** — job posts and sourcing bring in *candidates* to fill those roles.

"Leads" almost always means the demand side. "Candidates" always means supply.

---

## How a Meta dollar becomes an order (the attribution chain)

This is the chain that answers "what's my CPA", and it spans three systems:

```
Meta ad spend  →  GHL CRM lead  →  Airtable Leads row  →  Airtable Role  =  a confirmed order
   (meta-ads)        (meta-ads /leads)   (Source = "Meta")     (Role.Lead link)
```

**A confirmed order = a record in the Airtable `Roles` table whose `Lead` link points at a Lead.**
Not the `Ordered` checkbox, not `Order Confirmed?`. The Role link is the real thing, because a role
is a record someone had to create, not a box someone had to remember to tick.

**A lead counts as "from Meta" when `Leads.Source == "Meta"`** (a single-select). It is a *hand-set
label*, not a click ID — see the defect below.

**CPA = Meta spend ÷ count of Roles linked to a Meta-sourced Lead.**

Baseline computed 2026-07-13 (all-time, Jan–Jul 2026): $26,291.59 spend ÷ 20 Meta orders =
**$1,314.58 per order**. Only 4 of those 20 roles reached `Placed`, so cost per *placement* was
**$6,572.90**. Recompute rather than quoting these — they age.

**This is now automated.** The `cpa` skill (`.claude/skills/cpa/`) runs
`scripts/cpa.py`, which does this join deterministically and prints the metrics as JSON. Don't
re-derive CPA by hand — run the script. It is all-time by design (order side can't be date-windowed,
below) and is deliberately **excluded from the weekly report bundle**.

---

## Field semantics (Airtable base `helm ops` / `appi3l0FPeo2KoRRI`)

| Field | What it really means |
|---|---|
| `Leads.Source` | Where the lead came from. Values seen: `Meta`, `Website`, `Manual`. The only usable Meta attribution. |
| `Leads.Ordered` | A checkbox. **Disagrees with the Roles link — trust the link.** |
| `Roles.Lead` | Link back to the Lead that ordered this role. **This is the order.** |
| `Roles.Role Status` | `Open` / `Paused` / `Placed` / `Closed` / `Cancelled`. Only `Placed` earns revenue. |
| `Leads.Leads Created Date` | Airtable's `createdTime` — **when the row was imported, not when the lead arrived.** Do not window on it. |

---

## Known defects — verify before relying on any of these

Each one makes some number softer than it looks. Flag them in reports; don't silently paper over them.

1. **Meta CAPI is mostly absent.** `Leads.fbclid`, `fbc`, `fbp`, `CAPI Sent` were empty on all rows
   as of 2026-07-13; by 2026-07-14 a few newer leads carry a click id, so the field is *starting* to
   populate but is far from complete. Meta attribution still rests on the hand-set `Source` label.
   Fully wiring CAPI would turn CPA from an estimate into a fact — still the highest-leverage fix.
2. **`Deal Value` is empty on every *ordered* lead.** The field is now populated on some leads, but
   as of 2026-07-14 **zero of the 16 Meta leads that actually ordered** carry a value — so ROAS is
   still uncomputable. `cpa.py` detects this (`revenue.order_revenue == 0`, `deal_value_partial`) and
   refuses to print a fake ROAS. We can say what an order costs, not yet what it's worth.
3. **`Order Confirmed?` is ticked on zero rows.** Dead field. Ignore it.
4. **`Ordered` vs the Roles link disagree**: 21 Meta leads ticked `Ordered`, but only 16 have a role.
5. **12 of 38 Roles have no `Lead` link at all** — unattributed orders. If any are Meta's, real CPA is
   *better* than reported.
6. **Lead counts disagree across systems**: Airtable held 115 Meta leads where GHL's CRM reported 88
   over the same window.
7. **Order counts disagree across systems**: Airtable `Ordered` = 21, GHL `won` = 7, HELM Ops
   `cost_per_order` implies ~9. A 3× spread. Nobody agrees what an order is.
8. **Screening volume disagrees**: the Screening App reported 63 completed in a week where HELM Ops
   reported 0.
9. **Forms Platform job attribution is broken**: submissions carry `job_id 347`, which is not in the
   43-job catalog, so role demand is unreportable. Root cause looks like the legacy
   `remote-healthcare-roles` form (no job field) still taking all traffic, while
   `healthcare-application` (the one *with* a role picker) gets zero.
10. **Candidate Assessment: unauthenticated PII in the source repo.** Reported by the skill's author,
    not yet fixed: `app/api/media/[...key]/route.ts:39` gates only `recordings/` behind auth, so
    per-question candidate answer videos under `responses/` are served **without a session check** — a
    live PII leak. It's in that app's repo, not this one, so it can't be fixed here. Flag it; don't
    treat it as closed until someone confirms the fix.

**Rule when two systems disagree: report both, name the source of each, never average them.** The gap
is usually the finding.

---

## System quirks

- **Two different screening apps both call themselves `screening-app-reporting` and both emit a
  `### Screening App` heading.** `screening-assessments` (screening.coordinators.pro — assessments,
  channels, sourcers, recruiter pass/fail) and `video-interview` (interview.coordinators.pro —
  AI-scored spoken interview, calibration). The master skill relabels them on merge. Tell them apart
  by *routes*, never by name: `/channels` + `/sourcers` = assessments; `/stats` + `/calibration` =
  video interview.
- **There are now THREE assessment-family systems, not two.** Added `candidate-assessment`
  (assesment.coordinators.pro — a proctored 30-min job simulation, AI-scored). It emits its own
  `### Candidate Assessment` heading, so unlike the two `### Screening App` skills it needs **no**
  relabelling. Route by substance: proctored / job simulation / rubric competency → Candidate
  Assessment; spoken interview / calibration → Video Interview; channels / sourcers / recruiter
  pass-fail → Screening App (Assessments).
- **Candidate Assessment was not deployed to production as of 2026-08-12.** Its endpoints
  (`assesment.coordinators.pro/api/v1/reporting/*`) return `- data unavailable` until the app is
  deployed and `REPORTING_API_KEY` is set on its Vercel project. A blank section for it is expected,
  not a bug, until then.
- **Candidate Assessment — four reading rules (from its own skill):**
  1. **Two pass lines disagree.** Platform "Fit" is 7.0/10; the customer rubric "Pass" is 40/50 =
     8.0/10. A candidate can be Fit *and* Borderline. Report Fit rate by default; never merge them
     into one "pass rate".
  2. **Pending criteria are a floor, not a verdict.** ~9 of 50 rubric points can only be scored by a
     human watching the screen recording and count as zero until then. Quote averages alongside the
     pending count.
  3. **The AI grader has never been validated** against real candidate data — `/ai-vs-reviewer` (how
     often reviewers override it) is the only evidence. A large mean gap means don't trust AI scores
     alone.
  4. **"Opened" ≠ "applied".** The funnel starts when an invited candidate opens their private link,
     so opened→started drop-off is invitees who never began.
- **Meta ad account was disabled on 2026-07-02** (`account_status: 2`, `is_active: false`). Spend went
  to $0 and the whole funnel below it went quiet. **Re-check this before reading any zero as a
  business result** — a zero in Forms, Inventory or HELM may just be this.
- **Meta alerts always cover the trailing 7 days**, regardless of the window asked for. Not a bug.
- **Meta `cost_per_lead` divides by CRM leads, not pixel leads.** With zero spend it reads `$0.00` —
  which is meaningless, not good.
- **HELM Ops fails closed**: an unset server key returns the same `401` as a wrong key. A 401 there
  means "no key set" just as often as "bad key".
- **All six apps need `REPORTING_API_KEY` set in their own Vercel project**, not just in our `.env`.
  Done as of 2026-07-13.

---

## Privacy — non-negotiable

Every API redacts candidate PII by default and every one documents a flag to lift it. **Never pass
that flag.** Reports deal in counts, rates and trends. The Airtable token is read-only by design
(`data.records:read`, `schema.bases:read`) — keep it that way; nothing here should ever write.

---

## Keeping this file honest

When you learn something durable — a field's real meaning, a defect, a system quirk — add it here.
When a defect gets fixed, **delete the entry** rather than leaving a stale warning that makes people
distrust good data. Update "Last verified" when you re-check the defect list.
