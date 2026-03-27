# Task Card Template

Copy this when creating a new task card. Fill every section — if a section doesn't apply, write "N/A" (don't delete it, so agents know it was considered).

---

```markdown
# Task: <task-id>

## <Clear, descriptive title>

**Status:** ready | in_progress | blocked | done
**Created:** <YYYY-MM-DD>
**Updated:** <YYYY-MM-DD HH:MM TZ>
**Blocked by:** <reason — delete line if not blocked>

## Goal

<What does "done" look like? Be specific. One paragraph max.>

## Context & Background

<Why does this task exist? What's the business need? What decisions have been made already? What was tried before and what happened? Include anything the agent needs to understand the situation.>

## Resources

- **URL:** <name> → <url>
- **Path:** <description> → <absolute path>
- **Tool:** <name> → <skill path or command>
- **Credential:** <how to access — e.g., "browser session already authenticated" or "API key in env var X">
- **Missing:** <anything we don't have yet — these are blockers>

## Checklist

- [ ] **Step 1: <Title>** — <Detailed instructions: what to do, which tool to use, expected input/output, how to verify success>
- [ ] **Step 2: <Title>** — <Same level of detail>
- [x] **Step 3: <Title>** — <Completed: brief note on outcome>

## Current State

<Which step are we on? What's been done so far? Any partial outputs, temp files, errors encountered?>

## Agent Instructions

- **Model:** <e.g., "Use Sonnet for cost efficiency" or "Default is fine">
- **Tools available:** <list with access notes>
- **If blocked:** <what to do — ask user? try fallback? skip?>
- **Output format:** <what the final deliverable should look like>
- **Special notes:** <any other guidance>

## AutoResearch Strategy (Karpathy-inspired) [Use for research/analysis tasks]

- **Exact user text captured:**
  - "<quote exact user wording line 1>"
  - "<quote exact user wording line 2>"
- **Baseline model (first principles):** <how the system should work>
- **Evidence passes:**
  - Pass A (config/state): <what to inspect>
  - Pass B (runtime behavior): <what to inspect>
  - Pass C (business impact): <what to inspect>
- **Rival hypotheses to test:**
  - H1: <hypothesis> → falsification check: <check>
  - H2: <hypothesis> → falsification check: <check>
- **Synthesis format:**
  - Verified:
  - Likely:
  - Unknown:
- **Action loop closure:**
  - Next action 1 + receipt target + success condition
  - Next action 2 + receipt target + success condition

## Acceptance Criteria

- [ ] <Specific check 1>
- [ ] <Specific check 2>
- [ ] <How user signs off>
```
