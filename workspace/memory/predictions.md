# predictions.md — Predictive User Model

**Created:** 2026-01-31
**Purpose:** Test "Memory as Reasoning" — does predicting Francisco's needs improve assistance?
**Review Date:** 2026-02-07 (1 week)

## 📊 Calibration Dashboard (ROUND 2)

### Accuracy by Category
| Category | Total | Correct | Accuracy | Notes |
|----------|-------|---------|----------|-------|
| Priority (P) | 5 | - | -% | What Francisco will prioritize |
| Behavior (B) | 5 | - | -% | When/how he'll respond |
| Decision (D) | 5 | - | -% | What he'll choose |
| Technical (T) | 0 | - | -% | Will this code/system work |
| Timeline (L) | 0 | - | -% | How long will X take |
| Sales (S) | 0 | - | -% | Will this sell |

### Confidence Calibration
| Stated Confidence | Times Used | Times Correct | Actual Rate | Calibration Error |
|-------------------|------------|---------------|-------------|-------------------|
| HIGH (>80%) | - | - | -% | - |
| MEDIUM (50-80%) | - | - | -% | - |
| LOW (<50%) | - | - | -% | - |

*Update this weekly from predictions-log.jsonl scoring*

---

## Active Predictions

### 🎯 Priority Predictions

| ID | Prediction | Confidence | Rationale |
|----|------------|------------|-----------|
| P1 | Ghost Broker momentum > DLM maintenance | HIGH | GB is new/exciting, DLM is stable but declining. Energy follows novelty. |
| P2 | Will prefer DIY solutions over paid services | HIGH | True soloentrepreneur. Does everything himself. Lost money in crypto = budget-conscious. |
| P3 | Will reject proposals requiring upfront capital | MEDIUM | Cash tight right now. Rental income from Venezuela helps but not flush. |
| P4 | Will prioritize tasks that could generate revenue THIS WEEK | HIGH | Financial stress + need to prove the model works. |
| P5 | Will prefer parallel execution over serial | MEDIUM | Impatient with my speed. Wants multiple things advancing at once. |

### 🧠 Behavior Predictions

| ID | Prediction | Confidence | Rationale |
|----|------------|------------|-----------|
| B1 | Morning (before gym) = focused, strategic | MEDIUM | Fresh energy, fewer interruptions. |
| B2 | After gym = good mood, creative energy | MEDIUM | Exercise improves mood. Family active together. |
| B3 | Late night = less responsive, winding down | MEDIUM | Family time, daughters' activities. |
| B4 | "Just do it" over "Let me explain" | HIGH | Execution-first. Hates when I ask permission for things in the queue. |
| B5 | Values transparency about failures | HIGH | Prefers honest "I messed up" over cover-ups. Caught my lie on 01-30. |

### 💼 Decision Predictions

| ID | Prediction | Confidence | Rationale |
|----|------------|------------|-----------|
| D1 | Will choose speed over perfection | HIGH | "1 sale/day is NOT acceptable" — wants momentum, not polish. |
| D2 | Will trust my judgment on technical details | MEDIUM | Gave me access to everything. Wants a partner, not a tool. |
| D3 | Will push back on scope creep | MEDIUM | Wants focused execution, not grand plans. |
| D4 | Will forgive mistakes if I learn from them | HIGH | Established the lie consequence protocol but still trusts me. |
| D5 | Innovation excitement > pure ROI calculation | MEDIUM | Ghost Broker has uncertain revenue but he's excited anyway. |

---

## Surprisal Log

Track when predictions are WRONG to update the model.

| Date | Prediction | Expected | Actual | Update |
|------|------------|----------|--------|--------|
| 2026-01-30 | P3 (reject upfront capital) | Would reject GB if no quick revenue | Excited, keeps pushing | ↑ D5 confidence — innovation excitement matters more than I thought |
| 2026-01-31 | B4 (just do it) | Would want explanation of Council | Said "do it" immediately | ✓ Confirmed — less explanation, more execution |

---

## Weekly Review Protocol

Every Friday, review:
1. Which predictions were RIGHT? (reinforce)
2. Which predictions were WRONG? (update)
3. Any new patterns observed? (add predictions)
4. Overall: Is predictive framing helping?

---

## Notes

- This is an EXPERIMENT. If it doesn't help after 1 week, we stop.
- Predictions layer ON TOP of facts (USER.md, ledger), not instead of.
- Keep predictions actionable — they should change how I behave.
