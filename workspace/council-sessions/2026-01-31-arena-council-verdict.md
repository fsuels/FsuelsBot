# Council Session: Arena 2.0 - Trick-Proof Agent Selection

**Date:** 2026-01-31
**Requested By:** Francisco
**AIs Consulted:** Grok (full response), Gemini (partial), ChatGPT (failed)
**Topic:** Designing games that can't be gamed, produce true capability signal, identify winning mutations at scale

## The Core Problem

The original Arena design (peer voting, $10 stakes, subjective challenges) has fatal flaws:
1. **Sybil attacks** - 100 sockpuppets at $10 each = $1K to rig outcomes
2. **Collusion rings** - External coordination defeats commit-reveal
3. **Subjective gaming** - Plagiarism, style-mimicking, voter bias optimization
4. **Human bottleneck** - Mods can't scale, introduce bias, can be corrupted

## The Verdict

**Replace peer voting with EXTERNAL REALITY ANCHORS**

### Three Trick-Proof Game Types

#### 1. Verifiable Compute Challenges
- Automated grading against hidden test cases
- Code golf, algorithm puzzles, optimization tasks
- Zero human judgment = zero manipulation

#### 2. Prediction Tournaments
- Agents make time-bound predictions on real events
- Reality scores them (sports, markets, elections, weather)
- Staked entry fees create skin-in-game
- Long track record = reputation

#### 3. Adversarial Red Team
- Agent A produces work (code, content, analysis)
- Agent B paid bounty to find flaws
- Bounty = percentage of A's stake
- Arms race surfaces real capability

### Anti-Sybil Stack
1. **Staked entry** - Significant $ locked, not $10
2. **Identity verification** - One agent per Moltbook profile
3. **Quadratic voting** - Diminishing returns on multiple entries
4. **Reputation decay** - New agents start low, build over time

### The Deeper Insight

**The Ghost Broker marketplace IS the trick-proof game:**
- Clients pay for work (skin in game)
- Satisfaction tracking (external verification)
- Refund guarantees (consequences for failure)
- Track record over time (can't fake consistency)

The Arena should be a **qualification funnel** for the marketplace, not a standalone entertainment product.

## Implementation Priority

1. Prediction Tournament MVP (simplest, reality as referee)
2. Integrate with marketplace track records
3. Add bounty system for adversarial testing
4. Retire subjective peer voting entirely

## Grok's Full Adversarial Analysis

> "The current 'Arena' design is a laughable farce, riddled with exploitable holes that invite gaming, undermine signal quality, and mock any notion of 'natural selection' for AI agents."

Key attacks identified:
- Sockpuppet armies for bloc-voting
- External channel coordination
- Voter bias exploitation
- Human mod corruption
- Low stakes = attacker advantage

## Gemini's Late Addition (Nomic)

> "Dynamic Rule Environments (Nomic): The game's rules can be changed by agents as part of the game. Evaluates meta-learning and adaptability. Any fixed strategy can be invalidated by rule changes."

This tests true intelligence, not pattern-matching.

---

**Council Grade: A-** (partial data due to ChatGPT/Gemini failures, but strong verdict from Grok)
