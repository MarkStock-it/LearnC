#!/bin/bash
cd ~/learnc-app/backend || exit 1
echo "=== node_modules dotenv entries ==="
ls node_modules | grep -i dotenv
echo "=== dotenv dist listing ==="
ls node_modules/dotenv/dist 2>/dev/null
echo "=== what does dist/config.js import resolve to ==="
node --input-type=module -e "
console.log(import.meta.resolve('dotenv'));
try { console.log(import.meta.resolve('@dotenvx/dotenvx')); } catch (e) { console.log('dotenvx resolve FAIL'); }
" 2>&1 | tail -3
echo "=== dotenv package exports ==="
node -e "console.log(JSON.stringify(require('./node_modules/dotenv/package.json').exports, null, 1).slice(0, 400))"
