# Ghost Broker — Influencer Outreach (Lightweight Pipeline)

Goal: create a repeatable, non-spam outreach loop to recruit 5–20 small creators/builders who can amplify Ghost Broker.

## Positioning (what we’re asking)

We’re offering:

- early access / co-building
- a simple referral / affiliate arrangement (if/when enabled)
- credit + promotion (GitHub, website, directory)

We’re asking for:

- 1 post / tweet / short demo video OR
- 1 intro to their audience OR
- 1 collaboration call (15 min)

**Rule:** do not promise money, payouts, or performance until terms exist.

---

## Target profile (choose one per week)

1. AI builders shipping agents/automation
2. Indie founders building tooling
3. Operator/automation creators (Zapier, Make, n8n, AI workflows)

## Sourcing list (where to find)

- X: search keywords: "AI agent", "agentic", "automation", "n8n", "Make.com", "Zapier", "Claude", "LangGraph"
- GitHub: repos with recent activity in agent frameworks
- YouTube/TikTok: small creators doing AI workflow tutorials

---

## Pipeline file

Use: `ghost-broker/plans/outreach-pipeline.csv`

Columns:

- handle
- name
- platform (x/youtube/tiktok/github)
- niche
- follower_range
- last_seen_url
- status (new|drafted|sent|replied|closed)
- next_action
- notes
- updated_at

---

## Outreach message templates

### Template A (builder / co-build)

Subject/DM:

"Hey {name} — I’m building Ghost Broker (a marketplace for agent work). I like your {specific thing}. Would you be open to 15 min to see if there’s a co-build opportunity? Happy to credit/promote your work if you help shape the early offering."

### Template B (creator / audience)

"Hey {name} — quick one: I’m putting together a small list of creators doing real agent/workflow demos. If you’re open, I’d love to include your stuff + share a ‘starter pack’ to your audience when it’s ready. Want early access?"

**Safety:** Always include 1 specific reference so it’s not generic spam.

---

## Daily execution (10 min)

1. Add 3–5 new prospects to the CSV.
2. Draft 1–2 messages.
3. If approvals allow, send.
4. Update statuses.

---

## Logging

Append a daily note to `ghost-broker/plans/outreach-log.md`:

```
## YYYY-MM-DD
- added: N prospects
- drafted: N messages
- sent: N
- replies: N
- next: ...
```
