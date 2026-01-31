# Active Thread - Last Updated 2026-01-31 04:55 EST

## Current State
**Session:** Ghost Broker Setup + Context Preservation
**Status:** Forms updated, waiting on deploy
**Francisco:** Just requested memory save before context compaction

## Key Context (PRESERVE THIS)

### Ghost Broker Brand Decision (CRITICAL)
- Francisco does NOT want to be the face of Ghost Broker
- Wants "Satoshi Nakamoto" mystique — anonymous, possibly AI
- Trust signals pivot to: Code (contracts), Vision (manifesto), Community (agents)
- **NO founder section needed** — brand is vision-first, not person-first
- Photo + LinkedIn is NO LONGER NEEDED

### Completed Tonight (01/31)
1. **Registration forms → Formsubmit.co** (no account needed)
   - `ghost-broker/website/register.html` — agent registration
   - `ghost-broker/website/hire.html` — client request
   - Both POST to `https://formsubmit.co/ghostbrokerai@proton.me`

2. **Stripe TEST Mode COMPLETE:**
   - Account: ghostbrokerai@proton.me (FKG Trading LLC)
   - Business: 14937 Indigo Lakes Dr, Naples FL 34119
   - Branding: Ghost logo + #9b87f5 accent
   - Product: AI Agent Service - $50 USD
   - Payment link: https://buy.stripe.com/test_aFaeV7dcRcyqab86MocZa00
   - Invoice system ready
   - Verification in progress (2-3 days for live)

3. **Moltbook Status:**
   - GhostBrokerAI verified, 1 post, 4 comments, 8+ subscriptions

## Waiting on Francisco:
1. **Deploy the forms:**
   ```
   cd ghost-broker/website && npx wrangler pages deploy . --project-name=ghostbrokerai
   ```
   (Or `npx wrangler login` first if not authenticated)

2. **After deploy:** Submit test registration → check Proton inbox → click Formsubmit confirmation link

3. **Wallet addresses** for crypto payments (T125 continuation)
   - Need testnet ETH for contract deployment
   - Deployer wallet: 0x1464Fe9Cd1377977953cc2c78256804cA3D0C96C

## Ghost Broker Asset Locations:
- Website: `ghost-broker/website/` (ready for deploy)
- Contracts: `ghost-broker/contracts/` (compiled, need ETH)
- Plans: `ghost-broker/plans/credibility-building.md`
- Credentials: `memory/ghostbrokerai-credentials.json`

## Key URLs:
- Website: https://ghostbrokerai.xyz
- Stripe: https://dashboard.stripe.com
- Proton: ghostbrokerai@proton.me
