#!/bin/bash
cd ~/learnc-app/backend || exit 1
echo "=== file size and od ==="
wc -c .env
od -c .env | head -8
echo "=== line count ==="
wc -l .env
echo "=== dotenvx explicit parse ==="
node -e "
const dotenvx = require('@dotenvx/dotenvx');
const fs = require('fs');
const src = fs.readFileSync('.env', 'utf8');
console.log('src length:', src.length);
const r = dotenvx.config({ path: '.env', quiet: true });
console.log('config error:', r.error ? r.error.message : 'none');
console.log('parsed:', JSON.stringify(r.parsed));
"
