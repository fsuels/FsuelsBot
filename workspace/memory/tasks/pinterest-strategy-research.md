# Pinterest Marketing Strategy Research for DressLikeMommy

**Task ID:** pinterest-strategy-research
**Status:** IN_PROGRESS
**Priority:** Medium
**Project:** DressLikeMommy
**Created:** 2026-04-01

## Goal
DressLikeMommy Pinterest account fully optimized: verified merchant, 10-15 keyword-rich boards, proper 2:3 pin images, varied SEO descriptions, following niche accounts, video pins added.

## Current State
Account audited. 10 issues identified. Ready for execution phase.

**Account snapshot:** 848 followers, 10yr history (since Jan 2016), 275K total pins (mostly old catalog auto-sync), domain verified ✅, partner account ✅, NOT verified merchant ❌, only 6 boards, last pin March 31 2026.

## Key Audit Findings (from sub-agent research)
1. **Not following anyone** → need to follow 50-100 niche accounts
2. **Products on wrong boards** → Christmas sweaters on "Swimwear", Christmas PJs on "Easter Outfits"
3. **Images are 1:1 square** → Pinterest optimal is 2:3 vertical (1000x1500)
4. **Repetitive descriptions** → almost all start "Celebrate the love in your family..."
5. **Not verified merchant** → missing shopping features
6. **Only 6 boards** → need 10-15+ keyword-rich boards
7. **No video pins** visible
8. **Older pins missing Rich Pin data**
9. **Pin titles use "| DLM" suffix** → should use keywords instead
10. **Board descriptions too generic or mismatched**

**What's working:** Rich Pins active ✅, UTM tracking auto-added ✅, recent activity ✅, domain verified ✅, good profile bio ✅, "Free shipping" CTA in descriptions ✅

## Steps
1. ✅ Research: Spawn sub-agent to audit current Pinterest state + best practices
2. ✅ Review sub-agent findings — audit saved to `memory/global/dlm-pinterest-audit-2026-04-01.md`
3. ⬜ Apply for Pinterest Verified Merchant status
4. ⬜ Restructure boards: fix misplaced products, create 10-15 keyword-rich boards
5. ⬜ Fix pin image format: convert from 1:1 square to 2:3 vertical (1000x1500)
6. ⬜ Rewrite pin descriptions: varied copy, keyword-rich, no repetitive openers
7. ⬜ Follow 50-100 niche accounts for algorithm signals
8. ⬜ Create first video pin batch
9. ⬜ Present full plan to Francisco for approval

## Decisions
- 2026-04-01: Francisco approved Pinterest research at 04:30 EDT
- 2026-04-01: Sub-agent ran on Sonnet to keep main session context clean
- 2026-04-01: Audit completed — found 10 key issues (see above)
- 2026-04-01: Francisco flagged missing/empty task card — rebuilt with full context

## Open Questions
- Pinterest merchant verification — what's the application process and timeline?
- Image conversion strategy — regenerate from source or resize existing?
- Content calendar — how many pins/day to target?

## Key Files
- **Audit:** `memory/global/dlm-pinterest-audit-2026-04-01.md`
- **Procedure:** `procedures/marketing/pinterest.md`
- **Session notes:** `memory/2026-04-01-pinterest-session.md`

## Merchant Verification Precheck (Heartbeat slice 2026-04-05)
- ✅ Domain claimed in Pinterest (verified in account snapshot)
- ✅ Rich Pins active (verified in account snapshot)
- 🟨 Return/refund policy page reachable (HTTP 200); content completeness review still pending
- 🟨 Privacy policy + contact page reachable (HTTP 200); visibility/compliance review still pending
- ⬜ Shopify catalog feed diagnostics reviewed (pending check)
- ⬜ Business identity consistency (store/legal/contact) verified (pending check)

## Verified Merchant Application Draft (Heartbeat slice 2026-04-05)
- Business account: DressLikeMommy (active)
- Domain claimed: dresslikemommy.com ✅
- Rich Pins: enabled ✅
- Merchant status target: apply via Pinterest Merchant Verification workflow
- Required pre-submit checks still open:
  1. Return/refund policy page completeness
  2. Privacy policy + contact visibility
  3. Shopify catalog diagnostics status
  4. Business identity consistency (name/contact/legal)

## Merchant Verification Precheck Update (Heartbeat slice 2026-04-05 15:19 EDT)
- `https://dresslikemommy.com/policies/refund-policy` → HTTP 200 (redirects to `www`)
- `https://dresslikemommy.com/policies/privacy-policy` → HTTP 200 (redirects to `www`)
- `https://dresslikemommy.com/pages/contact` → HTTP 404 (**initial route check failed**)
- `https://dresslikemommy.com/collections/all?view=google-shopping` → HTTP 200

## Merchant Verification Precheck Update (Execution slice 2026-04-06 04:56 EDT)
- `https://dresslikemommy.com/pages/contact-us` → HTTP 200 (working contact page route)
- `https://www.dresslikemommy.com/pages/contact-us` → HTTP 200
- Business identity surface check (homepage/contact/privacy/refund):
  - Store branding consistent: "Dress Like Mommy" appears across pages
  - Contact email consistent: `info@dresslikemommy.com` found across key pages
- Result: previous contact-page blocker is cleared (route exists at `/pages/contact-us`)

## Next Action
Submit Pinterest Verified Merchant application using the verified contact route (`/pages/contact-us`), then capture and log the Pinterest submission receipt/status screenshot.
