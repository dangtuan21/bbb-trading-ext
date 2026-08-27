#!/usr/bin/env bash
# Starts both ext-server (positions-tracker + Pushover notifier) and
# trading-console (Vite dashboard) together. Ctrl+C stops both.
#
# Logs go to logs/ext-server.log and logs/trading-console.log; tail -f
# them if you want to watch output from either process.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p logs

pids=()
cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

./ext-server/start.sh >logs/ext-server.log 2>&1 &
pids+=("$!")

./trading-console/start.sh >logs/trading-console.log 2>&1 &
pids+=("$!")

echo "ext-server:      log at logs/ext-server.log (pid ${pids[0]})"
echo "trading-console: log at logs/trading-console.log (pid ${pids[1]})"
echo "Press Ctrl+C to stop both."

wait
