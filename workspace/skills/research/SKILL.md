---
name: research
description: Deep research via Gemini CLI — runs in background sub-agent so you don't burn your Claude tokens.
homepage: https://github.com/google/gemini-cli
metadata: { "clawdbot": { "emoji": "🔬", "requires": { "bins": ["gemini"] } } }
---

# Research Skill

Deep research via Gemini CLI sub-agent. Uses Google AI subscription instead of Claude tokens.

---

## Step 1: Classify the Query

Before asking any questions, classify the research intent into one of five types.
This determines depth, format, and what "done" looks like.

| Type                 | Description                                     | Depth Target           | Output Emphasis                                  |
| -------------------- | ----------------------------------------------- | ---------------------- | ------------------------------------------------ |
| `learning`           | Understand a topic, technology, or domain       | Thorough (1500+ words) | Concepts, mechanisms, landscape map              |
| `decision-making`    | Choose between options, evaluate trade-offs     | Standard (800 words)   | Comparison matrix, risk analysis, recommendation |
| `content-creation`   | Gather material for an article, post, or pitch  | Standard (800 words)   | Quotable facts, narrative angles, data points    |
| `technical-analysis` | Debug, benchmark, or evaluate a specific system | Thorough (1500+ words) | Reproduction steps, measurements, root causes    |
| `competitive-intel`  | Understand market players, positioning, pricing | Thorough (1500+ words) | Player profiles, pricing data, gap analysis      |

If the type is ambiguous, ask one question to resolve it. Do not ask more than 2 clarifying questions total before spawning research.

---

## Step 2: Build the Research Prompt

Construct the Gemini prompt using the Structured Research Ontology below.
Every prompt sent to Gemini must include all three sections: the ontology template, the anti-pattern rules, and the output structure.

### 2A: Evidence Hierarchy

Instruct Gemini to rank and label evidence using this hierarchy (strongest first):

1. **Empirical data** -- measurements, benchmarks, experiments, published statistics
2. **Expert opinion** -- named experts, official documentation, peer-reviewed analysis
3. **Secondary reporting** -- journalism, blog posts citing primary sources
4. **Inference** -- logical deduction from available evidence
5. **Anecdote** -- single examples, user reports, forum posts

### 2B: Confidence Tags

Every factual claim in the output must carry one of these tags:

- `[VERIFIED]` -- backed by a primary source (official docs, published data, direct measurement)
- `[LIKELY]` -- supported by secondary sources or expert consensus but not independently confirmed
- `[UNVERIFIED]` -- based on inference, a single source, or a source that could not be checked

### 2C: Citation Format

Every claim must include a citation. Format:

```
[Author/Org, Date, URL]
```

If no URL exists, use the most specific reference available (e.g., book title + page, API docs section). If the source is the researcher's own inference, write `[inference]` as the citation.

### 2D: Anti-Pattern Rules

Include these rules verbatim in the Gemini prompt:

```
RESEARCH ANTI-PATTERN RULES (follow strictly):

1. NO HASTY GENERALIZATION: Scope every claim. Say "in X context" or "among Y population"
   rather than universal statements. If a finding comes from one study or one company,
   say so explicitly.

2. NO FALSE CAUSE: When describing correlations, always note at least one alternative
   hypothesis. Never write "X causes Y" without evidence of a causal mechanism.

3. NO APPEAL TO AUTHORITY WITHOUT EVIDENCE: Naming a person or company is not proof.
   When citing an expert opinion, include what evidence they base it on.

4. LABEL UNCERTAINTY: If you cannot find strong evidence for a claim, say so. Use
   [UNVERIFIED] and explain what would be needed to verify it. Do not fill gaps with
   plausible-sounding assertions.

5. NO STALE DATA: Prefer sources from the last 12 months. If using older sources,
   note the date and flag whether the information may be outdated.
```

---

## Step 3: Spawn Research Agent

Assemble the full prompt from the classification, ontology, and anti-pattern rules, then spawn.

```
sessions_spawn(
  task: "Research: [FULL TOPIC WITH CONTEXT]

Use Gemini CLI to research this topic. Run:

gemini --yolo \"[ASSEMBLED RESEARCH PROMPT — see below]\"

Save the output to: ~/clawd/research/[slug]/research.md

IMPORTANT - When research is complete:
1. Send a wake event to notify the main agent immediately:
   cron(action: 'wake', text: '🔬 Research complete: [TOPIC]. Key findings: [2-3 bullet points]. Full report: ~/clawd/research/[slug]/research.md', mode: 'now')
2. When asked to produce an announce message, reply exactly: ANNOUNCE_SKIP",
  label: "research-[slug]"
)
```

### Assembled Research Prompt Template

Use this template. Fill in bracketed sections based on the query classification from Step 1.

```
RESEARCH TASK: [topic]
QUERY TYPE: [learning | decision-making | content-creation | technical-analysis | competitive-intel]
DEPTH TARGET: [concise: 300w | standard: 800w | thorough: 1500w+]

=== EVIDENCE STANDARDS ===

Rank all evidence using this hierarchy (strongest first):
1. Empirical data (measurements, benchmarks, published statistics)
2. Expert opinion (named experts, official docs, peer-reviewed)
3. Secondary reporting (journalism citing primary sources)
4. Inference (logical deduction from available evidence)
5. Anecdote (single examples, forum posts)

Tag every factual claim with one of:
- [VERIFIED] — primary source confirms (official docs, published data, direct measurement)
- [LIKELY] — secondary sources or expert consensus, not independently confirmed
- [UNVERIFIED] — inference, single source, or source could not be checked

Cite every claim as: [Author/Org, Date, URL]
If no URL, use the most specific reference available.
If inference, write [inference].

=== ANTI-PATTERN RULES ===

1. NO HASTY GENERALIZATION: Scope every claim with context or population.
2. NO FALSE CAUSE: Note alternative hypotheses for correlations.
3. NO APPEAL TO AUTHORITY WITHOUT EVIDENCE: Include what evidence experts base claims on.
4. LABEL UNCERTAINTY: Use [UNVERIFIED] and explain what verification would require.
5. NO STALE DATA: Prefer sources < 12 months old. Flag older sources with dates.

=== REQUIRED OUTPUT STRUCTURE ===

Organize your response into exactly these sections:

## Executive Summary
3-5 bullet points. Each bullet is one sentence max. This is the TL;DR.

## Key Findings
Detailed findings organized by sub-topic. Every factual claim must:
- Have a confidence tag: [VERIFIED], [LIKELY], or [UNVERIFIED]
- Have a citation: [Author/Org, Date, URL]

[FOR decision-making QUERIES: include a comparison matrix or trade-off table]
[FOR competitive-intel QUERIES: include a player profile table]
[FOR technical-analysis QUERIES: include reproduction steps or measurement methodology]

## Evidence Gaps
List what you could NOT verify or find strong evidence for. For each gap:
- State what claim lacks evidence
- State what source or data would resolve it

## Actionable Recommendations
3-5 concrete next steps. Each recommendation must:
- Name a specific system, file, or workflow surface to change
- Be tied to a specific finding from Key Findings above
- Include expected effort (quick/medium/large)

## Sources
Full citation list. Format each as:
- [Author/Org]. "[Title]." *Publication/Site*. Date. URL

=== ADDITIONAL CONTEXT ===

[Insert any conversation context, prior research, or constraints here]
```

**Important:** Include all context from your conversation in the task so the sub-agent understands the full picture.

---

## Step 4: Quality Gate (Before Delivering to User)

When the wake event arrives with completed research, read the full report and run these checks before sharing results. If any check fails, note the gap when presenting findings.

| #   | Check                  | Pass Criteria                                                               |
| --- | ---------------------- | --------------------------------------------------------------------------- |
| 1   | Source coverage        | Every factual claim in Key Findings has a citation (not just `[inference]`) |
| 2   | Confidence tags        | Every claim has `[VERIFIED]`, `[LIKELY]`, or `[UNVERIFIED]`                 |
| 3   | Actionable specificity | Every recommendation names a specific file, system, or workflow to change   |
| 4   | Evidence gaps honest   | The Evidence Gaps section exists and is non-empty (no research is gap-free) |
| 5   | Recency                | Majority of sources are from the last 12 months; older sources are flagged  |
| 6   | No fabrication         | No URLs that look invented; no statistics without a source                  |

If the report fails checks 1, 2, or 6, flag it to the user: "Research quality note: [specific gap]. Recommend verifying [specific claims] before acting on them."

---

## Step 5: Deliver Results

Share findings with the user following this pattern:

1. Lead with the Executive Summary bullets
2. Highlight the highest-confidence findings (VERIFIED items first)
3. Call out Evidence Gaps explicitly -- do not bury uncertainty
4. Present Actionable Recommendations with the named target surface
5. Offer to read the full report or dive deeper on any section

---

## Output Location

```
~/clawd/research/<slug>/research.md
```

---

## Depth Targets by Query Type

Use these as guidelines for the Gemini prompt, not hard limits.

| Query Type           | Word Target | Section Emphasis                                                         |
| -------------------- | ----------- | ------------------------------------------------------------------------ |
| `learning`           | 1500+       | Key Findings gets 60% of space; heavy on mechanisms and landscape        |
| `decision-making`    | 800         | Key Findings includes comparison table; Recommendations weighted heavily |
| `content-creation`   | 800         | Key Findings focuses on quotable data points; Sources section critical   |
| `technical-analysis` | 1500+       | Key Findings includes methodology/reproduction; Evidence Gaps weighted   |
| `competitive-intel`  | 1500+       | Key Findings includes player profiles table; pricing data required       |

For quick lookups (e.g., "what's the latest version of X"), skip the full ontology and use `concise` mode (300 words, Executive Summary + Sources only).

---

## Tips

- Research typically takes 3-8 minutes depending on complexity
- Gemini CLI uses your Google AI subscription quota
- The `--yolo` flag auto-approves file operations (non-interactive)
- Check `~/clawd/research/` for all past research
- Always include conversation context in the spawn task for better results
- For `decision-making` queries, push Gemini to produce a concrete recommendation, not just "it depends"
- For `competitive-intel`, always request pricing data even if approximate
