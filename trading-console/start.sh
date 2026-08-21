#!/usr/bin/env bash
# Starts the trading-console dashboard (Vite dev server, hot reload).
# Installs dependencies first if node_modules is missing.
#
# The dashboard only fetches public/data/positions.csv once on page load
# (no auto-refresh) -- reload the browser tab after ext-server writes fresh
# data. Run ext-server/start.sh separately for that part.
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  npm install
fi
npm run dev
