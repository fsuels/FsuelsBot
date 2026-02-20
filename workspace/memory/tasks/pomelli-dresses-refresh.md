# Task: pomelli-dresses-refresh
## Generate AI Photoshoot Images for DressLikeMommy Dress Collection

**Status:** blocked
**Created:** 2026-02-19
**Updated:** 2026-02-20 01:30 EST
**Blocked by:** Missing asset folder path, Shopify access details, and product page list from Francisco

## Goal
Generate professional AI photoshoot images for all dresses in the DressLikeMommy collection using Google's Pomelli AI tool, then upload the generated images to replace existing product photos on Shopify. Success = every dress product page has a new AI-generated photoshoot image live on the store.

## Context & Background
Francisco runs DressLikeMommy (dresslikemommy.com), an e-commerce store for matching mother-daughter dresses. He wants to refresh the product images using Google's Pomelli AI photoshoot tool, which generates professional-looking model photoshoot images from flat product photos.

**Prior attempts (2026-02-19):**
- Three sub-agents were spawned (pomelli-dresses 1-3) but all stalled because Peekaboo Accessibility permission wasn't granted
- The UI automation approach was validated: Pomelli loads templates correctly, product images can be uploaded
- Coordinate-based clicking (`cliclick`) works as a fallback if Accessibility still isn't granted

**Decisions made:**
- Use Pomelli.com AI photoshoot tool (not Midjourney or other alternatives)
- Parallel processing via sub-agents is the right approach
- Sonnet model for sub-agents (cheaper/faster for UI automation work)
- `cliclick` is a viable fallback for clicking if Peekaboo Accessibility is blocked

## Resources
- **Tool:** Pomelli AI Photoshoot → https://labs.google.com/pomelli/photoshoot
- **Store front:** https://www.dresslikemommy.com/collections/dresses
- **Shopify Admin:** https://admin.shopify.com/store/dresslikemommy-com/products?selectedView=all
- **UI Automation:** Peekaboo CLI → skill at /Users/fsuels/clawd/skills/peekaboo/SKILL.md
- **Fallback clicks:** `cliclick` (coordinate-based, no Accessibility permission needed)
- **macOS Automation:** Hammerspoon → /Applications/Hammerspoon.app (installed, `hs` CLI may not be in PATH)
- **Browser:** Google Chrome (use `open -a "Google Chrome" <url>` to open)
- **Missing — BLOCKER:** Source dress image folder path (ask Francisco)
- **Missing — BLOCKER:** Shopify access method (API key or browser login credentials)
- **Missing — BLOCKER:** List of specific product pages to update

## Checklist
- [x] **Step 1: Validate Pomelli UI** — Opened Chrome to Pomelli photoshoot URL, confirmed templates load, upload button accessible. ✅ Done 2026-02-19.
- [x] **Step 2: Test image upload** — Uploaded a test product image to Pomelli, confirmed it accepts the format. ✅ Done 2026-02-19.
- [ ] **Step 3: Get missing inputs from Francisco** — Need: (a) folder path where source dress images are stored, (b) Shopify access details (is browser already logged in? or do we need API key?), (c) which product pages to update (all dresses? specific SKUs?). → Ask Francisco directly, don't proceed without these.
- [ ] **Step 4: Inventory source images** — Once we have the folder path, list all dress images. Map each image to its corresponding Shopify product. Create a processing manifest (image path → product URL).
- [ ] **Step 5: Generate photoshoot images** — For each dress image: open Pomelli in Chrome, upload the source image, select an appropriate template/background, generate the photoshoot image, download the result to a local output folder (e.g., `/tmp/pomelli-output/`). Use Peekaboo for UI automation (read skill at /Users/fsuels/clawd/skills/peekaboo/SKILL.md first). If Peekaboo Accessibility is still blocked, fall back to `cliclick` for coordinate-based clicks + Peekaboo for screenshots only.
- [ ] **Step 6: Quality check** — Review all generated images. Re-generate any that look off (bad crop, weird artifacts, wrong pose).
- [ ] **Step 7: Upload to Shopify** — For each product, navigate to its Shopify admin page, replace the existing product image with the new AI-generated one. Verify the image appears correctly on the live product page.
- [ ] **Step 8: Final verification** — Visit each product page on the live store (dresslikemommy.com) and confirm new images are displayed. Report results to Francisco.

## Current State
**On Step 3 (blocked).** Steps 1-2 completed in prior session. Three previous sub-agents are stale and should be discarded. Need fresh sub-agents once blockers are resolved. No output files exist yet.

**Peekaboo permissions:**
- Screen Recording: ✅ granted
- Accessibility: ❌ NOT granted (System Settings > Privacy & Security > Accessibility)
  - If Francisco grants it: full Peekaboo automation available
  - If not: use `cliclick` for clicks + Peekaboo for screenshots only

## Agent Instructions
- **Model:** Use Sonnet for sub-agents (cost efficient for UI automation)
- **Tools:** Read Peekaboo SKILL.md before starting any UI work. Use `peekaboo` for screenshots and element inspection. Use `cliclick` as click fallback.
- **If blocked on permissions:** Don't ask repeatedly. Use coordinate-based clicking with `cliclick` and `peekaboo` for visual verification.
- **If blocked on missing info:** Report back to orchestrator with exactly what's needed. Don't guess.
- **Parallel processing:** Once we have the image list, spawn one sub-agent per batch of 3-4 images for parallel generation.
- **Output:** Save generated images to `/tmp/pomelli-output/<product-sku>.png`

## Acceptance Criteria
- [ ] All dress products in the collection have new AI-generated photoshoot images
- [ ] Images are uploaded and live on Shopify product pages
- [ ] Each product page visually verified on the live store
- [ ] Francisco confirms he's happy with the results
