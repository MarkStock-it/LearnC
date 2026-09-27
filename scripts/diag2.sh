#!/bin/bash
echo "=== BetterCLSS config.js ==="
cat ~/BetterCLSS/config.js 2>/dev/null | head -40
echo "=== baljeetflow .env.local (own file) ==="
cat ~/baljeetflow-app/.env.local 2>/dev/null
echo "=== baljeetflow .env.example ==="
cat ~/baljeetflow-app/.env.example 2>/dev/null
echo "=== baljeetflow db dir ==="
ls -la ~/baljeetflow-app/db 2>/dev/null | head
echo "=== mongo attempt ==="
(mongosh --quiet --eval 'db.runCommand({connectionStatus:1})' 2>&1 || mongo --quiet --eval 'db.runCommand({connectionStatus:1})' 2>&1) | head -5
echo "=== mysql client? ==="
which mysql mariadb 2>/dev/null
echo "=== pgadmin route ==="
curl -sk -o /dev/null -w "%{http_code}\n" -m 6 https://pgadmin.dcism.org 2>/dev/null
echo "=== existing home sqlite dbs ==="
find ~ -maxdepth 3 -name "*.sqlite*" -o -maxdepth 3 -name "*.db" 2>/dev/null | grep -v node_modules | head -10
echo "=== betterclss backend db config ==="
grep -rn "sqlite\|postgres\|mysql\|mongo" ~/BetterCLSS/config.js 2>/dev/null | head -10
