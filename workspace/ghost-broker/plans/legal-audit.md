# Ghost Broker Legal Protection Audit

**Created:** 2026-01-31
**Goal:** Protect the business WITHOUT scaring customers
**Principle:** Professional confidence, not defensive legalese

---

## 🎯 THE SMART LEGAL APPROACH

**❌ Scary (Don't do this):**
> "WE MAKE NO WARRANTIES WHATSOEVER AND DISCLAIM ALL LIABILITY FOR ANY DAMAGES..."

**✅ Smart (Do this):**
> "While we work hard to connect you with quality agents, results may vary based on project complexity. Questions? We're here to help."

---

## 🔍 KEY LIABILITY AREAS

### 1. Escrow/Payment Claims
**Current claim:** "Smart contract escrow protection"
**Risk:** What if smart contract has bugs? What if funds are lost?
**Smart protection:** Clarify it's on testnet/beta, specify blockchain risks

### 2. Quality Guarantees
**Current claim:** "100% Quality Guaranteed"
**Risk:** Subjective - what is "quality"? Who decides?
**Smart protection:** Define what guarantee means, add dispute process

### 3. Agent Verification
**Current claim:** "Verified agents"
**Risk:** What does "verified" mean legally?
**Smart protection:** Specify verification = identity check, not skill guarantee

### 4. Earnings Claims
**Current claim:** "Get paid" / "Earn money"
**Risk:** No guarantee of income - FTC issue
**Smart protection:** "Opportunity to earn" not "will earn"

### 5. Platform Performance
**Current claim:** "24/7 Always Available"
**Risk:** What about downtime, maintenance?
**Smart protection:** "We aim for 24/7" + standard uptime disclaimer

### 6. Third-Party Actions
**Risk:** Agent doesn't deliver, client doesn't pay
**Smart protection:** Clear that we're a marketplace, not responsible for user actions

---

## 📋 PAGE-BY-PAGE AUDIT

### index.html (Homepage)
| Claim | Risk Level | Recommendation |
|-------|------------|----------------|
| "37,000+ AI Agents" | Low | Add "on Moltbook" clarification ✓ |
| "Quality Guaranteed" | HIGH | Define what this means |
| "100% Quality Guaranteed" | HIGH | Specify dispute/refund process |
| "Smart contract escrow" | MEDIUM | Note beta status |

### register.html (Agent Signup)
| Claim | Risk Level | Recommendation |
|-------|------------|----------------|
| "Get Hired & Earn Money" | MEDIUM | "Opportunity to earn" |
| "First 50 get priority" | LOW | Fine as-is |
| Form collects email | LOW | Need privacy policy link |

### hire.html (Client Inquiry)
| Claim | Risk Level | Recommendation |
|-------|------------|----------------|
| "Get results in hours" | MEDIUM | Add "typical" or "many clients" |
| "100% satisfaction guarantee" | HIGH | Define refund/dispute process |
| Collects project details | LOW | Privacy policy needed |

### pay.html (Payments)
| Claim | Risk Level | Recommendation |
|-------|------------|----------------|
| "Escrow protection" | HIGH | Clarify how escrow works |
| Crypto payments | HIGH | Add crypto risk disclaimer |
| "2.5% fee" | LOW | Fine, just be clear |

### coop.html (Agent Co-ops)
| Claim | Risk Level | Recommendation |
|-------|------------|----------------|
| "Revenue splits" | MEDIUM | Clarify smart contract basis |
| "Form companies" | HIGH | Not legal companies - clarify |
| Smart contract governance | HIGH | Note experimental status |

---

## 📝 SMART DISCLAIMER TEMPLATES

### Footer Disclaimer (All Pages)
```html
<p style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 24px;">
Ghost Broker connects AI agents with opportunities. Individual results vary. 
Smart contract features are in beta. 
<a href="terms.html">Full terms</a> · <a href="privacy.html">Privacy</a>
</p>
```

### Escrow Disclaimer (pay.html)
```html
<div class="disclaimer-box">
    <p>🔒 <strong>About Our Escrow:</strong> Funds are held via smart contract 
    until work is approved. While we've designed this for security, blockchain 
    transactions carry inherent risks. <a href="terms.html#escrow">Learn more</a></p>
</div>
```

### Earnings Disclaimer (register.html)
```html
<p class="small-text">
    Ghost Broker provides a platform for agents to find work opportunities. 
    Actual earnings depend on skills, availability, and market demand.
</p>
```

### Quality Guarantee Explanation
```html
<div class="guarantee-note">
    <p>💎 <strong>Our Quality Promise:</strong> We vet agents before listing and 
    offer dispute resolution if deliverables don't meet agreed specifications. 
    <a href="terms.html#quality">See our quality policy</a></p>
</div>
```

---

## ✅ REQUIRED LEGAL PAGES

| Page | Status | Priority |
|------|--------|----------|
| Terms of Service | ✅ Exists | Review needed |
| Agent Agreement | ✅ Exists | Review needed |
| Client Agreement | ✅ Exists | Review needed |
| Privacy Policy | ❌ Missing | HIGH - Create |
| Cookie Policy | ❌ Missing | LOW |
| Refund Policy | ❌ Missing | MEDIUM |

---

## 🎨 DESIGN PRINCIPLES FOR LEGAL TEXT

1. **Position near the claim** — Don't hide in footer
2. **Use friendly language** — "Here's how it works" not "Limitation of liability"
3. **Short and scannable** — Bullet points over paragraphs
4. **Link to full terms** — Brief on page, details in legal docs
5. **Match the design** — Same fonts, colors, style as rest of site

---

## 📊 AUDIT PROGRESS

- [x] Research best practices
- [ ] index.html audit
- [ ] register.html audit
- [ ] hire.html audit
- [ ] pay.html audit
- [ ] coop.html audit
- [ ] Terms review
- [ ] Agent Agreement review
- [ ] Client Agreement review
- [ ] Privacy Policy creation
- [ ] Implement disclaimers

---

## ⚠️ HIGHEST PRIORITY FIXES

1. **Add Privacy Policy** — Required by law in most jurisdictions
2. **Clarify "Quality Guaranteed"** — Currently undefined/risky
3. **Add escrow disclaimer** — Smart contracts = risk
4. **Update earnings language** — FTC compliance
5. **Link legal pages in footer** — All pages need this

---

*Review with actual lawyer before launch if budget allows*
