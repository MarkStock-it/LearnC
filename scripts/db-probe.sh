#!/usr/bin/env bash
set -u
# The database password is read from the environment and never stored in this file.
: "${DCISM_DB_PASSWORD:?Set DCISM_DB_PASSWORD before calling this script}"
M="mysql -h 127.0.0.1 -u s25103705_LearnC -p${DCISM_DB_PASSWORD} s25103705_LearnC -e"
echo "--- users schema ---"
$M "SHOW CREATE TABLE users\G" 2>&1 | head -40
echo "--- users count ---"
$M "SELECT COUNT(*) AS n FROM users;" 2>&1
echo "--- try manual insert ---"
$M "INSERT INTO users (username, email) VALUES ('__probe_delete_me', '__probe@example.edu'); SELECT LAST_INSERT_ID() AS id;" 2>&1
echo "--- cleanup ---"
$M "DELETE FROM users WHERE username='__probe_delete_me';" 2>&1
