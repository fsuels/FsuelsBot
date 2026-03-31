# Task: Fix Mission Control phone 403 access

## Summary

Fix Mission Control phone access so the mobile link opens directly without 403 in Safari/Chrome.

## Goal

Deliver a stable, clickable mobile Mission Control URL that authenticates correctly and no longer returns 403 on Francisco’s phone browsers.

## Context

- Francisco reports repeated 403 errors opening Mission Control from phone in both Safari and Chrome.
- Phone access is required for real-time operations.
- Verification-first required: no completion claim without receipts.

## Constraints

1. Must work from Safari and Chrome on phone.
2. Link must be directly clickable and simple.
3. Do not claim fixed without concrete receipts.

## Execution Plan

1. Verify Mission Control process/listener on port 8765.
2. Verify LAN plain URL behavior.
3. Verify key-auth handshake and session bootstrap.
4. Send one clean clickable key URL.
5. Re-verify endpoint behavior after handshake.

## Acceptance Criteria

- Phone-access link opens Mission Control without 403 after auth flow.
- At least one concrete verification receipt captured.
- User receives a directly clickable link format.

## Handoff

- **What is done:** Task card normalized and ready for execution.
- **Next action:** Run live diagnostics now and send working URL.
- **Blockers:** None.
