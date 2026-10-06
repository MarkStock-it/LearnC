#!/bin/bash
# Runs ON the DCISM host. READ-ONLY data audit: no writes, no schema changes.
# Answers one question: is the empty public listing legitimate (nothing shared yet), or
# did migration 003's backfill orphan rows that a real user should still see?
set -u
set -a
# shellcheck disable=SC1091
. "$HOME/learnc-app/backend/.env"
set +a
MYSQL="mysql -h ${DB_HOST:-127.0.0.1} -P ${DB_PORT:-3306} -u $DB_USER -p$DB_PASSWORD ${DB_NAME:-$DB_DATABASE}"

run() {
  echo "--- $1"
  # shellcheck disable=SC2086
  $MYSQL -e "$2" 2>&1 | grep -v "Using a password"
}

run "problem_sets totals" "
SELECT COUNT(*) AS total_rows,
       SUM(user_id IS NULL) AS no_owner,
       SUM(orphaned = 1) AS orphaned_true,
       SUM(orphaned = 0) AS orphaned_false,
       SUM(is_public = 1) AS public_true
FROM problem_sets;"

run "problem_sets sample (newest 8)" "
SELECT id, LEFT(title, 34) AS title, created_by, user_id, is_public, orphaned
FROM problem_sets ORDER BY id DESC LIMIT 8;"

run "problems" "SELECT COUNT(*) AS problems, SUM(orphaned IS NOT NULL) AS x FROM problems;"
run "users" "SELECT COUNT(*) AS users FROM users;"
run "user_settings + leaderboard opt-in" "
SELECT COUNT(*) AS settings_rows, SUM(leaderboard_public = 1) AS opted_in FROM user_settings;"
run "submissions" "
SELECT COUNT(*) AS submissions, SUM(status = 'COMPLETED') AS completed FROM submissions;"
run "sets visible to an ANONYMOUS visitor (orphaned = 0 AND is_public = 1)" "
SELECT COUNT(*) AS anonymously_visible FROM problem_sets WHERE orphaned = 0 AND is_public = 1;"
run "sets visible to their OWNER (orphaned = 0 AND user_id IS NOT NULL)" "
SELECT COUNT(*) AS owner_visible FROM problem_sets WHERE orphaned = 0 AND user_id IS NOT NULL;"
