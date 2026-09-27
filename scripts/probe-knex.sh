#!/bin/bash
cd ~/learnc-app/backend || exit 1
cat > /tmp/knex-test.mjs <<'EOF'
import knex from 'knex';
const k = knex({
  client: 'better-sqlite3',
  connection: { filename: '/tmp/knex-test.sqlite' },
  useNullAsDefault: true,
  pool: { min: 1, max: 1 },
});
await k.schema.createTable('t', (t) => {
  t.increments('id');
  t.string('name');
});
console.log('TABLE CREATED');
await k.destroy();
console.log('DONE');
EOF
node /tmp/knex-test.mjs
echo "EXIT=$?"
