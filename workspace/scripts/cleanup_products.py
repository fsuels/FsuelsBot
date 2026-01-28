"""
Product Data Cleanup Script for Dress Like Mommy
Requires: SHOPIFY_ACCESS_TOKEN environment variable
Usage: python cleanup_products.py [--dry-run]

What it fixes:
1. Removes 1688.com/taobao supplier URLs from tags
2. Removes size-variant tags (Adult S, Child 3-4yr, etc.)
3. Sets product_type based on existing tags and title
4. Removes alicdn.com images from descriptions
5. Adds alt text to all images
"""

import os
import sys
import json
import urllib.request
import urllib.parse
import time

# Config
SHOP = "dresslikemommy-com"
API_VERSION = "2024-10"
DRY_RUN = "--dry-run" in sys.argv

TOKEN = os.environ.get("SHOPIFY_ACCESS_TOKEN")
if not TOKEN:
    print("ERROR: Set SHOPIFY_ACCESS_TOKEN environment variable")
    print("Go to Shopify > Settings > Apps > Develop apps > Create app")
    print("Give it: read_products, write_products scopes")
    sys.exit(1)

BASE_URL = f"https://{SHOP}.myshopify.com/admin/api/{API_VERSION}"

def api_request(method, path, data=None):
    """Make authenticated Shopify Admin API request"""
    url = f"{BASE_URL}{path}"
    headers = {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json",
    }
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode() if e.fp else ""
        print(f"  API Error {e.code}: {error_body[:200]}")
        return None

# Size tags to remove (case-insensitive match)
SIZE_TAGS = {
    "adult s", "adult m", "adult l", "adult xl", "adult 2xl", "adult 3xl", "adult 4xl",
    "mother xs", "mother s", "mother m", "mother l", "mother xl", "mother 2xl", "mother 3xl",
    "father s", "father m", "father l", "father xl", "father 2xl", "father 3xl", "father 4xl",
    "baby 3m", "baby 6m", "baby 9m", "baby 12m", "baby 18m", "baby 24m",
    "child 1-2yr", "child 2-3yr", "child 3-4yr", "child 4-5yr", "child 5-6yr",
    "child 7-8yr", "child 9-10yr", "child 11-12yr", "child 13-14yr",
}

# Product type mapping based on tags/title keywords
TYPE_RULES = [
    (["pajamas", "pjs", "sleepwear", "nightwear"], "Matching Family Pajamas"),
    (["swimsuit", "swimwear", "bikini", "bathing"], "Matching Family Swimwear"),
    (["dress", "dresses"], "Mommy and Me Dresses"),
    (["sweater", "knit", "cardigan"], "Matching Family Sweaters"),
    (["t-shirt", "tee", "tshirt", "shirt"], "Matching Family T-Shirts"),
    (["hoodie", "sweatshirt"], "Matching Family Hoodies"),
    (["romper", "jumpsuit", "overalls"], "Matching Family Rompers"),
    (["couples", "couple"], "Couples Matching Outfits"),
    (["family matching"], "Family Matching Outfits"),
    (["mommy and me", "mother daughter", "mom and daughter"], "Mommy and Me Outfits"),
]

def classify_product_type(title, tags):
    """Determine product_type from title and tags"""
    text = (title + " " + " ".join(tags)).lower()
    for keywords, ptype in TYPE_RULES:
        if any(kw in text for kw in keywords):
            return ptype
    return "Family Matching Outfits"  # default

def clean_tags(tags):
    """Remove supplier URLs and size tags, return cleaned list"""
    cleaned = []
    removed = []
    for tag in tags:
        # Remove supplier URLs
        if "1688.com" in tag or "taobao" in tag or "alicdn" in tag:
            removed.append(f"URL: {tag[:50]}")
            continue
        # Remove size tags
        if tag.lower().strip() in SIZE_TAGS:
            removed.append(f"SIZE: {tag}")
            continue
        cleaned.append(tag)
    return cleaned, removed

def clean_description(body_html):
    """Remove alicdn/buckydeals images from description"""
    if not body_html:
        return body_html, False
    import re
    # Remove img tags with alicdn or buckydeals URLs
    original = body_html
    body_html = re.sub(
        r'<img[^>]*(?:alicdn\.com|buckydeals\.com)[^>]*>',
        '', body_html, flags=re.IGNORECASE
    )
    # Clean up empty paragraphs left behind
    body_html = re.sub(r'<p>\s*</p>', '', body_html)
    changed = body_html != original
    return body_html, changed

def generate_alt_text(product_title, image_position, total_images):
    """Generate descriptive alt text for product images"""
    if image_position == 1:
        return f"{product_title} - Main Product Image"
    elif image_position == 2:
        return f"{product_title} - Alternate View"
    elif image_position <= total_images:
        return f"{product_title} - Image {image_position} of {total_images}"
    return product_title

# === MAIN ===
print(f"{'[DRY RUN] ' if DRY_RUN else ''}Starting product cleanup...")
print(f"Shop: {SHOP}")
print()

# Fetch all products
print("Fetching products...")
all_products = []
params = "limit=250"
while True:
    result = api_request("GET", f"/products.json?{params}")
    if not result:
        break
    products = result.get("products", [])
    if not products:
        break
    all_products.extend(products)
    # Check for pagination
    # Shopify uses link headers but we'll just paginate by since_id
    if len(products) < 250:
        break
    last_id = products[-1]["id"]
    params = f"limit=250&since_id={last_id}"

print(f"Found {len(all_products)} products")
print()

# Process each product
stats = {"tags_cleaned": 0, "types_set": 0, "descs_cleaned": 0, "alts_added": 0, "errors": 0}

for i, product in enumerate(all_products):
    pid = product["id"]
    title = product["title"]
    changes = {}

    # 1. Clean tags
    old_tags = product.get("tags", "")
    if isinstance(old_tags, str):
        tag_list = [t.strip() for t in old_tags.split(",") if t.strip()]
    else:
        tag_list = old_tags
    
    new_tags, removed = clean_tags(tag_list)
    if removed:
        changes["tags"] = ", ".join(new_tags)
        stats["tags_cleaned"] += len(removed)
        print(f"[{i+1}/{len(all_products)}] {title[:50]}")
        for r in removed[:5]:
            print(f"  Removing: {r}")
        if len(removed) > 5:
            print(f"  ... and {len(removed)-5} more")

    # 2. Set product_type if empty
    ptype = product.get("product_type", "")
    if not ptype.strip():
        new_type = classify_product_type(title, tag_list)
        changes["product_type"] = new_type
        stats["types_set"] += 1
        print(f"  Setting type: {new_type}")

    # 3. Clean description
    body = product.get("body_html", "")
    new_body, desc_changed = clean_description(body)
    if desc_changed:
        changes["body_html"] = new_body
        stats["descs_cleaned"] += 1
        print(f"  Removing supplier images from description")

    # Apply product changes
    if changes and not DRY_RUN:
        result = api_request("PUT", f"/products/{pid}.json", {"product": {"id": pid, **changes}})
        if not result:
            stats["errors"] += 1
        time.sleep(0.5)  # Rate limiting

    # 4. Fix image alt text (separate API calls)
    images = product.get("images", [])
    for img in images:
        if not img.get("alt"):
            alt = generate_alt_text(title, img["position"], len(images))
            stats["alts_added"] += 1
            if not DRY_RUN:
                api_request("PUT", f"/products/{pid}/images/{img['id']}.json",
                           {"image": {"id": img["id"], "alt": alt}})
                time.sleep(0.3)  # Rate limiting

print()
print(f"=== CLEANUP COMPLETE ===")
print(f"Tags removed: {stats['tags_cleaned']}")
print(f"Product types set: {stats['types_set']}")
print(f"Descriptions cleaned: {stats['descs_cleaned']}")
print(f"Image alt text added: {stats['alts_added']}")
print(f"Errors: {stats['errors']}")
if DRY_RUN:
    print("\n[DRY RUN] No changes were made. Remove --dry-run to apply.")
