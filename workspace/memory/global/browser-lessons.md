# Browser Automation Lessons

## Decisions

- 2026-04-01: AppleScript cannot see Chrome windows running under Profile 1 (returns 0 windows). Must use `pkill` + `open -na` with `--profile-directory="Profile 1"` to reset tabs cleanly.
- 2026-04-01: Francisco caught duplicate tabs (3x dresslikemommy.com storefront, 2x admin). Each `open` command ADDS tabs, never replaces. Must check before opening.

## Pinned

- [constraint] ONE TAB PER DOMAIN — before opening any URL, verify no existing tab for that domain. Max 2 tabs for DLM work (storefront + admin). Repeated `open` calls accumulate tabs.
- [fact] Chrome Profile 1 is invisible to AppleScript (`count of windows` returns 0). Use `pkill -f "Google Chrome.*Profile 1"` then `open -na` to reset.
