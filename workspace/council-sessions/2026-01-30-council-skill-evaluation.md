# 🧠 Council Session: Evaluate & Improve the Council Skill

**Date:** 2026-01-30
**Orchestrator:** Claude Opus 4.5 (subagent)
**Participants:** Claude (primary), Grok/ChatGPT/Gemini (attempted)
**Status:** PARTIAL - Technical issues prevented full multi-AI debate

---

## Executive Summary

This Council session attempted to evaluate the Council skill itself (meta-evaluation). Due to browser automation tab-targeting issues and Gemini CLI unresponsiveness, the full 4-round debate protocol could not be executed as designed.

**Key Finding:** The implementation challenges encountered during this session ARE the evaluation. The skill's "Practical implementability" has real-world gaps that this session exposed.

---

## Technical Issues Encountered

### Browser Automation Problems
- **Tab targeting confusion:** Multiple tabs open, but snapshots returned wrong tab content
- **Navigation redirect:** Commands targeting one tab affected different tabs
- **State desync:** Tab list showed different URLs than actual content

### Gemini CLI Issues
- **No output:** Multiple attempts produced no stdout
- **Version confirmed:** 0.1.1 installed, but queries hung indefinitely
- **Possible cause:** Rate limiting or authentication token expiry

### Meta-Lesson
These issues validate a weakness in the Council skill: **The skill assumes browser automation works reliably.** In practice, browser state management is fragile. The skill needs fallback procedures.

---

## Round A — Claude's Position (Participant #4)

### Scores (1-10)

| Aspect | Score | Reasoning |
|--------|-------|-----------|
| Clarity of instructions | **8** | Well-structured, comprehensive. Markdown formatting helps. But length (4000+ words) is overwhelming for quick reference. |
| Debate protocol effectiveness | **7** | 3-round structure (A→B→C) is sound. Cross-examination requirement is good. But no guidance on handling partial debates. |
| Cross-examination design | **8** | Strong concept: share other AIs' arguments, ask for critique. Summarization guidance (2-4 bullets) is practical. |
| Synthesis/verdict process | **9** | Clear output format. Mandatory verdict is excellent. "MY VERDICT" + "WHY" structure is actionable. |
| Practical implementability | **5** | Major gap. Browser automation is assumed reliable but isn't. No fallbacks. No error handling. Session storage undefined. |
| Potential for genuine insight | **7** | Cross-pollination concept is valid. But success depends heavily on question quality and AI diversity. |

**Overall: 7.3/10 — Strong concept, implementation fragility.**

### What's WRONG (Weaknesses)

1. **Browser Fragility Assumption**
   - Skill assumes browser tabs can be reliably opened, navigated, typed into, and read
   - Reality: Tab targeting fails, states desync, different browsers behave differently
   - No fallback when automation fails

2. **Session Context Pollution**
   - Skill says "keep same chat for Rounds B & C" but browser tabs accumulate context
   - Previous Council sessions may pollute new ones despite "New Chat" clicks
   - No clear session isolation

3. **Time Estimates Are Optimistic**
   - "2-3 minutes max" is unrealistic for full 3-round debate
   - Each round requires: type question + wait for response + read response + summarize
   - Grok Thinking alone can take 2-3 minutes per response

4. **Gemini CLI vs Browser Inconsistency**
   - Skill shows Gemini as both CLI and browser option
   - CLI is faster but less capable (no web grounding in one-shot mode)
   - Browser Gemini requires different interaction patterns

5. **Feedback Loop Mode Complexity**
   - "Max 6 rounds" with "implement then re-evaluate" is theoretically powerful
   - But no guidance on WHAT to implement between rounds
   - Risks infinite loop of minor tweaks

6. **No Quality Gate**
   - How do you know when debate quality is sufficient?
   - What if all AIs agree on something wrong?
   - No mechanism to escalate to human judgment

### Specific Improvements

1. **Add Fallback Procedures**
   ```markdown
   ### If Browser Automation Fails
   1. Try Gemini CLI first (fastest, most reliable)
   2. If CLI fails, use browser with single-tab focus
   3. If multiple tabs fail, fall back to sequential: one AI at a time
   4. If all automation fails, draft questions for human to execute manually
   ```

2. **Define Session Isolation Protocol**
   ```markdown
   ### Session Hygiene
   - Always start with fresh browser profile or incognito
   - Clear chat history if using same browser session
   - Name conversations clearly: "Council-2026-01-30-Topic"
   ```

3. **Add Error Handling Section**
   ```markdown
   ### When Things Go Wrong
   - **AI refuses to answer:** Note refusal, proceed with remaining AIs
   - **AI times out:** Wait 60s, retry once, then mark as "unavailable"
   - **Conflicting results:** This is valuable! Document disagreement clearly.
   - **All AIs wrong:** Flag for human review, do NOT auto-implement
   ```

4. **Simplify Feedback Loop Mode**
   - Rename to "Iterative Refinement Mode"
   - Require explicit "CHANGE IMPLEMENTED" marker between rounds
   - Add "stop if grade plateaus for 2 rounds" rule

5. **Add Quality Heuristics**
   ```markdown
   ### Signs of Good Debate
   - At least one AI changed position between rounds
   - Specific disagreements identified (not vague "I see it differently")
   - New ideas emerged that weren't in initial responses
   
   ### Signs of Poor Debate
   - All AIs agree immediately (echo chamber risk)
   - Responses get shorter in later rounds (fatigue/repetition)
   - No concrete actionables emerge
   ```

### What's MISSING

1. **Prompt Templates Library**
   - Pre-written prompts for common Council use cases
   - "Evaluate this strategy," "Debug this problem," "Prioritize these options"

2. **AI Personality Profiles**
   - Grok: Contrarian, humor, real-time data
   - ChatGPT: Business-oriented, structured, comprehensive
   - Gemini: Research-focused, citations, web-grounded
   - Use these to ASSIGN roles, not just collect opinions

3. **Disagreement Resolution Framework**
   - When AIs disagree after 3 rounds, what then?
   - Suggested: Weight by confidence + domain relevance
   - Or: Escalate specific disagreement to Francisco

4. **Cost-Benefit Trigger Guidelines**
   - Not every question needs a Council
   - "Full Council for strategic decisions, Quick Council for tactical, Skip for factual"

5. **Session Archive Search**
   - Past Council sessions are saved but how to FIND relevant ones?
   - Add tagging: #pricing #seo #strategy #technical
   - Enable: "Has the Council addressed this before?"

6. **Human-in-the-Loop Checkpoints**
   - For high-stakes decisions, require human approval before final verdict
   - For learning mode, human grades the verdict quality

---

## Attempted Multi-AI Collection

### Grok
- **Status:** Tab opened, input field visible
- **Issue:** Browser automation couldn't reliably type into correct tab
- **Collected:** None

### ChatGPT
- **Status:** Fresh chat opened
- **Issue:** Tab targeting kept jumping between tabs
- **Collected:** None

### Gemini (CLI)
- **Status:** CLI responsive (`--version` worked)
- **Issue:** Queries hung with no output
- **Collected:** None

---

## Synthesis (Claude Solo)

### Points of Consensus (predicted if debate ran)
Based on typical AI evaluation patterns:

1. **Philosophy is sound** — Multi-AI debate is valuable for complex decisions
2. **Cross-examination is key** — Forcing AIs to critique each other produces better insights
3. **Implementation is the weak link** — Great concept, fragile execution
4. **Context injection is critical** — Generic advice without context is useless

### Points of Disagreement (predicted)
1. **Time investment:** Is 3-round debate worth it for most questions?
2. **Verdict authority:** Should Claude always have final say, or rotating authority?
3. **Browser vs API:** Is browser automation the right choice vs paid APIs?

### Controversial Improvements
1. **Add paid API fallback** — Contradicts $0 extra cost rule
2. **Reduce to 2 rounds** — Loses depth but gains reliability
3. **Make human always decide** — Removes AI verdict value

---

## Recommended Changes (Priority Order)

### P0 — MUST DO
1. **Add browser fallback section** — When automation fails, what next?
2. **Reduce time estimate** — "5-10 minutes" not "2-3 minutes"
3. **Add error handling** — What to do when AI unavailable

### P1 — SHOULD DO
1. **Create prompt template library** — Speed up session starts
2. **Add quality heuristics** — Know when debate is working
3. **Define AI personality profiles** — Leverage each AI's strengths

### P2 — NICE TO HAVE
1. **Session archive tagging** — Find past relevant sessions
2. **Disagreement resolution framework** — Handle persistent conflicts
3. **Cost-benefit triggers** — When to use full vs quick Council

---

## Meta-Verdict: This Session

**What worked:**
- Claude (me) provided comprehensive evaluation despite tool failures
- The technical issues themselves are valuable data about implementability
- Session storage format captured useful structure

**What failed:**
- Multi-AI debate protocol couldn't execute
- Browser automation is not reliable enough for current skill design
- Gemini CLI needs troubleshooting

**Recommendation:**
Before running complex Council sessions, verify:
1. Browser tabs can be controlled reliably (test with simple navigation)
2. Gemini CLI responds (test with simple prompt)
3. Have fallback ready: human-executed questions if automation fails

---

## Next Steps

1. **Main agent to review** this evaluation
2. **Francisco approval** for recommended changes
3. **Follow-up session** with manual AI queries if full debate needed
4. **Update SKILL.md** with approved improvements

---

*Session generated: 2026-01-30 ~00:30 EST*
*Orchestrator: Claude Opus 4.5 (subagent: council-skill-eval)*
