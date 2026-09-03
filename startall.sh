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
#
# Before starting anything, kills whatever's already listening on each of
# the three ports (8765 ext-server, 8766 market-server, 5173 trading-console
# dev server) -- a previous run left orphaned (Ctrl+C didn't always reach a
# child in time, a crashed terminal, etc) is the most common cause of
# EADDRINUSE on the next ./startall.sh, so this makes re-running always safe
# instead of requiring a manual `lsof -ti:8765,8766,5173 | xargs kill -9`
# first.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p logs

PORTS=(8765 8766 5173)
for port in "${PORTS[@]}"; do
  existing="$(lsof -ti ":$port" 2>/dev/null || true)"
  if [ -n "$existing" ]; then
    echo "Port $port in use (pid(s) $existing) -- killing before start."
    kill -9 $existing 2>/dev/null || true
  fi
done

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
