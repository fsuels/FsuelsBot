# Knowledge Base Architecture

*World-class knowledge management system built on industry best practices.*

**Version:** 1.0.0
**Created:** 2026-02-01
**Owner:** Fsuels Bot + Francisco

---

## Core Principles (Non-Negotiable)

### 1. Single Source of Truth
Every fact exists in ONE place. References point to it. No duplicates, no contradictions.

### 2. Evidence-Based
Every claim has a source. Every decision has reasoning. Nothing accepted at face value.

### 3. Semantic Searchability
Every document is tagged, categorized, and indexed. AI-powered search finds anything in seconds.

### 4. Living System
Regular reviews. Outdated content flagged. Quality maintained. Never stale.

### 5. Workflow Integration
Knowledge flows INTO work, not sits in a vault. Procedures link to knowledge. Tasks reference context.

---

## Taxonomy (Category System)

### Primary Categories

| Category | Code | Description |
|----------|------|-------------|
| **Business** | `BIZ` | DLM, Ghost Broker, ventures, strategy |
| **Technical** | `TECH` | Systems, tools, integrations, code |
| **Research** | `RES` | Market intel, competitor analysis, trends |
| **Procedures** | `PROC` | How-to guides, workflows, SOPs |
| **People** | `PPL` | Contacts, relationships, vendors |
| **Finance** | `FIN` | Costs, pricing, margins, budgets |
| **Legal** | `LEGAL` | Compliance, terms, contracts |
| **Insights** | `INS` | Learnings, patterns, wisdom |

### Secondary Tags

- `verified` — Confirmed accurate
- `draft` — Needs review
- `stale` — Needs update (>90 days)
- `pinned` — P0 critical, never auto-archive
- `sensitive` — Restricted access
- `archived` — Historical reference only

---

## Document Types

### 1. FACT (`fact-*.md`)
Single atomic truth. One concept. Verified source.

```yaml
---
type: fact
category: BIZ
tags: [verified, pinned]
source: "https://example.com or internal observation"
confidence: 0.95
created: 2026-02-01
reviewed: 2026-02-01
---
```

### 2. DECISION (`decision-*.md`)
Choice made with reasoning. Links to context.

```yaml
---
type: decision
category: BIZ
status: active | superseded
superseded_by: decision-xxx.md (if applicable)
decided: 2026-02-01
decided_by: Francisco
reasoning: "Why this choice was made"
alternatives_considered: ["Option A", "Option B"]
---
```

### 3. PROCEDURE (`proc-*.md`)
Step-by-step guide. Versioned. Tested.

```yaml
---
type: procedure
category: PROC
version: 1.0
last_tested: 2026-02-01
owner: bot | francisco
prerequisites: ["Tool X", "Access Y"]
estimated_time: "15 minutes"
---
```

### 4. ENTITY (`entity-*.md`)
Person, company, product, tool. Structured data.

```yaml
---
type: entity
entity_type: person | company | product | tool | vendor
category: PPL | BIZ | TECH
status: active | inactive | archived
---
```

### 5. INSIGHT (`insight-*.md`)
Pattern recognition. Wisdom. Meta-learning.

```yaml
---
type: insight
category: INS
confidence: 0.8
derived_from: ["source1", "source2"]
validated: true | false
---
```

### 6. RESEARCH (`research-*.md`)
Investigation results. Time-stamped. Sources cited.

```yaml
---
type: research
category: RES
topic: "Market Analysis - X Niche"
date: 2026-02-01
sources: ["url1", "url2"]
confidence: 0.7
expires: 2026-05-01  # Research goes stale
---
```

---

## Directory Structure

```
knowledge/
├── ARCHITECTURE.md          # This file - the blueprint
├── INDEX.md                  # Master catalog with search
├── REVIEW-QUEUE.md           # Items needing review
│
├── business/                 # BIZ category
│   ├── dlm/                  # Dress Like Mommy
│   ├── ghost-broker/         # Ghost Broker AI
│   └── ventures/             # Other opportunities
│
├── technical/                # TECH category
│   ├── tools/                # Tool documentation
│   ├── integrations/         # API/system connections
│   └── infrastructure/       # Our setup
│
├── research/                 # RES category
│   ├── market/               # Market intelligence
│   ├── competitors/          # Competitor analysis
│   └── trends/               # Industry trends
│
├── procedures/               # PROC category (existing)
│   ├── seo/
│   ├── listings/
│   └── operations/
│
├── people/                   # PPL category
│   ├── vendors/              # Supplier contacts
│   ├── partners/             # Business partners
│   └── experts/              # Industry experts to follow
│
├── finance/                  # FIN category
│   ├── pricing/
│   ├── costs/
│   └── margins/
│
├── insights/                 # INS category
│   ├── learnings/            # What we've learned
│   ├── patterns/             # Recurring patterns
│   └── wisdom/               # Meta-insights
│
└── archive/                  # Historical reference
    └── YYYY-MM/              # By month archived
```

---

## Quality Gates

### Creation Gate
Before adding ANY knowledge:
1. [ ] Does this already exist? (Search first)
2. [ ] Is the source verified?
3. [ ] Is the category correct?
4. [ ] Are required frontmatter fields filled?
5. [ ] Is it linked from INDEX.md?

### Review Cycle
| Frequency | Action |
|-----------|--------|
| Weekly | Check REVIEW-QUEUE.md, process items |
| Monthly | Audit for stale content (>90 days unreviewed) |
| Quarterly | Full taxonomy review, archive dead items |

### Confidence Scoring

| Score | Meaning |
|-------|---------|
| 1.0 | Mathematically certain / Official documentation |
| 0.9 | Verified by multiple sources / Tested personally |
| 0.8 | Single reliable source / Observed once |
| 0.7 | Expert opinion / Reasonable inference |
| 0.6 | Educated guess / Limited evidence |
| 0.5 | Speculation / Needs verification |
| <0.5 | Don't store — verify first |

---

## Search & Retrieval

### Primary: Semantic Search
Use `memory_search` tool with knowledge/ path for natural language queries.

### Secondary: Index Lookup
INDEX.md contains:
- Full catalog by category
- Tag-based groupings
- Recent additions
- Most referenced items

### Tertiary: Direct Path
Know what you need? Go directly: `knowledge/business/dlm/pricing-strategy.md`

---

## Integration Points

### → Tasks (tasks.json)
Every task can reference knowledge:
```json
"knowledge_refs": ["knowledge/procedures/seo/title-optimization.md"]
```

### → Memory (memory/*.md)
Daily logs can promote insights to knowledge:
```markdown
**PROMOTE TO KB:** [insight about X] → knowledge/insights/learnings/
```

### → Learnings DB (.learnings/)
High-confidence learnings graduate to knowledge base with full documentation.

### → Procedures (procedures/)
Procedures ARE knowledge. They live in knowledge/procedures/ (symlinked for compatibility).

---

## Maintenance Commands

### Add New Knowledge
```
1. Search for duplicates
2. Choose correct type template
3. Fill frontmatter completely
4. Write content
5. Add to INDEX.md
6. Commit with message: "kb: add [type] - [title]"
```

### Flag for Review
Add to REVIEW-QUEUE.md with reason and priority.

### Archive
Move to `archive/YYYY-MM/` with note explaining why.

### Supersede
Mark old version with `superseded_by`, create new version, update INDEX.md.

---

## Anti-Patterns (What NOT to do)

❌ **Don't duplicate** — One fact, one place, many links
❌ **Don't store unverified** — If confidence <0.5, don't add it
❌ **Don't skip frontmatter** — Metadata IS the value
❌ **Don't orphan documents** — Everything in INDEX.md
❌ **Don't let it rot** — Review or archive, never abandon

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Search success | >90% | Found what looking for on first try |
| Freshness | <10% stale | Items >90 days without review |
| Coverage | No blind spots | Every business area documented |
| Usage | Daily reference | KB consulted in work daily |
| Accuracy | Zero wrong decisions | No decisions made on outdated info |

---

*This architecture follows best practices from: Notion, Obsidian, Stripe Docs, Digital Workplace Group 2025 standards, and enterprise KM systems. Built for a solopreneur + AI assistant team.*
