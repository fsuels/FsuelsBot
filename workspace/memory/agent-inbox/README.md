# Agent Inbox System
> Shared message queue for inter-agent communication

## Quick Start

### Check Your Inbox
```
Read: memory/agent-inbox/{your-role}/pending/
```

### Send a Message
```
Write to: memory/agent-inbox/{recipient}/pending/{MSG-id}.json
Log to: memory/events.jsonl (type: "agent_comm")
```

## Directory Structure
```
agent-inbox/
├── main/pending/        # Main agent's unread messages
├── main/archive/        # Main agent's processed messages
├── human/pending/       # Escalations awaiting Francisco
├── human/archive/       # Resolved escalations
├── broadcast/           # Announcements to all agents
└── subagent-{uuid}/     # Ephemeral subagent inboxes
```

## Message Lifecycle
```
1. Sender creates {MSG-id}.json in recipient's pending/
2. Sender logs to events.jsonl
3. Recipient reads on session start
4. Recipient sends ack (new message to sender)
5. Recipient moves original to archive/
6. Work happens
7. Recipient sends response
8. Sender archives response
```

## File Naming
```
MSG-{YYYYMMDD}-{HHMMSS}-{4-char-uuid}.json
```

Example: `MSG-20260201-043500-f7a2.json`

## See Also
- Full protocol: `agents/PROTOCOL.md`
- Schema: `memory/agent-inbox/schema.json`
- Audit log: `memory/events.jsonl`
