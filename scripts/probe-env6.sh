#!/bin/bash
cd ~/learnc-app/backend || exit 1
node -e "
const dotenvx = require('dotenvx');
const r = dotenvx.config({ path: '.env', quiet: true });
console.log('error:', r.error ? r.error.message : 'none');
console.log('keys:', Object.keys(r.parsed ?? {}).length);
console.log('process.env.DB_CLIENT:', process.env.DB_CLIENT);
const r2 = dotenvx.config({ path: '.env' });
console.log('without quiet error:', r2.error ? r2.error.message : 'none');
console.log('without quiet process.env.DB_CLIENT:', process.env.DB_CLIENT);
" 2>&1 | head -10
