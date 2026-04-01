---
name: reddit
description: Browse, search, post, and moderate Reddit. Read-only works without auth; posting/moderation requires OAuth setup.
metadata: { "clawdbot": { "emoji": "📣", "requires": { "bins": ["node"] } } }
---

# Reddit

Browse, search, post to, and moderate subreddits. Read-only actions work without auth; posting/moderation requires OAuth setup.

## Setup (for posting/moderation)

1. Go to https://www.reddit.com/prefs/apps
2. Click "create another app..."
3. Select "script" type
4. Set redirect URI to `http://localhost:8080`
5. Note your client ID (under app name) and client secret
6. Set environment variables:
   ```bash
   export REDDIT_CLIENT_ID="your_client_id"
   export REDDIT_CLIENT_SECRET="your_client_secret"
   export REDDIT_USERNAME="your_username"
   export REDDIT_PASSWORD="your_password"
   ```

## Read Posts (no auth required)

```bash
# Hot posts from a subreddit
node {baseDir}/scripts/reddit.mjs posts wallstreetbets

# New posts
node {baseDir}/scripts/reddit.mjs posts wallstreetbets --sort new

# Top posts (day/week/month/year/all)
node {baseDir}/scripts/reddit.mjs posts wallstreetbets --sort top --time week

# Limit results
node {baseDir}/scripts/reddit.mjs posts wallstreetbets --limit 5
```

## Search Posts

```bash
# Search within a subreddit
node {baseDir}/scripts/reddit.mjs search wallstreetbets "YOLO"

# Search all of Reddit
node {baseDir}/scripts/reddit.mjs search all "stock picks"
```

## Get Comments on a Post

```bash
# By post ID or full URL
node {baseDir}/scripts/reddit.mjs comments POST_ID
node {baseDir}/scripts/reddit.mjs comments "https://reddit.com/r/subreddit/comments/abc123/..."
```

## Submit a Post (requires auth)

```bash
# Text post
node {baseDir}/scripts/reddit.mjs submit yoursubreddit --title "Weekly Discussion" --text "What's on your mind?"

# Link post
node {baseDir}/scripts/reddit.mjs submit yoursubreddit --title "Great article" --url "https://example.com/article"
```

## Reply to a Post/Comment (requires auth)

```bash
node {baseDir}/scripts/reddit.mjs reply THING_ID "Your reply text here"
```

## Moderation (requires auth + mod permissions)

```bash
# Remove a post/comment
node {baseDir}/scripts/reddit.mjs mod remove THING_ID

# Approve a post/comment
node {baseDir}/scripts/reddit.mjs mod approve THING_ID

# Sticky a post
node {baseDir}/scripts/reddit.mjs mod sticky POST_ID

# Unsticky
node {baseDir}/scripts/reddit.mjs mod unsticky POST_ID

# Lock comments
node {baseDir}/scripts/reddit.mjs mod lock POST_ID

# View modqueue
node {baseDir}/scripts/reddit.mjs mod queue yoursubreddit
```

## Notes

- Read actions use Reddit's public JSON API (no auth needed)
- Post/mod actions require OAuth - run `login` command once to authorize
- Token stored at `~/.reddit-token.json` (auto-refreshes)
- Rate limits: ~60 requests/minute for OAuth, ~10/minute for unauthenticated

## Trigger Conditions

When to invoke this skill:

- User asks to read, search, or browse Reddit posts or comments
- User wants to post, reply, or submit content to a subreddit
- User wants to perform moderation actions (remove, approve, sticky, lock)
- Relevant subreddits for DressLikeMommy (DLM) business context: `r/Mommyof2`, `r/Parenting`, `r/MomFashion`, `r/FrugalFemale`, `r/ThriftStoreHauls`, `r/BabyBumps` — monitor these for brand mentions and trends

## Required Inputs

| Input       | Source                      | Required                     | Example                                          |
| ----------- | --------------------------- | ---------------------------- | ------------------------------------------------ |
| subreddit   | User message or DLM context | Yes (for posts/search)       | `wallstreetbets`, `MomFashion`                   |
| query       | User message                | Yes (for search)             | `"matching swimwear"`                            |
| post_id     | User message                | Yes (for comments/reply/mod) | `abc123` or full URL                             |
| credentials | Environment variables       | Yes (for posting/moderation) | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, etc. |

Input validation: subreddit names are alphanumeric + underscores. Post IDs are 5-7 character base36 strings. Full Reddit post URLs are also accepted for comments/reply commands.

## Success Criteria

- [ ] **Read/search**: Command exits 0 and returns at least one result; if zero results, notify user explicitly ("No posts found matching that query.")
- [ ] **Submit post**: Command exits 0 and returns a post ID or URL confirming the post was created; verify post appears in subreddit within 60 seconds
- [ ] **Reply**: Command exits 0 and returns the new comment ID
- [ ] **Moderation action**: Command exits 0 and API response confirms action (remove/approve/sticky/lock/unlock)
- [ ] **All mod/post actions**: Logged to `workspace/memory/reddit-audit.jsonl` with timestamp, action type, target ID, and outcome

## Error Handling

| Failure                       | Detection                                                     | Response                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth token missing or expired | Command exits non-zero with "401" or "unauthorized" in stderr | Re-export credentials from environment and retry once. If still failing, inform user: "Reddit auth failed — please re-run the OAuth setup steps." |
| Rate limit hit                | Response contains "429" or "RATELIMIT"                        | Wait 60 seconds, then retry once. If rate limit persists, abort and notify user.                                                                  |
| Subreddit not found or banned | Response contains "404" or "Forbidden"                        | Notify user: "Subreddit r/[name] was not found or is banned/private." Do not retry.                                                               |
| Post/comment not found        | Response contains "404" for a specific ID                     | Notify user: "Post/comment ID [id] was not found. It may have been deleted."                                                                      |
| Network failure               | Command times out or connection refused                       | Retry once after 10 seconds. If still failing, notify user and abort.                                                                             |
| Credentials not set           | Environment variable is empty                                 | Notify user: "Reddit credentials are not configured. See Setup section above."                                                                    |

## Evidence Standards

- All post/moderation actions (submit, reply, remove, approve, sticky, lock) must be logged to `workspace/memory/reddit-audit.jsonl` with: timestamp (ISO 8601), action, subreddit, target ID, and success/failure status
- When presenting search results or post listings to the user, include: post title, author, subreddit, score, comment count, and post URL
- When presenting comment threads, include: comment author, score, and timestamp
- Do not paraphrase post titles as factual claims — attribute them as "Post titled: ..."
- Raw JSON from the API is internal data; always format for human readability before presenting to user
