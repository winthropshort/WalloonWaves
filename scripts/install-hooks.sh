#!/usr/bin/env bash
# =============================================================================
# install-hooks.sh — Install local git hooks for WalloonWaves
# =============================================================================
#
# WHAT IT INSTALLS
#   pre-push  Auto-deploys to dev after every push to master (background).
#             Logs appear in tmp/deploy-dev-TIMESTAMP.log.
#
# USAGE
#   bash scripts/install-hooks.sh
#
# REMOVING
#   rm .git/hooks/pre-push
#
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_DIR="${REPO_ROOT}/.git/hooks"

if [[ ! -d "$HOOK_DIR" ]]; then
  echo "  ✗  Not a git repository or .git/hooks not found at: ${HOOK_DIR}"
  exit 1
fi

PRE_PUSH="${HOOK_DIR}/pre-push"

cat > "$PRE_PUSH" << 'HOOK'
#!/usr/bin/env bash
# pre-push — Installed by scripts/install-hooks.sh
# Auto-deploys to dev after every push to master (runs in background).

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || exit 0)"

PUSHING_MASTER=false
while read -r local_ref local_sha remote_ref remote_sha; do
  if [[ "$remote_ref" == "refs/heads/master" || "$remote_ref" == "refs/heads/main" ]]; then
    PUSHING_MASTER=true
  fi
done

$PUSHING_MASTER || exit 0

mkdir -p "${REPO_ROOT}/tmp"
LOG_FILE="${REPO_ROOT}/tmp/deploy-dev-$(date +%Y%m%d-%H%M%S).log"

echo ""
echo "  → Push to master detected — starting dev deploy in background."
echo "    Log:  ${LOG_FILE}"
echo "    Follow:  tail -f ${LOG_FILE}"
echo ""

nohup bash "${REPO_ROOT}/scripts/deploy-dev.sh" --skip-guards \
  > "$LOG_FILE" 2>&1 &

exit 0
HOOK

chmod +x "$PRE_PUSH"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Git hooks installed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  pre-push  →  ${PRE_PUSH}"
echo ""
echo "  After any push to master, dev will deploy automatically."
echo "  Logs appear in tmp/deploy-dev-*.log"
echo ""
echo "  To uninstall:  rm ${PRE_PUSH}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
