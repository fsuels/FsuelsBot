---
name: research
description: Deep research via free tools — web search, ChatGPT, Grok, or Claude sub-agents. No paid APIs.
homepage: https://github.com/fsuels/FsuelsBot
metadata: { "clawdbot": { "emoji": "🔬" } }
---

# Research Skill

Deep research using FREE tools only. No paid APIs. No Gemini API key. $0 extra cost.

## Available Research Tools (all free)

| Tool | How | Best For |
|------|-----|----------|
| **Web Search** | `web_search` tool (built-in) | Quick facts, current data, URLs |
| **Web Fetch** | `web_fetch` / `curl` | Reading specific pages/articles |
| **ChatGPT** | Browser automation (logged in) | Deep analysis, long-form research |
| **Grok** | X.com → CogitoLux profile → Grok | Real-time/trending data, X-specific insights |
| **Claude sub-agent** | `sessions_spawn` | Parallel research without burning main session context |

**NEVER use tools requiring API keys or paid subscriptions.** Francisco's budget is fixed at $0 extra.

---

## Step 1: Classify the Query

| Type | Description | Depth | Best Tool |
|------|-------------|-------|-----------|
| `learning` | Understand a topic | Thorough (1500+ words) | Claude sub-agent + web search |
| `decision-making` | Choose between options | Standard (800 words) | Claude sub-agent + web search |
| `content-creation` | Gather material for content | Standard (800 words) | Web search + web fetch |
| `technical-analysis` | Debug, benchmark, evaluate | Thorough (1500+ words) | Claude sub-agent + web search |
| `competitive-intel` | Market players, pricing | Thorough (1500+ words) | Web search + web fetch + competitor-monitor skill |

---

## Step 2: Pick Research Method

### Method A: Web Search + Claude (DEFAULT — fastest, cheapest)

For most research tasks. Use `web_search` to gather sources, `web_fetch` to read key pages, then synthesize.

```
1. web_search for 3-5 relevant queries
2. web_fetch top 2-3 results for detail
3. Synthesize findings with confidence tags
4. Save to ~/clawd/research/[slug]/research.md
```

### Method B: Claude Sub-Agent (for deep/parallel research)

When research is complex or would eat too much main session context:

```
sessions_spawn(
  task: "Research: [FULL TOPIC WITH CONTEXT]

Use web_search and web_fetch to research this topic thoroughly.

[INCLUDE RESEARCH PROMPT — see Step 3]

Save output to: ~/clawd/research/[slug]/research.md

When complete:
1. Send wake event: cron(action: 'wake', text: '🔬 Research complete: [TOPIC]. Key findings: [2-3 bullets]. Full report: ~/clawd/research/[slug]/research.md', mode: 'now')
2. Reply exactly: ANNOUNCE_SKIP",
  label: "research-[slug]"
)
```

### Method C: ChatGPT (browser — for second opinion or GPT-specific strengths)

Use browser automation to query ChatGPT when you need:
- A second AI perspective on a complex question
- GPT-4's specific training data strengths
- Deep reasoning on a topic where multiple viewpoints help

### Method D: Grok (browser — for real-time/trending data)

Use browser automation → X.com → switch to CogitoLux profile → Grok:
- Real-time trending topics
- X/Twitter-specific data and sentiment
- Current events within last 24-48 hours

---

## Step 3: Research Prompt Template

Use this for any research method. Include all context.

```
RESEARCH TASK: [topic]
QUERY TYPE: [learning | decision-making | content-creation | technical-analysis | competitive-intel]
DEPTH TARGET: [concise: 300w | standard: 800w | thorough: 1500w+]

=== EVIDENCE STANDARDS ===

Tag every factual claim:
- [VERIFIED] — primary source confirms
- [LIKELY] — secondary sources/consensus
- [UNVERIFIED] — inference or single source

Cite every claim as: [Author/Org, Date, URL]

=== ANTI-PATTERN RULES ===

1. NO HASTY GENERALIZATION: Scope every claim with context.
2. NO FALSE CAUSE: Note alternative hypotheses for correlations.
3. NO APPEAL TO AUTHORITY WITHOUT EVIDENCE: Include backing evidence.
4. LABEL UNCERTAINTY: Use [UNVERIFIED] and explain what verification needs.
5. NO STALE DATA: Prefer sources < 12 months old. Flag older sources.

=== OUTPUT STRUCTURE ===

## Executive Summary
3-5 bullet points, one sentence each.

## Key Findings
Detailed findings with confidence tags and citations.

## Evidence Gaps
What couldn't be verified and what would resolve it.

## Actionable Recommendations
3-5 concrete next steps tied to findings.

## Sources
Full citation list.

=== CONTEXT ===
[Insert conversation context, prior research, constraints]
```

---

## Step 4: Quality Gate

Before sharing results, check:

| # | Check | Pass Criteria |
|---|-------|--------------|
| 1 | Source coverage | Every claim has a citation |
| 2 | Confidence tags | Every claim tagged VERIFIED/LIKELY/UNVERIFIED |
| 3 | Actionable specificity | Recommendations name specific actions |
| 4 | Evidence gaps honest | Gaps section exists and is non-empty |
| 5 | Recency | Majority of sources < 12 months old |
| 6 | No fabrication | No invented URLs or unsourced statistics |

---

## Step 5: Deliver Results

1. Lead with Executive Summary
2. Highlight VERIFIED findings first
3. Call out Evidence Gaps explicitly
4. Present Actionable Recommendations
5. Save full report to `~/clawd/research/<slug>/research.md`

---

## Output Location

```
~/clawd/research/<slug>/research.md
```

---

## Tips

- Web search + Claude synthesis handles 90% of research needs
- Sub-agents are great for parallel research without burning main context
- ChatGPT and Grok are browser-only — use for second opinions or real-time data
- Always include conversation context when spawning sub-agents
- For quick lookups, skip the full template — just web_search and answer
