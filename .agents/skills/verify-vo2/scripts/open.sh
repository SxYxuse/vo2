#!/usr/bin/env bash
# Opens this checkout's browser session signed in as the seeded athlete, in a new run folder.
#   scripts/open.sh <label> [phone|desktop] [path]
# phone = Chromium phone emulation (default), desktop = 1280x900 Chromium. WebKit evidence comes
# from `vp run e2e -g "<screen>" --project=webkit` (Docker), not from this browser.
# Prints the run folder; scripts/pw.sh then works inside it.
source "$(dirname "$0")/env.sh"
label=${1:?usage: open.sh <label> [phone|desktop] [path]}
size=${2:-phone}
path=${3:-/}

case "$size" in
  phone) flags=(--mobile) ;;
  desktop) flags=() ;;
  *) echo "open: size is phone or desktop, not $size" >&2; exit 1 ;;
esac

run="$VO2_EVIDENCE/$(date +%Y%m%d-%H%M%S)-$label-$size"
mkdir -p "$run"
ln -sfn "$run" "$VO2_EVIDENCE/current"
cd "$run"

playwright-cli -s="$VO2_SESSION" close >/dev/null 2>&1 || true
playwright-cli -s="$VO2_SESSION" open "${flags[@]}" >/dev/null
[ "$size" = desktop ] && playwright-cli -s="$VO2_SESSION" resize 1280 900 >/dev/null
playwright-cli -s="$VO2_SESSION" goto "$VO2_BASE/api/mock-strava/dev/sign-in" >/dev/null
[ "$path" = / ] || playwright-cli -s="$VO2_SESSION" goto "$VO2_BASE$path" >/dev/null
"$VO2_SCRIPTS/settle.sh" >/dev/null
echo "$run"
