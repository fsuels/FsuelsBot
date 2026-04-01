---
name: youtube-watcher
description: Fetch and read transcripts from YouTube videos. Use when you need to summarize a video, answer questions about its content, or extract information from it.
author: michael gathara
version: 1.0.0
triggers:
  - "watch youtube"
  - "summarize video"
  - "video transcript"
  - "youtube summary"
  - "analyze video"
metadata:
  {
    "clawdbot":
      {
        "emoji": "📺",
        "requires": { "bins": ["yt-dlp"] },
        "install":
          [
            {
              "id": "brew",
              "kind": "brew",
              "formula": "yt-dlp",
              "bins": ["yt-dlp"],
              "label": "Install yt-dlp (brew)",
            },
            {
              "id": "pip",
              "kind": "pip",
              "package": "yt-dlp",
              "bins": ["yt-dlp"],
              "label": "Install yt-dlp (pip)",
            },
          ],
      },
  }
---

# YouTube Watcher

Fetch transcripts from YouTube videos to enable summarization, QA, and content extraction.

## Usage

### Get Transcript

Retrieve the text transcript of a video.

```bash
python3 {baseDir}/scripts/get_transcript.py "https://www.youtube.com/watch?v=VIDEO_ID"
```

## Examples

**Summarize a video:**

1. Get the transcript:
   ```bash
   python3 {baseDir}/scripts/get_transcript.py "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
   ```
2. Read the output and summarize it for the user.

**Find specific information:**

1. Get the transcript.
2. Search the text for keywords or answer the user's question based on the content.

## Notes

- Requires `yt-dlp` to be installed and available in the PATH.
- Works with videos that have closed captions (CC) or auto-generated subtitles.
- If a video has no subtitles, the script will fail with an error message.

## Trigger Conditions

When to invoke this skill:

- User shares a YouTube URL and asks to summarize, analyze, or extract information from it
- User says "watch youtube", "summarize video", "video transcript", "youtube summary", or "analyze video"
- User pastes a YouTube link in conversation context

## Required Inputs

| Input     | Source               | Required                | Example                                              |
| --------- | -------------------- | ----------------------- | ---------------------------------------------------- |
| video_url | User message         | Yes                     | `https://www.youtube.com/watch?v=dQw4w9WgXcQ`        |
| language  | User or default (en) | No                      | "en", "es", "fr"                                     |
| action    | User intent          | No (default: summarize) | "summarize", "extract timestamps", "answer question" |

Accepted URL formats: `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`. Playlists are not supported — process one video at a time.

## Success Criteria

- [ ] `yt-dlp` is installed and reachable in PATH
- [ ] Script exits with code 0
- [ ] Transcript output is non-empty (>100 characters)
- [ ] Video metadata (title, channel, upload date) is present in output header
- [ ] Agent reports word count of retrieved transcript to user

## Error Handling

| Failure                                       | Detection                                                         | Response                                                                                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yt-dlp` not installed                        | `which yt-dlp` returns non-zero                                   | Inform user: "yt-dlp is required. Install with `brew install yt-dlp` or `pip install yt-dlp`." Abort.                                                |
| Video is private or age-restricted            | Script exits non-zero with "Private video" or "Sign in" in stderr | Notify user: "This video is private or age-restricted and cannot be accessed."                                                                       |
| No subtitles available (manual CC)            | Script exits with "no subtitles" message                          | Retry with `--write-auto-sub` flag to attempt auto-generated subtitles. If still unavailable, notify user: "No transcript available for this video." |
| Auto-generated subtitles also unavailable     | Second attempt also fails                                         | Notify user. Do not attempt further retries.                                                                                                         |
| URL is not a valid YouTube link               | URL does not match known YouTube patterns                         | Inform user: "Please provide a valid YouTube video URL."                                                                                             |
| Transcript is suspiciously short (<100 chars) | Check output length after retrieval                               | Warn user: "Transcript appears incomplete ([N] chars). Results may be inaccurate."                                                                   |

## Evidence Standards

- Always include a metadata header in output: video title, channel name, upload date, duration, and subtitle source ("manual CC" vs. "auto-generated")
- Tag the transcript source explicitly: `[Source: auto-generated subtitles]` or `[Source: manual closed captions]`
- Auto-generated transcripts lack punctuation and may have errors — note this caveat when summarizing
- Do not present auto-generated transcript content as verbatim quotes; treat as approximate
- Include the original video URL in any summary delivered to the user for source attribution
