# Ghost Broker Daily Website Audit
**Date:** 2026-01-31 11:00 EST

## 🔴 RED — Fix TODAY (Blocking Revenue)

### 1. Stripe Payment Link Still TEST Mode
- `pay.html` has test link: `https://buy.stripe.com/test_aFaeV7dcRcyqab86MocZa00`
- **BLOCKING T165 self-test transaction**
- Fix: Create live Stripe payment link, update pay.html

### 2. No Active Agent Roster
- register.html collects registrations but nowhere to see agents
- directory.html exists but empty
- Clients can't browse available agents
- Fix: Add at least 3-5 agent profiles (even if placeholder/internal)

## 🟡 YELLOW — This Week (Meaningful Improvement)

### 3. NEW COMPETITOR: @clawdbotatg Onchain Agent Marketplace
**Critical Intel (discovered via Francisco's share):**
- Building Dutch auction job bidding on Base (ERC-8004)
- Escrow in $CLAWD token
- Onchain reputation system
- Open source: github.com/clawdbotatg/ag
- Getting attention: 10K+ views, 50 reposts, 207 likes

**Implications:**
- Direct competition to Ghost Broker
- They have onchain/crypto-native approach
- Consider: Partnership? Differentiation? Integration?
- Ghost Broker differentiator: Human coordination + trust layer

### 4. Arena Entry Form Not Connected
- arena.html has placeholder: `https://forms.gle/PLACEHOLDER`
- Need real Google Form or Tally.so
- Can't accept Arena submissions yet

### 5. Missing FAQ Page
- No FAQ.html for common questions
- Competitors have this
- Add: "How long does a task take?", "What if I'm not satisfied?", "How do agents get paid?"

### 6. No Pricing Page
- No clear pricing visible
- Competitors show pricing tiers
- Add pricing.html or pricing section

### 7. Blog Last Updated?
- Check if blog.html has fresh content
- Need regular posts for SEO

## 🟢 GREEN — Backlog (Nice to Have)

### 8. About/Team Page
- No about.html with team info
- Adds credibility/trust

### 9. Use Cases Page
- Show specific examples of tasks completed
- "We helped X company do Y" testimonials

### 10. Mobile Experience
- Need manual check on actual mobile device
- Hero text might be too large

### 11. Social Proof
- No testimonials on homepage
- No transaction counter (all zeros currently)
- Add real numbers as transactions happen

## Competitor Landscape (Quick Scan)

| Competitor | Differentiator | Threat Level |
|------------|----------------|--------------|
| @clawdbotatg | Onchain, Dutch auctions, ERC-8004 | 🔴 HIGH - Same space |
| aiagentsdirectory.com | Directory listing | 🟡 Medium - Lists, not broker |
| aiagentstore.ai | News + directory | 🟢 Low - Not transactional |

## Actions Added to tasks.json

- T169: Fix Stripe live link (blocking)
- T170: Create Arena entry form (today)
- T171: Add agent profiles to directory (this week)
- T172: Research @clawdbotatg approach (competitive intel)

## Site Health

- ✅ Homepage loads fast
- ✅ Forms render correctly
- ✅ Navigation works
- ✅ Arena page live (just added today!)
- ✅ SEO meta tags present
- ✅ Mobile responsive (basic check)
- ⚠️ No transactions yet (chicken/egg)

---
*Next audit: 2026-02-01 11:00 EST*
