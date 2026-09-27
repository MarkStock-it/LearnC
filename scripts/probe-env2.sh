#!/bin/bash
cd ~/learnc-app/backend || exit 1
echo "=== dotenvx version ==="
npx dotenvx --version 2>/dev/null || echo "no dotenvx cli"
echo "=== try parse with dotenvx helpers ==="
node --input-type=module -e "
import dotenvx from '@dotenvx/dotenvx';
import path from 'node:path';
const r = dotenvx.config({ path: path.join(process.cwd(), '.env'), quiet: true });
console.log('parsed keys:', Object.keys(r.parsed ?? {}).length);
console.log('error:', r.error ? r.error.message : 'none');
console.log('sample parsed:', JSON.stringify((r.parsed ?? {})).slice(0, 300));
" 2>&1 | tail -5
