---
version: "1.0"
created: "2026-04-03"
updated: "2026-04-03"
verified: "2026-04-03"
confidence: "high"
type: "procedure"
---

# DressLikeMommy Pinterest Pin Operating System

## Goal

Turn a minimal Obsidian queue note into a deterministic Pinterest publish packet with as little active context as possible.

## Folder Split

- Obsidian queue and strategy live in:
  `/Users/fsuels/Library/Mobile Documents/iCloud~md~obsidian/Documents/Fsuels Notes/Pinterest`
- Machine config, scripts, and generated packets live in:
  `workspace/pinterest/`, `workspace/pinterest-jobs/`, and `scripts/pinterest/`

## Commands

Normalize a queue note into a job packet:

```bash
node --import tsx scripts/pinterest/build-pin-job.ts \
  --queue-note "/absolute/path/to/queue-note.md"
```

Render the Pinterest-ready vertical image:

```bash
node --import tsx scripts/pinterest/render-pin-image.ts \
  --job "/absolute/path/to/workspace/pinterest-jobs/<job-slug>/packet.json"
```

Drain the live queue sequentially with minimal active context:

```bash
pnpm pinterest:run-queue
```

Optional filters:

```bash
pnpm pinterest:run-queue -- --limit 1
pnpm pinterest:run-queue -- --note "Tropical Print"
pnpm pinterest:run-queue -- --dry-run
```

## Batch Queue Behavior

- notes in `Queue/Working` are resumed first
- notes in the queue root are moved into `Queue/Working` before processing
- each note is handled as its own build -> render -> publish transaction
- successful publishes are moved into `Queue/Done`
- failures are left with a `publish-error.md` artifact and moved into `Queue/Needs Review`

This keeps runtime context local to one note at a time instead of carrying the whole queue in memory.

## Active Context Rule

Every browser run should operate from the generated `agent-prompt.md`, not from the full queue clipping.

The prompt must tell the agent:

1. the current step
2. what screen should be visible
3. which tools are relevant now

## Organic Publish Gates

The publish step is valid only when all of these are true:

- the browser is on Pinterest `Pin Builder`
- `Ad-only Pin` is turned off
- the prepared `pin-image.jpg` is uploaded
- the exact board is selected
- the exact destination URL is filled
- the description is present and not blank
- alt text is filled
- the matching catalog product is tagged when available

If any gate fails, stop and fix it before publish.

## Safety Rule

If board routing is ambiguous or the correct board does not exist, the job must stop and move to review.
