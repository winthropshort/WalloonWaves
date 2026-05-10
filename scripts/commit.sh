#!/usr/bin/env bash
# =============================================================================
# commit.sh — Stage all modified files, commit, and push to origin
# =============================================================================
#
# USAGE
#   bash scripts/commit.sh                        # auto-generate commit message
#   bash scripts/commit.sh "your commit message"  # use provided message
#   bash scripts/commit.sh --dry-run              # preview only
#
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[commit]${RESET} $*"; }
success() { echo -e "${GREEN}[commit]${RESET} $*"; }
warn()    { echo -e "${YELLOW}[commit]${RESET} $*"; }
dryrun()  { echo -e "${YELLOW}[dry-run]${RESET} $*"; }
die()     { echo -e "${RED}[commit] ERROR:${RESET} $*" >&2; exit 1; }

DRY_RUN=false
USER_MSG=""
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then DRY_RUN=true
  else USER_MSG="$arg"
  fi
done

git rev-parse --git-dir > /dev/null 2>&1 || die "Not a git repository."
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if $DRY_RUN; then dryrun "Branch: ${BOLD}${BRANCH}${RESET}  (no changes will be made)"
else info "Branch: ${BOLD}${BRANCH}${RESET}"
fi

echo ""
git status --short
echo ""

CHANGES=$(git status --porcelain | wc -l | tr -d ' ')
if [[ "$CHANGES" -eq 0 ]]; then
  warn "Nothing to commit — working tree is clean."; exit 0
fi

WOULD_STAGE=$(git status --porcelain | awk '
  /^\?\? / { print substr($0, 4) }
  /^.[MDRC] / { print substr($0, 4) }
' | grep -v '^node_modules/' \
  | grep -v '\.log$' \
  | grep -v '^dist/' \
  | grep -v '^build/' \
  | grep -v '^\.env' \
  | grep -v '\.DS_Store$' \
  | grep -v '^cdk\.out/' \
  || true)

ALREADY_STAGED=$(git diff --cached --name-only || true)
STAGED=$(printf '%s\n%s\n' "$WOULD_STAGE" "$ALREADY_STAGED" | sort -u | grep -v '^$' || true)

if [[ -z "$STAGED" ]]; then
  warn "Nothing to stage — all changes may be ignored files."; exit 0
fi

if $DRY_RUN; then
  echo -e "${BOLD}Would stage these files:${RESET}"
  echo "$STAGED" | sed 's/^/  /'
  echo ""
else
  info "Staging all changes..."
  git add -u
  git add -- . \
    ':!node_modules' \
    ':!*.log' \
    ':!dist' \
    ':!build' \
    ':!.env*' \
    ':!*.DS_Store' \
    ':!cdk.out' \
    2>/dev/null || true

  STAGED=$(git diff --cached --name-only)
  if [[ -z "$STAGED" ]]; then
    warn "Nothing staged after add — all changes may be ignored files."; exit 0
  fi
fi

if [[ -z "$USER_MSG" ]]; then
  FILE_COUNT=$(echo "$STAGED" | wc -l | tr -d ' ')
  HAS_INFRA=false; HAS_BACKEND=false; HAS_FRONTEND=false
  HAS_SHARED=false; HAS_SCRIPTS=false

  while IFS= read -r f; do
    [[ "$f" == packages/infrastructure/* ]] && HAS_INFRA=true
    [[ "$f" == packages/backend/*        ]] && HAS_BACKEND=true
    [[ "$f" == packages/frontend/*       ]] && HAS_FRONTEND=true
    [[ "$f" == packages/shared/*         ]] && HAS_SHARED=true
    [[ "$f" == scripts/*                 ]] && HAS_SCRIPTS=true
  done <<< "$STAGED"

  PARTS=()
  $HAS_SHARED   && PARTS+=("shared")
  $HAS_BACKEND  && PARTS+=("backend")
  $HAS_FRONTEND && PARTS+=("frontend")
  $HAS_INFRA    && PARTS+=("infra")
  $HAS_SCRIPTS  && PARTS+=("scripts")

  if [[ ${#PARTS[@]} -eq 0 ]]; then SCOPE="misc"
  elif [[ ${#PARTS[@]} -eq 1 ]]; then SCOPE="${PARTS[0]}"
  else SCOPE=$(IFS=+; echo "${PARTS[*]}")
  fi

  NAMES=$(echo "$STAGED" | xargs -I{} basename {} | sort -u | head -3 | tr '\n' ' ' | sed 's/ $//')
  if [[ "$FILE_COUNT" -gt 3 ]]; then NAMES="${NAMES} (+ $((FILE_COUNT - 3)) more)"; fi

  AUTO_MSG="chore(${SCOPE}): update ${NAMES}"
  warn "No message provided — using auto-generated message:"
  echo -e "  ${BOLD}${AUTO_MSG}${RESET}"
  echo ""
  COMMIT_MSG="$AUTO_MSG"
else
  COMMIT_MSG="$USER_MSG"
fi

if $DRY_RUN; then
  echo -e "${BOLD}Would commit with message:${RESET}"
  echo -e "  ${BOLD}${COMMIT_MSG}${RESET}"
  echo ""
  dryrun "Would push to origin/${BRANCH}"
  dryrun "Dry run complete — nothing was staged, committed, or pushed."
  exit 0
fi

echo -e "${BOLD}Files to commit:${RESET}"
echo "$STAGED" | sed 's/^/  /'
echo ""
read -r -p "$(echo -e "${CYAN}Commit and push to ${BOLD}${BRANCH}${RESET}${CYAN}?${RESET} [Y/n] ")" CONFIRM
CONFIRM="${CONFIRM:-Y}"
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  warn "Aborted. Changes are staged but not committed."; exit 0
fi

git commit -m "$COMMIT_MSG"

info "Pushing to origin/${BRANCH}..."
git push origin "$BRANCH"

success "Done. Pushed ${BOLD}${BRANCH}${RESET} to origin."
