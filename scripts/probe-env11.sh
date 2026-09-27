#!/bin/bash
cd ~/learnc-app/backend || exit 1
echo "=== namei-style path check ==="
namei -l /data/users/s25103705/learnc-app/backend/.env 2>/dev/null || ls -ld /data/users/s25103705 /data/users/s25103705/learnc-app /data/users/s25103705/learnc-app/backend /data/users/s25103705/learnc-app/backend/.env
echo "=== try importing config with absolute env path override ==="
node --input-type=module -e "
import dotenv from 'dotenv';
const r = dotenv.config({ path: '/data/users/s25103705/learnc-app/backend/.env', quiet: true });
console.log('keys:', Object.keys(r.parsed ?? {}).length, 'DB_CLIENT:', process.env.DB_CLIENT);
const { config } = await import('./dist/config.js');
console.log('config.db.client:', config.db.client);
" 2>&1 | head -6
