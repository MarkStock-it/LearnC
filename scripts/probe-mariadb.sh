#!/bin/bash
# The database password is read from the environment and never stored in this file.
: "${DCISM_DB_PASSWORD:?Set DCISM_DB_PASSWORD before calling this script}"
cd ~/learnc-app/backend || exit 1
node -e "require('mysql2'); console.log('mysql2 present')" 2>&1 | tail -1
node -e "require('knex'); const k=require('knex')({client:'mysql2'}); console.log('knex mysql2 client constructs'); k.destroy();" 2>&1 | tail -1
echo "=== mysql connection test using the conventioned account ==="
mysql -h 127.0.0.1 -u s25103705_BaljeetFlow -p"${DCISM_DB_PASSWORD}" -e "SELECT 1;" 2>&1 | head -2
echo "=== server default charset/collation ==="
mysql -h 127.0.0.1 -u s25103705_BaljeetFlow -p"${DCISM_DB_PASSWORD}" -e "SELECT @@version, @@default_storage_engine;" 2>&1 | tail -2
