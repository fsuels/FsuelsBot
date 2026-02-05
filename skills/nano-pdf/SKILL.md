---
name: nano-pdf
description: AI-powered PDF content editing via natural language. Use ONLY for modifying text/content ON a PDF page (fix typos, change titles, update text). Do NOT use for: merging, splitting, extracting text, filling forms, rotating, watermarks, or reading PDFs — use the general `pdf` skill for those operations.
homepage: https://pypi.org/project/nano-pdf/
metadata: {"moltbot":{"emoji":"📄","requires":{"bins":["nano-pdf"]},"install":[{"id":"uv","kind":"uv","package":"nano-pdf","bins":["nano-pdf"],"label":"Install nano-pdf (uv)"}]}}
---

# nano-pdf

AI-powered PDF content editing via natural language instructions.

## When to Use This vs `pdf` Skill

| Task | Use This (`nano-pdf`) | Use `pdf` Skill |
|------|----------------------|-----------------|
| Fix typo on page 3 | ✅ | ❌ |
| Change title text | ✅ | ❌ |
| Update a date/number | ✅ | ❌ |
| Merge multiple PDFs | ❌ | ✅ |
| Split PDF into pages | ❌ | ✅ |
| Extract text from PDF | ❌ | ✅ |
| Fill PDF forms | ❌ | ✅ |
| Rotate pages | ❌ | ✅ |
| Add watermarks | ❌ | ✅ |

**Rule of thumb:** If you're changing *what the PDF says*, use `nano-pdf`. If you're changing *the PDF structure*, use `pdf`.

## Quick Start

```bash
nano-pdf edit deck.pdf 1 "Change the title to 'Q3 Results' and fix the typo in the subtitle"
```

## Notes

- Page numbers are 0-based or 1-based depending on the tool's version/config; if the result looks off by one, retry with the other.
- Always sanity-check the output PDF before sending it out.
- This uses AI to understand and apply edits — complex layouts may need manual review.
