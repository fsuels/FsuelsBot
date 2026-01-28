import urllib.request, re

req = urllib.request.Request('https://dresslikemommy.com', headers={'User-Agent': 'Mozilla/5.0'})
html = urllib.request.urlopen(req).read().decode('utf-8', errors='ignore')

# Find all link tags with icon
icons = re.findall(r'<link[^>]*rel=["\'](?:[^"\']*icon[^"\']*)["\'][^>]*>', html, re.IGNORECASE)
for icon in icons:
    print("ICON:", icon)

# Find og:image
og = re.findall(r'content=["\']([^"\']+)["\'][^>]*property=["\']og:image["\']|property=["\']og:image["\'][^>]*content=["\']([^"\']+)["\']', html, re.IGNORECASE)
for o in og:
    print("OG:", o[0] or o[1])

# Try to download any found icons
hrefs = re.findall(r'href=["\']([^"\']+)["\']', ' '.join(icons))
for i, href in enumerate(hrefs):
    if not href.startswith('http'):
        href = 'https://dresslikemommy.com' + href
    try:
        fname = f'C:/Users/Fsuels/clawd/dlm-icon-{i}.png'
        req2 = urllib.request.Request(href, headers={'User-Agent': 'Mozilla/5.0'})
        data = urllib.request.urlopen(req2).read()
        with open(fname, 'wb') as f:
            f.write(data)
        print(f"Downloaded: {href} -> {fname} ({len(data)} bytes)")
    except Exception as e:
        print(f"Failed: {href} - {e}")
