# Clawdbot Hooks System

> Deterministic hooks that GUARANTEE actions happen. No hoping, no "should have" — these hooks enforce rules automatically.

## 📍 Location

All hooks live in `.claude/hooks/`. Entry point: `.claude/hooks/index.cjs`

> **Note:** Hooks use `.cjs` extension for CommonJS compatibility (parent repo uses ES modules).

## 🪝 Available Hooks

### 1. pre-commit-lint.js
**Purpose:** Run ESLint/Prettier/Ruff before any git commit  
**Trigger:** Before `git commit`  
**Behavior:** BLOCKS commit if linting errors exist  

**What it checks:**
- JavaScript/TypeScript files → ESLint + Prettier
- Python files → Ruff (or fallback to syntax check)

**Usage:**
```bash
# Manual run
node .claude/hooks/index.cjs pre-commit-lint

# Auto-run on commit (add to .git/hooks/pre-commit)
#!/bin/sh
node .claude/hooks/index.cjs pre-commit-lint
```

**Exit codes:**
- `0` — All checks passed, commit allowed
- `1` — Errors found, commit BLOCKED

---

### 2. post-edit-test.js
**Purpose:** Auto-run relevant tests after editing code files  
**Trigger:** After editing `.py`, `.ts`, `.js`, `.jsx`, `.tsx`  
**Behavior:** Finds and runs the corresponding test file  

**Test file patterns searched:**
- `foo.js` → `foo.test.js`, `foo.spec.js`, `__tests__/foo.test.js`
- `foo.py` → `foo_test.py`, `test_foo.py`, `tests/test_foo.py`

**Usage:**
```bash
node .claude/hooks/index.cjs post-edit-test scripts/my-script.js
```

**Exit codes:**
- `0` — Tests passed (or no test file found)
- `1` — Tests failed

---

### 3. protected-folders.js
**Purpose:** Block writes to protected files and sections  
**Trigger:** Before any file write operation  
**Behavior:** Returns error if write violates protection rules  

**Protected files:**
| File | Rule | Reason |
|------|------|--------|
| `memory/events.jsonl` | append-only | Audit trail — never edit history |
| `.env`, `.env.*` | confirm-required | Contains secrets |
| `*.pem`, `*.key` | blocked | Private keys |
| `secrets.json`, `credentials.*` | blocked | Sensitive data |

**Protected sections (within files):**
| File | Section | Reason |
|------|---------|--------|
| `SOUL.md` | `## 🧭 THE MOTTO` → `## Core Truths` | Core identity — immutable |
| `SOUL.md` | `## Core Truths` → `## Identity` | Fundamental truths |

**Usage:**
```bash
# Check if write is allowed
node .claude/hooks/index.cjs protected-folders write memory/state.json
node .claude/hooks/index.cjs protected-folders append memory/events.jsonl
node .claude/hooks/index.cjs protected-folders edit SOUL.md "$NEW_CONTENT"
```

**Actions:** `write`, `edit`, `delete`, `append`

**Exit codes:**
- `0` — Write allowed
- `1` — Write BLOCKED

---

### 4. context-checkpoint.js
**Purpose:** Auto-save state.json before context compaction  
**Trigger:** Before context window truncation  
**Behavior:** Creates timestamped checkpoint in `memory/checkpoints/`  

**What it does:**
1. Reads current `memory/state.json`
2. Saves to `memory/checkpoints/state-{timestamp}-{reason}.json`
3. Appends event to `memory/events.jsonl`
4. Cleans old checkpoints (keeps last 10)

**Usage:**
```bash
# Manual checkpoint
node .claude/hooks/index.cjs context-checkpoint manual

# Before compaction
node .claude/hooks/index.cjs context-checkpoint compaction

# Crash recovery
node .claude/hooks/index.cjs context-checkpoint crash-recovery
```

**Checkpoint format:**
```json
{
  "version": 151,
  "current_task": {...},
  "_checkpoint": {
    "created_at": "2026-02-01T10:30:00.000Z",
    "reason": "compaction",
    "original_version": 151
  }
}
```

---

## 🔧 Integration

### Git Pre-commit Hook

Create `.git/hooks/pre-commit`:
```bash
#!/bin/sh
node .claude/hooks/index.cjs pre-commit-lint
exit $?
```

Make executable (Unix):
```bash
chmod +x .git/hooks/pre-commit
```

### Agent Integration

The main agent should call hooks at these points:

1. **Before git commit:**
   ```javascript
   // Run pre-commit-lint, abort if fails
   exec('node .claude/hooks/index.cjs pre-commit-lint')
   ```

2. **After editing code files:**
   ```javascript
   // Run tests for edited file
   exec(`node .claude/hooks/index.cjs post-edit-test ${editedFile}`)
   ```

3. **Before file writes:**
   ```javascript
   // Check protection rules
   exec(`node .claude/hooks/index.cjs protected-folders ${action} ${filePath}`)
   ```

4. **Before context compaction:**
   ```javascript
   // Save checkpoint
   exec('node .claude/hooks/index.cjs context-checkpoint compaction')
   ```

---

## 📊 Verification

Test each hook works:

```bash
# Test pre-commit (should pass if no staged files)
node .claude/hooks/index.cjs pre-commit-lint

# Test post-edit (should report no test found for this file)
node .claude/hooks/index.cjs post-edit-test procedures/hooks.md

# Test protected-folders (should block)
node .claude/hooks/index.cjs protected-folders edit memory/events.jsonl
# Expected: 🚫 BLOCKED

# Test checkpoint (creates checkpoint)
node .claude/hooks/index.cjs context-checkpoint test
# Check: memory/checkpoints/ has new file
```

---

## 🛡️ Guarantees

These hooks provide **deterministic guarantees**:

| Hook | Guarantee |
|------|-----------|
| pre-commit-lint | No commit with lint errors reaches the repo |
| post-edit-test | Tests run after every code edit (if tests exist) |
| protected-folders | events.jsonl CANNOT be edited, only appended |
| context-checkpoint | State is ALWAYS saved before compaction |

**The system is designed to fail loudly.** If a hook fails, the action is blocked. No silent failures.

---

## 🔄 Maintenance

- **Adding new protected files:** Edit `PROTECTED_FILES` in `protected-folders.js`
- **Adding new protected sections:** Edit `PROTECTED_SECTIONS` in `protected-folders.js`
- **Changing checkpoint retention:** Edit `MAX_CHECKPOINTS` in `context-checkpoint.js`
- **Adding new linters:** Extend the tool checks in `pre-commit-lint.js`

---

*Last updated: 2026-02-01*
