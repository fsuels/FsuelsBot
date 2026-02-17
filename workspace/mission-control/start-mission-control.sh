#!/bin/bash
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
export DASHBOARD_KEY="d594adfaf1059c978aa3c9bdfac5e7d5"
cd "$(dirname "$0")"
exec python3 activity-server.py "$@"
