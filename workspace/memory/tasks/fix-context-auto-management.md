# Task: Auto-manage context when it gets tight

## Problem
When context reaches ~90-100%, sessions degrade. Francisco wants this handled AUTOMATICALLY — no manual intervention, no warnings, just fix it.

## Requirements
1. When context pressure hits a threshold (e.g. 90%), automatically summarize progress and save to memory
2. Start a fresh session with the summary carried over
3. Never let context hit 100% and degrade — preemptively handle it
4. This should be a code-level fix in OpenClaw gateway/session management

## Where to look
- `src/gateway/` — session management, context tracking
- `src/infra/` — session runner, context window management  
- Search for "context" "overflow" "pressure" "token" in gateway code
- The system prompt already has "Context Pressure" alerts — but they're just warnings, not actions

## What needs to happen
- Detect when context is getting tight (configurable threshold)
- Auto-summarize the session state
- Save summary to memory (active-thread.md or similar)
- Either: compress context in-place, OR start fresh session with continuity capsule
- Make this seamless — Francisco shouldn't notice

## Status: spawning sub-agent to investigate and implement
