---
name: meta-ads-reporting
description: Reports on Meta (Facebook/Instagram) paid-ads performance — ad spend, real lead volume, true cost-per-lead, campaign/ad-set/creative performance, wasted spend on zero-lead campaigns, audience and placement breakdowns, and performance alerts (rising CPL, CTR drops, creative fatigue). Use for any question about ad spend, cost per lead, paid-acquisition volume, which campaigns or creatives are working, or Meta ad trends over time.
---

# Meta Ads Reporting

Wraps the read-only reporting API of the **Meta Stats** system — the Meta (Facebook/Instagram) ads
dashboard for The Coordinators' recruiting funnel. It answers "how is paid acquisition doing?":
what we spent, how many real leads it produced, what each lead actually cost, which campaigns and
creatives are carrying the account, and what needs attention.

## Config

Two environment variables:

```
META_STATS_API_URL=https://<the-deployment-host>
META_STATS_API_KEY=<the repo-specific reporting key>
```

If either is missing, or the API is unreachable, output exactly:

```
### Meta Ads
- data unavailable
```

Never guess at numbers, and never error out.

## How to call it

All endpoints are `GET`, under `<META_STATS_API_URL>/api/v1/reporting/`, authenticated with an
`x-api-key` header. Every response is `{ data, meta, errors }`.

```bash
curl -s -H "x-api-key: $META_STATS_API_KEY" \
  "$META_STATS_API_URL/api/v1/reporting/summary?preset=last_7d"
```

## The one thing to get right: leads mean CRM leads

This account has **no Meta CAPI**, so Meta's pixel systematically **under-counts leads**. The real
lead source is **GoHighLevel (GHL) CRM form fills**, attributed back to a Meta campaign via UTM
parameters. The API reflects this distinction explicitly:

| Field | Meaning | Use it? |
|---|---|---|
| `crm_leads` | Real leads from the CRM | **Yes — this is "leads"** |
| `cost_per_lead` | `spend / crm_leads` — the true CPL | **Yes — this is "cost per lead"** |
| `pixel_leads` | Meta's pixel count | No — under-counts; ignore unless asked |

Never report `pixel_leads` as "leads". If `meta.crm_available` is `false`, the CRM isn't wired up —
say lead data is unavailable rather than falling back to the pixel number.

## Date windows

Every data endpoint takes either `preset` or `since`+`until`. Map the user's phrasing:

| User says | Param |
|---|---|
| "this week", "last week" (default) | `preset=last_7d` |
| "this month" | `preset=this_month` |
| "last month" | `preset=last_month` |
| "last 30 days" | `preset=last_30d` |
| "yesterday" | `preset=yesterday` |
| "last quarter", "90 days" | `preset=last_90d` |
| an explicit range | `since=YYYY-MM-DD&until=YYYY-MM-DD` |

Valid presets: `today`, `yesterday`, `last_7d`, `last_14d`, `last_30d`, `last_90d`, `this_month`,
`last_month`. Default if unspecified: `last_30d` (but for a generic "how are we doing" ask, use
`last_7d`). Rolling presets **end yesterday**, matching Meta Ads Manager — today's data is partial.
Ranges resolve in the ad account's timezone.

## Producing the report

For a general "give me the report" ask, call these three:

1. **`summary?preset=<window>`** — the main call. Returns `current` and `previous` metric bundles,
   percent `deltas`, the `funnel`, `zero_lead_campaigns`, `top_campaigns_by_spend`, and
   `best_campaigns_by_cost_per_lead`.
2. **`alerts`** — open issues. Always the trailing 7 days vs the 7 before, *regardless* of the
   requested window, so an alert can legitimately appear next to a 90-day summary.
3. **`sync-runs?limit=1`** — check `meta.hours_since_last_success`. If it's above ~36, the data is
   stale and every other number is misleading; add a bullet saying so.

Then write **insight bullets** — what changed, what's trending, what needs attention. Never dump
raw records. Cover, in roughly this order, skipping anything that isn't interesting:

- **Spend** and its change vs the prior period.
- **Real lead volume** (`crm_leads`) and its direction. Call out a falling trend explicitly.
- **True cost per lead** and its change. Flag a move of >25% in either direction — a rising CPL is
  the single most important signal in this account.
- **Wasted spend**: `zero_lead_campaigns` are campaigns that burned budget and returned nothing.
  Sum the spend and name them.
- **Best performer** worth scaling, from `best_campaigns_by_cost_per_lead`.
- **CTR decay** (`deltas.ctr_pct` down >10%) — usually creative fatigue.
- Any remaining **alerts** not already covered by the bullets above.

## Output format

Emit exactly this shape, and nothing else:

```
### Meta Ads
- <insight bullet>
- <insight bullet>
(data window: last 7 days, source: Meta Ads)
```

A real example:

```
### Meta Ads
- Spend $1,768.65 (+3.3% vs prior period, was $1,711.72)
- 19 real leads (-50.0% vs prior period, was 38) — lead volume is falling
- Cost per lead $93.09 (+106.7% vs prior period, was $45.05) — leads are getting materially more expensive
- $268.99 spent with zero leads across 1 campaign: Brand Awareness — Coordinators
- Best value: "Recruiting — Broad Prospecting" at $66.82/lead (14 leads on $935.50)
- [warning] Recruiting — Retargeting CPL rose to $158.07 (was $40.06 the prior week) — +295%
(data window: last 7 days, source: Meta Ads)
```

## Going deeper

When the question isn't covered by the summary, hit the resource endpoints directly. All take the
same date params, plus `limit` (default 50, max 500) and `offset`; `meta.pagination` carries
`total` and `has_more`.

- **`campaigns`** — per-campaign performance, each with a `score` (0–100), a `verdict`
  (`good`/`neutral`/`bad`) and human-readable `reasons`. Filter with `status`, `objective`,
  `min_spend`; sort with `sort` (`spend`, `crm_leads`, `cost_per_lead`, `ctr`, `score`, `name`) and
  `order`. Campaigns with no leads have `cost_per_lead: null` and always sort last.
- **`campaigns/{id}`** — one campaign: totals, its daily series, and its ad sets.
- **`adsets`** — filter by `campaign_id`.
- **`ads`** — creative-level performance; filter by `campaign_id` or `adset_id`. Includes
  `creative_image_url`. Use this for "which ad/creative is working best".
- **`insights`** — time series for trends. `granularity=day|week|month`; `level=account` (default)
  or `campaign`/`adset`/`ad` with `entity_id`. Real `crm_leads` are only included at account level.
- **`breakdowns`** — `dimension=age|gender|country|platform|placement|device`. **Leads here are
  pixel leads only** — the CRM can't be split by demographic, so use these for spend/impressions/CTR
  share, not lead counts.
- **`leads`** — individual CRM leads with campaign attribution, plus `meta.totals` (by status, by
  source, by campaign). **Contact details are redacted by default** (`contact: { redacted: true }`)
  — this is a reporting surface, not a contact export. Report counts and trends, not people.
- **`account`** — account name, currency, timezone, lifetime spend, sync freshness.

## Reading the numbers correctly

- **Reach over a multi-day range is approximate.** It's summed from daily rows, so someone reached
  on two days counts twice. Don't present range-level reach as an exact unique-people count.
- **`cost_per_lead: null` means zero leads, not zero cost.** Those campaigns spent money and
  returned nothing. That's a finding, not a gap.
- **Alerts use a fixed trailing-7-day window**, so they describe *now* while the summary describes
  the requested window. Both being on screen is expected, not a contradiction.
