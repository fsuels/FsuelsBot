# X Link Analysis Procedure

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
