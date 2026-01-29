"""
Generate SEO-optimized titles for Shopify products
Formula: [Short Product Name] - Mommy and Me | DLM (50-60 chars max)
"""
import json
import csv

# Load products
with open('C:/dev/FsuelsBot/workspace/mission-control/products-raw.json', 'r', encoding='utf-8') as f:
    products = json.load(f)

def create_seo_title(title, max_len=60):
    """Create an SEO-optimized title from product title"""
    # Remove common redundant phrases
    title = title.replace(' – ', ' - ')
    title = title.replace('Family Matching ', '')
    title = title.replace('Matching Family ', '')
    title = title.replace('Mommy and Me ', '')
    title = title.replace('Mom and Daughter ', '')
    title = title.replace(' for Mom and Kids', '')
    title = title.replace(' for Mom, Daughter, and Siblings', '')
    title = title.replace(' - Family Matching Outfits', '')
    
    # Clean up double spaces
    while '  ' in title:
        title = title.replace('  ', ' ')
    title = title.strip()
    
    # Add brand suffix
    suffix = ' | Mommy and Me | DLM'
    if len(title) + len(suffix) <= max_len:
        return title + suffix
    
    # If too long, use shorter suffix
    suffix = ' | DLM'
    if len(title) + len(suffix) <= max_len:
        return title + suffix
    
    # If still too long, truncate title
    max_title_len = max_len - len(suffix) - 3  # -3 for "..."
    return title[:max_title_len] + '...' + suffix

# Process all products
output_rows = []
for p in products:
    original_title = p.get('title', '')
    handle = p.get('handle', '')
    
    if len(original_title) > 60:
        seo_title = create_seo_title(original_title)
        output_rows.append({
            'Handle': handle,
            'Title': original_title,
            'SEO Title': seo_title,
            'Original Length': len(original_title),
            'SEO Length': len(seo_title)
        })

# Write CSV for Shopify import
with open('C:/dev/FsuelsBot/workspace/mission-control/seo-title-import.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f)
    writer.writerow(['Handle', 'SEO Title'])
    for row in output_rows:
        writer.writerow([row['Handle'], row['SEO Title']])

# Write detailed review file
with open('C:/dev/FsuelsBot/workspace/mission-control/seo-title-review.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=['Handle', 'Title', 'SEO Title', 'Original Length', 'SEO Length'])
    writer.writeheader()
    writer.writerows(output_rows)

print(f"Generated {len(output_rows)} SEO title fixes")
print(f"Import file: seo-title-import.csv")
print(f"Review file: seo-title-review.csv")
print()
print("Sample fixes:")
for row in output_rows[:10]:
    print(f"  {row['Original Length']}→{row['SEO Length']}: {row['SEO Title']}")
