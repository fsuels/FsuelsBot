# ClawdHub CLI `update` failure on Windows (relative URL parse)

## Symptom

Running `clawdhub update --all` (or `clawdhub update <slug>`) fails immediately with:

> Failed to parse URL from /api/v1/skills/<slug>

Example:

- `clawdhub update --all`
- `clawdhub update marketing-mode`

Both error with `Failed to parse URL from /api/v1/skills/marketing-mode`.

## Verified environment

- ClawdHub CLI: `0.3.0`
- Clawdbot package version installed: `2026.1.24-3`

## Registry discovery (works)

The site well-known file resolves registry/api base to `https://clawhub.ai`:

- `curl.exe -sL https://clawdhub.com/.well-known/clawdhub.json`

Result includes:

- `apiBase`: `https://clawhub.ai`
- `registry`: `https://clawhub.ai`

`clawdhub explore` and `clawdhub search` work when run with:

- `--registry https://clawhub.ai`

## Hypothesis

`update` code path appears to build a request URL using only a relative path (`/api/v1/skills/...`) without resolving it against the configured registry base URL.
This produces an invalid absolute URL error in the fetch/URL parser.

## Workarounds (current)

- Use `clawdhub explore` + `clawdhub search` to discover skills (works)
- Install specific skills via `clawdhub install <slug> --registry https://clawhub.ai`
- (Potential) patch CLI or file upstream issue with reproduction and logs

## Evidence / receipts

Commands observed:

- `clawdhub update --all` → parse error
- `clawdhub --registry https://clawhub.ai explore --limit 10` → succeeds
- `clawdhub --registry https://clawhub.ai search shopify --limit 5` → succeeds
