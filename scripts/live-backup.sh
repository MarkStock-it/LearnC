#!/bin/bash
# Runs ON the DCISM production host, immediately before a publish.
# Creates a timestamped backup of the database, the docroot and the backend dist.
# Changes nothing: it only reads and copies.
set -eu

STAMP=$(date +%Y%m%d-%H%M%S)
BK="$HOME/deploy-backups/learnc-$STAMP"
mkdir -p "$BK"
echo "BACKUP_DIR=$BK"

echo "=== PM2 BEFORE ==="
pm2 ls 2>&1 | head -8
pm2 describe learnc 2>&1 | grep -E "script path|script args|cwd|exec cwd|status|restarts|uptime|node v" | head -12

echo "=== DATABASE DUMP ==="
set -a
# shellcheck disable=SC1091
. "$HOME/learnc-app/backend/.env"
set +a
DBH="${DB_HOST:-127.0.0.1}"
DBP="${DB_PORT:-3306}"
DBN="${DB_NAME:-${DB_DATABASE:-}}"
if mysqldump -h "$DBH" -P "$DBP" -u "$DB_USER" -p"$DB_PASSWORD" \
     --single-transaction --routines --triggers "$DBN" \
     > "$BK/db-$DBN.sql" 2> "$BK/db-dump.err"; then
  grep -v "Using a password" "$BK/db-dump.err" || true
  echo "db dump ok, bytes: $(wc -c < "$BK/db-$DBN.sql")"
else
  echo "MYSQLDUMP FAILED"
  grep -v "Using a password" "$BK/db-dump.err" || true
  exit 1
fi

echo "=== DOCROOT ARCHIVE ==="
tar -czf "$BK/docroot.tar.gz" -C "$HOME" learnc.dcism.org
echo "docroot tar bytes: $(wc -c < "$BK/docroot.tar.gz")"

echo "=== BACKEND DIST ARCHIVE ==="
tar -czf "$BK/backend-dist.tar.gz" -C "$HOME/learnc-app/backend" dist
echo "backend dist tar bytes: $(wc -c < "$BK/backend-dist.tar.gz")"

echo "=== RECORD WHAT WAS LIVE ==="
( cd "$HOME/learnc-app" && git log --oneline -1 > "$BK/checkout-at.txt" )
sha256sum "$HOME/learnc.dcism.org/index.html" > "$BK/index.html.sha256"
cat "$BK/checkout-at.txt"

echo "BACKUP_OK $BK"
