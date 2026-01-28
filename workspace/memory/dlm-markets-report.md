# DLM Markets Configuration Report

**Date:** 2025-07-13
**Store:** dresslikemommy.com
**Task:** Create dedicated markets for UK, Canada, and Australia after deactivating International/Eurozone markets to block Chinese bot traffic.

## Markets Overview

### ✅ Active Markets

| Market | Status | Region(s) | Currency | Shopify ID |
|--------|--------|-----------|----------|------------|
| **United States** | Active | United States | USD (+ Catalogs) | 544735329 |
| **United Kingdom** | Active | United Kingdom | GBP (Dynamic FX) | 22986260577 |
| **Canada** | Active | Canada | CAD (Dynamic FX) | 22986326113 |
| **Australia** | Active | Australia | AUD (Dynamic FX) | 22986424417 |

### 🚫 Draft (Inactive) Markets

| Market | Status | Region(s) | Notes |
|--------|--------|-----------|-------|
| **International** | Draft | 131 regions | Deactivated to block bot traffic |
| **Eurozone** | Draft | 43 regions | Deactivated to block bot traffic |
| **Estonia** | Draft | Estonia | Pre-existing, was already in Draft |

## What Was Done

1. **United Kingdom market** — Created as new dedicated market with only UK, set to Active. Auto-configured with British Pound (GBP) Dynamic FX.
2. **Canada market** — Created as new dedicated market with only Canada, set to Active. Auto-configured with Canadian Dollar (CAD) Dynamic FX.
3. **Australia market** — Created as new dedicated market with only Australia, set to Active. Auto-configured with Australian Dollar (AUD) Dynamic FX.

## Key Notes

- All three new markets inherit from the **International** parent market (which is in Draft)
- Each market auto-received its local currency with Dynamic FX conversion
- Domain/language inherited from Store default: `www.dresslikemommy.com` (English, Spanish)
- Shipping: Each market has 4 shipping rates configured
- Taxes: "Not collecting" inherited from Store default — may want to review for UK/Australia VAT/GST obligations
- The US primary market remains fully active and unaffected
