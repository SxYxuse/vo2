#!/usr/bin/env bash
# Read a side effect from this checkout's database (never `vo2`, the main checkout's), and save
# the query and its result in the current run folder as <name>.sql.txt.
#   scripts/db.sh <name> "select count(*) from coach_chats"
source "$(dirname "$0")/env.sh"
name=${1:?usage: db.sh <name> "<sql>"}
sql=${2:?usage: db.sh <name> "<sql>"}
out="$(current_run)/$name.sql.txt"
{
  echo "-- database $VO2_DB, $(date -Is)"
  echo "$sql"
  echo
  docker exec vo2-postgres psql -U vo2 -d "$VO2_DB" -c "$sql"
} | tee "$out"
