#!/bin/bash
cd ~/learnc-app/backend || exit 1
echo "=== dist/config.js head ==="
sed -n '1,20p' dist/config.js
echo "=== run dist/config.js import in a script file instead of -e ==="
cat > /tmp/cfg-test.mjs <<'EOF'
import { config } from '/data/users/s25103705/learnc-app/backend/dist/config.js';
console.log('client:', config.db.client);
console.log('port:', config.port);
EOF
node /tmp/cfg-test.mjs 2>&1 | head -4
