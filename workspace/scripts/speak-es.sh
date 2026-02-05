#!/bin/bash
# Speak text in Spanish through Mac speakers using Edge TTS (Elena - Argentina)
TEXT="$*"
VOICE="${VOICE:-es-AR-ElenaNeural}"
TEMP_FILE="/tmp/speak_es_$$.mp3"

/Users/fsuels/Library/Python/3.9/bin/edge-tts --voice "$VOICE" --text "$TEXT" --write-media "$TEMP_FILE" 2>/dev/null
afplay "$TEMP_FILE"
rm -f "$TEMP_FILE"
