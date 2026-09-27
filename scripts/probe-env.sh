#!/bin/bash
cd ~/learnc-app/backend || exit 1
echo "=== file exists? ==="
ls -la .env
echo "=== first lines ==="
head -5 .env
echo "=== dotenv load from node ==="
node --input-type=module -e "
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
console.log('cwd:', process.cwd());
const mod = await import('./dist/config.js');
console.log('BACKEND_ROOT accessible via import');
import dotenv from 'dotenv';
const r = dotenv.config({ path: path.join(process.cwd(), '.env') });
console.log('dotenv explicit result:', JSON.stringify(r.error ? r.error.message : 'loaded'));
console.log('DB_CLIENT after explicit load:', process.env.DB_CLIENT);
" 2>&1 | tail -6
