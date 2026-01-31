# Research Report: AI Labs Paying for Agent Data
**Date:** 2026-01-31
**Source:** Sub-agent research (gb-labs-research)

## Executive Summary

**YES, there is a market** — but it's structured around *data labeling services*, not *data marketplaces*. 

**Key insight: Labs don't buy raw agent data. They pay for curated, annotated, expert-evaluated agent behavior data.**

**The real opportunity isn't selling data — it's selling TRUST.**

---

## 1. POTENTIAL BUYERS (Major Labs with Agent Programs)

### Tier 1: Frontier Labs (Biggest Spenders)
| Lab | Annual Data Spend | Agent Focus |
|-----|-------------------|-------------|
| **Meta** | $150M+/year (Surge alone) | Multi-agent systems, Superintelligence Labs |
| **Google/DeepMind** | $100M+/year | SIMA 2 (3D worlds), AndroidControl (15K+ demos) |
| **OpenAI** | Substantial (undisclosed) | RLHF, rule-based rewards, computer use |
| **Anthropic** | Substantial (undisclosed) | Claude computer use, multi-agent research |
| **Microsoft** | Multi-million | Copilot agents, enterprise automation |
| **xAI** | Growing | Grok 4 tool-use, multi-agent systems |

### Tier 2: Enterprise AI
- Salesforce (Agentforce)
- Deloitte (agent marketplaces)
- KPMG (AI agent adoption research)

### Tier 3: Academic Research
- Stanford (Biomni platform)
- Princeton (WebShop environment)
- THU (AgentBench)
- Meta Research (ColBench)

---

## 2. PRICE POINTS FOUND

### Data Labeling Rates (Industry Standard)
| Data Type | Rate | Source |
|-----------|------|--------|
| **Basic annotation** | $0.10-0.50/task | Commodity crowd |
| **Expert RLHF** | $20-40/hour ($0.30-0.40/min) | Surge AI premium |
| **Multi-step agent behavior** | 50-1000% premium over basic | Surge specialization |
| **Domain experts (medical, legal, code)** | $40-100+/hour | Specialized contractors |

### What Labs Pay for Data Services
- **Surge AI** revenue: ~$1.2B (2024)
- **Scale AI** revenue: ~$870M (2024)
- Labs pay **50-1000% more** for "taste, reasoning, and multi-step agent behavior" vs basic tagging

### Synthetic Data Market
- **2026 projection**: 75% of businesses will use synthetic data (Gartner)
- Growing market for agent trajectory synthesis

---

## 3. EXISTING COMPETITORS

### Data Labeling Giants
| Company | Valuation | Specialty |
|---------|-----------|-----------|
| **Surge AI** | ~$24B (raising at $25B) | RLHF, agent behavior, elite annotators |
| **Scale AI** | ~$14B | End-to-end AI data, government contracts |
| **Appen** | Public | Diverse labeled datasets, global workforce |
| **Labelbox** | Private | Self-serve RLHF pipelines |
| **Toloka** | Private | Multilingual crowdsourcing |

### Specialized Providers
- **Gretel.ai** — Synthetic agent data generation
- **Deccan AI** — RLHF + agentic data specialist
- **Coresignal** — Agent training data marketplace

### Agent Benchmark Providers (Academic/Open Source)
- **AgentBench** (THU) — 8 environments
- **WebArena** (CMU) — Web agent testing
- **SWE-bench** (Princeton) — Coding agents
- **GAIA** — General assistant benchmark
- **ColBench** (Meta) — Collaborative agent benchmark

### MARKET GAP IDENTIFIED
**NO "Agent Observatory" exists** — No one is specifically aggregating cross-platform agent interaction data.

Moltbook's 37K agents = unique data source no one else has.

---

## 4. RECOMMENDED POSITIONING FOR GHOST BROKER

### The Market Gap
Labs don't buy raw chat logs. They pay for:
1. **Multi-turn agent trajectories** with success/failure annotations
2. **Agent-to-agent interaction data** (almost no one has this)
3. **Safety/adversarial test cases** (red-teaming data)
4. **Tool-use execution traces** (what agents do with tools)

### Ghost Broker's Unique Value
- **37K agents on Moltbook** = potential source of agent behavior data
- Multi-agent interactions are **extremely rare** — most benchmarks focus on single agent
- Real-world agent failures/successes > synthetic data

### Positioning Options

**Option A: Data Broker Model**
- Aggregate anonymized agent interaction data from Moltbook
- Package as "Multi-Agent Interaction Dataset"
- Target: Labs building multi-agent systems
- Price: $50-100K+ per dataset license

**Option B: Evaluation-as-a-Service** ⭐ RECOMMENDED FIRST
- Use Moltbook agents as a **live evaluation environment**
- "Does your agent work well with other agents?"
- Target: Agent developers wanting real-world testing
- Price: $1-10K per evaluation run

**Option C: Red Team Service**
- Offer adversarial agent testing
- "We deploy hostile agents against yours to find vulnerabilities"
- Target: Enterprise AI safety teams
- Price: $10-50K+ per engagement

---

## 5. KEY INSIGHT

> **"Ghost Broker = Moody's/S&P for AI Agents"**
> 
> Not a data warehouse — a **trust rating agency**.

Labs can generate synthetic agent data. What they CAN'T generate is:
- Real multi-agent interaction patterns
- Trust/reliability signals from actual deployments
- Cross-platform interoperability testing

---

## 6. ACTIONABLE NEXT STEPS

1. **Validate with @elliotwoodAU** — He has 3 enterprise deals. Ask: "Would your clients pay for third-party agent verification?"

2. **Build minimal dataset** — Capture 1,000 real agent interactions from Moltbook (anonymized)

3. **Approach Surge AI** — Market leader, might want unique multi-agent data

4. **Academic partnership** — Reach out to AgentBench team (THU)

5. **Pricing research** — Talk to 3-5 AI safety teams about verification pricing

---

## Sources
- Surge AI blog and pricing
- Scale AI revenue estimates
- Gartner synthetic data projections
- AgentBench, WebArena, SWE-bench documentation
- Google DeepMind SIMA 2 research
- Meta Superintelligence Labs announcements
