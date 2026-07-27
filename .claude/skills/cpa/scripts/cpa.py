#!/usr/bin/env python3
"""
Cost-per-acquisition join: Meta ad spend vs confirmed orders in Airtable.

Deterministic. No LLM sits between the data and the number — this script does the
cross-system join and prints the metrics as JSON; the skill turns that JSON into bullets.

The join (see MEMORY.md for why each choice is what it is):
  Meta spend  ->  Airtable Leads (Source = "Meta")  ->  Airtable Roles (Lead link set) = orders
  CPA = Meta spend / count(Roles whose linked Lead has Source == "Meta")

Why all-time by default: Airtable's Leads date field is an import timestamp, not lead-arrival,
and Meta-sourced roles predate the earliest imported lead — so the order side cannot be
reliably date-windowed. All-time spend / all-time orders is the only honest basis. A window,
if given, is applied to the SPEND side only and flagged as such.

Usage:
  python cpa.py                 # all-time CPA
  python cpa.py --json          # same, explicit
Output: a single JSON object on stdout. On any failure it still prints valid JSON with
"available": false and a reason, so the skill can degrade to "- data unavailable".
"""

import os
import sys
import json
import datetime
import urllib.request
import urllib.parse
import urllib.error


# ---------- config / env ----------

def load_dotenv_if_needed(keys):
    """Fill any missing env var from a .env walking up from this file. Never overrides
    an already-set var. Safe against the inline `# comment` leftovers .env sometimes has."""
    if all(os.environ.get(k) for k in keys):
        return
    d = os.path.dirname(os.path.abspath(__file__))
    while True:
        p = os.path.join(d, ".env")
        if os.path.isfile(p):
            with open(p, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    # strip an inline " # comment" (keys/urls/tokens contain no spaces)
                    if " #" in v:
                        v = v.split(" #", 1)[0]
                    v = v.strip().strip('"').strip("'")
                    if k and v and not os.environ.get(k):
                        os.environ[k] = v
            return
        parent = os.path.dirname(d)
        if parent == d:
            return
        d = parent


def get_json(url, headers, timeout=30):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


# ---------- Meta side ----------

def meta_spend(base_url, key):
    """Returns (lifetime_spend, account_active, crm_leads_lifetime, by_month, error)."""
    h = {"x-api-key": key}
    base = base_url.rstrip("/")
    try:
        acct = get_json(f"{base}/api/v1/reporting/account", h)
        d = acct.get("data") or {}
        lifetime = float(d.get("lifetime_spend") or 0)
        active = bool(d.get("is_active"))
        # monthly breakdown for context (best-effort; not fatal if it fails)
        by_month, crm = [], None
        try:
            today = datetime.date.today().isoformat()
            ins = get_json(
                f"{base}/api/v1/reporting/insights?since=2020-01-01&until={today}"
                f"&granularity=month&level=account", h)
            rows = ins.get("data") or []
            crm = sum((r.get("crm_leads") or 0) for r in rows)
            by_month = [{"period": r.get("period"), "spend": r.get("spend"),
                         "crm_leads": r.get("crm_leads")} for r in rows]
        except Exception:
            pass
        return lifetime, active, crm, by_month, None
    except urllib.error.HTTPError as e:
        return None, None, None, [], f"meta HTTP {e.code}"
    except Exception as e:
        return None, None, None, [], f"meta unreachable: {e.__class__.__name__}"


# ---------- Airtable side ----------

def airtable_all(base_id, key, table):
    h = {"Authorization": f"Bearer {key}"}
    rows, offset = [], None
    while True:
        q = {"pageSize": "100"}
        if offset:
            q["offset"] = offset
        url = f"https://api.airtable.com/v0/{base_id}/{urllib.parse.quote(table)}?" + urllib.parse.urlencode(q)
        d = get_json(url, h)
        rows += d.get("records", [])
        offset = d.get("offset")
        if not offset:
            return rows


def compute_orders(base_id, key):
    """Join Roles -> Leads. Returns a metrics dict or raises."""
    leads = airtable_all(base_id, key, "Leads")
    roles = airtable_all(base_id, key, "Roles")
    by_id = {r["id"]: r.get("fields", {}) for r in leads}

    meta_leads = [r for r in leads if (r.get("fields", {}).get("Source") == "Meta")]
    # CAPI coverage: are the click-id fields ever populated?
    capi_present = any(
        (r.get("fields", {}).get("fbclid") or r.get("fields", {}).get("fbc"))
        for r in leads)
    # Deal value present anywhere?
    deal_value_present = any(
        (r.get("fields", {}).get("Deal Value")) for r in leads)

    # Orders = Roles whose linked Lead came from Meta
    meta_orders = 0
    distinct_meta_leads = set()
    by_status = {}
    for role in roles:
        f = role.get("fields", {})
        for lid in (f.get("Lead") or []):
            lf = by_id.get(lid)
            if lf and lf.get("Source") == "Meta":
                meta_orders += 1
                distinct_meta_leads.add(lid)
                st = f.get("Role Status") or "(none)"
                by_status[st] = by_status.get(st, 0) + 1
                break  # count each role once even if multiple leads linked

    placed = by_status.get("Placed", 0)
    # cross-check: how many Meta leads have the Ordered checkbox ticked (the field that disagrees)
    ordered_checkbox = sum(1 for r in meta_leads if r.get("fields", {}).get("Ordered"))

    # Revenue: Deal Value lives on the Lead. Sum it across the distinct Meta leads that
    # produced an order. Coverage = how many of those ordered leads actually carry a value,
    # so the skill can tell whether ROAS is complete or partial.
    order_revenue = 0.0
    ordered_leads_with_value = 0
    for lid in distinct_meta_leads:
        v = by_id.get(lid, {}).get("Deal Value")
        if v:
            order_revenue += float(v)
            ordered_leads_with_value += 1

    return {
        "total_leads": len(leads),
        "total_roles": len(roles),
        "roles_with_lead": sum(1 for r in roles if r.get("fields", {}).get("Lead")),
        "meta_leads": len(meta_leads),
        "meta_orders": meta_orders,
        "distinct_meta_leads_ordered": len(distinct_meta_leads),
        "orders_by_status": by_status,
        "placed": placed,
        "ordered_checkbox_meta": ordered_checkbox,
        "capi_present": capi_present,
        "deal_value_present": deal_value_present,
        "order_revenue": round(order_revenue, 2),
        "ordered_leads_with_value": ordered_leads_with_value,
    }


# ---------- main ----------

def main():
    needed = ["META_STATS_API_URL", "META_STATS_API_KEY", "AIRTABLE_API_KEY", "AIRTABLE_BASE_ID"]
    load_dotenv_if_needed(needed)

    missing = [k for k in needed if not os.environ.get(k)]
    if missing:
        print(json.dumps({"available": False,
                          "reason": "missing config: " + ", ".join(missing)}))
        return

    lifetime, active, crm, by_month, meta_err = meta_spend(
        os.environ["META_STATS_API_URL"], os.environ["META_STATS_API_KEY"])
    if meta_err or lifetime is None:
        print(json.dumps({"available": False,
                          "reason": meta_err or "meta spend unavailable"}))
        return

    try:
        o = compute_orders(os.environ["AIRTABLE_BASE_ID"], os.environ["AIRTABLE_API_KEY"])
    except urllib.error.HTTPError as e:
        print(json.dumps({"available": False, "reason": f"airtable HTTP {e.code}"}))
        return
    except Exception as e:
        print(json.dumps({"available": False,
                          "reason": f"airtable unreachable: {e.__class__.__name__}"}))
        return

    orders = o["meta_orders"]
    placed = o["placed"]
    result = {
        "available": True,
        "basis": "all-time",
        "meta": {
            "spend_lifetime": round(lifetime, 2),
            "account_active": active,
            "crm_leads_lifetime": crm,
            "spend_by_month": by_month,
        },
        "airtable": {
            "total_leads": o["total_leads"],
            "meta_leads": o["meta_leads"],
            "total_roles": o["total_roles"],
            "roles_with_lead": o["roles_with_lead"],
        },
        "orders": {
            "meta_orders": orders,
            "distinct_meta_leads_ordered": o["distinct_meta_leads_ordered"],
            "by_status": o["orders_by_status"],
            "placed": placed,
            "ordered_checkbox_meta": o["ordered_checkbox_meta"],
        },
        "cpa": {
            "cost_per_order": round(lifetime / orders, 2) if orders else None,
            "cost_per_placement": round(lifetime / placed, 2) if placed else None,
            "lead_to_order_pct": round(100 * o["distinct_meta_leads_ordered"] / o["meta_leads"], 1)
                                 if o["meta_leads"] else None,
        },
        "revenue": {
            "order_revenue": o["order_revenue"],
            "ordered_leads_with_value": o["ordered_leads_with_value"],
            "ordered_leads_total": o["distinct_meta_leads_ordered"],
            "roas": round(o["order_revenue"] / lifetime, 2) if lifetime else None,
            "revenue_per_order": round(o["order_revenue"] / orders, 2) if orders else None,
        },
        "caveats": {
            "capi_missing": not o["capi_present"],
            "deal_value_missing": not o["deal_value_present"],
            # ROAS is only trustworthy if most ordered leads actually carry a Deal Value
            "deal_value_partial": (o["ordered_leads_with_value"] < o["distinct_meta_leads_ordered"]),
            "account_disabled": (active is False),
            "ordered_vs_roles_gap": o["ordered_checkbox_meta"] - o["distinct_meta_leads_ordered"],
        },
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
