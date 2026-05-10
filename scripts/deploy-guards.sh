#!/usr/bin/env bash
# =============================================================================
# deploy-guards.sh — Shared guard functions for deploy-dev.sh / deploy-prod.sh
# =============================================================================
#
# SOURCE THIS FILE; do not execute it directly.
#   source "${REPO_ROOT}/scripts/deploy-guards.sh"
#
# REQUIRES (from the calling script's environment)
#   REPO_ROOT  — absolute path to the repository root
#   REGION     — AWS region for SSM (us-east-2)
#
# PROVIDES
#   check_git_state ENV
#   check_dev_before_prod DEPLOY_FRONTEND DEPLOY_BACKEND
#   write_deploy_record ENV SCOPE SHA
#
# =============================================================================

check_git_state() {
  local env="$1"

  local dirty
  dirty=$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null || true)

  if [[ -n "$dirty" ]]; then
    echo ""
    if [[ "$env" == "prod" ]]; then
      echo "  ✗  BLOCKED — uncommitted changes in working tree."
      echo "     Commit or stash your changes before deploying to prod."
      echo ""
      git -C "$REPO_ROOT" status --short
      echo ""
      exit 1
    else
      echo "  ⚠  WARNING — working tree has uncommitted changes."
      echo ""
      git -C "$REPO_ROOT" status --short
      echo ""
      read -rp "  Continue deploying to dev with uncommitted changes? [y/N] " _gg_ans
      [[ "$_gg_ans" =~ ^[Yy]$ ]] || { echo "  Aborted."; exit 0; }
    fi
  fi

  local current_branch
  current_branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "HEAD")

  local upstream="origin/${current_branch}"
  if ! git -C "$REPO_ROOT" rev-parse --verify "$upstream" > /dev/null 2>&1; then
    return
  fi

  local unpushed
  unpushed=$(git -C "$REPO_ROOT" log "${upstream}..HEAD" --oneline 2>/dev/null \
    | wc -l | tr -d ' ')

  if [[ "$unpushed" -gt 0 ]]; then
    echo ""
    if [[ "$env" == "prod" ]]; then
      echo "  ✗  BLOCKED — ${unpushed} unpushed commit(s) not yet in origin."
      echo "     Push to origin before deploying to prod."
      echo ""
      git -C "$REPO_ROOT" log "${upstream}..HEAD" --oneline
      echo ""
      exit 1
    else
      echo "  ⚠  WARNING — ${unpushed} unpushed commit(s) not yet in origin."
      echo ""
      git -C "$REPO_ROOT" log "${upstream}..HEAD" --oneline | head -8
      echo ""
      read -rp "  Continue deploying to dev with unpushed commits? [y/N] " _gg_ans
      [[ "$_gg_ans" =~ ^[Yy]$ ]] || { echo "  Aborted."; exit 0; }
    fi
  fi
}

check_dev_before_prod() {
  local deploy_frontend="$1"
  local deploy_backend="$2"

  local target_sha
  target_sha=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")

  local issues=()

  if [[ "$deploy_frontend" == "true" ]]; then
    local dev_fe_sha
    dev_fe_sha=$(aws ssm get-parameter \
      --name "/walloon/dev/deploy/frontend/sha" \
      --region "$REGION" \
      --query "Parameter.Value" --output text 2>/dev/null || echo "none")

    if [[ "$dev_fe_sha" != "$target_sha" ]]; then
      issues+=("  frontend : dev has ${dev_fe_sha:0:7}   target ${target_sha:0:7}")
    fi
  fi

  if [[ "$deploy_backend" == "true" ]]; then
    local dev_be_sha
    dev_be_sha=$(aws ssm get-parameter \
      --name "/walloon/dev/deploy/backend/sha" \
      --region "$REGION" \
      --query "Parameter.Value" --output text 2>/dev/null || echo "none")

    if [[ "$dev_be_sha" != "$target_sha" ]]; then
      issues+=("  backend  : dev has ${dev_be_sha:0:7}   target ${target_sha:0:7}")
    fi
  fi

  if [[ ${#issues[@]} -gt 0 ]]; then
    echo ""
    echo "  ⚠  Dev is not running the SHA you are about to deploy to prod:"
    echo ""
    for issue in "${issues[@]}"; do echo "$issue"; done
    echo ""
    echo "  Best practice: deploy to dev first and verify, then promote to prod."
    echo "  Run:  bash scripts/deploy-dev.sh [--frontend-only|--backend-only]"
    echo ""
    read -rp "  Deploy to prod without dev verification? [y/N] " _cdp_ans
    [[ "$_cdp_ans" =~ ^[Yy]$ ]] || { echo "  Aborted."; exit 0; }
  fi
}

write_deploy_record() {
  local env="$1"
  local scope="$2"
  local sha="$3"

  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  local current_sha
  current_sha=$(aws ssm get-parameter \
    --name "/walloon/${env}/deploy/${scope}/sha" \
    --region "$REGION" \
    --query "Parameter.Value" --output text 2>/dev/null || echo "none")

  aws ssm put-parameter \
    --name "/walloon/${env}/deploy/${scope}/prev-sha" \
    --value "$current_sha" \
    --type String --overwrite \
    --region "$REGION" > /dev/null

  aws ssm put-parameter \
    --name "/walloon/${env}/deploy/${scope}/sha" \
    --value "$sha" \
    --type String --overwrite \
    --region "$REGION" > /dev/null

  aws ssm put-parameter \
    --name "/walloon/${env}/deploy/${scope}/timestamp" \
    --value "$now" \
    --type String --overwrite \
    --region "$REGION" > /dev/null

  echo "  ✓ Recorded ${env}/${scope}: ${sha:0:7}  (${now})"
}
