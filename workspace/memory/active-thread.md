# Active Thread — 2026-03-31

## Active Task

`it-needs-to-run-locally-to-be-able-to-see`

## Goal (replace)

Keep Mission Control reliably accessible locally and from Francisco’s phone on local Wi‑Fi, with verified receipts before claiming completion.

## Current State (replace)

- Mission Control is running on local machine at port `8765`.
- Local access (`127.0.0.1:8765`) is healthy.
- Phone/LAN access requires first opening key-auth URL to establish session.
- User confirmed successful access: “Now it works.”

## Locked Constraints

- [constraint][pinned] Must run locally.
- [constraint][pinned] Do not send hard-to-open links.
- [constraint][pinned] Verify in browser before saying complete.
- [constraint][pinned] User cannot rely on opening complex/non-clickable messages.

## Decisions (append + dedupe)

- Treat `403` on plain LAN URL as expected unauthenticated behavior, not server-down.
- Always provide one clean key-auth URL line for phone.
- Provide screenshot receipts when user asks for proof.

## Open Questions

- RESOLVED: Browser identity in screenshot? → In-app browser (not Safari).
- RESOLVED: Why Safari showed 403? → New browser context missing auth cookie; must open key URL directly in Safari.

## Next 3–7 Actions (replace snapshot)

1. Keep mission-control server alive on port 8765.
2. If Francisco reports 403 again, immediately retest LAN plain/key/cookie sequence.
3. Resend direct key URL as a single clickable line (no wrappers).
4. Capture/send new screenshot proof if failure is reported again.
5. After sustained stability, finalize task closure in queue state.

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
- **Primary URL (phone):** http://192.168.7.50:8765/?key=<configured-key>
- **User:** Francisco (Telegram 8438693397)
