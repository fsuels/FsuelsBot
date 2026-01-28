# Microsoft Ads UET Tag Fix — Step by Step

## The Problem (UPDATED 2026-01-27 1:15 PM)
BOTH UET tags are "Tag active":
- dresslikemommy.com (ID 36000629) — Tag active ← DUPLICATE, should be removed
- ShopifyImport (ID 36005151) — Tag active ← CORRECT tag

Having two active tags means conversions are potentially double-counted.
The "Purchases" conversion goal may be using the OLD tag (36000629).

## Steps to Fix

### Step 1: Log into Microsoft Ads
- URL: https://ads.microsoft.com
- Account: suelsferro@hotmail.com
- Account ID: 477439 | Customer ID: 770182

### Step 2: Go to Conversion Goals
- Click "Tools" in top menu
- Click "Conversion tracking" → "Conversion goals"
- You'll see 5 goals listed

### Step 3: Fix "Purchases" Goal
- Click on "Purchases" goal
- It currently shows "Tag inactive" 
- Click "Edit"
- Change the UET tag from "dresslikemommy.com" (36000629) to "ShopifyImport" (36005151)
- Save

### Step 4: Verify Other Goals
- "ShopifyCheckoutComplete..." (Destination URL) — should already use active tag
- "ShopifyCheckoutCompleteEventTracking" (Event) — verify it uses tag 36005151
- "ShopifyAddToCart" (Event) — verify it uses tag 36005151
- "Smart goal" — auto-managed, no changes needed

### Step 5: Delete Dead UET Tags
- Go to Tools → Conversion tracking → UET tags
- Delete tag "dresslikemommy.com" (36000629) — inactive, not needed
- Delete the 2 "DELETED" tags (4003543, 4003545) if still showing
- Keep ONLY "ShopifyImport" (36005151)

### Step 6: Test
- After fixing, Microsoft will take 24-48h to verify the tag
- The "Fix your UET tag" warning should disappear
- Then campaigns can be unpaused

### Step 7: Unpause Campaigns (after UET is fixed)
Priority order:
1. **USA Campaign** — $4,017 spent → $8,732 revenue (217% ROAS)
2. **Australia Campaign** — $113 spent → $1,015 revenue (897% ROAS!) 
3. **Canada Campaign** — $211 spent → $978 revenue (464% ROAS)
4. Skip "Rest of Europe & World" (41% ROAS — losing money)

### Budget Recommendations
- USA: Start at $20/day, scale to $50/day if ROAS holds
- Australia: Start at $10/day (was only $5/day before)
- Canada: Start at $10/day
- Total: $40/day = ~$1,200/month ad spend
- Expected return at 224% ROAS: ~$2,688/month revenue
