# Paid Advertising Procedure

## Verification Gate
Before running any paid ads:
- [ ] Pixel/tracking installed and verified on all platforms
- [ ] Conversion events firing correctly
- [ ] Product feed synced and approved
- [ ] Creative assets prepared (images, videos, copy)
- [ ] Budget approved and allocated
- [ ] UTM parameters configured

---

## Platform Priority Order

For mommy-and-me e-commerce:

| Priority | Platform | Why | Budget % |
|----------|----------|-----|----------|
| 1 | Meta (Facebook/Instagram) | Visual, targeting, scale | 50-60% |
| 2 | Pinterest | High purchase intent, visual discovery | 20-30% |
| 3 | Google Shopping | Bottom-funnel capture | 15-20% |
| 4 | TikTok | Testing, viral potential | 5-10% |

---

## Meta Ads (Facebook/Instagram)

### Account Structure

```
Campaign Level: Objective (Sales, Traffic, etc.)
├── Ad Set 1: Prospecting - Interest Targeting
├── Ad Set 2: Prospecting - Lookalikes
├── Ad Set 3: Retargeting - Website Visitors
├── Ad Set 4: Retargeting - Cart Abandoners
└── Ad Set 5: Retention - Past Customers
```

### Campaign Setup Process

1. **Define Objective**
   - Awareness: Brand building (rarely for small stores)
   - Traffic: Testing creative, building pixel data
   - Sales: Primary objective once pixel has data

2. **Budget Setting**
   - Start: $20-50/day per campaign
   - Scale: Increase 20% every 3 days if profitable
   - Never increase more than 20%/day

3. **Audience Building**

   **Cold Audiences (Prospecting)**
   - Interest targeting: Parenting, motherhood, family photography
   - Behavior: Online shoppers, engaged shoppers
   - Lookalikes: 1% of customers, 1% of purchasers, 1% of engaged visitors

   **Warm Audiences (Retargeting)**
   - Website visitors (7, 14, 30, 60 days)
   - Product viewers
   - Add to cart (no purchase)
   - Checkout initiated (no purchase)
   - Past purchasers (exclude from prospecting)

4. **Creative Best Practices**

   **Image Ads**
   - Lifestyle shots > Product only
   - Show mom AND child matching
   - Natural lighting, real moments
   - Clear product visibility
   - Multiple angles in carousel

   **Video Ads**
   - 15-30 seconds optimal
   - Hook in first 3 seconds
   - Show product being worn/used
   - Include social proof
   - End with clear CTA

   **Copy Framework**
   ```
   Hook: Problem or desire statement
   Bridge: How product solves it
   Social Proof: Reviews, numbers
   Offer: Discount, free shipping
   CTA: Shop now, limited time
   ```

5. **Testing Protocol**
   - Test ONE variable at a time
   - Creative test: Same audience, different creatives
   - Audience test: Same creative, different audiences
   - Run for 3-7 days or until 1000+ impressions
   - Winner = lowest CPA or highest ROAS

### Metrics & Benchmarks

| Metric | Good | Great | Action Needed |
|--------|------|-------|---------------|
| CTR | >1% | >2% | Change creative |
| CPC | <$1 | <$0.50 | Improve targeting |
| CPM | <$15 | <$10 | Audience too small |
| ROAS | >2x | >3x | Scale up |
| Conversion Rate | >1% | >2% | Fix landing page |

---

## Pinterest Ads

### Why Pinterest for Mommy-and-Me
- 85% of users use Pinterest to plan purchases
- High intent audience (planning events, seasons)
- Visual product = perfect fit
- Lower CPCs than Meta in many cases

### Campaign Types

1. **Awareness** - Build presence, cheap impressions
2. **Consideration** - Traffic to site
3. **Conversions** - Optimize for purchases (requires pixel data)
4. **Catalog Sales** - Shopping ads from product feed

### Setup Process

1. **Claim Website** - Verify domain for analytics
2. **Install Pinterest Tag** - Track conversions
3. **Sync Product Catalog** - Shopify app handles this
4. **Create Shopping Campaigns** - Auto-generate from catalog

### Targeting Options

**Keywords** (Most Important)
- "mommy and me outfits"
- "matching family clothes"
- "mother daughter dresses"
- "family photo outfits"
- Seasonal: "Christmas matching pajamas"

**Interests**
- Family and parenting
- Women's fashion
- Kids fashion
- Photography

**Audiences**
- Website retargeting
- Customer list upload
- Engagement audiences (pinners who engaged with your content)
- Actalike audiences (Pinterest's lookalikes)

### Creative Best Practices

- **2:3 aspect ratio** (1000 x 1500 px)
- **Text overlay** with product name/price
- **Lifestyle imagery** over flat lays
- **Video Pins** get 6x more engagement
- **Idea Pins** for organic reach → convert to ads

### Metrics & Benchmarks

| Metric | Good | Great |
|--------|------|-------|
| CTR | >0.5% | >1% |
| CPC | <$0.50 | <$0.30 |
| ROAS | >3x | >5x |
| Save Rate | >2% | >5% |

---

## Google Ads

### Campaign Types for E-commerce

1. **Shopping Campaigns** (Priority)
   - Standard Shopping: Manual bidding, control
   - Performance Max: AI-driven, less control, often better results
   
2. **Search Campaigns** (Secondary)
   - Brand terms (protect brand)
   - Non-brand terms (expensive, test carefully)

3. **Display/YouTube** (Retargeting only)
   - Dynamic remarketing
   - Video remarketing

### Google Merchant Center Setup

1. **Verify website ownership**
2. **Connect Shopify feed** (automatic sync)
3. **Fix disapprovals immediately**
   - Common issues: Missing GTIN, price mismatch, policy violations
4. **Optimize titles and descriptions** (see product-listing.md)

### Shopping Campaign Structure

```
Campaign: Mommy and Me - Shopping
├── Product Group: Dresses
├── Product Group: Pajamas
├── Product Group: Sweatshirts
└── Product Group: Accessories
```

### Performance Max Tips

- Start with $50-100/day
- Run 4-6 weeks before judging
- Upload strong creative assets
- Use audience signals (customer lists, website visitors)
- Monitor Search Terms report for wasted spend

### Metrics & Benchmarks

| Metric | Good | Great |
|--------|------|-------|
| ROAS | >3x | >5x |
| Conversion Rate | >2% | >4% |
| Impression Share | >30% | >60% |
| Click Share | >15% | >40% |

---

## TikTok Ads

### When to Use TikTok
- Testing creative concepts cheaply
- Reaching younger demographics
- Potential for viral content
- Lower CPMs than Meta

### Campaign Setup

1. **Install TikTok Pixel**
2. **Connect product catalog**
3. **Start with Spark Ads** (boost organic content)
4. **Test In-Feed Ads** with top performers

### Creative Rules

- **Native feel** - Don't look like an ad
- **Hook in 1 second** - Scroll speed is fast
- **Trending sounds** - Use what's popular
- **UGC style** - Performed better than polished
- **Text hooks** - "POV: You match with your mini"

### Metrics & Benchmarks

| Metric | Good | Great |
|--------|------|-------|
| CTR | >0.8% | >1.5% |
| CPM | <$8 | <$5 |
| CPC | <$0.80 | <$0.50 |
| CVR | >1% | >2% |

---

## Tools & Resources

### Ad Management
- **Meta Business Suite** - FB/IG ads
- **Pinterest Business Hub** - Pinterest ads
- **Google Ads** - Search & Shopping
- **TikTok Ads Manager** - TikTok

### Creative Tools
- **Canva** - Static ads
- **CapCut** - Video ads
- **AdCreative.ai** - AI-generated creatives
- **Motion** - Ad analytics & creative testing

### Analytics & Attribution
- **Triple Whale** ($129+/mo) - Multi-touch attribution
- **Northbeam** ($400+/mo) - Advanced attribution
- **Google Analytics 4** - Free, basic tracking

---

## KPIs to Track

### Daily Checks
- Spend vs budget
- CPA/ROAS by campaign
- Any disapprovals or issues

### Weekly Review
| Metric | Target | Action if Miss |
|--------|--------|----------------|
| Blended ROAS | >2.5x | Pause underperformers |
| CPA | <$30 | Test new creative |
| CVR | >1.5% | Fix landing page |
| Spend Efficiency | >90% budget | Increase budgets |

### Monthly Review
- Channel mix optimization
- Creative performance trends
- Audience fatigue signals
- Competitor analysis

---

## Common Mistakes

### ❌ Avoid These

1. **Starting too broad** - Narrow audiences first, expand later
2. **Changing too fast** - Give campaigns 3-7 days to learn
3. **Ignoring creative fatigue** - Refresh every 2-4 weeks
4. **No exclusions** - Always exclude past purchasers from prospecting
5. **One creative forever** - Test 3-5 variations always
6. **Wrong attribution** - Platform attribution ≠ real attribution
7. **Scaling too fast** - 20% max increase per day
8. **Ignoring landing pages** - Ads get clicks, pages get conversions
9. **No retargeting** - Warmest audience, highest ROI
10. **Budget too thin** - $5/day doesn't give data

---

## Expert Tips ($10M Store Tactics)

### 🎯 Advanced Strategies

1. **Creative Velocity**
   - $10M stores test 50-100 creatives/month
   - Build a creative testing system
   - Winners get scaled, losers get cut fast

2. **First-Party Data is King**
   - Build email list → upload as custom audiences
   - 1% lookalike of high-LTV customers = gold
   - Retarget email openers with ads

3. **Full-Funnel Approach**
   - Top: Awareness (video views, engagement)
   - Middle: Consideration (traffic, content)
   - Bottom: Conversion (catalog sales, retargeting)

4. **Dynamic Creative**
   - Let platform optimize combinations
   - Test 5 images, 5 headlines, 5 descriptions
   - Platform finds winning combos

5. **Dayparting**
   - Analyze when conversions happen
   - Increase bids during high-converting hours
   - Decrease during low periods

6. **Seasonal Planning**
   - Plan campaigns 6-8 weeks ahead
   - Increase budgets before peak (not during)
   - CPMs spike during holidays

7. **The 50% Rule**
   - 50% budget to proven winners
   - 30% to optimization
   - 20% to new tests

8. **Landing Page Matching**
   - Ad shows blue dress → land on blue dress page
   - Don't send to homepage
   - Create custom landing pages for campaigns

---

## Weekly Ad Management Checklist

```
Monday:
□ Review weekend performance
□ Pause any underperformers
□ Check for disapprovals
□ Budget pacing check

Wednesday:
□ Review week-to-date metrics
□ Adjust bids if needed
□ Check creative fatigue
□ Launch new tests

Friday:
□ Prepare weekend campaigns
□ Increase retargeting for weekend
□ Set up any flash sale ads
□ Weekly performance report
```

---

## Emergency Playbook

### If ROAS crashes:
1. Don't panic - check attribution window
2. Check if there was a site issue (checkout broken?)
3. Pause lowest performers first
4. Increase retargeting (warm = cheaper)
5. Check competitor activity

### If account gets restricted:
1. Read policy violation carefully
2. Fix the issue (usually creative or landing page)
3. Submit appeal with documentation
4. Don't create new accounts (ban risk)
5. Have backup payment methods ready
