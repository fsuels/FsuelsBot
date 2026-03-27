# Task Card Standard

_Updated: 2026-03-27_
_Source: Francisco's directive — task cards must be fully self-contained agent briefings_

## Core Rule

**If an agent can't complete the task from the card alone, the card failed.**

Sub-agents start with zero context. No memory of prior conversations. No access to the orchestrator's chat history. The task card `.md` file in `memory/tasks/` IS their entire world.

## Required Sections

### 1. Header Block

```
# Task: <task-id>
## <Human-readable title>

**Status:** blocked | ready | in_progress | done
**Created:** <date>
**Updated:** <date>
**Blocked by:** <reason, if blocked>
```

### 2. Goal

One paragraph. What does "done" look like? Be specific and measurable.

- ❌ "Update the website images"
- ✅ "Generate AI photoshoot images for all 12 dresses in the DressLikeMommy collection using Pomelli.com, download them, and upload to replace existing images on Shopify product pages"

### 3. Context & Background

Everything the agent needs to understand WHY this task exists and WHAT decisions have been made. Include:

- Business context (who, what, why)
- Prior attempts and what happened
- Key decisions already made (and why)
- Constraints or preferences from the user

### 4. Resources

Every URL, path, credential, and tool the agent will need:

```
## Resources
- **Tool:** Pomelli AI Photoshoot → https://labs.google.com/pomelli/photoshoot
- **Store:** https://www.dresslikemommy.com/collections/dresses
- **Admin:** https://admin.shopify.com/store/dresslikemommy-com/products
- **Source images:** /Users/fsuels/Desktop/dress-photos/
- **Skill:** Peekaboo → /Users/fsuels/clawd/skills/peekaboo/SKILL.md
- **Credentials:** Shopify login via browser (already authenticated)
```

Missing resources should be listed as blockers, not omitted.

### 5. Checklist (Step-by-Step)

Each step must be actionable WITH instructions. Not just "what" but "how":

- ❌ `- [ ] Upload images to Pomelli`
- ✅ `- [ ] **Upload images to Pomelli** — Open Chrome to https://labs.google.com/pomelli/photoshoot. Use Peekaboo to click the upload button (class: .upload-btn). Select files from /Users/fsuels/Desktop/dress-photos/. Wait for upload confirmation toast.`

Steps should be ordered and include:

- The action to take
- The tool/method to use
- Expected inputs/outputs
- How to verify the step succeeded

Mark completed steps with `[x]` and include brief outcome notes.

### 6. Current State

Where are we RIGHT NOW? Include:

- Which step we're on
- What's been tried and what happened
- Any partial outputs or intermediate files
- Error messages or unexpected behavior encountered

### 7. Agent Instructions

Specific guidance for the executing agent:

- Which model to use (if specified)
- Which tools are available and how to access them
- Approach preferences (e.g., "use coordinate-click fallback if Accessibility not granted")
- What to do if blocked (ask user? try alternative? skip and continue?)
- Output format expectations

### 8. Acceptance Criteria

How to verify the task is actually done:

- Specific checks to run
- Expected outputs to confirm
- User sign-off requirements

### 9. Karpathy-Inspired AutoResearch Strategy (for analysis/research tasks)

When the task needs deep understanding, use this loop and capture it in the card so the user can audit reasoning quality:

1. **Restate the problem exactly**
   - Quote exact user text driving the task (no paraphrase in this step).
   - List explicit constraints and implicit assumptions separately.

2. **Build a baseline mental model first**
   - Write a short first-principles explanation of how the system should work.
   - Identify likely failure points before collecting more data.

3. **Run focused evidence passes**
   - Pass A: configuration/state evidence
   - Pass B: runtime behavior/log evidence
   - Pass C: business impact evidence (metrics/outcomes)
   - For each pass, capture receipts (file path, command output, screenshot, URL).

4. **Generate and test rival hypotheses**
   - Maintain at least 2 plausible explanations.
   - Try to falsify each hypothesis with one concrete check.

5. **Synthesize in plain language**
   - Separate: _What is verified_, _What is likely_, _What is unknown_.
   - Convert findings into a prioritized action plan.

6. **Close the loop with measurable next actions**
   - Each action must include owner, tool, receipt target, and success condition.
   - If uncertainty remains, define the minimum next test to reduce it.

**Card requirement:** Research-type cards should include an `autoresearch_strategy` block (or equivalent section in the plan) with these loop steps adapted to the task.

## Anti-Patterns

| Don't                                | Do Instead                                          |
| ------------------------------------ | --------------------------------------------------- |
| Truncated text (`...`) anywhere      | Write it fully or summarize intentionally           |
| Raw user messages as step text       | Interpret and write clear instructions              |
| "Upload images" (no method)          | "Upload images using Peekaboo click on .upload-btn" |
| Missing URLs/paths                   | List every resource; mark unknowns as blockers      |
| Vague goals                          | Specific, measurable outcomes                       |
| No current state section             | Always say where we are right now                   |
| Assuming agent knows project history | Include all relevant context inline                 |

## Template

See `memory/global/task-card-template.md` for a copy-pasteable template.

## File Location

Task cards: `memory/tasks/<task-id>.md`
State saves (for complex tasks): `memory/tasks/<task-id>-state.md`
