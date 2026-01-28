# 🧠 The Council — Multi-AI Debate & Synthesis

## Philosophy
A single LLM is a writer who publishes their first draft — no editor, no critics, no revision. The Council is the editorial board. It externalizes the "inner critic" that LLMs lack. When multiple AIs examine the same problem, their disagreements expose blind spots, their agreements build confidence, and their unique insights spark ideas no single brain would find. Like a writer sending their book to expert critics — the goal isn't to collect praise, it's to find the flaws and make it stronger.

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

## Trigger
User says anything like:
- "Council: [question]"
- "Ask the council: [question]"
- "Get multiple perspectives on: [question]"
- "Debate: [question]"
- Or you decide a question benefits from multiple viewpoints

## The Panel

| AI | Access Method | Strengths | Cost |
|---|---|---|---|
| **Grok** | Browser → X/Grok tab | Real-time X data, contrarian takes, trending info | Included in X sub |
| **ChatGPT** | Browser → chatgpt.com tab | Strong business/marketing, broad knowledge, custom GPTs | Included in ChatGPT Pro |
| **Gemini** | Terminal CLI (`gemini`) | Google search grounding, latest web data | Free |
| **Open Arena** | Browser → arena site | Access to open-source models, diverse perspectives | Free |
| **Claude Sonnet** (Orchestrator) | Native / Spawn | Runs the council session — types questions, reads answers, manages rounds | Included in Claude Max |
| **Claude Opus 4.5** (Final judge) | Main session | Delivers the final verdict with full context and reasoning | Included in Claude Max |

## Workflow

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

### Step 3: Collect & Compare
After getting all responses, analyze:
- **Agreements** — What do 3+ AIs agree on? (High confidence)
- **Unique insights** — What did only one AI mention? (Potential edge)
- **Disagreements** — Where do they contradict? (Needs judgment)
- **Blind spots** — What did none of them address? (You fill in)

### Step 4: Synthesize & Deliver
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

1. **Always start new chats** in Grok and ChatGPT to avoid context contamination
2. **Use the exact same question** for all AIs
3. **Don't reveal you're an AI** asking on behalf of someone — just ask the question naturally
4. **Time management** — the whole process should take 2-3 minutes max
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

## Advanced Mode: Feedback Loop (Multi-Round)
The most powerful mode. Each AI iterates on the others' work:

**Round 1 — First Take**
- Ask all AIs the same question
- Collect their initial answers

**Round 2 — Cross-Critique & Improve**
- Go back to each AI: "Here's what two other experts proposed: [paste summaries]. Don't just critique — BUILD A BETTER SOLUTION. What did they miss? What's wrong? And most importantly: what's a SUPERIOR approach that beats all of these?"
- Each AI must produce a new answer that's better than everyone's Round 1

**Round 3 — Final Synthesis**
- You (Claude) now have: original answers + improved answers + counter-arguments
- The best ideas from each round have survived; the weak ones are gone
- Synthesize the ultimate answer — one that none of the AIs could have reached alone
- Deliver to Francisco with full reasoning: what survived, what got killed, and why the final answer is the strongest

This creates a genuine feedback loop — each AI pushes the others to think harder. The final answer has been stress-tested from every angle.

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
