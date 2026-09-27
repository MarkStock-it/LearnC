#!/bin/bash
cd ~/learnc-app/backend || exit 1
echo "=== migrate import (exit code capture) ==="
node -e "import('./dist/scripts/migrate.js').then(()=>console.log('migrate OK')).catch(e=>console.log('migrate FAIL', e.message))" > /tmp/mig.log 2>&1
echo "EXIT=$?"
cat /tmp/mig.log
echo "=== seed import ==="
node -e "import('./dist/scripts/seed.js').then(()=>console.log('seed OK')).catch(e=>console.log('seed FAIL', e.message))" > /tmp/seed.log 2>&1
echo "EXIT=$?"
cat /tmp/seed.log
echo "=== server import ==="
node -e "import('./dist/server.js').then(()=>console.log('server OK')).catch(e=>console.log('server FAIL', e.message))" > /tmp/srv.log 2>&1
echo "EXIT=$?"
cat /tmp/srv.log
echo "=== what does migrate.js import ==="
head -20 dist/scripts/migrate.js
