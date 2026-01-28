import urllib.request
import re
import json
import time

# Sample 20 products across categories
sample_urls = [
    # Old/generic URL products
    "https://www.dresslikemommy.com/products/2016-family-matching-outfits-summer-family-look-clothing-mother-daughter-dresses-clothes-chiffon-dress-korean-fashion",
    "https://www.dresslikemommy.com/products/casual-family-matching-outfits-mother-and-daughter-tees-father-and-son-t-shirts-mommy-and-baby-clothes-family-clothing",
    # Dresses
    "https://www.dresslikemommy.com/products/matching-outfit-mother-daughter-chiffon-dress",
    "https://www.dresslikemommy.com/products/mommy-and-me-matching-floral-long-sleeve-maxi-dresses-with-pockets",
    "https://www.dresslikemommy.com/products/mother-and-daughter-classic-floral-dress",
    # Maternity
    "https://www.dresslikemommy.com/products/maternity-solid-color-shoulderless-dress",
    "https://www.dresslikemommy.com/products/lace-long-sleeve-maternity-photography-props-dresses-for-pregnant-women",
    # Swimsuits
    "https://www.dresslikemommy.com/products/mommy-me-angels-wing-swimsuit",
    "https://www.dresslikemommy.com/products/one-shoulder-matching-swimsuit",
    "https://www.dresslikemommy.com/products/chic-leopard-print-one-piece-swimsuit-with-ruffle-accent-timeless-mother-daughter-beachwear",
    # T-shirts
    "https://www.dresslikemommy.com/products/matching-mommy-me-unicorn-t-shirt",
    "https://www.dresslikemommy.com/products/father-and-child-pilot-co-pilot-matching-t-shirt-set-perfect-for-daddy-me-outfits",
    "https://www.dresslikemommy.com/products/family-matching-original-remix-encore-t-shirt-set-fun-family-outfits-for-all-ages",
    # Sweaters/Hoodies
    "https://www.dresslikemommy.com/products/family-matching-colorful-sweater-dad-mother-son-daughter",
    "https://www.dresslikemommy.com/products/parent-child-rainbow-bear-autumn-sweater",
    # Pajamas
    "https://www.dresslikemommy.com/products/matching-family-christmas-hats-pajamas",
    "https://www.dresslikemommy.com/products/matching-family-christmas-pajamas-snowflake-nordic-holiday-pj-set-for-all-ages",
    # Couples
    "https://www.dresslikemommy.com/products/couple-matching-shirts-mr-and-mrs-wedding-gift-anniversary",
    # Gift Card
    "https://www.dresslikemommy.com/products/gift-card",
    # Empty caption product
    "https://www.dresslikemommy.com/products/matching-father-and-child-me-mini-me-t-shirt-set-adorable-dad-and-kid-outfit",
]

results = []

for i, url in enumerate(sample_urls):
    print(f"\n[{i+1}/{len(sample_urls)}] Fetching: {url.split('/products/')[-1][:60]}...")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
        with urllib.request.urlopen(req, timeout=15) as response:
            html = response.read().decode('utf-8', errors='replace')
        
        # Extract meta title
        title_match = re.search(r'<title[^>]*>(.*?)</title>', html, re.DOTALL | re.IGNORECASE)
        meta_title = title_match.group(1).strip() if title_match else 'MISSING'
        
        # Extract meta description
        desc_match = re.search(r'<meta\s+name=["\']description["\']\s+content=["\'](.*?)["\']', html, re.DOTALL | re.IGNORECASE)
        if not desc_match:
            desc_match = re.search(r'<meta\s+content=["\'](.*?)["\']\s+name=["\']description["\']', html, re.DOTALL | re.IGNORECASE)
        meta_desc = desc_match.group(1).strip() if desc_match else 'MISSING'
        
        # Extract OG title
        og_title_match = re.search(r'<meta\s+property=["\']og:title["\']\s+content=["\'](.*?)["\']', html, re.IGNORECASE)
        if not og_title_match:
            og_title_match = re.search(r'<meta\s+content=["\'](.*?)["\']\s+property=["\']og:title["\']', html, re.IGNORECASE)
        og_title = og_title_match.group(1).strip() if og_title_match else 'MISSING'
        
        # Check for product description content
        # Look for common Shopify product description containers
        desc_content_match = re.search(r'class=["\']product-single__description["\'][^>]*>(.*?)</div>', html, re.DOTALL | re.IGNORECASE)
        if not desc_content_match:
            desc_content_match = re.search(r'class=["\']product__description["\'][^>]*>(.*?)</div>', html, re.DOTALL | re.IGNORECASE)
        if not desc_content_match:
            desc_content_match = re.search(r'class=["\'][^"\']*description[^"\']*["\'][^>]*>(.*?)</div>', html, re.DOTALL | re.IGNORECASE)
        
        if desc_content_match:
            desc_text = re.sub(r'<[^>]+>', '', desc_content_match.group(1)).strip()
            desc_length = len(desc_text)
        else:
            desc_text = ''
            desc_length = 0
        
        # Check for price
        price_match = re.search(r'class=["\'][^"\']*price[^"\']*["\'][^>]*>.*?\$[\d,.]+', html, re.DOTALL | re.IGNORECASE)
        has_price = bool(price_match)
        
        # Also check for structured data price
        price_sd_match = re.search(r'"price":\s*"([\d.]+)"', html)
        if price_sd_match:
            has_price = True
            price_value = price_sd_match.group(1)
        else:
            price_value = 'unknown'
        
        # Check for images with alt text
        img_tags = re.findall(r'<img[^>]+>', html, re.IGNORECASE)
        imgs_with_alt = 0
        imgs_without_alt = 0
        for img in img_tags:
            alt_match = re.search(r'alt=["\']([^"\']*)["\']', img)
            if alt_match and alt_match.group(1).strip():
                imgs_with_alt += 1
            else:
                imgs_without_alt += 1
        
        # Check for product availability / sold out
        sold_out = 'sold out' in html.lower() or 'out of stock' in html.lower()
        
        # Check for canonical URL
        canonical_match = re.search(r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']+)["\']', html, re.IGNORECASE)
        canonical = canonical_match.group(1) if canonical_match else 'MISSING'
        
        result = {
            'url': url,
            'meta_title': meta_title,
            'og_title': og_title,
            'meta_description': meta_desc,
            'meta_desc_length': len(meta_desc) if meta_desc != 'MISSING' else 0,
            'product_desc_length': desc_length,
            'product_desc_preview': desc_text[:200] if desc_text else 'EMPTY/NOT FOUND',
            'has_price': has_price,
            'price_value': price_value,
            'images_with_alt': imgs_with_alt,
            'images_without_alt': imgs_without_alt,
            'sold_out': sold_out,
            'canonical': canonical,
            'has_brand_in_title': 'dress like mommy' in meta_title.lower() or 'dresslikemommy' in meta_title.lower(),
        }
        results.append(result)
        
        # Print summary
        issues = []
        if meta_desc == 'MISSING' or len(meta_desc) < 10:
            issues.append('❌ NO META DESCRIPTION')
        elif len(meta_desc) < 50:
            issues.append(f'⚠️ SHORT meta desc ({len(meta_desc)} chars)')
        if desc_length < 50:
            issues.append(f'❌ THIN/MISSING product description ({desc_length} chars)')
        if not has_price:
            issues.append('❌ NO PRICE FOUND')
        if imgs_without_alt > 0:
            issues.append(f'⚠️ {imgs_without_alt} images missing alt text')
        if not result['has_brand_in_title']:
            issues.append('⚠️ Brand name not in title')
        if sold_out:
            issues.append('⚠️ SOLD OUT')
        
        print(f"  Title: {meta_title[:80]}")
        print(f"  Meta Desc: {meta_desc[:80] if meta_desc != 'MISSING' else 'MISSING'}")
        print(f"  Product Desc: {desc_length} chars")
        print(f"  Price: {'$'+price_value if has_price else 'NOT FOUND'}")
        print(f"  Images: {imgs_with_alt} with alt, {imgs_without_alt} without")
        if issues:
            print(f"  ISSUES: {'; '.join(issues)}")
        else:
            print(f"  ✅ No major issues")
        
    except Exception as e:
        print(f"  ERROR: {e}")
        results.append({'url': url, 'error': str(e)})
    
    time.sleep(0.5)  # Be polite

# Save results
with open("mission-control/page_audit_results.json", "w") as f:
    json.dump(results, f, indent=2)

print(f"\n\nSaved {len(results)} page audit results to mission-control/page_audit_results.json")
