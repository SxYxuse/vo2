#!/usr/bin/env bash
# Starts this checkout's dev server against mock Strava and seeds the mock athlete.
#   scripts/launch.sh [dev:seed flags]   e.g. --coach-plan, --never-synced, --history 2
# Reuses a dev server this checkout already runs; refuses a PORT held by anything else.
source "$(dirname "$0")/env.sh"
cd "$VO2_ROOT"
mkdir -p "$VO2_EVIDENCE"

pid=$(port_pid)
if [ -n "$pid" ] && ! is_ours "$pid"; then
  echo "launch: port $VO2_PORT is held by PID $pid from $(readlink "/proc/$pid/cwd"), not this checkout. Not touching it." >&2
  exit 1
fi

if [ -z "$pid" ]; then
  vp run db:up >/dev/null
  if ! vp run doctor; then
    echo "launch: fix what doctor reports, then run launch again." >&2
    exit 1
  fi
  [ -d node_modules/.bin ] || bun install --frozen-lockfile
  echo "launch: starting vp run dev:mock on $VO2_BASE (log: $VO2_SERVER_LOG)"
  setsid nohup vp run dev:mock >"$VO2_SERVER_LOG" 2>&1 </dev/null &
else
  echo "launch: reusing this checkout's dev server, PID $pid."
fi

# Ready means mock Strava answers through the app, not just that the port is open.
for _ in $(seq 1 90); do
  if curl -sf -o /dev/null "$VO2_BASE/api/mock-strava/api/v3/push_subscriptions"; then break; fi
  sleep 1
done
curl -sf -o /dev/null "$VO2_BASE/api/mock-strava/api/v3/push_subscriptions" || {
  echo "launch: $VO2_BASE did not serve mock Strava within 90 s. Last log lines:" >&2
  tail -20 "$VO2_SERVER_LOG" >&2
  exit 1
}
echo "launch: server PID $(port_pid) ready."

# A fresh mock athlete every launch: replaces the last one in this checkout's database only.
vp run dev:seed "$@"
