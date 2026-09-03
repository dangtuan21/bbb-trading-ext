#!/usr/bin/env bash
# Starts ext-server (positions-tracker + Pushover notifier), market-server
# (FX rate poller), and trading-console (Vite dashboard) together. Ctrl+C
# stops all three.
#
# Logs go to logs/ext-server.log, logs/market-server.log, and
# logs/trading-console.log; tail -f them if you want to watch output from
# any one process. market-server needs market-server/.env (TWELVEDATA_API_KEY)
# set up first -- see market-server/.env.example -- or it exits immediately
# and its log will just show that.
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

./market-server/start.sh >logs/market-server.log 2>&1 &
pids+=("$!")

./trading-console/start.sh >logs/trading-console.log 2>&1 &
pids+=("$!")

echo "ext-server:      log at logs/ext-server.log (pid ${pids[0]})"
echo "market-server:   log at logs/market-server.log (pid ${pids[1]})"
echo "trading-console: log at logs/trading-console.log (pid ${pids[2]})"
echo "Press Ctrl+C to stop all three."

wait
