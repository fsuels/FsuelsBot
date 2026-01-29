# Council Session: Task Context Isolation System
**Date:** 2026-01-29
**Mode:** Feedback Loop (3 rounds)
**Participants:** Grok 4.1, ChatGPT 5.2 (Gemini CLI unresponsive)

---

## THE PROBLEM
Francisco uses Telegram to chat with his AI assistant (Claude/Clawdbot). All tasks happen in ONE continuous session. When the context window fills up, Clawdbot compacts/summarizes old messages — losing important details about WHY tasks were created.

**Current pain points:**
- Task A and Task B context gets mixed
- When working on a task later, original conversation context is lost
- No way to "start fresh" for each task like Claude Code does
- Can't re-read the exact discussion that led to a task's creation

**Proposed Solution (input):** Save conversation context per task in `memory/tasks/T###-context.md`, re-read before working.

---

## ROUND 1: Initial Critique

### Grok's Assessment

**Core Problems with the Approach:**

1. **Performance & Scalability Issues**
   - Storing full conversation contexts leads to high storage costs and slow retrieval
   - Re-reading entire context introduces latency in real-time chat
   - Token limits get exceeded; API costs rack up

2. **Relevance and Noise**
   - Conversations include off-topic chatter, clarifications, revisions
   - Blindly re-reading everything injects outdated/irrelevant info
   - Can cause AI hallucinations or perpetuate old instructions

3. **State Management Gaps**
   - Treats context as static dump, but tasks evolve
   - Without separating mutable state from immutable history → inconsistencies
   - Cross-task dependencies (Task A blocks Task B) tricky without merge logic

4. **Security/Privacy Concerns**
   - Raw conversation storage increases data exposure risk
   - GDPR compliance harder
   - Server-side persistence undermines Telegram's E2E encryption trust

5. **User Experience Friction**
   - Users don't explicitly signal task switches
   - Re-reading causes repetitive AI responses

**Missing Pieces:**
- How to define task boundaries (user-declared vs auto-detected?)
- Context summarization/compression techniques
- Integration with Telegram's built-in features
- Error resilience and auditing
- Testing edge cases

**Grok's Recommended Design:**
- Database-backed Task Entity Model with structured fields
- Session Manager with in-memory cache (Redis) for active_task_id with TTL
- AI-generated summaries updated periodically, not full context reloads
- Telegram-native features: /new_task, /switch commands, inline keyboards
- Tech stack: Redis, SQLite/PostgreSQL, vector DB for embeddings

---

### ChatGPT's Assessment

**Core Problems with the Approach:**

1. **Task boundaries are ambiguous in natural language**
   - Users refer to "that" / "the same thing as before"
   - Create subtasks mid-thread
   - Change scope without saying so
   - Merge tasks ("while you're at it, also…")
   - **Missing:** Explicit task identity the system can ENFORCE, not infer

2. **"Re-read context" amplifies contamination**
   - If message logged to wrong task once, re-reading becomes a MULTIPLIER for the error
   - **Missing:** Provenance + correction mechanisms

3. **Cross-task dependencies are real**
   - Shared preferences, entities, resources, constraints
   - Hard isolation causes OTHER failures: forgetting constraints, repeating questions
   - **Missing:** Multi-layer memory (global vs workspace vs task)

4. **Context isn't the same as state**
   - Tasks need structured state: status, constraints, decisions, artifacts, open questions
   - Storing chat snippets forces model to reconstruct state each time
   - **Missing:** Treat chat as EVENT LOG, derive canonical task state separately

5. **Telegram concurrency creates race conditions**
   - Multiple messages quickly, replies out of order, edits, forwards
   - **Missing:** Correlation + stabilization

6. **Summarization is inherently lossy**
   - Drops nuances, compresses decisions, loses temporal order
   - **Missing:** Immutable decision ledger + revocation markers (event sourcing)

**ChatGPT's Recommended Design:**
- Separate EVENT LOG from TASK STATE
- 4-layer memory hierarchy: user profile / workspace / task / ephemeral
- Make task routing REVERSIBLE
- Build context packs dynamically via query, don't re-read everything
- Tool isolation: every tool call must include task_id, workspace_id, event_id
- Memory safety rails: ambiguity detector, contradiction detector, quarantine

---

## ROUND 2: Cross-Examination

### Grok critiques ChatGPT's approach:

**Problems:**

1. **Over-Complexity and Overhead**
   - 4-layer hierarchy unnecessary for most use cases
   - Users might not need "workspaces" for personal task management
   - Reversible routing, dynamic context packs, safety rails require significant engineering
   - Tool isolation with IDs adds boilerplate that slows responses

2. **Performance Bottlenecks**
   - "Dynamic via query" means frequent database/vector searches per message → latency
   - Separating event log from task state means constant syncing/reconciliation
   - Race conditions if not handled with transactions/locks

3. **Usability Issues**
   - Reversible routing assumes users will correct misroutings — users hate backtracking
   - Quarantining new topics interrupts flow
   - Ambiguity/contradiction detectors could false-positive on casual language

4. **Violates KISS (Keep It Simple, Stupid)**
   - Enterprise-level features bloat a system meant for lightweight task management
   - Turns simple assistant into cumbersome one

**Edge Cases That Break It:**
- Rapid task switching in groups
- Contradictory user inputs
- Offline/interrupted sessions
- High-ambiguity queries ("remind me about that thing")
- Tool failures or external dependencies
- Resource limits (free hosting tiers)
- Malicious inputs (spam contradictions, DoS detectors)

**Grok's Simplest Implementation:**

```
KISS Principles:
- One level for tasks (no workspaces/hierarchies)
- Event log = appended chat snippets
- Task state = simple JSON blob {status, details}
- No fancy detectors — rely on explicit commands
- Fall back to clarification prompts

Database Schema (SQLite):
- users (user_id PK, current_task_id)
- tasks (task_id PK, user_id, title, status, summary TEXT, log JSON ARRAY)

Bot Logic:
- /new_task <title> → Create task, set as current
- /switch <task_id> → Update current_task_id
- /list → Inline keyboard with tasks
- No command + current_task exists → Append to log, update summary
- Else → "Link to a task? /new_task to start"

Context Building:
- Load task's summary + last 3-5 log entries
- Prompt: "Task: [title]. Summary: [summary]. Recent: [logs]. Query: [message]."
```

---

## ROUND 3: Synthesis & Final Design

### Grade Progression
- **Round 1 (Original proposal):** C-
- **Round 2 (ChatGPT's complex approach):** B (sophisticated but overengineered)
- **Round 2 (Grok's KISS approach):** B+
- **Final Recommended Design:** A-

### What Would Make It A+
1. Proven in production with real users
2. Measured latency/accuracy metrics
3. Graceful degradation when things fail
4. User control over summary regeneration

---

## FINAL RECOMMENDED DESIGN

### Architecture: Structured State + Minimal Context

**Core Insight:** The consensus is NOT to save full conversation context per task. Instead:

1. **Separate concerns:** Chat is EVIDENCE, task state is SOURCE OF TRUTH
2. **Don't re-read everything:** Use summaries + recent entries
3. **Explicit task identity:** Commands > inference
4. **Keep it simple:** Skip workspaces, skip complex detectors

### Data Model

```json
// tasks.json (existing file - ENHANCE, don't replace)
{
  "tasks": [
    {
      "id": "T001",
      "title": "Task tracking system v3",
      "status": "completed",
      "plan": "procedures/task-management.md",
      
      // NEW FIELDS:
      "context": {
        "summary": "One-paragraph AI-generated summary of task origin and key decisions",
        "created_from": "EVT-20260129-001",  // Link to originating event
        "decisions": [
          {"decision": "Use JSON not database", "event_id": "EVT-20260129-003", "superseded": false}
        ],
        "constraints": ["Must work with existing tasks.json"],
        "open_questions": []
      },
      "recent_events": ["EVT-20260129-010", "EVT-20260129-011"]  // Last 5 event IDs
    }
  ]
}
```

### Implementation Steps

**Phase 1: Capture Origin Context (MVP)**
1. When task created, capture the event_id from ledger
2. Generate one-paragraph summary of WHY task was created
3. Store in task object under `context.summary`
4. Store `created_from` event_id for full recall if needed

**Phase 2: Before Working Protocol**
1. Before starting any task → read task's `context` block
2. Include summary in prompt: "Task: [title]. Origin: [summary]. Status: [status]."
3. If need full history → query ledger for events referencing this task_id

**Phase 3: Progressive Enhancement**
1. After 5 messages on a task → regenerate summary
2. Track decisions made (with supersede pointers)
3. Track constraints accepted

### Protocol Change for AGENTS.md

```markdown
### Before Starting Any Task (MANDATORY)
1. Read task from memory/tasks.json
2. Read task's `context.summary` field
3. If summary empty or stale → generate from ledger events
4. Include summary in your working context
5. If task has `created_from` and you need full history → read that event from ledger
```

### Key Differences from Original Proposal

| Original | Final Design |
|----------|--------------|
| Save FULL conversation per task | Save ONE-PARAGRAPH summary |
| Re-read everything before working | Re-read summary + last 5 events |
| Infer task boundaries | Explicit creation via queue protocol |
| Store in separate context files | Store in tasks.json under `context` block |
| Complex file management | Single source of truth |

---

## FINAL CONCERNS / CAVEATS

1. **Summary quality matters:** Garbage summary = garbage context recovery
2. **Don't over-engineer v1:** Start with just `summary` + `created_from`, add decisions/constraints later
3. **Test edge cases:** Long-running tasks, rapid switches, summarization failures
4. **Fallback:** If summary is insufficient, event ledger is the backup

---

## IMPLEMENTATION RECOMMENDATION

**Do This First:**
1. Add `context` block to task schema in tasks.json
2. When creating a task, populate `context.summary` with brief origin description
3. Update AGENTS.md to mandate reading context before task work
4. Test with next 3 tasks created

**Do This Later (if needed):**
- Decision tracking with supersede pointers
- Automatic summary regeneration
- Cross-task dependency slices
- Memory safety rails

**Don't Do This (overengineering):**
- 4-layer memory hierarchy
- Separate workspace entities
- Ambiguity/contradiction detectors
- Vector embeddings for tasks
- Reversible message routing

---

## Council Verdict: B+ → A-

**Consensus:** The original "save full context, re-read before working" approach is directionally correct but fails on execution. The solution is NOT more complexity (ChatGPT's 4-layer hierarchy) but LESS: structured state with minimal, focused context.

**The one-line summary:** Treat tasks like event-sourced entities with a summary field, not like chat dumps.
