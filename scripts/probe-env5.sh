#!/bin/bash
cd ~/learnc-app/backend || exit 1
node -e "
const dotenv = require('dotenv');
const r = dotenv.config({ path: '.env', quiet: true });
console.log('error:', r.error ? r.error.message : 'none');
console.log('parsed keys:', Object.keys(r.parsed ?? {}).length);
console.log('DB_CLIENT:', process.env.DB_CLIENT);
"
