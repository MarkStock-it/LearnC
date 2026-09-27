#!/bin/bash
# Install backend deps (production) and build both packages on the server.
set -x
cd ~/learnc-app/backend || exit 1
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5
echo "=== build backend ==="
npm run build 2>&1 | tail -5
echo "=== frontend install ==="
cd ~/learnc-app/frontend || exit 1
npm install --no-audit --no-fund 2>&1 | tail -3
echo "=== frontend build ==="
npm run build 2>&1 | tail -6
echo "=== done ==="
