import urllib.request
import json

# Check a few products for actual availability
test_urls = [
    "https://www.dresslikemommy.com/products/mommy-and-me-matching-floral-long-sleeve-maxi-dresses-with-pockets.json",
    "https://www.dresslikemommy.com/products/matching-outfit-mother-daughter-chiffon-dress.json",
    "https://www.dresslikemommy.com/products/family-matching-colorful-sweater-dad-mother-son-daughter.json",
    "https://www.dresslikemommy.com/products/father-and-child-pilot-co-pilot-matching-t-shirt-set-perfect-for-daddy-me-outfits.json",
    "https://www.dresslikemommy.com/products/matching-family-christmas-pajamas-snowflake-nordic-holiday-pj-set-for-all-ages.json",
]

for url in test_urls:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        product = data['product']
        variants = product.get('variants', [])
        available_count = sum(1 for v in variants if v.get('available', False))
        total = len(variants)
        slug = url.split('/products/')[-1].replace('.json', '')[:50]
        print(f"{slug}:")
        print(f"  Variants: {total}, Available: {available_count}")
        if available_count == 0:
            print(f"  ** ALL SOLD OUT **")
        else:
            print(f"  In stock")
    except Exception as e:
        print(f"  Error: {e}")
