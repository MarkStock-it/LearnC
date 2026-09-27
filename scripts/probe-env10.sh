#!/bin/bash
cd ~/learnc-app/backend || exit 1
echo "=== does dist/config.js import dotenv or something else ==="
grep -n "dotenv" dist/config.js
echo "=== run config import capturing all output ==="
node --input-type=module -e "
import { config } from './dist/config.js';
" 2>&1 | head -6
echo "=== now with the env file readable and cwd=backend ==="
pwd
node -e "
process.chdir('/data/users/s25103705/learnc-app/backend');
import('./dist/config.js').then((m) => {
  console.log('client:', m.config.db.client);
}).catch((e) => console.log('import error:', e.message));
" 2>&1 | head -6
