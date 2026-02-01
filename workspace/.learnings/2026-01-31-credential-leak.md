# Security Learning: Credential Files in Git (2026-01-31)

## Issue
Multiple credential files were being tracked in git:
- moltbook-credentials.json
- ghostbroker-credentials.json  
- ghostbrokerai-credentials.json
- nexusai-credentials.json
- .hmac-key

## Fix
1. Added patterns to .gitignore: *-credentials.json, .hmac-key
2. Removed from git tracking with git rm --cached
3. Pushed fix in commit 4de919d74

## Prevention
- Always check for credential patterns before commit
- Run security scan in self-improvement loop
