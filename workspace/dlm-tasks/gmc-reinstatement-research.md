# GMC Reinstatement Research Report — Dress Like Mommy
*Traffic Engineer Persona | 2026-01-28*
*Google Merchant Center Account: 124884876*

---

## Traffic Engineer Output Schema

```json
{
  "task_type": "gmc_fix",
  "target_metric": "GMC reinstatement (binary: suspended → active)",
  "current_value": "suspended (misrepresentation, since ~Jan 26 2026)",
  "projected_value": "active",
  "action_items": [
    "1. WEBSITE AUDIT: Check all 12 trust signal items on dresslikemommy.com (see Section 4 checklist)",
    "2. PRODUCT FEED AUDIT: Verify price/availability/image/URL match between Shopify and GMC feed for all 340 products",
    "3. ABOUT US PAGE: Create or enhance About Us page — include DLM brand story, founder info, FKG Trading LLC business identity, Naples FL address, team photo or brand photo",
    "4. CONTACT PAGE: Verify Contact Us page has phone (+17863096006), email, physical address (Naples FL), and a working contact form",
    "5. POLICY PAGES: Verify Shipping, Returns/Refunds, Privacy Policy, Terms of Service are all linked in footer, accessible, not boilerplate/template text",
    "6. BUSINESS INFO CONSISTENCY: Ensure business name, address, phone match EXACTLY across: (a) dresslikemommy.com website footer, (b) About Us page, (c) Contact page, (d) GMC account 124884876, (e) Google Ads 399-097-6848, (f) Google Payments profile, (g) Google Business Profile (testhqfinds@gmail.com)",
    "7. PRODUCT DESCRIPTIONS: Rewrite any products using manufacturer/AliExpress boilerplate. Use original copy that describes the mommy-and-me outfit clearly with materials, sizing, care instructions",
    "8. PRODUCT IMAGES: Ensure all 340 products have real product photos (not stock photos or renders), no promotional text/watermarks on images, images match actual product",
    "9. IDENTITY VERIFICATION: Log into GMC → click Fix Issues → check if identity verification link appears → upload: (a) government-issued ID, (b) utility bill with FKG Trading LLC address, (c) company registration docs. Ensure all match GMC/Ads/Payments info exactly",
    "10. WAIT FOR LOGO REVIEW: Logos uploaded Jan 27, under review (5-7 business days = by Feb 3). Do NOT request re-review until logos are approved",
    "11. REQUEST RE-REVIEW: After all fixes + logos approved: Go to Shopify Admin → Sales Channels → Google → Settings → 'Request re-review'. Include a clear, concise explanation of all changes made (see Section 7 appeal template)",
    "12. MONITOR COOL-DOWN: If denied, you get 2 attempts before a 1-week cool-down. Each subsequent denial extends cool-down (7→14→21 days). Do NOT waste attempts — fix everything FIRST"
  ],
  "confidence": 0.72,
  "verification_minutes": 8
}
```

---

## 1. Executive Summary

**Situation:** Dress Like Mommy's GMC account (124884876) is suspended for "Misrepresentation." This is the #1 most common GMC suspension reason and the hardest to fix because Google rarely tells you the *specific* trigger.

**Root cause identified so far:** 47 countries had no shipping policies (Shopify auto-added markets without shipping config). This was fixed on Jan 27, 2026. Logos were also rejected and re-uploaded.

**What this research found:** Fixing shipping alone is almost never enough. Google's misrepresentation review examines the *entire* store holistically — business identity, trust signals, product data accuracy, policy transparency, and cross-platform consistency. Dropshipping stores face extra scrutiny because Google has flagged patterns of fly-by-night operations with thin content.

**Critical finding (2025-2026):** Google now requires **identity verification** (government ID + utility bill + company registration) for many suspended accounts. This is a newer requirement that bypasses the old support.google.com appeal path. Check if this appears inside your GMC account.

**Timeline estimate:** If all fixes are implemented correctly, reinstatement typically takes 7-14 business days after re-review submission. But failed attempts trigger escalating cool-down periods (7→14→21 days), so it's critical to fix everything *before* the next review request.

---

## 2. Research Sources (2025-2026)

| Source | URL | Key Insight |
|--------|-----|-------------|
| Google Official: Fixing Suspensions | https://support.google.com/merchants/answer/13693195 | Cool-down escalation rules, Shopify-specific re-review path |
| Google Official: Misrepresentation Policy | https://support.google.com/merchants/answer/6150127 | "Accounts only reinstated in compelling circumstances" — egregious violation |
| SEO.ai: Misrepresentation Fix 2025 | https://seo.ai/blog/google-merchant-center-mispresentation | Case studies: address mismatch, mobile disclaimers missing |
| RobtronicMedia: 2026 Method | https://robtronicmedia.com/library/misrepresentation-suspension-revealed-live-dropshipping-website-review-for-google-merchant-center-2/ | NEW: Identity verification inside MC replaces old support path |
| WebAppick: Recovery Guide | https://webappick.com/how-to-fix-google-merchant-center-suspension | Full misrepresentation checklist (14 items) |
| Kahunam: Step-by-Step Guide | https://kahunam.com/articles/blog/how-to-fix-google-merchant-center-misrepresentation-suspension/ | 5-step process with documentation requirements |
| DataFeedWatch/StubGroup: Expert Analysis | https://www.datafeedwatch.com/blog/google-merchant-account-suspended | "Dropshipping ≠ suspension — it's correlation, not causation" |
| FeedArmy: Video Verification | https://feedarmy.com/kb/google-merchant-center-suspensions-new-video-identity-verification-what-merchants-must-know/ | Video proof may be required; dropshippers need "high quality original website, lots of reviews, trust signals" |
| PPC News Feed: Video Mandatory | https://ppcnewsfeed.com/ppc-news/2025-09/video-proof-becomes-mandatory-for-google-merchant-reinstatements/ | 3-5 min unedited video of business, storage, products may be required |
| AdNabu FAQ | https://help.adnabu.com/en/article/why-does-google-not-allow-dropshipping-stores-for-shopping-1361pai/ | Google policy: "promoting products that are not stocked" |

---

## 3. Why Shopify Dropshipping Stores Get Suspended

### The Correlation Problem (Not Causation)
Per StubGroup CEO John Horn (worked with 3,000+ clients): **"Rather than causation (dropshipping = suspension), we have a case of correlation, where many brand-new dropshipping sites are not following Google's policies."** His agency has dropshipping clients who have never been suspended.

### The 10 Most Common Triggers for Dropshipping Stores

1. **Missing/generic About Us page** — No business story, no founder info, looks like a template
2. **Boilerplate policy pages** — Copy-pasted Shopify default policies without customization
3. **Missing or inconsistent contact info** — No physical address, no phone, email-only
4. **Product descriptions copied from supplier** — AliExpress/1688 text, broken English, generic content
5. **Stock photos or supplier renders** — Not your own product photography
6. **Price mismatches** — Feed shows one price, product page shows another (often from currency/variant issues)
7. **Shipping time misrepresentation** — Says "free shipping" but takes 15-30 days from China without disclosure
8. **Business info mismatch across platforms** — Different name/address on website vs. GMC vs. Google Ads vs. Payments
9. **No customer reviews or social proof** — Brand-new store with zero trust signals
10. **Long shipping times hidden** — Google crawlers check if shipping estimates match reality

### DLM-Specific Risk Factors
- ✅ **Already fixed:** Shipping policies for 48 countries
- ✅ **Already done:** Business info in GMC (name, address, phone, email, SSL, verified website)
- ✅ **Already done:** Return policy (30 days)
- ✅ **Already done:** Trust badges (Latino-owned, Small business)
- ✅ **Already done:** Social profiles linked (Facebook, Instagram)
- ⚠️ **UNKNOWN — NEEDS CHECK:** About Us page quality
- ⚠️ **UNKNOWN — NEEDS CHECK:** Product description originality (340 products from BuckyDrop — are descriptions original or supplier copy?)
- ⚠️ **UNKNOWN — NEEDS CHECK:** Product image quality (real photos or supplier stock?)
- ⚠️ **UNKNOWN — NEEDS CHECK:** Contact page completeness
- ⚠️ **UNKNOWN — NEEDS CHECK:** Policy pages — are they customized or Shopify boilerplate?
- ⚠️ **UNKNOWN — NEEDS CHECK:** Price consistency between Shopify product pages and GMC feed
- ⚠️ **UNKNOWN — NEEDS CHECK:** Business info consistency across ALL Google accounts
- ⚠️ **UNKNOWN — NEEDS CHECK:** Mobile experience — disclaimers/policies visible on mobile?

---

## 4. The Master Reinstatement Checklist

### 🔴 CRITICAL (Must fix before requesting review)

#### A. Business Identity & Trust (Google's #1 Concern)
- [ ] **About Us page** exists and contains:
  - Brand story (Dress Like Mommy — mommy-and-me matching outfits since [year])
  - Business entity name (FKG Trading LLC)
  - Physical location (Naples, FL)
  - Founder/team information (even a brief bio)
  - What makes the brand unique (not just "we sell clothes")
  - NOT generic template text
- [ ] **Contact page** includes ALL of:
  - Physical address (must match GMC)
  - Phone number (+17863096006)
  - Email address (professional, not free email if possible)
  - Working contact form
  - Business hours (if applicable)
- [ ] **Footer** displays:
  - Business name
  - Contact info (at minimum email or phone)
  - Links to ALL policy pages (Shipping, Returns, Privacy, Terms)
  - Payment method icons (Visa, MC, PayPal, etc.)

#### B. Policy Pages (All Must Be Custom, Not Boilerplate)
- [ ] **Shipping Policy** — Clear delivery times, cost per region, which countries you ship to. **CRITICAL for DLM:** If BuckyDrop ships from China, you MUST disclose realistic delivery times (e.g., "Standard International: 8-23 business days"). Do not say "3-5 business days" if it's really 15-25 days from China.
- [ ] **Return & Refund Policy** — Already verified (30 days). Ensure it's:
  - Linked from footer
  - Linked from product pages
  - Accessible on mobile
  - Specific about who pays return shipping
  - Clear about refund timeline
- [ ] **Privacy Policy** — Must NOT be Shopify's auto-generated template. Customize with DLM's business name, data practices, and contact info.
- [ ] **Terms of Service** — Must NOT be generic. Include DLM's business entity and jurisdiction.

#### C. Product Feed Accuracy
- [ ] **All 340 product prices match** between Shopify product pages and GMC feed
- [ ] **All product URLs work** — no 404s, no redirects to homepage
- [ ] **Product availability is accurate** — no "in stock" on GMC if out of stock on Shopify
- [ ] **Product images are real** — actual product photos, not stock photos of different items
- [ ] **No promotional text on images** — no "SALE" banners, no watermarks, no logos overlaid
- [ ] **Product titles are accurate** — match what's shown on the product page
- [ ] **Product descriptions are original** — not copied from supplier/AliExpress

#### D. Cross-Platform Consistency (THE #1 OVERLOOKED ISSUE)
- [ ] Business name matches EXACTLY on:
  - dresslikemommy.com (header, footer, About page)
  - Google Merchant Center (124884876)
  - Google Ads (399-097-6848)
  - Google Payments profile
  - Google Business Profile (testhqfinds@gmail.com)
- [ ] Physical address matches EXACTLY (same format, same punctuation) across all above
- [ ] Phone number matches EXACTLY across all above
- [ ] Email matches across all above

### 🟡 IMPORTANT (Improves approval chances)

- [ ] **Customer reviews visible** on site (Judge.me, Loox, or other review app)
- [ ] **SSL certificate** valid (HTTPS) ✅ Already confirmed
- [ ] **Secure checkout** with recognized payment methods ✅ Already confirmed
- [ ] **Mobile-responsive** — all policy pages, disclaimers, and product info visible on mobile
- [ ] **No fake urgency** — no countdown timers, no "Only 3 left!" unless real
- [ ] **No exaggerated claims** — no "guaranteed results" or unrealistic promises
- [ ] **Google structured data** (Schema.org) — ✅ BreadcrumbList + Organization already installed
- [ ] **Blog/content** — ✅ 10 SEO posts published
- [ ] **Social media active** — recent posts on Facebook/Instagram linked from site

---

## 5. The 2025-2026 Identity Verification Requirement (NEW & CRITICAL)

### What Changed
As of September 2025, Google introduced stricter identity verification for Merchant Center reinstatements, especially targeting:
- Dropshipping stores
- New stores with no sales history
- Stores suspended for misrepresentation

### What Google May Require
1. **Government-issued ID** (passport or driver's license)
2. **Utility bill** showing your business address
3. **Company registration documents** (FKG Trading LLC registration)
4. **Video proof** (3-5 minutes, unedited) showing:
   - Your business location/storefront
   - Product storage/inventory
   - Products themselves
   - Business signage

### How to Check If This Applies to DLM
1. Log into GMC account 124884876
2. Look for a red suspension banner
3. Click "Fix Issues" or "Fix"
4. Check if there's an **identity verification link**
5. If yes → upload the documents FIRST before requesting re-review

### The Dropshipping Problem with Video Verification
Per FeedArmy (Sep 2025): *"Only in cases if you are dropshipping, you have a high quality original website, lots of reviews, and trust signals, may Google allow this."*

**For DLM:** Since you don't hold physical inventory (BuckyDrop dropships from China), video verification of inventory is impossible. The mitigation is:
- An extremely professional, original website
- Customer reviews/testimonials
- Strong About Us page with real business identity
- Clear disclosure of fulfillment model (don't hide that shipping comes from overseas)

---

## 6. Recent Google Policy Changes Affecting Dropshippers (2025-2026)

1. **Video Identity Verification (Sep 2025):** Physical business/inventory proof may be required for reinstatement. Raises the bar significantly for dropshippers.

2. **Stricter AI-Powered Reviews (2025):** Google's review system uses AI that cross-references your website, feed, accounts, social media, and third-party sources. Even minor inconsistencies get flagged.

3. **Structured Data for Shipping/Returns (2025):** Google now expects `MerchantReturnPolicy` and `ShippingDetails` structured data in product pages. DLM already has Schema.org BreadcrumbList + Organization installed — should add shipping/return structured data too.

4. **Cool-Down Period Escalation:** After 2 failed review requests, cool-down starts at 7 days and escalates: 7→14→21 days, potentially leading to permanent suspension. **Do NOT waste review attempts.**

5. **"Not Stocked" Language Shift:** Google changed "dropshipping not allowed" to "promoting products that are not stocked" — this is more nuanced. You CAN dropship IF: (a) customers know what to expect, (b) shipping times are accurate, (c) you can actually fulfill orders, (d) your return/refund policies work.

---

## 7. Appeal Template (Use After ALL Fixes Are Complete)

### Where to Submit
**Option A (Shopify path):** Shopify Admin → Sales Channels → Google → Settings → "Request re-review"
**Option B (GMC path):** merchants.google.com → Account 124884876 → Fix Issues → Request Review

### What to Write (Adapt This)

> Subject: Re-Review Request — Account 124884876
>
> We have carefully reviewed all Google Shopping policies and made the following corrections to ensure full compliance:
>
> **Business Identity:**
> - Updated About Us page with complete business information (FKG Trading LLC, Naples, FL)
> - Verified contact page with physical address, phone number, email, and contact form
> - Ensured business name and address are consistent across our website, Merchant Center, Google Ads, and Payments profile
>
> **Shipping & Policies:**
> - Created comprehensive international shipping policy covering all 48 target countries with accurate delivery estimates (8-23 business days)
> - Verified return/refund policy (30-day returns) is clearly accessible from product pages and footer
> - Customized Privacy Policy and Terms of Service with our business details
>
> **Product Data:**
> - Verified all product prices match between our Shopify store and product feed
> - Confirmed all product URLs are live and direct to correct product pages
> - Ensured product images accurately represent the items sold
> - Updated product descriptions with original content
>
> **Logos & Branding:**
> - Uploaded new compliant brand logos (square and rectangular)
>
> We are committed to maintaining full compliance with Google's Shopping policies and providing accurate, transparent information to customers.

---

## 8. Step-by-Step This-Week Action Plan

### Day 1 (Today — Jan 28)
1. **Login to GMC** → Screenshot all current warnings/issues → Check for identity verification link
2. **Audit dresslikemommy.com** as if you're Google's reviewer:
   - Open in incognito browser (desktop AND mobile)
   - Check: About Us, Contact, Shipping Policy, Return Policy, Privacy Policy, Terms of Service
   - Note what's missing, generic, or inconsistent
3. **Cross-reference business info** across GMC, Google Ads, Payments profile, and website
4. **Document all findings** — what needs fixing

### Day 2 (Jan 29)
5. **Fix About Us page** — Write genuine brand story, include FKG Trading LLC, Naples FL, founder info
6. **Fix Contact page** — Ensure phone, email, address, contact form all present
7. **Fix Policy pages** — Customize Privacy Policy and Terms of Service (remove Shopify boilerplate)
8. **Verify shipping disclosure** — Ensure delivery times on website match what GMC shows (8-23 days international)

### Day 3 (Jan 30)
9. **Product feed audit** — Spot-check 20+ products:
   - Price on Shopify = price in GMC feed?
   - Product URL works?
   - Image matches product?
   - Description is original (not AliExpress copy)?
10. **Fix any product data issues found**
11. **Add customer reviews** if not already showing (install Judge.me free plan if needed)

### Day 4 (Jan 31)
12. **Business info standardization** — Make business name format, address format, phone format IDENTICAL across:
    - Website footer
    - About Us page
    - Contact page
    - GMC account
    - Google Ads account
    - Google Payments profile
    - Google Business Profile
13. **Complete identity verification** if required (upload ID, utility bill, company registration)

### Day 5+ (Feb 1-3)
14. **Wait for logo review** to complete (submitted Jan 27, should be done by Feb 3)
15. **Final audit** — Run through the full 14-item checklist one more time
16. **Submit re-review** ONLY after:
    - All checklist items ✅
    - Logos approved ✅
    - Identity verification complete (if required) ✅
17. **Document everything** — Screenshots of all fixed pages, changelog of all changes

### After Submission
18. **Wait 7-14 business days** — Do NOT submit duplicate appeals
19. **If denied** — Read denial carefully, fix cited issues, wait for cool-down to end, resubmit
20. **If approved** — Immediately verify all products are showing in free listings

---

## 9. Specific Fixes for Fashion/Clothing/Mommy-and-Me Stores

### Product Image Requirements (Fashion-Specific)
- **Main image:** White or light background, product clearly visible
- **No models wearing multiple items** unless ALL items are the product being sold
- **For mommy-and-me sets:** Show BOTH the adult and child outfits together
- **No promotional overlays:** No "SALE", "FREE SHIPPING", "NEW" text on images
- **High resolution:** At least 800x800px, preferably 1000x1000+
- **Match the variant:** If selling a pink dress, show the pink dress (not blue)

### Product Title Optimization (Fashion-Specific)
Format: `[Brand] [Product Type] [Key Feature] [Size/Age Range]`
Example: `Dress Like Mommy Floral Matching Mother Daughter Maxi Dress Set`

### Required Apparel Attributes in Feed
- `color` — Required for all clothing
- `size` — Required for all clothing
- `gender` — Required (female, unisex)
- `age_group` — Required (adult, kids, toddler, infant, newborn)
- `material` — Recommended
- `pattern` — Recommended (floral, striped, solid, etc.)
- `item_group_id` — Required for variant grouping

### Mommy-and-Me Specific Considerations
- **List as a SET** — If selling a matching set, make clear in title/description it's adult + child
- **Specify size ranges** — "Women S-XXL / Girls 2T-10Y"
- **Accurate categorization** — Use Google's taxonomy: `Apparel & Accessories > Clothing` with appropriate sub-category
- **Don't list as individual items** if they're sold as a set — price must match the set price

---

## 10. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Denied because product descriptions are supplier boilerplate | High | High | Rewrite descriptions for top 50 products minimum |
| Identity verification required (video of inventory) | Medium | Critical | Build strongest possible website trust signals; be transparent about fulfillment model |
| Cool-down triggered from premature re-review | Medium | High | Fix EVERYTHING first, don't rush |
| Price mismatch between Shopify and feed | Medium | Medium | Audit all 340 products before re-review |
| Permanent suspension | Low | Critical | Only 2 attempts before cool-down; make each count |
| Logo re-rejection | Low | Medium | New logos already designed to spec; wait for review |

---

## 11. Confidence Assessment

**Overall confidence of reinstatement: 0.72 (72%)**

Factors increasing confidence:
- Business info already complete in GMC ✅
- Shipping policy now covers all 48 countries ✅
- Return policy verified (30 days) ✅
- Trust badges active ✅
- Social profiles linked ✅
- SSL/HTTPS active ✅
- 10 SEO blog posts providing content depth ✅
- Schema.org structured data installed ✅
- DLM is a real business with real sales history ($46K over 3 years)

Factors decreasing confidence:
- Dropshipping model = extra scrutiny from Google
- Unknown product description quality (may be supplier boilerplate)
- Unknown cross-platform consistency status
- New identity verification requirements (Sep 2025) may require video proof DLM can't provide
- No customer reviews visible on site (unknown)
- About Us page quality unknown
- Prior rejection already happened (Jan 26 review)

**If all action items are completed, confidence increases to ~0.85.**

---

## 12. Sources & Further Reading

- Google Official Misrepresentation Policy: https://support.google.com/merchants/answer/6150127
- Google Official Fixing Suspensions (Shopify): https://support.google.com/merchants/answer/13693195
- Google Official Return Policy Setup: https://support.google.com/merchants/answer/14232691
- Request a Review (Cool-Down Rules): https://support.google.com/merchants/answer/13585221
- StubGroup Expert Analysis: https://www.datafeedwatch.com/blog/google-merchant-account-suspended
- 2026 Identity Verification Method: https://robtronicmedia.com/library/misrepresentation-suspension-revealed-live-dropshipping-website-review-for-google-merchant-center-2/
- Video Verification News: https://ppcnewsfeed.com/ppc-news/2025-09/video-proof-becomes-mandatory-for-google-merchant-reinstatements/

---

*Report generated by Traffic Engineer persona | 2026-01-28 | Confidence: 0.72*
*Verification time: 8 minutes for Francisco to review action items*
