---
summary: "First-run onboarding flow for Moltbot (macOS app)"
read_when:
  - Designing the macOS onboarding assistant
  - Implementing auth or identity setup
---
# Onboarding (macOS app)

This doc describes the **current** first‑run onboarding flow. The goal is a
smooth “day 0” experience: pick where the Gateway runs, connect auth, run the
wizard, and let the agent bootstrap itself.

## Page order (current)

1) Welcome + security notice
2) **Gateway selection** (Local / Remote / Configure later)
3) **Auth (Anthropic OAuth)** — local only
4) **Setup Wizard** (Gateway‑driven)
5) **Permissions** (TCC prompts)
6) **CLI** (optional)
7) **Onboarding chat** (dedicated session)
8) Ready

## 1) Local vs Remote

Where does the **Gateway** run?

- **Local (this Mac):** onboarding can run OAuth flows and write credentials
  locally.
- **Remote (over SSH/Tailnet):** onboarding does **not** run OAuth locally;
  credentials must exist on the gateway host.
- **Configure later:** skip setup and leave the app unconfigured.

Gateway auth tip:
- The wizard now generates a **token** even for loopback, so local WS clients must authenticate.
- If you disable auth, any local process can connect; use that only on fully trusted machines.
- Use a **token** for multi‑machine access or non‑loopback binds.

## 2) Local-only auth (Anthropic OAuth)

The macOS app supports Anthropic OAuth (Claude Pro/Max). The flow:

- Opens the browser for OAuth (PKCE)
- Asks the user to paste the `code#state` value
- Writes credentials to `~/.clawdbot/credentials/oauth.json`

Other providers (OpenAI, custom APIs) are configured via environment variables
or config files for now.

## 3) Setup Wizard (Gateway‑driven)

The app can run the same setup wizard as the CLI. This keeps onboarding in sync
with Gateway‑side behavior and avoids duplicating logic in SwiftUI.

## 4) Permissions

Onboarding requests TCC permissions needed for:

- Notifications
- Accessibility
- Screen Recording
- Microphone / Speech Recognition
- Automation (AppleScript)

## 5) CLI (optional)

The app can install the global `moltbot` CLI via npm/pnpm so terminal
workflows and launchd tasks work out of the box.

## 6) Onboarding chat (dedicated session)

After setup, the app opens a dedicated onboarding chat session so the agent can
introduce itself and guide next steps. This keeps first‑run guidance separate
from your normal conversation.

## Conversation guidance copy

Use this user-facing copy in onboarding screens, welcome cards, and tooltips:

- Welcome message:
  - Welcome!
  - I can remember things over time, but I work best when we focus on one task at a time.
  - When you start something new, just tell me what you are working on.
  - When you switch topics, let me know.
  - I will take care of the rest.
- Short memory tooltip:
  - I remember best when we work on one topic at a time.
  - Tell me when you start something new or switch topics.
- Starting a task:
  - When you begin a new project or topic, say it clearly.
  - Example: I want to work on supplier onboarding.
- Switching topics:
  - If you change to a different topic, tell me first.
  - This keeps things from getting mixed up.
- Coming back later:
  - You can come back anytime.
  - Say: Lets continue the task about X.
- Important details:
  - If something must not be forgotten, say so clearly.
  - I will treat it as important and keep it safe.
- Start fresh message:
  - Starting fresh clears the recent conversation, but I still remember saved tasks and important details.

Gentle auto prompts for the agent:

- Chat start or after long silence:
  - Before we begin - what would you like to work on?
- Sudden topic switch:
  - It looks like we may be switching topics. Is this something new?
- Long or complex task:
  - Would you like me to save where we are so we can continue later?
- Before start fresh:
  - I am clearing the recent conversation now.
  - Saved work is still safe. What would you like to work on next?
- Resuming old topic after reset:
  - I remember this task.
  - Do you want me to continue from where we left off?
- Critical statement:
  - Got it. I will treat this as important and remember it.
- Ongoing work with no clear task:
  - Just checking - should I treat this as one ongoing task?

One-line reminder:

- Tip: Tell me what you are working on, tell me when you switch, and tell me what matters.

## Agent bootstrap ritual

On the first agent run, Moltbot bootstraps a workspace (default `~/clawd`):

- Seeds `AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `USER.md`
- Runs a short Q&A ritual (one question at a time)
- Writes identity + preferences to `IDENTITY.md`, `USER.md`, `SOUL.md`
- Removes `BOOTSTRAP.md` when finished so it only runs once

## Optional: Gmail hooks (manual)

Gmail Pub/Sub setup is currently a manual step. Use:

```bash
moltbot webhooks gmail setup --account you@gmail.com
```

See [/automation/gmail-pubsub](/automation/gmail-pubsub) for details.

## Remote mode notes

When the Gateway runs on another machine, credentials and workspace files live
**on that host**. If you need OAuth in remote mode, create:

- `~/.clawdbot/credentials/oauth.json`
- `~/.clawdbot/agents/<agentId>/agent/auth-profiles.json`

on the gateway host.
