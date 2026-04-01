---
created: 2026-03-31
source: auto-research agent analysis of src/ codebase
status: active
scope: OpenClaw gateway internals
---

# ADR-020: FsuelsBot Gateway Architecture

**Status:** Accepted
**Date:** 2026-03-31
**Author:** Architecture review (automated)
**Scope:** Full gateway system -- message ingestion through response delivery

---

## 1. System Overview

FsuelsBot is built on the **OpenClaw** framework. The gateway is a persistent WebSocket/HTTP server that:

1. **Receives** inbound messages from channel adapters (Telegram, WhatsApp, Discord, Signal, iMessage, Slack, Google Chat, web).
2. **Resolves** session state -- finding or creating a session keyed by sender + channel + agent.
3. **Processes** directives (inline commands like `/model`, `/think`, `/new`) and strips them before forwarding.
4. **Assembles** the system prompt from bootstrap files + hardcoded sections + runtime context.
5. **Dispatches** the user turn to an LLM provider via the embedded PI agent runner.
6. **Routes** the reply back through the originating channel adapter.

### End-to-end message flow

```
Channel Adapter (Telegram, etc.)
  --> Gateway WS/HTTP server  (server.impl.ts)
    --> dispatchInboundMessage  (auto-reply/dispatch.ts)
      --> getReplyFromConfig    (auto-reply/reply/get-reply.ts)
        --> initSessionState    (auto-reply/reply/session.ts)
        --> resolveReplyDirectives  (get-reply-directives.ts)
        --> runPreparedReply    (get-reply-run.ts)
          --> runReplyAgent     (agent-runner.ts)
            --> runAgentTurnWithFallback (agent-runner-execution.ts)
              --> runEmbeddedPiAgent  (agents/pi-embedded-runner/)
                --> LLM API call (Anthropic / OpenAI / LM Studio / Gemini)
      --> routeReply            (route-reply.ts)
        --> Channel Adapter send
```

---

## 2. Component Map

| Directory               | Purpose                                                                                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/gateway/`          | WebSocket + HTTP server, boot sequence, config reload, node registry, exec approval, health, TLS, channel manager, cron, hooks                                                                                    |
| `src/auto-reply/`       | Core message processing pipeline: envelope formatting, dispatch, command detection, debouncing, heartbeat, chunking, status                                                                                       |
| `src/auto-reply/reply/` | Reply orchestration: session init, directive handling, model selection, agent runner, queue management, block streaming, typing signals, memory flush                                                             |
| `src/agents/`           | Agent kernel: system prompt assembly, bootstrap file loading, PI embedded runner, model catalog, auth profiles, context budget, tool definitions, skills, subagent registry, plan mode, coherence/drift detection |
| `src/channels/`         | Channel abstraction: registry, typing, allowlists, sender identity, conversation labels, dock, plugins                                                                                                            |
| `src/telegram/`         | Telegram-specific: bot handlers, message dispatch, inline buttons, reactions, accounts, native commands, polls                                                                                                    |
| `src/config/`           | Configuration loading (`moltbot.json`), session store, channel capabilities, plugin auto-enable                                                                                                                   |
| `src/sessions/`         | Session utilities: model overrides, level overrides, send policy, task context, transcript events                                                                                                                 |
| `src/infra/`            | Infrastructure: diagnostic events, heartbeat runner, machine name, restart policy, skills remote, update checks, exec approval, ports                                                                             |
| `src/cli/`              | CLI program (`buildProgram()`), deps, formatting                                                                                                                                                                  |
| `src/commands/`         | High-level CLI commands (`agent`, `gateway run`, `message send`, etc.)                                                                                                                                            |
| `src/memory/`           | Memory system: pins, task memory, search                                                                                                                                                                          |
| `src/plugins/`          | Plugin SDK, hook runner, services                                                                                                                                                                                 |
| `src/hooks/`            | Lifecycle hooks (pre/post message, config change)                                                                                                                                                                 |
| `src/providers/`        | Provider abstraction layer                                                                                                                                                                                        |
| `src/browser/`          | Browser automation tools                                                                                                                                                                                          |
| `src/web/`              | Web UI / Control UI assets                                                                                                                                                                                        |
| `src/tui/`              | Terminal UI                                                                                                                                                                                                       |

---

## 3. Session Lifecycle

### Creation

Sessions are identified by a **session key** derived from channel + sender + agent ID. The flow in `initSessionState()` (`auto-reply/reply/session.ts`):

1. `resolveSessionKey()` computes the key from the `MsgContext`.
2. `loadSessionStore()` reads `~/.clawdbot/agents/main/sessions/sessions.json` (cached with 45s TTL).
3. If no entry exists, a new `SessionEntry` is created with a fresh `sessionId` (UUID).
4. A session file (`.jsonl` transcript) is created/opened via `SessionManager` from `@mariozechner/pi-coding-agent`.

### Session Entry fields

Key fields on `SessionEntry` (defined in `config/sessions/types.ts`):

- `sessionId` -- UUID identifying the transcript file
- `channel`, `lastChannel` -- delivery routing
- `modelOverride`, `providerOverride` -- per-session model selection (set via `/model` directive)
- `model` -- display-only, set after inference by `session-usage.ts`
- `totalTokens` -- cumulative usage counter
- `tasks` -- map of `SessionTaskState` for task-switching
- `ttsAuto` -- text-to-speech mode
- Various coherence/drift/capability tracking fields

### Overflow & Reset

- **Context pressure**: `shouldAutoResetSessionForContextPressure()` checks estimated token usage against model context window. When pressure is high, bootstrap budget shrinks (70% head + 20% tail truncation).
- **Manual reset**: `/new` or `/reset` directives trigger session reset -- creates a new session file, preserves the `SessionEntry` metadata.
- **Compaction**: `compactEmbeddedPiSession()` runs automatic conversation compaction when context nears limits. A `compactionCount` tracks how many times this has occurred.
- **Auto-context reset**: When compaction fails or context overflow errors occur, the system auto-resets the session with an error message.
- **Session branching**: `forkSessionFromParent()` creates branched sessions from a parent's leaf node.

### Termination

Sessions are never truly deleted -- they persist in the store. Sessions can be:

- **Archived** via task management
- **Reset** to start fresh (new transcript file, old one preserved)
- **Overwritten** when the session store is updated

---

## 4. Model Selection Flow

Model selection is a multi-layered resolution (`auto-reply/reply/model-selection.ts` + `agents/model-selection.ts`):

### Resolution order (highest priority wins)

1. **Session `modelOverride` / `providerOverride`** -- set via `/model` Telegram directive, persisted in `SessionEntry` by `directive-handling.persist.ts`
2. **Heartbeat model** -- `agents.defaults.heartbeat.model` for scheduled heartbeat runs
3. **Agent default model** -- `resolveDefaultModel()` reads from agent config
4. **Global default** -- `models.default` in `moltbot.json`

### Key functions

- `resolveModelOverrideFromEntry()` -- reads `modelOverride` from the active `SessionEntry`
- `resolveDefaultModelForAgent()` -- resolves the default model for a given agent ID
- `resolveModelRefFromString()` -- parses a model string like `anthropic:claude-sonnet-4-20250514` into `{provider, model}`
- `buildAllowedModelSet()` -- constructs the set of models allowed for the current agent (per-agent allowlists)
- Fuzzy matching with bounded Levenshtein distance for `/model` directives

### Model fallback

`runWithModelFallback()` in `agents/model-fallback.ts` handles automatic failover when a provider returns errors. The fallback chain is configured per-agent.

### Auth profiles

Multiple API keys can be configured per provider. `agents/auth-profiles/` manages rotation, cooldowns, and failure tracking across keys.

---

## 5. System Prompt Assembly

The system prompt is built in three layers, assembled in `buildAgentSystemPromptArtifacts()` (`agents/system-prompt.ts`):

### Layer 1: Bootstrap files (workspace content)

Loaded by `resolveBootstrapContextForRun()` in `agents/bootstrap-files.ts`:

1. Scans `workspace/` for: `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `BOOTSTRAP.md`, `HEARTBEAT.md`, `MEMORY.md`, `IDENTITY.md`, `USER.md`
2. Each file is read and trimmed to `bootstrapMaxChars` (default 20,000; per-provider override via `models.providers.<id>.bootstrapMaxChars`)
3. Truncation preserves 70% head + 20% tail with a `[...truncated...]` marker
4. Context pressure dynamically shrinks the budget as sessions grow
5. Bootstrap hooks can override/augment files

### Layer 2: Hardcoded sections (system-prompt.ts)

Controlled by `promptMode` ("full" | "minimal" | "none"):

**Full mode sections:**

- Safety rules
- Skills (scan/select from `<available_skills>`)
- Memory Recall (memory_search guidance)
- Task Tracker (multi-step task management)
- Task Board (shared workspace tasks)
- Clarification (ask_user_question guidance)
- Waiting & Idle Work (sleep tool usage)
- User Identity (owner numbers)
- Operating Contract (edit/verify/scope rules)
- Verification Gate
- Planning Mode (read-only exploration)
- Reply Tags (`[[reply_to_current]]`)
- Tool Surface Updates (dynamic tool delta)
- Messaging (cross-session, message tool)
- Voice / TTS
- Documentation paths
- Subagent orchestration policy

**Minimal mode** strips most sections, keeping only tooling, workspace, and runtime info. Used for LM Studio and subagents.

### Layer 3: Tool definitions

`buildAgentSystemPromptArtifacts()` enumerates available tools with summaries and manuals. Core tools include: read, write, edit, apply*patch, grep, find, ls, exec, process, sleep, web_search, web_fetch, browser, canvas, nodes, cron, message, gateway, sessions*\*, task_tracker, verification_gate, image.

### Assembly

`assemblePromptSections()` concatenates all sections into the final system message, with caching markers for prompt caching optimization.

---

## 6. Agent Spawning

### Main agent

The primary agent runs via `runEmbeddedPiAgent()` (`agents/pi-embedded-runner/`), which:

1. Loads/creates the session file via `SessionManager`
2. Builds the system prompt (see section 5)
3. Creates tool definitions via `createOpenClawCodingTools()`
4. Calls the LLM with `streamSimple()` from `@mariozechner/pi-ai`
5. Processes tool calls in a loop until the agent produces a final text response

### Sub-agents

Spawned via the `sessions_spawn` tool or `/subagents` command:

- `agents/subagent-registry.ts` tracks active sub-agent runs (`SubagentRunRecord`)
- Each sub-agent gets its own session key (prefixed, e.g., `subagent:<id>`)
- Sub-agents can communicate via `sessions_send` (plain text messages between sessions)
- The `AGENT_LANE_SUBAGENT` lane provides concurrency isolation
- Sub-agents use `promptMode: "minimal"` by default to reduce token usage
- `commands-subagents.ts` provides `/subagents list|stop|log|send|info` commands

### Agent IDs

- Multiple agent configurations can exist (defined in config)
- `resolveSessionAgentId()` maps a session key to its agent ID
- Each agent has its own workspace directory, bootstrap files, and model defaults

---

## 7. Channel Integration

### Architecture

Channels are registered as plugins in `channels/plugins/`. The `channels/registry.ts` defines the core channel order and metadata:

**Supported channels:** Telegram, WhatsApp, Discord, Google Chat, Slack, Signal, iMessage, Web

### Channel lifecycle

1. **Gateway startup** (`server.impl.ts`): `createChannelManager()` initializes all configured channels
2. **Inbound**: Channel adapters convert platform-specific messages into a normalized `MsgContext`
3. **Outbound**: `routeReply()` + `ReplyDispatcher` route replies back through the originating channel

### Telegram (primary channel for FsuelsBot)

Located in `src/telegram/`:

- `bot-handlers.ts` -- Telegram Bot API webhook/polling handlers
- `bot-message-dispatch.ts` -- converts Telegram updates to `MsgContext`
- `bot-message-context.ts` -- sender prefix, DM threads, topic threads
- `bot-native-commands.ts` -- Telegram-specific `/start`, `/help` etc.
- `inline-buttons.ts` -- inline keyboard support (configurable scope: dm/group/all/allowlist)
- `reaction-level.ts` -- emoji reaction configuration

### Channel capabilities

- `config/channel-capabilities.ts` resolves per-channel features (inline buttons, reactions, typing indicators)
- `channels/typing.ts` provides typing indicator abstraction
- `channels/allowlists/` manages sender/group allowlists per channel

---

## 8. Key Configuration Files

| File            | Location                                         | Controls                                                                      |
| --------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `moltbot.json`  | `~/.clawdbot/moltbot.json`                       | Master config: models, providers, agents, channels, gateway, session, plugins |
| `sessions.json` | `~/.clawdbot/agents/main/sessions/sessions.json` | Session store: all active sessions with metadata                              |
| `models.json`   | `~/.clawdbot/agents/main/agent/models.json`      | Model catalog: provider endpoints, auth keys, model aliases                   |
| `gateway.plist` | `~/Library/LaunchAgents/bot.molt.gateway.plist`  | macOS launchd service definition                                              |
| `SOUL.md`       | `workspace/SOUL.md`                              | Personality, rules, protocols (supreme authority)                             |
| `AGENTS.md`     | `workspace/AGENTS.md`                            | Workspace guide, file hierarchy, task management                              |
| `IDENTITY.md`   | `workspace/IDENTITY.md`                          | Bot identity                                                                  |
| `USER.md`       | `workspace/USER.md`                              | User profile                                                                  |
| `MEMORY.md`     | `workspace/MEMORY.md`                            | Long-term memory (business context, lessons)                                  |
| `TOOLS.md`      | `workspace/TOOLS.md`                             | Available tools and environment                                               |
| `BOOTSTRAP.md`  | `workspace/BOOTSTRAP.md`                         | Startup instructions                                                          |
| `HEARTBEAT.md`  | `workspace/HEARTBEAT.md`                         | Check-in protocols                                                            |
| `BOOT.md`       | `workspace/BOOT.md`                              | One-time boot check (run on gateway start)                                    |

### Config schema highlights

```
moltbot.json
  models.default           -- default model string (e.g., "anthropic:claude-sonnet-4-20250514")
  models.providers.<id>    -- per-provider: bootstrapMaxChars, promptMode, auth
  agents.defaults          -- bootstrapMaxChars, heartbeat.model, envelopeTimezone, skipBootstrap
  session.store            -- session store path override
  gateway.controlUi        -- Control UI settings
  gateway.http.endpoints   -- OpenAI-compat + OpenResponses API toggles
  gateway.auth             -- auth config
  gateway.bind             -- loopback | lan | tailnet | auto
```

---

## 9. Common Failure Modes

### LM Studio context overflow

**Symptom:** LM Studio hangs or times out silently.
**Cause:** Model loaded with 4K context (auto-reload default) when system prompt alone is ~11K+ tokens.
**Recovery:**

```bash
~/.lmstudio/bin/lms ps             # Check CONTEXT column
~/.lmstudio/bin/lms load "qwen/qwen3-30b-a3b" --context-length 32768
```

### Session overflow (cross-model)

**Symptom:** Context overflow errors when switching from Claude (200K) to LM Studio (32K).
**Recovery:** Send `/new` to reset the session.

### Gateway not running

**Symptom:** Telegram messages go unanswered.
**Recovery:**

```bash
launchctl list bot.molt.gateway          # Check status
pkill -9 -f moltbot-gateway || true      # Kill
nohup moltbot gateway run --bind loopback --port 18789 --force > /tmp/moltbot-gateway.log 2>&1 &
moltbot channels status --probe          # Verify
```

### Compaction failure loop

**Symptom:** Repeated "session reset after compaction failure" messages.
**Cause:** Corrupt session file or provider-incompatible transcript entries.
**Recovery:** `resetSessionAfterCompactionFailure()` auto-resets, or manually send `/new`.

### Auth profile exhaustion

**Symptom:** All API keys rate-limited or failing.
**Cause:** Round-robin exhaustion with cooldown timers.
**Recovery:** Auth profiles auto-recover after cooldown. Check `agents/auth-profiles/` for cooldown settings.

### Bootstrap truncation

**Symptom:** Agent missing personality or instructions.
**Cause:** `bootstrapMaxChars` too low for the provider.
**Recovery:** Increase `models.providers.<id>.bootstrapMaxChars` or reduce workspace file sizes.

---

## 10. Developer Quick Start

### Prerequisites

- Node.js (see `package.json` for version)
- pnpm
- TypeScript

### Build & run

```bash
cd /Users/fsuels/Projects/FsuelsBot
pnpm install
pnpm build          # TypeScript -> dist/
pnpm test           # Run tests
pnpm format:fix     # Format code
```

### Key entry points for changes

| What you want to change     | Where to look                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| Message processing pipeline | `src/auto-reply/reply/get-reply.ts` -> `get-reply-run.ts` -> `agent-runner.ts`              |
| System prompt content       | `src/agents/system-prompt.ts` (hardcoded sections) + `workspace/*.md` (bootstrap files)     |
| Model selection logic       | `src/auto-reply/reply/model-selection.ts` + `src/agents/model-selection.ts`                 |
| Session management          | `src/config/sessions/` (store, types, reset) + `src/auto-reply/reply/session.ts`            |
| Telegram integration        | `src/telegram/bot-message-dispatch.ts` (inbound) + `src/telegram/bot-message.ts` (outbound) |
| Tool definitions            | `src/agents/pi-tools.ts` (tool creation) + `src/agents/system-prompt.ts` (summaries)        |
| Gateway server startup      | `src/gateway/server.impl.ts`                                                                |
| Channel adapters            | `src/channels/plugins/` (registration) + `src/<channel>/` (implementation)                  |
| Directive handling          | `src/auto-reply/reply/directive-handling.*.ts`                                              |
| Sub-agent management        | `src/agents/subagent-registry.ts` + `src/auto-reply/reply/commands-subagents.ts`            |
| Bootstrap file loading      | `src/agents/bootstrap-files.ts` + `src/agents/pi-embedded-helpers/bootstrap.ts`             |
| Config schema               | `src/config/config.ts` (types) + `~/.clawdbot/moltbot.json` (runtime)                       |

### Testing conventions

- Unit tests: `*.test.ts` co-located with source
- E2E tests: `*.e2e.test.ts` for directive/trigger behavior scenarios
- Test helpers: `src/test-helpers/`, `src/test-utils/`

### Safe change checklist

1. Read the existing code before modifying (especially `system-prompt.ts` -- it is large and section-heavy)
2. Run `pnpm build` to catch type errors
3. Run `pnpm test` to catch regressions
4. Test with `/status` in Telegram to verify runtime state after gateway restart
5. Check `~/.clawdbot/logs/gateway.log` for errors after changes
6. Never force-push to main
7. Never commit secrets (.env, API keys)

---

## Appendix: Technology Stack

- **Runtime:** Node.js + TypeScript (ESM)
- **Build:** pnpm + TypeScript compiler
- **AI SDKs:** `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`
- **Config format:** JSON5 (via `json5` package)
- **Session format:** JSONL transcript files managed by `SessionManager`
- **Process management:** macOS launchd (`bot.molt.gateway` service)
- **Default port:** 18789
