#!/bin/bash
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
cd "$(dirname "$0")"
exec python3 activity-server.py "$@"
