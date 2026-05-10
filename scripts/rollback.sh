#!/usr/bin/env bash
# =============================================================================
# rollback.sh — Roll back dev or prod to the previously deployed SHA
# =============================================================================
#
# USAGE
#   bash scripts/rollback.sh --env <dev|prod> --scope <frontend|backend|full>
#
# =============================================================================

set -euo pipefail

export AWS_PROFILE="admin_wms"
export AWS_ACCOUNT_ID="141887878254"
REGION="us-east-2"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

eval "$(aws configure export-credentials --profile "${AWS_PROFILE}" --format env 2>/dev/null)"

ENV=""
SCOPE=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env=*)    ENV="${1#*=}" ;;
    --env)      shift; ENV="$1" ;;
    --scope=*)  SCOPE="${1#*=}" ;;
    --scope)    shift; SCOPE="$1" ;;
    --dry-run)  DRY_RUN=true ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 --env <dev|prod> --scope <frontend|backend|full> [--dry-run]"
      exit 1
      ;;
  esac
  shift
done

if [[ -z "$ENV" ]] || [[ -z "$SCOPE" ]]; then
  echo ""
  echo "  Usage: $0 --env <dev|prod> --scope <frontend|backend|full> [--dry-run]"
  exit 1
fi

if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
  echo "  Error: --env must be dev or prod"; exit 1
fi

if [[ "$SCOPE" != "frontend" && "$SCOPE" != "backend" && "$SCOPE" != "full" ]]; then
  echo "  Error: --scope must be frontend, backend, or full"; exit 1
fi

read_ssm() {
  aws ssm get-parameter \
    --name "$1" \
    --region "$REGION" \
    --query "Parameter.Value" \
    --output text 2>/dev/null || echo "none"
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  WalloonWaves Rollback — env: ${ENV}  scope: ${SCOPE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

ROLLBACK_SHA=""
CURRENT_FE_SHA="none"; CURRENT_BE_SHA="none"
PREV_FE_SHA="none";    PREV_BE_SHA="none"

if [[ "$SCOPE" == "frontend" || "$SCOPE" == "full" ]]; then
  CURRENT_FE_SHA=$(read_ssm "/walloon/${ENV}/deploy/frontend/sha")
  PREV_FE_SHA=$(read_ssm    "/walloon/${ENV}/deploy/frontend/prev-sha")
fi

if [[ "$SCOPE" == "backend" || "$SCOPE" == "full" ]]; then
  CURRENT_BE_SHA=$(read_ssm "/walloon/${ENV}/deploy/backend/sha")
  PREV_BE_SHA=$(read_ssm    "/walloon/${ENV}/deploy/backend/prev-sha")
fi

if [[ "$SCOPE" == "full" ]]; then
  if [[ "$PREV_FE_SHA" == "none" && "$PREV_BE_SHA" == "none" ]]; then
    echo "  ✗  No previous deploy recorded for ${ENV} (full scope)."; exit 1
  fi
  if [[ "$PREV_FE_SHA" != "$PREV_BE_SHA" && "$PREV_FE_SHA" != "none" && "$PREV_BE_SHA" != "none" ]]; then
    echo "  ⚠  Frontend and backend have different previous SHAs:"
    echo "     frontend: ${PREV_FE_SHA:0:7}   backend: ${PREV_BE_SHA:0:7}"
    echo "  Use --scope frontend or --scope backend to roll back independently."
    exit 1
  fi
  ROLLBACK_SHA="${PREV_FE_SHA}"; [[ "$ROLLBACK_SHA" == "none" ]] && ROLLBACK_SHA="${PREV_BE_SHA}"
elif [[ "$SCOPE" == "frontend" ]]; then
  ROLLBACK_SHA="$PREV_FE_SHA"
else
  ROLLBACK_SHA="$PREV_BE_SHA"
fi

if [[ "$ROLLBACK_SHA" == "none" ]]; then
  echo "  ✗  No previous ${SCOPE} deploy recorded for ${ENV}."; exit 1
fi

if ! git -C "$REPO_ROOT" rev-parse --verify "${ROLLBACK_SHA}" > /dev/null 2>&1; then
  echo "  ✗  SHA ${ROLLBACK_SHA:0:7} is not in local git history."
  echo "     Run 'git fetch origin' and try again."; exit 1
fi

ROLLBACK_MSG=$(git -C "$REPO_ROOT" log -1 --format="%s" "$ROLLBACK_SHA" 2>/dev/null | cut -c1-60 || echo "")

echo "  Rolling back ${ENV} / ${SCOPE}:"
echo ""
[[ "$SCOPE" == "frontend" || "$SCOPE" == "full" ]] && echo "    frontend: ${CURRENT_FE_SHA:0:7} → ${PREV_FE_SHA:0:7}"
[[ "$SCOPE" == "backend"  || "$SCOPE" == "full" ]] && echo "    backend:  ${CURRENT_BE_SHA:0:7} → ${PREV_BE_SHA:0:7}"
echo ""
echo "  Target commit: ${ROLLBACK_SHA:0:7}  \"${ROLLBACK_MSG}\""
echo ""

if $DRY_RUN; then
  echo "  [dry-run] Would check out ${ROLLBACK_SHA:0:7} and deploy to ${ENV}."; exit 0
fi

read -rp "  Proceed with rollback? [y/N] " _rb_ans
[[ "$_rb_ans" =~ ^[Yy]$ ]] || { echo "  Aborted."; echo ""; exit 0; }

STASHED=false

cleanup() {
  local exit_code=$?
  local branch
  branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "HEAD")
  if [[ "$branch" == "HEAD" ]]; then
    echo ""
    echo "  Returning to master branch…"
    git -C "$REPO_ROOT" checkout master 2>/dev/null || true
  fi
  if $STASHED; then
    echo "  Restoring stashed changes…"
    git -C "$REPO_ROOT" stash pop 2>/dev/null \
      || echo "  ⚠  Stash pop failed — run 'git stash pop' manually."
  fi
  [[ $exit_code -ne 0 ]] && echo "" && echo "  ✗  Rollback did not complete cleanly (exit ${exit_code})."
}
trap cleanup EXIT

DIRTY=$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null || true)
if [[ -n "$DIRTY" ]]; then
  echo "  Stashing uncommitted changes…"
  git -C "$REPO_ROOT" stash push -m "rollback stash $(date +%Y%m%d-%H%M%S)"
  STASHED=true
fi

echo "  Checking out ${ROLLBACK_SHA:0:7}…"
git -C "$REPO_ROOT" checkout --detach "$ROLLBACK_SHA"

echo ""
echo "  Deploying ${ROLLBACK_SHA:0:7} to ${ENV}…"
echo ""

DEPLOY_SCRIPT="${REPO_ROOT}/scripts/deploy-${ENV}.sh"
DEPLOY_FLAGS="--skip-guards"
case "$SCOPE" in
  frontend)  DEPLOY_FLAGS+=" --frontend-only" ;;
  backend)   DEPLOY_FLAGS+=" --backend-only" ;;
  full)      : ;;
esac

# shellcheck disable=SC2086
bash "$DEPLOY_SCRIPT" $DEPLOY_FLAGS

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Rollback complete: ${ENV}/${SCOPE} is now at ${ROLLBACK_SHA:0:7}"
echo "  Run check-sync.sh to confirm."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
