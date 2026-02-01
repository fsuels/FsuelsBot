# Inter-Agent Communication Protocol
> Version 1.0 | Created 2026-02-01

**Related:** `agents/SQUAD.md` (agent roles & spawn protocol)

## Overview

This protocol defines how agents communicate, hand off work, debate conclusions, and escalate disagreements. It integrates with the existing session system (`agent:main:*`) and audit infrastructure (`events.jsonl`).

---

## 1. Agent Identity & Sessions

### Session Naming Convention
```
agent:{owner}:{role}:{instance-id}
```

**Examples:**
- `agent:main:main` — Primary agent (direct human interaction)
- `agent:main:subagent:a0c0a955-...` — Spawned subagent with UUID
- `agent:main:council:grok` — Council member (Grok instance)
- `agent:main:council:chatgpt` — Council member (ChatGPT instance)
- `agent:main:reviewer` — Dedicated review agent

### Agent Roles
| Role | Purpose | Authority |
|------|---------|-----------|
| `main` | Primary agent, human interface | Full authority, can spawn others |
| `subagent` | Task-specific worker | Limited scope, reports to spawner |
| `council` | Debate participant | Advisory only, no direct execution |
| `reviewer` | Quality assurance | Can block/approve, escalate |
| `cron` | Scheduled automation | Pre-approved scope only |

---

## 2. Message Format for Agent-to-Agent Handoffs

### Standard Message Schema
```json
{
  "id": "MSG-{YYYYMMDD}-{HHMMSS}-{short-uuid}",
  "timestamp": "ISO-8601",
  "from": "agent:main:main",
  "to": "agent:main:subagent:*",
  "type": "handoff|query|response|challenge|escalation|ack",
  "priority": "P0|P1|P2|P3",
  "subject": "Brief description",
  "body": {
    "task": "What needs to be done",
    "context": "Relevant background",
    "constraints": ["Must not exceed X", "Requires Y"],
    "deadline": "ISO-8601 or null",
    "artifacts": ["path/to/file1", "path/to/file2"]
  },
  "thread_id": "Optional - for conversation threading",
  "reply_to": "Optional - MSG-id being responded to",
  "status": "pending|read|in_progress|completed|escalated",
  "ttl_hours": 24
}
```

### Message Types

| Type | Purpose | Expected Response |
|------|---------|-------------------|
| `handoff` | Delegate work to another agent | `ack` then `response` on completion |
| `query` | Request information or opinion | `response` with answer |
| `response` | Answer to query or handoff result | None (terminal) |
| `challenge` | Dispute a conclusion | `response` with defense or `ack` with revision |
| `escalation` | Elevate to human | Routed to `memory/active-thread.md` |
| `ack` | Acknowledge receipt | None (terminal) |

---

## 3. Work Handoff Protocol

### Initiating a Handoff
```
1. Spawner creates MSG with type="handoff"
2. Spawner writes to memory/agent-inbox/{recipient}/
3. Spawner logs to events.jsonl: type="agent_handoff"
4. Recipient reads inbox on session start
5. Recipient sends ack
6. Recipient executes and sends response
```

### Handoff Message Example
```json
{
  "id": "MSG-20260201-043500-f7a2",
  "timestamp": "2026-02-01T04:35:00Z",
  "from": "agent:main:main",
  "to": "agent:main:subagent:protocol-designer",
  "type": "handoff",
  "priority": "P1",
  "subject": "BUILD: Inter-Agent Communication Protocol",
  "body": {
    "task": "Create agents/PROTOCOL.md with handoff, debate, escalation rules",
    "context": "Part of multi-agent architecture buildout",
    "constraints": ["Must integrate with existing session system", "Must be auditable"],
    "deadline": null,
    "artifacts": []
  },
  "thread_id": "THREAD-multi-agent-build",
  "status": "pending",
  "ttl_hours": 24
}
```

### Completion Response Example
```json
{
  "id": "MSG-20260201-050000-b3c1",
  "timestamp": "2026-02-01T05:00:00Z",
  "from": "agent:main:subagent:protocol-designer",
  "to": "agent:main:main",
  "type": "response",
  "priority": "P1",
  "subject": "RE: BUILD: Inter-Agent Communication Protocol",
  "reply_to": "MSG-20260201-043500-f7a2",
  "body": {
    "result": "completed",
    "summary": "Created PROTOCOL.md with 5 sections, inbox system, audit integration",
    "artifacts": ["agents/PROTOCOL.md", "memory/agent-inbox/README.md"],
    "notes": "Recommended: Add inbox cleanup cron job"
  },
  "thread_id": "THREAD-multi-agent-build",
  "status": "completed"
}
```

---

## 4. Debate & Challenge Protocol

### When Agents Should Challenge

An agent MUST challenge when:
1. **Logical inconsistency** — Conclusion doesn't follow from premises
2. **Missing evidence** — Claim made without verification
3. **Scope creep** — Agent acting outside delegated authority
4. **Contradicts prior decisions** — Conflicts with established state
5. **Fallacy detected** — Reasoning violates SOUL.md principles

### Challenge Message Format
```json
{
  "type": "challenge",
  "subject": "CHALLENGE: [Original claim]",
  "body": {
    "claim_challenged": "The specific statement being disputed",
    "grounds": "Why this is being challenged",
    "evidence": ["Supporting facts", "Counter-examples"],
    "requested_action": "revise|defend|escalate",
    "severity": "minor|moderate|critical"
  }
}
```

### Challenge Response Protocol
```
1. Recipient MUST respond within same session (no ignoring challenges)
2. Valid responses:
   a) DEFEND — Provide evidence/reasoning supporting original claim
   b) REVISE — Acknowledge error, provide corrected position
   c) ESCALATE — Disagreement too significant, needs human input
3. After 2 rounds of DEFEND without resolution → auto-escalate
```

### Debate Threading Example
```
MSG-001: Agent A claims "X is the best approach"
MSG-002: Agent B challenges "X ignores cost constraint"
MSG-003: Agent A defends "Cost is offset by time savings"
MSG-004: Agent B challenges "Time savings unverified"
MSG-005: → AUTO-ESCALATE (2 rounds, no resolution)
```

---

## 5. Escalation Rules

### Automatic Escalation Triggers

| Trigger | Action |
|---------|--------|
| 2+ challenge rounds without resolution | Escalate disagreement |
| P0 priority decision | Always escalate |
| External action (send email, post, spend $) | Escalate for approval |
| Confidence < 70% on material decision | Escalate |
| Any agent requests escalation | Honor immediately |
| Task blocked > 1 hour | Escalate blocker |

### Escalation Message Format
```json
{
  "type": "escalation",
  "to": "human:francisco",
  "subject": "ESCALATION: [Brief description]",
  "body": {
    "reason": "Why this needs human input",
    "positions": [
      {"agent": "agent:main:subagent:A", "position": "...", "evidence": "..."},
      {"agent": "agent:main:subagent:B", "position": "...", "evidence": "..."}
    ],
    "debate_log": ["MSG-001", "MSG-002", "MSG-003"],
    "recommended_action": "What the escalating agent suggests",
    "deadline": "When decision is needed"
  }
}
```

### Escalation Routing
1. Write to `memory/agent-inbox/human/`
2. Append to `memory/active-thread.md` (human visibility)
3. Log to `events.jsonl` with `type: "escalation"`
4. If P0: Also send Telegram notification to Francisco

---

## 6. Audit Trail Requirements

### Every Inter-Agent Message MUST Be Logged

**events.jsonl entry for agent communication:**
```json
{
  "ts": "2026-02-01T04:35:00Z",
  "id": "EVT-{date}-{uuid}",
  "type": "agent_comm",
  "subtype": "handoff|challenge|response|escalation",
  "from_session": "agent:main:main",
  "to_session": "agent:main:subagent:xyz",
  "message_id": "MSG-...",
  "subject": "Brief description",
  "priority": "P1",
  "outcome": "pending|completed|escalated"
}
```

### Audit Queries
The inbox system supports querying:
- All messages between specific agents
- All escalations in date range
- All unresolved challenges
- Thread reconstruction by thread_id

---

## 7. Inbox File Structure

```
memory/agent-inbox/
├── README.md                    # This documentation
├── schema.json                  # JSON schema for validation
├── main/                        # Main agent's inbox
│   ├── pending/                 # Unread messages
│   └── archive/                 # Processed messages
├── subagent-{uuid}/             # Subagent inboxes (ephemeral)
│   ├── pending/
│   └── archive/
├── human/                       # Escalations to Francisco
│   ├── pending/
│   └── archive/
└── broadcast/                   # Messages to all agents
    └── announcements/
```

### File Naming Convention
```
{message-id}.json
```
Example: `MSG-20260201-043500-f7a2.json`

---

## 8. Session Integration

### On Session Start (Every Agent)
```
1. Read own inbox: memory/agent-inbox/{self}/pending/
2. Read broadcast: memory/agent-inbox/broadcast/announcements/
3. Process messages by priority (P0 first)
4. Send ack for each processed message
5. Move processed to archive/
```

### On Session End (Subagents)
```
1. Send final response to spawner
2. Archive all pending inbox messages
3. Log session end to events.jsonl
```

### Cleanup Policy
- Archived messages: Retain 7 days
- Pending messages past TTL: Auto-escalate then archive
- Subagent inboxes: Delete 24h after subagent termination

---

## 9. Implementation Checklist

### For Spawning Agent (Main)
- [ ] Create inbox directory for subagent if needed
- [ ] Write handoff message to subagent inbox
- [ ] Log handoff to events.jsonl
- [ ] Monitor for response (check inbox periodically)
- [ ] Handle escalations promptly

### For Spawned Agent (Subagent)
- [ ] Check inbox on start
- [ ] Send ack for received handoff
- [ ] Execute within delegated scope
- [ ] Challenge if something seems wrong
- [ ] Send response on completion
- [ ] Never exceed delegated authority

### For Council/Debate
- [ ] Each position must cite evidence
- [ ] Challenges must be specific (no vague objections)
- [ ] 2-round limit before escalation
- [ ] All positions logged for audit

---

## 10. Example Flows

### Simple Handoff
```
Main → Subagent: handoff "Analyze this data"
Subagent → Main: ack "Received, starting"
Subagent → Main: response "Analysis complete, found X"
Main: Archives thread, marks task done
```

### Handoff with Challenge
```
Main → Subagent: handoff "Price this product at $50"
Subagent → Main: challenge "Margin too low, recommend $65"
Main → Subagent: response "Approved, revise to $65"
Subagent → Main: response "Listed at $65, task complete"
```

### Escalation Flow
```
Agent A → Agent B: challenge "Your approach ignores X"
Agent B → Agent A: defend "X is out of scope"
Agent A → Agent B: challenge "X is in original requirements"
Agent B → Agent A: defend "Requirements ambiguous"
System: Auto-escalate after 2 rounds
Agent A → Human: escalation "Need clarification on X requirement"
```

---

## Appendix: Priority Definitions

| Priority | Response Time | Examples |
|----------|---------------|----------|
| P0 | Immediate | Security issue, data loss risk, human waiting |
| P1 | Same session | Active task blocker, time-sensitive work |
| P2 | Within 4 hours | Normal workflow, queued work |
| P3 | Within 24 hours | Nice-to-have, optimization |

---

*This protocol is authoritative for all agent-to-agent communication in this workspace.*
