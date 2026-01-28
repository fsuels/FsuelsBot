"""
Generate Shopify redirect CSV for DressLikeMommy.com
Based on known broken URL patterns from Google Search Console
"""
import csv
import os

redirects = []

# Known collections from sitemap
collections = [
    "dresses", "tops", "headbands", "pajamas", "swimsuits", "sweaters",
    "family-matching", "maxi-dresses", "jumpsuits", "midi-dresses",
    "mini-dresses", "rompers", "sundresses", "combinations", "bottoms",
    "skirts", "leggings", "pants", "matching-outfits", "accessories",
    "trunks", "family-pajamas", "family-tops", "family-sets",
    "family-sweaters", "new-matching-outfits", "family-matching-pajamas",
    "daddy-me-shorts", "fathers-day-matching",
]

# Known locales that generate 404s
locales = ["en-se", "en-hk", "en-be"]

# Pattern 1: Locale-prefixed collection URLs → remove locale
for locale in locales:
    # Root locale
    redirects.append((f"/{locale}", "/"))
    # Collections
    for col in collections:
        redirects.append((f"/{locale}/collections/{col}", f"/collections/{col}"))

# Pattern 2: Locale-prefixed pages
locale_pages = [
    "pages/about-us", "pages/contact-us", "pages/faq",
    "pages/shipping-policy", "pages/refund-policy", "pages/privacy-policy",
    "pages/terms-of-service", "pages/size-guide",
]
for locale in locales:
    for page in locale_pages:
        redirects.append((f"/{locale}/{page}", f"/{page}"))

# Pattern 3: Old collection handles → current collection handles
old_collections = {
    "family-matching-pajamas": "family-pajamas",
    "daddy-me-shorts": "trunks",
    "new-matching-outfits": "matching-outfits",
    "family-matching-christmas-pajamas": "family-pajamas",
    "holiday-matching-outfits": "family-matching",
    "christmas-matching-outfits": "family-matching",
    "valentines-day-matching": "matching-outfits",
    "easter-matching-outfits": "matching-outfits",
    "halloween-matching": "matching-outfits",
    "matching-swimwear": "swimsuits",
    "matching-dresses": "dresses",
    "mother-daughter-dresses": "dresses",
    "mother-daughter-matching": "matching-outfits",
    "mommy-and-me": "matching-outfits",
    "mommy-me": "matching-outfits",
    "mom-and-daughter": "matching-outfits",
    "family-matching-outfits": "family-matching",
    "matching-family-outfits": "family-matching",
}
for old, new in old_collections.items():
    redirects.append((f"/collections/{old}", f"/collections/{new}"))
    # Also add locale-prefixed versions
    for locale in locales:
        redirects.append((f"/{locale}/collections/{old}", f"/collections/{new}"))

# Pattern 4: Known discontinued product → collection redirects
discontinued_products = {
    "family-matching-christmas-deer-pajamas-sets": "/collections/family-pajamas",
    "family-matching-christmas-fair-isle-pajamas-red-white-holiday-reindeer-pajama-set-for-kids-and-adults": "/collections/family-pajamas",
    "family-matching-outfits-sweatshirt-hooded-sweater": "/collections/sweaters",
    "family-match-stripe-print-pajama-warm-sleepwear": "/collections/family-pajamas",
    "matching-christmas-pajamas-deer-plaid-set": "/collections/family-pajamas",
    "daddy-me-pilot-co-pilot": "/collections/family-matching",
    "daddy-and-me-me-mini-me-t-shirt": "/collections/family-matching",
}
for product, target in discontinued_products.items():
    redirects.append((f"/products/{product}", target))
    for locale in locales:
        redirects.append((f"/{locale}/products/{product}", target))

# Deduplicate
seen = set()
unique_redirects = []
for from_url, to_url in redirects:
    if from_url not in seen and from_url != to_url:
        seen.add(from_url)
        unique_redirects.append((from_url, to_url))

# Write CSV
output_path = os.path.join(os.path.dirname(__file__), "shopify-redirects.csv")
with open(output_path, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["Redirect from", "Redirect to"])
    for from_url, to_url in sorted(unique_redirects):
        writer.writerow([from_url, to_url])

print(f"Generated {len(unique_redirects)} redirects -> {output_path}")
