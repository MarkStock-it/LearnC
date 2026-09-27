#!/bin/bash
# Runs a remote command on the DCISM web host via SSH (password via expect).
#
# Credentials are NOT stored here. Export DCISM_SSHPASS in your shell first:
#   export DCISM_SSHPASS='...'   # then: bash scripts/remote.sh "command"
#
# Optional overrides: DCISM_HOST, DCISM_USER, DCISM_PORT.
set -eu
: "${DCISM_SSHPASS:?Set DCISM_SSHPASS before calling this script}"
export SSHPASS="$DCISM_SSHPASS"
HOST="${DCISM_USER:-s25103705}@${DCISM_HOST:-web.dcism.org}"
PORT="${DCISM_PORT:-22077}"
CMD="$1"
# Escape $ so Tcl does not try to interpolate remote-shell variables.
CMD_ESC=${CMD//\$/\\$}
exec expect -c "
set timeout 300
log_user 1
spawn ssh -o StrictHostKeyChecking=accept-new -p $PORT $HOST \"$CMD_ESC\"
expect {
  \"*assword:\" { send \"\$env(SSHPASS)\r\"; exp_continue }
  eof
}
catch wait result
exit [lindex \$result 3]
"
