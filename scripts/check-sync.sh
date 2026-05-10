#!/usr/bin/env bash
# =============================================================================
# check-sync.sh — Compare deployed SHAs across local git, dev, and prod
# =============================================================================
#
# USAGE
#   bash scripts/check-sync.sh
#
# =============================================================================

set -euo pipefail

export AWS_PROFILE="admin_wms"
REGION="us-east-2"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

eval "$(aws configure export-credentials --profile "${AWS_PROFILE}" --format env 2>/dev/null)"

read_ssm() {
  local param="$1"
  aws ssm get-parameter \
    --name "$param" \
    --region "$REGION" \
    --query "Parameter.Value" \
    --output text 2>/dev/null || echo "none"
}

commits_behind() {
  local sha="$1"
  [[ "$sha" == "none" ]] && echo "?" && return
  git -C "$REPO_ROOT" rev-list "${sha}..HEAD" --count 2>/dev/null || echo "?"
}

age_of() {
  local ts="$1"
  [[ "$ts" == "none" ]] && echo "—" && return
  local epoch
  epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$ts" "+%s" 2>/dev/null \
       || date -u -d "$ts" "+%s" 2>/dev/null \
       || echo "0")
  local now; now=$(date +%s)
  local diff=$(( now - epoch ))
  if   (( diff < 120    )); then echo "${diff}s ago"
  elif (( diff < 7200   )); then echo "$(( diff / 60 ))m ago"
  elif (( diff < 172800 )); then echo "$(( diff / 3600 ))h ago"
  else                           echo "$(( diff / 86400 ))d ago"
  fi
}

status_of() {
  local sha="$1" behind="$3"
  if [[ "$sha" == "none" ]]; then echo "— never deployed"
  elif [[ "$behind" == "0" ]]; then echo "✓ current"
  else echo "⚠ ${behind} commit(s) behind HEAD"
  fi
}

LOCAL_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")
LOCAL_SHORT="${LOCAL_SHA:0:7}"
LOCAL_MSG=$(git -C "$REPO_ROOT" log -1 --format="%s" 2>/dev/null | cut -c1-55 || echo "")
LOCAL_DIRTY=$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null || true)

CURRENT_BRANCH=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "HEAD")
UPSTREAM="origin/${CURRENT_BRANCH}"
LOCAL_UNPUSHED=0
if git -C "$REPO_ROOT" rev-parse --verify "$UPSTREAM" > /dev/null 2>&1; then
  LOCAL_UNPUSHED=$(git -C "$REPO_ROOT" log "${UPSTREAM}..HEAD" --oneline 2>/dev/null \
    | wc -l | tr -d ' ')
fi

DEV_FE_SHA=$(read_ssm  "/walloon/dev/deploy/frontend/sha")
DEV_FE_PREV=$(read_ssm "/walloon/dev/deploy/frontend/prev-sha")
DEV_FE_TS=$(read_ssm   "/walloon/dev/deploy/frontend/timestamp")

DEV_BE_SHA=$(read_ssm  "/walloon/dev/deploy/backend/sha")
DEV_BE_PREV=$(read_ssm "/walloon/dev/deploy/backend/prev-sha")
DEV_BE_TS=$(read_ssm   "/walloon/dev/deploy/backend/timestamp")

PROD_FE_SHA=$(read_ssm  "/walloon/prod/deploy/frontend/sha")
PROD_FE_PREV=$(read_ssm "/walloon/prod/deploy/frontend/prev-sha")
PROD_FE_TS=$(read_ssm   "/walloon/prod/deploy/frontend/timestamp")

PROD_BE_SHA=$(read_ssm  "/walloon/prod/deploy/backend/sha")
PROD_BE_PREV=$(read_ssm "/walloon/prod/deploy/backend/prev-sha")
PROD_BE_TS=$(read_ssm   "/walloon/prod/deploy/backend/timestamp")

DEV_FE_BEHIND=$(commits_behind  "$DEV_FE_SHA")
DEV_BE_BEHIND=$(commits_behind  "$DEV_BE_SHA")
PROD_FE_BEHIND=$(commits_behind "$PROD_FE_SHA")
PROD_BE_BEHIND=$(commits_behind "$PROD_BE_SHA")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  WalloonWaves Deploy Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  LOCAL  ${LOCAL_SHORT}  \"${LOCAL_MSG}\""

[[ -n "$LOCAL_DIRTY" ]]      && echo "         ⚠ working tree has uncommitted changes"
[[ "$LOCAL_UNPUSHED" -gt 0 ]] && echo "         ⚠ ${LOCAL_UNPUSHED} commit(s) not yet pushed to origin"

echo ""
printf "  %-6s  %-10s  %-9s  %-13s  %s\n" "Env" "Scope" "SHA" "Age" "Status"
printf "  %-6s  %-10s  %-9s  %-13s  %s\n" "──────" "──────────" "─────────" "─────────────" "──────────────────────────────"

print_row() {
  local env="$1" scope="$2" sha="$3" ts="$4" behind="$5"
  local short="${sha:0:7}"; [[ "$sha" == "none" ]] && short="none"
  local age; age=$(age_of "$ts")
  local status; status=$(status_of "$sha" "$LOCAL_SHA" "$behind")
  printf "  %-6s  %-10s  %-9s  %-13s  %s\n" "$env" "$scope" "$short" "$age" "$status"
}

print_row "dev"  "frontend" "$DEV_FE_SHA"  "$DEV_FE_TS"  "$DEV_FE_BEHIND"
print_row "dev"  "backend"  "$DEV_BE_SHA"  "$DEV_BE_TS"  "$DEV_BE_BEHIND"
print_row "prod" "frontend" "$PROD_FE_SHA" "$PROD_FE_TS" "$PROD_FE_BEHIND"
print_row "prod" "backend"  "$PROD_BE_SHA" "$PROD_BE_TS" "$PROD_BE_BEHIND"

NEEDS_DEV_FE=$( [[ "$DEV_FE_BEHIND"  != "0" ]] && echo true || echo false )
NEEDS_DEV_BE=$( [[ "$DEV_BE_BEHIND"  != "0" ]] && echo true || echo false )
NEEDS_PROD_FE=$([[ "$PROD_FE_BEHIND" != "0" ]] && echo true || echo false )
NEEDS_PROD_BE=$([[ "$PROD_BE_BEHIND" != "0" ]] && echo true || echo false )

HAS_REC=false
echo ""
echo "  ─────────────────────────────────────────────────────────────────────"

if $NEEDS_DEV_FE || $NEEDS_DEV_BE; then
  HAS_REC=true
  echo "  Recommended dev deploy:"
  if $NEEDS_DEV_FE && $NEEDS_DEV_BE; then
    echo "    bash scripts/deploy-dev.sh"
  elif $NEEDS_DEV_FE; then
    echo "    bash scripts/deploy-dev.sh --frontend-only"
  else
    echo "    bash scripts/deploy-dev.sh --backend-only"
  fi
fi

if $NEEDS_PROD_FE || $NEEDS_PROD_BE; then
  HAS_REC=true
  echo "  Recommended prod deploy (after verifying dev):"
  if $NEEDS_PROD_FE && $NEEDS_PROD_BE; then
    echo "    bash scripts/deploy-prod.sh"
  elif $NEEDS_PROD_FE; then
    echo "    bash scripts/deploy-prod.sh --frontend-only"
  else
    echo "    bash scripts/deploy-prod.sh --backend-only"
  fi
fi

if ! $HAS_REC; then
  echo "  ✓ All environments are current — nothing to deploy."
fi

echo ""
echo "  Rollback targets (previous SHA per env/scope):"
printf "  %-6s  %-10s  %s\n" "Env" "Scope" "Previous SHA  →  Command"
printf "  %-6s  %-10s  %s\n" "──────" "──────────" "──────────────────────────────────────────────────────"

print_rollback_row() {
  local env="$1" scope="$2" prev_sha="$3"
  local short="${prev_sha:0:7}"; [[ "$prev_sha" == "none" ]] && short="none"
  if [[ "$prev_sha" == "none" ]]; then
    printf "  %-6s  %-10s  %s\n" "$env" "$scope" "${short}  (no prior deploy recorded)"
  else
    printf "  %-6s  %-10s  %s\n" "$env" "$scope" \
      "${short}  →  bash scripts/rollback.sh --env ${env} --scope ${scope}"
  fi
}

print_rollback_row "dev"  "frontend" "$DEV_FE_PREV"
print_rollback_row "dev"  "backend"  "$DEV_BE_PREV"
print_rollback_row "prod" "frontend" "$PROD_FE_PREV"
print_rollback_row "prod" "backend"  "$PROD_BE_PREV"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
