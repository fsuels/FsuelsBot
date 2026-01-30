# 🧠 The Council — Multi-AI Debate & Synthesis

## Philosophy
The Council is a **congress of experts** — not a survey, not a panel, not a vote. It's a room full of the brightest minds in AI, brought together to seek **genuine understanding**. They don't just answer questions — they debate, challenge, build on each other's ideas, and push each other beyond what any one of them would reach alone.

A single LLM is a writer who publishes their first draft — no editor, no critics, no revision. The Council externalizes the "inner critic" that LLMs lack. When multiple AIs examine the same problem through real debate, their disagreements expose blind spots, their agreements (tested under fire) build real confidence, and the cross-pollination of ideas sparks breakthroughs no single mind would find.

The goal is never just "get an answer." It's **better understanding** that leads to **better solutions**. Understanding is the means — superior solutions are the end. Every session should leave us with a solution that didn't exist before the debate started.

## The Bigger Vision
The Council is not a tool you use sometimes. It's a **permanent improvement engine**. The best and brightest AI minds — debating, challenging, refining — to always find better solutions. Not just for answering questions, but for continuously evolving every aspect of Francisco's business and workflow. The debates never stop. The ideas compound. What's best today gets beaten tomorrow.

## What It Does
Queries multiple AI systems (Grok, ChatGPT, Gemini) with the same question, collects their responses, and synthesizes the best combined answer. Claude (you) serves as editor-in-chief — the one who knows the full context and makes the final call.

## Cost Model — ZERO EXTRA
Francisco's fixed AI budget (no per-token, no surprises):
- **Claude Max** — $100/month flat (Opus 4.5 + Sonnet, unlimited)
- **X subscription** — includes Grok (free with account)
- **ChatGPT Pro** — flat subscription (GPT-5.2, etc.)
- **Open Arena** — free access to open-source models
- **Gemini CLI** — free (Google OAuth)

**Extra cost for running The Council: $0.00**

All AIs are accessed through existing subscriptions via browser automation.
No API keys. No per-token billing. No usage-based charges.
Sonnet orchestrates via Claude Max (flat rate). Other AIs via browser tabs (already paid for).

**RULE: Never add any service, API, or tool that costs extra money without Francisco's explicit approval.**

**RULE: Always aim for A+.** Never settle for incremental improvements. Push every debate to think outside the box, challenge paradigms, and seek breakthroughs. The goal is the BEST possible solution — not just a slightly better one.

## Implementation
When user triggers a council session:
1. **Opus** (main session) receives the question from Francisco
2. **Opus** spawns a Sonnet sub-agent with `model: "sonnet"` and `label: "council"`
3. **Sonnet** runs the full protocol: types questions into Grok/ChatGPT/Gemini, reads responses, runs multiple rounds if needed, collects all data
4. **Sonnet** reports back with: all raw responses, agreements, disagreements, unique insights
5. **Opus** reads everything Sonnet collected and delivers the **FINAL VERDICT** — the definitive recommendation with full reasoning, tailored to Francisco's exact situation

### Why Opus Gets the Last Word
- Opus has the deepest reasoning capability
- Opus knows Francisco's full context (business, budget, history, goals)
- Opus can weigh tradeoffs that cheaper models miss
- The other AIs provide the raw material — Opus is the master strategist who turns it into a plan

### The Chain
```
Francisco → Opus (understands the ask)
  → Sonnet (cheap orchestrator)
    → Grok (free, real-time X data)
    → ChatGPT (free, business expertise)  
    → Gemini (free, Google data)
  ← Sonnet (brings back all insights)
← Opus (final verdict + reasoning + action plan)
→ Francisco (gets the best possible answer)
```

### When Automation Fails (CRITICAL — Added 2026-01-30)
**Browser automation is fragile.** Tab targeting fails, inputs don't work, pages hang. Don't grind — adapt.

**Fallback Ladder:**
1. **Try Gemini CLI first** — Most reliable, no browser needed
2. **One tab at a time** — Close other AI tabs, focus on single target
3. **Human pastes questions** — Prepare the text, Francisco copy-pastes into each AI
4. **Proceed with partial** — 3/4 AIs is better than nothing; note what's missing

**Time Limits:**
- If one AI doesn't respond in 60 seconds → move on
- If browser automation fails twice → switch to manual
- If total session exceeds 20 minutes → deliver verdict with what you have

**RULE: Never grind. Human is faster for visual browser tasks.**

## Trigger
User says anything like:
- "Council: [question]"
- "Ask the council: [question]"
- "Get multiple perspectives on: [question]"
- "Debate: [question]"
- Or you decide a question benefits from multiple viewpoints

## The Panel

| AI | Access Method | Strengths | Cognitive Role | Cost |
|---|---|---|---|---|
| **Grok** | Browser → X/Grok tab | Real-time X data, contrarian takes | **Skeptic/Falsification** — Find why this fails | Included in X sub |
| **ChatGPT** | Browser → chatgpt.com tab | Business/marketing, structured analysis | **Systemic/Structural** — How does this scale? | Included in ChatGPT Pro |
| **Gemini** | Terminal CLI (`gemini`) | Google search grounding, web data | **Data/Pragmatism** — What are technical blockers? | Free |
| **Open Arena** | Browser → arena site | Open-source models, diversity | **Contrarian Wildcard** — Challenge assumptions | Free |
| **Claude Sonnet** (Orchestrator) | Native / Spawn | Runs the session, manages rounds | **Orchestrator** — Collect and organize | Included in Claude Max |
| **Claude Opus 4.5** (Final judge) | Main session | Full context, deep reasoning | **Synthesis/Context** — What fits OUR situation? | Included in Claude Max |

### Cognitive Roles (MANDATORY — Added 2026-01-30)
**Don't just ask the same question.** Give each AI a specific LENS to prevent the "consensus trap" where everyone agrees politely.

When framing questions for Round A, append the role instruction:
- **Grok:** "Your job is to find flaws. Be skeptical. Why might this fail?"
- **ChatGPT:** "Analyze this systemically. How does it scale? What are structural issues?"
- **Gemini:** "Focus on data and pragmatics. What are the technical blockers?"
- **Claude:** "Consider our specific context. What fits Francisco's situation?"

This forces divergent thinking instead of echo-chamber agreement.

## Workflow

### P0 — Context Injection (MANDATORY — Added 2026-01-29)
**Generic AI advice is useless without context.** Before ANY Council session about improvements or changes to our system, you MUST include our current implementation.

**The Council cannot give good advice if they don't know:**
- What we already have
- What's already working
- Our specific constraints (budget, tools, architecture)

**Context Injection Checklist:**
Before formulating the question, gather and include:

1. **For memory/task system questions:**
   - Current tasks.json schema (paste relevant excerpt)
   - Current AGENTS.md rules (paste relevant section)
   - memory/state.json structure
   - Any recent failures or pain points

2. **For business/store questions:**
   - Current store setup (Shopify, BuckyDrop workflow)
   - Existing procedures from procedures/ folder
   - Recent metrics or performance data
   - Budget constraints ($0 extra allowed)

3. **For workflow/automation questions:**
   - Current HEARTBEAT.md checklist
   - Existing cron jobs from tasks.json
   - Tools available (from TOOLS.md)

**Question Template:**
```
CONTEXT — OUR CURRENT SYSTEM:
[Paste relevant files/schemas/rules here]

WHAT'S WORKING:
[List what we don't want to break]

THE PROBLEM:
[Specific issue we're trying to solve]

CONSTRAINTS:
[Budget, tools, must-haves]

QUESTION:
[The actual question for debate]
```

**If you skip context injection, the Council will give generic advice that doesn't fit our system. This wastes everyone's time.**

### P0 — Debate Standards (Every Session, Every Round)
Remember: The Council is a **congress of experts**. Every session must **explore ideas, debate positions, discover new solutions, aim for A+, and seek genuine understanding**. This is not optional. This is what the Council IS.

### Step 1: Formulate the Question
- Take the user's raw question
- Refine it into a clear, specific prompt that will get the best answers
- Use the SAME question for all AIs (consistency matters for comparison)

### Step 2: Query Each AI (parallel when possible)

#### Grok (Browser)
1. Check browser tabs for Grok/X tab (url contains `x.com/i/grok`)
2. If no tab, open: `https://x.com/i/grok`
3. Click "New Chat" button if needed (to avoid context bleed from previous chats)
4. Click the text input area
5. Type the question
6. Press Enter
7. Wait 15-30s for response (Grok Thinking can take 2-3 min)
8. Snapshot to read the response

#### ChatGPT (Browser)
1. Check browser tabs for ChatGPT tab (url contains `chatgpt.com`)
2. If no tab, open: `https://chatgpt.com`
3. Start a new chat (click "New chat" or navigate to `/`)
4. Click the "Ask anything" input area
5. Type the question
6. Press Enter
7. Wait 15-20s for response
8. Snapshot to read the response

#### Gemini (Terminal)
1. Run: `gemini -p "QUESTION_HERE"` (one-shot mode)
2. Read stdout for the response
3. Gemini has web grounding built-in

### Step 3: Cross-Debate (THE KEY STEP — This Is What Makes It Real)

**This is NOT a survey. This is a debate.** After collecting initial responses, the AIs must actually argue with each other.

**Round A — Initial Positions** (Step 2 above)
Each AI gives their independent take.

**Round B — Cross-Examination**
Go back to EACH AI with the OTHER AIs' responses. Use the SAME chat (not new chats — you want them to build on context):

For Grok: "Two other AI experts responded to the same question. Here are their takes: [paste ChatGPT summary + Gemini summary]. Where are they wrong? What did they miss? Where do you agree? Build on their best ideas and attack their weakest points. Give me your REVISED position."

For ChatGPT: Same, but paste Grok + Gemini summaries.

For Gemini (CLI): `gemini -p "Two other AI experts responded: [Grok summary + ChatGPT summary]. Where are they wrong? What did they miss? Build on their best ideas, attack their weakest points, and give your REVISED position."`

**Round C — Rebuttal (if productive)**
If Round B produced genuinely new insights or sharp disagreements:
- Share the Round B revisions back. "They've seen your critique and revised. Here's their updated position: [paste]. Final rebuttal — what's your strongest argument now?"
- Skip this round if the AIs are converging and just restating positions.

**Round D — Pre-Mortem (optional, for high-stakes decisions)**
If consensus is reached but stakes are high:
- Ask all AIs: "Assume the consensus we just reached has FAILED miserably 1 year from now. Why did it happen? What did we miss?"
- This catches blind spots that groupthink creates.

**The goal:** Discovery, not validation. The debate aims to uncover NEW insights — ideas none of the AIs would have reached alone. Push them to go beyond their initial thinking. When one AI challenges another, the response should contain something NEW, not just a defense of the original position. If the debate is just producing "I agree" or "I stand by my answer," push harder: "That's not good enough. What are you NOT seeing? What assumption are you making that might be wrong?"

By the end, each AI has SEEN and RESPONDED TO the others' arguments. Their final positions are battle-tested, not first drafts. Agreements mean more because they survived challenge. Disagreements are sharper and better-reasoned. And ideally, the cross-pollination sparked ideas that didn't exist before the debate started.

### Step 4: Collect & Compare
After the debate rounds, analyze:
- **Agreements** — What do they STILL agree on after debating? (Very high confidence)
- **Unique insights** — What survived challenge? (Validated edge)
- **Disagreements** — Where do they STILL disagree after seeing each other's arguments? (Genuine tension — needs judgment)
- **Evolved positions** — What changed from Round A to Round B/C? (Shows real thinking)
- **Blind spots** — What did none of them address? (You fill in)

### Step 5: Synthesize & Deliver
Present to the user:
```
🧠 THE COUNCIL — [Topic]

📋 QUESTION: [The question asked]

🤖 GROK says: [2-3 line summary of key points]
🟢 CHATGPT says: [2-3 line summary of key points]  
💎 GEMINI says: [2-3 line summary of key points]

✅ CONSENSUS (all agree):
- [Point 1]
- [Point 2]

⚡ UNIQUE INSIGHTS:
- [AI name]: [unique point]

⚔️ DISAGREEMENTS:
- [Topic]: Grok says X, ChatGPT says Y

🏆 MY VERDICT:
[Your definitive recommendation — not a wishy-washy "it depends"]

🧾 WHY:
[Explain your reasoning clearly:
- Which AI's argument was strongest and why
- What context they're missing that you know (Francisco's budget, business model, history)
- What you'd actually DO if this were your business
- The specific risk of ignoring this advice]
```

### The Verdict Is Mandatory
**Never skip the verdict.** The whole point of the Council is that Claude (you) has context the other AIs don't:
- You know Francisco's financial situation
- You know DLM's history, what's been tried, what failed
- You know the current state of every platform (tags, SEO, ads, products)
- You know what's already in progress

The other AIs give generic expert advice. YOU give advice tailored to Francisco's exact situation. That's the value. Always explain WHY you chose what you chose — like a real advisor defending their recommendation to a client.

## Important Rules

1. **Start new chats for Round A** (initial question) — avoid contamination from previous sessions
2. **Keep the same chats for Rounds B & C** — the AIs need to build on context, not start fresh
3. **Use the exact same initial question** for all AIs in Round A
4. **Don't reveal you're an AI** asking on behalf of someone — just ask the question naturally
5. **Summarize, don't paste walls of text** — when sharing one AI's response with another, condense to key arguments (2-4 bullet points), not full transcripts
4. **Time management** — Quick Council: 5-10 min. Full 3-round: 15-20 min. Multi-round: 30-60 min.
5. **If one AI is down/slow**, proceed with the others and note it
6. **Save council sessions** to `council-sessions/` with date and topic for reference
7. **Gemini CLI** may be rate-limited — if it fails, note it and proceed with browser AIs

## Quick Council (Lightweight Mode)
For simple questions, skip the full format:
1. Ask Gemini via CLI (fastest)
2. Combine with your own knowledge
3. Only escalate to full council for important strategic decisions

## Session Storage
Save notable council sessions for future reference:
```
council-sessions/
  YYYY-MM-DD-topic-slug.md
```

Each file should contain: question, all raw responses, and your synthesis.

## Advanced Mode: Inner Critic
Instead of asking all AIs the same question, share YOUR draft answer and ask the others to critique it:

1. You formulate your best answer first
2. Ask Grok/ChatGPT/Gemini: "Here's a strategy for X: [your answer]. What's wrong with it? What am I missing? How would you improve it?"
3. They attack your thinking from different angles
4. You revise based on their critiques
5. Deliver the battle-tested answer to Francisco

This is like a writer sending their manuscript to critics — the goal isn't praise, it's finding every weakness before it ships.

## Advanced Mode: Feedback Loop (Adaptive Multi-Round, Max 6)
The most powerful mode. Runs the FULL debate protocol (Rounds A→B→C) across multiple iterations. Each iteration builds on the IMPLEMENTED results of the previous one. **Maximum 6 iterations.**

**Key distinction:** Each "round" is a full Council debate session (with internal cross-debate). Between rounds, changes are IMPLEMENTED. The next round evaluates the updated state.

### EVERY ROUND MUST (P0 — non-negotiable):
- **EXPLORE** — think outside the box, challenge paradigms, propose bold solutions
- **DEBATE** — real cross-examination (A→B→C), AIs argue with each other's positions
- **DISCOVER** — find NEW solutions that didn't exist before the debate started
- **AIM FOR A+** — never settle for incremental, always push for breakthroughs
- **SEEK UNDERSTANDING** — better understanding leads to better solutions

This applies to Round 1, Round 6, and every round in between. No exceptions. No shortcuts.

**Round 1 — Initial Debate**
- Run full debate protocol (Rounds A→B→C) on the initial question
- Implement consensus changes
- Record grade

**Round 2 — Re-evaluation**
- Explain the UPDATED system (post-Round 1 implementation) to all AIs
- Run full debate protocol: initial positions → cross-examination → rebuttals
- Each AI must acknowledge what improved AND find remaining weaknesses
- Implement consensus changes
- Record grade: "B- (R1) → B+ (R2)"

**Round 3-6 — Adaptive Continuation**
- After each round, **evaluate whether meaningful improvement occurred**
- **Continue** if: new insights emerged, strategies got materially better, blind spots were uncovered, grade improved, or disagreements led to stronger synthesis
- **Stop** if: responses are rehashing the same points, improvements are marginal/cosmetic, AIs are agreeing without adding substance, grade plateaued, or you're seeing diminishing returns
- Maximum of **6 rounds total** — hard cap, no exceptions

**Final Synthesis (after stopping)**
- Full grade progression: "B- (R1) → B+ (R2) → A- (R3) → A- (R4, stopped)"
- What survived all rounds of debate
- What got killed and why
- Why you stopped at round N
- The final system state and what would be needed for A+

**Adaptive stopping rule:**
```
for round in 2..6:
    run full debate (A→B→C)
    implement consensus
    record grade
    if no_meaningful_improvement(round vs round-1):
        stop → final synthesis
    else:
        continue
final synthesis after round 6 (hard cap)
```

**When to use multi-round:**
- High-stakes decisions (spending money, major strategy pivots)
- Complex topics where the first answer is probably incomplete
- When Round 1 shows significant disagreement between AIs

**When single round is enough:**
- Research/fact-finding questions
- Quick opinions or sanity checks
- Time-sensitive decisions

## When to Auto-Trigger
Consider running a council session (without being asked) when:
- Major business strategy decision
- Conflicting data from different sources
- Francisco asks "what do you think?" on a complex topic
- Market research where recency matters (Grok excels here)
- You want to stress-test your own recommendation before presenting it
