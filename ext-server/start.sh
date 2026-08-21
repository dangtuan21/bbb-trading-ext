#!/usr/bin/env bash
# Starts the local positions-tracker server: the /write endpoint every
# platform extension posts to, and the Pushover warning-notification check
# that runs after each write (see server.js).
#
# Requires ext-server/.env for Pushover credentials -- if you haven't set
# it up yet, copy .env.example to .env and fill in PUSHOVER_USER_KEY /
# PUSHOVER_API_TOKEN. Editing .env later requires restarting this script
# (Ctrl+C, then run it again) to pick up the change -- see the .env-loading
# comment at the top of server.js for why.
set -euo pipefail
cd "$(dirname "$0")"
node server.js
