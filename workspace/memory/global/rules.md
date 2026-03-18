# Operating Rules

> Updated: 2026-02-20
> Retrieval tags: rules, guardrails, self-repair, memory, retrieval, confidence, provenance

## Retrieval and Accuracy

- [rule][confidence: high] Prioritize retrieval from structured memory files over long conversational digressions.
  - source: architecture directive 2026-02-20
  - captured: 2026-02-20
- [rule][confidence: high] Every durable memory item should carry source and confidence.
  - source: memory governance directive 2026-02-20
  - captured: 2026-02-20
- [rule][confidence: high] Keep unknowns explicit instead of hallucinating missing details.
  - source: repeated user directives 2026-02-19 and 2026-02-20
  - captured: 2026-02-20

## Self-Repair

- [rule][confidence: high] User dissatisfaction must trigger a self-repair loop (diagnose, patch, retest).
  - source: user directive 2026-02-20
  - captured: 2026-02-20
- [rule][confidence: high] "Read source code. Figure out the problem." is the default debugging posture.
  - source: user directive 2026-02-20
  - captured: 2026-02-20

## Safety

- [rule][confidence: high] Never store secrets (passwords, API keys, private tokens) in durable memory notes.
  - source: memory policy
  - captured: 2026-02-20

## Epistemic / Evidence Discipline

- [rule][confidence: high] If a competitor/site fetch fails, mark that snapshot **UNVERIFIED** and do not infer cause (no "site is down" / "blocked us").
  - context: Ghost Broker daily audit had a competitor fetch/snapshot fail; external review flagged hasty-generalization risk.
  - fix: log failure explicitly + attempt one alternate capture; otherwise record "snapshot incomplete".
  - source: Gemini external epistemic review 2026-03-17 PM
  - captured: 2026-03-17

## Windows / PowerShell Ops

- [rule][confidence: high] In Windows PowerShell, avoid chaining commands with `&&` or `||`; run as separate commands or use `;`.
  - context: `git add ... && git commit ...` and `cmd1 || cmd2` failed under the tool runner.
  - fix: split into multiple `exec` calls.
  - source: observed tool failures 2026-03-17 to 2026-03-18
  - captured: 2026-03-18

- [rule][confidence: high] Use correct object-property access in PowerShell: `$_.Path`, `$_.FullName`, not `.Path` / `.FullName`.
  - context: multiple `ForEach-Object { .Path }` / `{ .FullName }` failures in exec.
  - fix: always reference the pipeline object as `$_` inside scriptblocks.
  - source: observed tool failures 2026-03-18
  - captured: 2026-03-18

- [rule][confidence: high] Avoid complex PowerShell one-liners inside `exec`; prefer short scripts or Python for parsing/log processing.
  - context: quoting/parentheses issues caused repeat errors while appending multi-line markdown.
  - fix: do text writes with Python or file-based `.ps1` scripts.
  - source: observed tool failures 2026-03-18
  - captured: 2026-03-18

## Repo Hygiene

- [rule][confidence: medium] If a path is `.gitignore`'d, prefer moving docs/scripts into a tracked location rather than forcing `git add -f`.
  - context: Attempted to add `ghost-broker/plans/.../README.md` but it was ignored.
  - fix: keep "operating rules" in tracked `procedures/` or `memory/global/` unless intentionally ignored.
  - source: observed git add ignore behavior 2026-03-17
  - captured: 2026-03-17

## Process Reliability

- [rule][confidence: medium] Ensure a daily memory file exists before running scheduled reviews that depend on it.
  - context: evening epistemic review expected `memory/YYYY-MM-DD.md` but it didn’t exist initially.
  - fix: create the day file (even minimal notes) before running the review.
  - source: observed missing file 2026-03-17
  - captured: 2026-03-17
