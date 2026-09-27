#!/bin/bash
cd ~/learnc-app/backend || exit 1
cat > pg-test.mjs <<'EOF'
import knex from 'knex';
const k = knex({
  client: 'pg',
  connection: 'postgres://postgres:postgres@127.0.0.1:5432/postgres',
  acquireConnectionTimeout: 4000,
});
try {
  const v = await k.raw('select version()');
  console.log('PG OK:', String(v.rows[0].version).slice(0, 40));
} catch (e) {
  console.log('PG connection error (expected if creds wrong):', e.message.slice(0, 100));
}
await k.destroy();
console.log('PG-DONE — no crash');
EOF
node pg-test.mjs
echo "EXIT=$?"
rm -f pg-test.mjs
