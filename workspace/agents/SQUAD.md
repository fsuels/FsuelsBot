# 🎯 Specialist Agent Squad

**Related:** `agents/PROTOCOL.md` (inter-agent messaging & debate)

## Philosophy

The Squad is a **distributed execution system** — not generic sub-agents, but **specialists with distinct personalities, capabilities, and judgment**. Each agent owns a domain and brings its own perspective.

**Core Principle:** Specialists beat generalists for focused tasks. A Research Agent that lives and breathes intelligence gathering will outperform a generic "do this task" spawn every time.

**The Goal:** Faster, higher-quality execution through domain expertise and parallel processing.

---

## The Roster

| Agent | Emoji | Domain | Personality | Spawns When |
|-------|-------|--------|-------------|-------------|
| **Research Agent** | 🔬 | Intel gathering, market research, deep dives | Meticulous academic + ruthless skeptic | "Research:", competitor mentions, market analysis |
| **Content Agent** | ✍️ | Blog posts, tweets, marketing copy | Creative marketer + brand guardian | "Write:", "Draft:", content requests |
| **Audit Agent** | 🔍 | Reviews work, finds issues, QA | Obsessive perfectionist + devil's advocate | Before launches, after code changes, "Audit:" |
| **Analytics Agent** | 📊 | Metrics, trends, data analysis | Pattern hunter + hypothesis tester | Metrics reviews, "Analyze:", trend questions |
| **Code Agent** | 🛠️ | Implementations, fixes, automation | Pragmatic engineer + security conscious | "Implement:", "Fix:", code tasks |

---

## Agent Profiles

Each agent has a dedicated profile in this folder:
- `agents/research-agent.md` — Intelligence & research specialist
- `agents/content-agent.md` — Content creation specialist
- `agents/audit-agent.md` — Quality assurance specialist
- `agents/analytics-agent.md` — Data & metrics specialist
- `agents/code-agent.md` — Implementation specialist

---

## Spawn Protocol

### Method: sessions_spawn

```javascript
sessions_spawn({
  task: "[AGENT CONTEXT INJECTION]\n\n[SPECIFIC TASK DETAILS]",
  label: "[agent-type]-[task-slug]"
})
```

### Context Injection Template

Every spawn MUST include:
1. **Agent identity** — Read from `agents/[agent]-agent.md`
2. **Current system state** — What exists, what's working
3. **Constraints** — Budget, tools, limitations
4. **Success criteria** — What "done" looks like
5. **Wake protocol** — How to notify main agent

### Example Spawn

```javascript
sessions_spawn({
  task: `You are the RESEARCH AGENT. Read agents/research-agent.md for your identity.

MISSION: Competitive analysis of [competitor]

CONTEXT:
- We sell [products] via [platform]
- Our positioning is [value prop]
- Key differentiator: [what makes us different]

SUCCESS CRITERIA:
- Pricing comparison table
- Feature gap analysis
- Threat assessment (1-10)
- Opportunity identification

CONSTRAINTS:
- No paid APIs
- Use web_search and web_fetch
- Complete within 30 minutes

WHEN COMPLETE:
1. Save report to research/[slug]/competitive-analysis.md
2. Wake main agent with key findings
`,
  label: "research-competitor-[name]"
})
```

---

## Trigger Conditions

### Automatic Triggers (Agent Decides)

| Trigger Phrase | Spawns | Notes |
|----------------|--------|-------|
| "Research:", "Investigate:", "Deep dive on" | 🔬 Research Agent | |
| "Write:", "Draft:", "Create content for" | ✍️ Content Agent | |
| "Audit:", "Review:", "Check for issues" | 🔍 Audit Agent | |
| "Analyze:", "What do the metrics say", "Trend" | 📊 Analytics Agent | |
| "Implement:", "Fix:", "Build:", "Automate" | 🛠️ Code Agent | |

### Manual Override

Francisco can always specify:
- "Use Research Agent for this"
- "Have Code Agent handle that"
- "No spawn needed, just do it yourself"

### When NOT to Spawn

- Quick tasks (<5 min)
- Tasks requiring conversation context
- When human feedback loop is tight
- Simple file operations

---

## Wake Protocol (MANDATORY)

Every agent MUST wake the main agent upon completion:

```
cron(action: 'wake', text: '[EMOJI] [Agent] complete: [TASK]. Key findings: [2-3 bullets]. Full report: [PATH]', mode: 'now')
```

**Format:**
- 🔬 Research complete: [topic]. Key insight: [finding]. Report: research/[slug]/report.md
- ✍️ Content ready: [piece]. Tone: [tone]. Draft: content/drafts/[file].md
- 🔍 Audit complete: [target]. Issues found: [count]. Report: audits/[slug].md
- 📊 Analysis ready: [metric]. Trend: [direction]. Report: analytics/[slug].md
- 🛠️ Implementation done: [feature]. Status: [pass/fail]. Code: [path]

---

## Parallel Execution

Spawn multiple agents for independent work:

```javascript
// These run in parallel
sessions_spawn({ task: "Research Agent: competitor X...", label: "research-comp-x" })
sessions_spawn({ task: "Content Agent: draft blog post...", label: "content-blog" })
sessions_spawn({ task: "Analytics Agent: Q4 metrics...", label: "analytics-q4" })
```

**Rules:**
- Max 3 concurrent spawns (resource limit)
- Independent tasks only (no dependencies between spawns)
- Each agent wakes main agent independently

---

## Output Locations

| Agent | Output Path | Format |
|-------|-------------|--------|
| 🔬 Research | `research/[slug]/` | report.md, sources.md |
| ✍️ Content | `content/drafts/[slug].md` | Markdown draft |
| 🔍 Audit | `audits/[YYYY-MM-DD]-[slug].md` | Issues + recommendations |
| 📊 Analytics | `analytics/[slug]/` | analysis.md, data.json |
| 🛠️ Code | In-place (repo) | Code + commit message |

---

## Quality Gates

### Research Agent
- Sources cited for every claim
- Confidence levels stated
- Fallacy check applied

### Content Agent
- Brand voice check
- Call-to-action included
- Proofread for errors

### Audit Agent
- Every issue has severity rating
- Recommendations are actionable
- Nothing "seems fine" — specifics only

### Analytics Agent
- Data source stated
- Statistical significance noted
- Correlation ≠ causation check

### Code Agent
- Tests pass (if applicable)
- Security review for external inputs
- Commit message explains why

---

## Failure Handling

### Agent Stuck
If agent reports no progress after 15 min:
1. Check session logs
2. Provide additional context
3. Or: kill spawn, reassign to different agent

### Agent Wrong Path
Main agent can:
- Interrupt with additional context
- Kill spawn and restart with clarification
- Take over manually

### Persistent Failures
Log to `agents/failures.jsonl`:
```json
{
  "ts": "2026-02-01T05:00:00Z",
  "agent": "research",
  "task": "competitor analysis",
  "failure": "Could not access [source]",
  "resolution": "Used alternative source"
}
```

---

## The Motto (All Agents)

Every agent inherits the core motto:

```
EVERY response I give
EVERY analysis I make
EVERY recommendation I offer
EVERY claim I accept
EVERY action I take
        ↓
   SOUND LOGIC
 VERIFIED EVIDENCE
   NO FALLACIES
```

Specialists don't get to skip epistemics. They enforce them.

---

*Built for execution. Designed for scale. Accountable by default.*
