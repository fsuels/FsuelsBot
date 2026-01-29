import csv
import re

# Words to remove (order matters - remove longer phrases first)
FILLER_PHRASES = [
    "Family Matching ", "Matching Family ", "Matching ",
    "Mommy and Me ", "Mommy & Me ", "Mother and Daughter ", "Mother & Daughter ",
    "Mother-Daughter ", "Father and Son ", "Father & Son ", "Father and Child ",
    "Father & Child ", "Father and Baby ", "Father & Baby ", "Daddy and Baby ",
    "Daddy & Baby ", "Daddy & Me ", "Daddy and Me ", "Mom and Daughter ",
    "for the Whole Family", "for Parents and Kids", "for Mom and Kids",
    "for Mother and Daughter", "for Mother & Daughter", "for Mom and Daughter",
    "for Women and Girls", "for Adults and Kids", "for Kids and Adults",
    "Family Beachwear Set", "Family Beachwear", "Family Swimwear",
    "Perfect for ", "Ideal for ", "Great for ",
    "Available in ", "Comes in ",
]

FILLER_WORDS = [
    "Elegant ", "Chic ", "Stylish ", "Vibrant ", "Festive ", "Cozy ",
    "Adorable ", "Cute ", "Fun ", "Playful ", "Modern ", "Classic ",
    "Trendy ", "Unique ", "Beautiful ", "Gorgeous ", "Lovely ",
    "Exquisite ", "Radiant ", "Enchanting ", "Charming ",
    "with Comfort Stretch", "with Playful ", "with Elegant ",
    "Quick Dry ", "Quick-Dry ",
]

SUFFIX = " | DLM"
MAX_LEN = 60
MAX_CONTENT_LEN = MAX_LEN - len(SUFFIX)  # 54 chars for content

def smart_shorten(title):
    """Shorten title intelligently without using ..."""
    result = title
    
    # Remove filler phrases first
    for phrase in FILLER_PHRASES:
        result = result.replace(phrase, "")
    
    # Remove filler words
    for word in FILLER_WORDS:
        result = result.replace(word, "")
    
    # Clean up double spaces and dashes
    result = re.sub(r'\s+', ' ', result)
    result = re.sub(r'\s*[-–—]\s*[-–—]\s*', ' - ', result)
    result = re.sub(r'\s*[-–—]\s*$', '', result)
    result = re.sub(r'^\s*[-–—]\s*', '', result)
    result = result.strip()
    
    # If still too long, try more aggressive cuts
    if len(result) > MAX_CONTENT_LEN:
        # Remove "Set" at end
        result = re.sub(r'\s+Set$', '', result)
    
    if len(result) > MAX_CONTENT_LEN:
        # Remove color descriptions in parentheses or after "in"
        result = re.sub(r'\s+in\s+\w+(\s+and\s+\w+)*(\s+&\s+\w+)*$', '', result)
        result = re.sub(r'\s+in\s+\w+,?\s+\w+,?\s+(and|&)\s+\w+$', '', result)
    
    if len(result) > MAX_CONTENT_LEN:
        # Remove "for [audience]" at end
        result = re.sub(r'\s+for\s+[\w\s&,]+$', '', result)
    
    if len(result) > MAX_CONTENT_LEN:
        # Remove "with [feature]" at end
        result = re.sub(r'\s+with\s+[\w\s&,]+$', '', result)
    
    if len(result) > MAX_CONTENT_LEN:
        # Last resort: truncate at last space before limit (no ...)
        if len(result) > MAX_CONTENT_LEN:
            cut_point = result[:MAX_CONTENT_LEN].rfind(' ')
            if cut_point > 20:  # Don't cut too short
                result = result[:cut_point]
            else:
                result = result[:MAX_CONTENT_LEN]
    
    result = result.strip()
    result = re.sub(r'\s*[-–—]\s*$', '', result)  # Clean trailing dash
    
    return result + SUFFIX

# Read original export and create new titles
input_file = r'C:\dev\FsuelsBot\workspace\mission-control\seo-title-review.csv'
output_import = r'C:\dev\FsuelsBot\workspace\mission-control\seo-title-import-v2.csv'
output_review = r'C:\dev\FsuelsBot\workspace\mission-control\seo-title-review-v2.csv'

results = []
with open(input_file, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        handle = row['Handle']
        original_title = row['Title']
        new_title = smart_shorten(original_title)
        
        results.append({
            'handle': handle,
            'original': original_title,
            'new_title': new_title,
            'orig_len': len(original_title),
            'new_len': len(new_title)
        })

# Write import CSV (Shopify format)
with open(output_import, 'w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['Handle', 'SEO Title'])
    for r in results:
        writer.writerow([r['handle'], r['new_title']])

# Write review CSV
with open(output_review, 'w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['Handle', 'Original Title', 'New SEO Title', 'Orig Len', 'New Len'])
    for r in results:
        writer.writerow([r['handle'], r['original'], r['new_title'], r['orig_len'], r['new_len']])

# Stats
total = len(results)
under_60 = sum(1 for r in results if r['new_len'] <= 60)
has_ellipsis = sum(1 for r in results if '...' in r['new_title'])
print(f"Total: {total}")
print(f"Under 60 chars: {under_60}")
print(f"Has ellipsis: {has_ellipsis}")
print(f"Success rate: {under_60/total*100:.1f}%")

# Show any that are still too long
too_long = [r for r in results if r['new_len'] > 60]
if too_long:
    print(f"\nStill too long ({len(too_long)}):")
    for r in too_long[:5]:
        print(f"  {r['new_len']}: {r['new_title']}")
