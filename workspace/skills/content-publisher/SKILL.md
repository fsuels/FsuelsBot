---
name: content-publisher
description: "Create and publish marketing content for DressLikeMommy. Use when: (1) Writing social media posts, (2) Creating blog content, (3) Scheduling content across platforms, (4) Repurposing product listings into marketing copy. Extends tweet-writer and reddit skills."
---

# Content Publisher

Create, review, and publish marketing content across platforms for DressLikeMommy.

## Business Context

- **Brand**: DressLikeMommy -- mommy and me / family matching outfits
- **Voice**: Warm, family-focused, aspirational but accessible
- **Audience**: Moms (25-45) who want to match with their kids
- **Platforms**: Twitter/X, Reddit, Instagram captions, blog, TikTok captions

## Trigger Conditions

When to invoke this skill:

- Francisco asks to create social media posts, blog content, or marketing copy
- A new product is listed (auto-generate social post drafts)
- Content calendar has a scheduled post date approaching (2-3 days ahead)
- Trending topic relevant to mommy-and-me niche detected
- Francisco says "write a post", "content for", "schedule post"

## Required Inputs

| Input        | Source                       | Required | Example                                   |
| ------------ | ---------------------------- | -------- | ----------------------------------------- |
| content_type | User message                 | Yes      | "tweet", "blog post", "instagram caption" |
| topic        | User message or product data | Yes      | "new floral matching dress launch"        |
| platform     | User message                 | Yes      | "twitter", "reddit", "blog"               |
| product_url  | Shopify listing              | No       | `dresslikemommy.com/products/floral`      |
| images       | Product photos / user        | No       | Paths to product images                   |

## Brand Rules

1. **Voice**: Warm, genuine, family-focused -- never salesy or pushy
2. **No fake urgency**: No "LAST CHANCE" or "ONLY 3 LEFT" unless true
3. **Image selection**: Pick best product photos, ensure no unswapped Chinese faces
4. **Reddit**: Value-first in r/mommit, r/parenting, r/toddlers -- subtle product mentions only
5. **Product-to-content**: Read Shopify listing -> generate social post + blog paragraph + email snippet

## Data Collection Steps

1. **Gather product/topic context** -- tool: `browser`, `read`
   - If product-based: read Shopify listing for title, description, images, price
   - If trend-based: use `web_search` for current trending topics in niche
   - Expected: enough context to write authentic, informed content
   - If product listing unavailable: ask Francisco for key details

2. **Research hashtags and keywords** -- tool: `web_search`
   - Search for trending hashtags on target platform for mommy-and-me content
   - Check competitor content for inspiration (not copying)
   - Expected: 5-10 relevant hashtags, keyword suggestions
   - If search fails: use standard hashtag set from previous posts

3. **Draft content** -- tool: native
   - Write content matching brand voice and platform format
   - Apply platform-specific length and formatting rules
   - Expected: complete draft ready for review
   - If unsure about tone: err toward warm and genuine

4. **Select images** -- tool: `browser`, `read`
   - Choose best product photos; verify no unswapped faces
   - Crop/format for platform requirements if needed
   - If no suitable images: flag to Francisco; provide text-only draft as fallback

5. **Save draft and send for review** -- tool: `write`, `message send`
   - Save to `knowledge/content-drafts/[platform]-YYYY-MM-DD-[topic].md`
   - Send draft to Francisco via Telegram for approval
   - Expected: draft saved and Telegram confirmation

6. **Publish (after approval)** -- tool: `browser`
   - Only after Francisco confirms
   - Post to approved platform
   - Log: what was posted, where, when, to `knowledge/content-log.jsonl`

## Output Format

### Deliverable: Content Draft

Delivery method: Telegram (for review) + file
File path: `knowledge/content-drafts/[platform]-YYYY-MM-DD-[topic].md`

```
**Content Draft -- [Platform] -- [Date]**

**Type:** [tweet / blog post / instagram caption / reddit post]
**Topic:** [topic]
**Product:** [product name + URL if applicable]

---

[DRAFT CONTENT HERE]

---

**Hashtags:** [list]
**Image:** [path or "none -- text only"]
**Suggested posting time:** [if known]
**Status:** AWAITING APPROVAL
```

### Deliverable: Content Log Entry

File path: `knowledge/content-log.jsonl`

```json
{
  "date": "2026-03-31",
  "platform": "twitter",
  "topic": "floral dress launch",
  "status": "published",
  "url": "https://x.com/...",
  "product": "floral-matching-dress"
}
```

## Success Criteria

- [ ] Content matches brand voice (warm, genuine, family-focused)
- [ ] No spelling/grammar errors
- [ ] Hashtags researched and relevant
- [ ] Image selected and verified (no unswapped faces)
- [ ] Platform-appropriate length and format
- [ ] No claims we can't back up
- [ ] Draft saved to `knowledge/content-drafts/`
- [ ] Draft sent to Francisco via Telegram
- [ ] Publication only after explicit approval (Tier 2)
- [ ] Published content logged to `knowledge/content-log.jsonl`

## Error Handling

| Failure                       | Detection                       | Response                                                |
| ----------------------------- | ------------------------------- | ------------------------------------------------------- |
| Product listing unavailable   | Browser can't load Shopify page | Ask Francisco for key details; draft from memory/notes  |
| Hashtag research fails        | `web_search` returns empty      | Use standard hashtag set from previous successful posts |
| Image has unswapped faces     | Visual inspection detects issue | Flag to Francisco; provide text-only draft as fallback  |
| Telegram send fails           | Exit code != 0                  | Retry once; save draft to file and log                  |
| Platform rejects post         | Publish action returns error    | Screenshot error; notify Francisco; save draft locally  |
| Content calendar file missing | File not found                  | Create from scratch; notify Francisco                   |

## Evidence Standards

- Product-based content must link to the actual Shopify listing
- Trend claims must cite source (Google Trends URL, social post, article)
- Never fabricate product reviews or customer testimonials
- Hashtag selections should note source (competitor analysis, trend tool, manual)
- Content log must record actual published URL for verification
- Distinguish between original content and repurposed/adapted content

## Permission Tiers

| Action                               | Tier | Rule                              |
| ------------------------------------ | ---- | --------------------------------- |
| Draft content, research, plan        | 0    | Just do it                        |
| Save drafts to files                 | 0    | Just do it                        |
| Send draft to Francisco via Telegram | 1    | Do it, report after               |
| Publish to any public platform       | 2    | **ALWAYS confirm with Francisco** |
| Reply to comments/DMs as brand       | 2    | **ALWAYS confirm with Francisco** |
