---
name: cpa-reporting
description: Reports true cost per acquisition for The Coordinators' Meta ads — what a paying client (a confirmed order) actually costs, by joining Meta ad spend to the orders those leads produced in Airtable. Covers cost per order, cost per placement, lead-to-order conversion, and (when the data supports it) revenue and ROAS. Use for questions about CPA, CAC, cost per client/order, whether the Meta ads are profitable, or return on ad spend. This is a cross-system, all-time metric — not part of the weekly funnel report.
---

# CPA — cost per acquisition (Meta × Airtable)

Answers the one question no single system can: **what does a paying client actually cost?**
It joins two systems — Meta ad spend and the orders those leads became in Airtable — so it lives
here, not inside either system's own skill.

**Read [MEMORY.md](../../../MEMORY.md) first.** Every caveat this skill reports is documented there,
and the attribution chain is the backbone of this metric.

## The metric

```
Meta ad spend  →  Airtable Leads (Source = "Meta")  →  Airtable Roles (Lead link set) = an order
```

- **A confirmed order** = an Airtable `Roles` record whose `Lead` link points at a Lead. Not the
  `Ordered` checkbox (it disagrees), not `Order Confirmed?` (dead field). The Role is the order.
- **A Meta lead** = a Lead with `Source == "Meta"` (a hand-set label — see caveats).
- **CPA = Meta spend ÷ count of Roles linked to a Meta-sourced Lead.**

## Why all-time, not this week

Airtable's Lead date field is an **import timestamp, not lead-arrival**, and Meta-sourced roles
predate the earliest imported lead — so the order side **cannot be reliably date-windowed**. All-time
spend ÷ all-time orders is the only honest basis. If someone asks "CPA this month", give the all-time
CPA and the monthly *spend* context from `meta.spend_by_month`, and say plainly that a monthly CPA
isn't trustworthy on this data yet. Don't fabricate one.

## How to run it

One deterministic script does the join. **No number in your report should come from anywhere else.**

```bash
set -a; . ./.env; set +a
python .claude/skills/cpa/scripts/cpa.py
```

It prints one JSON object. If `available` is `false`, or the script can't run, emit exactly:

```
### CPA
- data unavailable
```

Never invent a number, never do the join by hand — the script exists so nobody has to.

## Reading the JSON

| Field | Meaning |
|---|---|
| `meta.spend_lifetime` | Total Meta ad spend, all time. The numerator. |
| `meta.account_active` | `false` = the ad account is currently disabled (spend has stopped). |
| `meta.spend_by_month` | Monthly spend + CRM leads, for trend context. |
| `orders.meta_orders` | Confirmed orders from Meta. **The denominator.** |
| `orders.distinct_meta_leads_ordered` | Distinct clients behind those orders (a client can order >1 role). |
| `orders.by_status` | Order outcomes: `Placed` earns revenue; `Closed`/`Cancelled` never will. |
| `orders.placed` | Orders that reached a placement. |
| `cpa.cost_per_order` | **The headline CPA.** spend ÷ orders. |
| `cpa.cost_per_placement` | spend ÷ placed — the cost of a *revenue-earning* outcome. |
| `cpa.lead_to_order_pct` | Share of Meta leads that became an order. |
| `revenue.order_revenue` | Deal Value summed across ordered leads. **Often 0 — see caveats.** |
| `revenue.roas` | order_revenue ÷ spend. Only meaningful if `ordered_leads_with_value` is close to `ordered_leads_total`. |
| `caveats.*` | Flags that must shape the report — see below. |

## Caveats you must surface (from `caveats`)

These are not optional footnotes — they're the difference between a number and a *trustworthy* number.

- **`account_disabled: true`** → the Meta account is currently off, so spend has stopped and CPA is a
  backward-looking figure, not a live run-rate. Lead with this.
- **Attribution is a hand-set label.** The join keys on `Source == "Meta"`, which a human or automation
  sets — not a Meta click ID. Say CPA rests on that label. If `capi_missing: true`, add that wiring up
  Meta CAPI would make this exact instead of estimated.
- **`deal_value_partial: true` or `revenue.order_revenue == 0`** → **do not report ROAS.** It means the
  ordered leads don't carry Deal Values (even if other leads do), so revenue is unknown. Say "we can
  tell you what an order costs, not yet what it's worth" rather than printing a misleading 0.
- **`ordered_vs_roles_gap`** → how many more Meta leads are ticked `Ordered` than actually have a Role.
  A non-zero gap means the two order signals disagree; the Role link is the one to trust.
- **Cross-system order counts disagree** (Airtable vs GHL `won` vs HELM `cost_per_order`). If asked to
  reconcile, name all three and don't average — see MEMORY.md.

## Output format

Emit exactly this shape, and nothing else. Bullets are insights, lead with the headline CPA.

```
### CPA
- <insight bullet>
- <insight bullet>
(basis: all-time, source: Meta Ads × Airtable)
```

Note the footer says **basis: all-time**, not a data window — because this metric is all-time by
nature. That's intentional; the master skill pastes it verbatim.

A real example (numbers will differ each run — always use the script's current output):

```
### CPA
- True CPA is $1,314.58 per confirmed order: $26,291.59 of all-time Meta spend across 20 orders from 16 clients.
- Only 4 of those 20 orders reached a placement, so cost per revenue-earning placement is $6,572.90 — most orders paid for haven't placed.
- 12.9% of Meta leads became an order (16 of 124). Meta is the dominant order source in the base.
- The Meta ad account is currently disabled, so this is a backward-looking figure, not a live cost-per-order.
- Attribution rests on the hand-set "Source = Meta" label, not a Meta click ID — treat CPA as a close estimate, not an exact number.
- Revenue and ROAS are unavailable: none of the 16 ordered clients carry a Deal Value in Airtable, so we can say what an order costs but not yet what it's worth.
(basis: all-time, source: Meta Ads × Airtable)
```

## Not part of the weekly report

The master skill does **not** invoke this for a generic "give me this week's report" — CPA is an
all-time cross-system metric, and an all-time number doesn't belong in a weekly funnel view. It routes
here only for CPA/CAC/cost-per-order/ROAS/"are the ads profitable" questions. If Josh explicitly wants
CPA in the weekly report, that's a one-line change to the master catalog.
