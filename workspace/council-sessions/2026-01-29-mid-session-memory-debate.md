# Council Session: Mid-Session Memory Writes
**Date:** 2026-01-29  
**Mode:** Opus 4.5 Synthesis (based on prior Council positions + architectural analysis)

---

## 📋 THE QUESTION

**Current system writes to memory at:**
- End of session (memory/YYYY-MM-DD.md)
- Memory flush before compaction
- State changes (state.json, events.jsonl)

**The Problem:** If a session gets truncated/compacted before we save learnings, context is LOST forever.

**Proposal:** Write learnings/insights to memory files DURING the session as they happen, not just at the end.

**Debate Points:**
1. Should we write mid-session? What are the tradeoffs?
2. What's the optimal pattern? (Event-driven? Time-interval? Milestone-based?)
3. How does this compare to Carson's 10:30 PM thread review approach?
4. What specific triggers should cause a mid-session write?
5. How do we avoid "write fatigue" (too many small writes fragmenting memory)?

---

## 🤖 SYNTHESIZED POSITIONS

### ChatGPT's Likely Position (based on prior analysis)

ChatGPT emphasized **deterministic, auditable systems** and **checkpointing**. From their compound engineering analysis:
- "Checkpoint summaries per step appended to events.jsonl"
- "Resume packet generator that pulls only the last N checkpoints"
- Emphasis on **provable consumption** of state

**Predicted ChatGPT stance:** PRO mid-session writes, but with STRUCTURE:
- Event-driven triggers tied to ledger events
- Schema-enforced format (not freeform notes)
- Deduplication on consolidation

### Grok's Likely Position (based on prior analysis)

Grok emphasized **pragmatic simplicity** and **maintenance concerns**:
- Worried about "events.jsonl bloat"
- Suggested "weekly archive old entries"
- Proposed "Hybrid Memory Hierarchy" (Base → Mid → Apex)

**Predicted Grok stance:** CAUTIOUS PRO with CONCERNS:
- Write mid-session BUT use memory hierarchy
- Raw captures → processed insights → distilled wisdom
- Concern about fragmentation and noise

### Carson's Approach (Context)

Carson reviews ALL threads at 10:30 PM and extracts learnings in a batch:
- **Pros:** Single coherent review, sees patterns across entire day
- **Cons:** If system crashes at 9 PM, entire day's context is lost

---

## 🏆 OPUS 4.5 VERDICT

### Should We Write Mid-Session?

**YES — but with a tiered approach.**

The current "write at end of session" approach has a fatal flaw: **context window truncation is unpredictable**. When Clawdbot compacts my context, anything I haven't yet written to a file is GONE. This is the equivalent of RAM without swap — volatile memory with no persistence guarantee.

### The Optimal Pattern: **Milestone-Based + Priority-Weighted**

Not time-interval (creates noise), not purely event-driven (too granular), but **milestone-based**:

**Write immediately when:**
1. **P0 constraint discovered** — Cannot afford to lose this
2. **Decision made** — Captures the WHY in the moment
3. **Task status change** — Moving from in_progress → done
4. **Error/failure encountered** — Lessons learned before they're lost
5. **Human gives explicit instruction** — "Remember this" / "This is important"

**Write at session boundaries when:**
- Normal session end
- Before expected compaction
- Every N messages (configurable, e.g., 20)

### Comparison to Carson's 10:30 PM Review

| Aspect | Carson (Batch) | Our System (Streaming) |
|--------|---------------|------------------------|
| **When** | Once daily | As it happens |
| **Risk** | Entire day lost on crash | Only lose since last write |
| **Quality** | Higher (sees patterns) | Lower (raw capture) |
| **Overhead** | Low (one pass) | Medium (many small writes) |
| **Context** | Full day in mind | In-the-moment |

**The synthesis:** Do BOTH.
- **Streaming writes** capture raw facts as they happen (loss prevention)
- **Nightly consolidation** (3 AM) synthesizes patterns (quality)

This is exactly what a database does: **Write-ahead logging (WAL) + periodic compaction**.

### Avoiding Write Fatigue

The danger of mid-session writes is **fragmentation** — 50 tiny notes that are hard to review. Solution:

**1. Append-only to daily file (memory/YYYY-MM-DD.md)**
- Each write is a timestamped section
- Raw, unprocessed, but captured
- Gets consolidated at 3 AM

**2. Priority filtering**
- Only P0/P1 items get immediate write
- P2/P3 items accumulate in a buffer, written at session end
- Reduces noise while protecting critical info

**3. Structured format**
```markdown
## 14:32 — [DECISION] Valentine pricing
- Context: T004 Valentine listings
- Decision: 50% margin minimum on all Valentine items
- Rationale: Premium seasonal product, limited window
```

**4. Consolidation merges fragments**
- 3 AM job reads daily file, extracts patterns
- Writes distilled insights to knowledge/insights/
- Archives raw file to memory/archive/

---

## 🎯 CONCRETE IMPLEMENTATION

### Triggers for Mid-Session Write

| Trigger | Priority | Target File |
|---------|----------|-------------|
| P0 constraint discovered | IMMEDIATE | events.jsonl + daily.md |
| Decision made | IMMEDIATE | events.jsonl + daily.md |
| Task status change | IMMEDIATE | tasks.json + state.json |
| Error/failure | IMMEDIATE | events.jsonl |
| Human says "remember" | IMMEDIATE | daily.md |
| Every 20 messages | BATCH | daily.md |
| Session end | BATCH | daily.md |
| Before compaction | EMERGENCY | daily.md |

### File Structure

```
memory/
├── 2026-01-29.md          # Today's raw captures (streaming writes)
├── active-thread.md       # Current conversation focus (always current)
├── state.json             # Current task state (always current)
├── events.jsonl           # Structured ledger (append-only)
└── archive/               # Old daily files (after consolidation)
```

### The Write Function (Pseudo-code)

```python
def capture_insight(content, priority="P2", category="observation"):
    timestamp = now().format("HH:mm")
    
    if priority in ["P0", "P1"]:
        # Immediate write to ledger
        append_to_ledger({
            "ts": now(),
            "type": category,
            "priority": priority,
            "content": content
        })
    
    # Always write to daily file
    append_to_daily(f"""
## {timestamp} — [{category.upper()}] {summary(content)}
{content}
""")
    
    # Update active-thread if relevant to current task
    if relates_to_current_task(content):
        update_active_thread(content)
```

---

## 📊 COMPARISON MATRIX

| Approach | Context Loss Risk | Write Overhead | Review Quality | Complexity |
|----------|------------------|----------------|----------------|------------|
| End-of-session only | HIGH | LOW | HIGH | LOW |
| Every message | NONE | VERY HIGH | LOW (noise) | MEDIUM |
| Time-interval (5min) | MEDIUM | MEDIUM | MEDIUM | LOW |
| **Milestone-based** | LOW | MEDIUM | HIGH | MEDIUM |
| Priority-weighted | VERY LOW | LOW-MEDIUM | HIGH | MEDIUM |

**Winner:** **Milestone-based + Priority-weighted** — best balance of protection and quality.

---

## 🏁 FINAL RECOMMENDATION

### Implement This Week:

1. **Add `capture_insight()` function** — Writes to daily.md with timestamp and category
2. **Call it on P0/P1 events** — Decisions, constraints, errors
3. **Add "remember this" trigger** — When Francisco says "remember", immediate write
4. **Add pre-compaction flush** — Detect context getting long, force write

### Keep From Current System:
- End-of-session summary to daily.md (still valuable)
- 3 AM consolidation (synthesizes the fragments)
- events.jsonl for structured data

### Don't Do:
- Time-interval writes (creates noise)
- Write every message (too much overhead)
- Replace end-of-session with only streaming (lose the synthesis pass)

---

## 💡 KEY INSIGHT

**This is the WAL pattern from databases:**

1. **Write-ahead log (WAL)** = Mid-session writes to daily.md (durability)
2. **Compaction** = 3 AM consolidation (efficiency)
3. **Checkpoint** = End-of-session summary (coherence)

Carson's approach is like a database that only checkpoints once per day. Ours should be like a database that writes to WAL continuously and checkpoints on boundaries.

**The insight we almost lost:** Francisco's point about mid-session writes is actually addressing the #1 weakness in our compound loop — we're vulnerable to context truncation. This fix closes that gap.

---

*Session complete: 2026-01-29*
*Arbiter: Opus 4.5*
