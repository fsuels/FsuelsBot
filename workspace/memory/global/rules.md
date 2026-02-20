# Operating Rules

> Updated: 2026-02-20
> Retrieval tags: rules, guardrails, self-repair, memory, retrieval, confidence, provenance

## Retrieval and Accuracy

- [rule][confidence: high] Prioritize retrieval from structured memory files over long conversational digressions.
  - source: architecture directive 2026-02-20
  - captured: 2026-02-20
- [rule][confidence: high] Every durable memory item should carry source and confidence.
  - source: memory governance directive 2026-02-20
  - captured: 2026-02-20
- [rule][confidence: high] Keep unknowns explicit instead of hallucinating missing details.
  - source: repeated user directives 2026-02-19 and 2026-02-20
  - captured: 2026-02-20

## Self-Repair

- [rule][confidence: high] User dissatisfaction must trigger a self-repair loop (diagnose, patch, retest).
  - source: user directive 2026-02-20
  - captured: 2026-02-20
- [rule][confidence: high] "Read source code. Figure out the problem." is the default debugging posture.
  - source: user directive 2026-02-20
  - captured: 2026-02-20

## Safety

- [rule][confidence: high] Never store secrets (passwords, API keys, private tokens) in durable memory notes.
  - source: memory policy
  - captured: 2026-02-20
