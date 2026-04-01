# DLM Plan Sync — 2026-03-31

Source: Francisco shared "DRESS LIKE MOMMY — Master Implementation Plan (v2 — CORRECTED)" dated 2026-03-27.

## Canonical architecture decisions

1. Google & YouTube app is the sole supported Google-tag deployment path on Shopify.
2. GTM is dormant for Google tags; non-Google only.
3. Exactly one Primary Google Ads purchase conversion.
4. No ad launch until measurement + feed fixes are green.
5. Merchant Center policies must match site/operations.
6. add_shipping_info is optional/advanced (Phase 7), treated cautiously.

## Reported completed items (as of 2026-03-28 in plan)

- Task 1.2 complete: conversion cleanup; 1 primary purchase action; auto-tagging ON; enhanced conversions ON; attribution set to data-driven.
- Task 1.3 complete: Shopify native consent banner + Consent Mode v2 already present for EU regions.
- Task 2.1 complete: Merchant Center brand feed rule forces "Dress Like Mommy".
- Task 2.2 investigated: unavailable pages largely from archived Shopify products + stale Content API feed; requires Shopify channel resync/reconnect.
- Task 2.4 complete: accepted 33 maternity-related policy flags as acceptable.
- Task 2.5 complete/informational: duplicate shipping policies caused by dual Shopify profiles; low priority.
- Task 2.6 data build complete: supplemental feed prepared for 5,162 variants; manual Google Sheets import still pending.
- Task 3.4 complete: GA4 audiences rebuilt.
- Task 3.5 complete: direct traffic inflation mainly bot traffic (SG/CN).
- Task 3.6 complete: tracked GA4 orders match exactly, but only ~40% of Shopify purchases tracked.
- Phase 4 strategic decision: skip GTM consolidation; keep Shopify app pixels.
- Phase 5 campaign specs complete: launch assets/docs ready; 3 new paused campaigns planned.

## Current launch-gate blockers still open

- Manual upload/connection of supplemental feed in Merchant Center (Task 2.6 final step).
- Verify apparel attributes coverage reaches launch threshold (80%+ required in gates; target 95%+ at 90 days).
- Resolve stale Shopify→Merchant Center Content API sync for archived product artifacts.
- Ads launch checklist final pass and enablement (Phase 5.5).

## Files mentioned by Francisco as already created

- Google-Ads-Campaign-Setup-Guide.md
- negative-keywords.txt
- negative-keywords-import.txt

## Notes

- Plan marks many core diagnostics and architecture corrections as complete.
- Highest-value next action is finishing feed synchronization + supplemental feed activation, then launch-gate verification.
