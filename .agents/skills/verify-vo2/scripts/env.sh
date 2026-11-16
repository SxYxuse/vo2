set -euo pipefail

VO2_SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
VO2_ROOT=$(git -C "$VO2_SCRIPTS" rev-parse --show-toplevel)
VO2_CHECKOUT=$(basename "$VO2_ROOT")

env_value() { grep -E "^$1=" "$VO2_ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

VO2_PORT=$(env_value PORT)
VO2_PORT=${VO2_PORT:-3090}
VO2_BASE="http://localhost:$VO2_PORT"
VO2_DB=$(env_value DATABASE_URL | sed 's#.*/##; s#?.*##')
VO2_SESSION="vo2-${VO2_CHECKOUT: -12}"
VO2_EVIDENCE="${VO2_VERIFY_ROOT:-$HOME/.cache/vo2-verify}/$VO2_CHECKOUT"
VO2_SERVER_LOG="$VO2_EVIDENCE/dev-server.log"

port_pid() { ss -ltnpH "sport = :$VO2_PORT" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true; }

is_ours() { [ -n "${1:-}" ] && [ "$(readlink "/proc/$1/cwd" 2>/dev/null)" = "$VO2_ROOT" ]; }

current_run() {
  local run
  run=$(readlink "$VO2_EVIDENCE/current" 2>/dev/null) || {
    echo "No run open: start one with scripts/open.sh." >&2
    exit 1
  }
  echo "$run"
}
