# Mission Control Access Notes

Last updated: 2026-03-31

## Durable Facts

- [fact][pinned] Mission Control LAN endpoint may intentionally return `403` without auth session.
- [fact][pinned] Auth bootstrap path is key URL (`/?key=...`) which sets `mc_session` cookie and redirects.
- [fact][pinned] Switching from in-app browser to Safari starts a fresh browser context; cookie is not shared.
- [fact][pinned] If process restarts without explicit `DASHBOARD_KEY`, a new ephemeral key may be generated and old key links can fail.

## Durable Preferences

- [preference][pinned] Francisco prefers plain, directly clickable links in message body.
- [preference][pinned] Avoid sending non-clickable/complex wrapped link formats for urgent access fixes.

## Operating Rule

When user reports Mission Control phone access issues:

1. Verify process/listener on 8765.
2. Verify LAN plain URL (expect 403 if unauthenticated).
3. Verify key URL handshake (302 + cookie).
4. Send one clean key URL line to user.
5. Provide screenshot receipt if requested.
