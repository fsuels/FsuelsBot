# Task: Chrome profile test as default browser path

## Summary

Lock browser execution to Google Chrome profile **test** (directory: `Profile 1`) so all web work uses Francisco's saved authenticated sessions.

## Goal

For every browser task, open pages through Chrome profile **test** and keep this as a standing cross-session memory rule.

## Context

- Francisco wants internet access always done from his computer using the existing Chrome profile with saved logins.
- Using the wrong profile causes unnecessary login friction and failed access.

## Constraints

- Always use Google Chrome profile **test** (`--profile-directory="Profile 1"`).
- Assume full local computer access is available (terminal + browser + installed apps).
- Never claim complete without concrete receipt.

## Steps

1. Confirm objective and locked constraints. ✅
2. Execute: verify Chrome profile mapping and lock default rule. ✅
3. Verify and summarize with receipts. ✅

## Acceptance Criteria

- Card is complete (summary/goal/context/acceptance/handoff).
- At least one receipt proves profile mapping.
- Standing memory records Chrome profile test as default.

## Receipts

- `Local State` profile mapping verified: `Profile 1 => test`.
- Task/memory rule persisted in workspace task artifacts.

## Handoff

- **What is done:** Profile mapping verified and default behavior documented.
- **Next action:** Use Chrome profile **test** for all browser tasks unless Francisco overrides.
- **Blockers:** None.
