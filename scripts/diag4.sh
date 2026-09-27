#!/bin/bash
echo "=== betterclss docroot .htaccess ==="
cat ~/betterclss.dcism.org/.htaccess 2>/dev/null
echo "=== pos-system docroot .htaccess ==="
cat ~/pos-system.dcism.org/.htaccess 2>/dev/null
ls ~/pos-system.dcism.org/ 2>/dev/null | head
echo "=== any .htaccess in home docroots ==="
find ~ -maxdepth 2 -name ".htaccess" 2>/dev/null | head
echo "=== betterclss htaccess of BCLSS app dir ==="
find ~/BetterCLSS -maxdepth 2 -name ".htaccess" 2>/dev/null -exec cat {} \;
echo "=== test betterclss api ==="
curl -sk -m 6 -o /dev/null -w "%{http_code}\n" https://betterclss.dcism.org/api/health 2>/dev/null
curl -sk -m 6 https://betterclss.dcism.org/api/health 2>/dev/null | head -c 200
echo
echo "=== curl pos-system follow ==="
curl -sk -m 6 -L https://pos-system.dcism.org 2>/dev/null | head -c 200
echo
