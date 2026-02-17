# BOOTSTRAP.md — First Actions on Session Start

## Mission Control (MANDATORY)

On every session start:
1. Open Chrome to Mission Control: `open -a "Google Chrome" "http://localhost:18789"`
2. Report both URLs to Francisco:
   - 💻 Computer: http://localhost:18789
   - 📱 Mobile: http://192.168.7.50:18789

This is non-negotiable. Francisco must always have Mission Control access.

## Standard Checks

After Mission Control:
1. Read `memory/tasks.json` for active work
2. Continue with HEARTBEAT.md if this is a heartbeat poll
