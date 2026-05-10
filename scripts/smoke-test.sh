#!/usr/bin/env bash
# =============================================================================
# smoke-test.sh — Post-deploy smoke test for WalloonWaves
# =============================================================================
#
# USAGE
#   bash scripts/smoke-test.sh [dev|prod] [--quiet]
#
# WHAT IT CHECKS
#   [S1] AWS auth
#   [A1] CloudFront site reachable
#   [H1] GET /health returns 200
#
# =============================================================================

set -euo pipefail

export AWS_PROFILE="admin_wms"
REGION="us-east-2"
REGION_CF="us-east-1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV="dev"
QUIET=false

while [[ $# -gt 0 ]]; do
  case $1 in
    dev|prod)  ENV="$1";    shift ;;
    --quiet)   QUIET=true;  shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

eval "$(aws configure export-credentials --profile "${AWS_PROFILE}" --format env 2>/dev/null)"

PASS=0; FAIL=0
declare -a FAILURES=()

check() {
  local id="$1" desc="$2"
  shift 2
  if "$@" > /dev/null 2>&1; then
    PASS=$(( PASS + 1 ))
    $QUIET || printf "  [%s] ✓  %s\n" "$id" "$desc"
  else
    FAIL=$(( FAIL + 1 ))
    FAILURES+=("[$id] $desc")
    printf "  [%s] ✗  %s\n" "$id" "$desc"
  fi
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  WalloonWaves smoke test — env: ${ENV}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# [S1] AWS auth
check "S1" "AWS session active" aws sts get-caller-identity

# Fetch API URL from SSM
API_URL=$(aws ssm get-parameter \
  --name "/walloon/${ENV}/api/url" \
  --region "$REGION" \
  --query "Parameter.Value" --output text 2>/dev/null || echo "")

# Fetch CloudFront domain
CF_DOMAIN=$(aws cloudformation describe-stacks \
  --stack-name "WalloonWaves-Frontend-${ENV}" \
  --region "$REGION_CF" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomain'].OutputValue" \
  --output text 2>/dev/null || echo "")

# [A1] Site reachable
if [ -n "$CF_DOMAIN" ]; then
  check "A1" "CloudFront site reachable (${CF_DOMAIN})" \
    curl -sf --max-time 10 "https://${CF_DOMAIN}/" -o /dev/null
else
  FAIL=$(( FAIL + 1 )); FAILURES+=("[A1] CloudFront domain not found in stack outputs")
  echo "  [A1] ✗  CloudFront domain not found in stack outputs"
fi

# [H1] Health endpoint
if [ -n "$API_URL" ]; then
  check "H1" "GET /health returns 200" \
    curl -sf --max-time 10 "${API_URL}v1/health" -o /dev/null
else
  FAIL=$(( FAIL + 1 )); FAILURES+=("[H1] API URL not found in SSM")
  echo "  [H1] ✗  API URL not found in SSM (/walloon/${ENV}/api/url)"
fi

echo ""
echo "  ─────────────────────────────────────────────────────────────────────"
printf "  %d passed, %d failed\n" "$PASS" "$FAIL"

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do echo "    $f"; done
  echo ""
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
