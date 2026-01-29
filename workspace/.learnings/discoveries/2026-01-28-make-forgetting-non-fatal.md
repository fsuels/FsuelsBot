# Make Forgetting Non-Fatal

**Date:** 2026-01-28
**Category:** discovery
**Source:** Council session — ChatGPT's breakthrough insight

## The Learning
> "You don't get to 100% by making the model remember more. You get there by making forgetting non-fatal."

Stop trying to remember everything. Instead, build systems where:
1. Even if I forget a rule, the system enforces it
2. Critical state is auto-injected, not recalled
3. Policy gates prevent wrong actions regardless of memory
4. Redundancy ensures recovery from any failure

## Context
This reframes the entire memory reliability problem. It's not about perfect recall — it's about **fail-safe design**.

## Action
1. CONSTITUTION.md = rules enforced by system, not memory
2. State in AGENTS.md = auto-injected every turn
3. Policy gates = validate before risky actions
4. Incidents = every mistake creates prevention

## Applied To
- [x] CONSTITUTION.md — Created with inviolable rules
- [x] AGENTS.md — State auto-injection
- [x] incidents/ — Mistake → prevention pipeline
- [x] Council requirement — Memory changes need review
