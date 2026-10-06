#!/bin/bash
# The database password is read from the environment and never stored in this file.
: "${DCISM_DB_PASSWORD:?Set DCISM_DB_PASSWORD before calling this script}"
mysql -h 127.0.0.1 -u s25103705_LearnC -p"${DCISM_DB_PASSWORD}" s25103705_LearnC <<'SQL' 2>&1 | grep -v password
SHOW CREATE TABLE problem_sets\G
SQL
