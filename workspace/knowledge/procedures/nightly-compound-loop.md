# Nightly Compound Loop
*Source: 4-Thinker Council — Musk + Karpathy + Hassabis + Carson synthesis (2026-01-28)*

## Schedule
- **9:00 PM** — Curiosity Engine (explore anomalies, feed discoveries into backlog)
- **10:30 PM** — Phase 1: LEARN (review, extract, update instructions)
- **11:00 PM** — Phase 2: SHIP (pick top task, execute, score, commit draft)

## Phase 1: LEARN (10:30 PM)
**Model:** Sonnet (cheap, fast)
**Duration:** ~15 min
**Steps:**
1. Read today's memory file (`memory/YYYY-MM-DD.md`)
2. Read today's conversation transcripts
3. Diff today's git commits
4. Extract max 5 atomic lessons:
   ```yaml
   LESSON:
     Context: [what happened]
     Failure: [what went wrong or could be better]
     Fix: [what to do differently]
     Prevention: [rule to add]
   ```
5. Update relevant knowledge files with new lessons
6. Update persona prompts if domain-specific learnings found
7. Run self-test: check last 7 days of task scores — new instructions must not regress
8. Commit with tag `nightly-learn`

## Phase 2: SHIP (11:00 PM)
**Model:** Sonnet (Opus fallback for complex tasks)
**Duration:** ~30 min
**Steps:**
0. **PREFLIGHT GATE (MANDATORY):** Run `scripts/preflight-check.ps1` — verifies AGENTS.md and pack.md are fresh. If preflight fails, HALT and alert. This ensures agent reads fresh instructions before any autonomous work. (Added 2026-01-29 per Council A-/B+ recommendation)
0b. **ELIGIBILITY CHECK (MANDATORY):** Run `scripts/check-overnight-eligibility.ps1 -TaskCategory [category]` — verifies task is safe for autonomous execution. See `config/overnight-eligibility.yaml` for rules. FORBIDDEN categories: financial, publishing, deletions, external_comms, database, credentials. (Added 2026-01-29 per Council A+ recommendation)
1. Read `backlog.md` — all pending tasks
2. Score each using TPS formula
3. Pick highest TPS task that passes ALL safety gates (eligibility + see execution-boundaries.md)
4. Identify correct persona for the task
5. Execute task using persona's prompt + output schema
6. Score output using 4-layer cascade:
   - Layer 1: Rule-based (regex, schema, length checks)
   - Layer 2: Heuristic (readability, CTA presence, pricing patterns)
   - Layer 3: Sonnet critic with frozen rubric
   - Layer 4: Compare vs top 20% historical outputs
7. If score ≥ 0.8: save as draft, commit with tag `nightly-ship`
8. If score < 0.8: log failure, extract learning, try next task
9. Produce morning report for Francisco:
   - What was learned (Phase 1)
   - What was shipped (Phase 2)
   - What needs review
   - What's next in the backlog

## Curiosity Engine (9:00 PM)
**Triggers:** Runs nightly before compound loop
**Model:** Sonnet
**Explores:**
- Anomalies: metrics deviating >2σ (conversion drops, refund spikes, traffic changes)
- Deltas: what changed in last 7 days (platform updates, competitor moves)
- Tooling: new Shopify automations, cheaper approaches, faster methods
**FORBIDDEN:** New product categories, new traffic channels, brand pivots
**Output:** Max 3 proposals added to backlog.md — NEVER direct actions

## Morning Report Format
```
🌅 OVERNIGHT REPORT — [DATE]

📚 LEARNED:
- [lesson 1]
- [lesson 2]

🚀 SHIPPED:
- [task]: [what was done] | Score: X/10 | Status: draft/committed

👀 NEEDS YOUR REVIEW:
- [item needing approval]

📋 NEXT UP (top 3 by TPS):
1. [task] — TPS: X.X
2. [task] — TPS: X.X
3. [task] — TPS: X.X
```

## Circuit Breakers
- If Phase 1 self-test shows regression → HALT Phase 2, alert Francisco
- If Phase 2 scores < 0.5 on 3 consecutive tasks → HALT, log pattern, alert
- If any safety gate fails → skip task, try next
- Hard timeout: 45 min total (both phases). If exceeded, commit what's done and stop.
