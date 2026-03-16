"""
Generate comprehensive Shopify redirect CSV for ALL locale-prefixed URLs.
When Shopify had International/Eurozone markets active, it created URLs like:
/en-se/collections/dresses, /en-hk/products/..., /en-be/pages/about-us, etc.
These markets were deactivated Jan 26, 2026 — all these URLs now 404.
"""
import csv
import json

# All ISO 3166-1 alpha-2 country codes that were likely in the markets
# International market had ~131 regions, Eurozone ~43
# Common ones Google has likely indexed:
locale_prefixes = [
    # Nordic / European (likely high crawl rate)
    "en-se", "en-dk", "en-fi", "en-no", "en-nl", "en-be", "en-at", "en-ch",
    "en-de", "en-fr", "en-es", "en-it", "en-pt", "en-pl", "en-cz", "en-ie",
    "en-gr", "en-ro", "en-bg", "en-hr", "en-hu", "en-sk", "en-si", "en-lt",
    "en-lv", "en-ee", "en-lu", "en-mt", "en-cy",
    # Asia-Pacific
    "en-hk", "en-sg", "en-my", "en-ph", "en-th", "en-vn", "en-id", "en-tw",
    "en-kr", "en-jp", "en-in", "en-pk", "en-bd", "en-lk", "en-np",
    "en-nz",  # NZ might have its own market but was in International
    # Middle East
    "en-ae", "en-sa", "en-qa", "en-kw", "en-bh", "en-om", "en-il", "en-jo",
    "en-lb", "en-tr",
    # Africa
    "en-za", "en-ng", "en-ke", "en-gh", "en-eg", "en-ma", "en-tz",
    # Americas (outside US/CA/AU which have their own markets)
    "en-mx", "en-br", "en-ar", "en-cl", "en-co", "en-pe",
    # Caribbean
    "en-jm", "en-tt", "en-bb", "en-bs",
    # Other European
    "en-is", "en-rs", "en-ua", "en-by", "en-md",
    # French locales (Eurozone)
    "fr", "fr-be", "fr-ch", "fr-lu", "fr-ca",
    # German locales
    "de", "de-at", "de-ch",
    # Spanish locales
    "es", "es-mx", "es-ar",
    # Other language locales
    "it", "pt", "pt-br", "nl", "nl-be", "pl", "sv", "da", "fi", "nb", "cs",
]

# Known collections from DLM sitemap
collections = [
    "dresses", "tops", "headbands", "pajamas", "swimsuits", "sweaters",
    "family-matching", "maxi-dresses", "jumpsuits", "midi-dresses",
    "mini-dresses", "rompers", "sundresses", "combinations", "bottoms",
    "skirts", "leggings", "pants", "matching-outfits", "accessories",
    "trunks", "family-pajamas", "family-tops", "family-sets",
    "family-sweaters", "new-matching-outfits", "family-matching-pajamas",
    "daddy-me-shorts", "fathers-day-matching",
    "mommy-and-me", "daddy-and-me", "couples", "maternity",
    "christmas-matching-outfits", "new-arrivals", "all",
    "mother-daughter-swimsuits", "coats-sweaters",
]

# Known pages
pages = [
    "pages/about-us", "pages/contact-us", "pages/faq",
    "pages/shipping-policy", "pages/refund-policy", "pages/privacy-policy",
    "pages/terms-of-service", "pages/size-guide",
]

# Other paths
other_paths = [
    "cart", "account", "account/login", "account/register",
    "search", "collections", "blogs/news",
]

# Load existing redirects to avoid duplicates
existing = set()
for csv_file in ['mission-control/shopify-redirects.csv']:
    try:
        with open(csv_file, 'r') as f:
            reader = csv.reader(f)
            next(reader)
            for row in reader:
                existing.add(row[0])
    except Exception:
        pass

print(f"Existing redirects: {len(existing)}")

# Generate redirects
redirects = []

for locale in locale_prefixes:
    # Root locale path
    from_path = f"/{locale}"
    if from_path not in existing:
        redirects.append((from_path, "/"))
    
    # Collections
    for col in collections:
        from_path = f"/{locale}/collections/{col}"
        to_path = f"/collections/{col}"
        if from_path not in existing:
            redirects.append((from_path, to_path))
    
    # Pages
    for page in pages:
        from_path = f"/{locale}/{page}"
        to_path = f"/{page}"
        if from_path not in existing:
            redirects.append((from_path, to_path))
    
    # Other paths
    for path in other_paths:
        from_path = f"/{locale}/{path}"
        to_path = f"/{path}"
        if from_path not in existing:
            redirects.append((from_path, to_path))

# Deduplicate
seen = set()
unique = []
for from_url, to_url in redirects:
    if from_url not in seen and from_url != to_url:
        seen.add(from_url)
        unique.append((from_url, to_url))

print(f"New redirects generated: {len(unique)}")
print(f"Locale prefixes used: {len(locale_prefixes)}")
print(f"Paths per locale: {len(collections) + len(pages) + len(other_paths) + 1}")

# Shopify has a limit of 200,000 URL redirects total
# And CSV import limit of ~1000 per batch
# Let's split into batches of 1000

batch_size = 1000
batches = [unique[i:i+batch_size] for i in range(0, len(unique), batch_size)]

for i, batch in enumerate(batches):
    output = f'mission-control/shopify-redirects-batch{i+2}.csv'
    with open(output, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['Redirect from', 'Redirect to'])
        for from_url, to_url in sorted(batch):
            writer.writerow([from_url, to_url])
    print(f"Batch {i+2}: {len(batch)} redirects -> {output}")

print(f"\nTotal new redirects across {len(batches)} batches: {len(unique)}")
print(f"Combined with existing {len(existing)}: {len(unique) + len(existing)} total")
