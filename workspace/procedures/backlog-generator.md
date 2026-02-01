# Self-Generating Backlog System

> **Purpose:** Automatically discover and queue opportunities for improvement
> **Trigger:** Daily cron job + heartbeat checks
> **Output:** Tasks auto-created in `tasks.json` bot_queue

---

## Overview

The backlog generator scans multiple sources for opportunities and automatically creates tasks with proper context. This enables proactive improvement without waiting for human direction.

**The motto applies:**
```
EVERY task generated → SOUND LOGIC
EVERY opportunity found → VERIFIED EVIDENCE  
EVERY action proposed → NO FALLACIES
```

---

## Sources Scanned

### 1. Website Audit Findings
**File:** `memory/seo-audit.json`, `memory/website-audit.json`
**Frequency:** Daily
**Creates:** SEO tasks, conversion tasks, UX fixes

Scans for:
- Products with missing meta descriptions
- Images without ALT text
- Pages with slow load times
- Broken links (404s)
- Schema markup issues
- Mobile responsiveness problems

**Agent Type:** `seo` or `conversion`

### 2. Competitor Changes
**File:** `memory/competitor-monitor.json`
**Frequency:** Daily
**Creates:** Research tasks, pricing tasks, product opportunities

Scans for:
- New products from competitors
- Price changes (>10% movement)
- New marketing campaigns
- Changed positioning
- New features or services

**Agent Type:** `research` or `marketing`

### 3. Content Gaps
**File:** `memory/content-gaps.json`, `knowledge/seo-strategy-2026.md`
**Frequency:** Daily
**Creates:** Content tasks, collection description tasks

Scans for:
- Collections with <150 words description
- Products with no enhanced copy
- Missing FAQ sections
- No blog content for high-intent keywords
- Thin category pages

**Agent Type:** `content` or `seo`

### 4. Error Patterns
**Files:** `memory/error-log-archive-*.jsonl`, `.learnings/ERRORS.md`
**Frequency:** Daily
**Creates:** Bug fix tasks, process improvement tasks

Scans for:
- Repeated error types (3+ occurrences)
- Recurring browser automation failures
- API errors with patterns
- Memory/crash patterns
- Process failures in similar contexts

**Agent Type:** `engineering` or `operations`

### 5. Seasonal Events
**File:** `config/seasonal-calendar.yaml`
**Frequency:** Daily (30-day lookahead)
**Creates:** Campaign tasks, inventory tasks, promotion tasks

Scans for:
- Upcoming holidays (Valentine's, Easter, Mother's Day, etc.)
- Seasonal transitions (Summer → Fall)
- Shopping events (Black Friday, Cyber Monday)
- School events (Back to School)

**Agent Type:** `marketing` or `operations`

### 6. Analytics Signals
**File:** `memory/analytics-signals.json`
**Frequency:** Daily
**Creates:** Investigation tasks, optimization tasks

Scans for:
- Traffic drops (>20% WoW)
- Conversion rate changes
- Cart abandonment spikes
- High-exit pages
- Search terms with no results

**Agent Type:** `analytics` or `conversion`

---

## Task Generation Rules

### Scoring Formula
Each opportunity is scored on a 0-20 scale:

| Factor | Points | Criteria |
|--------|--------|----------|
| Impact | 0-8 | Revenue potential, user reach |
| Urgency | 0-5 | Time-sensitivity, deadline |
| Effort | 0-4 | Lower effort = higher score |
| Confidence | 0-3 | Evidence quality |

**Thresholds:**
- Score ≥12: Add to bot_queue immediately
- Score 8-11: Add to bot_queue (low priority)
- Score <8: Log opportunity, don't create task

### Duplicate Prevention

Before creating any task, the generator checks:

1. **Title similarity** — Fuzzy match against existing tasks (>80% = duplicate)
2. **Source + key match** — Same source + same key = duplicate
3. **Time window** — Same opportunity type within 7 days = duplicate
4. **Done_today check** — Don't recreate recently completed work

Deduplication keys stored in: `memory/backlog-dedup.json`

### Context Population

Every auto-generated task MUST include:

```json
{
  "title": "Clear, actionable title",
  "status": "pending",
  "created_at": "ISO timestamp",
  "created_by": "backlog-generator",
  "source": "website_audit|competitor|content_gap|error_pattern|seasonal|analytics",
  "source_key": "unique identifier for dedup",
  "score": 15,
  "score_breakdown": {
    "impact": 6,
    "urgency": 4,
    "effort": 3,
    "confidence": 2
  },
  "agent_type": "seo|marketing|content|engineering|operations|research|analytics|conversion",
  "context": {
    "summary": "Why this task exists and what triggered it",
    "evidence": "The specific data/finding that created this",
    "created_from": "backlog-generator:source_type",
    "decisions": [],
    "constraints": ["Auto-generated - verify evidence before executing"]
  },
  "epistemic": {
    "claims": [],
    "verified": [],
    "assumptions": ["Evidence from automated scan - may need human verification"],
    "confidence": 0.6
  }
}
```

---

## Specialist Agent Types

Tasks are tagged with agent types for future multi-agent routing:

| Agent Type | Specialization | Example Tasks |
|------------|---------------|---------------|
| `seo` | Search optimization | Meta descriptions, schema, keywords |
| `content` | Writing & copy | Product descriptions, blog posts |
| `marketing` | Campaigns & promotions | Holiday campaigns, ads |
| `analytics` | Data analysis | Conversion reports, traffic analysis |
| `conversion` | UX optimization | Checkout fixes, trust signals |
| `engineering` | Technical fixes | Bugs, automation, scripts |
| `operations` | Process & inventory | BuckyDrop sync, shipping |
| `research` | Competitor & market | Market analysis, trends |

---

## Running the Generator

### Manual Run
```powershell
python scripts/backlog-generator.py --scan-all
python scripts/backlog-generator.py --source website_audit
python scripts/backlog-generator.py --dry-run  # Preview without creating
```

### Cron Schedule
- **Daily at 6 AM EST:** Full scan of all sources
- **Config:** `config/cron-jobs.yaml` → `backlog-generator` entry

### Heartbeat Integration
During each heartbeat, quick check for:
- High-urgency opportunities (seasonal <7 days)
- Critical errors (3+ occurrences today)
- Analytics alerts (>30% negative change)

---

## Output & Logging

### Task Creation
- Tasks created in `memory/tasks.json` → `bot_queue` lane
- Events logged to `memory/events.jsonl` with `type: backlog_generated`

### Daily Report
After each run, generates: `memory/backlog-reports/YYYY-MM-DD.json`

```json
{
  "run_date": "2026-02-01",
  "sources_scanned": ["website_audit", "competitor", ...],
  "opportunities_found": 12,
  "tasks_created": 5,
  "duplicates_skipped": 3,
  "below_threshold": 4,
  "tasks": ["T213", "T214", "T215", "T216", "T217"]
}
```

---

## Maintenance

### Weekly Review
- Review generated tasks for quality
- Adjust scoring weights if needed
- Update dedup patterns for false positives
- Prune stale dedup entries (>30 days)

### Tuning Thresholds
If too many low-value tasks: raise score threshold to 14
If missing opportunities: lower threshold to 10 or expand sources

---

## Safety Guardrails

1. **Max tasks per run:** 10 (prevent queue flooding)
2. **Human review tag:** All tasks created with `auto_generated: true`
3. **No direct execution:** Tasks are queued, not executed immediately
4. **Confidence floor:** Tasks with <40% confidence are logged but not created
5. **Forbidden actions:** Never auto-create tasks for financial, deletion, or external comms

---

## Changelog

- **2026-02-01:** Initial implementation (subagent build)
