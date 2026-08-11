#!/usr/bin/env bash
# Reports which reporting systems are configured, so a multi-system report knows up front
# which sections will come back "data unavailable".
#
# Checks env vars only. It never prints a key's value, and a "ready" system can still be
# down — the sub-skill is what actually finds that out.
#
#   bash skills/master/scripts/preflight.sh
#
# Exit code is always 0: a missing system is a fact to report, not an error to fail on.

set -u

# Load .env from the repo root if it's there, so keys don't have to be exported by hand.
# Walk up from this script rather than hardcoding a depth, so moving the skill doesn't break it.
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
while [ "$dir" != "/" ]; do
  if [ -f "$dir/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$dir/.env"
    set +a
    break
  fi
  dir="$(dirname "$dir")"
done

# system|url_var|key_var|url_optional(1 if the sub-skill has a working default)
SYSTEMS=(
  "Meta Ads|META_STATS_API_URL|META_STATS_API_KEY|0"
  "Forms Platform|FORMS_REPORTING_BASE_URL|FORMS_REPORTING_API_KEY|1"
  "Candidate Inventory|CANDIDATE_INVENTORY_API_URL|CANDIDATE_INVENTORY_API_KEY|0"
  "Screening App (Assessments)|SCREENING_API_BASE_URL|SCREENING_API_KEY|0"
  "Video Interview|SCREENING_APP_URL|SCREENING_APP_API_KEY|0"
  "HELM Ops (Signal)|HELM_OPS_BASE_URL|HELM_OPS_API_KEY|0"
  "Airtable (CPA)|AIRTABLE_BASE_ID|AIRTABLE_API_KEY|0"
  "Candidate Assessment|ASSESSMENT_REPORTING_URL|ASSESSMENT_REPORTING_KEY|0"
)

ready=0
missing=0

printf '%-30s %-10s %s\n' "SYSTEM" "STATUS" "MISSING"
printf '%-30s %-10s %s\n' "------" "------" "-------"

for entry in "${SYSTEMS[@]}"; do
  IFS='|' read -r name url_var key_var url_optional <<< "$entry"

  gaps=()
  [ -z "${!url_var:-}" ] && [ "$url_optional" != "1" ] && gaps+=("$url_var")
  [ -z "${!key_var:-}" ] && gaps+=("$key_var")

  if [ ${#gaps[@]} -eq 0 ]; then
    printf '%-30s %-10s %s\n' "$name" "ready" "-"
    ready=$((ready + 1))
  else
    joined=""
    for gap in "${gaps[@]}"; do
      [ -n "$joined" ] && joined+=", "
      joined+="$gap"
    done
    printf '%-30s %-10s %s\n' "$name" "MISSING" "$joined"
    missing=$((missing + 1))
  fi
done

echo
echo "$ready of $((ready + missing)) systems configured."
if [ "$missing" -gt 0 ]; then
  echo "Systems marked MISSING will return '- data unavailable'. Report the rest anyway."
fi
