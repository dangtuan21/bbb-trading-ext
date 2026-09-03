#!/usr/bin/env bash
# Starts the FX market-data server: listens on http://127.0.0.1:8766 for
# POST /fetch, which reads config.json's pair list, fetches TwelveData on
# demand, and writes market.csv/market-positions.csv (see server.js). No
# automatic polling -- trading-console's Market View "Refresh" button (or
# any other POST /fetch caller) is what triggers a fetch.
#
# Requires market-server/.env for TWELVEDATA_API_KEY -- if you haven't set
# it up yet, copy .env.example to .env and fill it in.
set -euo pipefail
cd "$(dirname "$0")"
node server.js
