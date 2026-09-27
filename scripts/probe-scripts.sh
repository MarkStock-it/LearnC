#!/bin/bash
cd ~/learnc-app/backend || exit 1
echo "=== import migrate module ==="
node -e "import('./dist/scripts/migrate.js').then(()=>console.log('migrate OK')).catch(e=>console.log('migrate FAIL', e.message))" 2>&1 | tail -2
echo "=== import seed module ==="
node -e "import('./dist/scripts/seed.js').then(()=>console.log('seed OK')).catch(e=>console.log('seed FAIL', e.message))" 2>&1 | tail -2
echo "=== import server module ==="
node -e "import('./dist/server.js').then(()=>console.log('server OK')).catch(e=>console.log('server FAIL', e.message))" 2>&1 | tail -2
echo "=== node version ==="
node -v
echo "=== try NODE_OPTIONS=--stack-trace-limit ==="
node --stack-trace-limit=50 dist/scripts/migrate.js 2>&1 | tail -3
echo "EXIT=$?"
