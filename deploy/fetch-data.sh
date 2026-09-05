#!/usr/bin/env bash
#
# Pull a snapshot of the droplet's live data files into your local
# trading-console/public/data, so `npm run dev` has something real to
# render. Read-only on the droplet -- this never writes anything there.
#
# Also copies positions.csv into ext-server/positions.csv: that's the file
# market-server actually reads from (see market-server/server.js's
# POSITIONS_FILE) when you click "Refresh" in Market View -- without it,
# the refresh call succeeds but market-positions.csv never gets (re)built
# because market-server sees zero rows to work from.
#
# Usage:
#   deploy/fetch-data.sh
#   DROPLET_HOST=deploy@1.2.3.4 deploy/fetch-data.sh   # override target

set -euo pipefail

DROPLET_HOST="${DROPLET_HOST:-root@138.197.77.18}"
REMOTE_DIR="${REMOTE_DIR:-/opt/bbb-trading-ext}"

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEST="trading-console/public/data"
mkdir -p "$DEST"

FILES=(positions.csv market-positions.csv market.csv config.json)

echo "==> Pulling live data from $DROPLET_HOST:$REMOTE_DIR/trading-console/public/data ..."
for f in "${FILES[@]}"; do
  echo "--> $f"
  scp -q "$DROPLET_HOST:$REMOTE_DIR/trading-console/public/data/$f" "$DEST/$f" \
    || echo "    (skipped -- not present on the droplet yet)"
done

if [ -f "$DEST/positions.csv" ]; then
  echo "--> mirroring positions.csv into ext-server/positions.csv (so market-server's Refresh has rows to build from)"
  mkdir -p ext-server
  cp "$DEST/positions.csv" ext-server/positions.csv
fi

echo "==> Done. Run 'cd trading-console && npm run dev' to view it locally."
