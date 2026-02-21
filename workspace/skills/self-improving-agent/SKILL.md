---
name: self-improvement
description: "Self-modify workspace files when you learn something new. Use when: (1) A command fails and you discover why, (2) User corrects you, (3) You find a better approach to a recurring task, (4) Knowledge is outdated, (5) A new tool/workflow is proven. Writes directly to SOUL.md, TOOLS.md, MEMORY.md, procedures/, or creates new skills."
---

# Self-Improvement Skill

You are a self-modifying agent. When you learn something important, you don't just remember it in context — you **write it down permanently** so future sessions benefit.

## Where to Write

| What you learned                 | Write to                                             |
| -------------------------------- | ---------------------------------------------------- |
| Behavioral rule / principle      | `SOUL.md`                                            |
| Tool gotcha / Mac workflow       | `TOOLS.md`                                           |
| Project fact / URL / config      | `MEMORY.md`                                          |
| User preference / standing order | `USER.md`                                            |
| Reusable multi-step workflow     | `procedures/<name>.md` (new file)                    |
| Repeatable skill with trigger    | `skills/<name>/SKILL.md` (new skill)                 |
| Error pattern + fix              | `memory/global/rules.md`                             |
| Person / relationship info       | `memory/global/family.md` or `memory/global/user.md` |

## When to Trigger

**Auto-detect these signals:**

- User says "remember this", "save this", "don't forget"
- User corrects you: "No, actually...", "That's wrong", "I told you before"
- A command fails and you figure out why (save the fix)
- You discover a tool works differently than expected
- You find a better/faster way to do something you've done before
- User teaches you a new workflow or preference

## How to Write

1. **Read the target file first** — don't duplicate what's already there
2. **Append concisely** — one rule, one line when possible
3. **Use the file's existing format** — match headers, style, structure
4. **Date it** if temporal (e.g., "Added 2026-02-20")
5. **Tell the user** what you wrote and where

## Creating New Procedures

If the learning is a multi-step workflow (3+ steps), create a procedure:

```
workspace/procedures/<name>.md
```

Format:

```markdown
# <Name>

When: <trigger condition>
Steps:

1. ...
2. ...
3. ...
   Verified: <date>
```

## Creating New Skills

If the learning is a repeatable capability with a clear trigger, create a skill:

```
workspace/skills/<name>/SKILL.md
```

Format:

```markdown
---
name: <skill-name>
description: "<when to use this skill — this is the trigger>"
---

# <Skill Name>

<Instructions for the agent>
```

## Quality Gates

Before writing anything permanent:

- [ ] Is this a real pattern, not a one-off fluke?
- [ ] Did I verify the cause/fix actually works?
- [ ] Is this already written somewhere? (search first)
- [ ] Will this help future sessions? (if not, skip it)

## Examples

**User says:** "No, use `screencapture -x` not `screencapture` — the -x flag suppresses the shutter sound"
→ **Write to TOOLS.md** under screenshot section: `Always use -x flag to suppress shutter sound`

**Command `lms load` fails with context error**
→ **Write to MEMORY.md**: `LM Studio: always verify context with lms ps after load — may reset to 4096`

**User teaches a new 5-step deployment workflow**
→ **Create** `procedures/deploy.md` with the steps

**You discover a pattern for checking gateway health**
→ **Create** `skills/gateway-health/SKILL.md` with trigger and steps
