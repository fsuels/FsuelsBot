# OpenAI Configuration Status
_Last updated: 2026-02-17_

## Current State
- OpenAI provider configured with only `gpt-5.2` (no o3/o3-mini)
- Alias: `GPT` → `openai/gpt-5.2`
- **NO OpenAI auth profile exists** - models will fail without API key

## Facts (verified 2026-02-17)
- Francisco has **ChatGPT Pro subscription** ($200/mo) - this is WEB access only, NOT API
- ChatGPT Pro ≠ OpenAI API access (separate systems, separate billing)
- Checked all config backups (bak through bak.4): **no OpenAI auth was ever configured**
- No OPENAI_API_KEY in env vars or shell configs

## Available Options
1. **copilot-proxy plugin** - disabled, could route through GitHub Copilot to OpenAI models
2. **Add API key** - requires separate OpenAI API credits (pay-as-you-go)
3. **Remove OpenAI entirely** - stick with Claude only

## Pending Decision
Francisco needs to choose which option. He believes he authenticated before "same as Claude" but no evidence found in config history.
