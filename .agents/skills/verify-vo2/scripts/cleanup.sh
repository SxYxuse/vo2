#!/usr/bin/env bash
# Closes this checkout's browser session and stops this checkout's dev server. Never kills by
# name: only the PID on this checkout's PORT whose cwd is this checkout. Keeps the evidence.
#   scripts/cleanup.sh [--keep-server]
source "$(dirname "$0")/env.sh"

playwright-cli -s="$VO2_SESSION" close >/dev/null 2>&1 && echo "cleanup: closed browser session $VO2_SESSION." || true

if [ "${1:-}" != --keep-server ]; then
  pid=$(port_pid)
  if [ -z "$pid" ]; then
    echo "cleanup: nothing listens on $VO2_PORT."
  elif ! is_ours "$pid"; then
    echo "cleanup: PID $pid on $VO2_PORT is not this checkout's; left running." >&2
  else
    kill "$pid"
    for _ in $(seq 1 20); do [ -z "$(port_pid)" ] && break; sleep 0.5; done
    [ -z "$(port_pid)" ] && echo "cleanup: stopped dev server PID $pid." || {
      echo "cleanup: PID $pid still holds $VO2_PORT after 10 s." >&2
      exit 1
    }
  fi
fi

rm -f "$VO2_EVIDENCE/current"
echo "cleanup: evidence kept in $VO2_EVIDENCE"
