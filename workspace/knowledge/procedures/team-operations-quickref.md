---
version: "1.0"
created: "2026-01-28"
updated: "2026-01-28"
verified: "2026-01-28"
confidence: "medium"
---

# Team Operations Quick Reference
*Source: Council Team Architecture Debate (2026-01-28)*
*This is the master index — all procedures linked below*

## Team Structure
| Role | Type | Model | Autonomy |
|------|------|-------|----------|
| 🤖 Orchestrator | Persistent | Opus 4.5 | Control |
| 📈 Pressure Loop | Persistent | Sonnet 4 | Propose+Spawn |
| 🔬 Deep Dive | Persistent | Gemini 2.5 Pro | Propose+Spawn |
| ✍️ Content() | On-demand | Sonnet 4 | Execute |
| ⚙️ Automation() | On-demand | Sonnet 4 | Execute |
| 🏛️ Council() | On-demand | Multi-AI | Execute |
| 🧠 PromptWork() | On-demand | Opus 4.5 | Execute |

## Procedures Index
1. **Dispatch Scoring** → `dispatch-scoring.md` — Score = 2×Impact + Confidence + TimeSense − Cost
2. **Event Triggers** → `event-triggers.md` — State-based, not time-based
3. **Autonomy Tiers** → `autonomy-tiers.md` — Execute / Propose+Spawn / Control
4. **Action Safety** → `action-safety-tiers.md` — Auto / Approve / Explicit+Checklist
5. **Output Contracts** → `output-contracts.md` — Structured artifacts, 200-400 token caps
6. **Earn/Kill Criteria** → `earn-kill-criteria.md` — 10+ tasks/month earns persistence
7. **Persistent Loops** → `persistent-loops.md` — QA pressure + Research mining
8. **Artifact Pipeline** → `artifact-pipeline.md` — Compression > Generation

## Decision Flow (Every Task)
```
1. Score the task (dispatch-scoring.md)
2. Check safety tier (action-safety-tiers.md)
3. Pick the right function (team structure above)
4. Verify autonomy level allows it (autonomy-tiers.md)
5. Execute with output contract (output-contracts.md)
6. Pressure Loop reviews output (persistent-loops.md)
7. Save artifact if reusable (artifact-pipeline.md)
8. Update dashboard (current-task.json + team.json)
```
