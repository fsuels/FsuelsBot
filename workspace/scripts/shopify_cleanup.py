"""
Shopify Product Cleanup Script for DressLikeMommy.com
Applies SEO optimizations from seo-optimized-products.json via Shopify Admin API.

REQUIRES: SHOPIFY_ACCESS_TOKEN environment variable
  - Create in Shopify Admin > Settings > Apps > Develop apps
  - Scopes needed: write_products, read_products

Usage:
  set SHOPIFY_ACCESS_TOKEN=shpat_xxxxx
  python scripts/shopify_cleanup.py --dry-run    # Preview changes
  python scripts/shopify_cleanup.py              # Apply changes
  python scripts/shopify_cleanup.py --batch 50   # Process 50 at a time
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

SHOP = "dresslikemommy-com.myshopify.com"
API_VERSION = "2024-10"
BASE_URL = f"https://{SHOP}/admin/api/{API_VERSION}"

def get_token():
    token = os.environ.get("SHOPIFY_ACCESS_TOKEN")
    if not token:
        print("ERROR: Set SHOPIFY_ACCESS_TOKEN environment variable first!")
        print("  Go to: Shopify Admin > Settings > Apps > Develop apps")
        print("  Create app with scopes: write_products, read_products")
        sys.exit(1)
    return token

def api_request(method, path, data=None, token=None, _retries=3):
    """Make a Shopify Admin API request."""
    url = f"{BASE_URL}{path}"
    headers = {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
    }

    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else ""
        print(f"  API Error {e.code}: {error_body[:200]}")
        if e.code == 429 and _retries > 0:  # Rate limited
            retry_after = float(e.headers.get("Retry-After", 2))
            print(f"  Rate limited, waiting {retry_after}s... ({_retries} retries left)")
            time.sleep(retry_after)
            return api_request(method, path, data, token, _retries - 1)
        return None

def update_product(product_id, updates, token, dry_run=False):
    """Update a single product."""
    if dry_run:
        print(f"  [DRY RUN] Would update product {product_id}")
        for key, val in updates.items():
            if key != "images":
                print(f"    {key}: {str(val)[:80]}")
        return True
    
    result = api_request("PUT", f"/products/{product_id}.json", 
                         {"product": updates}, token)
    if result:
        return True
    return False

def update_image_alt(product_id, image_id, alt_text, token, dry_run=False):
    """Update alt text for a single image."""
    if dry_run:
        return True
    
    result = api_request("PUT", 
                         f"/products/{product_id}/images/{image_id}.json",
                         {"image": {"id": image_id, "alt": alt_text}},
                         token)
    return result is not None

def main():
    # Parse args
    dry_run = "--dry-run" in sys.argv
    batch_size = 340  # default: all
    if "--batch" in sys.argv:
        idx = sys.argv.index("--batch")
        batch_size = int(sys.argv[idx + 1]) if idx + 1 < len(sys.argv) else 50
    
    skip_images = "--skip-images" in sys.argv
    only_types = "--only-types" in sys.argv
    only_tags = "--only-tags" in sys.argv
    only_titles = "--only-titles" in sys.argv
    
    token = get_token()
    
    # Load optimized data
    with open("mission-control/seo-optimized-products.json", "r", encoding="utf-8") as f:
        data = json.load(f)
    
    products = data["products"]
    stats = data["stats"]
    
    print(f"{'DRY RUN - ' if dry_run else ''}Shopify Product Cleanup")
    print(f"{'='*50}")
    print(f"Products to process: {min(batch_size, len(products))}")
    print(f"Changes queued:")
    print(f"  - Types to fix: {stats['empty_type_fixed']}")
    print(f"  - Tags to clean: {stats['supplier_urls_removed']} URLs + {stats['size_tags_removed']} sizes + {stats['color_tags_removed']} colors")
    print(f"  - Titles to improve: {stats['titles_improved']}")
    print()
    
    updated = 0
    skipped = 0
    errors = 0
    images_updated = 0
    
    for i, p in enumerate(products[:batch_size]):
        product_id = p["id"]
        needs_update = False
        updates = {}
        
        # Check what needs updating
        if p["title_changed"] and not only_types and not only_tags:
            updates["title"] = p["optimized_title"]
            needs_update = True
        
        if p["type_changed"] and not only_titles and not only_tags:
            updates["product_type"] = p["optimized_type"]
            needs_update = True
        
        if (p["removed_size_tags"] or p["removed_supplier_urls"] or p["removed_color_tags"]) and not only_titles and not only_types:
            updates["tags"] = p["clean_tags"]
            needs_update = True
        
        # Add meta description as metafield
        if not only_tags and not only_types and not only_titles:
            updates["metafields"] = [{
                "namespace": "global",
                "key": "description_tag",
                "value": p["meta_description"],
                "type": "single_line_text_field"
            }]
            needs_update = True
        
        if not needs_update:
            skipped += 1
            continue
        
        print(f"[{i+1}/{min(batch_size, len(products))}] {p['handle']}")
        
        if "title" in updates:
            print(f"  Title: {p['original_title'][:50]} -> {p['optimized_title'][:50]}")
        if "product_type" in updates:
            print(f"  Type: '{p['original_type']}' -> '{p['optimized_type']}'")
        if "tags" in updates:
            removed = len(p["removed_size_tags"]) + len(p["removed_supplier_urls"]) + len(p["removed_color_tags"])
            print(f"  Tags: removing {removed} junk tags")
        
        success = update_product(product_id, updates, token, dry_run)
        if success:
            updated += 1
        else:
            errors += 1
        
        # Update image alt texts (separate API calls)
        if not skip_images and p["alt_texts"] and not only_types and not only_tags:
            for alt_info in p["alt_texts"][:5]:  # Limit to first 5 images per product
                if alt_info["image_id"] and alt_info["alt"]:
                    img_success = update_image_alt(
                        product_id, alt_info["image_id"], 
                        alt_info["alt"], token, dry_run
                    )
                    if img_success:
                        images_updated += 1
            
            if not dry_run:
                time.sleep(0.5)  # Rate limit buffer
        
        if not dry_run:
            time.sleep(0.3)  # Respect rate limits (2 calls/sec safe zone)
    
    print(f"\n{'='*50}")
    print(f"RESULTS:")
    print(f"  Products updated: {updated}")
    print(f"  Products skipped (no changes): {skipped}")
    print(f"  Errors: {errors}")
    print(f"  Images updated: {images_updated}")
    if dry_run:
        print(f"\n  This was a DRY RUN. Add no flag to apply changes.")

if __name__ == "__main__":
    main()
