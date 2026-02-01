from PIL import Image

# Load current logo
logo = Image.open('dlm-current-logo.png')
print(f"Original logo: {logo.size} ({logo.mode})")

# Convert to RGBA if needed
if logo.mode != 'RGBA':
    logo = logo.convert('RGBA')

# --- RECTANGULAR LOGO (2:1 ratio, minimum 1000x500) ---
# Target: 1200x600 (2:1 ratio, well above minimum)
rect_w, rect_h = 1200, 600
rect_canvas = Image.new('RGBA', (rect_w, rect_h), (255, 255, 255, 255))

# Scale logo to fit within the canvas with padding
logo_w, logo_h = logo.size
# Scale to fill ~85% of canvas width
scale = (rect_w * 0.85) / logo_w
new_w = int(logo_w * scale)
new_h = int(logo_h * scale)
logo_resized = logo.resize((new_w, new_h), Image.LANCZOS)

# Center on canvas
x = (rect_w - new_w) // 2
y = (rect_h - new_h) // 2
rect_canvas.paste(logo_resized, (x, y), logo_resized)

# Save as PNG
rect_path = 'dlm-logo-rectangular.png'
rect_canvas.convert('RGB').save(rect_path, 'PNG')
print(f"Rectangular logo saved: {rect_w}x{rect_h} -> {rect_path}")

# --- SQUARE LOGO (1:1 ratio, minimum 500x500) ---
# Target: 1000x1000
sq_size = 1000
sq_canvas = Image.new('RGBA', (sq_size, sq_size), (255, 255, 255, 255))

# Scale logo to fill ~80% of canvas width
scale_sq = (sq_size * 0.80) / logo_w
new_w_sq = int(logo_w * scale_sq)
new_h_sq = int(logo_h * scale_sq)
logo_sq = logo.resize((new_w_sq, new_h_sq), Image.LANCZOS)

# Center on canvas
x_sq = (sq_size - new_w_sq) // 2
y_sq = (sq_size - new_h_sq) // 2
sq_canvas.paste(logo_sq, (x_sq, y_sq), logo_sq)

sq_path = 'dlm-logo-square.png'
sq_canvas.convert('RGB').save(sq_path, 'PNG')
print(f"Square logo saved: {sq_size}x{sq_size} -> {sq_path}")

# File sizes
import os
for p in [rect_path, sq_path]:
    size_kb = os.path.getsize(p) / 1024
    print(f"  {os.path.basename(p)}: {size_kb:.1f} KB")
