#!/bin/bash
echo "=== dotenvx anywhere in the app tree ==="
find ~/learnc-app -maxdepth 4 -name "dotenvx*" -not -path "*/proc/*" 2>/dev/null | head -5
echo "=== dotenv package real version files ==="
ls ~/learnc-app/backend/node_modules/dotenv/
cat ~/learnc-app/backend/node_modules/dotenv/package.json | head -20
echo "=== grep injected-env in dotenv dist ==="
grep -l "injected env" ~/learnc-app/backend/node_modules/dotenv/dist/* 2>/dev/null
