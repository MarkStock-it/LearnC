#!/bin/bash
# Copies a file to the DCISM web host via scp (password via expect).
# Usage: bash scripts/remote-put.sh <local-file> <remote-relative-name>
export SSHPASS='Jumong09'
HOST="s25103705@web.dcism.org"
PORT="22077"
SRC="$1"
DST="$2"
exec expect -c "
set timeout 600
log_user 1
spawn scp -O -o StrictHostKeyChecking=accept-new -P $PORT \"$SRC\" $HOST:$DST
expect {
  \"*assword:\" { send \"\$env(SSHPASS)\r\"; exp_continue }
  eof
}
catch wait result
exit [lindex \$result 3]
"
