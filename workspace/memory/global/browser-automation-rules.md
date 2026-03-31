# Browser Automation Rules (macOS)

_Updated: 2026-02-22_

## Chrome JS from Apple Events

- **Cannot be toggled programmatically** — requires genuine user click in Chrome menu: View > Developer > Allow JavaScript from Apple Events
- `defaults write com.google.Chrome AppleScriptEnabled -bool true` does NOT work
- osascript menu clicks do NOT toggle this setting (Chrome security restriction)

## Browser Relay

- `moltbot browser tabs --json` — check connected tabs
- Restarting Chrome kills ALL relay connections
- Reconnect: user must click OpenClaw extension icon on target tab (badge turns ON)
- Playwright NOT installed — evaluate/snapshot/fill commands fail with "Playwright not available"
- CDP websocket at ws://127.0.0.1:18792/cdp requires auth (401 without correct token)

## Peekaboo Window Targeting

- Capture specific window: `peekaboo image --app "Google Chrome" --window-title "Shopify"`
- Avoids capturing wrong Chrome window when multiple are open
- `peekaboo image` (no args) captures frontmost which may be wrong window

## Fallback Strategy When Automation Fails

1. Don't fight it for more than 5 minutes
2. Prepare content as text and send via Telegram for manual paste
3. This is faster and more reliable than debugging Chrome automation mid-task
