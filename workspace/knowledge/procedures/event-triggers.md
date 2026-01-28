# Event-Based Trigger System
*Source: Council Team Architecture Debate (EVT-20260128-065)*
*Established: 2026-01-28*

## Philosophy

Work is triggered by **state changes**, not idle timers. "No backlog items" is a trigger. "5 minutes idle" is noise.

## Trigger Conditions

Check on every **heartbeat** + **task completion**:

### Automatic Triggers (no approval needed)

| Condition | Action | Function |
|-----------|--------|----------|
| Task just completed | Run QA pressure check on output | QA Loop |
| Backlog has items scoring 12+ | Dispatch highest-scored item | Orchestrator |
| Daily 9 AM | Run research/opportunity scan | Research Loop |
| New product added to Shopify | Audit listing quality | QA Loop |
| Error detected in sub-agent | Log learning, check for pattern | QA Loop |
| Git has uncommitted changes | Commit and push | Orchestrator |

### Proposal Triggers (QA/Research propose, Orchestrator decides)

| Condition | Proposal | Function |
|-----------|----------|----------|
| QA finds improvable process | "This could be automated/templated" → spawn Automation() | QA Loop |
| QA finds stale content | "These listings need refresh" → spawn Content() | QA Loop |
| Research finds competitor move | "Competitor X launched Y, here's our response" → Orchestrator decides | Research Loop |
| Research finds trending niche | "This niche is growing, here's the opportunity" → Orchestrator decides | Research Loop |
| Earn/kill threshold approaching | "Agent X has only N tasks in 2 weeks" → flag for review | QA Loop |

### Francisco Triggers (only on his request)

| Condition | Action |
|-----------|--------|
| Francisco sends a link | Analyze → score → dispatch to right function |
| Francisco asks a question | Answer directly or delegate |
| Francisco says "Council" | Invoke Council() debate mode |
| Francisco approves Tier B/C action | Execute approved action |

## Anti-Patterns (Don't Do This)

- ❌ Time-based idle timers ("idle for 5 minutes → invent a task")
- ❌ Perpetual loops that run regardless of state
- ❌ Busywork to appear active
- ❌ Dispatching low-score tasks when nothing urgent exists (rest is fine)

## What "Nothing to Do" Means

If no triggers fire and no backlog items score above 5:
1. Research Loop does a light opportunity scan
2. QA Loop reviews recent outputs for template opportunities
3. If still nothing → system is healthy. HEARTBEAT_OK is valid.
