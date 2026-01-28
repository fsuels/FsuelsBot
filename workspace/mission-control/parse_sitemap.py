import urllib.request
import xml.etree.ElementTree as ET
import json
import csv

# Fetch the sitemap
url = "https://www.dresslikemommy.com/sitemap_products_1.xml?from=6506499013&to=7462249955425"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req) as response:
    xml_data = response.read()

print(f"Fetched {len(xml_data)} bytes")

# Save raw XML
with open("mission-control/sitemap_raw.xml", "wb") as f:
    f.write(xml_data)

# Parse XML
root = ET.fromstring(xml_data)
ns = {
    'sm': 'http://www.sitemaps.org/schemas/sitemap/0.9',
    'image': 'http://www.google.com/schemas/sitemap-image/1.1'
}

products = []
empty_captions = []
all_urls = []

for url_elem in root.findall('sm:url', ns):
    loc = url_elem.find('sm:loc', ns)
    if loc is None:
        continue
    url_text = loc.text.strip()
    
    # Skip non-product URLs
    if '/products/' not in url_text:
        continue
    
    all_urls.append(url_text)
    
    images = url_elem.findall('image:image', ns)
    product_info = {
        'url': url_text,
        'images': [],
        'has_empty_caption': False
    }
    
    for img in images:
        img_loc = img.find('image:loc', ns)
        img_title = img.find('image:title', ns)
        img_caption = img.find('image:caption', ns)
        
        caption_text = img_caption.text.strip() if img_caption is not None and img_caption.text else ''
        title_text = img_title.text.strip() if img_title is not None and img_title.text else ''
        
        img_info = {
            'loc': img_loc.text.strip() if img_loc is not None and img_loc.text else '',
            'title': title_text,
            'caption': caption_text
        }
        product_info['images'].append(img_info)
        
        if not caption_text:
            product_info['has_empty_caption'] = True
            empty_captions.append({
                'product_url': url_text,
                'image_url': img_info['loc'],
                'image_title': title_text
            })
    
    products.append(product_info)

print(f"\n=== SITEMAP SUMMARY ===")
print(f"Total product URLs: {len(all_urls)}")
print(f"Products with images: {len(products)}")
print(f"Products with EMPTY image captions: {len([p for p in products if p['has_empty_caption']])}")
print(f"Total empty captions: {len(empty_captions)}")

print(f"\n=== PRODUCTS WITH EMPTY CAPTIONS (Missing Alt Text) ===")
for ec in empty_captions:
    print(f"  URL: {ec['product_url']}")
    print(f"  Image Title: {ec['image_title']}")
    print()

# Check for poor/generic titles (URLs containing years or very generic terms)
poor_title_indicators = ['2016', '2017', '2018', '2019', '2020', 'new-', 'casual-family-matching-outfits-mother']
poor_titles = []
for p in products:
    url_slug = p['url'].split('/products/')[-1] if '/products/' in p['url'] else ''
    for indicator in poor_title_indicators:
        if indicator in url_slug.lower():
            poor_titles.append(p['url'])
            break

print(f"\n=== PRODUCTS WITH POTENTIALLY POOR/GENERIC URLs ===")
for pt in poor_titles:
    print(f"  {pt}")

# Save data for further analysis
with open("mission-control/sitemap_data.json", "w") as f:
    json.dump({
        'total_products': len(all_urls),
        'products': products,
        'empty_captions': empty_captions,
        'poor_title_urls': poor_titles,
        'all_urls': all_urls
    }, f, indent=2)

print(f"\nData saved to mission-control/sitemap_data.json")
print(f"\n=== ALL PRODUCT URLs ===")
for i, u in enumerate(all_urls):
    print(f"  {i+1}. {u}")
