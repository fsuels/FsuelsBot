---
version: "1.0"
created: "2026-02-18"
updated: "2026-02-18"
verified: "2026-02-18"
confidence: "medium"
---

# 123LegalDoc Workflow

Type: procedure
Last updated: 2026-02-18

## Default Execution Pattern

### 1) Intake And Scope

- Identify target page/doc type/state.
- Confirm environment and safety constraints.
- Keep scope on English pages unless explicitly expanded.

### 2) Verify Existing Knowledge

- Read memory/global/123legaldoc-qa.md first.
- Reuse known bug IDs and prior findings to avoid duplicate diagnosis.

### 3) Execute QA Or Build Task

- For QA: reproduce, capture exact behavior, and classify severity.
- For fixes/spec work: define acceptance checks before implementation.

### 4) Report In Operator Format

- What was tested/changed
- What passed
- What failed or is blocked
- Exact next action

### 5) Persist Durable Updates

- Update project knowledge or QA memory when behavior changes.
- Keep statuses explicit (open, in progress, blocked, done).

## Start-Of-Task Contract

Before doing the task, first state:

- the process being used
- where evidence will come from
- expected deliverable
