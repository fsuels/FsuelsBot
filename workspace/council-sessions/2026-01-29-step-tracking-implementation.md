# Council Session: Step Tracking Implementation Plan

**Date:** 2026-01-29 12:30 EST  
**Topic:** Unified Memory & Task Tracking for Context Truncation Problem  
**Participants:** Grok ✅, ChatGPT ✅, Gemini ❌ (CLI timeout)

## The Problem

When context hits 200K token limit and truncates, the agent loses track of where it was in multi-step tasks. It restarts from step 1 instead of continuing from step 4 — creating infinite loops on long tasks.

## Question Asked

Is step-tracking the right solution? How to implement it? What's the roadmap?

---

## 🤖 GROK says:

**On step-tracking:** YES — step-level tracking in a persistent store like tasks.json is an effective and straightforward solution. It directly addresses state loss during context truncation by externalizing task progress outside volatile in-memory context. Aligns with checkpointing principles. Lightweight, prevents loops by giving agent explicit "resume from here" signal.

**Integration:** Dedicated "task persistence layer" within multi-tier memory:
- Short-term memory: Context window (200K tokens)
- Long-term memory: Vector DB with time-decay (`score = base_score * e^(-lambda * age)`)
- Task-specific persistence: tasks.json for steps, current index, status
- Summarization layer: Weekly crons with supersession semantics

**MVP Today:**
```json
{
  "tasks": [{
    "task_id": "unique-task-uuid",
    "description": "Overall task goal",
    "steps": [
      {"description": "Step 1: Do X", "status": "done"},
      {"description": "Step 2: Do Y", "status": "in_progress"}
    ],
    "current_step": 1
  }]
}
```

**Roadmap:**
- Phase 1 (1-2 weeks): MVP + basic error handling
- Phase 2 (2-4 weeks): Vector DB integration, time-decay retrieval
- Phase 3 (1-2 months): Weekly summarization crons, supersession
- Phase 4 (3+ months): Branching steps, multi-agent, evaluation metrics

**Risks:** Data integrity (file corruption), security (plaintext JSON), scalability (file I/O), over-reliance on structure, LLM hallucinations ignoring the file

---

## 🟢 CHATGPT says:

**On step-tracking:** YES — "explicit step/state tracking is the correct 'control-plane' fix." Root issue is lack of an external, authoritative execution state. Proposing a lightweight **finite-state machine** for tasks.

Key benefits:
- Grounds progress outside LLM context
- Makes resumption deterministic (data read, not guess)
- Enables loop guards (detect "step 1 repeated X times")
- Separates "what we're doing" from "what we remember"

**Additions to make robust:**
- Idempotency metadata per step (completion predicate)
- Event log for diagnosing loops (transition time, retry count)

**Three-layer architecture:**
1. **Control-plane state** (tasks.json): Task plan, steps, current_step, artifacts
2. **Working memory** (scratchpad): Intermediate results, pointers, blockers
3. **Long-term memory**: Time-decay retrieval, summaries, supersession

**Rule of thumb:**
- "What step am I on?" → control-plane state
- "What did we learn?" → working/long-term memory
- "What do I need to recall?" → retrieval filtered by supersession

**MVP Data Model:**
- `tasks[taskId]`: title, status (active|blocked|done), current_step
- `steps[]`: description, status, done_criteria, artifacts, retry_count
- `updated_at`, `last_transition { from, to, at, reason }`

**MVP Runtime Logic:**
1. On every run: load tasks.json
2. Pick active task, resume at current_step
3. Guard rails: if step done, advance; if retry_count exceeds threshold, mark blocked
4. Execute ONE step per turn
5. Persist to tasks.json BEFORE responding

**Prompt contract:**
- Must read task state first
- Must not restart from step 1 unless state says so
- Must update tasks.json at end of every turn
- Must not change done step back to non-done without explicit reason

**Loop prevention:** retry_count per step + ring buffer of last_k_steps_executed

**Roadmap:**
- Phase 1: Correctness + debuggability (completion predicates, event sourcing, idempotency)
- Phase 2: Memory quality (time-decay, supersession, weekly summaries)
- Phase 3: Planning + resilience (plan refinement, checkpointing, stuck diagnosis)

**Risks:** False "done" marking (mitigation: structured criteria + verification), plan drift (steps edited mid-flight)

---

## ✅ CONSENSUS (Both Agree)

1. **Step-tracking IS the right solution** — externalizes state outside volatile context
2. **Tasks.json is the correct primitive** — lightweight, file-based, immediate
3. **current_step + steps[] array** is the core data structure
4. **Persist BEFORE responding** — never lose progress
5. **Loop guards essential** — retry_count + max threshold
6. **Three-tier architecture** makes sense: control-plane / working / long-term
7. **Time-decay, supersession, summaries are Phase 2** — not needed for MVP

## ⚡ UNIQUE INSIGHTS

**Grok:** Explicit time-decay formula (`e^(-lambda * age)`), practical Python pseudocode, security concerns about plaintext JSON

**ChatGPT:** "Finite-state machine" framing, completion predicates, idempotency classification (pure/safe_repeatable/unsafe_repeatable), prompt contract enforcement, event sourcing for debugging

## ⚔️ DISAGREEMENTS

| Topic | Grok | ChatGPT |
|-------|------|---------|
| **Implementation style** | Practical/code-first | Architectural/theory-first |
| **Phase 1 focus** | MVP + error handling | Correctness + debuggability |
| **Complexity** | Keep it simple | Add verification layers |

---

## 🏆 MY VERDICT

**Ship this TODAY:**

```json
// In tasks.json — add to each task:
"steps": [
  {"step": "Generate CSV", "status": "done", "completed_at": "2026-01-29T08:30:00"},
  {"step": "Review truncated titles", "status": "done", "completed_at": "2026-01-29T10:15:00"},
  {"step": "Francisco approves", "status": "waiting", "waiting_for": "human_approval"},
  {"step": "Import via Shopify", "status": "pending"},
  {"step": "Verify import", "status": "pending"}
],
"current_step": 2,
"retry_count": 0
```

**Behavior rules (add to AGENTS.md):**
1. On EVERY session start: read tasks.json, check current_step
2. If current_step status is "done", advance to next non-done step
3. Execute ONE step at a time
4. Update tasks.json IMMEDIATELY after completing a step
5. If retry_count > 3 on same step: mark "blocked", alert Francisco

**Why this works for our specific case:**
- We already have tasks.json (version 5)
- We already read it every session
- Adding steps[] array is trivial
- No complex infrastructure needed
- Directly solves the "restart from step 1" loop

**Phase 2 (next week):**
- Add `artifacts[]` to track outputs per step
- Add `done_criteria` for verification
- Add time-decay to memory retrieval

**Phase 3 (later):**
- Weekly summary cron
- Supersession semantics in ledger

**Grade:** A (both AIs strongly endorse this approach)
