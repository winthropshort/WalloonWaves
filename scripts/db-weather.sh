#!/usr/bin/env bash
# =============================================================================
# db-weather.sh — Query WalloonWaves DynamoDB weather data
# =============================================================================
#
# USAGE
#   bash scripts/db-weather.sh <command> [args] [--env dev|prod]
#
# COMMANDS
#   recent [N]          Last N observations (default 12) — proves ingest is working
#   today               All of today's observations (UTC)
#   date YYYY-MM-DD     Observations for a specific date
#   stats               Item counts, date range, and time since last fetch
#   trigger             Manually invoke WeatherIngest Lambda right now
#
# EXAMPLES
#   bash scripts/db-weather.sh recent          # last 12 observations
#   bash scripts/db-weather.sh recent 24       # last 24 observations
#   bash scripts/db-weather.sh today           # today's data (UTC)
#   bash scripts/db-weather.sh date 2026-05-10 # specific date
#   bash scripts/db-weather.sh stats           # table health + freshness
#   bash scripts/db-weather.sh trigger         # force immediate NWS fetch
#   bash scripts/db-weather.sh recent --env prod
#
# PREREQUISITES
#   • AWS SSO session:  aws sso login --profile admin_wms
#   • jq installed:     brew install jq
#
# =============================================================================

set -euo pipefail

export AWS_PROFILE="admin_wms"
export AWS_ACCOUNT_ID="141887878254"
REGION="us-east-2"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ─── Parse flags ──────────────────────────────────────────────────────────────

ENV="dev"
CMD=""
ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env=*) ENV="${1#*=}"; shift ;;
    --env)   shift; ENV="$1"; shift ;;
    -*)      echo "Unknown option: $1" >&2; exit 1 ;;
    *)
      if [[ -z "$CMD" ]]; then CMD="$1"
      elif [[ -z "$ARG" ]]; then ARG="$1"
      fi
      shift ;;
  esac
done

if [[ -z "$CMD" ]]; then
  echo ""
  echo "  Usage: bash scripts/db-weather.sh <command> [args] [--env dev|prod]"
  echo ""
  echo "  Commands:"
  echo "    recent [N]          Last N observations (default 12)"
  echo "    today               All of today's observations (UTC)"
  echo "    date YYYY-MM-DD     Observations for a specific date"
  echo "    stats               Item counts, date range, last fetch time"
  echo "    trigger             Manually invoke WeatherIngest Lambda now"
  echo ""
  exit 1
fi

TABLE="walloon-${ENV}-main"
FUNCTION="walloon-${ENV}-weather-ingest"

# ─── AWS auth ─────────────────────────────────────────────────────────────────

eval "$(aws configure export-credentials --profile "${AWS_PROFILE}" --format env 2>/dev/null)"

if ! aws sts get-caller-identity --query "Account" --output text > /dev/null 2>&1; then
  echo ""
  echo "  ERROR: AWS credentials not found or expired."
  echo "         Run:  aws sso login --profile ${AWS_PROFILE}"
  exit 1
fi

# ─── Check jq ─────────────────────────────────────────────────────────────────

if ! command -v jq &> /dev/null; then
  echo ""
  echo "  ERROR: jq is required but not installed."
  echo "         Run:  brew install jq"
  exit 1
fi

# ─── Colors ───────────────────────────────────────────────────────────────────

BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'
GREEN='\033[32m'; YELLOW='\033[33m'; ORANGE='\033[38;5;208m'; RED='\033[31m'; CYAN='\033[36m'

# ─── Helpers ──────────────────────────────────────────────────────────────────

# Format a UTC ISO timestamp to local Detroit time (short form)
fmt_time() {
  local iso="$1"
  # Use TZ to format in America/Detroit (macOS date -j)
  local epoch
  epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "${iso:0:19}" "+%s" 2>/dev/null \
       || date -u -d "${iso:0:19}" "+%s" 2>/dev/null || echo "0")
  TZ="America/Detroit" date -r "$epoch" "+%a %b %-d %-I:%M %p" 2>/dev/null \
    || date -d "@$epoch" -u "+%a %b %-d %H:%M UTC"
}

# Color-code wind speed
wind_color() {
  local mph="$1"
  if   (( mph < 10 )); then echo -n "$GREEN"
  elif (( mph < 20 )); then echo -n "$YELLOW"
  elif (( mph < 30 )); then echo -n "$ORANGE"
  else                      echo -n "$RED"
  fi
}

# Age of a UTC ISO timestamp in human-readable form
age_of_iso() {
  local iso="$1"
  local epoch
  epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "${iso:0:19}" "+%s" 2>/dev/null \
       || date -u -d "${iso:0:19}" "+%s" 2>/dev/null || echo "0")
  local now; now=$(date +%s)
  local diff=$(( now - epoch ))
  if   (( diff < 0    )); then echo "in the future"
  elif (( diff < 120  )); then echo "${diff}s ago"
  elif (( diff < 7200 )); then echo "$(( diff / 60 ))m ago"
  else                         echo "$(( diff / 3600 ))h ago"
  fi
}

# Query DynamoDB and return items JSON array for a given PK + optional SK prefix
query_date() {
  local date_str="$1"
  local sk_min="${2:-OBS#}"
  local sk_max="${3:-OBS#z}"  # 'z' > any digit or letter in ASCII

  aws dynamodb query \
    --table-name "$TABLE" \
    --region "$REGION" \
    --key-condition-expression 'PK = :pk AND SK BETWEEN :skMin AND :skMax' \
    --expression-attribute-values \
      "{\":pk\":{\"S\":\"WEATHER#${date_str}\"},\":skMin\":{\"S\":\"${sk_min}\"},\":skMax\":{\"S\":\"${sk_max}\"}}" \
    --scan-index-forward true \
    --output json 2>/dev/null \
  | jq '[.Items[] | {
      timestamp:     .timestamp.S,
      windSpeed_mph: (.windSpeed_mph.N | tonumber),
      windGust_mph:  (.windGust_mph.N  | tonumber),
      windDir_label: .windDir_label.S,
      windDir_deg:   (.windDir_deg.N   | if . then tonumber else null end),
      shortForecast: .shortForecast.S,
      fetchedAt:     .fetchedAt.S
    }]'
}

# Print a formatted table of items
print_table() {
  local items="$1"
  local count; count=$(echo "$items" | jq 'length')

  if [[ "$count" -eq 0 ]]; then
    echo ""
    echo -e "  ${DIM}No observations found.${RESET}"
    echo ""
    return
  fi

  printf "\n"
  printf "  ${BOLD}%-24s  %-11s  %-7s  %-5s  %-5s  %-22s  %-10s${RESET}\n" \
    "Time (Detroit)" "Wind (mph)" "Gust" "Dir" "Deg" "Forecast" "Fetched"
  printf "  ${DIM}%-24s  %-11s  %-7s  %-5s  %-5s  %-22s  %-10s${RESET}\n" \
    "────────────────────────" "───────────" "───────" "─────" "─────" "──────────────────────" "──────────"

  echo "$items" | jq -r '.[] | [
    .timestamp,
    (.windSpeed_mph | tostring),
    (.windGust_mph  | tostring),
    .windDir_label,
    (if .windDir_deg then (.windDir_deg | tostring) else "—" end),
    .shortForecast,
    .fetchedAt
  ] | @tsv' | while IFS=$'\t' read -r ts spd gust dir deg fc fetched; do
    local time_fmt; time_fmt=$(fmt_time "$ts")
    local color; color=$(wind_color "$spd")
    local fetch_age; fetch_age=$(age_of_iso "$fetched")
    # Truncate forecast to 22 chars
    local fc_short="${fc:0:22}"
    printf "  %-24s  ${color}${BOLD}%-5s mph${RESET}   ${DIM}%-5s${RESET}  %-5s  %-5s  %-22s  ${DIM}%s${RESET}\n" \
      "$time_fmt" "$spd" "g${gust}" "$dir" "$deg" "$fc_short" "$fetch_age"
  done

  echo ""
  echo -e "  ${DIM}${count} observation(s)${RESET}"
  echo ""
}

# ─── Commands ─────────────────────────────────────────────────────────────────

case "$CMD" in

# ── recent ────────────────────────────────────────────────────────────────────
recent)
  N="${ARG:-12}"
  if ! [[ "$N" =~ ^[0-9]+$ ]] || (( N < 1 || N > 200 )); then
    echo "  ERROR: N must be a number between 1 and 200" >&2; exit 1
  fi

  echo ""
  echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  ${BOLD}WalloonWaves — Last ${N} Observations  ${DIM}[${ENV}]${RESET}"
  echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Collect items across today + yesterday, then take the last N
  now=$(date -u +"%Y-%m-%d")
  yesterday=$(date -u -v-1d +"%Y-%m-%d" 2>/dev/null || date -u -d "yesterday" +"%Y-%m-%d")

  items_today=$(query_date "$now")
  items_yesterday=$(query_date "$yesterday")

  # Merge, sort by SK descending, take N, then re-sort ascending for display
  combined=$(jq -n \
    --argjson a "$items_today" \
    --argjson b "$items_yesterday" \
    --argjson n "$N" \
    '($a + $b) | sort_by(.timestamp) | reverse | .[0:$n] | reverse')

  print_table "$combined"
  ;;

# ── today ─────────────────────────────────────────────────────────────────────
today)
  today=$(date -u +"%Y-%m-%d")
  echo ""
  echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  ${BOLD}WalloonWaves — Today's Observations  ${DIM}[${ENV} · ${today} UTC]${RESET}"
  echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  items=$(query_date "$today")
  print_table "$items"
  ;;

# ── date ──────────────────────────────────────────────────────────────────────
date)
  if [[ -z "$ARG" ]]; then
    echo "  Usage: bash scripts/db-weather.sh date YYYY-MM-DD" >&2; exit 1
  fi
  if ! [[ "$ARG" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "  ERROR: date must be in YYYY-MM-DD format" >&2; exit 1
  fi
  echo ""
  echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  ${BOLD}WalloonWaves — Observations for ${ARG}  ${DIM}[${ENV}]${RESET}"
  echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  items=$(query_date "$ARG")
  print_table "$items"
  ;;

# ── stats ─────────────────────────────────────────────────────────────────────
stats)
  echo ""
  echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  ${BOLD}WalloonWaves — Table Stats  ${DIM}[${ENV}]${RESET}"
  echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Today + yesterday + 6 more days back
  today=$(date -u +"%Y-%m-%d")
  total=0
  earliest=""
  latest=""
  last_fetched_at=""

  echo -e "  ${BOLD}Date (UTC)       Items   Freshness${RESET}"
  echo -e "  ${DIM}───────────────  ──────  ──────────────────────────────${RESET}"

  for i in 0 1 2 3 4 5 6 7; do
    d=$(date -u -v-${i}d +"%Y-%m-%d" 2>/dev/null \
     || date -u -d "${i} days ago" +"%Y-%m-%d")

    result=$(aws dynamodb query \
      --table-name "$TABLE" \
      --region "$REGION" \
      --key-condition-expression 'PK = :pk' \
      --expression-attribute-values "{\":pk\":{\"S\":\"WEATHER#${d}\"}}" \
      --select COUNT \
      --output json 2>/dev/null)

    count=$(echo "$result" | jq '.Count // 0')
    total=$(( total + count ))

    if [[ "$count" -gt 0 ]]; then
      # Get the most recent item for this date to check fetchedAt
      row=$(aws dynamodb query \
        --table-name "$TABLE" \
        --region "$REGION" \
        --key-condition-expression 'PK = :pk' \
        --expression-attribute-values "{\":pk\":{\"S\":\"WEATHER#${d}\"}}" \
        --scan-index-forward false \
        --limit 1 \
        --output json 2>/dev/null \
        | jq -r '.Items[0] | "\(.SK.S)\t\(.fetchedAt.S)"')

      sk=$(echo "$row" | cut -f1)
      fa=$(echo "$row" | cut -f2)

      if [[ -z "$latest" ]]; then latest="${sk#OBS#}"; last_fetched_at="$fa"; fi
      earliest="${sk#OBS#}"
      freshness="fetched $(age_of_iso "$fa")"

      printf "  %-15s  ${CYAN}%-6s${RESET}  ${DIM}%s${RESET}\n" "$d" "$count" "$freshness"
    else
      printf "  %-15s  ${DIM}%-6s  —${RESET}\n" "$d" "0"
    fi
  done

  echo ""
  echo -e "  ${BOLD}Total items (8 days):${RESET}  ${CYAN}${total}${RESET}"

  if [[ -n "$earliest" ]]; then
    echo -e "  ${BOLD}Earliest observation:${RESET} $(fmt_time "$earliest")"
    echo -e "  ${BOLD}Latest observation:${RESET}   $(fmt_time "$latest")"
    echo -e "  ${BOLD}Last NWS fetch:${RESET}       $(age_of_iso "$last_fetched_at")"
  else
    echo -e "  ${DIM}No observations found in the last 8 days.${RESET}"
    echo ""
    echo -e "  ${YELLOW}⚠  The WeatherIngest Lambda may not have run yet.${RESET}"
    echo -e "     Run:  bash scripts/db-weather.sh trigger"
  fi

  # EventBridge rule status
  echo ""
  echo -e "  ${BOLD}EventBridge rule:${RESET}"
  rule_state=$(aws events describe-rule \
    --name "walloon-${ENV}-weather-ingest" \
    --region "$REGION" \
    --query "State" \
    --output text 2>/dev/null || echo "NOT_FOUND")

  if [[ "$rule_state" == "ENABLED" ]]; then
    echo -e "    ${GREEN}✓ walloon-${ENV}-weather-ingest — ENABLED (rate 4h)${RESET}"
  elif [[ "$rule_state" == "DISABLED" ]]; then
    echo -e "    ${YELLOW}⚠ walloon-${ENV}-weather-ingest — DISABLED${RESET}"
  else
    echo -e "    ${DIM}walloon-${ENV}-weather-ingest — ${rule_state}${RESET}"
  fi

  echo ""
  echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  ;;

# ── trigger ───────────────────────────────────────────────────────────────────
trigger)
  echo ""
  echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  ${BOLD}WeatherIngest — manual trigger  ${DIM}[${ENV}]${RESET}"
  echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo -e "  Invoking ${CYAN}${FUNCTION}${RESET} synchronously…"
  echo ""

  RESULT=$(aws lambda invoke \
    --function-name "$FUNCTION" \
    --region "$REGION" \
    --payload '{}' \
    --log-type Tail \
    --output json \
    /tmp/walloon-ingest-response.json 2>/dev/null)

  STATUS=$(echo "$RESULT" | jq -r '.StatusCode // 0')
  LOG_B64=$(echo "$RESULT" | jq -r '.LogResult // ""')

  if [[ "$STATUS" -eq 200 ]]; then
    echo -e "  ${GREEN}${BOLD}✓ Lambda returned HTTP ${STATUS}${RESET}"
  else
    echo -e "  ${RED}${BOLD}✗ Lambda returned HTTP ${STATUS}${RESET}"
  fi

  # Tail logs (base64-decoded)
  if [[ -n "$LOG_B64" ]]; then
    echo ""
    echo -e "  ${BOLD}Lambda log tail:${RESET}"
    echo -e "  ${DIM}────────────────────────────────────────────────────────────────────${RESET}"
    echo "$LOG_B64" | base64 --decode | grep -v '^$' | while IFS= read -r line; do
      echo "  $line"
    done
    echo -e "  ${DIM}────────────────────────────────────────────────────────────────────${RESET}"
  fi

  # Show response payload
  if [[ -f /tmp/walloon-ingest-response.json ]]; then
    PAYLOAD=$(cat /tmp/walloon-ingest-response.json)
    if [[ "$PAYLOAD" != "null" && -n "$PAYLOAD" ]]; then
      echo ""
      echo -e "  ${BOLD}Response payload:${RESET} ${DIM}${PAYLOAD}${RESET}"
    fi
  fi

  echo ""
  echo -e "  ${DIM}Wait a moment then run:  bash scripts/db-weather.sh recent 3${RESET}"
  echo ""
  echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  ;;

*)
  echo "  Unknown command: ${CMD}" >&2
  echo "  Run without arguments for usage." >&2
  exit 1
  ;;
esac
