#!/bin/bash
set -x
cd ~/learnc-app/backend || exit 1
npm install --no-audit --no-fund 2>&1 | tail -3
echo "=== build backend ==="
npm run build 2>&1 | tail -8
echo "=== dist ==="
ls dist/ | head
echo "=== done ==="
