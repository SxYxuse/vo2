#!/usr/bin/env bash
# playwright-cli on this checkout's session, run inside the current run folder so snapshots,
# console logs, and relative --filename paths land with the evidence.
#   scripts/pw.sh click "getByRole('button', { name: 'Previous week' })"
#   scripts/pw.sh screenshot --filename=calendar.png
#   scripts/pw.sh goto /settings/sync      (an app path is resolved against this checkout's PORT)
source "$(dirname "$0")/env.sh"
cd "$(current_run)"
args=()
prev=""
for arg in "$@"; do
  if [ "$prev" = goto ] && [ "${arg:0:1}" = / ]; then arg="$VO2_BASE$arg"; fi
  args+=("$arg")
  prev=$arg
done
exec playwright-cli -s="$VO2_SESSION" "${args[@]}"
