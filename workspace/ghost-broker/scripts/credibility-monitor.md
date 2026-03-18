# Ghost Broker — Credibility Monitor (Execution Guide)

Purpose: run a lightweight daily credibility scan and produce:

- metrics snapshot (where available)
- new opportunities (directories, conversations)
- 1 concrete action/draft
- blockers clearly stated

## Inputs

- Plan + scoring: `ghost-broker/plans/credibility-building.md`
- Log: `ghost-broker/plans/credibility-log.md`

## Daily checks (10–15 min)

1. **Website trust/SEO plumbing**
   - Fetch `/robots.txt` and `/sitemap.xml`.
   - Record status + content-type + first 200 chars.

2. **Brand search scan (no login needed)**
   - Web search: "ghost broker ai" and "ghostbrokerai.xyz".
   - Capture any new mentions worth responding to.

3. **Category conversation scan**
   - Web search: "ai agent marketplace" + "agent economy" (past week).
   - Identify 1 high-signal thread/article.

4. **Competitor trust signals**
   - Fast check competitor homepages for above-the-fold trust artifacts.

5. **Action**
   - Draft 1 response (tweet/reply/comment) OR
   - Find 1 directory to submit to (only if submission is safe and not spammy).

## Output

- Append entry to `ghost-broker/plans/credibility-log.md`.
- Update scoring table in `ghost-broker/plans/credibility-building.md`.
- If any public posting is required: save the draft text and request approval.

## Epistemic rules

- Failed fetches = **UNVERIFIED** (no inference).
- No fake stats.
