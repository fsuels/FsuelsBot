# 123LegalDoc.com QA Findings

## Pinned Facts
- **type**: fact | **Site**: https://123legaldoc.com/en/ (English only for now)
- **type**: fact | **Owner**: Francisco (project for QA testing)
- **type**: constraint | **Scope**: EN pages only until told otherwise
- **type**: constraint | **Payment**: Do NOT complete real payments on production

## Issues Found (2026-02-14)

### P0 - Blocking
| ID | Issue | Status |
|----|-------|--------|
| T-006 | Date fields don't accept any input (Vehicle Bill of Sale) | NEEDS_HUMAN_VERIFICATION |
| T-008 | /en/generate page is EMPTY - pricing CTAs broken | WAITING_HUMAN |

### P1 - High
| ID | Issue | Status |
|----|-------|--------|
| T-004 | Google Maps API key not configured | DONE |
| T-005 | Premature "Invalid date" validation error | DONE |

### P2 - Medium
| ID | Issue | Status |
|----|-------|--------|
| T-001 | Nav labels show camelCase (vehiclesTransfer) | CONFIRMED (still visible 2026-02-17) |
| T-002 | State not pre-populated from modal | DONE |
| T-003 | Generic "Section N" names (no descriptions) | IN_PROGRESS (T-003-H continues) |

## Issues Found (2026-02-17)

### Confirmed Fixed
- NDA date fields work correctly
- State selector works with proper state-specific content loading

### Still Present
- T-001: Navigation shows camelCase labels (vehiclesTransfer, businessOperations, contractorWork, personalDocuments)
  - Only "Property & Rental" displays correctly

## Document Coverage (COMPLETE)
| Document | States Tested | Sections | Status |
|----------|---------------|----------|--------|
| nda | CA | 27 | ✅ WORKING |
| residential-lease-agreement | FL | 63 | ✅ WORKING |
| independent-contractor-agreement | TX | 15 | ✅ WORKING |
| demand-letter-payment | NY | 37 | ✅ WORKING |
| vehicle-bill-of-sale | CA | ~33 | ⛔ BLOCKED (T-006 date field) |

## Document Complexity Comparison
| Document | Sections | Section Names |
|----------|----------|---------------|
| nda | 27 | Generic (Section 1, 2...) |
| residential-lease-agreement | 63 | ✅ Descriptive (jurisdiction, property, landlord, tenant, lease-terms, financial, fees, utilities, rules, maintenance, entry, insurance, termination, legal) |
| independent-contractor-agreement | 15 | ✅ Descriptive (Governing Law, Agreement Details, Company Info, Contractor Info, Services, Term & Schedule, Compensation, Independent Status, Confidentiality & IP, etc.) |
| demand-letter-payment | 37 | ⚠️ Generic (Section 1, 2, 3...) - needs T-003 section tags |
| vehicle-bill-of-sale | ~33 | Unknown (blocked by T-006)

## Good Findings (NDA - 2026-02-17)
- State-specific legal info displayed (CA: CCPA, SB 331, non-compete rules)
- Help buttons with contextual helper text under fields
- "Sign in to save" prompt appears appropriately
- 27 sections with progress tracking
- Dropdown selection works correctly
- Toggle/switch fields have sensible defaults (mutual NDA auto-checked)
- Progress percentage updates in real-time
- Section completion status updates immediately
- Document preview panel shows live updates

## QA Summary (T-007 COMPLETE)
**Completed:** 2026-02-17 06:50 EST
**Browser:** openclaw profile on host (port 18800)

### Documents Verified Working (4/5)
1. **NDA** (CA) - 27 sections, dropdowns/toggles/progress work
2. **Residential Lease** (FL) - 63 sections, text inputs work, state auto-fill works
3. **Independent Contractor** (TX) - 15 sections, auto-completes governing law
4. **Demand Letter** (NY) - 37 sections, dropdowns work

### Blocked (1/5)
- **Vehicle Bill of Sale** - T-006 date field issue

### Open Issues
- **T-001** (P2): camelCase nav labels - CONFIRMED still broken
- **T-006** (P1): Vehicle Bill of Sale date fields
- **T-008** (P0): /en/generate page empty - needs deploy

### Findings
- State-specific content loads correctly for all states tested (CA, FL, TX, NY)
- Form inputs (text, dropdown, toggle) all functional
- Progress tracking updates in real-time
- Some documents need T-003 section tags (demand-letter, nda)
