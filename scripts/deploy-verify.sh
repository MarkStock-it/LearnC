#!/usr/bin/env bash
# Deploy verification: HMAC token roundtrip through the real HTTP API
set -u
BASE=http://127.0.0.1:20341
U="deploy$RANDOM$RANDOM"

R=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U\",\"password\":\"DeployCheck123!\"}")
echo "REGISTER: $(echo "$R" | head -c 240)"

T=$(printf '%s' "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
echo "token prefix: ${T:0:24}..."

ME=$(curl -s -w '\nHTTP %{http_code}' "$BASE/api/auth/me" -H "Authorization: Bearer $T")
echo "ME (register token): $ME"

L=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U\",\"password\":\"DeployCheck123!\"}")
T2=$(printf '%s' "$L" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
ME2=$(curl -s -w '\nHTTP %{http_code}' "$BASE/api/auth/me" -H "Authorization: Bearer $T2")
echo "ME (login token): $ME2"
