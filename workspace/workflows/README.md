# Workflows — State Machines

Convert prose procedures to executable state machines.

## Why State Machines?
- **Deterministic** — Always know what state we're in
- **Resumable** — Can pick up exactly where we left off after compaction
- **Verifiable** — Can check preconditions before transitions
- **Auditable** — Every transition logged

## Structure
```yaml
workflow:
  id: WF-XXX
  name: Workflow Name
  description: What this workflow does
  
states:
  - id: state_id
    name: Human-readable name
    type: start | intermediate | end | error
    
transitions:
  - from: state_a
    to: state_b
    trigger: what causes transition
    conditions:
      - precondition 1
    actions:
      - what to do during transition
      
current_state: state_id  # Where we are now
history: []  # State transition log
```

## Active Workflows
(Tracked in workflows/active.json)

## Completed Workflows
(Archived in workflows/archive/)
