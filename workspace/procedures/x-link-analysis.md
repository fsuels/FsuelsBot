# X Link Analysis Procedure

## 🧭 EPISTEMIC DISCIPLINE (READ FIRST)

```
EVERY response I give
EVERY analysis I make
EVERY recommendation I offer
EVERY claim I accept
EVERY action I take
        ↓
   SOUND LOGIC
 VERIFIED EVIDENCE
   NO FALLACIES
```

### Before completing this procedure, verify:
- [ ] Logic is sound (no gaps in reasoning)
- [ ] Evidence is verified (not assumed)
- [ ] Fallacies checked (see list below)

---

**Trigger:** Francisco sends an X (Twitter) link

## ADAPT Implementation Status

- ✅ **Phase 1 implemented:** Pseudo-RLM Deep Mode trigger + strict budgets + structured output
- ✅ **Phase 2 implemented:** Controlled recursive decomposition + scoring rubric merge
- ✅ **Default preserved:** Standard X analysis remains default for normal links

---

## Routing Mode (Default vs Deep Mode)

### Default Mode (normal links)
Use the standard workflow when content is short/clear and does not require decomposition.

### Deep Mode (heavy links) — Phase 1
Auto-trigger Deep Mode when **any** condition matches:
1. Long source content (thread, paper, repo docs, long article)
2. High ambiguity or mixed claims that need separation
3. Multiple implementation options with non-trivial tradeoffs
4. High expected decision impact for Fsuelsbot
5. User asks for deep/proposal/implementation comparison

**Rule:** Keep current workflow as the baseline. Deep Mode is opt-in by criteria above, not global replacement.

---

## Deep Mode Budgets (Hard Limits) — Phase 1

Set and enforce budgets at start of analysis:

- `max_steps: 8`
- `max_subcalls: 6`
- `max_tokens: 12000`
- `timeout_minutes: 12`

### Early stop conditions
Stop and return partial findings if any condition is hit:
- Budget exhausted (`steps`, `subcalls`, or `tokens`)
- Timeout reached
- Confidence remains low after 2 decomposition rounds
- Conflicting evidence cannot be resolved safely

When stopping early, explicitly report:
- what is known
- what is uncertain
- minimum next action to reduce uncertainty

---

## Automatic Workflow

### Step 1: Create Task Card Immediately
```
Title: "X Analysis: [Author] - [Topic Summary]"
Priority: P1
Status: in_progress
```

### Step 2: Read the Post Deeply
- Open the link in browser
- Read the FULL post text
- Note: author, credentials, engagement (views/likes/reposts)
- Capture the core thesis/idea

### Step 3: Read ALL Comments/Replies
- Scroll through replies
- Extract valuable insights from commenters
- Note skeptics/critics — what are their objections?
- Note supporters — what do they add?

### Step 4: Evaluate for Our Business
Answer these questions in the task card:
1. **What is the core idea?**
2. **Is this relevant to Fsuelsbot / our current projects?**
3. **What can we LEARN and APPLY?**
4. **What should we DISCARD and why?**
5. **Are there specific techniques/approaches we should adopt?**

### Step 4.5: FALLACY CHECK (MANDATORY)
Before accepting ANY claim from the post, verify:
- [ ] **Not Ad Hominem** — attacks argument, not person
- [ ] **Not Bandwagon** — popularity ≠ truth ("everyone is doing X")
- [ ] **Not False Cause** — correlation ≠ causation
- [ ] **Not Appeal to Authority** — credentials ≠ correctness
- [ ] **Not Hasty Generalization** — sufficient sample size
- [ ] **Evidence provided** — not just claims/opinions
- [ ] **Reproducible** — could we verify this independently?

**If ANY fallacy detected:** Note it in `analysis.fallacies_detected` field and discount that claim.

### Step 5: Deep Mode Structured Output (Required when Deep Mode is active) — Phase 1
Return this structure exactly:

1. **What we have now**
2. **What this link adds**
3. **Adopt / Adapt / Ignore**
4. **Risks + next actions**

This output is mandatory in Deep Mode to keep decisions auditable and actionable.

### Step 6: Recursive Decomposition (Deep Mode only) — Phase 2
If source is still too large/complex after initial pass:

1. Split into chunks/questions:
   - claims
   - mechanisms
   - evidence quality
   - implementation implications
2. Process each chunk as a bounded sub-analysis (`subcall`)
3. Max recursion depth: `2`
4. Merge findings with the scoring rubric below

### Step 7: Scoring Rubric Merge (Deep Mode only) — Phase 2
Score each candidate recommendation 1–5 on:
- **impact**
- **effort**
- **risk**
- **confidence**

Compute priority using:

`priority_score = (impact * confidence) - (effort + risk)`

Then rank and output:
- Top 1–3 recommended actions
- Why each ranked where it did
- One "do now" action (highest ROI)

### Step 8: Decide on Engagement (Secondary)
Only AFTER learning extraction:
- Should we reply? (adds value, not just promotion)
- Should we follow the author?
- Should we save for future reference?

### Step 9: Report to Francisco
Summarize:
- What I learned
- What I recommend we do
- Link to full task card for audit trail

---

## Task Card Template

```json
{
  "title": "X Analysis: @[handle] - [topic]",
  "status": "in_progress",
  "mode": "default | deep",
  "budgets": {
    "max_steps": 8,
    "max_subcalls": 6,
    "max_tokens": 12000,
    "timeout_minutes": 12,
    "recursion_depth_max": 2
  },
  "context": {
    "summary": "Francisco shared X link for analysis. Extracting learnings.",
    "source_url": "[the X link]"
  },
  "analysis": {
    "post_summary": "[Core thesis of the post]",
    "author_credibility": "[Who is this person, why listen?]",
    "engagement": "[views/likes/reposts]",
    "comments_summary": "[Key insights from replies]",
    "what_we_have_now": "[Current Fsuelsbot baseline relevant to this link]",
    "what_this_link_adds": "[Net-new idea or capability]",
    "adopt": ["[Adopt as-is]"] ,
    "adapt": ["[Adapt with constraints]"] ,
    "ignore": ["[Ignore and rationale]"],
    "risks": ["[Main failure modes]"] ,
    "next_actions": ["[Concrete steps]"]
  },
  "decomposition": {
    "enabled": true,
    "questions": ["[Q1]", "[Q2]"],
    "findings": [
      {
        "question": "[Q1]",
        "finding": "[Result]",
        "impact": 1,
        "effort": 1,
        "risk": 1,
        "confidence": 1,
        "priority_score": 0
      }
    ]
  },
  "steps": [
    {"step": "Read post deeply", "status": "done"},
    {"step": "Read comments", "status": "done"},
    {"step": "Evaluate for business", "status": "done"},
    {"step": "Deep mode structure completed", "status": "done"},
    {"step": "Recursive decomposition (if needed)", "status": "done"},
    {"step": "Report to Francisco", "status": "done"}
  ]
}
```

---

## Key Principles

1. **LEARN before PROMOTE** — extraction first, engagement second
2. **DOCUMENT everything** — Francisco can audit the logic
3. **BE CRITICAL** — not everything is useful, identify what to discard
4. **APPLY learnings** — end with concrete next actions
5. **READ THE COMMENTS** — often more valuable than the post
6. **RESPECT BUDGETS** — deep thinking is useful only if bounded
7. **DECOMPOSE, THEN MERGE** — split complexity, then rank by rubric

## ⚠️ MANDATORY: Audit Trail (NON-NEGOTIABLE)

**EVERY task card MUST have `audit_trail` containing:**
- `source_url` — clickable link to original
- `captured_at` — timestamp when I read it
- `original_post.full_text` — THE ACTUAL TEXT, not a summary
- `original_post.author` — handle
- `original_post.author_bio` — who is this person
- `engagement_snapshot` — views, likes, reposts, bookmarks, replies
- `key_replies[]` — array with author, text, engagement for each
- `analysis_logic` — why_relevant, connection_to_business, reply_strategy, what_to_ignore
- `termination_reason` — normal_complete | budget_exceeded | timeout | low_confidence | conflicting_evidence

**If the audit trail is missing or incomplete, the task is NOT DONE.**

This rule exists because:
1. Context gets compacted — the original content disappears
2. Francisco needs to verify my analysis against the source
3. Without receipts, there's no accountability
