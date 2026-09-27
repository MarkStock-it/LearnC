#!/bin/bash
cd ~/learnc-app/backend || exit 1
echo "=== CJS context (node -e) ==="
node -e "
const dotenv = require('dotenv');
const r = dotenv.config({ path: require('path').join(process.cwd(), '.env'), quiet: true });
console.log('CJS keys:', Object.keys(r.parsed ?? {}).length, 'DB_CLIENT:', process.env.DB_CLIENT);
" 2>&1 | head -4
echo "=== ESM context (node --input-type=module) ==="
node --input-type=module -e "
import dotenv from 'dotenv';
import path from 'node:path';
const r = dotenv.config({ path: path.join(process.cwd(), '.env'), quiet: true });
console.log('ESM keys:', Object.keys(r.parsed ?? {}).length, 'DB_CLIENT:', process.env.DB_CLIENT);
" 2>&1 | head -4
echo "=== ESM context with quiet omitted ==="
node --input-type=module -e "
import dotenv from 'dotenv';
const r = dotenv.config({ path: process.cwd() + '/.env' });
console.log('ESM-noquiet keys:', Object.keys(r.parsed ?? {}).length, 'DB_CLIENT:', process.env.DB_CLIENT);
" 2>&1 | head -6
