#!/usr/bin/env bash
# =============================================================================
# deploy-dev.sh — Full dev-environment deployment for WalloonWaves
# =============================================================================
#
# PREREQUISITES
#   1. AWS SSO session must be active:  aws sso login --profile admin_wms
#   2. Node.js 22+ and npm 10+ in PATH
#   3. Run from repo root:  bash scripts/deploy-dev.sh
#
# WHAT THIS SCRIPT DOES
#   1. Builds shared package
#   2. Deploys CDK backend stacks (Storage + Api) to us-east-2
#      DnsStack and FrontendStack skipped for routine backend updates
#   3. Builds React frontend
#   4. Syncs frontend build to S3
#   5. Invalidates CloudFront cache
#
# OPTIONS
#   --backend-only    Skip steps 3-5
#   --frontend-only   Skip steps 1-2
#   --skip-cdk        Skip CDK deploy
#   --dry-run         Print commands without executing
#
# =============================================================================

set -euo pipefail

export AWS_PROFILE="admin_wms"
export AWS_ACCOUNT_ID="141887878254"

eval "$(aws configure export-credentials --profile "${AWS_PROFILE}" --format env 2>/dev/null)"

ENV="dev"
REGION="us-east-2"
REGION_CF="us-east-1"

WEB_BUCKET="walloon-${ENV}-web-${AWS_ACCOUNT_ID}"
CDK_STACKS="WalloonWaves-Storage-${ENV} WalloonWaves-Api-${ENV}"
CF_STACK="WalloonWaves-Frontend-${ENV}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source "${REPO_ROOT}/scripts/deploy-guards.sh"

# ─── Parse flags ──────────────────────────────────────────────────────────────

BACKEND_ONLY=false
FRONTEND_ONLY=false
SKIP_CDK=false
DRY_RUN=false
SKIP_GUARDS=false
SKIP_SMOKE=false

for arg in "$@"; do
  case $arg in
    --backend-only)  BACKEND_ONLY=true ;;
    --frontend-only) FRONTEND_ONLY=true ;;
    --skip-cdk)      SKIP_CDK=true ;;
    --dry-run)       DRY_RUN=true ;;
    --skip-guards)   SKIP_GUARDS=true ;;
    --skip-smoke)    SKIP_SMOKE=true ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: $0 [--backend-only] [--frontend-only] [--skip-cdk] [--dry-run] [--skip-smoke]"
      exit 1
      ;;
  esac
done

DEPLOY_FRONTEND=true; $BACKEND_ONLY  && DEPLOY_FRONTEND=false
DEPLOY_BACKEND=true;  $FRONTEND_ONLY && DEPLOY_BACKEND=false

DEPLOY_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")

# ─── Helper ───────────────────────────────────────────────────────────────────

run() {
  if $DRY_RUN; then echo "[dry-run] $*"; else echo "+ $*"; "$@"; fi
}

step() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  $1"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# ─── Pre-flight ───────────────────────────────────────────────────────────────

step "Pre-flight: checking AWS SSO session"

if ! $DRY_RUN; then
  if ! AWS_PROFILE="${AWS_PROFILE}" aws sts get-caller-identity \
      --query "Account" --output text > /dev/null 2>&1; then
    echo ""
    echo "ERROR: AWS credentials not found or expired for profile '${AWS_PROFILE}'."
    echo "       Run:  aws sso login --profile ${AWS_PROFILE}"
    exit 1
  fi
  echo "  ✓ AWS session active (profile: ${AWS_PROFILE})"
fi

if ! $SKIP_GUARDS && ! $DRY_RUN; then
  check_git_state "dev"
fi

# ─── Step 1: Build shared ─────────────────────────────────────────────────────

if ! $FRONTEND_ONLY; then
  step "Step 1/5: Build @walloon/shared"
  run npm run build -w packages/shared
fi

# ─── Step 2: CDK backend deploy ───────────────────────────────────────────────

if ! $FRONTEND_ONLY && ! $SKIP_CDK; then
  step "Step 2/5: Deploy CDK backend stacks (${CDK_STACKS})"
  echo "  Region: ${REGION} | Profile: ${AWS_PROFILE}"
  echo ""
  run npm run deploy:dev:backend -w packages/infrastructure
else
  echo ""
  echo "  (Skipping CDK deploy)"
fi

# ─── Step 3: Build frontend ───────────────────────────────────────────────────

if ! $BACKEND_ONLY; then
  step "Step 3/5: Build React frontend"
  echo "  Using --mode dev so Vite loads .env.local (dev API URL)"
  echo ""
  run npm run build:dev -w packages/frontend
fi

# ─── Step 4: S3 sync ─────────────────────────────────────────────────────────

if ! $BACKEND_ONLY; then
  step "Step 4/5: Sync build to S3 (s3://${WEB_BUCKET})"

  DIST_DIR="${REPO_ROOT}/packages/frontend/dist"

  if [ ! -d "$DIST_DIR" ] && ! $DRY_RUN; then
    echo "ERROR: Build output not found at ${DIST_DIR}"
    exit 1
  fi

  echo "  Uploading HTML files (cache: 60 s)…"
  run aws s3 sync \
    "${DIST_DIR}" "s3://${WEB_BUCKET}" \
    --exclude "*" \
    --include "*.html" \
    --cache-control "public, max-age=60" \
    --delete \
    --region "${REGION}"

  echo "  Uploading hashed assets (cache: 1 year)…"
  run aws s3 sync \
    "${DIST_DIR}" "s3://${WEB_BUCKET}" \
    --exclude "*.html" \
    --cache-control "public, max-age=31536000, immutable" \
    --delete \
    --region "${REGION}"
fi

# ─── Step 5: CloudFront invalidation ─────────────────────────────────────────

if ! $BACKEND_ONLY; then
  step "Step 5/5: Invalidate CloudFront cache"

  if $DRY_RUN; then
    echo "[dry-run] Would look up distribution ID from CloudFormation stack ${CF_STACK} (${REGION_CF})"
  else
    echo "  Looking up CloudFront distribution ID from stack: ${CF_STACK}…"
    CF_DIST_ID=$(
      AWS_PROFILE="${AWS_PROFILE}" aws cloudformation describe-stacks \
        --stack-name "${CF_STACK}" \
        --region "${REGION_CF}" \
        --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
        --output text
    )

    if [ -z "$CF_DIST_ID" ]; then
      echo ""
      echo "WARNING: Could not retrieve CloudFront distribution ID from stack ${CF_STACK}."
      echo "         CloudFront cache was NOT invalidated."
    else
      echo "  Distribution ID: ${CF_DIST_ID}"
      AWS_PROFILE="${AWS_PROFILE}" aws cloudfront create-invalidation \
        --distribution-id "${CF_DIST_ID}" \
        --paths "/*" \
        --output text \
        --query "Invalidation.Id" \
        | xargs -I{} echo "  Invalidation created: {}"
    fi
  fi
fi

# ─── Record deploy ────────────────────────────────────────────────────────────

if ! $DRY_RUN; then
  echo ""
  $DEPLOY_FRONTEND && write_deploy_record "dev" "frontend" "$DEPLOY_SHA"
  $DEPLOY_BACKEND  && write_deploy_record "dev" "backend"  "$DEPLOY_SHA"
fi

# ─── Smoke test ───────────────────────────────────────────────────────────────

if ! $SKIP_SMOKE && ! $DRY_RUN; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Post-deploy smoke test (${ENV})"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  SMOKE_EXIT=0
  bash "${REPO_ROOT}/scripts/smoke-test.sh" "${ENV}" --quiet || SMOKE_EXIT=$?
  if [[ "$SMOKE_EXIT" -ne 0 ]]; then
    echo ""
    echo "  ⚠  SMOKE TEST FAILED — deploy completed but site may be partially operational."
    echo "     Full detail:  bash scripts/smoke-test.sh ${ENV}"
    echo ""
  fi
fi

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Deploy complete!"

if ! $BACKEND_ONLY && ! $DRY_RUN; then
  CF_DOMAIN=$(
    AWS_PROFILE="${AWS_PROFILE}" aws cloudformation describe-stacks \
      --stack-name "${CF_STACK}" \
      --region "${REGION_CF}" \
      --query "Stacks[0].Outputs[?OutputKey=='DistributionDomain'].OutputValue" \
      --output text 2>/dev/null || echo ""
  )
  if [ -n "$CF_DOMAIN" ]; then
    echo "  Site:  https://${CF_DOMAIN}"
  fi
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
