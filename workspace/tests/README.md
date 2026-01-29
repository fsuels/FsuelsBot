# Regression Tests

Ensure past mistakes never repeat.

## Structure

### `scenarios/` — Test scenarios from real incidents
### `validators/` — Scripts that check system state
### `reports/` — Test run results

## How It Works

1. **Incident occurs** → Create incident file in `incidents/`
2. **Root cause found** → Extract testable scenario
3. **Create test** → Write scenario that would catch this
4. **Run periodically** — During heartbeats or daily cron

## Test Format
```yaml
# tests/scenarios/YYYY-MM-DD-slug.yml
id: TEST-YYYYMMDD-NNN
incident: INC-YYYYMMDD-NNN
name: Brief description
description: What this test validates

trigger:
  type: manual | heartbeat | daily | weekly
  
preconditions:
  - condition 1
  - condition 2

steps:
  - action: what to check
    expect: expected result

success_criteria:
  - criterion 1
  
failure_action:
  - what to do if test fails
```

## Running Tests
- **Manual:** Read scenario, execute steps, verify expectations
- **Automated:** Scripts in `validators/` for checkable conditions

## Current Tests
(Auto-populated as tests are created)
