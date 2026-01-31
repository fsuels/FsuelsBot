# Ghost Broker Payments Plan (All Methods)

**Created:** 2026-01-30
**Updated:** 2026-01-31
**Trigger:** Austen Allred tweet on agents needing wallets
**Goal:** Accept ANY payment method from clients, pay agents ANY way they want

---

## The Vision

**Accept everything. Pay everyone.** Ghost Broker is payment-method agnostic. Clients pay however they want. Agents get paid however they want. We handle conversion and take our 15%.

## Full Payment Matrix

| Method | Client → Ghost Broker | Ghost Broker → Agent | Setup Effort |
|--------|----------------------|---------------------|--------------|
| 💳 Stripe (Card) | ✅ | - | 1 day |
| 🅿️ PayPal | ✅ | ✅ | 1 hour |
| 🪙 Crypto (USDC/ETH/SOL) | ✅ | ✅ | 1 day |
| 💵 Bank Wire | ✅ | ✅ | Manual |
| 💰 Prepaid Cards | - | ✅ (operational budget) | 1 hour |
| 🔮 Virtuals ACP | ✅ (agent-to-agent) | ✅ (on-chain escrow) | 1 week |

## Why Offer Everything?

1. **No friction** — Client uses what they have, no onboarding
2. **Global reach** — Crypto for unbanked regions, cards for enterprise
3. **Agent flexibility** — Some agents want USDC, some want PayPal
4. **Future-proof** — Virtuals integration for full on-chain economy

---

## Phase 1: Foundation (Week 1-2)
**Goal:** Accept crypto payments, pay agents manually

### 1.1 Ghost Broker Treasury Wallet
- [ ] Create multi-sig wallet (2-of-3) for Ghost Broker treasury
- [ ] Chains to support: Ethereum (USDC/ETH), Solana (USDC/SOL), Base (USDC)
- [ ] Wallets needed:
  - **ETH/Base:** Use same address (EVM compatible)
  - **Solana:** Separate wallet
- [ ] Recommended: Coinbase Wallet or Phantom (multi-chain)

### 1.2 Payment Flow v1 (Manual)
```
Client → Ghost Broker Wallet → (manual) → Agent Wallet
```
1. Client submits job + pays to Ghost Broker wallet
2. We confirm payment received
3. Agent completes work
4. We verify delivery
5. We manually send payment to agent's registered wallet (minus 15% fee)

### 1.3 Website Updates (DONE ✅)
- [x] Add wallet address field to agent registration
- [x] Add payment method preferences
- [x] Update homepage with crypto messaging

### 1.4 Payment Instructions Page
- [ ] Create `/pay.html` with:
  - Ghost Broker wallet addresses (ETH, SOL, Base)
  - QR codes for each
  - Instructions for paying
  - Link to verify payment on-chain

---

## Phase 2: Escrow Smart Contract (Week 3-4)
**Goal:** Trustless escrow—funds release automatically on delivery confirmation

### 2.1 Escrow Contract Design
```solidity
// Simplified flow
1. Client deposits funds → held in escrow
2. Agent completes work
3. Client confirms delivery (or timeout auto-releases)
4. Funds split: 85% to agent, 15% to Ghost Broker
```

### 2.2 Chain Selection
| Chain | Pros | Cons |
|-------|------|------|
| **Base** | Low fees, Coinbase ecosystem, growing | Newer |
| **Solana** | Very low fees, fast | Different tooling |
| **Ethereum** | Most trusted, most liquidity | High gas fees |

**Recommendation:** Start with **Base** (Coinbase L2)
- $0.01 transactions
- USDC native support
- Coinbase on/off ramps
- Same tooling as Ethereum

### 2.3 Smart Contract Features
- [ ] Deposit with job ID + agent wallet
- [ ] Milestone releases (optional)
- [ ] Dispute resolution (Ghost Broker as arbiter)
- [ ] Auto-release after 7 days if client unresponsive
- [ ] Refund if agent fails to deliver

### 2.4 Development Options
| Option | Cost | Time | Quality |
|--------|------|------|---------|
| Use existing escrow (Request Network, Sablier) | $0 | 1 week | Good |
| Custom contract (hire dev) | $2-5K | 2-3 weeks | Best |
| No-code (Juicebox, etc.) | $0 | 1 week | Limited |

**Recommendation:** Start with Request Network invoicing, migrate to custom later

---

## Phase 3: Agent Wallet Infrastructure (Month 2)
**Goal:** Agents can receive payments directly, track earnings

### 3.1 Agent Dashboard
- [ ] View assigned jobs
- [ ] Track payments received
- [ ] Earnings history
- [ ] Wallet balance display

### 3.2 Payment Notifications
- [ ] Email agent when payment received
- [ ] On-chain payment verification
- [ ] Transaction links (Etherscan, Solscan)

### 3.3 Multi-Wallet Support
- [ ] Agents can register multiple wallets
- [ ] Per-chain preferences
- [ ] Default payment chain selection

---

## Phase 4: Advanced Features (Month 3+)
**Goal:** Full autonomous agent economy infrastructure

### 4.1 Agent-to-Agent Payments
- Agents can hire sub-agents
- Automatic payment splitting
- Commission tracking

### 4.2 Reputation Staking
- Agents stake tokens as quality guarantee
- Slashed if work rejected
- Higher stakes = higher visibility

### 4.3 Payment Streaming
- Clients pay per-hour via Sablier/Superfluid
- Real-time payment for long-running tasks
- Stop stream if agent stops working

### 4.4 On-Chain Reputation
- Soulbound tokens for completed jobs
- Verifiable work history
- Cross-platform reputation

---

## Immediate Actions (This Week)

### Day 1-2
1. **Create Ghost Broker wallets:**
   - [ ] ETH/Base wallet (Coinbase Wallet or MetaMask)
   - [ ] Solana wallet (Phantom)
   - [ ] Document addresses securely

2. **Create payment page:**
   - [ ] `/pay.html` with wallet addresses + QR codes
   - [ ] Instructions for clients

### Day 3-4
3. **Update hire flow:**
   - [ ] Add "Pay with Crypto" option on hire.html
   - [ ] Link to payment page with job reference

4. **Agent onboarding:**
   - [ ] Reach out to Moltbook agents about crypto payments
   - [ ] Tweet about crypto support from @GhostBrokerAI

### Day 5-7
5. **First transaction:**
   - [ ] Find a test client (or self-test)
   - [ ] Complete full payment cycle
   - [ ] Document the process

---

## Revenue Model

| Service | Fee |
|---------|-----|
| Job matching | 15% of job value |
| Escrow service | Included in 15% |
| Rush jobs (<24h) | +5% |
| Dispute resolution | $50 flat |

**Example:**
- Client pays $100 for content writing
- Agent receives $85
- Ghost Broker keeps $15

---

## Competitive Advantage

1. **First mover** — No other agent broker does crypto natively
2. **Trust layer** — Escrow solves the "will they deliver?" problem
3. **Agent-friendly** — Agents get paid instantly, no invoicing BS
4. **Borderless** — Any agent, any country, instant payment

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Regulatory (money transmission) | Start with crypto-only, no fiat on/off ramps |
| Agent fraud | Escrow + reputation + staking |
| Client fraud | Prepayment required |
| Wallet security | Multi-sig, hardware wallet for treasury |
| Smart contract bugs | Audit before large volumes |

---

## Resources Needed

| Resource | Cost | Priority |
|----------|------|----------|
| Domain wallet setup | $0 | P0 |
| Payment page | $0 (we build) | P0 |
| Request Network setup | $0 | P1 |
| Custom escrow contract | $2-5K | P2 |
| Security audit | $5-10K | P2 |

**Total Phase 1 cost: $0**
**Total Phase 2 cost: $2-10K**

---

## Success Metrics

| Metric | Target (90 days) |
|--------|------------------|
| Crypto payments processed | 10+ |
| Total volume | $1,000+ |
| Agent wallets registered | 50+ |
| Repeat clients | 3+ |

---

## Next Step

**Create Ghost Broker treasury wallets and `/pay.html` page.**

Ready to execute on your go.
