# Task Claim Pool System

**Purpose:** Enable multiple specialized agents to claim and execute tasks in parallel based on their capabilities.

---

## Agent Specialties

Each agent is tagged with specialties that determine which tasks they can claim:

| Agent Type | Specialty | Example Tasks |
|------------|-----------|---------------|
| `research` | Web research, fact-checking, competitive analysis | X analysis, market research, docs audit |
| `content` | Writing, drafts, descriptions, copy | Product listings, blog posts, social media |
| `audit` | Verification, quality checks, compliance | SEO audits, evidence verification, procedure review |
| `analytics` | Data analysis, metrics, reporting | Sales analysis, conversion tracking, forecasting |
| `code` | Development, scripts, automation | PowerShell scripts, Python tools, web scraping |
| `general` | Any task (fallback) | Simple tasks, coordination |

---

## Task Priority Scoring

Priority score is calculated dynamically: `priority_score = urgency + impact + dependency_boost`

### Urgency (0-40 points)
| Condition | Points |
|-----------|--------|
| Past due date | 40 |
| Due within 24h | 30 |
| Due within 3 days | 20 |
| Due within 7 days | 10 |
| No deadline | 0 |

### Impact (0-40 points)
| Level | Points | Criteria |
|-------|--------|----------|
| `critical` | 40 | Revenue-blocking, customer-facing emergency |
| `high` | 30 | Significant revenue/growth impact |
| `medium` | 20 | Noticeable improvement |
| `low` | 10 | Nice-to-have, minor improvement |
| `none` | 0 | No measurable business impact |

### Dependency Boost (0-20 points)
| Condition | Points |
|-----------|--------|
| Task blocks 3+ other tasks | 20 |
| Task blocks 1-2 other tasks | 10 |
| No dependents | 0 |

### Final Priority
- **P0 (Critical):** Score 80-100
- **P1 (High):** Score 60-79
- **P2 (Medium):** Score 40-59
- **P3 (Low):** Score 20-39
- **P4 (Backlog):** Score 0-19

---

## Claiming Protocol

### 1. Agent Requests Work
```
Agent: "Claiming tasks for specialty: research"
```

### 2. System Returns Eligible Tasks
- Filter by `required_agent` matching agent's specialty
- Sort by `priority_score` descending
- Exclude tasks already claimed by other agents
- Return top N available tasks

### 3. Agent Claims Task
- Sets `claimed_by: { agent_id, claimed_at, specialty }`
- Sets `status: in_progress`
- Logs to `memory/parallel-execution.jsonl`

### 4. Parallel Execution Rules
- **Max concurrent per agent:** 1 (focus on completion)
- **Max concurrent total:** 5 (resource limit)
- **Claim timeout:** 30 minutes idle = auto-release
- **Handoff:** Agent can release task back to pool with notes

---

## Schema Extensions for tasks.json

### Task-Level Fields
```json
{
  "T123": {
    "title": "...",
    "required_agent": "research",      // Which specialty can handle this
    "priority": {
      "urgency": 20,                   // 0-40 based on deadline
      "impact": "high",                // critical/high/medium/low/none
      "impact_score": 30,              // 0-40 calculated
      "dependency_boost": 10,          // 0-20 based on blocking count
      "total_score": 60,               // Sum: P1 priority
      "priority_level": "P1"           // P0-P4 label
    },
    "claimed_by": {
      "agent_id": "subagent:abc123",   // Who has it
      "agent_name": "Research Agent",  // Human-readable
      "specialty": "research",         // What specialty claimed it
      "claimed_at": "2026-02-01T...",  // When claimed
      "last_heartbeat": "2026-02-01T..." // Last activity
    },
    "blocks": ["T124", "T125"],        // Tasks waiting on this one
    "blocked_by": ["T122"],            // Tasks this depends on
    ...existing fields...
  }
}
```

### Top-Level Fields
```json
{
  "version": 235,
  "parallel_execution": {
    "enabled": true,
    "max_concurrent": 5,
    "active_agents": [
      {
        "agent_id": "subagent:abc123",
        "agent_name": "Research Agent", 
        "specialty": "research",
        "current_task": "T123",
        "started_at": "2026-02-01T...",
        "last_heartbeat": "2026-02-01T..."
      }
    ],
    "claim_timeout_minutes": 30
  },
  ...existing fields...
}
```

---

## Mission Control Display

### Visual Indicators
- 🔴 **P0 tasks:** Red border, pulsing indicator
- 🟠 **P1 tasks:** Orange accent
- 🟡 **P2 tasks:** Yellow accent  
- 🟢 **P3/P4 tasks:** Default styling

### Agent Badges
- Show agent specialty emoji: 🔬 Research | ✍️ Content | 🔍 Audit | 📊 Analytics | 💻 Code
- Show claim status: "🤖 Agent X working..."
- Show parallel count: "3 agents active"

### Claim Pool View
- Unclaimed tasks sorted by priority
- Filter by specialty
- One-click claim button for eligible agents

---

## Implementation Checklist

- [x] Define agent specialties
- [x] Define priority scoring algorithm
- [x] Define schema extensions
- [ ] Update tasks.json with new fields
- [ ] Create priority calculation script
- [ ] Create claim/release functions
- [ ] Update Mission Control UI
- [ ] Create parallel execution log
