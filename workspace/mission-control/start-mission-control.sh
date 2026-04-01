#!/bin/bash
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
export DASHBOARD_KEY="${DASHBOARD_KEY:-$(openssl rand -hex 16)}"
export MISSION_CONTROL_DISABLE_AUTH="0"
export MISSION_CONTROL_TRUST_LAN="1"
cd "$(dirname "$0")"
exec python3 activity-server.py "$@"
