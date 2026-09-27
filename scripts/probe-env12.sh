#!/bin/bash
cd ~/learnc-app/backend || exit 1
node --input-type=module -e "
import dotenv from 'dotenv';
import path from 'node:path';
// EXACT replication of dist/config.js lines 1-10
const here = '/data/users/s25103705/learnc-app/backend/dist';
const BACKEND_ROOT = path.resolve(here, '..');
console.log('BACKEND_ROOT =', BACKEND_ROOT);
const envPath = path.join(BACKEND_ROOT, '.env');
console.log('envPath =', envPath, 'exists:', require('fs').existsSync(envPath));
" 2>&1 | head -5
echo "=== now with import of fs module ==="
node --input-type=module -e "
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
const BACKEND_ROOT = '/data/users/s25103705/learnc-app/backend';
const envPath = path.join(BACKEND_ROOT, '.env');
console.log('exists:', fs.existsSync(envPath));
const r = dotenv.config({ path: envPath, quiet: true });
console.log('keys:', Object.keys(r.parsed ?? {}).length, 'DB_CLIENT:', process.env.DB_CLIENT);
" 2>&1 | head -5
