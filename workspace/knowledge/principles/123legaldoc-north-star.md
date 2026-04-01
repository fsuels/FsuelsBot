---
version: "1.1"
created: "2026-02-18"
updated: "2026-03-31"
verified: "2026-03-31"
confidence: "high"
---

# 123LegalDoc North Star

Type: principle
Last updated: 2026-03-31

## Outcome Priority

Ship a legal-doc experience that is reliable, clear, and conversion-safe.

## Non-Negotiables

- Accuracy over speed for legal-form behavior
- Clear user-facing labels and field guidance
- No unsafe production actions (especially payments, form submissions, or data deletion)
- Every fix ties to a reproducible acceptance check
- Legal content must never be hallucinated — only use verified templates and field definitions

## Working Standard

- Close high-impact blockers first.
- Keep findings concise, testable, and traceable to known issue IDs.
- Test in staging/preview before touching production.

## What This Project IS

123LegalDoc is a legal document preparation service. The bot's role here is:

1. **Form behavior testing** — verify that document wizards, field validations, and conditional logic work correctly
2. **Content accuracy** — ensure legal language, disclaimers, and field labels are precise
3. **Conversion optimization** — improve the path from landing page to completed document purchase
4. **Bug triage** — reproduce, isolate, and document defects with clear reproduction steps

## What This Project Is NOT

- The bot does NOT generate legal advice or modify legal language without explicit human approval
- The bot does NOT process real customer payments or submit forms on behalf of users
- The bot does NOT make architectural decisions for the 123LegalDoc codebase without review

## Quality Gates

| Action                          | Gate                                          |
| ------------------------------- | --------------------------------------------- |
| Modifying legal text/labels     | Requires Francisco approval                   |
| Changing form logic/validation  | Must have acceptance test BEFORE deployment   |
| Touching payment flow           | NEVER without explicit instruction            |
| SEO/meta changes                | Can proceed independently, but log the change |
| Bug fix with reproduction steps | Can proceed, commit with issue ID reference   |

## Relationship to FsuelsBot

123LegalDoc is one of multiple projects FsuelsBot operates on. Context isolation is critical:

- DLM (Dress Like Mommy) knowledge must not bleed into 123LegalDoc sessions
- 123LegalDoc has its own workflow: `procedures/123legaldoc-workflow.md`
- When switching projects, reload the relevant north star and workflow files

## Cross-References

- `procedures/123legaldoc-workflow.md` — step-by-step operational workflow
- `principles/fsuelsbot-north-star.md` — parent operator principles
- `goal-hierarchy.md` — DLM-specific, but the pattern applies: every 123LegalDoc task must map to a measurable outcome
