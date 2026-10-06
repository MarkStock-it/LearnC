#!/bin/bash
# Runs ON the DCISM production host: publishes already-uploaded archives.
#
# Safety properties, each deliberate:
#   * the frontend is extracted WITHOUT --delete, so .htaccess and previously published
#     hashed assets survive (clients holding cached HTML must keep working);
#   * the backend dist is snapshotted to dist.pre-<stamp> before being overwritten;
#   * migrations are applied BEFORE any restart, because the API now refuses to start
#     when its database is behind the build;
#   * nothing touches the git checkout, the .env, or PM2.
set -eu

STAMP="${1:?usage: live-publish.sh <stamp>}"
FRONT="$HOME/learnc-frontend-$STAMP.tar.gz"
BACK="$HOME/learnc-backend-dist-$STAMP.tar.gz"
DOC="$HOME/learnc.dcism.org"
BE="$HOME/learnc-app/backend"

[ -f "$FRONT" ] || { echo "MISSING $FRONT"; exit 1; }
[ -f "$BACK" ] || { echo "MISSING $BACK"; exit 1; }
[ -d "$DOC" ] || { echo "MISSING docroot $DOC"; exit 1; }
[ -d "$BE/dist" ] || { echo "MISSING $BE/dist"; exit 1; }

echo "=== BEFORE ==="
sha256sum "$DOC/index.html"
echo "old dist js files: $(find "$BE/dist" -name '*.js' | wc -l)"

echo "=== PUBLISH FRONTEND (extract, no --delete) ==="
cp -a "$DOC/index.html" "$HOME/deploy-backups/learnc-$STAMP.index.html.pre"
tar -xzf "$FRONT" -C "$DOC"
echo "docroot entries: $(ls -A "$DOC" | wc -l)"
if [ -f "$DOC/.htaccess" ]; then echo ".htaccess PRESERVED"; else echo ".htaccess MISSING — ABORT"; exit 1; fi
echo "published index.html:"; ls -la "$DOC/index.html"
echo "published index.html sha:"; sha256sum "$DOC/index.html"

echo "=== PUBLISH BACKEND DIST ==="
rm -rf "$BE/dist.pre-$STAMP"
cp -a "$BE/dist" "$BE/dist.pre-$STAMP"
tar -xzf "$BACK" -C "$BE"
echo "new dist js files: $(find "$BE/dist" -name '*.js' | wc -l)"

echo "=== STALE MODULES LEFT FROM THE OLD BUILD (expect only *.pre-* markers) ==="
( cd "$BE/dist.pre-$STAMP" && find . -name '*.js' | sort ) > "$HOME/.old-dist.txt"
( cd "$BE/dist" && find . -name '*.js' | sort ) > "$HOME/.new-dist.txt"
comm -23 "$HOME/.old-dist.txt" "$HOME/.new-dist.txt" || true

echo "=== APPLY MIGRATIONS (before any restart) ==="
cd "$BE"
node dist/scripts/migrate.js
echo "MIGRATE_EXIT=$?"

echo "=== MIGRATION LEDGER AFTER ==="
set -a
# shellcheck disable=SC1091
. "$BE/.env"
set +a
mysql -h "${DB_HOST:-127.0.0.1}" -P "${DB_PORT:-3306}" -u "$DB_USER" -p"$DB_PASSWORD" \
  "${DB_NAME:-$DB_DATABASE}" -e "SELECT id, name FROM schema_migrations ORDER BY id" 2>&1 | grep -v "Using a password"

echo "PUBLISH_DONE _STAMP_=$STAMP"
echo "NOTE: PM2 has NOT been restarted yet."
