#!/bin/bash
echo "--- AI generation via domain (persist=false) ---"
curl -sk -m 150 -o /tmp/ai-out.json -w 'HTTP=%{http_code} TIME=%{time_total}s\n' \
  -X POST https://learnc.dcism.org/api/admin/generate-problem \
  -H 'Content-Type: application/json' \
  -H 'x-admin-token: $ADMIN_TOKEN' \
  -d '{"difficulty":"easy","topics":["loops"],"testCaseCount":3,"publicTestCaseCount":1,"persist":false}'
head -c 700 /tmp/ai-out.json
echo
echo "--- llama.cpp reachable from this host? ---"
curl -s -m 10 -o /dev/null -w 'llama HTTP=%{http_code}\n' http://127.0.0.1:11434/v1/models
echo "--- recent learnc errors ---"
tail -4 ~/.pm2/logs/learnc-error.log 2>/dev/null | head -c 600
echo
