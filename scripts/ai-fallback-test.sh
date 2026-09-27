#!/bin/bash
sed -i 's/^AI_MAX_ATTEMPTS=.*/AI_MAX_ATTEMPTS=1/' ~/learnc-app/backend/.env
grep -q '^AI_TIMEOUT_MS=' ~/learnc-app/backend/.env || echo 'AI_TIMEOUT_MS=45000' >> ~/learnc-app/backend/.env
sed -i 's/^AI_TIMEOUT_MS=.*/AI_TIMEOUT_MS=45000/' ~/learnc-app/backend/.env
grep '^AI_' ~/learnc-app/backend/.env
pm2 restart learnc --update-env >/dev/null 2>&1
sleep 2
echo "--- generation request (should answer within ~50s via fallback) ---"
time curl -sk -m 150 -o /tmp/ai.json -w 'HTTP=%{http_code}\n' \
  -X POST https://learnc.dcism.org/api/admin/generate-problem \
  -H 'Content-Type: application/json' \
  -H 'x-admin-token: b7f3d1c9a25e480f96c7d3b1e8a54f26' \
  -d '{"difficulty":"easy","topics":["loops"],"testCaseCount":3,"publicTestCaseCount":1,"persist":false}'
head -c 500 /tmp/ai.json
echo
