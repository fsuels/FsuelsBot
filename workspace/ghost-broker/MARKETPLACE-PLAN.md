# GhostBrokerAI Marketplace - Build Plan

**Vision:** The invisible hand of the agent economy — connecting AI agents with human opportunities.

**Domain:** ghostbrokerai.xyz

---

## Phase 0: Foundation (Week 1)
*Define what we're building*

### T081 - Define MVP Scope
- [ ] List 3-5 core user stories (what can users DO?)
- [ ] Define user types: Agent Owners? Service Seekers? Both?
- [ ] Decide: Listing marketplace vs. Active matching vs. Auction
- [ ] Write 1-paragraph pitch for homepage
- **Output:** MVP-SCOPE.md

### T082 - Competitive Research
- [ ] Analyze 5 competitors (Fiverr for AI, agent directories, etc.)
- [ ] List their features, pricing models, UX patterns
- [ ] Identify gaps we can fill
- **Output:** COMPETITORS.md

### T083 - Choose Tech Stack
- [ ] Frontend: Next.js? Astro? Plain HTML?
- [ ] Backend: Supabase? Firebase? Custom?
- [ ] Hosting: Vercel? Netlify? GitHub Pages (free)?
- [ ] Payments: Stripe? Crypto? Manual?
- **Output:** TECH-STACK.md

---

## Phase 1: Landing Page (Week 2)
*Get something live fast*

### T084 - Design Landing Page
- [ ] Hero section with value prop
- [ ] "Coming Soon" email capture
- [ ] 3 feature highlights
- [ ] Social links (X, LinkedIn, GitHub, etc.)
- **Output:** Figma mockup or hand sketch

### T085 - Build Landing Page
- [ ] Set up repo in GitHub (GhostBrokerAI org)
- [ ] Build responsive landing page
- [ ] Add email capture (Mailchimp/ConvertKit/simple form)
- [ ] Deploy to ghostbrokerai.xyz
- **Output:** Live website

### T086 - Set Up DNS
- [ ] Point ghostbrokerai.xyz to hosting
- [ ] Configure SSL (free via host)
- [ ] Test all links work
- **Output:** Working domain

---

## Phase 2: Core Marketplace (Weeks 3-4)
*Basic listing functionality*

### T087 - Database Schema
- [ ] Users table (name, email, type, auth)
- [ ] Agents table (name, description, capabilities, pricing)
- [ ] Listings table (title, description, budget, status)
- [ ] Matches/Bids table
- **Output:** Schema diagram + migrations

### T088 - Auth System
- [ ] Sign up / Sign in
- [ ] Email verification
- [ ] Password reset
- [ ] OAuth (Google, GitHub optional)
- **Output:** Working auth

### T089 - Agent Profiles
- [ ] Create/edit agent profile
- [ ] List capabilities/skills
- [ ] Set pricing (hourly, per-task, custom)
- [ ] Upload avatar/banner
- **Output:** Agent profile pages

### T090 - Listing System
- [ ] Create new listing (what do you need?)
- [ ] Browse listings
- [ ] Filter by category, budget, urgency
- [ ] Search functionality
- **Output:** Listing CRUD

### T091 - Matching/Bidding
- [ ] Agents can bid on listings
- [ ] Listing owners can accept bids
- [ ] Simple messaging between parties
- **Output:** Basic matching flow

---

## Phase 3: Transactions (Week 5)
*Money flow*

### T092 - Payment Integration
- [ ] Stripe Connect for payouts
- [ ] Escrow system (hold funds until complete)
- [ ] Platform fee (5-15%?)
- **Output:** Working payments

### T093 - Reviews & Ratings
- [ ] Rate completed transactions
- [ ] Display ratings on profiles
- [ ] Build trust signals
- **Output:** Review system

---

## Phase 4: Growth (Ongoing)
*Scale up*

### T094 - SEO Optimization
- [ ] Meta tags, OpenGraph
- [ ] Blog/content section
- [ ] Sitemap, robots.txt

### T095 - Marketing Automation
- [ ] Email sequences for signups
- [ ] Social proof notifications
- [ ] Referral program

### T096 - API for Agents
- [ ] REST API for agent integrations
- [ ] Webhook notifications
- [ ] SDK/documentation

---

## Quick Wins (Can Start Now)

| Task | Effort | Impact |
|------|--------|--------|
| T084 Landing page design | 2hr | High - gets us live |
| T081 MVP scope | 1hr | High - clarity |
| T082 Competitor research | 2hr | Medium - insights |

---

## Questions for Francisco

1. **What's the revenue model?**
   - Commission per transaction (%)
   - Subscription for agents
   - Free listings, paid promotion
   - Freemium?

2. **Who's the first target user?**
   - AI agent builders looking for clients
   - Businesses looking for AI solutions
   - Both (two-sided marketplace)

3. **MVP timeline?**
   - Landing page only (1 week)
   - Full marketplace (4-6 weeks)

4. **Budget for tools?**
   - $0 (all free tier)
   - Some paid tools OK

---

## Recommended Start

**This week:**
1. T081 - Define MVP scope (Council this?)
2. T084 - Design landing page
3. T085 - Build & deploy landing page

**Get live in 7 days with email capture, then iterate.**
