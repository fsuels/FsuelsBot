# Size Chart & Variant Setup Guide — DLM Products

_Created: 2026-02-22_

This is the detailed procedure for creating size charts and configuring size variants when drafting Shopify listings for DressLikeMommy products sourced from 1688.com.

---

## 1. EXTRACTING SIZE DATA FROM 1688

### Where to find the size chart:

- Scroll through the 1688 listing images — often the **last 1-3 images** contain the size table
- Check the "产品详情" (Product Details) section below the main images
- Look for images with tables showing "尺码表" (size chart)

### Key Chinese labels to recognize:

| Chinese     | English            |
| ----------- | ------------------ |
| 码数 / 尺码 | Size designation   |
| 身高        | Height (kids)      |
| 胸围        | Bust/Chest         |
| 腰围        | Waist              |
| 臀围        | Hip                |
| 衣长        | Garment Length     |
| 裤长        | Pants Length       |
| 肩宽        | Shoulder Width     |
| 袖长        | Sleeve Length      |
| 建议年龄    | Recommended Age    |
| 建议体重    | Recommended Weight |

### Extract into this structure:

```
KIDS:
Size(cm) | Bust(cm) | Waist(cm) | Hip(cm) | Length(cm) | Age
80       | 52       | 50        | 54      | 38         | 12-18M
90       | 54       | 52        | 56      | 42         | 2T
...

ADULTS:
Size | Bust(cm) | Waist(cm) | Hip(cm) | Length(cm)
S    | 84       | 68        | 90      | 65
M    | 88       | 72        | 94      | 66
...
```

### ⚠️ Watch for:

- **"平铺尺寸" (flat lay measurements)** — these are HALF the circumference. You must **double** bust/waist/hip values.
- **Missing measurements** — contact supplier via BuckyDrop if incomplete. Don't guess.
- Some charts show garment measurements vs body measurements — note which one.

---

## 2. SIZE CONVERSION: CHINESE → US-FRIENDLY

### 2.1 Kids Size Mapping

| Chinese (CM height) | US Label | Age Range    | Display in Variant |
| ------------------- | -------- | ------------ | ------------------ |
| 80                  | 12-18M   | 12-18 months | `12-18M (80cm)`    |
| 90                  | 2T       | ~2 years     | `2T (90cm)`        |
| 100                 | 3T       | ~3 years     | `3T (100cm)`       |
| 110                 | 4-5Y     | 4-5 years    | `4-5Y (110cm)`     |
| 120                 | 5-6Y     | 5-6 years    | `5-6Y (120cm)`     |
| 130                 | 7-8Y     | 7-8 years    | `7-8Y (130cm)`     |
| 140                 | 9-10Y    | 9-10 years   | `9-10Y (140cm)`    |
| 150                 | 11-12Y   | 11-12 years  | `11-12Y (150cm)`   |

### 2.2 Adult Size Note

Chinese adult sizes run **1-2 sizes SMALLER** than US sizes:

- Chinese S ≈ US XS
- Chinese M ≈ US S
- Chinese L ≈ US M
- Chinese XL ≈ US L
- Chinese 2XL ≈ US XL
- Chinese 3XL ≈ US 2XL

**Keep S/M/L/XL labels** on variants but include the "sizes run small" warning prominently.

### 2.3 CM → Inches Conversion

Formula: **inches = cm ÷ 2.54** (round to nearest 0.5")

---

## 3. THE HTML SIZE CHART (paste into Shopify description)

Switch Shopify's rich text editor to **HTML mode** (click the `<>` button), then paste this template. Replace the measurements with actual product data.

### Template:

```html
<!-- === SIZE CHART START === -->
<div style="margin: 25px 0; font-family: -apple-system, Arial, sans-serif;">
  <!-- SIZING WARNING -->
  <div
    style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;"
  >
    <strong style="color: #856404;">⚠️ Sizes Run Small</strong>
    <p style="margin: 6px 0 0; color: #856404; font-size: 14px;">
      Asian sizing runs 1-2 sizes smaller than US.
      <strong>We recommend ordering ONE SIZE UP.</strong> Please check the measurements below before
      ordering.
    </p>
  </div>

  <!-- HOW TO MEASURE -->
  <div
    style="background: #e8f4fd; border-left: 4px solid #2196F3; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;"
  >
    <strong style="color: #0c5687;">📏 How to Measure</strong>
    <p style="margin: 6px 0 0; color: #0c5687; font-size: 14px;">
      <strong>Bust:</strong> Around fullest part of chest &nbsp;|&nbsp;
      <strong>Waist:</strong> Around natural waistline &nbsp;|&nbsp; <strong>Hip:</strong> Around
      fullest part of hips &nbsp;|&nbsp; <strong>Length:</strong> Shoulder to hem
    </p>
  </div>

  <!-- KIDS SIZE CHART -->
  <h3 style="margin: 20px 0 10px; font-size: 16px;">👧 Kids Size Chart</h3>
  <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; min-width: 400px;">
      <thead>
        <tr style="background: #f8b4c8;">
          <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">US Size</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Age</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Height</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Bust</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Length</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center; font-weight: bold;">
            2T (90cm)
          </td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">~2 yrs</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">33-35"</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">21" / 54cm</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">16.5" / 42cm</td>
        </tr>
        <tr style="background: #fef0f5;">
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center; font-weight: bold;">
            3T (100cm)
          </td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">~3 yrs</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">37-39"</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">22" / 56cm</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">18" / 46cm</td>
        </tr>
        <!-- ADD MORE ROWS: copy a <tr> block, change values -->
        <!-- Alternate background: plain row = no style, shaded row = style="background: #fef0f5;" -->
      </tbody>
    </table>
  </div>

  <!-- ADULTS SIZE CHART -->
  <h3 style="margin: 20px 0 10px; font-size: 16px;">👩 Mom Size Chart</h3>
  <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; min-width: 400px;">
      <thead>
        <tr style="background: #f8b4c8;">
          <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Size</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">US Equiv.</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Bust</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Waist</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Hip</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Length</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center; font-weight: bold;">
            S
          </td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">US XS</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">33" / 84cm</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">27" / 68cm</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">35.5" / 90cm</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">25.5" / 65cm</td>
        </tr>
        <tr style="background: #fef0f5;">
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center; font-weight: bold;">
            M
          </td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">US S</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">34.5" / 88cm</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">28.5" / 72cm</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">37" / 94cm</td>
          <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">26" / 66cm</td>
        </tr>
        <!-- ADD MORE ROWS: L, XL, 2XL, 3XL -->
      </tbody>
    </table>
  </div>

  <!-- TOLERANCE NOTE -->
  <p style="margin-top: 15px; font-size: 12px; color: #888;">
    📌 Measurements may vary 1-2cm (~0.5-1") due to manual measuring. When in doubt, size up.
  </p>
</div>
<!-- === SIZE CHART END === -->
```

### Key formatting rules:

1. **Always use inline CSS** — Shopify strips `<style>` tags and external CSS
2. **Wrap tables in `overflow-x: auto`** — makes them scrollable on mobile
3. **Show BOTH inches and CM** — "33" / 84cm" format
4. **Alternate row colors** — every other row gets `background: #fef0f5`
5. **Pink header** (`#f8b4c8`) — matches DLM brand
6. **Include "US Equiv." column** for adults — so customers know Chinese M ≈ US S
7. **Kids table always shows Age column** — parents think in ages, not bust measurements

### Adapting per product type:

- **Dresses/Tops:** Bust + Length (waist/hip optional)
- **Pants/Leggings:** Waist + Hip + Inseam
- **Swimwear/Bikinis:** Bust + Waist + Hip (all three mandatory)
- **One-piece outfits:** All measurements

---

## 4. SHOPIFY VARIANT SETUP

### 4.1 Individual Products (Kid OR Adult sold separately)

**Option 1 Name:** `Size`

**Kids variant values (in order):**

```
12-18M (80cm)
2T (90cm)
3T (100cm)
4-5Y (110cm)
5-6Y (120cm)
7-8Y (130cm)
9-10Y (140cm)
11-12Y (150cm)
```

**Adult variant values (in order):**

```
S (US XS)
M (US S)
L (US M)
XL (US L)
2XL (US XL)
3XL (US 2XL)
```

Only include sizes the supplier actually offers — don't list sizes that aren't available.

### 4.2 Bundle/Set Products (Mom + Kid sold together)

**Option 1 Name:** `Mom Size`
**Option 2 Name:** `Child Size`

This creates a variant matrix. Example for a set with 3 adult × 5 kid sizes = 15 variants:

```
Mom: S / Child: 2T (90cm)
Mom: S / Child: 3T (100cm)
Mom: S / Child: 4-5Y (110cm)
...
Mom: L / Child: 4-5Y (110cm)
```

**Price:** Same across all variant combinations (the set price).

**⚠️ Variant limit:** Shopify allows max 100 variants per product. With 2 options:

- 6 adult × 8 kid = 48 variants ✅
- 6 adult × 8 kid × 3 colors = 144 variants ❌ (too many)

If you need color variants too, create separate products per color (e.g., "Matching Floral Dress - Pink", "Matching Floral Dress - Blue").

### 4.3 Per-Variant Settings

For EVERY variant, set:
| Field | Value |
|-------|-------|
| **Price** | Approved price from Phase 2 |
| **SKU** | `DLM-[product-code]-[size]` e.g., `DLM-FLORAL01-M` |
| **Inventory tracking** | ON |
| **Inventory policy** | Continue selling when out of stock (BuckyDrop handles fulfillment) |
| **Weight** | From BuckyDrop product data (grams) |
| **HS Code** | Leave blank (BuckyDrop handles customs) |

### 4.4 Variant Naming Rules

**DO ✅:**

- `3T (100cm)` — US size first, CM in parens
- `M (US S)` — seller size first, US equiv in parens
- `Mom: L / Child: 5-6Y` — clear role labels for sets

**DON'T ❌:**

- `100` — meaningless to US customer
- `Size 3` — ambiguous (size 3 what?)
- `Medium` — hides that it runs small
- `110-120` — ranges are confusing
- `妈妈M` — Chinese characters in storefront

---

## 5. COMMON MISTAKES

| Mistake                                | Fix                                                   |
| -------------------------------------- | ----------------------------------------------------- |
| Pasting 1688 size chart image directly | Extract data → build HTML table in English            |
| Using raw CM as variant labels         | Convert: `110` → `4-5Y (110cm)`                       |
| No "sizes run small" warning           | ALWAYS include the yellow warning box                 |
| Missing measurements in chart          | Contact supplier for complete data before listing     |
| Showing CM only, no inches             | Always show both: `33" / 84cm`                        |
| Forgetting "How to Measure" tip        | Include the blue box with bust/waist/hip instructions |
| Too many variants (>100)               | Split by color into separate products                 |
| Same SKU across sizes                  | Each variant gets unique SKU                          |
| Not checking flat-lay vs circumference | If flat-lay: double the measurement                   |

---

## 6. QUICK CHECKLIST (Before moving to Human Review)

- [ ] Size chart HTML pasted in product description
- [ ] Both Kids AND Adult tables included (for matching products)
- [ ] ⚠️ "Sizes run small" warning box present
- [ ] 📏 "How to Measure" guide present
- [ ] All measurements shown in inches AND cm
- [ ] Variant option named "Size" (not "Variant" or "Option")
- [ ] Variant labels use US size format: `3T (100cm)`, `M (US S)`
- [ ] All variants have SKU, price, weight set
- [ ] Inventory tracking ON for all variants
- [ ] For sets: two options (Mom Size + Child Size) configured
