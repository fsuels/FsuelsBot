import urllib.request
import json
import time

# Load all URLs
with open("mission-control/sitemap_data.json") as f:
    data = json.load(f)

urls = data['all_urls']
in_stock = []
out_of_stock = []
errors = []

# Check a larger sample - every 10th product
sample = urls[::10]  # every 10th
print(f"Checking {len(sample)} products (every 10th of {len(urls)})...")

for i, url in enumerate(sample):
    json_url = url + '.json'
    try:
        req = urllib.request.Request(json_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            pdata = json.loads(resp.read())
        product = pdata['product']
        variants = product.get('variants', [])
        available_count = sum(1 for v in variants if v.get('available', False))
        
        slug = url.split('/products/')[-1][:50]
        if available_count > 0:
            in_stock.append(url)
            print(f"  [{i+1}] IN STOCK: {slug} ({available_count}/{len(variants)} variants)")
        else:
            out_of_stock.append(url)
    except Exception as e:
        errors.append(url)
    time.sleep(0.3)

print(f"\n=== AVAILABILITY SUMMARY ===")
print(f"Checked: {len(sample)} products")
print(f"In stock: {len(in_stock)}")
print(f"Out of stock: {len(out_of_stock)}")
print(f"Errors: {len(errors)}")

if len(in_stock) == 0:
    print(f"\n*** CRITICAL: ALL {len(sample)} sampled products are SOLD OUT ***")
    print(f"*** This means likely ALL {len(urls)} products are sold out ***")
    print(f"*** Pinterest WILL REJECT a merchant with no available products ***")
