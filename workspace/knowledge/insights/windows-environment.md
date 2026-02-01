---
updated: 2026-01-29
version: "1.0"
created: "2026-01-28"
updated: "2026-01-28"
verified: "2026-01-28"
confidence: "medium"
---

# Insight: Windows Environment Quirks
*Learned: 2026-01-26*
*Source: production experience across multiple sessions*

## The Insight
Running on Windows 10 requires specific accommodations. Many Linux-oriented commands and patterns fail silently or with unhelpful errors.

## Key Rules
- Use `curl.exe` not `curl` â€” PowerShell aliases `curl` to `Invoke-WebRequest` [verified: 2026-01-26]
- Use `Select-Object -First N` instead of `head -N` [verified: 2026-01-26]
- Use `icacls` not `chmod` for file permissions [verified: 2026-01-26]
- Use `;` not `&&` for command chaining in PowerShell [verified: 2026-01-27]
- Use `if/else` blocks not `||` for fallback patterns [verified: 2026-01-28]
- Paths use backslashes but most tools accept forward slashes too [verified: 2026-01-26]
- ClawdHub search frequently times out â€” use broad queries [verified: 2026-01-27]
- `trash` command may not be available â€” check before using over `rm` [verified: 2026-01-26]

