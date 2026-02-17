# OpenAI Configuration Status
_Last updated: 2025-02-17_

## Current State
- **Models in config**: `openai/gpt-5.2`, `openai/o3`, `openai/o3-mini` (added 2025-02-17)
- **Auth status**: NOT CONFIGURED — no OpenAI API key exists
- **Error seen**: "No API key found for provider openai"

## Verified Facts
- `auth-profiles.json` only contains `anthropic:default` 
- No `OPENAI_API_KEY` environment variable set
- No OpenAI tokens (`sk-proj-*`, `sk-svcacct-*`) found in any backup files
- Francisco claims it was configured before, but no evidence found in backups (all from 2025-02-17)

## To Complete Setup
1. Francisco must provide OpenAI API key
2. Add to auth-profiles.json as `openai:default` profile
3. Or set `OPENAI_API_KEY` env var in shell/zshrc

## Config Location
- Gateway config: `/Users/fsuels/.openclaw/openclaw.json`
- Auth profiles: `/Users/fsuels/.openclaw/agents/main/agent/auth-profiles.json`

## Pins
- [constraint] OpenAI requires API key authentication — cannot use without valid key
- [fact] gpt-5.3 does not exist; gpt-5.2 is current latest
