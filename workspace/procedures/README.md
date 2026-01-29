# Bulletproof Procedure Memory System

## The Problem This Solves

Francisco spent hours teaching procedures that were forgotten within hours:
- Browser tab management (one tab per domain)
- Product listing workflow (1688 → BuckyDrop → Shopify)  
- Pricing calculations (50% profit margin)

Despite being written down, the AI didn't reliably consult them.

## The Solution: 3-Layer Defense

### Layer 1: INJECTION (Can't Miss)
- Critical procedures are summarized directly in **AGENTS.md**
- AGENTS.md is read EVERY session, unconditionally
- Quick reference rules are impossible to miss

### Layer 2: TRIGGER-BASED LOADING  
- When a task involves trigger keywords → READ the procedure file
- Procedure files are in `procedures/`
- `manifest.json` maps triggers → procedure files

### Layer 3: VERIFICATION CHECKPOINTS
- Each procedure has a "verification gate" statement
- AI must STATE the verification in its response
- This forces conscious acknowledgment before acting

## How It Works

1. **Session starts** → AI reads AGENTS.md → Sees procedure checkpoint section
2. **Task arrives with trigger word** → AI reads relevant procedure file
3. **AI states verification gate** → Confirms procedure was read
4. **AI executes task** → Following documented steps
5. **AI completes exit checklist** → Verifies compliance

## Files in This Directory

| File | Purpose |
|------|---------|
| `browser.md` | Browser/tab management rules |
| `product-listing.md` | Full listing workflow |
| `pricing.md` | Pricing formula and rules |
| `manifest.json` | Trigger-to-procedure mapping |
| `README.md` | This file |

## Adding New Procedures

1. Create `procedures/[name].md` with:
   - Pre-flight checklist
   - Verification gate statement
   - The rules/steps
   - Exit checklist
   - Common mistakes to avoid

2. Add entry to `manifest.json` with:
   - File name
   - Trigger keywords
   - Priority level
   - Blocking flag

3. Add quick reference to AGENTS.md procedure checkpoint table

## Why This Works

| Old Approach | New Approach |
|--------------|--------------|
| Procedures in separate files | Critical rules in AGENTS.md (always read) |
| Hope AI remembers to check | Explicit trigger → read mandate |
| No verification | Must state verification gate |
| Silent failures | Exit checklists catch mistakes |

The key insight: **Passive documentation fails. Active enforcement succeeds.**

---

*Created: 2026-01-29*
*Purpose: Guarantee procedure compliance across context resets*
