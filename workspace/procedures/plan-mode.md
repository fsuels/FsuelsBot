---
updated: 2026-02-01
version: "1.0"
confidence: high
type: procedure
---

# 🗺️ Plan Mode Protocol

> **Trigger:** Complex tasks (complexity score > 5)
> **Rule:** Plan before you code. Think before you build.
> **Purpose:** Prevent scope creep, catch risks early, get alignment before investment

## 🧭 THE MOTTO (Applies to EVERY plan)

```
EVERY complex task
        ↓
   EXPLORE FIRST
   PLAN EXPLICITLY
   THEN EXECUTE
```

---

## WHEN DOES PLAN MODE TRIGGER?

Plan Mode is **MANDATORY** when ANY of these conditions apply:

### Complexity Score Calculation

| Factor | Points | Description |
|--------|--------|-------------|
| Multiple files affected | +2 | Changes span 3+ files |
| External API integration | +3 | Calling new APIs, webhooks, third-party services |
| Database/state changes | +2 | Modifying tasks.json schema, memory structures |
| User-facing changes | +2 | UI, messages, public-facing content |
| Security implications | +3 | Auth, permissions, credentials, data handling |
| New system/architecture | +4 | Creating new subsystems or major refactors |
| Reversibility difficulty | +2 | Hard to undo if wrong (deployments, data migrations) |
| External dependencies | +1 | Relies on other tasks completing first |
| Time estimate > 30 min | +1 | Non-trivial time investment |

**Thresholds:**
- **Score 0-4:** Quick task, execute directly
- **Score 5-7:** Plan Mode recommended, light plan
- **Score 8+:** Plan Mode mandatory, full plan + human approval

### Auto-Trigger Keywords

If task title/description contains these, auto-trigger Plan Mode:
- `UPGRADE`, `ARCHITECTURE`, `REFACTOR`, `MIGRATION`
- `INTEGRATION`, `API`, `DEPLOY`, `SCHEMA`
- `SECURITY`, `AUTH`, `PERMISSIONS`
- Any multi-step task with 5+ steps

---

## THE PLANNING PROCESS

### Phase 1: EXPLORE (Before anything else)

**Goal:** Understand what exists before changing it.

```
□ Read all related files (not just the one you'll change)
□ Check for dependencies (what uses this? what does this use?)
□ Search codebase for related patterns
□ Check tasks.json for related/blocked tasks
□ Understand the current architecture
```

**Output:** Brief summary of current state in plan file.

### Phase 2: SCOPE (Define the boundaries)

**Goal:** Be explicit about what's IN and OUT of scope.

```
□ What problem are we solving? (One sentence)
□ What files will change? (Explicit list)
□ What files will NOT change? (Important for scope creep)
□ What are the acceptance criteria? (How do we know we're done?)
□ What's explicitly out of scope? (Defer to future tasks)
```

**Output:** Scope section with clear boundaries.

### Phase 3: RISKS (Identify what could go wrong)

**Goal:** Think about failure modes before you're in the middle of building.

```
□ What could break? (List concrete risks)
□ How will we detect if something broke? (Verification plan)
□ What's the rollback plan? (If we need to undo)
□ Are there security implications?
□ Could this affect other running systems?
```

**Risk Categories:**
| Risk Level | Criteria | Action |
|------------|----------|--------|
| Low | Easily reversible, isolated impact | Note in plan |
| Medium | Moderate effort to fix, limited blast radius | Plan mitigation |
| High | Hard to reverse, affects multiple systems | Human approval required |

**Output:** Risk assessment in plan file.

### Phase 4: PLAN (Write step-by-step approach)

**Goal:** Break work into atomic, verifiable steps.

**Step Template:**
```markdown
### Step N: [Action]
- **What:** Specific action to take
- **Files:** Which files change
- **Verify:** How to confirm this step worked
- **Rollback:** How to undo if needed
```

**Step Rules:**
1. Each step should be independently verifiable
2. Each step should be reasonably atomic (one logical change)
3. Steps should have clear ordering (dependencies explicit)
4. Include verification after each significant step
5. Max 10 steps per plan (if more, break into sub-tasks)

### Phase 5: APPROVAL (For high-risk tasks)

**When human approval is required:**
- Complexity score 8+
- Any "High" risk identified
- External API integration (costs money or rate limits)
- Security-related changes
- Production deployments
- Schema changes affecting existing data

**Approval request format:**
```
🗺️ PLAN APPROVAL REQUEST

Task: T### - [Title]
Complexity: [Score] ([Factors])
Risk Level: [Low/Medium/High]

Summary: [2-3 sentences]

Key Risks:
- [Risk 1]
- [Risk 2]

Steps (brief):
1. [Step 1 summary]
2. [Step 2 summary]
...

Full plan: plans/T###-plan.md

Approve to proceed? (or suggest changes)
```

### Phase 6: EXECUTE (Only after planning)

**Now you can code.** But follow the plan:
- Execute steps in order
- Verify each step before moving to next
- Update plan with actual outcomes
- If deviating from plan, STOP and reassess

---

## PLAN FILE TEMPLATE

Location: `plans/T###-plan.md`

```markdown
---
task_id: T###
title: [Task Title]
complexity_score: [N]
risk_level: [Low/Medium/High]
status: draft | approved | in_progress | complete
created_at: [ISO timestamp]
approved_at: [ISO timestamp or null]
approved_by: [human | auto]
---

# Plan: T### - [Task Title]

## 1. Context

**Problem:** [What are we solving?]
**Why now:** [What triggered this task?]
**Related tasks:** [T###, T###]

## 2. Current State (Exploration Results)

[What exists today. Key files, patterns, dependencies discovered.]

## 3. Scope

**In Scope:**
- [Explicit list of what will change]

**Out of Scope:**
- [Explicit list of what will NOT change]

**Acceptance Criteria:**
- [ ] [How we know we're done - testable]
- [ ] [Another criterion]

## 4. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| [Description] | Low/Med/High | Low/Med/High | [How we'll handle it] |

**Rollback Plan:** [How to undo if everything goes wrong]

## 5. Step-by-Step Plan

### Step 1: [Action]
- **What:** [Specific action]
- **Files:** [Which files]
- **Verify:** [How to confirm]
- **Status:** pending | in_progress | done

### Step 2: [Action]
...

## 6. Execution Log

[Updated as work progresses]

| Step | Started | Completed | Notes |
|------|---------|-----------|-------|
| 1 | [time] | [time] | [outcome] |

## 7. Post-Completion

**Actual vs Planned:**
- [What went as expected]
- [What deviated and why]

**Lessons Learned:**
- [What to do differently next time]
```

---

## INTEGRATION WITH TASK WORKFLOW

### Task Schema Additions

Add to tasks.json task objects:
```json
{
  "T###": {
    "title": "...",
    "complexity_score": 7,           // Calculated score
    "has_plan": true,                // Plan exists
    "plan_path": "plans/T###-plan.md", // Path to plan file
    "plan_status": "draft" | "approved" | "in_progress" | "complete",
    "plan_approved_by": "human" | "auto", // Who approved
    "plan_approved_at": "ISO timestamp"
  }
}
```

### Updated Task Lifecycle

```
1. Task Created
   ↓
2. Calculate complexity_score
   ↓
3. If score >= 5 → Create plan (has_plan: true)
   ↓
4. If score >= 8 → Request human approval
   ↓
5. Plan approved → Execute steps
   ↓
6. Complete steps → Peer review
   ↓
7. Approved → Done
```

### Complexity Auto-Calculation

When creating a task, scan for triggers:
```javascript
function calculateComplexity(task) {
  let score = 0;
  
  // Check title keywords
  const keywords = ['UPGRADE', 'ARCHITECTURE', 'REFACTOR', 'API', 'DEPLOY', 'SECURITY'];
  if (keywords.some(k => task.title.toUpperCase().includes(k))) score += 3;
  
  // Check step count
  if (task.steps && task.steps.length >= 5) score += 2;
  
  // Check if modifying core files
  const coreFiles = ['AGENTS.md', 'SOUL.md', 'tasks.json'];
  if (task.affected_files?.some(f => coreFiles.includes(f))) score += 2;
  
  // Check explicit complexity markers
  if (task.affects_external_api) score += 3;
  if (task.affects_database) score += 2;
  if (task.is_deployment) score += 2;
  
  return score;
}
```

---

## QUICK REFERENCE

### When to Plan
| Complexity | Action |
|------------|--------|
| 0-4 | Execute directly |
| 5-7 | Create light plan, self-approve |
| 8+ | Full plan + human approval |

### Plan Status Flow
```
draft → approved → in_progress → complete
```

### Minimum Plan (Score 5-7)
- Scope (what's in/out)
- Steps (numbered list)
- Risks (brief)

### Full Plan (Score 8+)
- Full template above
- Human approval required
- Execution log maintained

---

## ENFORCEMENT

1. **Task creation check** — Calculate complexity on creation
2. **Execution gate** — Score 8+ tasks blocked until plan_status = "approved"
3. **CI audit** — Flag tasks marked done without plan when complexity >= 5
4. **Retrospective** — Compare planned vs actual in post-completion

---

## ANTI-PATTERNS

❌ **Planning paralysis** — Spending more time planning than doing
❌ **Fake planning** — Writing plan after the work is done
❌ **Scope creep** — Adding to plan mid-execution without reassessing
❌ **Ignoring the plan** — Having a plan but not following it
❌ **Over-planning simple tasks** — Score 2 task with 10-step plan

---

## CHANGELOG

- **v1.0 (2026-02-01):** Initial implementation
  - Complexity scoring system
  - Plan template and workflow
  - Integration with task lifecycle
  - Human approval for high-risk tasks
