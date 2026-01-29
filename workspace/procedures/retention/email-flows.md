# Email Automation Flows Procedure

## Verification Gate
Before setting up flows:
- [ ] ESP (Klaviyo/Omnisend) connected to Shopify
- [ ] Transactional emails working (order confirmation)
- [ ] Email templates match brand
- [ ] Sender reputation healthy
- [ ] Unsubscribe process compliant

---

## Flow Overview

### Revenue Attribution Target
Email flows should generate **15-25% of total revenue**

| Flow | Revenue Priority | Setup Priority |
|------|-----------------|----------------|
| Abandoned Cart | #1 | Must have |
| Welcome Series | #2 | Must have |
| Browse Abandonment | #3 | High |
| Post-Purchase | #4 | Must have |
| Win-Back | #5 | High |
| VIP / Birthday | #6 | Medium |

---

## Flow 1: Welcome Series (Most Important)

### Purpose
Convert new subscribers into first-time customers

### Trigger
New subscriber (popup, footer, checkout opt-in)

### Sequence

| Email | Timing | Subject Line | Content | CTA |
|-------|--------|--------------|---------|-----|
| 1 | Immediate | "Welcome! Here's your 15% off 💕" | Welcome + discount code + brand story | Shop now |
| 2 | Day 2 | "Our customers' favorites" | Bestsellers + reviews | Shop bestsellers |
| 3 | Day 4 | "How to match like a pro" | Styling tips + value | Read guide |
| 4 | Day 6 | "Your 15% off expires soon ⏰" | Discount reminder + products | Use code now |
| 5 | Day 8 | "Last chance for 15% off" | Final reminder + urgency | Don't miss out |

### Key Elements
- **Email 1**: Deliver discount immediately, build brand connection
- **Email 2**: Social proof, show what's popular
- **Email 3**: Provide value, reduce selling pressure
- **Email 4**: Create urgency, remind of offer
- **Email 5**: Final push, fear of missing out

### Exit Conditions
- Remove from flow if: Makes a purchase
- Continue flow if: No purchase by end

### Expected Results
- Open rate: 40-60% (Email 1), declining to 25-35%
- Click rate: 5-10%
- Conversion: 5-10% of subscribers purchase within 10 days

---

## Flow 2: Abandoned Cart (Revenue Driver)

### Purpose
Recover lost sales from shoppers who added to cart but didn't buy

### Trigger
Cart created → No purchase within 1 hour

### Sequence

| Email | Timing | Subject Line | Content | Offer |
|-------|--------|--------------|---------|-------|
| 1 | 1 hour | "Did you forget something?" | Cart contents + simple reminder | None |
| 2 | 24 hours | "Still thinking about it?" | Social proof + FAQs | None |
| 3 | 48 hours | "Here's 10% off to help you decide" | Discount code + urgency | 10% off |
| 4 | 72 hours | "Last chance: Your cart is expiring" | Final push + discount | 10% off |

### Email Content Details

**Email 1 (1 hour)**
```
Subject: Did you forget something? 🛒

Hey [Name],

You left some adorable matching outfits in your cart!

[CART CONTENTS WITH IMAGES]

Ready to complete your order?

[RETURN TO CART]

Need help? Reply to this email anytime!
```

**Email 2 (24 hours)**
```
Subject: Your mini-me is waiting! 💕

Still thinking about those matching outfits?

Here's what other moms are saying:
⭐⭐⭐⭐⭐ "Best quality! My daughter loves matching with me"

Common questions:
• Free returns within 30 days
• Ships in 1-2 business days
• True to size (check our size guide)

[COMPLETE YOUR ORDER]
```

**Email 3 (48 hours)**
```
Subject: Here's 10% off your cart 🎁

We get it - matching outfits are a commitment!

Here's 10% off to make the decision easier:
Code: COMEBACK10

[CART CONTENTS]

[USE MY 10% OFF]

Code expires in 48 hours.
```

**Email 4 (72 hours)**
```
Subject: ⚠️ Your cart is about to expire

Last chance!

Your cart (and 10% discount) expire tonight.

[CART CONTENTS]

Code: COMEBACK10 (expires midnight)

[COMPLETE ORDER - SAVE 10%]
```

### Expected Results
- Recovery rate: 10-15% of abandoned carts
- Email 3 (with discount) typically performs best

---

## Flow 3: Browse Abandonment

### Purpose
Re-engage visitors who viewed products but didn't add to cart

### Trigger
Viewed product → No cart add → 2+ hours elapsed

### Sequence

| Email | Timing | Subject Line | Content |
|-------|--------|--------------|---------|
| 1 | 2-4 hours | "Still looking for the perfect match?" | Viewed products + related items |
| 2 | 24 hours | "These are going fast 👀" | Viewed products + bestsellers |

### Expected Results
- Lower conversion than cart abandonment
- Good for warming up potential customers
- 2-5% conversion typical

---

## Flow 4: Post-Purchase Series

### Purpose
Turn one-time buyers into repeat customers

### Trigger
Order placed

### Sequence

| Email | Timing | Content | Goal |
|-------|--------|---------|------|
| 1 | Immediate | Order confirmation | Reassurance |
| 2 | Shipping | Tracking info | Expectation setting |
| 3 | Day 3 | "Your order is on the way!" | Excitement building |
| 4 | Delivery +2 | "How's your matching outfit?" | Check-in |
| 5 | Delivery +7 | "Show us your matching photos!" | UGC request |
| 6 | Delivery +14 | Review request | Social proof |
| 7 | Day 30 | "Complete your matching collection" | Cross-sell |
| 8 | Day 45 | VIP/loyalty invite | Retention |

### Key Emails Detail

**Email 4: Check-in**
```
Subject: How are you loving your matching outfits? 💕

Hey [Name]!

Your order should have arrived by now. We'd love to know:

How do they fit?
Hit reply if you have any questions - we're here to help!

📸 Share your matching photos with #DressLikeMommy for a chance to be featured!
```

**Email 6: Review Request**
```
Subject: Quick favor? Share your thoughts! ⭐

Hey [Name],

You've had your matching outfits for a couple weeks now. 

Would you mind leaving a quick review? It helps other moms find us!

[LEAVE A REVIEW - TAKES 30 SECONDS]

As a thank you, here's 10% off your next order: THANKS10
```

**Email 7: Cross-sell**
```
Subject: Complete your matching collection 👗

Hey [Name]!

Since you loved [PREVIOUS PURCHASE], we thought you'd adore these:

[RELATED PRODUCTS]

Members like you get 15% off their second order: LOYAL15

[SHOP YOUR RECOMMENDATIONS]
```

### Expected Results
- Review submission rate: 5-15%
- Second purchase rate (from cross-sell): 10-20%
- UGC submission: 2-5%

---

## Flow 5: Win-Back Flow

### Purpose
Re-engage lapsed customers

### Trigger
Last purchase > 60 days ago + was active customer

### Sequence

| Email | Timing | Subject Line | Offer |
|-------|--------|--------------|-------|
| 1 | Day 60 | "We miss you! 💕" | None |
| 2 | Day 75 | "Here's what's new" | 10% off |
| 3 | Day 90 | "Come back for 20% off" | 20% off |
| 4 | Day 120 | "Final goodbye (with a gift)" | 25% off |

### Email Details

**Email 1 (60 days)**
```
Subject: We miss you! 💕

Hey [Name],

It's been a while since you shopped with us!

Here's what you've been missing:
- 15 new matching styles just dropped
- Our spring collection is here
- Customer photos are cuter than ever

[SEE WHAT'S NEW]

We'd love to match with you again!
```

**Email 3 (90 days)**
```
Subject: 20% off because we really miss you 💔

[Name], it's been 3 months!

Here's 20% off to come back:
Code: WEMISSYOU20

[SHOP NEW ARRIVALS]

Your mini is probably a whole new size by now... 
time for new matching outfits? 😊
```

### Expected Results
- Win-back rate: 5-10% of lapsed customers
- Higher discount = higher conversion
- Some customers are gone forever (that's okay)

---

## Flow 6: VIP & Birthday Flows

### VIP Flow (Triggered by 3+ purchases or $200+ spent)
```
Subject: You're officially a VIP! 🎉

Welcome to the inner circle!

As a VIP, you get:
✓ Early access to new collections (48h before everyone)
✓ Exclusive VIP-only sales
✓ Free shipping on every order
✓ Birthday surprise

Here's your VIP code for 20% off: VIP20

[SHOP VIP EXCLUSIVES]
```

### Birthday Flow
```
Subject: Happy Birthday! Here's a gift 🎂

Happy Birthday, [Name]!

To celebrate YOU, here's 25% off + free shipping:
Code: BIRTHDAY25

Valid for 7 days - treat yourself (and your mini)!

[SHOP YOUR BIRTHDAY GIFT]
```

---

## Tools & Setup

### Recommended ESPs
- **Klaviyo** - E-commerce gold standard
- **Omnisend** - Good alternative
- **Mailchimp** - Budget option

### Flow Setup Checklist (Per Flow)
```
□ Trigger configured correctly
□ Timing set
□ Filters/conditions added
□ Email content written
□ Subject lines A/B tested
□ Preview text set
□ Links working
□ Unsubscribe working
□ Exit conditions set
□ Testing complete
```

---

## KPIs to Track

### By Flow
| Flow | Open Rate | Click Rate | Revenue/Recipient |
|------|-----------|------------|-------------------|
| Welcome | 40-60% | 5-10% | $2-5 |
| Abandoned Cart | 40-50% | 10-15% | $5-15 |
| Browse Abandon | 30-40% | 3-5% | $0.50-2 |
| Post-Purchase | 50-60% | 5-8% | $1-3 |
| Win-Back | 20-30% | 2-5% | $1-3 |

### Overall Targets
- Flow revenue: 15-25% of total store revenue
- Abandoned cart recovery: 10-15%
- Welcome series conversion: 5-10%
- Email list growth: 5-10% monthly

---

## Common Mistakes

### ❌ Avoid These

1. **No welcome flow** - First impressions matter
2. **Weak abandoned cart** - Money left on table
3. **Too aggressive** - Don't email daily
4. **No segmentation** - One size doesn't fit all
5. **Ignoring timing** - Test send times
6. **Generic content** - Personalize when possible
7. **No testing** - A/B test everything
8. **Missing exit conditions** - Remove purchasers from cart flow!
9. **Broken links** - Test all flows
10. **Forgetting mobile** - 60%+ read on phone

---

## Expert Tips

### 🎯 Advanced Strategies

1. **Dynamic Product Blocks**
   - Show actual cart/browsed items
   - Personalized recommendations
   - Auto-populated from data

2. **SMS + Email Combo**
   - SMS at 2-4 hours for cart
   - Email at 24 hours
   - Higher recovery rate

3. **A/B Test Subject Lines**
   - Emoji vs no emoji
   - Question vs statement
   - Personalization vs generic

4. **Discount Ladder**
   - Start with no discount
   - Increase offer over time
   - Captures full-price buyers first

5. **Plain Text for Win-Back**
   - Feels personal
   - Higher deliverability
   - "Hey, it's Sarah from..."
