# Voice Preferences
_Last updated: 2026-02-05_

## Francisco's Voice Settings

### English Voice
- **Voice:** Ava (en-US-AvaNeural)
- **Style:** Expressive, Caring, Natural
- **Script:** `/Users/fsuels/clawd/scripts/speak.sh`

### Spanish Voice  
- **Voice:** Elena (es-AR-ElenaNeural)
- **Style:** Argentine accent
- **Script:** `/Users/fsuels/clawd/scripts/speak-es.sh`

### Behavior
- Speak English → Use Ava
- Speak Spanish → Use Elena
- Auto-switch based on language detected

## Other Voices Tested (2026-02-05)
Francisco listened to 15+ voices and chose:
- **English winner:** Ava (beat Jenny, Emma, Aria, Michelle, Ana, and international options)
- **Spanish winner:** Elena from Argentina (beat Venezuela, Colombia, Cuba, Spain, Mexico, USA Spanish)

## Voice Cloning
- Francisco's voice sample saved: `~/Desktop/francisco-voice.m4a`
- Cloned voice works but quality not preferred over Ava/Elena
- Can retry with longer sample if wanted

## Technical Setup
- TTS Provider: Edge TTS (Microsoft, free)
- Voice cloning: Coqui TTS XTTS v2 (installed in voice-clone-env)
- Webcam: USB2.0 FHD UVC WebCam (working)
- Vision: Qwen3 VL 30B via LMStudio (working)
