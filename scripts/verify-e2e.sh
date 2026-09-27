#!/bin/bash
echo "--- health via domain ---"
curl -sk -m 10 https://learnc.dcism.org/api/health
echo
echo "--- problem sets ---"
curl -sk -m 10 https://learnc.dcism.org/api/problem-sets | head -c 400
echo
echo "--- write submission payload ---"
cat > /tmp/sub.json <<'JSON'
{"problemId":1,"code":"#include <stdio.h>\nint main(void){int n,x;long long s=0;scanf(\"%d\",&n);for(int i=0;i<n;i++){scanf(\"%d\",&x);s+=x;}printf(\"%lld\\n\",s);return 0;}\n"}
JSON
echo "--- submit correct solution (problem 1) ---"
RESP=$(curl -sk -m 30 -X POST https://learnc.dcism.org/api/submissions -H 'Content-Type: application/json' -H 'Authorization: Bearer deploy-test' --data @/tmp/sub.json)
echo "$RESP"
SUBID=$(echo "$RESP" | grep -o '"submissionId":[0-9]*' | head -1 | cut -d: -f2)
echo "--- poll submission $SUBID ---"
sleep 2
curl -sk -m 20 "https://learnc.dcism.org/api/submissions/$SUBID" | head -c 500
echo
echo "--- AI probe (generate-problem, dry run) ---"
curl -sk -m 90 -X POST https://learnc.dcism.org/api/admin/generate-problem -H 'Content-Type: application/json' -H 'x-admin-token: $ADMIN_TOKEN' -d '{"difficulty":"easy","topics":["loops"],"testCaseCount":3,"publicTestCaseCount":1,"persist":false}' | head -c 600
echo
