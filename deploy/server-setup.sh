#!/bin/bash
# LearnC deployment on the DCISM shared host (Debian 12).
# Assumes the repo has already been pushed to GitHub; this script pulls and builds.
set -euo pipefail

APP_DIR="$HOME/learnc-app"
DOCROOT="$HOME/learnc.dcism.org"
REPO_URL="https://github.com/MarkStock-it/LearnC.git"
PORT=20341

echo "== 1. Clone or pull the repository =="
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin
  git -C "$APP_DIR" reset --hard origin/main
else
  git clone "$REPO_URL" "$APP_DIR"
fi

echo "== 2. Install dependencies =="
npm --prefix "$APP_DIR/backend" ci --omit=dev || npm --prefix "$APP_DIR/backend" install --omit=dev
npm --prefix "$APP_DIR/backend" install better-sqlite3 --no-save || true

echo "== 3. Build backend and frontend =="
npm --prefix "$APP_DIR/backend" run build
npm --prefix "$APP_DIR/frontend" ci || npm --prefix "$APP_DIR/frontend" install
npm --prefix "$APP_DIR/frontend" run build

echo "== 4. Environment =="
if [ ! -f "$APP_DIR/backend/.env" ]; then
  echo "ERROR: $APP_DIR/backend/.env is missing. Create it from deploy/learnc.env.example first." >&2
  exit 1
fi

echo "== 5. Database: migrate + seed =="
mkdir -p "$APP_DIR/data"
npm --prefix "$APP_DIR/backend" run db:migrate
npm --prefix "$APP_DIR/backend" run db:seed

echo "== 6. Publish the docroot =="
mkdir -p "$DOCROOT"
rsync -a --delete "$APP_DIR/frontend/dist/" "$DOCROOT/" --exclude=.htaccess
cp "$APP_DIR/deploy/learnc-htaccess" "$DOCROOT/.htaccess"
chmod 755 "$DOCROOT"
chmod 644 "$DOCROOT/.htaccess"

echo "== 7. pm2 service =="
pm2 delete learnc >/dev/null 2>&1 || true
cd "$APP_DIR/backend"
PORT=$PORT NODE_ENV=production pm2 start dist/server.js --name learnc --time
pm2 save

echo "== 8. Health check =="
sleep 2
curl -s -m 10 "http://127.0.0.1:$PORT/api/health" | head -c 600
echo
echo "Deployment complete. Site: https://learnc.dcism.org"
