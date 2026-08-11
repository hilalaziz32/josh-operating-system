#!/usr/bin/env python3
"""
Reporting client for The Coordinators' candidate assessment system.

Calls this repo's own /api/v1/reporting endpoints and prints a bullet-point
summary in the shared cross-system format. Standard library only, so it runs
anywhere Python 3.8+ is installed without a pip step.

Environment:
    ASSESSMENT_REPORTING_URL   base origin, e.g. https://assesment.coordinators.pro
    ASSESSMENT_REPORTING_KEY   this system's reporting API key

Usage:
    python query.py [--window 7d] [--section report] [--assessment-id ID]
                    [--candidate-id ID] [--from DATE --to DATE] [--top N]
                    [--include-contact] [--json]
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

SYSTEM = "Candidate Assessment"
TIMEOUT_SECONDS = 20

# Sections a caller can ask for. "report" merges the four that make a briefing.
SECTIONS = ("report", "summary", "funnel", "scores", "ai", "candidates", "assessments", "health")


class Unavailable(Exception):
    """Anything that means we cannot speak for this system right now."""


# --------------------------------------------------------------------------- #
# transport                                                                    #
# --------------------------------------------------------------------------- #


def _config():
    base = (os.environ.get("ASSESSMENT_REPORTING_URL") or "").strip().rstrip("/")
    key = (os.environ.get("ASSESSMENT_REPORTING_KEY") or "").strip()
    if not base:
        raise Unavailable("ASSESSMENT_REPORTING_URL is not set")
    if not key:
        raise Unavailable("ASSESSMENT_REPORTING_KEY is not set")
    return base, key


def get(path, params=None):
    """GET one reporting endpoint and return its `data`, or raise Unavailable."""
    base, key = _config()
    query = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None})
    url = "{}/api/v1/reporting/{}{}".format(base, path.lstrip("/"), "?" + query if query else "")

    request = urllib.request.Request(url, headers={"X-API-Key": key, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # The API answers errors in the same envelope, so surface its message
        # rather than a bare status code when one is there.
        detail = ""
        try:
            body = json.loads(e.read().decode("utf-8"))
            errors = body.get("errors") or []
            if errors:
                detail = ": " + errors[0].get("message", "")
        except Exception:
            pass
        raise Unavailable("HTTP {}{}".format(e.code, detail))
    except Exception as e:
        raise Unavailable(str(e))

    if payload.get("errors"):
        raise Unavailable(payload["errors"][0].get("message", "unknown error"))
    return payload.get("data")


# --------------------------------------------------------------------------- #
# formatting helpers                                                           #
# --------------------------------------------------------------------------- #


def plural(n, singular, suffix="s"):
    return "{} {}{}".format(n, singular, "" if n == 1 else suffix)


def pct(value):
    return "n/a" if value is None else "{:g}%".format(value)


def num(value):
    if value is None:
        return "n/a"
    return "{:g}".format(value)


def direction(delta, up="up", down="down"):
    if delta > 0:
        return "{} {:g}".format(up, delta)
    if delta < 0:
        return "{} {:g}".format(down, abs(delta))
    return "flat"


def change_clause(changes, metric):
    """'up 12 from 31 (+39%)' for a metric, or '' when there is nothing to compare."""
    for c in changes or []:
        if c.get("metric") != metric:
            continue
        delta, previous, percent = c.get("delta", 0), c.get("previous", 0), c.get("percentChange")
        if delta == 0:
            return ", level with the previous period"
        piece = ", {} from {:g}".format(direction(delta), previous)
        if percent is not None:
            piece += " ({}{:g}%)".format("+" if percent > 0 else "", percent)
        return piece
    return ""


# --------------------------------------------------------------------------- #
# bullet builders, one per endpoint group                                      #
# --------------------------------------------------------------------------- #


def summary_bullets(data):
    out = []
    totals = data["totals"]
    changes = data.get("changes") or []
    attention = data.get("needsAttention") or {}

    if totals["opened"] == 0:
        out.append("no candidate activity at all in this window")
        return out

    out.append(
        "{} opened an assessment link{}; {} started and {} completed ({} completion)".format(
            plural(totals["opened"], "candidate"),
            change_clause(changes, "opened"),
            totals["started"],
            totals["completed"],
            pct(totals["completionRate"]),
        )
    )

    if totals["scored"]:
        out.append(
            "{} of {} scored candidates came out a Fit at 7.0/10 ({}), averaging {}/10{}".format(
                totals["fit"],
                totals["scored"],
                pct(totals["fitRate"]),
                num(totals["averageScore"]),
                change_clause(changes, "fit"),
            )
        )
        r = totals["ratings"]
        out.append(
            "against the customer's own rubric bands: {} pass, {} borderline, {} fail".format(
                r["pass"], r["borderline"], r["fail"]
            )
        )

    if attention.get("awaitingReview"):
        out.append(
            "{} scored and waiting on a human reviewer - the queue that needs clearing".format(
                plural(attention["awaitingReview"], "candidate")
            )
        )

    if attention.get("abandoned"):
        out.append(
            "{} started the timed test and never submitted ({} of starters abandoned)".format(
                plural(attention["abandoned"], "candidate"), pct(attention.get("abandonRate"))
            )
        )

    if totals.get("medianDurationMinutes") is not None:
        out.append(
            "median time to complete was {} minutes of the 30 allowed".format(
                num(totals["medianDurationMinutes"])
            )
        )

    by_assessment = data.get("byAssessment") or []
    if len(by_assessment) > 1:
        busiest = by_assessment[0]
        out.append(
            "busiest assessment was {} with {} opened ({} fit rate)".format(
                busiest["title"], busiest["opened"], pct(busiest.get("fitRate"))
            )
        )
    return out


def funnel_bullets(data):
    out = []
    stages = {s["key"]: s for s in data.get("stages", [])}
    if not stages or stages["opened"]["count"] == 0:
        return ["no candidates entered the funnel in this window"]

    biggest = data.get("biggestDropOff")
    if biggest and biggest.get("lost"):
        stage = stages.get(biggest["stage"], {})
        out.append(
            "biggest leak is at {}: {} lost there ({} carried through from the previous stage)".format(
                biggest["label"], biggest["lost"], pct(stage.get("conversionFromPrevious"))
            )
        )

    started = stages.get("started", {})
    if started.get("conversionFromPrevious") is not None:
        out.append(
            "{} of invited candidates actually started, and {} of those who started finished".format(
                pct(started["conversionFromPrevious"]),
                pct(stages.get("completed", {}).get("conversionFromPrevious")),
            )
        )

    if data.get("neverStarted"):
        out.append(
            "{} opened their link but never began the timed section".format(
                plural(data["neverStarted"], "candidate")
            )
        )
    return out


def scores_bullets(data):
    if not data.get("scoredSubmissions"):
        return ["nothing was scored in this window, so there is no score distribution yet"]

    out = [
        "scores centered on {}/10 (median {}), across {}".format(
            num(data["average"]), num(data["median"]), plural(data["scoredSubmissions"], "candidate")
        )
    ]

    if data.get("weakestCategory"):
        weakest = data["categoryPerformance"][0]
        out.append(
            "weakest competency across the pool is {} at {} of available points - the clearest signal for sourcing or training".format(
                weakest["category"], pct(weakest["averagePercent"])
            )
        )
    if data.get("strongestCategory") and data["strongestCategory"] != data.get("weakestCategory"):
        strongest = data["categoryPerformance"][-1]
        out.append(
            "strongest is {} at {}".format(strongest["category"], pct(strongest["averagePercent"]))
        )

    # The band immediately under the Fit line is the actionable one: these are
    # the near misses a human might reasonably rescue.
    near_miss = next((b["count"] for b in data.get("distribution", []) if b["bucket"] == "6-7"), 0)
    if near_miss:
        out.append(
            "{} landed in the 6-7 band, just under the Fit line and worth a second look".format(
                plural(near_miss, "candidate")
            )
        )

    pending = (data.get("pending") or {}).get("criteriaAwaitingHumanReview") or 0
    if pending:
        out.append(
            "caveat: {} criteria still need a human to watch the screen recording and currently count as zero, so these averages are a floor".format(
                pending
            )
        )
    return out


def ai_bullets(data):
    compared = data.get("comparedSubmissions") or 0
    if not compared:
        return []

    out = [
        "reviewers changed the AI's score on {} of {} scored candidates ({} left as-is), mean gap {} points".format(
            data.get("adjustments", 0),
            compared,
            data.get("agreements", 0),
            num(data.get("meanAbsoluteDelta")),
        )
    ]

    overrides = data.get("overrides") or {}
    generous, stricter = overrides.get("reviewerMoreGenerous", 0), overrides.get("reviewerStricter", 0)
    if generous or stricter:
        if generous > stricter * 2 and generous:
            out.append(
                "overrides run mostly upward ({} up vs {} down), which points at the grader being too harsh".format(
                    generous, stricter
                )
            )
        elif stricter > generous * 2 and stricter:
            out.append(
                "overrides run mostly downward ({} down vs {} up), which points at the grader being too generous".format(
                    stricter, generous
                )
            )

    trend = data.get("trend")
    if trend:
        out.append(
            "the AI-to-human gap is {} ({} -> {} points between the older and newer half of this window)".format(
                "narrowing" if trend["improving"] else "widening",
                num(trend["olderHalfMeanGap"]),
                num(trend["newerHalfMeanGap"]),
            )
        )
    elif data.get("trendNote"):
        out.append(data["trendNote"].lower())
    return out


def candidates_bullets(data, meta, top):
    rows = data or []
    if not rows:
        return ["no candidates matched in this window"]

    out = ["{} in the window".format(plural(meta["pagination"]["total"], "candidate"))]
    scored = [r for r in rows if r.get("normalizedScore") is not None][:top]
    for r in scored:
        out.append(
            "{}{} scored {}/10 on {} - {}{}".format(
                r["candidateName"],
                # Only ever present when the caller passed --include-contact;
                # the API omits the field entirely otherwise.
                " <{}>".format(r["candidateEmail"]) if r.get("candidateEmail") else "",
                num(r["normalizedScore"]),
                r["assessmentTitle"],
                "Fit" if r.get("isFit") else "Not a fit",
                ", already {} in RecruiterFlow".format(r["recruiterFlowDecision"])
                if r.get("recruiterFlowDecision")
                else "",
            )
        )
    if not scored:
        out.append("none of them have been scored yet")
    return out


def assessments_bullets(data):
    rows = data or []
    if not rows:
        return ["no assessments are configured"]
    out = []
    for a in rows:
        gaps = []
        if not a.get("hasInstructionsVideo"):
            gaps.append("no instructions video")
        if not a.get("hasAnswerKey"):
            gaps.append("no answer key")
        out.append(
            "{} ({}): {} lifetime, {} criteria out of {}, pass at {}{}".format(
                a["title"],
                a["role"],
                plural(a["counts"]["submissions"], "submission"),
                a["counts"]["criteria"],
                num(a["thresholds"]["maxScore"]),
                num(a["thresholds"]["passMin"]),
                " - " + ", ".join(gaps) if gaps else "",
            )
        )
    return out


def candidate_detail_bullets(data):
    out = [
        "{}{} - {} on {}, status {}".format(
            data["candidateName"],
            " <{}>".format(data["candidateEmail"]) if data.get("candidateEmail") else "",
            "{}/10".format(num(data["normalizedScore"])) if data.get("normalizedScore") is not None else "not scored",
            data["assessmentTitle"],
            data["status"],
        )
    ]
    if data.get("isFit") is not None:
        out.append("verdict: {} (rubric band: {})".format("Fit" if data["isFit"] else "Not a fit", data.get("rating")))
    if data.get("reviewerDelta"):
        out.append(
            "a reviewer moved this score {} points off the AI's {}".format(
                "{:+g}".format(data["reviewerDelta"]), num(data.get("aiScore"))
            )
        )
    weak = [c for c in (data.get("categoryPerformance") or []) if c.get("percentOfAvailable") is not None]
    if weak:
        w = weak[0]
        out.append("weakest area was {} at {}".format(w["category"], pct(w["percentOfAvailable"])))
    if data.get("pendingWarning"):
        out.append(data["pendingWarning"].lower())
    return out


def assessment_detail_bullets(data):
    perf, rubric = data["performance"], data["rubric"]
    out = [
        "{} ({}): {} opened in this window, {} completed, {} fit rate".format(
            data["title"], data["role"], perf["opened"], perf["completed"], pct(perf["fitRate"])
        ),
        "rubric is {} scored criteria worth {} points, plus {} bonus".format(
            rubric["scoredCriteria"], num(data["thresholds"]["maxScore"]), rubric["bonusCriteria"]
        ),
    ]
    screen = (rubric.get("bySource") or {}).get("screen")
    if screen:
        out.append(
            "{} of those points ({} criteria) can only be scored by a human watching the screen recording".format(
                num(screen["points"]), screen["criteria"]
            )
        )
    return out


# --------------------------------------------------------------------------- #
# assembly                                                                     #
# --------------------------------------------------------------------------- #


def render(bullets, window_label):
    lines = ["### {}".format(SYSTEM)]
    if bullets:
        # Trailing periods are stripped so bullets read uniformly once several
        # systems' output is concatenated by the master skill.
        lines.extend("- {}".format(b.strip().rstrip(".")) for b in bullets)
    else:
        lines.append("- nothing to report for this period")
    lines.append("(data window: {}, source: {})".format(window_label, SYSTEM))
    return "\n".join(lines)


def unavailable(reason=None):
    # The contract is this exact shape so a master skill merging several systems
    # can tell "nothing happened" apart from "this system did not answer".
    if reason:
        print("[{}] {}".format(SYSTEM, reason), file=sys.stderr)
    return "### {}\n- data unavailable".format(SYSTEM)


def build(args):
    window_params = {"window": args.window} if not args.date_from else {}
    if args.date_from:
        window_params = {"date_from": args.date_from, "date_to": args.date_to}
    scope = {"assessment_id": args.assessment_id} if args.assessment_id else {}
    params = dict(window_params, **scope)

    # Probe first. If this fails, nothing else is worth trying and the caller
    # gets "data unavailable" rather than a half-built report.
    get("health")

    if args.section == "health":
        health = get("health")
        return (
            [
                "system reachable, read-only surface responding",
                "{} configured, {} recorded lifetime".format(
                    plural(health["counts"]["assessments"], "assessment"),
                    plural(health["counts"]["submissions"], "submission"),
                ),
            ],
            "current",
        )

    if args.candidate_id:
        data = get("candidates/{}".format(args.candidate_id), {"include_contact": "true" if args.include_contact else None})
        return candidate_detail_bullets(data), "candidate record"

    if args.section == "assessments":
        if args.assessment_id:
            data = get("assessments/{}".format(args.assessment_id), window_params)
            return assessment_detail_bullets(data), data["window"]["label"]
        return assessments_bullets(get("assessments")), "all time"

    if args.section == "candidates":
        base, key = _config()
        query = dict(params, limit=max(args.top, 10), sort="score", order="desc")
        if args.include_contact:
            query["include_contact"] = "true"
        url = "candidates"
        # Needs meta as well as data, so this one call goes through raw.
        request = urllib.request.Request(
            "{}/api/v1/reporting/{}?{}".format(base, url, urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})),
            headers={"X-API-Key": key, "Accept": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return candidates_bullets(payload["data"], payload["meta"], args.top), payload["meta"]["filters"]["label"]

    if args.section == "summary":
        data = get("summary", params)
        return summary_bullets(data), data["window"]["label"]

    if args.section == "funnel":
        data = get("funnel", params)
        return funnel_bullets(data), data["window"]["label"]

    if args.section == "scores":
        data = get("scores", params)
        return scores_bullets(data), data["window"]["label"]

    if args.section == "ai":
        data = get("ai-vs-reviewer", params)
        return ai_bullets(data) or ["nothing scored in this window to compare against reviewers"], data["window"]["label"]

    # Default: the merged briefing.
    summary = get("summary", params)
    bullets = summary_bullets(summary)

    if summary["totals"]["opened"] > 0:
        bullets += funnel_bullets(get("funnel", params))
    if summary["totals"]["scored"] > 0:
        bullets += scores_bullets(get("scores", params))
        bullets += ai_bullets(get("ai-vs-reviewer", params))

    return bullets, summary["window"]["label"]


def main():
    parser = argparse.ArgumentParser(description="Candidate Assessment reporting")
    parser.add_argument("--window", default="7d", choices=["24h", "7d", "30d", "90d", "12m", "all"])
    parser.add_argument("--from", dest="date_from", help="ISO date, overrides --window")
    parser.add_argument("--to", dest="date_to", help="ISO date, used with --from")
    parser.add_argument("--section", default="report", choices=SECTIONS)
    parser.add_argument("--assessment-id")
    parser.add_argument("--candidate-id")
    parser.add_argument("--top", type=int, default=5, help="how many candidates to name")
    parser.add_argument("--include-contact", action="store_true", help="include candidate email addresses")
    parser.add_argument("--json", action="store_true", help="print raw JSON instead of bullets")
    args = parser.parse_args()

    if args.date_from and not args.date_to:
        args.date_to = args.date_from

    try:
        if args.json:
            params = {"window": args.window, "assessment_id": args.assessment_id}
            print(json.dumps(get("summary", params), indent=2))
            return 0
        bullets, label = build(args)
        print(render(bullets, label))
        return 0
    except Unavailable as e:
        print(unavailable(str(e)))
        return 0
    except Exception as e:  # never traceback into a report
        print(unavailable("unexpected: {}".format(e)))
        return 0


if __name__ == "__main__":
    sys.exit(main())
