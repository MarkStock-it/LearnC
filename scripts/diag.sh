#!/bin/bash
# Remote diagnostics: how the other apps are wired (ports, vhosts, db).
echo "=== baljeetflow-app dir ==="
ls -la ~/baljeetflow-app/ 2>/dev/null | head -15
echo "=== baljeetflow pkg scripts ==="
grep -A8 '"scripts"' ~/baljeetflow-app/package.json 2>/dev/null
echo "=== BetterCLSS server.js listen ==="
grep -n 'listen\|PORT' ~/BetterCLSS/server.js 2>/dev/null | head -5
echo "=== pm2 process list (name, exec, port env) ==="
pm2 jlist 2>/dev/null | python3 -c '
import json,sys
for p in json.load(sys.stdin):
    env = p["pm2_env"].get("env", {})
    print(p["name"], "|", p["pm2_env"].get("pm_exec_path"), "|", p["pm2_env"].get("args"), "| PORT:", env.get("PORT"))
'
echo "=== listening ports with process names ==="
ss -tlnp 2>/dev/null | grep -E 'node|npm' | head -10
echo "=== docroots ==="
ls ~/baljeetflow.dcism.org/ 2>/dev/null | head -5
echo "=== my free 2xxxx ports in use ==="
ss -tln | awk '{print $4}' | grep -oE ':[0-9]+$' | tr -d ':' | sort -n | uniq | awk '$1 >= 20000 && $1 <= 21000' | tr '\n' ' '
echo
echo "=== postgres reachable databases attempt (learnc db, various users) ==="
for u in s25103705 learnc postgres; do
  PGPASSWORD=Jumong09 psql -h 127.0.0.1 -U "$u" -d learnc -tAc 'select 1' 2>&1 | head -1 | sed "s/^/user=$u: /"
done
echo "=== github reachability from server ==="
GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes" git ls-remote https://github.com/MarkStock-it/LearnC.git HEAD 2>&1 | head -2
echo "=== llamacpp server: who runs it (best effort) ==="
curl -s -m 5 http://127.0.0.1:11434/v1/models | head -c 800
echo
