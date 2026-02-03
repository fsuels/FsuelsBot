# Desktop Bridge (Windows) — MVP

**Goal:** Give the agent "eyes + hands" on a Windows desktop via a **local-only** HTTP API.

## Security model (MVP)
- Binds to **127.0.0.1** only (not LAN).
- Requires a bearer token in `X-Desktop-Token` header.
- **Read-only by default**; input endpoints require `control_enabled=true`.
- Manual enable/disable via `/control/enable` and `/control/disable`.

## Endpoints
- `GET /health` → status
- `GET /screen.png?monitor=1` → screenshot PNG
- `POST /input` → perform mouse/keyboard actions (only if control enabled)
- `POST /control/enable` → enable control (token required)
- `POST /control/disable` → disable control

## Install
```powershell
cd C:\dev\FsuelsBot\workspace\desktop-bridge
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python server.py
```

## Token
Token stored at: `memory/.desktop-bridge-token`.

## Notes
This is an MVP. Before widening access (LAN), we will add:
- per-action allowlist
- rate limiting
- kill switch
- audit log to events.jsonl
