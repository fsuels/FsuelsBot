#!/bin/zsh
set -euo pipefail

osascript <<'EOF'
set safariState to "Safari: not running"
set chromeState to "Google Chrome: not running"
set frontApp to ""

tell application "System Events"
  set frontApp to name of first application process whose frontmost is true
end tell

if application "Safari" is running then
  tell application "Safari"
    if (count of documents) > 0 then
      set safariState to "Safari\nTitle: " & (name of front document) & "\nURL: " & (URL of front document)
    else
      set safariState to "Safari\nTitle: <no document>\nURL: <none>"
    end if
  end tell
end if

if application "Google Chrome" is running then
  tell application "Google Chrome"
    if (count of windows) > 0 then
      set chromeState to "Google Chrome\nTitle: " & (title of active tab of front window) & "\nURL: " & (URL of active tab of front window)
    else
      set chromeState to "Google Chrome\nTitle: <no window>\nURL: <none>"
    end if
  end tell
end if

return "Frontmost app: " & frontApp & "\n\n" & safariState & "\n\n" & chromeState
EOF
