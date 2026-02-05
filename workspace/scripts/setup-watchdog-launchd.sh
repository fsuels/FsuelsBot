#!/bin/bash
#
# Sets up a macOS launchd agent to run the nonstop watchdog every 5 minutes
# Usage: ./setup-watchdog-launchd.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WATCHDOG_SCRIPT="$SCRIPT_DIR/nonstop-watchdog.sh"
PLIST_NAME="com.moltbot.nonstop-watchdog"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

# Ensure watchdog script is executable
chmod +x "$WATCHDOG_SCRIPT"

# Unload existing agent if present
if launchctl list | grep -q "$PLIST_NAME"; then
  echo "Removing existing launchd agent..."
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# Create the plist file
cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$WATCHDOG_SCRIPT</string>
        <string>--quiet</string>
    </array>

    <key>StartInterval</key>
    <integer>300</integer>

    <key>RunAtLoad</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$SCRIPT_DIR/../logs/watchdog.log</string>

    <key>StandardErrorPath</key>
    <string>$SCRIPT_DIR/../logs/watchdog-error.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
EOF

# Create logs directory if needed
mkdir -p "$SCRIPT_DIR/../logs"

# Load the agent
launchctl load "$PLIST_PATH"

echo ""
echo "✅ Launchd agent '$PLIST_NAME' installed successfully!"
echo ""
echo "   - Runs every 5 minutes"
echo "   - Alerts if idle >10 minutes with pending tasks"
echo "   - Logs: $SCRIPT_DIR/../logs/watchdog.log"
echo ""
echo "To test manually:"
echo "   bash \"$WATCHDOG_SCRIPT\""
echo ""
echo "To check status:"
echo "   launchctl list | grep moltbot"
echo ""
echo "To stop/unload:"
echo "   launchctl unload \"$PLIST_PATH\""
echo ""
