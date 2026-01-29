---
version: "1.0"
created: "2026-01-28"
updated: "2026-01-28"
verified: "2026-01-28"
confidence: "medium"
---

# Procedure: Recall Pack Generation
*Last updated: 2026-01-28*
*Source: Council Round 1 + Round 2 (merged single-file approach)*

## When to Use
- Automatically at 3 AM during consolidation
- On-demand when major context changes

## Architecture
**One file: `recall/pack.md`**. No splits. "More with less."

## Steps

### 1. P0 Constraints
- Scan ledger for P0-priority constraint events
- Include ALL — P0 is always loaded, no exceptions

### 2. Open Commitments (oldest first)
- Read `memory/index/open-loops.json` for open commitment IDs
- Sort by age (oldest first), list all with status and age
- Top 3 oldest get special prominence

### 3. Waiting-On
- From open commitments, identify external dependencies
- Include: who, what, age

### 4. Today's Focus
- Active tasks, deadlines within 48h, scheduled events

### 5. Context
- Current project status, recent decisions (72h), Francisco's state
- Flag any stale facts or integrity issues

### 6. 7-Day Forecast
- 3-5 predictions based on open loops, patterns, deadlines
- Tag: HIGH / MEDIUM / LOW confidence

### 7. Procedures + Accounts
- Key operational procedures (compact)
- Account IDs (single line, quick reference)

## Quality Checks
- Every P0 constraint included? ✅
- Top 3 oldest open commitments surfaced? ✅
- Superseded events excluded? ✅
- Stale facts flagged? ✅
- Forecast present? ✅
- Under 3,000 words? ✅
