#!/bin/bash
# Speak text through Mac speakers using Edge TTS
TEXT="$*"
VOICE="${VOICE:-en-US-AvaNeural}"
TEMP_FILE="/tmp/speak_$$.mp3"

/Users/fsuels/Library/Python/3.9/bin/edge-tts --voice "$VOICE" --text "$TEXT" --write-media "$TEMP_FILE" 2>/dev/null
afplay "$TEMP_FILE"
rm -f "$TEMP_FILE"
