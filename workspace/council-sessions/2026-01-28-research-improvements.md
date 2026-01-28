# Council Session: 2026-01-28 Research Improvements Review

**Date:** 2026-01-28
**Topic:** Evaluating 4 maintenance items from daily research
**AIs Consulted:** Gemini CLI, ChatGPT 5.2, Grok (rate limited)

## Question Asked

Evaluating 4 Clawdbot maintenance items for tonight. For each: Worth doing? (Yes/No) and Priority (P1=tonight, P2=this week, P3=whenever).

1. Enable Edge TTS - Free voice synthesis without API keys (new in v2026.1.24). 30 min setup.
2. Try Crabwalk - Visual session monitoring tool for Clawdbot by @luccasveg. 1 hr to evaluate.
3. Run moltbot doctor - Security diagnostic command after news of exposed instances online. 5 min.
4. Update to v2026.1.24 - Latest release with security patches. 15 min.

Context: Home setup, personal use, security matters, budget-conscious.

---

## 🤖 GEMINI says:

1. **Enable Edge TTS:** Yes, P3 (Whenever)
   - *Reasoning: Adds a new feature for free. Not urgent.*

2. **Try Crabwalk:** No
   - *Reasoning: Likely overkill for a personal, home setup. The 1-hour time investment is better spent elsewhere.*

3. **Run moltbot doctor:** Yes, P1 (Tonight)
   - *Reasoning: Very fast (5 min) and crucial for security.*

4. **Update to v2026.1.24:** Yes, P1 (Tonight)
   - *Reasoning: Contains security fixes. This is the highest priority.*

---

## 🟢 CHATGPT says:

### Edge TTS Evaluation (separate detailed analysis):
- **Worth it?** Yes (if you use voice daily)
- **Priority:** Medium
- **Risks noted:**
  - Privacy: may route text to Microsoft endpoints
  - Audio spam if assistant is talkative
  - Needs formatting changes for spoken output
- **Recommendation:** Implement if you can name 2 recurring moments/day where you'd prefer audio

### Other Items:
1. **Crabwalk:** Yes (conditionally), Low-Medium priority
   - *Useful for debugging complex agent flows or onboarding collaborators*
   - *Limited immediate security benefit*
   - *"Try it only if you actively debug multi-node/session orchestration"*

2. **Run moltbot doctor:** Yes, High priority
   - *Fast, low-cost validation directly aligned with recent exposure reports*
   - *"Cheap insurance" step*

3. **Update to v2026.1.24:** Yes, High priority
   - *Security fixes + minimal effort*
   - *"Update should precede any further experimentation"*

**ChatGPT Recommended Order:** Update first → Doctor second → Crabwalk optional

---

## 🔴 GROK says:

**RATE LIMITED** - Hit 15-question limit for Grok 4.1 Thinking per 20 hours.

---

## ✅ CONSENSUS (2/2 agree):

| Item | Gemini | ChatGPT | Verdict |
|------|--------|---------|---------|
| Update v2026.1.24 | P1 | High | **P1 - DO TONIGHT** |
| moltbot doctor | P1 | High | **P1 - DO TONIGHT** |
| Edge TTS | P3 | Medium | **P3 - APPROVED** |

## ⚔️ DISAGREEMENT:

| Item | Gemini | ChatGPT | Resolution |
|------|--------|---------|------------|
| Crabwalk | No (overkill) | Yes (conditional) | **REJECTED** - Not needed for single-user home setup |

---

## 🏆 FINAL VERDICT

### Ready to Implement:
1. **Update to v2026.1.24** - P1 (tonight, 15 min)
   - Security fixes are critical after public exposure news
2. **Run moltbot doctor** - P1 (tonight, 5 min)
   - Verify security posture post-update
3. **Enable Edge TTS** - P3 (when time allows, 30 min)
   - Nice-to-have feature, free, low priority

### Rejected:
1. **Try Crabwalk** - Not needed for home setup
   - Reason: Both AIs agree it's low priority. ChatGPT explicitly says "only if you actively debug multi-node orchestration" which doesn't apply here. Gemini says "overkill for personal, home setup."

### Implementation Order:
1. Update first (15 min) → 2. Doctor second (5 min) → 3. Edge TTS later (30 min)

---

## Session Metadata
- Grok unavailable due to rate limit
- Cross-debate skipped (Round B/C) due to only 2 available AIs
- Decisions based on alignment between Gemini and ChatGPT
