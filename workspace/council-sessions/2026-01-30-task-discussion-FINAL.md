# T045 COUNCIL FINAL VERDICT
## Task Discussion System Evaluation

**Date:** 2026-01-30
**3 Rounds Complete:** ✅

---

## SCORES

| AI | Role | Score |
|---|---|---|
| Grok | Adversary | 8/10 |
| ChatGPT | Formalist | 7/10 |
| Gemini | Empiricist | (joined Round C) |
| **AVERAGE** | | **7.5/10** |

---

## ROUND C - ACTIONABLE IMPROVEMENTS

### GROK's Top 3:
1. **Summarization Table** - `discussion_summaries` with LLM-generated summaries every 500 messages
2. **Semantic Chunking** - `discussion_chunks` with vector embeddings, cosine similarity retrieval
3. **Validation Checkpoints** - `checkpoints` table with diff tracking every 10 exchanges

### CHATGPT's Top 3:
1. **Event Log with Cursors** - `events[]` array with `event_id`, `in_reply_to`, `bot_cursor.loaded_up_to` - enforces read-before-respond
2. **First-Class State Objects** - `state.decisions[]`, `state.constraints[]`, `state.acceptance_criteria[]` - supersession mechanic
3. **Telegram Outbox** - `outbox[]` for idempotent delivery, prevents split-brain

### GEMINI's Top 3:
1. **State Snapshot Schema** - `distilled_state` JSONB, trigger every 50 messages
2. **Atomic State Transitions** - Action-Effect pattern with state machine validation
3. **Semantic Pruning** - `significance_score` 1-5 on messages, prune low-value

---

## CONSENSUS IMPROVEMENTS (ALL 3 AGREE)

### 🥇 #1: EXTRACT STRUCTURED STATE FROM DISCUSSIONS
**All 3 AIs agree:** Stop treating raw discussion as source of truth.

| AI | Their Term |
|---|---|
| Grok | "discussion_summaries table" |
| ChatGPT | "state.decisions[], state.constraints[]" |
| Gemini | "distilled_state JSONB" |

**Implementation:**
```json
"extracted_state": {
  "decisions": [{"id": "D1", "statement": "...", "status": "active"}],
  "constraints": [{"id": "C1", "text": "...", "status": "active"}],
  "open_questions": [{"id": "Q1", "text": "..."}]
}
```

### 🥈 #2: ENFORCE READ-BEFORE-RESPOND MECHANICALLY
**All 3 AIs agree:** "Must read history" needs to be enforced, not aspirational.

| AI | Their Term |
|---|---|
| Grok | "validation checkpoints" |
| ChatGPT | "bot_cursor.loaded_up_to === event_head" |
| Gemini | "atomic state transitions" |

**Implementation:**
```javascript
if (task.bot_cursor.loaded_up_to !== task.event_head) {
  throw new Error("STALE_READ");
}
```

### 🥉 #3: PRUNE OR SUMMARIZE OLD CONTENT
**All 3 AIs agree:** Full logs cause interpretation drift.

| AI | Their Term |
|---|---|
| Grok | "versioned summaries" |
| ChatGPT | "supersession mechanic" |
| Gemini | "semantic pruning with significance_score" |

**Implementation:**
- Score messages 1-5 on importance
- Every N messages, generate summary
- Prune score 1-2 messages when context fills up

---

## FINAL ACTIONABLE IMPROVEMENTS (Priority Order)

### MUST DO (Week 1):
1. **Add `extracted_state` to task schema** - decisions[], constraints[], open_questions[]
2. **Add `event_id` and `bot_cursor`** - enforce ordering mechanically
3. **Add supersession mechanic** - new decisions can supersede old ones

### SHOULD DO (Week 2):
4. **Add significance scoring** - rate messages 1-5 on importance
5. **Implement summarization** - LLM summary every 50 messages
6. **Add outbox for Telegram** - idempotent delivery pattern

### NICE TO HAVE (Week 3+):
7. **Vector embeddings** - semantic chunking for retrieval
8. **Diff tracking** - detect interpretation drift
9. **State machine validation** - can't mark "done" if invariants not met

---

## SHARED FLAWED ASSUMPTION (CONFIRMED)

All 3 AIs confirmed this assumption is wrong:
> "Persisting full discussion = reliable context recovery"

**Why it fails:**
- Logs become too long to consume fully
- Earlier statements conflict with later corrections
- Interpretation drift replaces truncation as failure mode

**The fix:** Move from LOGS to STATE. Discussion is telemetry; extracted state is truth.

---

## COUNCIL COMPLETE ✅

Full audit trail in T045 discussion array.
Ready for Francisco's verification.
