#!/usr/bin/env bash
#
# ChatFlow Pro — one-command redeploy for the Hostinger VPS
# (chatflow.mannmate.com, /root/apps/chatflow-pro, PM2 app "chatflow-backend").
#
#   ./deploy-vps.sh              # deploy the current branch
#   ./deploy-vps.sh master       # deploy a specific branch
#
# Two things about that box make a plain `git pull && pm2 restart` wrong, and
# both are handled below:
#
#   1. Node. The box's system Node is 18 (seven other PM2 apps depend on it),
#      but this project needs 22. The build therefore calls Node 22 by absolute
#      path, and pm2 is called with system Node explicitly — invoking pm2 from a
#      Node 22 shell can trigger a daemon respawn that would move every other
#      app onto Node 22.
#
#   2. The frontend. backend/scripts/render-build.js skips the SPA build when
#      frontend/dist/index.html already exists, which on a redeploy is always.
#      Without the rm -rf below you would ship backend changes with a stale UI.
#
set -euo pipefail

APP_DIR="/root/apps/chatflow-pro"
PM2_APP="chatflow-backend"
NODE22_BIN="/root/.nvm/versions/node/v22.23.2/bin"
SYSTEM_NODE="/usr/bin/node"
HEALTH_URL="http://127.0.0.1:4400/api/v1/health"
BRANCH="${1:-}"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[fail] %s\033[0m\n' "$*" >&2; exit 1; }

# --- Preflight -------------------------------------------------------------
[ -d "$APP_DIR" ]                || die "$APP_DIR not found."
[ -x "$NODE22_BIN/node" ]        || die "Node 22 missing at $NODE22_BIN. Run: nvm install 22"
[ -f "$APP_DIR/backend/.env" ]   || die "backend/.env missing — never generated, copy it manually."

PM2_BIN="$(command -v pm2 || true)"
[ -n "$PM2_BIN" ] || die "pm2 not found on PATH."

cd "$APP_DIR"

# --- Source ----------------------------------------------------------------
log "Updating source"
git diff --quiet || die "Working tree is dirty. Commit, stash, or discard first."
[ -n "$BRANCH" ] && git checkout "$BRANCH"
git pull --ff-only
echo "Now at: $(git log --oneline -1)"

# --- Build -----------------------------------------------------------------
# Force a frontend rebuild (see note 2 above).
log "Clearing frontend/dist to force an SPA rebuild"
rm -rf frontend/dist

log "Installing dependencies and building (Node $("$NODE22_BIN/node" -v))"
cd "$APP_DIR/backend"
PATH="$NODE22_BIN:$PATH" RUN_DEPLOY_BUILD=1 "$NODE22_BIN/npm" ci

[ -f "$APP_DIR/frontend/dist/index.html" ] || die "frontend/dist/index.html missing — the SPA build did not run."

# --- Database --------------------------------------------------------------
# Explicit, not on boot: this database is shared with the Render deployment,
# so a migration should be a decision, never a side effect of a restart.
log "Applying migrations"
"$NODE22_BIN/node" scripts/prisma-cli.js migrate deploy

# --- Restart ---------------------------------------------------------------
# System Node on purpose (see note 1 above).
log "Restarting $PM2_APP"
"$SYSTEM_NODE" "$PM2_BIN" restart "$PM2_APP" --update-env
"$SYSTEM_NODE" "$PM2_BIN" save --force

# --- Verify ----------------------------------------------------------------
log "Waiting for health check"
for i in $(seq 1 20); do
  if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
    printf '\033[1;32m[ok] healthy after %ss — %s\033[0m\n' "$i" "$(curl -fsS "$HEALTH_URL")"
    log "Deployed: $(git log --oneline -1)"
    exit 0
  fi
  sleep 1
done

warn "No healthy response after 20s. Recent logs:"
"$SYSTEM_NODE" "$PM2_BIN" logs "$PM2_APP" --lines 40 --nostream --err
die "Deploy finished but $PM2_APP is not answering on $HEALTH_URL."
