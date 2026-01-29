# Browser Automation Lessons
**Source:** Shopify product editing session, 2026-01-28

## Errors to NEVER Repeat

### 1. Stale Refs
**Wrong:** `click ref=e764` after page has changed
**Right:** Use `evaluate` with JS to find and click elements by text/class/selector

### 2. Aria Refs + Selectors
**Wrong:** `snapshot refs=aria selector=".myclass"`
**Right:** Use either `refs=aria` OR `selector=`, never both

### 3. PowerShell Syntax
**Wrong:** `cd dir && grep` or `cmd1 || cmd2`
**Right:** `cd dir; findstr` — PowerShell uses `;` not `&&`

### 4. Alicdn Image Fetching
**Wrong:** Direct `image` tool fetch of `cbu01.alicdn.com` URLs — 403 Forbidden
**Right:** Use `browser screenshot` of the 1688 page, or download via browser `evaluate`

### 5. React Input Values
**Problem:** Standard `type` actions don't trigger React state updates in Shopify
**Solution:** Use `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set` + dispatch `input`/`change` events
**Also:** Press Enter via `KeyboardEvent` for group price application

### 6. Token Conservation
**Problem:** Full Shopify page snapshots burn 50K+ tokens → context loss
**Solution:** Use `compact=true`, `element` selectors, `maxChars` limits
**Always:** Use `evaluate` for targeted data extraction instead of full snapshots

### 7. Progress Pings
**Rule:** Send a brief progress update to Francisco every 5-10 minutes during long work sessions. Never go silent for 30+ minutes.
