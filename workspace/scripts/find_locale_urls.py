"""
Find all locale-prefixed URLs in sitemap that need redirects.
These are from deactivated international markets (131 regions).
"""
import json
import csv
import re

# Load sitemap data
with open('mission-control/sitemap_data.json', 'r') as f:
    data = json.load(f)

urls = data['all_urls']
base = 'https://www.dresslikemommy.com/'

# Find all locale prefixes (format: en-xx where xx is country code)
locales = set()
for u in urls:
    path = u.replace(base, '')
    parts = path.split('/')
    if len(parts) > 0:
        first = parts[0]
        # Match patterns like en-se, en-hk, en-be, fr, de, etc.
        if re.match(r'^[a-z]{2}(-[a-z]{2})?$', first) and first not in ('en', ):
            locales.add(first)

print(f"Total sitemap URLs: {len(urls)}")
print(f"Locale prefixes found: {sorted(locales)}")

# Count locale URLs
locale_urls = []
for u in urls:
    path = u.replace(base, '')
    for locale in locales:
        if path.startswith(locale + '/') or path == locale:
            locale_urls.append(u)
            break

print(f"Locale-prefixed URLs: {len(locale_urls)}")

# Load existing redirects to avoid duplicates
existing = set()
try:
    with open('mission-control/shopify-redirects.csv', 'r') as f:
        reader = csv.reader(f)
        next(reader)  # skip header
        for row in reader:
            existing.add(row[0])
except Exception:
    pass

print(f"Existing redirects: {len(existing)}")

# Generate new redirects
new_redirects = []
for u in locale_urls:
    path = u.replace(base, '')
    # Strip the locale prefix to get the canonical path
    for locale in sorted(locales, key=len, reverse=True):
        if path.startswith(locale + '/'):
            canonical = path[len(locale)+1:]
            from_path = '/' + path
            to_path = '/' + canonical
            if from_path not in existing and from_path != to_path:
                new_redirects.append((from_path, to_path))
            break
        elif path == locale:
            from_path = '/' + path
            to_path = '/'
            if from_path not in existing:
                new_redirects.append((from_path, to_path))
            break

# Deduplicate
seen = set()
unique = []
for from_url, to_url in new_redirects:
    if from_url not in seen:
        seen.add(from_url)
        unique.append((from_url, to_url))

print(f"New redirects to create: {len(unique)}")

# Show sample
for from_url, to_url in unique[:20]:
    print(f"  {from_url} -> {to_url}")

# Write CSV
output = 'mission-control/shopify-redirects-batch2.csv'
with open(output, 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f)
    writer.writerow(['Redirect from', 'Redirect to'])
    for from_url, to_url in sorted(unique):
        writer.writerow([from_url, to_url])

print(f"\nSaved to {output}")
