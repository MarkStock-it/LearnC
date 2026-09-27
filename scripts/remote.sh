#!/bin/bash
# Runs a remote command on the DCISM web host via SSH (password via expect).
# Usage: bash scripts/remote.sh "command string"
export SSHPASS='Jumong09'
HOST="s25103705@web.dcism.org"
PORT="22077"
CMD="$1"
# Escape $ so Tcl does not try to interpolate remote-shell variables.
CMD_ESC=${CMD//\$/\\$}
exec expect -c "
set timeout 120
log_user 1
spawn ssh -o StrictHostKeyChecking=accept-new -p $PORT $HOST \"$CMD_ESC\"
expect {
  \"*assword:\" { send \"\$env(SSHPASS)\r\"; exp_continue }
  eof
}
catch wait result
exit [lindex \$result 3]
"
