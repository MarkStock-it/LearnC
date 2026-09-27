#!/bin/bash
cd ~/learnc-app/backend || exit 1
echo "=== DOTENV-related environment ==="
env | grep -i dotenv || echo "none"
echo "=== check dist/config.js quiet flag path with explicit false ==="
node --input-type=module -e "
import dotenv from 'dotenv';
import path from 'node:path';
const p = path.join('/data/users/s25103705/learnc-app/backend', '.env');
console.log('--- quiet:true');
let r = dotenv.config({ path: p, quiet: true });
console.log('keys:', Object.keys(r.parsed ?? {}).length);
console.log('--- quiet:true AGAIN (already loaded)');
r = dotenv.config({ path: p, quiet: true });
console.log('keys:', Object.keys(r.parsed ?? {}).length);
" 2>&1 | head -8
