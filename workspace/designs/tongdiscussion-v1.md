# TongDiscussion Design v1
## State Extraction System for Task Discussions

**Created:** 2026-01-30
**Based on:** TongGeometry research + Council T045 feedback
**Core Principle:** Extract INTUITION (what matters), not just DATA (what exists)

---

## Problem Statement

Current system stores raw discussion logs. Council critique:
> "Transcript ≠ binding task state. A persisted thread is not the same as durable, queryable task state."

**Failure modes:**
1. Interpretation drift (same log, different understanding over time)
2. Context overload (discussions too long to read fully)
3. Lost decisions (buried in message history)
4. Repeated mistakes (corrections not extracted as rules)

---

## Solution: The Duality Principle

From TongGeometry:
> "When proof difficulty >> construction complexity, it possesses aesthetic value"

**Our translation:**
> "When discussion_length >> decision_complexity, extract as structured state"

If we talk about something for 20 messages but the decision is one sentence, that decision is IMPORTANT. Extract it.

---

## Schema Design

### 1. Decision Object

```json
{
  "id": "DEC-20260130-001",
  "task_id": "T045",
  "statement": "All task work MUST go in discussion array, not Telegram",
  "type": "constraint",  // constraint | decision | action_item | correction | preference
  "confidence": "high",  // high | medium | low
  "source": {
    "messages": [3, 5, 7],  // indices in discussion array
    "summary": "Francisco corrected me for putting Council results in Telegram instead of task card"
  },
  "downstream": ["T046", "T047"],  // tasks affected by this decision
  "created_at": "2026-01-30T13:30:00-05:00",
  "supersedes": null,  // DEC-id if this replaces an earlier decision
  "status": "active"  // active | superseded | archived
}
```

### 2. Pattern Annotation

```json
{
  "id": "PAT-20260130-001",
  "task_id": "T042",
  "type": "correction",  // correction | contradiction | repeated_question | confirmation
  "detected_at": "2026-01-30T12:52:00-05:00",
  "messages": [4, 6],
  "description": "Human corrected bot for not creating task before work",
  "extracted_decision": "DEC-20260130-002",
  "auto_detected": true
}
```

### 3. Importance Score

```
importance = (message_count × avg_message_length) / decision_word_count

Example:
- 10 messages averaging 50 words = 500 words of discussion
- Decision is 15 words
- importance = 500 / 15 = 33.3 (HIGH - extract this!)

Thresholds:
- score > 20: AUTO-EXTRACT as Decision Object
- score 10-20: FLAG for review
- score < 10: Keep as raw discussion only
```

---

## Pattern Detection Rules

### Rule 1: Correction Detection
**Trigger phrases:**
- "No, that's wrong"
- "You need to..."
- "That is not correct"
- "Why did you not..."
- "I told you..."

**Action:** Create CORRECTION pattern → Extract as CONSTRAINT decision

### Rule 2: Contradiction Detection
**Trigger:** Same topic discussed with different conclusions in messages N and M
**Action:** Create CONTRADICTION pattern → Flag for human resolution

### Rule 3: Repeated Question Detection
**Trigger:** Same question asked 2+ times
**Action:** Create REPEATED_QUESTION pattern → Flag for documentation

### Rule 4: Confirmation Detection
**Trigger phrases:**
- "Yes"
- "Correct"
- "That's right"
- "Approved"
- "Go ahead"

**Action:** Create CONFIRMATION pattern → Mark preceding decision as HIGH confidence

---

## Extraction Algorithm

```python
def extract_state(task_discussion):
    decisions = []
    patterns = []
    
    # Step 1: Detect patterns
    for i, msg in enumerate(task_discussion):
        if is_correction(msg):
            patterns.append(create_correction_pattern(i, msg))
        if is_confirmation(msg):
            patterns.append(create_confirmation_pattern(i, msg))
    
    # Step 2: Identify decision candidates
    topics = cluster_by_topic(task_discussion)
    for topic in topics:
        score = calculate_importance(topic)
        if score > 20:
            decision = extract_decision(topic)
            decisions.append(decision)
        elif score > 10:
            flag_for_review(topic)
    
    # Step 3: Link patterns to decisions
    for pattern in patterns:
        if pattern.type == 'correction':
            decision = create_constraint_from_correction(pattern)
            decisions.append(decision)
        elif pattern.type == 'confirmation':
            mark_decision_confirmed(pattern.target_decision)
    
    return decisions, patterns
```

---

## Integration with Current System

### tasks.json additions

```json
{
  "T045": {
    "title": "...",
    "discussion": [...],  // Keep raw discussion
    "extracted_state": {
      "decisions": ["DEC-20260130-001", "DEC-20260130-002"],
      "patterns": ["PAT-20260130-001"],
      "last_extracted": "2026-01-30T14:00:00-05:00"
    }
  }
}
```

### New file: memory/decisions.json

Central registry of all Decision Objects, queryable across tasks.

### New file: memory/patterns.jsonl

Append-only log of detected patterns for analysis.

---

## Bot Behavior Changes

### On receiving discussion message:
1. Run pattern detection on new message
2. If CORRECTION detected → immediately extract constraint
3. If CONFIRMATION detected → mark prior decision HIGH confidence
4. If importance threshold crossed → extract decision

### On reading task context:
1. Load extracted_state FIRST (structured, reliable)
2. Load raw discussion SECOND (if more detail needed)
3. Reference decisions by ID in responses

### On potential conflict:
Proactively flag: "This seems to contradict DEC-001. Which is correct?"

---

## Implementation Plan

**Phase 1: Schema + Manual Extraction (1 day)**
- Add extracted_state to tasks.json schema
- Create decisions.json
- Manual extraction of high-value decisions from existing discussions

**Phase 2: Pattern Detection Script (2 days)**
- detect-patterns.ps1 runs on heartbeat
- Flags corrections, confirmations, contradictions
- Writes to patterns.jsonl

**Phase 3: Auto-Extraction (2 days)**
- Importance scoring algorithm
- Auto-extract decisions above threshold
- Human review queue for medium scores

**Phase 4: Bot Integration (1 day)**
- Update AGENTS.md to read extracted_state first
- Update response format to reference decision IDs
- Proactive conflict detection

---

## Success Metrics

1. **Context recovery time:** How fast can bot reconstruct task context?
   - Before: Read entire discussion (O(n) messages)
   - After: Read extracted_state (O(1) decisions)

2. **Repeat correction rate:** How often does human correct same thing twice?
   - Target: 0 (corrections become constraints, never repeated)

3. **Decision traceability:** Can we answer "why did we decide X?"
   - Target: 100% of decisions linked to source messages

---

## Example: Applying to T045

**Raw discussion has 10 messages**

**Extracted state:**
```json
{
  "decisions": [
    {
      "id": "DEC-T045-001",
      "statement": "All Council Q&A must go in task discussion array, not Telegram",
      "type": "constraint",
      "confidence": "high",
      "source": {"messages": [6, 7, 8, 9]}
    }
  ],
  "patterns": [
    {
      "type": "correction",
      "description": "Human corrected bot for putting Council results in Telegram"
    }
  ]
}
```

**Bot behavior change:**
- Next Council: Automatically puts Q&A in task discussion (knows DEC-T045-001)
- If tempted to use Telegram: Flags conflict with DEC-T045-001

---

## Next Steps

1. Francisco reviews this design
2. If approved, start Phase 1 implementation
3. Test on T045, T046, T047 discussions
4. Iterate based on results
