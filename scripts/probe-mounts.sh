#!/bin/bash
# Probe: tmpfs mount + read-only root remount inside a user namespace.
unshare --user --map-root-user --mount --pid --fork --kill-child=SIGKILL --mount-proc=/proc /bin/sh -c '
  set -e
  mount --make-rprivate /
  mkdir -p /tmp/wtest
  mount -t tmpfs -o size=32m,nosuid,nodev tmpfs /tmp/wtest
  mount -o remount,ro,bind /
  echo writable > /tmp/wtest/ok
  echo "TMPFS-WRITE-OK"
  if touch /should-fail 2>/dev/null; then echo "ROOT-STILL-WRITABLE"; else echo "ROOT-RO-OK"; fi
' 2>&1
echo "EXIT=$?"
