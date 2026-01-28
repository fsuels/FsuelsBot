import urllib.request, json

# Fetch all products (paginated)
all_products = []
page = 1
while True:
    url = f"https://www.dresslikemommy.com/products.json?limit=250&page={page}"
    with urllib.request.urlopen(url) as resp:
        data = json.loads(resp.read())
    prods = data.get("products", [])
    if not prods:
        break
    all_products.extend(prods)
    page += 1

# Save for later use
with open("C:/Users/Fsuels/clawd/mission-control/products-raw.json", "w", encoding="utf-8") as f:
    json.dump(all_products, f, indent=2)

# Analyze issues
total = len(all_products)
supplier_url_count = 0
supplier_url_products = []
size_tag_count = 0
empty_type_count = 0
alicdn_count = 0
null_alt_count = 0
total_images = 0
all_tags = {}

size_keywords = [
    "adult s", "adult m", "adult l", "adult xl", "adult 2xl", "adult 3xl", "adult 4xl",
    "mother xs", "mother s", "mother m", "mother l", "mother xl",
    "father l", "father m", "father xl", "father 2xl",
    "baby 6m", "baby 12m", "baby 18m", "baby 24m",
    "child 1-2yr", "child 3-4yr", "child 5-6yr", "child 7-8yr", "child 9-10yr", "child 11-12yr"
]

for p in all_products:
    raw_tags = p.get("tags", [])
    tags = [t.strip() for t in raw_tags.split(",")] if isinstance(raw_tags, str) else raw_tags
    for t in tags:
        all_tags[t] = all_tags.get(t, 0) + 1

    # Supplier URLs
    url_tags = [t for t in tags if "1688.com" in t or "taobao" in t or "alicdn" in t]
    if url_tags:
        supplier_url_count += len(url_tags)
        supplier_url_products.append(p["title"][:60])

    # Size tags
    for t in tags:
        if t.lower() in size_keywords:
            size_tag_count += 1

    # Empty product_type
    if not (p.get("product_type") or "").strip():
        empty_type_count += 1

    # Alicdn in description
    body = p.get("body_html") or ""
    if "alicdn" in body or "buckydeals" in body:
        alicdn_count += 1

    # Null alt images
    for img in p.get("images", []):
        total_images += 1
        if not img.get("alt"):
            null_alt_count += 1

print(f"=== PRODUCT AUDIT RESULTS ===")
print(f"Total products: {total}")
print(f"")
print(f"CRITICAL ISSUES:")
print(f"  Supplier URL tags (1688/taobao): {supplier_url_count} tags across {len(supplier_url_products)} products")
print(f"  Size-as-tags to remove: {size_tag_count}")
print(f"  Empty product_type: {empty_type_count} / {total}")
print(f"  Alicdn/BuckyDeals images in descriptions: {alicdn_count} / {total}")
print(f"  Images missing alt text: {null_alt_count} / {total_images}")
print(f"")
print(f"UNIQUE TAGS ({len(all_tags)} total):")
for tag, count in sorted(all_tags.items(), key=lambda x: -x[1])[:30]:
    flag = ""
    if "1688" in tag or "taobao" in tag:
        flag = " ⚠️ SUPPLIER URL"
    elif tag.lower() in size_keywords:
        flag = " ⚠️ SIZE TAG"
    print(f"  [{count:3d}] {tag}{flag}")
print(f"  ... and {len(all_tags) - 30} more")
