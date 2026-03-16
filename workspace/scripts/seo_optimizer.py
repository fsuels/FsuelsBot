"""
SEO Product Optimizer for DressLikeMommy.com
Generates optimized titles, product types, tags, meta descriptions,
and alt text for all 340 products.

Run: python scripts/seo_optimizer.py
Output: mission-control/seo-optimized-products.json
"""
import json
import re
import os

# Load raw product data
with open("mission-control/products-raw.json", "r", encoding="utf-8") as f:
    products = json.load(f)

print(f"Loaded {len(products)} products")

# --Tag cleanup rules --
SIZE_PATTERNS = re.compile(
    r'^(Adult|Mother|Child|Baby|Girl|Boy|Toddler|Kids?|Father|Dad|Daddy|Son|Daughter)\s+'
    r'(XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXL|XXXL|'
    r'\d+M|\d+-\d+M|\d+-\d+yr|\d+-\d+\s*Years?|\d+-\d+T|'
    r'\d+\s*Months?|\d+\s*Years?)$|'
    r'^(XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL|XXL|XXXL|'
    r'\d+M|\d+-\d+M|\d+-\d+yr|\d+-\d+\s*Years?|\d+-\d+T|'
    r'\d+\s*Months?|\d+\s*Years?|One Size|Free Size)$',
    re.IGNORECASE
)
COLOR_TAGS = {
    'Black', 'White', 'Red', 'Blue', 'Pink', 'Green', 'Yellow', 'Purple',
    'Orange', 'Navy', 'Grey', 'Gray', 'Brown', 'Beige', 'Cream', 'Coral',
    'Burgundy', 'Teal', 'Khaki', 'Mint', 'Lavender', 'Ivory', 'Floral',
    'Striped', 'Plaid', 'Leopard', 'Camo', 'Rainbow', 'Multicolor', 'Wine',
    'Hot Pink', 'Light Blue', 'Light Pink', 'Dark Blue', 'Rose', 'Apricot',
    'Coffee', 'Champagne', 'Gold', 'Silver', 'Denim'
}
SUPPLIER_URL = re.compile(r'https?://.*1688\.com.*|https?://.*alicdn.*|https?://.*taobao.*')

# --Product type classification rules --
def classify_product_type(title, tags, existing_type):
    """Assign a product_type based on title and tags."""
    title_lower = title.lower()
    tags_lower = ' '.join(tags).lower() if tags else ''
    combined = title_lower + ' ' + tags_lower
    
    # Check specific types first (more specific before general)
    if any(w in combined for w in ['pajama', 'pyjama', 'loungewear', 'sleepwear', 'nightgown', 'nightwear']):
        return 'Pajamas & Loungewear'
    if any(w in combined for w in ['swimsuit', 'swimwear', 'bikini', 'tankini', 'bathing suit', 'swim', 'beach set']):
        return 'Swimwear'
    if any(w in combined for w in ['sweater', 'knit top', 'cardigan', 'pullover', 'knitwear']):
        return 'Sweaters & Knitwear'
    if any(w in combined for w in ['jumpsuit', 'romper', 'playsuit', 'overall']):
        return 'Jumpsuits & Rompers'
    if any(w in combined for w in ['headband', 'hair', 'bow', 'clip', 'accessori']):
        return 'Accessories'
    if any(w in combined for w in ['legging', 'pants', 'trouser', 'jeans', 'shorts', 'trunk']):
        return 'Bottoms'
    if any(w in combined for w in ['skirt']):
        return 'Skirts'
    if any(w in combined for w in ['t-shirt', 'tee ', ' tee', 'top ', ' top', 'blouse', 'shirt', 'hoodie', 'sweatshirt']):
        return 'Tops'
    if any(w in combined for w in ['maxi dress', 'maxi']):
        return 'Maxi Dresses'
    if any(w in combined for w in ['midi dress', 'midi']):
        return 'Midi Dresses'
    if any(w in combined for w in ['mini dress', 'mini']):
        return 'Mini Dresses'
    if any(w in combined for w in ['sundress', 'sun dress']):
        return 'Sundresses'
    if any(w in combined for w in ['dress', 'gown', 'frock']):
        return 'Dresses'
    if any(w in combined for w in ['set ', ' set', 'outfit', 'combo', 'matching']):
        return 'Matching Sets'
    
    return existing_type or 'Matching Outfits'

# --Title optimization --
def optimize_title(title, product_type):
    """Create SEO-optimized title under 70 chars."""
    # Clean up common issues
    title = re.sub(r'\s+', ' ', title).strip()
    # Remove trailing/leading dashes
    title = title.strip(' -\u2013\u2014')
    
    # Ensure "Mommy and Me" or "Matching" is in the title if not already
    has_matching = any(w in title.lower() for w in ['matching', 'mommy', 'mother', 'daughter', 'family', 'mama'])
    
    if not has_matching and len(title) < 50:
        title = f"Mommy and Me {title}"
    
    # Truncate to 70 chars at word boundary
    if len(title) > 70:
        words = title[:70].rsplit(' ', 1)
        title = words[0] if len(words) > 1 else title[:70]
    
    return title

# --Meta description generator --
def generate_meta_description(title, product_type, tags):
    """Generate a compelling meta description (150-160 chars)."""
    clean_tags = [t for t in tags if not SIZE_PATTERNS.match(t) and not SUPPLIER_URL.match(t)]
    
    # Build description based on product type
    templates = {
        'Pajamas & Loungewear': f"Shop {title} at Dress Like Mommy. Cozy matching family pajamas for mom and kids. Free shipping on orders over $50!",
        'Swimwear': f"Shop {title} at Dress Like Mommy. Adorable matching swimwear for the whole family. Free shipping on orders over $50!",
        'Sweaters & Knitwear': f"Shop {title} at Dress Like Mommy. Warm matching sweaters for mom and kids. Free shipping on orders over $50!",
        'Dresses': f"Shop {title} at Dress Like Mommy. Beautiful matching dresses for mother and daughter. Free shipping on orders over $50!",
        'Maxi Dresses': f"Shop {title} at Dress Like Mommy. Elegant matching maxi dresses for mom and daughter. Free shipping on orders over $50!",
        'Tops': f"Shop {title} at Dress Like Mommy. Cute matching tops for the whole family. Free shipping on orders over $50!",
    }
    
    desc = templates.get(product_type, f"Shop {title} at Dress Like Mommy. Adorable matching outfits for the whole family. Free shipping on orders over $50!")
    
    # Truncate to 160 chars at word boundary
    if len(desc) > 160:
        words = desc[:160].rsplit(' ', 1)
        desc = words[0] if len(words) > 1 else desc[:160]
    
    return desc

# --Alt text generator --
def generate_alt_text(title, variant_index=0):
    """Generate image alt text for product images."""
    # Keep it descriptive but under 125 chars
    alt = f"{title} - Matching Family Outfit | Dress Like Mommy"
    if len(alt) > 125:
        alt = title[:120]
    return alt

# --Process all products --
optimized = []
stats = {
    'total': len(products),
    'empty_type_fixed': 0,
    'supplier_urls_removed': 0,
    'size_tags_removed': 0,
    'color_tags_removed': 0,
    'titles_improved': 0,
    'by_type': {}
}

for p in products:
    pid = p.get('id', '')
    title = p.get('title', '')
    existing_type = p.get('product_type', '')
    raw_tags_val = p.get('tags', '')
    if isinstance(raw_tags_val, list):
        raw_tags = raw_tags_val
    elif isinstance(raw_tags_val, str) and raw_tags_val:
        raw_tags = raw_tags_val.split(', ')
    else:
        raw_tags = []
    images = p.get('images', [])
    handle = p.get('handle', '')
    
    # Clean tags
    clean_tags = []
    removed_sizes = []
    removed_urls = []
    removed_colors = []
    
    for tag in raw_tags:
        tag = tag.strip()
        if not tag:
            continue
        if SUPPLIER_URL.match(tag):
            removed_urls.append(tag)
            stats['supplier_urls_removed'] += 1
            continue
        if SIZE_PATTERNS.match(tag):
            removed_sizes.append(tag)
            stats['size_tags_removed'] += 1
            continue
        if tag in COLOR_TAGS:
            removed_colors.append(tag)
            stats['color_tags_removed'] += 1
            continue
        clean_tags.append(tag)
    
    # Classify product type
    new_type = classify_product_type(title, clean_tags, existing_type)
    if not existing_type and new_type:
        stats['empty_type_fixed'] += 1
    
    # Track type distribution
    stats['by_type'][new_type] = stats['by_type'].get(new_type, 0) + 1
    
    # Optimize title
    new_title = optimize_title(title, new_type)
    if new_title != title:
        stats['titles_improved'] += 1
    
    # Generate meta description
    meta_desc = generate_meta_description(new_title, new_type, clean_tags)
    
    # Generate alt text for images
    alt_texts = []
    for i, img in enumerate(images):
        if i == 0:
            alt = generate_alt_text(new_title)
        else:
            alt = f"{new_title} - View {i+1}"
            if len(alt) > 125:
                alt = f"{title[:100]} - View {i+1}"
        alt_texts.append({
            'image_id': img.get('id', ''),
            'src': img.get('src', ''),
            'alt': alt
        })
    
    optimized.append({
        'id': pid,
        'handle': handle,
        'original_title': title,
        'optimized_title': new_title,
        'title_changed': new_title != title,
        'original_type': existing_type,
        'optimized_type': new_type,
        'type_changed': existing_type != new_type,
        'original_tags': ', '.join(str(t) for t in raw_tags),
        'clean_tags': ', '.join(clean_tags),
        'removed_size_tags': removed_sizes,
        'removed_supplier_urls': removed_urls,
        'removed_color_tags': removed_colors,
        'meta_description': meta_desc,
        'image_count': len(images),
        'alt_texts': alt_texts,
        'url': f"https://dresslikemommy.com/products/{handle}"
    })

# Save results
output_path = "mission-control/seo-optimized-products.json"
with open(output_path, "w", encoding="utf-8") as f:
    json.dump({'stats': stats, 'products': optimized}, f, indent=2)

# Print summary
print(f"\n{'='*60}")
print(f"SEO OPTIMIZATION SUMMARY")
print(f"{'='*60}")
print(f"Total products: {stats['total']}")
print(f"Empty types fixed: {stats['empty_type_fixed']}")
print(f"Supplier URLs to remove: {stats['supplier_urls_removed']}")
print(f"Size tags to remove: {stats['size_tags_removed']}")
print(f"Color tags to remove: {stats['color_tags_removed']}")
print(f"Titles improved: {stats['titles_improved']}")
print(f"\nProduct Type Distribution:")
for ptype, count in sorted(stats['by_type'].items(), key=lambda x: -x[1]):
    print(f"  {ptype}: {count}")
print(f"\nOutput saved to: {output_path}")

# Generate sample of changes for review
print(f"\n{'='*60}")
print(f"SAMPLE CHANGES (first 10 with differences)")
print(f"{'='*60}")
shown = 0
for p in optimized:
    if shown >= 10:
        break
    if p['title_changed'] or p['type_changed'] or p['removed_supplier_urls']:
        print(f"\n--- Product: {p['handle']}")
        if p['title_changed']:
            print(f"  Title: {p['original_title']}")
            print(f"  -> New:  {p['optimized_title']}")
        if p['type_changed']:
            print(f"  Type: '{p['original_type']}' -> '{p['optimized_type']}'")
        if p['removed_supplier_urls']:
            print(f"  Removing URLs: {p['removed_supplier_urls']}")
        if p['removed_size_tags']:
            print(f"  Removing {len(p['removed_size_tags'])} size tags")
        print(f"  Meta: {p['meta_description'][:80]}...")
        shown += 1

