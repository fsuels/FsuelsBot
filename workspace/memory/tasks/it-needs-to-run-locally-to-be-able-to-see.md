# Task: It needs to run locally to be able to see

- **Task ID:** `it-needs-to-run-locally-to-be-able-to-see`
- **Status:** in_progress
- **Lane:** bot_current
- **Last Updated:** 2026-03-31T05:45:00-04:00

## Goal (replace)

Run Mission Control locally and keep phone access working with a concrete, repeatable local access path.

## Current State (replace)

- Mission Control is running locally on port `8765`.
- Local URL works: `http://127.0.0.1:8765` returns HTML.
- LAN plain URL intentionally returns `403` until auth session is established.
- Auth flow works with key URL: `302` + `mc_session` cookie, then `200` HTML.
- User confirmed: **"Now it works"** and shared phone screenshot.
- Ongoing risk observed: occasional process restarts without fixed `DASHBOARD_KEY` can rotate key and re-trigger 403 on phone.

## Locked Constraints

- [constraint][pinned] Must run locally on this machine (not remote-only).
- [constraint][pinned] User cannot open complicated/non-clickable links from chat.
- [constraint][pinned] Verify before claiming complete.
- [constraint][pinned] Keep instructions mobile-friendly and minimal.

## Decisions (append + dedupe)

- Keep Mission Control bound to LAN-capable host for phone visibility (`0.0.0.0:8765`).
- Require auth-key URL first-load flow for phone/browser transitions.
- Use direct plain URL line only (no markdown wrappers) when sending links to user.
- Prefer screenshot proof before saying “fixed” when user reports access failure.
- Treat plain `403` on LAN as auth-state issue unless process/listener checks fail.

## Open Questions

- RESOLVED: Which browser is shown in screenshot? → In-app browser (not Safari).
- RESOLVED: Why Safari can show 403 after “Open in Safari”? → Cookie/session not shared; open full key URL directly in Safari.
- RESOLVED: Is local runtime actually up? → Yes, listener on `*:8765` and localhost `200` with HTML.

## Checklist Plan (resume-safe)

- [x] Start/verify local Mission Control runtime on port 8765.
- [x] Verify localhost HTML receipt (`127.0.0.1:8765`).
- [x] Verify LAN behavior (`192.168.7.50:8765` plain → 403 expected).
- [x] Verify auth flow (key URL → 302 + session cookie → 200 HTML).
- [x] Send phone-clickable URL and screenshot proof to user.
- [ ] **Current step:** stabilize key consistency across restarts and keep watch; if 403 recurs, re-issue key URL and re-verify cookie handshake immediately.

## Execution Receipts

- Process/listen receipt: Python `activity-server.py` listening on `*:8765`.
- Local receipt: `curl -I http://127.0.0.1:8765` → `HTTP/1.0 200 OK`.
- LAN auth receipt sequence:
  - `GET http://192.168.7.50:8765/` → `403`
  - `GET http://192.168.7.50:8765/?key=d594adfaf1059c978aa3c9bdfac5e7d5` → `302` + `mc_session` cookie
  - follow-up `GET /` with cookie → `200` + `<!doctype html>`
- Browser receipt (Chrome automation): `document.readyState=complete` on Mission Control page.
- User receipt: “Now it works” + phone screenshot showing Mission Control UI loaded.

## Next Actions (replace snapshot)

1. Keep server running on `8765` and monitor for auth/session regressions.
2. If user reports 403 again, immediately re-run plain/key/cookie verification sequence.
3. Send one clean key URL line only (clickable, no wrappers).
4. Capture/send screenshot proof on any new regression report.
5. After sustained stability, move task from `bot_current` to `done_today` with final receipt note.

## Key Entities (merge by stable key)

- **service:** mission-control/activity-server.py
- **local_url:** http://127.0.0.1:8765
- **lan_url:** http://192.168.7.50:8765
- **auth_mode:** key query param + `mc_session` cookie
- **stable_key_reference:** d594adfaf1059c978aa3c9bdfac5e7d5
- **user_device_context:** iPhone in-app browser + Safari handoff

## Pinned Items

- [fact][pinned] Plain LAN access is expected to return `403` until key/session auth is established.
- [fact][pinned] Direct key URL is required for first open in a new browser context.
- [preference][pinned] Send raw clickable links only; avoid hard-to-open formatted text.
- [temporary][pinned][expires:2026-04-02] Prioritize immediate Mission Control access support until user reports sustained stability.
