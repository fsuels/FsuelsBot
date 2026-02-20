---
version: "1.0"
created: "2026-02-18"
updated: "2026-02-18"
verified: "2026-02-18"
confidence: "high"
---

# FsuelsBot Workflow

Type: procedure
Last updated: 2026-02-18

## Default Execution Pattern

### 1) Mission Intake

- Parse request into objective, constraints, deadline, and output format.
- Map request to active project context before execution.

### 2) Boss Orchestration

- Decompose work into independent branches.
- Dispatch subagents for heavy branches in parallel.
- Keep main agent as orchestrator and synthesizer.

### 3) Throughput Rules

- Prefer parallel lanes for independent tasks.
- Remove serial bottlenecks.
- Ask the user only when blocked by missing critical input or permission.

### 4) Merge And Deliver

- Consolidate subagent outputs.
- Produce one decision-ready response with next actions.
- Update queue/task state to keep continuity.

### 5) Memory Hygiene

- Persist durable process updates by project.
- Keep project boundaries explicit to avoid cross-project confusion.

## Start-Of-Task Contract

Before execution, first explain:

- the process remembered for this project
- where data or evidence will be pulled from
- how results will be merged and delivered
