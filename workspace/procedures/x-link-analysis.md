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
2. **Is this relevant to Ghost Broker / our current projects?**
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

### Step 5: Document the Logic Trail
Task card must include:
- `analysis.post_summary` — what the post says
- `analysis.comments_summary` — key insights from replies
- `analysis.use_cases` — what we can use
- `analysis.discard` — what to ignore and why
- `analysis.next_actions` — concrete steps to apply learnings

### Step 6: Decide on Engagement (Secondary)
Only AFTER learning extraction:
- Should we reply? (adds value, not just promotion)
- Should we follow the author?
- Should we save for future reference?

### Step 7: Report to Francisco
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
  "context": {
    "summary": "Francisco shared X link for analysis. Extracting learnings.",
    "source_url": "[the X link]"
  },
  "analysis": {
    "post_summary": "[Core thesis of the post]",
    "author_credibility": "[Who is this person, why listen?]",
    "engagement": "[views/likes/reposts]",
    "comments_summary": "[Key insights from replies]",
    "use_cases": ["[What we can apply]"],
    "discard": ["[What to ignore and why]"],
    "next_actions": ["[Concrete steps]"]
  },
  "steps": [
    {"step": "Read post deeply", "status": "done"},
    {"step": "Read comments", "status": "done"},
    {"step": "Evaluate for business", "status": "done"},
    {"step": "Document logic trail", "status": "done"},
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
5. **READ THE COMMENTS** — often more valuable than the post itself

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

**If the audit trail is missing or incomplete, the task is NOT DONE.**

This rule exists because:
1. Context gets compacted — the original content disappears
2. Francisco needs to verify my analysis against the source
3. Without receipts, there's no accountability
