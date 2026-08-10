#!/usr/bin/env bash
# Regenerates docs/screenshots/*.png - the images the README embeds.
#
# The app is served in demo mode (angular.json's `demo` configuration swaps
# src/main.ts for src/main.demo.ts, which installs the mock backend in
# src/demo/) and driven by headless Chromium. That is why this needs no
# broker, no database and no display: the point is that two runs on two
# machines produce the same pixels, so a screenshot diff means the UI changed.
#
# The example data on screen lives in src/demo/demo-data.ts; the list of shots
# lives in scripts/screenshots.mjs. This script only owns the dev server.
set -euo pipefail

PORT=1421
BASE_URL="http://localhost:${PORT}"

usage() {
  cat <<'EOF'
Usage: scripts/screenshots.sh [shot-name ...]

With no arguments, recaptures every screenshot. Names limit it to a subset:

  scripts/screenshots.sh                        # all of them
  scripts/screenshots.sh broker-workspace       # just one
  scripts/screenshots.sh connections templates-management

Writes into docs/screenshots/ and changes nothing else - review the result
with `git diff --stat docs/screenshots/` before committing.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if ! command -v npx >/dev/null; then
  echo "error: npx is required but not found on PATH" >&2
  exit 1
fi

if [[ ! -d node_modules/playwright ]]; then
  echo "error: playwright is not installed - run 'npm install' first" >&2
  exit 1
fi

# Chromium lives outside node_modules (in ~/.cache/ms-playwright), so a fresh
# clone has the package but not the browser. This is a no-op once it's there.
npx playwright install chromium

log_file="/tmp/bme-screenshots-serve.log"

# Refuse to run against something we did not start. A server already on this
# port answers every readiness check while serving whatever it last built -
# which is how a run once captured a stale bundle and wrote a screenshot of a
# build-error overlay into docs/.
if curl -fsS "$BASE_URL" >/dev/null 2>&1; then
  cat >&2 <<EOF
error: something is already serving ${BASE_URL}

If a previous run leaked its dev server, stop it first:
  pkill -f 'ng serve --configuration demo'
EOF
  exit 1
fi

server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]]; then
    # Children first: the server spawns workers that outlive their parent, and
    # an orphan holding the port is exactly the failure described above.
    pkill -P "$server_pid" 2>/dev/null || true
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "Starting the demo dev server on port ${PORT}…"
# The local binary, not `npx`: `npx` is an extra process between this script
# and the server, and killing it leaves the server running.
node_modules/.bin/ng serve --configuration demo --port "$PORT" >"$log_file" 2>&1 &
server_pid=$!

# Wait for a *successful build*, not merely an open port - the port opens
# before the first bundle exists, and a failed build still serves an index.html.
for _ in $(seq 1 180); do
  if grep -q "Application bundle generation complete" "$log_file"; then
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "error: the dev server exited - see $log_file" >&2
    tail -5 "$log_file" >&2
    exit 1
  fi
  sleep 1
done

if ! grep -q "Application bundle generation complete" "$log_file"; then
  echo "error: the dev server did not produce a build within 180s" >&2
  tail -5 "$log_file" >&2
  exit 1
fi

echo "Capturing…"
BME_DEMO_URL="$BASE_URL" node scripts/screenshots.mjs "$@"

cat <<'EOF'

Done. Next steps:
  1. git diff --stat docs/screenshots/   # which images actually changed
  2. Open the changed ones and check they still show what the README's
     caption and alt text claim.
  3. Commit the images together with the UI change that caused them.
EOF
