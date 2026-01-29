---
version: "1.0"
created: "2026-01-29"
updated: "2026-01-29"
verified: "2026-01-29"
confidence: "high"
type: "procedure"
---

# Upsells & Cross-sells Procedure

## Verification Gate
Before implementing upsells:
- [ ] Product catalog organized by collections
- [ ] Product relationships mapped (complementary items)
- [ ] AOV baseline measured
- [ ] Upsell app installed (if using)
- [ ] Margin data available for bundle pricing

---

## Upsell Fundamentals

### Definitions

| Term | Definition | Example |
|------|------------|---------|
| **Upsell** | Upgrade to higher-value item | "Get the premium version for $20 more" |
| **Cross-sell** | Add complementary item | "Add matching scrunchie for $12" |
| **Bundle** | Multiple items at discount | "Mom + Child + Accessory = Save 20%" |
| **Order Bump** | Impulse add at checkout | "Add gift wrap for $5?" |
| **Post-Purchase Upsell** | Offer after checkout | "Add this to your order with 1 click" |

### Why It Matters
- 10-30% revenue lift with good upsell strategy
- Existing customers 50% more likely to try new products
- Cheaper than acquiring new customers
- Increases customer lifetime value

### The Math
```
Current AOV: $75
Target AOV: $95 (27% increase)
If 25% of orders take $25 upsell = $6.25 AOV lift
If 15% of orders take $40 bundle = $6.00 AOV lift
Combined: $87.25 AOV (16% increase)
```

---

## Upsell Placement Strategy

### 1. Product Page Cross-sells

**Location**
- Below product description
- In "Complete the Look" section
- "Customers Also Bought" section
- Sidebar (desktop)

**Best Practices**
- Show 3-4 complementary items
- Include quick add-to-cart
- Show savings if buying together
- Product images + names + prices

**For Mommy-and-Me**
```
COMPLETE THE LOOK
├── Matching Hair Bow ($12)
├── Coordinating Cardigan ($35)
├── Matching Mommy Scrunchie ($8)
└── Family Photo Prop Set ($18)
```

### 2. Cart Page Upsells

**Strategies**
- "Frequently Bought Together" bundle
- "Add for Free Shipping" suggestions
- "Don't Forget" accessories
- Size-appropriate add-ons

**Free Shipping Threshold**
```
Your cart: $65
Add $10 more for FREE SHIPPING!

RECOMMENDED:
[Matching Headband - $12] ← Quick Add
[Hair Bow Set - $15] ← Quick Add
```

### 3. Checkout Order Bumps

**What Works**
- Low-cost impulse items ($5-$20)
- Simple checkbox add
- Clear value proposition
- Complementary to cart contents

**Example**
```
□ Add Gift Wrapping ($6.99)
  Make it special! Premium gift box with ribbon.

□ Add Matching Hair Accessory Set ($14.99)  🔥 Popular
  The perfect finishing touch. 25% OFF bundle price.
```

### 4. Post-Purchase Upsells

**Timing**: Thank you page, before confirmation
**Why it works**: Purchase commitment already made, no checkout friction

**Structure**
```
WAIT! EXCLUSIVE OFFER FOR YOU

Add the matching [ITEM] to your order
One-click add - ships with your current order!

Regular: $35  YOUR PRICE: $24.50 (30% OFF)

[YES, ADD TO MY ORDER]
[No thanks, I'll pass]
```

**Best Practices**
- One-time offer creates urgency
- Significant discount (20-40% off)
- Related to what they just bought
- 10-15% conversion typical

### 5. Email Cross-sells

**Post-Purchase Follow-up**
- Day 3-5 after delivery
- "Complete Your Matching Set"
- "Other Moms Also Loved..."
- Personalized to purchase

---

## Bundle Strategy

### Bundle Types

| Type | Description | Discount |
|------|-------------|----------|
| **Fixed Bundle** | Pre-set items, fixed price | 15-25% off |
| **Mix-and-Match** | Choose items within category | 10-20% off |
| **Tiered Bundle** | Buy more, save more | Incremental |
| **Themed Bundle** | Occasion-based sets | 20-30% off |

### Bundle Examples for Mommy-and-Me

**Fixed Bundle**
```
THE MATCHING PHOTO SET
✓ Mommy Dress (any size)
✓ Daughter Dress (any size)
✓ Matching Headband Set
✓ Styling Guide PDF

Individual: $135
BUNDLE: $99 (Save $36!)
```

**Tiered Bundle**
```
FAMILY MATCHING DEAL
Buy 2 items: 10% OFF
Buy 3 items: 15% OFF
Buy 4+ items: 20% OFF
```

**Themed Bundle**
```
HOLIDAY MATCHING COLLECTION
Matching Holiday PJ Set
+ 2 Matching Ornaments
+ Holiday Photo Card Template

$89 (Save 25%)
```

### Bundle Pricing Strategy
- Calculate total retail value
- Discount 15-30% for bundle
- Ensure margin is still acceptable
- Show "You Save $X" prominently

---

## Implementation Steps

### Step 1: Map Product Relationships

Create a matrix of complementary products:

| If Customer Buys | Suggest |
|------------------|---------|
| Matching Dress | Hair accessories, cardigan |
| Pajama Set | Matching robe, slippers |
| Sweatshirt | Matching leggings, beanie |
| Any outfit | Gift wrap, styling guide |

### Step 2: Set Up Upsell App

**Shopify Apps**
- **Rebuy** ($99+/mo) - AI-powered, comprehensive
- **Bold Upsell** ($9.99/mo) - Simple, effective
- **Frequently Bought Together** ($9.99/mo) - Bundle focused
- **In Cart Upsell** ($19.99/mo) - Cart page upsells
- **Zipify OCU** ($35/mo) - Post-purchase funnels

### Step 3: Create Bundles
- Build bundle products in Shopify
- Set bundle pricing
- Create bundle-specific images
- Write bundle descriptions highlighting value

### Step 4: Configure Checkout Bumps
- Select impulse items (<$20)
- Write compelling bump copy
- Set up A/B testing for offers

### Step 5: Build Post-Purchase Funnel
- Select high-margin complementary products
- Set discount percentage (20-40%)
- Design simple offer page
- Test conversion and adjust

---

## Tools & Resources

### Upsell Apps
- **Rebuy** - Best for larger stores
- **Bold Upsell** - Budget-friendly
- **ReConvert** - Post-purchase focus
- **Zipify OCU** - One-click upsells
- **Honeycomb** - Various upsell types

### Analytics
- **Google Analytics** - Track bundle performance
- **Shopify Analytics** - AOV tracking
- **App analytics** - Upsell conversion rates

---

## KPIs to Track

### Primary Metrics
| Metric | Baseline | Target |
|--------|----------|--------|
| Average Order Value (AOV) | Current | +20-30% |
| Upsell conversion rate | - | 10-25% |
| Bundle attach rate | - | 15-25% |
| Revenue per visitor | Current | +15-25% |

### By Upsell Type
| Type | Good | Great |
|------|------|-------|
| Product page cross-sell | 5% | 10%+ |
| Cart upsell | 8% | 15%+ |
| Order bump | 10% | 20%+ |
| Post-purchase | 10% | 20%+ |

### Weekly Review
- AOV trend
- Top-performing upsell offers
- Bundle sales volume
- Revenue from upsells (total and %)

---

## Common Mistakes

### ❌ Avoid These

1. **Too many options** - 3-4 suggestions max
2. **Irrelevant suggestions** - Must complement purchase
3. **Aggressive popups** - Interrupting checkout flow
4. **Weak value proposition** - "You might also like" isn't compelling
5. **No discount incentive** - Why add now vs later?
6. **Hidden upsells** - Make them visible, not buried
7. **Same offers to everyone** - Personalize when possible
8. **Forgetting mobile** - Upsells must work on mobile
9. **Ignoring margins** - Don't discount below profitability
10. **No testing** - A/B test offers continuously

---

## Expert Tips ($10M Store Tactics)

### 🎯 Advanced Strategies

1. **The $7-15 Sweet Spot**
   - Order bumps in this range convert best
   - Low enough for impulse, high enough for margin
   - Examples: accessory, gift wrap, warranty

2. **Show "Others Bought Together"**
   - Social proof on cross-sells
   - "87% of customers also added..."
   - Data-driven suggestions

3. **Create Artificial Bundles**
   - Group items that photograph well together
   - "As seen in our lookbook"
   - Lifestyle-driven bundles

4. **Urgency on Post-Purchase**
   - "This offer expires in 10:00"
   - One-time offer messaging
   - Countdown timer

5. **Personalize Based on Cart**
   - If cart has child size 4T → show age-appropriate accessories
   - If cart over $100 → show premium add-ons
   - If cart below free ship → show items to hit threshold

6. **A/B Test Discount Levels**
   - 10% vs 15% vs 20% bundle discount
   - Find sweet spot of conversion vs margin
   - Different products have different price sensitivity

7. **The "Complete the Look" Photo**
   - Show all items together in one styled photo
   - Visual > description for fashion
   - Creates desire for full set

8. **Subscription Upsell**
   - "Get this monthly at 20% off"
   - For consumables or seasonal items
   - Builds recurring revenue

---

## Upsell Copy Templates

### Cart Upsell
```
COMPLETE YOUR MATCHING LOOK
Moms who bought [CART ITEM] also added:
[IMAGE] Matching Hair Bow - $12 [ADD]
Save 15% when you add any accessory!
```

### Order Bump
```
☑️ YES! Add Matching Scrunchie Set ($9.99)
Perfect for your matching photos! 
Regular price: $14.99 - SAVE 33%
```

### Post-Purchase
```
WAIT! EXCLUSIVE ONE-TIME OFFER

We thought you'd love this...
[IMAGE: Matching cardigan]

The perfect layering piece for your new matching outfit.
Ships with your current order!

~~$45.00~~ YOUR PRICE: $29.99

[ADD TO MY ORDER - JUST $29.99]
[No thanks, continue to confirmation]

⏰ This offer expires in 9:42
```

### Bundle Product Description
```
THE ULTIMATE MATCHING SET

Everything you need for picture-perfect twinning moments:

✓ Mom Dress (sizes XS-2XL)
✓ Mini Dress (sizes 12M-8Y)
✓ Matching Headband Set
✓ Digital Styling Guide

Individually: $145
YOUR PRICE: $109 (Save $36!)

🔥 Our most popular bundle - over 500 sold!
```

---

## Monthly Upsell Audit

```
□ Review AOV trend (improving?)
□ Check top-converting upsell offers
□ Identify underperforming offers to replace
□ Test new bundle combinations
□ Review post-purchase funnel conversion
□ Update seasonal upsells
□ Check mobile upsell experience
□ Analyze upsell revenue as % of total
```
