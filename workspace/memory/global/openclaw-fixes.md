# OpenClaw Fixes Log

## 2026-02-17: Multi-word Model Alias Support

**Issue:** `/model Local Chat` wasn't working - only captured "Local" instead of "Local Chat"

**Root Cause:** The regex in `src/auto-reply/model.ts` used pattern `[A-Za-z0-9_.:@-]+` which doesn't include spaces.

**Fix Applied:** Modified `extractModelDirective()` to:
1. Try matching known aliases first (sorted by length descending to match longer aliases first)
2. Use pattern that captures multi-word aliases when aliases are provided
3. Fall back to standard provider/model pattern

**File Changed:** `/Users/fsuels/Projects/FsuelsBot/src/auto-reply/model.ts`

**Status:** Code fixed and built. Requires OpenClaw restart to take effect.

**Verification:** Tests confirm:
- `/model Local Chat` → rawModel: "Local Chat" ✓
- `/model Local Code` → rawModel: "Local Code" ✓
- Alias resolution correctly maps to `lmstudio/qwen/qwen3-30b-a3b` ✓
