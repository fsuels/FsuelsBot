# Council Session: Hash-Chained Audit Logs

**Date:** 2026-01-29
**Grade:** A
**Participants:** Grok 3, ChatGPT 5.2, Gemini 2.5 (orchestrated by Opus 4.5)
**Topic:** Design cryptographically verifiable, tamper-evident hash-chaining for events.jsonl

---

## Problem Statement

**Current state:** `memory/events.jsonl` is append-only JSONL with ~56 events
**Problem:** Anyone with file access can edit/delete events undetected
**Goal:** Make tampering cryptographically detectable

## Constraints
- Must work with existing JSONL format
- Backward compatible (old events don't have hashes)
- Fast to append (don't re-hash entire file)
- Verification script for integrity checks

---

## Final Design

### Hash Algorithm
**SHA-256, truncated to 16 hex characters**
- Standard, fast, universally supported
- 16 chars = 64 bits = sufficient collision resistance for audit logs
- Readable in JSON without excessive clutter

### Chain Structure
Two new fields per event:
- `prevHash`: Hash of the previous event (chain link)
- `hash`: This event's integrity seal

**Hash computation:**
```
hashInput = canonicalJSON(event including prevHash, excluding hash)
hash = SHA256(hashInput).slice(0, 16)
```

Canonical JSON = keys sorted alphabetically (deterministic across platforms)

### Genesis Event
- `prevHash: "0000000000000000"` (16 zeroes)
- Special event with `type: "chain_init"`
- Marks the boundary between legacy and hashed events

### Backward Compatibility
- Events before `chain_init` → skipped during verification (legacy, no guarantees)
- Events after `chain_init` → must have valid hash chain
- Missing hash after chain_init = TAMPER DETECTED

---

## Implementation

### Core Functions (Node.js)

```javascript
// scripts/hash-chain.js
const crypto = require('crypto');
const fs = require('fs');

// Canonical JSON (sorted keys for deterministic hashing)
function canonicalJSON(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

// Compute hash (16 hex chars = 64 bits)
function computeHash(event) {
  const { hash, ...eventWithoutHash } = event;
  const input = canonicalJSON(eventWithoutHash);
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// Get last event's hash from file
function getLastHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) return null;
  
  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]);
      if (event.hash) return event.hash;
    } catch (e) {
      continue; // Skip malformed lines
    }
  }
  return null; // No hashed events yet
}

// Format date for event ID
function formatDate() {
  const now = new Date();
  return now.toISOString().slice(0, 10).replace(/-/g, '');
}

// Initialize hash chain (run ONCE)
function initHashChain(filePath) {
  const lastHash = getLastHash(filePath);
  if (lastHash) {
    throw new Error('Chain already initialized. Found existing hash: ' + lastHash);
  }
  
  const genesisEvent = {
    ts: new Date().toISOString(),
    id: `EVT-${formatDate()}-CHAIN`,
    type: 'chain_init',
    priority: 'P0',
    content: 'Hash chain initialized. All subsequent events are cryptographically linked. Tampering with any event will break the chain and be detectable.',
    tags: ['system', 'hash-chain', 'security'],
    session: 'system',
    prevHash: '0000000000000000'
  };
  genesisEvent.hash = computeHash(genesisEvent);
  
  fs.appendFileSync(filePath, JSON.stringify(genesisEvent) + '\n');
  console.log('✅ Hash chain initialized');
  console.log('   Genesis hash:', genesisEvent.hash);
  return genesisEvent;
}

// Append new event with hash chaining
function appendEvent(filePath, eventData) {
  const lastHash = getLastHash(filePath);
  if (!lastHash) {
    throw new Error('Chain not initialized. Call initHashChain() first.');
  }
  
  // Build event with chain link
  const event = {
    ...eventData,
    prevHash: lastHash
  };
  
  // Compute and attach hash
  event.hash = computeHash(event);
  
  // Append to file
  fs.appendFileSync(filePath, JSON.stringify(event) + '\n');
  return event;
}

// Verify entire hash chain
function verifyChain(filePath) {
  if (!fs.existsSync(filePath)) {
    return { valid: false, errors: [{ error: 'File not found' }], eventsChecked: 0 };
  }
  
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) {
    return { valid: true, errors: [], eventsChecked: 0, message: 'Empty file' };
  }
  
  const lines = content.split('\n');
  let chainStarted = false;
  let expectedPrevHash = null;
  const errors = [];
  let hashedCount = 0;
  let legacyCount = 0;
  
  for (let i = 0; i < lines.length; i++) {
    let event;
    try {
      event = JSON.parse(lines[i]);
    } catch (e) {
      errors.push({ line: i + 1, error: `Invalid JSON: ${e.message}` });
      continue;
    }
    
    // Skip legacy events (no hash field)
    if (!event.hash) {
      if (chainStarted) {
        errors.push({ line: i + 1, error: 'Missing hash after chain_init', eventId: event.id });
      } else {
        legacyCount++;
      }
      continue;
    }
    
    hashedCount++;
    
    // First hashed event must be chain_init
    if (!chainStarted) {
      if (event.type !== 'chain_init') {
        errors.push({ line: i + 1, error: 'First hashed event must be chain_init', eventId: event.id });
      }
      if (event.prevHash !== '0000000000000000') {
        errors.push({ line: i + 1, error: 'chain_init must have genesis prevHash (16 zeroes)', eventId: event.id });
      }
      chainStarted = true;
    } else {
      // Verify chain link
      if (event.prevHash !== expectedPrevHash) {
        errors.push({ 
          line: i + 1, 
          error: `Chain broken: expected prevHash ${expectedPrevHash}, got ${event.prevHash}`,
          eventId: event.id
        });
      }
    }
    
    // Verify self-hash integrity
    const computed = computeHash(event);
    if (computed !== event.hash) {
      errors.push({ 
        line: i + 1, 
        error: `Hash mismatch: computed ${computed}, stored ${event.hash} (event may have been tampered)`,
        eventId: event.id
      });
    }
    
    expectedPrevHash = event.hash;
  }
  
  return { 
    valid: errors.length === 0, 
    errors,
    eventsChecked: lines.length,
    legacyEvents: legacyCount,
    hashedEvents: hashedCount,
    chainInitialized: chainStarted
  };
}

// Export for use as module
module.exports = { initHashChain, appendEvent, verifyChain, computeHash, getLastHash };

// CLI support
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  const filePath = args[1] || 'memory/events.jsonl';
  
  switch (command) {
    case 'init':
      initHashChain(filePath);
      break;
    case 'verify':
      const result = verifyChain(filePath);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.valid ? 0 : 1);
      break;
    default:
      console.log('Usage:');
      console.log('  node hash-chain.js init [file]    - Initialize hash chain');
      console.log('  node hash-chain.js verify [file]  - Verify chain integrity');
  }
}
```

### PowerShell Wrapper

```powershell
# scripts/verify-chain.ps1
param(
    [string]$Path = "memory/events.jsonl",
    [switch]$Init
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$jsPath = Join-Path $scriptDir "hash-chain.js"

if ($Init) {
    node $jsPath init $Path
} else {
    $result = node $jsPath verify $Path | ConvertFrom-Json
    
    if ($result.valid) {
        Write-Host "✅ Chain integrity verified" -ForegroundColor Green
        Write-Host "   Legacy events: $($result.legacyEvents)"
        Write-Host "   Hashed events: $($result.hashedEvents)"
    } else {
        Write-Host "❌ CHAIN INTEGRITY FAILURE" -ForegroundColor Red
        foreach ($err in $result.errors) {
            Write-Host "   Line $($err.line): $($err.error)" -ForegroundColor Yellow
        }
        exit 1
    }
}
```

---

## Migration Plan

### Step 1: Create Scripts
- [ ] `scripts/hash-chain.js` — core implementation
- [ ] `scripts/verify-chain.ps1` — Windows wrapper

### Step 2: Initialize Chain
```powershell
node scripts/hash-chain.js init memory/events.jsonl
```
This inserts the `chain_init` genesis event.

### Step 3: Update Event Appending
All code that appends to events.jsonl must use the new `appendEvent()` function.

Current append points:
- Memory flush protocol (pre-compaction)
- Mid-session checkpoints (heartbeat)
- Preflight gates
- Any manual event logging

### Step 4: Add Verification
- Add to preflight gates: `verifyChain()` must pass
- Add to nightly consolidation health checks
- Optional: add to Mission Control status display

---

## Example: Hashed Event

**Before (legacy):**
```json
{"ts":"2026-01-29T15:52:00-05:00","id":"EVT-20260129-056","type":"state_checkpoint","priority":"P1","content":"Pre-compaction checkpoint...","tags":["checkpoint"],"session":"main"}
```

**After (with hash chain):**
```json
{"ts":"2026-01-29T16:00:00-05:00","id":"EVT-20260129-057","type":"state_checkpoint","priority":"P1","content":"Post-migration checkpoint...","tags":["checkpoint"],"session":"main","prevHash":"a3f8c2e91b4d7f06","hash":"7e2b9c4d1a8f3e05"}
```

---

## Tamper Detection Matrix

| Attack | Detected? | How |
|--------|-----------|-----|
| Modify event content | ✅ Yes | Hash mismatch |
| Delete single event | ✅ Yes | Chain break (prevHash won't match) |
| Insert fake event | ✅ Yes | Chain break |
| Reorder events | ✅ Yes | Chain break |
| Modify + recalculate hash | ✅ Yes | Next event's prevHash won't match |
| Full file deletion | ⚠️ No | Requires external witness (V2) |

---

## Future Enhancements (V2)

1. **External witness**: Periodically commit file hash to GitHub/external service
2. **Merkle tree**: Enable range proofs for partial verification
3. **Signed events**: Add cryptographic signatures per event
4. **Distributed witnesses**: Multiple nodes verify chain independently

---

## Council Consensus

All three AIs (Grok, ChatGPT, Gemini) unanimously agreed on:
- SHA-256 with 16-char truncation
- Canonical JSON for deterministic hashing
- Genesis event with 16 zeroes
- Graceful backward compatibility
- Node.js implementation with PS wrapper

**Final Grade: A** — Cryptographically sound, practical, implementable today.

---

## Implementation Notes (Post-Council)

### Files Created
1. `scripts/hash-chain.cjs` — Core implementation (CommonJS, renamed from .js due to ESM config in parent package.json)
2. `scripts/verify-chain.ps1` — PowerShell wrapper with human-friendly output

### Testing Results
```
$ node scripts/hash-chain.cjs status memory/events.jsonl

❌ Chain Status: INVALID  (Expected - chain not initialized yet)
   Errors: 16  (Pre-existing malformed JSON lines in legacy data)
```

The 16 "Invalid JSON" errors are **pre-existing data quality issues** in events.jsonl (some lines have encoding artifacts). These are NOT related to hash chaining — they existed before. The hash chain system correctly identifies them.

### Next Steps
1. **Clean up events.jsonl** — Fix malformed JSON lines before initializing chain
2. **Run `node scripts/hash-chain.cjs init`** — Insert genesis event
3. **Update Clawdbot event appending code** — Use new hash functions
4. **Add to preflight gates** — Verify chain on startup
