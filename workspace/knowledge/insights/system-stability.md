# Insight: System Stability & Crash Prevention
*Learned: 2026-01-28*
*Source: memory/2026-01-28.md — production incidents*

## The Insight
Large sessions and unhandled promise rejections are the two main causes of Clawdbot crashes. Prevention requires both architectural limits and runtime safeguards.

## Evidence
- Sessions exceeding ~118K tokens trigger API timeouts → `TypeError: fetch failed` → process crash [verified: 2026-01-28]
- Without `--unhandled-rejections=warn`, a single failed fetch kills the entire process [verified: 2026-01-28]
- Browser control server congestion (too many open tabs) causes act/snapshot timeouts [verified: 2026-01-27]

## Application
1. **Keep sessions compact** — avoid loading excessive context
2. **Gateway must be installed as Windows service** (`clawdbot gateway install`) for auto-restart [verified: 2026-01-28]
3. **Add `--unhandled-rejections=warn`** to gateway.cmd Node.js args [verified: 2026-01-28]
4. **Close unnecessary browser tabs** — keep under ~15 active tabs
5. **Use sub-agents** for heavy work — isolates context and prevents main session bloat
