# Cron Jobs — How to schedule reminders/jobs (Gateway)

## Why this exists

The `cron` tool has a strict schema. If you pass `text` or a string `schedule`, it will fail with:

- missing required: `name`, `sessionTarget`, `payload`
- `schedule` must be an object

## Correct schema (minimum viable)

```json
{
  "action": "add",
  "job": {
    "name": "Morning brief",
    "enabled": true,
    "schedule": { "kind": "cron", "expr": "0 7 * * *", "tz": "America/New_York" },
    "sessionTarget": "main",
    "wakeMode": "next-heartbeat",
    "payload": {
      "kind": "systemEvent",
      "text": "Reminder: send Francisco the morning brief…"
    }
  }
}
```

## Payload types

- `systemEvent`: fires as a system reminder text.
- `agentTurn`: sends a message into the agent session (optionally with model/thinking overrides).

## Notes

- Prefer `wakeMode: "next-heartbeat"` for scheduled jobs.
- Use `sessionTarget: "main"` unless isolation is required.

## Source of truth

See: `C:/Users/Fsuels/AppData/Roaming/npm/node_modules/clawdbot/dist/gateway/protocol/schema/cron.js`
