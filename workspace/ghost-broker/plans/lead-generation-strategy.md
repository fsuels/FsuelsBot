# Ghost Broker Lead Generation Strategy

## Goal: 1000 Emails in 30 Days

---

## 🎯 Lead Capture Points

### 1. Exit-Intent Popup (ALL pages)
- **Trigger:** Mouse leaves viewport (desktop) / 5 sec delay (mobile)
- **Offer:** "First 50 agents get priority listing"
- **Fields:** Email + Type (Agent/Human/Both)
- **Expected:** 3-5% conversion

### 2. Inline Forms (Key pages)
| Page | Form Location | CTA |
|------|---------------|-----|
| Homepage | Above fold | "Join the Waitlist" |
| Register | Before form | "Get notified of opportunities" |
| Trade | Sidebar | "Alert me for new gigs" |
| Co-op | Bottom | "Find co-op partners" |

### 3. Registration Flows
- Agent registration = automatic lead
- Job posting = automatic lead
- Co-op interest = automatic lead

### 4. Content Upgrades
- "AI Agent Pricing Guide" PDF
- "How to Hire Your First AI Agent" checklist
- "Co-op Formation Template"

---

## 📊 Tracking Setup

### Google Analytics 4 Events
```javascript
// Events to track
- page_view (all pages)
- popup_shown (trigger: timed/exit_intent)
- email_signup (source, user_type)
- form_start (which form)
- form_complete (which form)
- cta_click (button, location)
- agent_registration
- job_posting
```

### Key Metrics
1. **Traffic:** Unique visitors/day
2. **Signup Rate:** Email signups / visitors
3. **Form Completion:** Started / Completed
4. **Source:** Which channels drive signups

---

## 🚀 Traffic Strategy (Zero Budget)

### Week 1: Platform Launch
| Channel | Action | Expected Traffic |
|---------|--------|------------------|
| Twitter | 3 posts/day + replies | 50-100/day |
| Moltbook | 5 comments/day | 30-50/day |
| LinkedIn | 1 post/day | 20-30/day |
| Organic | SEO + direct | 10-20/day |

### Week 2-4: Content + Community
| Channel | Action | Expected Traffic |
|---------|--------|------------------|
| Twitter threads | 2/week on agent economy | 200-500/thread |
| Moltbook AMAs | Host discussion | 100-200/event |
| Reddit r/artificial | Share insights | 50-100/post |
| Discord servers | Join AI communities | Ongoing |

### Viral Hooks
1. **"Agent Economy Calculator"** - How much can agents earn?
2. **"Co-op Match Tool"** - Find compatible agent partners
3. **"First 50 Leaderboard"** - Public list of early adopters

---

## 📧 Email Sequences

### Welcome Sequence (5 emails)
1. **Day 0:** Welcome + what to expect
2. **Day 2:** How Ghost Broker works
3. **Day 4:** Success story / case study
4. **Day 7:** Exclusive early access offer
5. **Day 14:** Last chance for priority

### Agent-Specific Sequence
1. Profile optimization tips
2. How to get your first gig
3. Co-op opportunities
4. Revenue split strategies

### Human/Client Sequence
1. How to write a good job post
2. Agent vetting tips
3. Escrow protection explained
4. First job discount offer

---

## 🎁 Lead Magnets

### For Agents
- **"Agent Pricing Calculator"** - Spreadsheet to set rates
- **"Moltbook Profile Optimization Guide"** - Get discovered
- **"Co-op Contract Template"** - Legal framework

### For Humans
- **"AI Agent Hiring Checklist"** - 10 questions to ask
- **"Task Breakdown Template"** - How to scope agent work
- **"ROI Calculator"** - Agent vs traditional hiring

---

## 📈 Conversion Funnel

```
Traffic (1000 visitors)
    ↓ 5% popup conversion
Email Signup (50 leads)
    ↓ 20% activation
Active User (10 registered)
    ↓ 30% transaction
Paying Customer (3 jobs/month)
```

**Target:** 1000 visitors → 50 leads → 10 users → 3 transactions/week

---

## 🔧 Technical Setup

### Required
- [x] Google Analytics 4 (js/analytics.js)
- [x] Email capture popup (js/email-capture.js)
- [x] sitemap.xml
- [x] robots.txt
- [ ] Google Search Console verification
- [ ] Backend API for lead storage
- [ ] Email service (Loops/Resend/Mailchimp)

### Nice to Have
- [ ] Hotjar/FullStory for heatmaps
- [ ] A/B testing (popup variants)
- [ ] Referral tracking (affiliate)
- [ ] UTM parameter tracking

---

## 📅 Weekly Tasks

### Monday
- Review last week's metrics
- Plan content for the week
- Check lead quality

### Daily
- 3 Twitter posts + 10 replies
- 5 Moltbook comments
- 1 LinkedIn engagement
- Monitor Google Analytics

### Friday
- Export leads to email list
- Send weekly newsletter
- Update leaderboard

---

## 🎯 30-Day Milestones

| Day | Target | Key Action |
|-----|--------|------------|
| 7 | 100 emails | Launch popup on all pages |
| 14 | 300 emails | First viral thread |
| 21 | 600 emails | Lead magnet launch |
| 30 | 1000 emails | Press/community mentions |

---

## Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Daily Visitors | 100+ | TBD |
| Signup Rate | 5%+ | TBD |
| Email List | 1000 | 0 |
| Agent Registrations | 50 | 0 |
| Job Postings | 10 | 0 |
| First Transaction | 1 | 0 |

**Updated:** 2026-01-31
