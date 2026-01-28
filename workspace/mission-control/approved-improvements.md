# Approved Improvements Queue
*Proactive improvement pipeline — research → evaluate → implement*
*Updated: 2026-01-28 11:46 AM*

## How This Works
1. Daily research identifies opportunities
2. **I research them myself first** — form my own opinion with pros/cons
3. Only use Council when genuinely unsure or want another angle
4. Implement confident decisions immediately
5. Overnight cron implements queued items one at a time

## Ready to Implement

| # | Improvement | Source | Priority | Effort | Notes |
|---|-------------|--------|----------|--------|-------|
| 4 | Run `clawdbot security audit --deep` | [2026-01-28 security research] | P1 | 15 min | Doctor suggested this. Deep security scan beyond basic checks. |
| 5 | Fix gateway service entrypoint mismatch | [2026-01-28 doctor output] | P2 | 10 min | Doctor flagged: service entrypoint doesn't match current install path. |
| 6 | Review & harden AGENTS.md prompt injection rules | [2026-01-28 security articles] | P2 | 20 min | SOUL.md is hardened, but AGENTS.md also has security rules that should align. |

## In Progress

*None currently*

## Completed

| # | Improvement | Implemented | Source | Notes |
|---|-------------|-------------|--------|-------|
| 1 | Enable Edge TTS | 2026-01-28 | [2026-01-28 research] | Free voice via Microsoft Edge neural TTS. Config: `messages.tts.auto: "tagged"`. |
| 2 | Run doctor check | 2026-01-28 | [2026-01-28 research] | No critical issues. Minor: gateway auth, Codex expired. |
| 3 | Confirm on latest version | 2026-01-28 | [2026-01-28 research] | Already on 2026.1.24-3 — latest. |
| 4 | Gateway token auth | 2026-01-28 | [2026-01-28 security articles] | Token auth enabled per doctor recommendation. |
| 5 | SOUL.md security hardening | 2026-01-28 | [2026-01-28 security articles] | Added hidden injection techniques, Golden Rule, code review rules. |
| 6 | Skill audit | 2026-01-28 | [2026-01-28 security articles] | All 10 workspace skills clean. No suspicious code. |

## Rejected (My Decision)

| Improvement | Source | Reason | Date |
|-------------|--------|--------|------|
| Crabwalk visual monitoring | [2026-01-28 research] | Nice-to-have, not need-to-have. Revisit if debugging challenges arise. | 2026-01-28 |

---

## Notes

**2026-01-28:** First full day of the pipeline. Implemented 6 improvements. Queue replenished from security research. Tonight's 2 AM build will pick from the Ready queue.
