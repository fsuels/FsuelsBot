#!/bin/bash
# Capture webcam and save to workspace
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTPUT="/Users/fsuels/clawd/webcam-$TIMESTAMP.jpg"
imagesnap -d "USB2.0 FHD UVC WebCam" "$OUTPUT" 2>/dev/null
echo "$OUTPUT"
