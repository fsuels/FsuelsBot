# Principle: The Learning Loop
*Priority: P0*
*Source: Council Three Visionaries Debate, 2026-01-28*
*Inspired by: Ilya Sutskever's Age of Research*

## Rule
The system must get smarter over time, not just execute tasks. Every cycle should produce:
- **Reusable artifacts** — templates, SOPs, improved prompts (artifact-pipeline.md)
- **Updated instructions** — nightly loop reviews last 24h and updates its own rules
- **Tracked improvements** — "learning metrics" alongside performance metrics

## Learning Metrics (tracked weekly)
- Templates reused (artifact leverage ratio)
- Mistakes avoided that were made before (error non-recurrence)
- Procedures that improved without human prompting (autonomous improvement)
- Time-to-verify trend (are outputs getting easier to review?)

## Enforcement
- Weekly "learning audit" during heartbeat — what did the system learn this week?
- Nightly instruction-update loop extracts learnings from last 24h
- NOT per-task checking (that's noise) — weekly rhythm
- Artifacts rated on reusability at creation time
