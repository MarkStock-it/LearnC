#!/bin/bash
# Copies a file to the DCISM web host via scp (password via expect).
#
# Credentials are NOT stored here. Export DCISM_SSHPASS in your shell first:
#   export DCISM_SSHPASS='...'   # then: bash scripts/remote-put.sh <file> <name>
#
# Optional overrides: DCISM_HOST, DCISM_USER, DCISM_PORT.
set -eu
: "${DCISM_SSHPASS:?Set DCISM_SSHPASS before calling this script}"
export SSHPASS="$DCISM_SSHPASS"
HOST="${DCISM_USER:-s25103705}@${DCISM_HOST:-web.dcism.org}"
PORT="${DCISM_PORT:-22077}"
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
