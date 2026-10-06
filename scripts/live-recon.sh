#!/bin/bash
# Runs ON the DCISM production host. Strictly read-only: it changes nothing.
# Uploaded to /tmp and executed with `bash /tmp/live-recon.sh`.
set -u

cd "$HOME" || exit 1

echo "=== HOST ==="
hostname; whoami; date

echo "=== PM2 ==="
pm2 ls 2>&1 | head -14

echo "=== DOCROOT ==="
ls -la "$HOME/learnc.dcism.org" | head -12

echo "=== DOCROOT ASSETS (newest 6) ==="
ls -lat "$HOME/learnc.dcism.org/assets" 2>/dev/null | head -7

echo "=== HTACCESS PRESENT? ==="
ls -la "$HOME/learnc.dcism.org/.htaccess" 2>&1

echo "=== APP CHECKOUT ==="
( cd "$HOME/learnc-app" && git log --oneline -1 && echo "--- dirty files (count) ---" && git status --porcelain | wc -l )

echo "=== BACKEND DIST (newest 6) ==="
ls -lat "$HOME/learnc-app/backend/dist" | head -7

echo "=== BACKEND DIST TREE ==="
ls "$HOME/learnc-app/backend/dist" | head -25

echo "=== ENV VAR NAMES (values withheld) ==="
sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$HOME/learnc-app/backend/.env" 2>/dev/null | tr '\n' ' '
echo

echo "=== DATABASE (credentials read from the app's own .env) ==="
set -a
# shellcheck disable=SC1091
. "$HOME/learnc-app/backend/.env" 2>/dev/null
set +a
DBH="${DB_HOST:-127.0.0.1}"
DBP="${DB_PORT:-3306}"
DBU="${DB_USER:-}"
DBPW="${DB_PASSWORD:-}"
DBN="${DB_NAME:-${DB_DATABASE:-}}"
echo "client=${DB_CLIENT:-unset} host=$DBH port=$DBP user=$DBU db=$DBN passlen=${#DBPW}"
if command -v mysql >/dev/null 2>&1; then
  mysql -h "$DBH" -P "$DBP" -u "$DBU" -p"$DBPW" "$DBN" \
    -e "SELECT id, name, applied_at FROM schema_migrations ORDER BY id" 2>&1 | grep -v "Using a password"
  echo "--- problem_sets columns ---"
  mysql -h "$DBH" -P "$DBP" -u "$DBU" -p"$DBPW" "$DBN" \
    -e "SHOW COLUMNS FROM problem_sets" 2>&1 | grep -v "Using a password" | awk '{print $1}' | tr '\n' ' '
  echo
else
  echo "mysql client NOT on PATH"
fi

echo "=== DISK ==="
df -h "$HOME" | tail -1

echo "=== EXISTING BACKUPS ==="
ls -lat "$HOME/deploy-backups" 2>/dev/null | head -6

echo "=== NODE / DEPS ==="
node --version
( cd "$HOME/learnc-app/backend" && if [ -d node_modules ]; then echo "backend node_modules present"; else echo "backend node_modules MISSING"; fi )
( command -v mysqldump >/dev/null 2>&1 && echo "mysqldump available" || echo "mysqldump MISSING" )
