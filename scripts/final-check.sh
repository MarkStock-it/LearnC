#!/bin/bash
echo "--- SPA page title ---"
curl -sk -m 10 https://learnc.dcism.org/ | grep -o '<title>[^<]*</title>'
echo "--- JS asset loads ---"
ASSET=$(curl -sk https://learnc.dcism.org/ | grep -o 'assets/index[^"]*\.js' | head -1)
echo "asset: $ASSET"
curl -sk -m 10 -o /dev/null -w "asset HTTP=%{http_code} size=%{size_download}\n" "https://learnc.dcism.org/$ASSET"
echo "--- SPA routing fallback (/sets/1) ---"
curl -sk -m 10 -o /dev/null -w "route HTTP=%{http_code}\n" https://learnc.dcism.org/sets/1
echo "--- problem sets API ---"
curl -sk -m 10 https://learnc.dcism.org/api/problem-sets | head -c 150
echo
echo "--- pm2 ---"
pm2 ls | grep learnc
echo "--- uptime + restarts of learnc since deploy ---"
pm2 describe learnc 2>/dev/null | grep -E "uptime|restarts" | head -2
