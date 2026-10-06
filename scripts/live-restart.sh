#!/bin/bash
# Runs ON the DCISM production host: apply migrations, restart ONLY the learnc process,
# then report whether it actually came up. Touches no other PM2 app.
set -u

BE="$HOME/learnc-app/backend"
cd "$BE" || exit 1

echo "=== MIGRATE (applies anything pending; must run before the restart) ==="
node dist/scripts/migrate.js
echo "migrate exit: $?"

echo "=== RESTART PM2 learnc ==="
pm2 restart learnc 2>&1 | tail -8

sleep 5

echo "=== PM2 AFTER ==="
pm2 describe learnc 2>&1 | grep -E "status|restarts|uptime|script path|exec cwd" | head -8

echo "=== API HEALTH ON LOCALHOST:20341 ==="
if curl -sS -m 10 http://127.0.0.1:20341/api/health; then
  echo
  echo "HEALTH_OK"
else
  echo "HEALTH FAILED — dumping recent logs"
  pm2 logs learnc --lines 30 --nostream 2>&1 | tail -40
  exit 1
fi

echo "=== ENDPOINTS THAT DEPEND ON MIGRATIONS 003/004 ==="
for path in /api/problem-sets /api/public-bundles /api/dashboard/leaderboard; do
  code=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "http://127.0.0.1:20341$path")
  echo "$path -> $code"
done
