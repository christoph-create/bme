#!/usr/bin/env bash
# Clears the update-check state so the *automatic* startup popup can be tested
# again: without this, the 24h throttle keeps the check silent and a previously
# skipped version stays hidden.
#
# Pair it with BME_UPDATE_VERSION, which makes the app report an older version
# than it is - otherwise there is never anything newer to offer:
#
#   scripts/reset-update-check.sh
#   BME_UPDATE_VERSION=0.1.0 npm run tauri dev
#
# The manual "Check for updates" button ignores the throttle, so for that one
# the env var alone is enough.
set -euo pipefail

case "$(uname -s)" in
    Darwin) db="$HOME/Library/Application Support/com.christoph.bme/bme.sqlite3" ;;
    *)      db="${XDG_DATA_HOME:-$HOME/.local/share}/com.christoph.bme/bme.sqlite3" ;;
esac

if [ ! -f "$db" ]; then
    echo "no database at $db - start the app once first" >&2
    exit 1
fi

# python3 rather than the sqlite3 CLI, which isn't installed everywhere.
python3 - "$db" <<'PY'
import sqlite3, sys

conn = sqlite3.connect(sys.argv[1])
before = dict(conn.execute("SELECT key, value FROM app_settings WHERE key LIKE 'update.%'"))
conn.execute("DELETE FROM app_settings WHERE key LIKE 'update.%'")
conn.commit()

print("cleared:" if before else "nothing to clear - update state was already empty")
for key, value in before.items():
    print(f"  {key} = {value}")
PY
