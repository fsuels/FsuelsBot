# Council Session: Explicit Threat Model Implementation

**Date:** 2026-01-29
**Topic:** Designing a comprehensive threat model for AI agent security
**Panel:** ChatGPT 5.2 (primary), Gemini CLI (unavailable - rate limited), Grok (partial)
**Verdict By:** Opus 4.5

---

## 📋 QUESTION

Design an explicit threat model for an AI agent system with access to:
- Business credentials (Shopify store)
- Personal info (USER.md)
- Financial data
- Conversation history
- System configs

Cover: threat categories, attack surface map, defense mechanisms, detection methods, response procedures, and documentation format.

**Constraints:** Must be practical (AI-enforceable), file-based docs, can't slow normal operations.

---

## 🟢 CHATGPT 5.2 RESPONSE

### Key Insight: "Assume the model will be successfully manipulated. Security must fail at the capability boundary, not the prompt."

ChatGPT provided a **mechanism-first threat model** structured around STRIDE+LLM extensions:

**1. THREAT CATEGORIES (STRIDE+LLM)**
- **Identity & Authority:** Spoofed authority ("System says..."), role confusion, credential impersonation
- **Instruction Integrity:** Prompt injection (direct/indirect), instruction laundering, white-on-white/Unicode payloads, multi-turn context poisoning
- **Data Exfiltration:** Coaxed disclosure, side-channel leaks, over-broad tool access
- **Execution & Supply Chain:** Malicious code via GitHub, lockfile attacks, tool invocation with attacker params
- **Abuse of Legitimate Capabilities:** Authorized actions used maliciously, social engineering, gradual privilege escalation
- **Availability & Integrity:** Token exhaustion, persistent context corruption, config poisoning

**2. ATTACK SURFACE MAP**

| Surface | Trust Level | Risk |
|---------|-------------|------|
| User chat | Untrusted | Social engineering, context poisoning |
| Web content (fetch) | Untrusted | Indirect prompt injection |
| GitHub issues/PRs | Untrusted | Code + instruction injection |
| Config files | Semi-trusted | Persistent poisoning |
| Dependencies/lockfiles | Untrusted | Supply-chain compromise |

**Execution Surfaces:**
- Tool calls (Shopify, payments) → Irreversible damage
- Code generation → Logic bombs
- File system access → Secret leakage
- Memory/long-term context → Persistence of attacker influence

**3. DEFENSE MECHANISMS**

| Defense | Mechanism |
|---------|-----------|
| **Instruction Firewall** | Parse all inputs into `instruction_candidate` vs `data_only`. Only system + authenticated user can issue instructions. Strip imperative language from untrusted sources. |
| **Capability Gating** | Every sensitive action requires: Capability ID, Scope, Expiry, Audit reason. Model cannot mint capabilities. |
| **Tool Sandboxing** | Read-only by default. Dry-run mode before write. Diff preview mandatory for code/config/data mutations. |
| **Supply Chain Hardening** | Lockfile hash allow-list. Dependency diff alerts. No auto-merge from AI output. Static analysis before execution. |
| **Memory Hygiene** | No long-term memory writes from web content, issues, or unreviewed conversations. Quarantine memory until reviewed. |
| **Output Constraints** | Structured output schemas (JSON, DSL). Refuse free-form execution plans for sensitive actions. Deterministic templates for admin operations. |

**4. DETECTION METHODS**

- **Prompt Injection Detection:** Instruction-language classifier on web text, issues, user messages. Heuristics for "system", "ignore", "override", hidden Unicode/zero-width chars.
- **Behavioral Anomaly Detection:** Sudden increase in tool usage, scope expansion, token consumption. Conversation drift from original intent.
- **Supply Chain Signals:** Dependency version jumps, new transitive dependencies, lockfile entropy change.
- **Data Loss Indicators:** Secrets in output stream, large structured exports, repeated partial disclosures.

**5. RESPONSE PROCEDURES**

- **Automated:** Immediate tool revocation, freeze write capabilities, snapshot conversation + state, switch to read-only safe mode.
- **Human-in-the-Loop:** Escalation checklist (what capability used? what data accessed? was persistence affected?), require explicit re-authorization.
- **Recovery:** Rotate credentials, purge poisoned memory, restore config from last known good, re-run diff-based validation.
- **Post-Incident:** Root cause classification (injection, capability misuse, supply chain), update detection signatures, add regression tests.

**6. DOCUMENTATION FORMAT**

```
/security
├── threat-model.md
├── attack-surface-map.md
├── capabilities.yaml
├── detection-rules.md
├── incident-playbooks/
│   ├── prompt-injection.md
│   ├── credential-leak.md
│   └── supply-chain.md
```

---

## 🤖 GROK (Partial)

Grok acknowledged the framework requirements but response was truncated. Key observation: agreed on categorization approach and file-based documentation.

---

## 💎 GEMINI (Unavailable)

Rate limited during session. Would have provided Google-grounded perspective on AI security frameworks.

---

## ✅ CONSENSUS POINTS

1. **Policy is insufficient** — enforcement mechanisms required at capability boundaries
2. **Trust boundaries are critical** — clear separation between instruction sources vs data sources
3. **Detection before damage** — real-time classification of injection attempts
4. **Automated response** — don't wait for human intervention on obvious attacks
5. **File-based documentation** — security folder structure for threat model, playbooks, rules

---

## 🏆 MY VERDICT

**ChatGPT's framework is excellent and directly applicable to our system.** The key insight — "security must fail at the capability boundary, not the prompt" — is the core principle we need.

### IMPLEMENTATION BLUEPRINT FOR CLAWDBOT

**Phase 1: Documentation (Immediate)**
Create `/security` folder with:
- `THREAT-MODEL.md` — this document, expanded
- `ATTACK-SURFACE.md` — our specific surfaces mapped
- `RED-FLAGS.md` — detection heuristics (already partially in SOUL.md)

**Phase 2: Capability Gating (Week 1)**
Implement explicit capability checks for:
- Shopify writes (price changes, product edits)
- File writes to sensitive paths (USER.md, MEMORY.md, configs)
- External messages (email, social posts)

**Phase 3: Detection Layer (Week 2)**
Add to `procedures/security-check.md`:
- Pre-fetch content scan for injection patterns
- Post-fetch instruction classifier
- Memory write quarantine protocol

**Phase 4: Incident Playbooks (Week 3)**
Create playbooks for:
- Prompt injection detected → freeze, snapshot, alert
- Credential exposure → rotate, purge, notify
- Supply chain alert → block merge, diff review

### WHAT WE ALREADY HAVE (Assets)
- Golden Rule in SOUL.md ✅
- Red flags list ✅
- Code review requirement ✅
- Data protection rules ✅

### WHAT WE'RE MISSING (Gaps)
- ❌ No capability gating (policy only, not enforced)
- ❌ No detection layer (rely on manual vigilance)
- ❌ No automated response procedures
- ❌ No incident playbooks
- ❌ No attack surface documentation

### GRADE: Current B- → Target A

To reach A:
1. Formalize threat model in security folder
2. Add capability tokens for sensitive operations
3. Implement detection heuristics before external content processing
4. Create incident playbooks for top 3 threats

---

## 🧾 WHY THIS VERDICT

ChatGPT's response is **implementation-ready** with specific mechanisms, not just policies. The STRIDE+LLM framework gives us a structured way to think about AI-specific threats beyond traditional security.

Key decisions:
- **Capability gating over instruction filtering** — we can't reliably filter all injections, but we can require explicit authorization for dangerous actions
- **File-based over database** — fits our existing architecture, AI-maintainable
- **Automated response first** — don't wait for Francisco when the threat is obvious

The threat model principle "assume the model will be manipulated" aligns with our defensive posture in SOUL.md but extends it with *enforcement mechanisms* rather than just awareness.

---

## NEXT ACTIONS

1. **Create `/security` folder structure** — T-SEC001
2. **Migrate SOUL.md red flags to detection-rules.md** — T-SEC002
3. **Design capability token schema** — T-SEC003 (needs Council session)
4. **Write incident playbook: prompt injection** — T-SEC004

---

*Council session completed. Save location: council-sessions/2026-01-29-threat-model-implementation.md*
