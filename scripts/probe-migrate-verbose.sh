#!/bin/bash
cd ~/learnc-app/backend || exit 1
echo "=== migrate with pino debug ==="
LOG_LEVEL=debug node dist/scripts/migrate.js 2>&1 | tail -10
echo "MIGRATE-EXIT=$?"
echo "=== knex client check ==="
node --input-type=module -e "
import { db, closeDb } from './dist/db/knex.js';
import { config } from './dist/config.js';
console.log('client:', config.db.client);
const tables = await db().raw('SHOW TABLES');
console.log('tables:', JSON.stringify(tables[0]).slice(0, 200));
await closeDb();
" 2>&1 | tail -4
