#!/bin/bash
cd ~/learnc-app/backend || exit 1
cp dist/config.js /tmp/config.orig.js
sed "s|dotenv.config({ path: path.join(BACKEND_ROOT, '.env'), quiet: true });|const __r = dotenv.config({ path: path.join(BACKEND_ROOT, '.env'), quiet: true }); console.error('DBG dotenv result keys:', Object.keys(__r.parsed ?? {}).length, 'err:', __r.error ? __r.error.message : 'none');|" dist/config.js > /tmp/config.dbg.js
cp /tmp/config.dbg.js dist/config.js
node --input-type=module -e "import('./dist/config.js').then(m => console.log('client:', m.config.db.client))" 2>&1 | head -4
cp /tmp/config.orig.js dist/config.js
echo "restored"
