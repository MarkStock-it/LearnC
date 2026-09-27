#!/bin/bash
cd ~/learnc-app/backend || exit 1
echo "=== dotenvx real location ==="
node -e "console.log(require.resolve('@dotenvx/dotenvx'))" 2>&1 | tail -1
echo "=== real test ==="
node -e "
const dotenvx = require('/data/users/s25103705/learnc-app/backend/node_modules/@dotenvx/dotenvx');
const r = dotenvx.config({ path: '.env', quiet: true });
console.log('error:', r.error ? r.error.message : 'none');
console.log('keys:', Object.keys(r.parsed ?? {}).length);
console.log('process.env.DB_CLIENT:', process.env.DB_CLIENT);
" 2>&1 | head -8
