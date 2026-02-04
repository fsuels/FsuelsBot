# T221 Plan — One-command WhatsApp sender (Terminator)

## Goal
Create a fast, deterministic command to send a WhatsApp Desktop message via Terminator MCP.

## Scope
- WhatsApp Desktop (process: `WhatsApp.Root`)
- Contact selection via Search box + click first chat result
- Type into message composer (`Edit|Type to <Contact>`)
- Press Enter to send
- Verify the last outgoing message includes the exact text and shows Delivered/Read when available

## Non-goals
- Linking OpenClaw WhatsApp channel (QR) — separate pipeline
- Group messaging / attachments

## Steps
1. Implement `scripts/send-whatsapp.ps1` with parameters:
   - `-ContactName` (e.g. "Giselle Suels")
   - `-Message`
   - `-DryRun` (type but do not press Enter)
   - `-VerifyStatus` (Delivered/Read optional)
2. Add robust text sanitization (replace curly quotes, en-dash, etc.) to avoid JSON/Unicode serialization issues.
3. Use a minimal set of Terminator calls:
   - activate WhatsApp (optional)
   - type into Search input textbox
   - click first matching chat DataItem
   - type into `Edit|Type to <Contact>`
   - press Enter (unless DryRun)
   - get_window_tree and assert presence of "You <message>" line
4. Capture a final screenshot path as evidence.
5. Run a **DryRun test** against a safe chat to confirm speed and selector reliability.

## Success criteria
- Running the script completes in <5–8 seconds for already-open WhatsApp.
- Produces a final screenshot path showing the outgoing message (and Delivered/Read when available).
