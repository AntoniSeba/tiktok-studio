#!/usr/bin/env bash
# deploy.sh — first-time / repeat deploy of TikTok Studio to the Soft Synergy VPS.
# Run locally:  bash scripts/deploy.sh
# Assumes SSH access as admin@193.180.211.30 and Node 20+ already on the box.
set -euo pipefail

REMOTE="admin@193.180.211.30"
APP_DIR="/home/admin/tiktok-studio"
PORT=4317

echo "▸ syncing source to ${REMOTE}:${APP_DIR}"
ssh "$REMOTE" "mkdir -p $APP_DIR"
rsync -az --delete \
  --exclude node_modules --exclude data/studio.db --exclude '.env' --exclude 'logs' \
  ./ "$REMOTE:$APP_DIR/"

echo "▸ installing deps + (re)starting under PM2"
ssh "$REMOTE" bash -s <<EOF
  set -e
  cd "$APP_DIR"
  command -v pm2 >/dev/null || npm i -g pm2
  npm install --omit=dev
  [ -f .env ] || cp .env.example .env   # remember to fill BREVO_* on the server!
  mkdir -p logs
  pm2 startOrReload ecosystem.config.js
  pm2 save
EOF

cat <<NOTE

✅ Deployed. Next steps on the server (once):
   1. ssh $REMOTE 'nano $APP_DIR/.env'   # paste BREVO_SMTP_USER + BREVO_SMTP_KEY, then: pm2 restart tiktok-studio
   2. Put it behind nginx (studio.soft-synergy.com) — sample vhost in README.
   App is live on the box at http://127.0.0.1:${PORT}
NOTE
