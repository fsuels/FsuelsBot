# DressLikeMommy Pinterest Publish Prompt

Use this template only after a local job packet has already been generated.

## Mission

Publish one Pinterest Pin for DressLikeMommy with the exact approved board, image, product URL, SEO copy, and product tags from the job packet.

## Hard Rules

- Use the browser that already has the verified DressLikeMommy business session open.
- Prefer Safari when the logged-in session is already active and stable.
- Use Chrome `Profile 1` only when Safari is not the active verified session.
- Use Pinterest `Pin Builder` when product tags are required, but keep `Ad-only Pin` turned off for an organic publish.
- Before every browser action, confirm app name, page title, and URL so the run stays in one verified browser tab.
- Never guess the board.
- Never improvise a different product URL.
- Never upload a square source image directly if the prepared `pin-image.jpg` exists.
- Never publish until the description is present, the destination link is present, and at least one product is tagged when the catalog product is available.
- If anything is ambiguous, stop and move the job to review.

## Runtime Packet

- Job ID: `{{JOB_ID}}`
- Queue note: `{{QUEUE_NOTE}}`
- Product title: `{{PRODUCT_TITLE}}`
- Product URL: `{{PRODUCT_URL}}`
- Board: `{{BOARD_NAME}}`
- Board confidence: `{{BOARD_CONFIDENCE}}`
- Main image URL: `{{MAIN_IMAGE_URL}}`
- Prepared asset: `{{PIN_ASSET_PATH}}`
- Draft title: `{{PIN_TITLE}}`
- Draft description: `{{PIN_DESCRIPTION}}`
- Draft hashtags: `{{PIN_HASHTAGS}}`
- Product tag search terms: `{{PRODUCT_TAG_SEARCH_TERMS}}`

## Step 1: Review Packet

Screen now:
- local job folder open

Relevant tools:
- file read
- browser snapshot

Done when:
- you have confirmed the board, URL, and asset path before opening Pinterest

## Step 2: Open Pinterest Pin Builder

Screen now:
- Pinterest business account already logged in

Relevant tools:
- browser snapshot
- browser click

Done when:
- the `Pin Builder` form is open and ready for upload
- you have confirmed `Ad-only Pin` is turned off

## Step 3: Fill Pin Form

Screen now:
- upload field, board picker, title, description, destination URL, more options

Relevant tools:
- browser snapshot
- browser fill form
- browser click

Done when:
- the prepared image is uploaded
- the exact board is selected
- the title, description, URL, and alt text are filled from the packet

## Step 4: Add Product Tags

Screen now:
- Pin Builder with uploaded asset visible

Relevant tools:
- browser snapshot
- browser click
- browser fill

Done when:
- the `Add products` or `Tag products` flow is opened
- at least one product from the DressLikeMommy catalog is tagged using the packet search terms
- the tagged product matches the same product URL in the packet

## Step 5: Publish And Verify

Screen now:
- published Pin page or board page

Relevant tools:
- browser snapshot
- browser click
- screenshot

Done when:
- the Pin is live
- the Pin is on the correct board
- the destination URL is correct
- the live Pin shows a non-empty description
- a receipt screenshot is saved into the job folder
