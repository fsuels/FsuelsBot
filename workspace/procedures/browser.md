---
version: "1.1"
created: "2026-01-29"
updated: "2026-01-31"
verified: "2026-01-31"
confidence: "high"
type: "procedure"
---

# 🌐 Browser Procedure (MANDATORY)

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
- [ ] Actions are intentional (not grinding without purpose)

---

**Read this COMPLETELY before ANY browser action.**

---

## Pre-Flight Checklist

Before touching the browser, complete these:

1. [ ] Run `browser tabs` command
2. [ ] Count current tabs: ___
3. [ ] Identify target domain (shopify.com? 1688.com? buckydrop.com?)
4. [ ] Check: Is that domain already open? Y/N

---

## Verification Gate

**You MUST state this in your response before any browser action:**

> "Browser check: [N] tabs open. [domain] [is/is not] already open. Action: [navigate existing tab / open new tab / close tab]."

If you cannot state this, you haven't done the check. STOP and do it.

---

## The Rules (MEMORIZE)

### Rule 1: ONE TAB PER DOMAIN
- 1 Shopify tab maximum
- 1 BuckyDrop tab maximum  
- 1 1688 tab maximum
- **NEVER** open a second tab for the same site

### Rule 2: NAVIGATE, DON'T DUPLICATE
- Need a different Shopify page? Navigate within the existing Shopify tab
- Need a different 1688 product? Navigate within the existing 1688 tab
- **NEVER** open a new tab when you can navigate

### Rule 3: CLOSE WHEN DONE
- Task complete? Close the tab
- Tab no longer needed? Close it
- **Maximum 3-4 tabs total at any time**

---

## Common Mistakes to Avoid

❌ Opening Shopify admin when a Shopify tab is already open
❌ Opening new 1688 tab for each product
❌ Leaving 6+ tabs open after a task
❌ Not checking `browser tabs` first

✅ Always check tabs first
✅ Navigate within existing tabs
✅ Close tabs immediately when done
✅ Keep total tabs ≤ 4

---

## Quick Reference

```
BEFORE: browser tabs → check for domain → decide action
DURING: navigate existing OR open ONE new  
AFTER:  close unneeded tabs → verify ≤ 4 remain
```

---

## 🚨 FALLBACK RULE: 2-Strike Automation Failure (T198)

**If browser automation fails TWICE on the same action → STOP GRINDING.**

### The Rule
1. First failure → Retry with fresh snapshot
2. Second failure → STOP. Generate human instructions instead.

### When to Use Fallback
- Timeout errors (locator.fill, locator.click)
- Element not found after snapshot
- Cross-origin iframe issues
- Any repeated error on same action

### Human Instructions Template

When fallback triggers, provide:

```
🖱️ MANUAL ACTION NEEDED

**What to do:**
1. [Step-by-step instructions]
2. [Include exact text to type/click]
3. [Include expected result]

**Why bot failed:**
[Brief explanation]

**URL:** [current page URL]
```

### Example Fallback

```
🖱️ MANUAL ACTION NEEDED

**What to do:**
1. Go to Shopify Admin → Online Store → Navigation
2. Click "Main menu"
3. Click "Add menu item"
4. Title: "Valentine's Day" 
5. Link: Select "Collections" → "Valentine's Day"
6. Click "Save"

**Why bot failed:**
Shopify iframe blocked automation (cross-origin)

**URL:** https://admin.shopify.com/store/dresslikemommy-com/menus
```

### Speed Reality Check
- Bot: screenshot → process → action → wait → repeat = 5-15 sec/step
- Human: look → click = 1 second
- **For quick edits, human is FASTER. Don't be stubborn.**
