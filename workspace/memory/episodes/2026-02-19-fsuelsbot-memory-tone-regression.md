# Episode: FsuelsBot Recall/Tone Regression

> Date range: 2026-02-19
> Confidence: high

## Problem Pattern

- Assistant repeatedly used robotic status blocks and repeated snapshot prompts.
- Family-trigger recall failed to return direct answers for sister/nephew names.

## User-Critical Feedback

- "Very robotic" and "I care about the result" were repeated quality signals.
  - source: user messages 2026-02-19
- User demanded trigger-first family summary recovery.
  - source: user messages 2026-02-19

## Fix Direction Locked

- Direct-answer-first style is mandatory.
- Memory must be organized for trigger retrieval, not context-dump recaps.
- Unknowns must remain explicit until user provides facts.
