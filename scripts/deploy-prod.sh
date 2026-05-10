#!/usr/bin/env bash
# =============================================================================
# deploy-prod.sh — Production deployment for WalloonWaves
# =============================================================================
#
# PREREQUISITES
#   1. AWS SSO session must be active:  aws sso login --profile admin_wms
#   2. Node.js 22+ and npm 10+ in PATH
#   3. Run from repo root:  bash scripts/deploy-prod.sh
#
# OPTIONS
#   --backend-only    Skip frontend build + S3 sync
#   --frontend-only   Skip CDK deploy
#   --with-frontend   Also deploy FrontendStack (CloudFront + S3) via CDK
#   --skip-cdk        Skip CDK deploy
#   --dry-run         Print commands without executing
#
# =============================================================================

set -euo pipefail

export AWS_PROFILE="admin_wms"
export AWS_ACCOUNT_ID="141887878254"

eval "$(aws configure export-credentials --profile "${AWS_PROFILE}" --format env 2>/dev/null)"

ENV="prod"
REGION="us-east-2"
REGION_CF="us-east-1"

WEB_BUCKET="walloon-${ENV}-web-${AWS_ACCOUNT_ID}"
CF_STACK="WalloonWaves-Frontend-${ENV}"
ENV_FILE="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}/packages/frontend/.env.production"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
ENV_FILE="${REPO_ROOT}/packages/frontend/.env.production"

source "${REPO_ROOT}/scripts/deploy-guards.sh"

# ─── Parse flags ──────────────────────────────────────────────────────────────

BACKEND_ONLY=false
FRONTEND_ONLY=false
WITH_FRONTEND=false
SKIP_CDK=false
DRY_RUN=false
SKIP_GUARDS=false
SKIP_SMOKE=false

for arg in "$@"; do
  case $arg in
    --backend-only)   BACKEND_ONLY=true ;;
    --frontend-only)  FRONTEND_ONLY=true ;;
    --with-frontend)  WITH_FRONTEND=true ;;
    --skip-cdk)       SKIP_CDK=true ;;
    --dry-run)        DRY_RUN=true ;;
    --skip-guards)    SKIP_GUARDS=true ;;
    --skip-smoke)     SKIP_SMOKE=true ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: $0 [--backend-only] [--frontend-only] [--with-frontend] [--skip-cdk] [--dry-run] [--skip-smoke]"
      exit 1
      ;;
  esac
done

DEPLOY_FRONTEND=true; $BACKEND_ONLY  && DEPLOY_FRONTEND=false
DEPLOY_BACKEND=true;  $FRONTEND_ONLY && DEPLOY_BACKEND=false
DEPLOY_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")

CDK_STACKS="WalloonWaves-Storage-${ENV} WalloonWaves-Api-${ENV}"

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

step "Pre-flight: checking AWS SSO session (PRODUCTION)"

echo ""
echo "  *** WARNING: This script deploys to the PRODUCTION environment. ***"
echo ""

if ! $DRY_RUN; then
  if ! aws sts get-caller-identity --query "Account" --output text > /dev/null 2>&1; then
    echo "ERROR: AWS credentials not found or expired for profile '${AWS_PROFILE}'."
    echo "       Run:  aws sso login --profile ${AWS_PROFILE}"
    exit 1
  fi
  echo "  ✓ AWS session active (profile: ${AWS_PROFILE})"
fi

if ! $SKIP_GUARDS && ! $DRY_RUN; then
  check_git_state "prod"
  check_dev_before_prod "$DEPLOY_FRONTEND" "$DEPLOY_BACKEND"
fi

if ! $DRY_RUN; then
  read -rp "  Proceed with PRODUCTION deploy? [y/N] " _prod_ans
  [[ "$_prod_ans" =~ ^[Yy]$ ]] || { echo "  Aborted."; exit 0; }
fi

# ─── Step 1: Build shared ─────────────────────────────────────────────────────

if ! $FRONTEND_ONLY; then
  step "Step 1/5: Build @walloon/shared"
  run npm run build -w packages/shared
fi

# ─── Step 2: CDK backend deploy ───────────────────────────────────────────────

if ! $FRONTEND_ONLY && ! $SKIP_CDK; then
  step "Step 2/5: Deploy CDK backend stacks (prod)"
  echo "  Region: ${REGION} | Profile: ${AWS_PROFILE} | Env: ${ENV}"
  echo ""
  run npm run deploy:prod:backend -w packages/infrastructure

  if $WITH_FRONTEND; then
    echo ""
    echo "  Deploying FrontendStack (CloudFront + S3)…"
    run npm run deploy:prod:frontend -w packages/infrastructure
  fi
else
  echo ""
  echo "  (Skipping CDK deploy)"
fi

# ─── Step 3: Update .env.production from live AWS outputs ─────────────────────

if ! $FRONTEND_ONLY && ! $BACKEND_ONLY; then
  step "Step 3/5: Update .env.production from AWS outputs"

  if $DRY_RUN; then
    echo "[dry-run] Would fetch API URL and update ${ENV_FILE}"
  else
    echo "  Fetching API Gateway URL from WalloonWaves-Api-${ENV} stack…"
    PROD_API_URL=$(
      aws cloudformation describe-stacks \
        --stack-name "WalloonWaves-Api-${ENV}" \
        --region "${REGION}" \
        --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
        --output text 2>/dev/null || echo ""
    )
    PROD_API_URL="${PROD_API_URL%/v1}"

    if [ -z "${PROD_API_URL}" ]; then
      echo "  WARNING: Could not auto-populate API URL. Update ${ENV_FILE} manually."
    else
      cat > "${ENV_FILE}" <<EOF
# Production environment — auto-generated by deploy-prod.sh. Do not edit manually.
VITE_API_URL=${PROD_API_URL}
EOF
      echo "  ✓ .env.production updated: API URL = ${PROD_API_URL}"
    fi
  fi
fi

# ─── Step 4: Build frontend ───────────────────────────────────────────────────

if ! $BACKEND_ONLY; then
  step "Step 4/5: Build React frontend (production)"
  run npm run build -w packages/frontend
fi

# ─── Step 5: S3 sync + CloudFront invalidation ────────────────────────────────

if ! $BACKEND_ONLY; then
  step "Step 5/5: Sync to S3 + invalidate CloudFront"

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
    --region "${REGION_CF}"

  echo "  Uploading hashed assets (cache: 1 year)…"
  run aws s3 sync \
    "${DIST_DIR}" "s3://${WEB_BUCKET}" \
    --exclude "*.html" \
    --cache-control "public, max-age=31536000, immutable" \
    --delete \
    --region "${REGION_CF}"

  if $DRY_RUN; then
    echo "[dry-run] Would invalidate CloudFront distribution from stack ${CF_STACK}"
  else
    echo "  Looking up CloudFront distribution ID from stack: ${CF_STACK}…"
    CF_DIST_ID=$(
      aws cloudformation describe-stacks \
        --stack-name "${CF_STACK}" \
        --region "${REGION_CF}" \
        --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
        --output text 2>/dev/null || echo ""
    )

    if [ -z "$CF_DIST_ID" ]; then
      echo "WARNING: Could not retrieve CloudFront distribution ID — cache NOT invalidated."
    else
      echo "  Distribution ID: ${CF_DIST_ID}"
      aws cloudfront create-invalidation \
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
  $DEPLOY_FRONTEND && write_deploy_record "prod" "frontend" "$DEPLOY_SHA"
  $DEPLOY_BACKEND  && write_deploy_record "prod" "backend"  "$DEPLOY_SHA"
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
echo "  Deploy complete! (env: ${ENV})"

if $DEPLOY_FRONTEND && ! $DRY_RUN; then
  CF_DOMAIN=$(
    aws cloudformation describe-stacks \
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
