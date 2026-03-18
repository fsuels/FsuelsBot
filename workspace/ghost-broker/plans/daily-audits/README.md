# Ghost Broker — Daily Website Audit (Ops notes)

## Fetch scripts

- `fetch-robots-sitemap.ps1` — verifies production `robots.txt` + `sitemap.xml` status/content-type/first bytes.
- `fetch-competitors.ps1` — lightweight competitor fetch with explicit failure reporting.

## Epistemic rule (MANDATORY)

If any competitor fetch fails (`ok=false` in `fetch-competitors.ps1` output):

1. Mark that competitor snapshot as **UNVERIFIED** in the audit report.
2. Do **not** infer anything about the competitor from the failure (no “they are down”, “blocked us”, etc.).
3. Attempt one alternate capture method (browser snapshot / manual open). If still unavailable, log: "snapshot incomplete".

This rule exists to prevent **hasty generalization / false cause** errors.
