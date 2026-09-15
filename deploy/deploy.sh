#!/usr/bin/env bash
#
# Deploys / redeploys CareerForge on the VPS.
# Run as root ON THE SERVER, from inside the checked-out repo:
#   bash deploy/deploy.sh
#
# Steps: sync code → install deps → build the SPA → migrate → (re)start PM2.

set -euo pipefail

APP_USER="careerforge"
APP_DIR="/var/www/careerforge"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Run this as root."; exit 1; }
[[ -f "$APP_DIR/server/.env" ]] || { echo "Missing $APP_DIR/server/.env — run deploy/provision.sh first."; exit 1; }

log "Syncing code from $SOURCE_DIR to $APP_DIR"
mkdir -p "$APP_DIR"
# .env and node_modules on the server win — never clobbered by the checkout
rsync -a --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'server/.env' \
  --exclude 'client/dist' \
  "$SOURCE_DIR"/ "$APP_DIR"/
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

log "Installing dependencies"
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund

log "Building the front end"
# vite and tailwind are devDependencies — install them just for the build
npm install --include=dev --no-audit --no-fund --silent
npm --workspace client run build
chown -R "$APP_USER:$APP_USER" "$APP_DIR/client/dist"

log "Running database migrations"
sudo -u "$APP_USER" env $(grep -v '^#' "$APP_DIR/server/.env" | xargs -d '\n') \
  node "$APP_DIR/server/src/db/migrate.js"

if [[ "${SEED:-0}" == "1" ]]; then
  log "Seeding demo data"
  sudo -u "$APP_USER" env $(grep -v '^#' "$APP_DIR/server/.env" | xargs -d '\n') \
    node "$APP_DIR/server/src/db/seed.js"
fi

log "Starting the API under PM2"
cd "$APP_DIR"
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

log "Health check"
sleep 2
if curl -fsS http://127.0.0.1:4000/api/health | head -c 400; then
  printf '\n\n\033[1;32mDeploy complete.\033[0m\n\n'
else
  printf '\n\033[1;31mAPI is not healthy — check: pm2 logs careerforge-api\033[0m\n\n'
  exit 1
fi
