#!/usr/bin/env bash
# Read-only: is this checkout's running instance worth driving? Exits 1 on the first failure.
source "$(dirname "$0")/env.sh"
set +e
fail() { echo "✗ $1"; exit 1; }
ok() { echo "✓ $1"; }

pid=$(port_pid)
[ -n "$pid" ] || fail "Nothing listens on $VO2_PORT. Fix: scripts/launch.sh."
is_ours "$pid" || fail "PID $pid on $VO2_PORT runs from $(readlink "/proc/$pid/cwd"), not $VO2_ROOT. Do not drive it."
ok "PID $pid on $VO2_BASE is this checkout's dev server"

tr '\0' '\n' <"/proc/$pid/environ" 2>/dev/null | grep -qx 'STRAVA_MOCK=1' ||
  fail "The server runs without STRAVA_MOCK=1. Fix: scripts/cleanup.sh, then scripts/launch.sh."
code=$(curl -s -o /dev/null -w '%{http_code}' "$VO2_BASE/api/mock-strava/api/v3/push_subscriptions")
[ "$code" = 200 ] || fail "Mock Strava answers $code, not 200."
ok "mock Strava is on"

state="$VO2_ROOT/.dev-seed/athlete.json"
[ -f "$state" ] || fail "No seeded athlete ($state). Fix: scripts/launch.sh."
cookie=$(python3 -c 'import json,sys;print("; ".join(c["name"]+"="+c["value"] for c in json.load(open(sys.argv[1]))["cookies"]))' "$state")
session=$(curl -s -H "Cookie: $cookie" "$VO2_BASE/api/auth/get-session")
[ "${session:0:1}" = "{" ] || fail "The seeded athlete's session is not valid (got: ${session:0:60}). Fix: scripts/launch.sh."
ok "the seeded athlete's session is valid"

user=$(docker exec vo2-postgres psql -U vo2 -d "$VO2_DB" -Atc \
  "select coalesce((select status from sync_runs s where s.user_id = u.id), 'never synced'),
          (select count(*) from activities a where a.user_id = u.id)
   from \"user\" u join account c on c.user_id = u.id and c.provider_id = 'strava' and c.account_id = '1'" 2>&1)
[ -n "$user" ] && [ "${user#ERROR}" = "$user" ] || fail "No mock athlete in database $VO2_DB (${user:-empty}). Fix: scripts/launch.sh."
ok "database $VO2_DB: mock athlete sync=${user%%|*}, activities=${user##*|}"
echo "branch $(git -C "$VO2_ROOT" branch --show-current) @ $(git -C "$VO2_ROOT" rev-parse --short HEAD)$(git -C "$VO2_ROOT" diff --quiet HEAD || echo ' + uncommitted changes')"
