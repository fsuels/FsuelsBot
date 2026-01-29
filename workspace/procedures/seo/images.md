---
version: "1.0"
created: "2026-01-29"
updated: "2026-01-29"
verified: "2026-01-29"
confidence: "high"
type: "procedure"
---

# Image Optimization Procedure

> **Verification Gate:** Before proceeding, state: "I have read the image optimization procedure. Every image needs: descriptive filename, alt text with keywords, and compressed file size under 200KB."

## Purpose
Optimize images for search visibility (Google Images), page speed, and accessibility.

## Prerequisites
- Product images ready for upload
- Image editing/compression tool available
- Keyword map for relevant keywords

## Tools/Resources
- **Compression:** TinyPNG (free online), Squoosh.app, or Shopify auto-compression
- **Bulk rename:** Windows File Explorer, or batch rename tool
- **Alt text:** Shopify Admin > Products > Media

---

## Step-by-Step Procedure

### Step 1: Optimize Image Filenames BEFORE Upload
- [ ] Rename files with descriptive, keyword-rich names
- [ ] Use hyphens between words (not underscores or spaces)
- [ ] Include product and key feature

**Filename Format:** `[product-type]-[style/color]-[audience]-[number].jpg`

**Examples:**
| Bad Filename | Good Filename |
|--------------|---------------|
| IMG_1234.jpg | heart-print-mommy-me-sweatshirt-front.jpg |
| photo1.png | valentine-matching-dress-red-lifestyle.jpg |
| DSC0001.jpg | mommy-daughter-pajamas-pink-hearts.jpg |

### Step 2: Compress Images
- [ ] Target file size: **Under 200KB** per image (ideally 50-150KB)
- [ ] Use TinyPNG.com or Squoosh.app
- [ ] Maintain quality while reducing size
- [ ] Recommended dimensions: 2048x2048px max for Shopify

**Compression Workflow:**
1. Upload original to TinyPNG
2. Download compressed version
3. Verify quality visually
4. Upload compressed version to Shopify

### Step 3: Upload to Shopify
- [ ] Go to Products > [Product] > Media
- [ ] Upload all product images
- [ ] Drag to reorder (best image first - this shows in search)
- [ ] First image should be clean product shot (white/neutral background)

### Step 4: Add Alt Text to Every Image
- [ ] Click on each image > Add alt text
- [ ] **Format:** `[Product name] - [what's shown] - [keyword]`
- [ ] Keep 125 characters or less
- [ ] Include primary keyword naturally
- [ ] Describe what's actually in the image

**Alt Text Examples:**
| Image Type | Alt Text |
|------------|----------|
| Main product | Heart print mommy and me matching sweatshirts in red |
| Lifestyle | Mother and daughter wearing matching Valentine's outfits |
| Detail shot | Close-up of heart print pattern on matching sweatshirt |
| Size reference | Mommy and me pajama set shown on mother and child |
| Flat lay | Valentine's Day mommy and me outfit set flat lay |

### Step 5: Optimize Collection & Banner Images
- [ ] Collection banners: Add alt text in Collection settings
- [ ] Homepage banners: Add alt text in theme customizer
- [ ] Format: `[Collection/page name] - [what's shown]`

### Step 6: Check for Missing Alt Text
Periodically audit for missing alt text:
- [ ] Use Shopify app or manual check
- [ ] Filter products by "missing alt text"
- [ ] Prioritize best-selling products

---

## Alt Text Best Practices

**DO:**
- Describe what's in the image accurately
- Include product name and primary keyword
- Keep concise (under 125 chars)
- Be specific about colors, styles, patterns

**DON'T:**
- Start with "Image of..." or "Picture of..."
- Keyword stuff (don't repeat keyword 5 times)
- Use the same alt text for all images
- Leave alt text empty
- Write paragraphs (keep it brief)

---

## Image Type Guidelines

| Image Type | Purpose | Alt Text Focus |
|------------|---------|----------------|
| Hero/Main | Clean product view | Product name + keyword |
| Lifestyle | Show product in use | Who's wearing it + activity |
| Detail | Show fabric/features | Specific feature shown |
| Scale | Show size/fit | Size reference description |
| Flat Lay | Multiple items | What's included in set |

---

## File Format Guidelines

| Format | Best For | Notes |
|--------|----------|-------|
| JPG/JPEG | Photos, lifestyle | Best compression, no transparency |
| PNG | Graphics, logos | Supports transparency, larger files |
| WebP | Modern browsers | Best compression, Shopify converts automatically |

---

## Quality Criteria
✅ All filenames are descriptive (no IMG_1234.jpg)  
✅ All images compressed under 200KB  
✅ Every product image has alt text  
✅ Alt text includes keywords naturally  
✅ First/main image is clean product shot  
✅ Collection images have alt text  

---

## Common Mistakes to Avoid
❌ Uploading images with default camera names  
❌ Images over 500KB (slows page load)  
❌ Identical alt text on all images  
❌ Alt text that doesn't describe the image  
❌ Missing alt text entirely  
❌ Images too small (pixelated when zoomed)  
❌ Wrong aspect ratio (distorted images)  

---

## Bulk Image Optimization Workflow

For batch processing new products:

1. **Organize:** Put all images in folder by product
2. **Rename:** Batch rename with product name prefix
3. **Compress:** Upload folder to TinyPNG (up to 20 free/batch)
4. **Upload:** Add to Shopify product
5. **Alt Text:** Add alt text immediately after upload

---

## Shopify-Specific Notes

- Shopify automatically serves WebP where supported
- Shopify creates multiple sizes for responsive display
- Maximum recommended upload: 4472 x 4472 pixels
- Shopify compresses images but original quality matters
- Alt text location: Products > [Product] > Media > Click image > Add alt text
