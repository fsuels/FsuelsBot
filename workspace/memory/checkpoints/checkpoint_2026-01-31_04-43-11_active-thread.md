# Active Thread - Last Updated 2026-01-31 04:32 EST

## Current State
**Session:** Ghost Broker Form Setup
**Status:** Forms updated, need deploy
**Francisco:** Active conversation about credibility + email collection

## Just Completed (04:30 EST)
1. **Updated registration forms to Formsubmit.co** — no account needed
   - `register.html` — agent registration form
   - `hire.html` — client request form
   - Both now POST to `https://formsubmit.co/ghostbrokerai@proton.me`

2. **Credibility branding decision:**
   - Francisco does NOT want to be the face of Ghost Broker
   - Wants "Satoshi Nakamoto" mystique — anonymous, possibly AI
   - Trust signals pivot to: Code (contracts), Vision (manifesto), Community (agents)
   - No founder section — brand is vision-first, not person-first

## Waiting on Francisco:
1. **Deploy the form changes:**
   ```
   cd ghost-broker/website && npx wrangler pages deploy . --project-name=ghostbrokerai
   ```
   - Or `npx wrangler login` first if not authenticated

2. **After deploy:** Submit test registration → check Proton inbox → click Formsubmit confirmation link → done

3. **Wallet addresses for crypto payments** (from T125)
4. **Photo + LinkedIn** is NO LONGER NEEDED — brand is anonymous

## Ghost Broker Status:
- **Moltbook:** GhostBrokerAI verified, 1 post, 4 comments, 8+ subscriptions
- **Website:** ghostbrokerai.xyz live, forms need deploy for email capture
- **Contracts:** Compiled, wallet needs testnet ETH for deploy
- **Credibility plan:** `ghost-broker/plans/credibility-building.md`

## Key Files:
- `ghost-broker/website/register.html` — updated with Formsubmit
- `ghost-broker/website/hire.html` — updated with Formsubmit
- `memory/ghostbrokerai-credentials.json` — Moltbook API key
