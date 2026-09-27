#!/bin/bash
cd ~/learnc-app/backend || exit 1
echo "=== which dotenv resolves ==="
node --input-type=module -e "
console.log('resolve:', import.meta.resolve ? 'n/a' : '');
" 2>/dev/null
node -e "console.log('require.resolve dotenv:', require.resolve('dotenv'))"
node -e "console.log('require.resolve dotenvx:', require.resolve('@dotenvx/dotenvx'))" 2>&1 | tail -1
echo "=== dotenv versions ==="
cat node_modules/dotenv/package.json | grep '"version"'
cat node_modules/@dotenvx/dotenvx/package.json 2>/dev/null | grep '"version"'
echo "=== reproduce config.js load order ==="
node --input-type=module -e "
import { config } from './dist/config.js';
console.log('config.db.client:', config.db.client);
console.log('config.port:', config.port);
console.log('config.executor.mode:', config.executor.mode);
" 2>&1 | tail -4
echo "=== same but with env pre-set ==="
DB_CLIENT=mysql PORT=20341 node --input-type=module -e "
import { config } from './dist/config.js';
console.log('client when preset:', config.db.client);
" 2>&1 | tail -2
