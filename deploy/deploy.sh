#!/usr/bin/env bash
#
# Deploy bbb-trading-ext to the DigitalOcean droplet (moreleadnow.com).
#
# Run this from your local machine, from anywhere inside the repo --
# it cd's to the repo root itself.
#
# What it does:
#   1. Refuses to run if you have uncommitted changes, or if local main
#      hasn't been pushed to origin/main yet (the droplet deploys via
#      `git pull`, never from your working tree directly -- push first).
#   2. SSHes into the droplet, pulls origin/main, rebuilds the
#      trading-console dashboard, restarts ext-server/market-server,
#      and reloads Caddy.
#
# Requirements:
#   - SSH key access to the droplet as $DROPLET_HOST (see deploy/README.md
#     "Local deploy access" section for how this was set up).
#
# Usage:
#   deploy/deploy.sh                # deploy to the default droplet
#   DROPLET_HOST=deploy@1.2.3.4 deploy/deploy.sh   # override target

set -euo pipefail

DROPLET_HOST="${DROPLET_HOST:-root@138.197.77.18}"
REMOTE_DIR="${REMOTE_DIR:-/opt/bbb-trading-ext}"

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Checking local working tree..."
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: you have uncommitted changes. Commit (and push) before deploying." >&2
  git status --short
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
  echo "ERROR: you're on branch '$BRANCH', not 'main'. Switch to main before deploying." >&2
  exit 1
fi

echo "==> Fetching origin/main to confirm you're pushed..."
git fetch origin main
LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse origin/main)"
if [[ "$LOCAL_SHA" != "$REMOTE_SHA" ]]; then
  echo "ERROR: local main ($LOCAL_SHA) differs from origin/main ($REMOTE_SHA)." >&2
  echo "Push your commits first: git push origin main" >&2
  exit 1
fi

echo "==> Deploying ${LOCAL_SHA:0:7} to $DROPLET_HOST:$REMOTE_DIR ..."
# shellcheck disable=SC2087
ssh "$DROPLET_HOST" REMOTE_DIR="$REMOTE_DIR" bash -s << 'REMOTE_SCRIPT'
set -euo pipefail
cd "$REMOTE_DIR"

echo "--> git pull --ff-only origin main"
git pull --ff-only origin main

echo "--> trading-console: npm install + build"
cd trading-console
npm install --no-audit --no-fund
npm run build

# `npm run build` empties dist/ (Vite's default emptyOutDir), which deletes
# the dist/data symlink that lets the built app read the runtime CSV/JSON
# files ext-server mirrors into trading-console/public/data. Recreate it
# every deploy -- see deploy/README.md.
rm -rf dist/data
ln -s ../public/data dist/data
cd ..

echo "--> restarting services"
systemctl restart ext-server.service market-server.service
systemctl reload caddy 2>/dev/null || true

echo "--> status"
systemctl --no-pager --lines=0 status ext-server.service market-server.service | cat
REMOTE_SCRIPT

echo "==> Deploy complete: ${LOCAL_SHA:0:7} is live."
