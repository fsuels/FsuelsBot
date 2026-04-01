# Chrome Test Profile — Operating Rules

## Pinned Preferences

- **[preference]** Always use Chrome "test" profile (`--profile-directory="Profile 1"`) for all browser work. Never open a separate Chrome instance/default profile.
- **[constraint]** To open new tabs in the test profile: use `open -na "Google Chrome" --args --profile-directory="Profile 1" "<URL>"` — this adds a tab to the existing test profile window. Do NOT use osascript to create tabs (it targets the default profile, not the test profile).
- **[preference]** Never replace the active tab URL — always open new tabs.
- **[constraint]** osascript `tell application "Google Chrome"` targets the default profile process. It CANNOT reliably target the test profile window. Avoid for tab creation/navigation in test profile.

## Decisions

- 2026-04-01: Learned that osascript Chrome commands target default profile, not test profile. Caused wrong-window tabs + accidental closure. Fix: use `open --args --profile-directory` exclusively for test profile tab management.
