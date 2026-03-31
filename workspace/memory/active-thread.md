# Active Thread — 2026-03-31

## Active Task

`it-needs-to-run-locally-to-be-able-to-see`

## Goal (replace)

Keep Mission Control reliably accessible locally and from Francisco’s phone on local Wi‑Fi, with verified receipts before claiming completion.

## Current State (replace)

- Mission Control listener is active on port `8765`.
- Local access (`127.0.0.1:8765`) returns `200` + HTML.
- LAN plain path (`192.168.7.50:8765`) returns `403` when unauthenticated.
- Key-auth flow (`?key=...`) establishes session cookie and unlocks normal page load.
- User confirmed working state from phone and shared screenshot.
- Intermittent key mismatch can happen after restarts if process starts without explicit `DASHBOARD_KEY`.

## Locked Constraints

- [constraint][pinned] Must run locally.
- [constraint][pinned] Do not send hard-to-open links.
- [constraint][pinned] Verify in browser before saying complete.
- [constraint][pinned] User cannot rely on opening complex/non-clickable messages.

## Decisions (append + dedupe)

- Treat `403` on plain LAN URL as expected unauthenticated behavior, not server-down.
- Always provide one clean key-auth URL line for phone.
- Provide screenshot receipts when user asks for proof.
- Validate with process + HTTP receipts before sending “fixed”.

## Open Questions

- RESOLVED: Browser in screenshot? → In-app browser.
- RESOLVED: Safari 403 cause? → Fresh browser context with no session cookie.
- RESOLVED: Is local runtime up? → Yes, validated by listener + localhost 200.

## Next 3–7 Actions (replace snapshot)

1. Keep mission-control process alive on `8765`.
2. On any new 403 report, re-run plain/key/cookie sequence immediately.
3. Send one direct clickable key URL line only.
4. Re-capture and send screenshot proof when asked.
5. Confirm sustained phone stability, then close task lane state.

## Resume Checklist

- [x] Runtime started locally.
- [x] Local URL verified.
- [x] LAN auth flow verified.
- [x] User confirmed working.
- [ ] Continue monitoring until stable closeout.

## Key Entities

- **Task:** it-needs-to-run-locally-to-be-able-to-see
- **Service:** mission-control/activity-server.py
- **Primary URL (local):** http://127.0.0.1:8765
- **Primary URL (phone):** http://192.168.7.50:8765/?key=d594adfaf1059c978aa3c9bdfac5e7d5
- **User:** Francisco (Telegram 8438693397)
