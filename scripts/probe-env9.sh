#!/bin/bash
cd ~/learnc-app/backend || exit 1
node -e "
const dotenv = require('/data/users/s25103705/learnc-app/backend/node_modules/dotenv/dist/index.cjs');
const r = dotenv.config({ path: '.env', quiet: true });
console.log('quiet:true error:', r.error ? r.error.message : 'none', 'keys:', Object.keys(r.parsed ?? {}).length, 'env.DB_CLIENT:', process.env.DB_CLIENT);
const r2 = dotenv.config({ path: '.env' });
console.log('no-quiet  error:', r2.error ? r2.error.message : 'none', 'keys:', Object.keys(r2.parsed ?? {}).length, 'env.DB_CLIENT:', process.env.DB_CLIENT);
console.log('dotenv.main exists:', typeof dotenv.main);
"
