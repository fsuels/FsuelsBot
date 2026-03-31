# Task: It needs to run locally to be able to see

- **Task ID:** `it-needs-to-run-locally-to-be-able-to-see`
- **Status:** in_progress
- **Lane:** bot_current
- **Last Updated:** 2026-03-31T05:33:00-04:00

## Goal (replace)

Run Mission Control locally and keep phone access working with a concrete, repeatable local access path.

## Current State (replace)

- Mission Control process is running locally on port `8765`.
- Localhost access is healthy (`http://127.0.0.1:8765` returns HTML).
- LAN direct access without auth key returns `403` by design.
- LAN access works after key handshake (`?key=...`) and session cookie issuance.
- User confirmed: **"Now it works"** and shared phone screenshot showing Mission Control loaded.

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

## Open Questions

- RESOLVED: Why Safari shows 403 after “Open in Safari”? → In-app browser session cookie is not shared to Safari; open full key URL directly in Safari.
- RESOLVED: Is service actually running locally? → Yes, process listens on `*:8765`, localhost returns `200` + HTML.

## Checklist Plan (resume-safe)

- [x] Start/verify local Mission Control runtime on port 8765.
- [x] Verify localhost HTML receipt (`127.0.0.1:8765`).
- [x] Verify LAN behavior (`192.168.7.50:8765` plain → 403 expected).
- [x] Verify auth flow (key URL → 302 + session cookie → 200 HTML).
- [x] Send phone-clickable URL and screenshot proof to user.
- [ ] **Current step:** keep watch; if 403 recurs, re-issue key URL and re-verify cookie handshake immediately.

## Execution Receipts

1. Process/listen receipt: Python `activity-server.py` listening on `*:8765`.
2. Local receipt: `curl -I http://127.0.0.1:8765` → `HTTP/1.0 200 OK`.
3. LAN auth receipt sequence:
   - `GET http://192.168.7.50:8765/` → `403`
   - `GET http://192.168.7.50:8765/?key=<configured-key>` → `302` + `mc_session` cookie
   - Follow-up `GET /` with cookie → `200` + `<!doctype html>`
4. Browser receipt (Chrome automation): `document.readyState=complete` on Mission Control page.
5. User receipt: "Now it works" + phone screenshot showing Mission Control UI loaded.

## Next Actions (replace snapshot)

1. Keep server running on `8765` and monitor for auth/session regressions.
2. If user opens from Safari again, resend one clean direct key URL line.
3. On next stable checkpoint, move task from `bot_current` to `done_today` with final receipt note.

## Key Entities (merge by stable key)

- **service:** mission-control/activity-server.py
- **local_url:** http://127.0.0.1:8765
- **lan_url:** http://192.168.7.50:8765
- **auth_mode:** key query param + `mc_session` cookie
- **user_device_context:** iPhone in-app browser + Safari handoff

## Pinned Items

- [fact][pinned] Plain LAN access is expected to return `403` until key/session auth is established.
- [fact][pinned] Direct key URL is required for first open in a new browser context.
- [preference][pinned] Send raw clickable links only; avoid hard-to-open formatted text.
- [temporary][pinned][expires:2026-04-02] Prioritize immediate Mission Control access support until user reports sustained stability.
