#!/bin/bash
echo "=== sqlite3 CLI available? ==="
which sqlite3 && sqlite3 --version
echo "=== CLI schema write test ==="
rm -f /tmp/cli-test.sqlite
sqlite3 /tmp/cli-test.sqlite "CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO t(name) VALUES('hello'); SELECT * FROM t;" 2>&1
echo "CLI-EXIT=$?"
echo "=== better-sqlite3 plain (no knex) ==="
cd ~/learnc-app/backend || exit 1
node -e "
const Database = require('better-sqlite3');
const db = new Database('/tmp/plain-test.sqlite');
db.exec('CREATE TABLE IF NOT EXISTS t(id INTEGER PRIMARY KEY, name TEXT)');
db.prepare('INSERT INTO t(name) VALUES (?)').run('world');
console.log('PLAIN-SQLITE OK', db.prepare('SELECT * FROM t').all());
db.close();
"
echo "PLAIN-EXIT=$?"
