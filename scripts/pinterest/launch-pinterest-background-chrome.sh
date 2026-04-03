#!/bin/zsh
set -euo pipefail

PROFILE_DIR="${HOME}/.openclaw/pinterest-background-chrome"
PORT="${PINTEREST_CHROME_DEBUG_PORT:-9333}"
START_URL="${PINTEREST_START_URL:-https://www.pinterest.com/pin-builder/}"
PROFILE_NAME="${PINTEREST_CHROME_PROFILE_NAME:-Profile 1}"

mkdir -p "$PROFILE_DIR"

open -g -na "/Applications/Google Chrome.app" --args \
  --user-data-dir="$PROFILE_DIR" \
  --profile-directory="$PROFILE_NAME" \
  --remote-debugging-port="$PORT" \
  --no-first-run \
  --no-default-browser-check \
  --new-window \
  --start-minimized \
  "$START_URL"

echo "Launched background Chrome profile"
echo "Profile: $PROFILE_DIR"
echo "CDP: http://127.0.0.1:$PORT"
