# Autonomy Tiers
*Source: Council Team Architecture Debate (EVT-20260128-065)*
*Established: 2026-01-28*

## Three Agent Tiers

### Tier 1: Execute
**Who:** Content(), PromptWork()
**Can do:** Produce output. Nothing more.
- Draft copy, generate templates, write descriptions
- Return structured output to orchestrator
- Cannot spawn other functions
- Cannot modify system files
- Cannot take external actions

### Tier 2: Propose + Spawn
**Who:** QA Loop (Pressure Loop), Research Loop (Deep Dive)
**Can do:** Create tasks, spawn on-demand functions, flag issues.
- Analyze outputs and propose improvements
- Spawn Tier 1 functions to execute improvements
- Add items to backlog with scores
- Flag issues for orchestrator attention
- Cannot approve Tier B/C actions
- Cannot modify SOUL.md, AGENTS.md, or core config

### Tier 3: Control
**Who:** Orchestrator (Fsuels Bot) only
**Can do:** Everything. Final authority under Francisco.
- Override, merge, or kill agents
- Approve Tier B and C actions
- Modify system prompts and core config
- Make decisions on ambiguous tasks
- Interface directly with Francisco
- Deploy code, change live settings

## Escalation Rules

1. Tier 1 agent unsure → escalate to Orchestrator
2. Tier 2 agent finds high-impact issue → escalate to Orchestrator
3. Orchestrator unsure on big decision → invoke Council()
4. Orchestrator unsure and Council disagrees → ask Francisco
5. Francisco's word is final. Always.
