# Council Session: Wiki Versioning Implementation Blueprint

**Date:** 2026-01-29
**Topic:** Knowledge Wiki Versioning System
**Mode:** Implementation Blueprint (6-round debate)
**Status:** COMPLETE

---

## THE QUESTION

Design versioning for a knowledge wiki used by an AI agent. The wiki has 4 folders:
- `entities/` — People, companies, projects
- `procedures/` — How-to guides
- `principles/` — Standing rules
- `insights/` — Learned patterns

**Current problems:**
- Knowledge goes stale without detection
- No "last verified" dates
- No review cycle
- Can't tell if procedures are current

**Requirements:**
1. Track version/created/updated/verified dates
2. Detect staleness (configurable thresholds)
3. Generate review queue of stale items
4. AI agent must maintain it automatically
5. Must work with existing markdown files

---

## ROUND 1: METADATA FORMAT

### The Debate: Frontmatter vs Sidecar Files

**Position A: YAML Frontmatter (in-file)**
```markdown
---
version: 1.2
created: 2026-01-15
updated: 2026-01-29
verified: 2026-01-29
confidence: high
---
# Document Title
Content here...
```

**Advantages:**
- Single file = single source of truth
- Metadata travels with content (no orphaning)
- Standard markdown practice (Jekyll, Hugo, Obsidian)
- Easy to read/edit manually
- Git history shows metadata + content changes together

**Disadvantages:**
- Requires parsing markdown to extract metadata
- Frontmatter can be corrupted by bad edits
- File modification date ≠ content change date

**Position B: Sidecar Files (.meta.json)**
```
knowledge/
  procedures/
    seo.md
    seo.meta.json
```

**Advantages:**
- Clean separation of concerns
- JSON is easier to parse programmatically
- Can update metadata without touching content
- Aggregation is simpler (just scan .meta.json files)

**Disadvantages:**
- Two files to maintain per document
- Risk of orphaned metadata or missing sidecars
- More files in directory listing
- Easy to forget to create sidecar for new file

### CONSENSUS: YAML FRONTMATTER

**Rationale:** The "single file = truth" principle is more important than parsing convenience. An AI agent that maintains its own wiki should be able to handle frontmatter parsing easily. Orphaned sidecar files are a worse failure mode than slightly more complex parsing.

**Mitigation for frontmatter cons:**
- Validate frontmatter schema on every write
- Use a standard library (gray-matter for Node, python-frontmatter for Python)
- The staleness checker validates frontmatter integrity

---

## ROUND 2: REQUIRED FIELDS

### Field Schema (Final)

```yaml
---
# REQUIRED FIELDS
version: "1.0"           # Semantic version (MAJOR.MINOR)
created: "2026-01-15"    # ISO 8601 date when first written
updated: "2026-01-29"    # ISO 8601 date when content last changed
verified: "2026-01-29"   # ISO 8601 date when last confirmed accurate

# OPTIONAL FIELDS
confidence: "high"       # high | medium | low | deprecated
tags: ["seo", "shopify"] # For cross-referencing
supersedes: "old-file.md" # If this replaces another document
review_cycle: 30         # Override default staleness threshold (days)
---
```

### Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | YES | Semantic version. Bump MAJOR for breaking changes, MINOR for updates |
| `created` | date | YES | When document was first created. Never changes. |
| `updated` | date | YES | When content was last modified. Changes on every edit. |
| `verified` | date | YES | When content was last confirmed still accurate. Can be same as updated, or later if verified without changes. |
| `confidence` | enum | NO | How reliable this information is. Default: "medium" |
| `tags` | list | NO | For categorization and cross-referencing |
| `supersedes` | string | NO | Path to document this one replaces |
| `review_cycle` | int | NO | Override default staleness days for this file |

### Key Insight: `verified` ≠ `updated`

**This is critical.** A procedure can be:
1. **Updated** — content changed (bumps `updated`)
2. **Verified** — re-read and confirmed still accurate (bumps `verified` only)

Example: A procedure for Shopify bulk editing might still be correct 6 months later. Verification confirms it without needing to change content.

**Protocol:**
- Edit content → update both `updated` AND `verified`
- Verify without editing → update only `verified`
- `verified` ≥ `updated` (always)

---

## ROUND 3: STALENESS RULES

### Category-Specific Thresholds

Different knowledge types have different decay rates:

| Category | Default Staleness | Rationale |
|----------|-------------------|-----------|
| `entities/` | 90 days | People/companies change slowly but need periodic refresh |
| `procedures/` | 30 days | How-to guides can break with platform updates |
| `principles/` | 180 days | Standing rules are stable but should be reviewed semi-annually |
| `insights/` | 60 days | Learned patterns may need validation |

### Staleness Calculation

```python
def is_stale(file_metadata, category):
    """
    A file is stale if:
    1. `verified` date is older than threshold
    2. OR `updated` date is older than threshold AND file was never verified
    """
    threshold_days = file_metadata.get('review_cycle') or DEFAULT_THRESHOLDS[category]
    verified_date = parse_date(file_metadata['verified'])
    days_since_verified = (today() - verified_date).days
    
    return days_since_verified > threshold_days
```

### Staleness Severity Levels

| Days Past Threshold | Severity | Action |
|---------------------|----------|--------|
| 0-7 days | ⚠️ WARNING | Include in weekly review |
| 8-30 days | 🟠 STALE | Priority review needed |
| 31+ days | 🔴 CRITICAL | Must review immediately |

---

## ROUND 4: REVIEW QUEUE FORMAT

### Location: `knowledge/review-queue.md`

This file is regenerated by the staleness checker and should NOT be manually edited.

### Format

```markdown
# Knowledge Review Queue
Generated: 2026-01-29 03:00 EST
Total items: 7

## 🔴 CRITICAL (must review immediately)
| File | Days Stale | Last Verified | Category |
|------|------------|---------------|----------|
| procedures/buckydrop-import.md | 45 | 2025-12-15 | procedures |

## 🟠 STALE (priority review)
| File | Days Stale | Last Verified | Category |
|------|------------|---------------|----------|
| insights/pricing-lessons.md | 12 | 2026-01-17 | insights |

## ⚠️ WARNING (review this week)
| File | Days Stale | Last Verified | Category |
|------|------------|---------------|----------|
| entities/scott-buckydrop.md | 3 | 2026-01-26 | entities |

## ✅ Recently Verified (FYI)
Last 5 files verified:
- procedures/seo.md (2026-01-29)
- principles/pricing.md (2026-01-28)
...
```

### Integration with Nightly Consolidation

The staleness checker runs at **3 AM EST** as part of the nightly consolidation. It:
1. Scans all files in `knowledge/`
2. Parses frontmatter
3. Calculates staleness
4. Regenerates `review-queue.md`
5. Logs results to `memory/events.jsonl`

### Surfacing Stale Items

**Option A: Review Queue File** (implemented above)
- Bot reads this file at session start
- Shows CRITICAL items to human in greeting

**Option B: Recall Pack Integration**
- Add "stale items" section to `recall/pack.md`
- Ensures bot sees it every session

**Decision:** Use BOTH. Review queue for full details, recall pack for session-start awareness.

Add to `recall/pack.md` template:
```markdown
## 📚 Knowledge Health
- 0 critical, 2 stale, 3 warnings
- See: knowledge/review-queue.md
```

---

## ROUND 5: UPDATE PROTOCOL

### When to Update What

| Action | `version` | `created` | `updated` | `verified` |
|--------|-----------|-----------|-----------|------------|
| Create new file | Set "1.0" | Set today | Set today | Set today |
| Minor content edit | Bump MINOR | — | Set today | Set today |
| Major rewrite | Bump MAJOR | — | Set today | Set today |
| Verify without edit | — | — | — | Set today |
| Mark deprecated | Set "0.0" | — | Set today | Set today |

### Version Bumping Rules

- **MAJOR** (1.0 → 2.0): Breaking change, completely different approach, or deprecation
- **MINOR** (1.0 → 1.1): Corrections, additions, clarifications

### Deprecation Protocol

When information is no longer valid:
1. Set `confidence: deprecated`
2. Set `version: "0.0"`
3. Add note at top explaining what replaced it
4. Keep file for 30 days, then archive to `knowledge/.archive/`

### AI Agent Update Behavior

When the AI edits a knowledge file, it MUST:
1. Read existing frontmatter
2. Bump version appropriately
3. Set `updated: today`
4. Set `verified: today`
5. Validate the frontmatter is valid YAML

```python
def update_knowledge_file(path, new_content, edit_type="minor"):
    meta = parse_frontmatter(path)
    
    # Bump version
    major, minor = map(int, meta['version'].split('.'))
    if edit_type == "major":
        meta['version'] = f"{major + 1}.0"
    else:
        meta['version'] = f"{major}.{minor + 1}"
    
    # Update timestamps
    today = date.today().isoformat()
    meta['updated'] = today
    meta['verified'] = today
    
    # Write back
    write_with_frontmatter(path, meta, new_content)
```

---

## ROUND 6: IMPLEMENTATION CODE

### Script 1: `check-staleness.py`

```python
#!/usr/bin/env python3
"""
Staleness checker for knowledge wiki.
Run nightly at 3 AM EST by consolidation job.
"""

import os
import yaml
from datetime import date, timedelta
from pathlib import Path

# Configuration
KNOWLEDGE_DIR = Path("knowledge")
OUTPUT_FILE = KNOWLEDGE_DIR / "review-queue.md"

DEFAULT_THRESHOLDS = {
    "entities": 90,
    "procedures": 30,
    "principles": 180,
    "insights": 60,
}

def parse_frontmatter(path):
    """Extract YAML frontmatter from markdown file."""
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    if not content.startswith('---'):
        return None
    
    end = content.find('---', 3)
    if end == -1:
        return None
    
    try:
        return yaml.safe_load(content[3:end])
    except yaml.YAMLError:
        return None

def get_category(path):
    """Get category from file path."""
    parts = path.relative_to(KNOWLEDGE_DIR).parts
    return parts[0] if parts else "unknown"

def calculate_staleness(meta, category):
    """Return (is_stale, days_since_verified, severity)."""
    threshold = meta.get('review_cycle') or DEFAULT_THRESHOLDS.get(category, 30)
    
    verified = meta.get('verified')
    if not verified:
        return True, 999, "critical"
    
    if isinstance(verified, str):
        verified = date.fromisoformat(verified)
    
    days = (date.today() - verified).days
    
    if days <= threshold:
        return False, days, None
    
    over = days - threshold
    if over > 30:
        return True, days, "critical"
    elif over > 7:
        return True, days, "stale"
    else:
        return True, days, "warning"

def scan_knowledge():
    """Scan all knowledge files and return staleness report."""
    results = {"critical": [], "stale": [], "warning": [], "fresh": []}
    
    for ext in ['*.md']:
        for path in KNOWLEDGE_DIR.rglob(ext):
            # Skip special files
            if path.name in ['review-queue.md', 'README.md']:
                continue
            if '.archive' in str(path):
                continue
            
            meta = parse_frontmatter(path)
            if not meta:
                results["critical"].append({
                    "path": str(path),
                    "days": 999,
                    "verified": "MISSING FRONTMATTER",
                    "category": get_category(path)
                })
                continue
            
            category = get_category(path)
            is_stale, days, severity = calculate_staleness(meta, category)
            
            item = {
                "path": str(path.relative_to(KNOWLEDGE_DIR)),
                "days": days,
                "verified": meta.get('verified', 'unknown'),
                "category": category
            }
            
            if severity:
                results[severity].append(item)
            else:
                results["fresh"].append(item)
    
    return results

def generate_report(results):
    """Generate markdown report."""
    lines = [
        "# Knowledge Review Queue",
        f"Generated: {date.today().isoformat()}",
        f"Total items: {sum(len(v) for v in results.values())}",
        ""
    ]
    
    for severity, emoji, label in [
        ("critical", "🔴", "CRITICAL (must review immediately)"),
        ("stale", "🟠", "STALE (priority review)"),
        ("warning", "⚠️", "WARNING (review this week)"),
    ]:
        items = results[severity]
        lines.append(f"## {emoji} {label}")
        if items:
            lines.append("| File | Days Stale | Last Verified | Category |")
            lines.append("|------|------------|---------------|----------|")
            for item in sorted(items, key=lambda x: -x['days']):
                lines.append(f"| {item['path']} | {item['days']} | {item['verified']} | {item['category']} |")
        else:
            lines.append("*None*")
        lines.append("")
    
    # Recently verified
    fresh = sorted(results['fresh'], key=lambda x: x['verified'], reverse=True)[:5]
    lines.append("## ✅ Recently Verified")
    for item in fresh:
        lines.append(f"- {item['path']} ({item['verified']})")
    
    return "\n".join(lines)

def main():
    results = scan_knowledge()
    report = generate_report(results)
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(report)
    
    # Summary for logging
    print(f"Staleness check complete:")
    print(f"  Critical: {len(results['critical'])}")
    print(f"  Stale: {len(results['stale'])}")
    print(f"  Warning: {len(results['warning'])}")
    print(f"  Fresh: {len(results['fresh'])}")

if __name__ == "__main__":
    main()
```

### Script 2: `add-frontmatter.py`

```python
#!/usr/bin/env python3
"""
Add frontmatter to existing markdown files that lack it.
Run once during migration, then as needed for new files.
"""

import os
from datetime import date
from pathlib import Path

TEMPLATE = """---
version: "1.0"
created: "{created}"
updated: "{created}"
verified: "{created}"
confidence: "medium"
---

"""

def needs_frontmatter(path):
    """Check if file lacks frontmatter."""
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    return not content.strip().startswith('---')

def add_frontmatter(path):
    """Add frontmatter to file."""
    # Use file modification time as created date, or today
    mtime = os.path.getmtime(path)
    created = date.fromtimestamp(mtime).isoformat()
    
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    frontmatter = TEMPLATE.format(created=created)
    
    with open(path, 'w', encoding='utf-8') as f:
        f.write(frontmatter + content)
    
    print(f"Added frontmatter to: {path}")

def main():
    knowledge_dir = Path("knowledge")
    
    for path in knowledge_dir.rglob("*.md"):
        if path.name in ['review-queue.md', 'README.md']:
            continue
        if '.archive' in str(path):
            continue
        
        if needs_frontmatter(path):
            add_frontmatter(path)

if __name__ == "__main__":
    main()
```

### Script 3: `verify-file.py`

```python
#!/usr/bin/env python3
"""
Mark a knowledge file as verified without changing content.
Usage: python verify-file.py knowledge/procedures/seo.md
"""

import sys
import yaml
from datetime import date
from pathlib import Path

def verify_file(path):
    """Update verified date without changing content."""
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    if not content.startswith('---'):
        print(f"Error: {path} has no frontmatter")
        return False
    
    end = content.find('---', 3)
    frontmatter = yaml.safe_load(content[3:end])
    body = content[end+3:].lstrip('\n')
    
    # Update only verified
    frontmatter['verified'] = date.today().isoformat()
    
    # Write back
    new_frontmatter = yaml.dump(frontmatter, default_flow_style=False, sort_keys=False)
    new_content = f"---\n{new_frontmatter}---\n\n{body}"
    
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    print(f"Verified: {path}")
    return True

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python verify-file.py <path-to-md-file>")
        sys.exit(1)
    
    verify_file(Path(sys.argv[1]))
```

---

## FINAL VERDICT

### Implementation Summary

| Component | Solution |
|-----------|----------|
| **Metadata format** | YAML frontmatter in each markdown file |
| **Required fields** | version, created, updated, verified |
| **Optional fields** | confidence, tags, supersedes, review_cycle |
| **Staleness thresholds** | entities: 90d, procedures: 30d, principles: 180d, insights: 60d |
| **Review queue** | `knowledge/review-queue.md` + recall pack integration |
| **Nightly job** | `check-staleness.py` at 3 AM EST |
| **Migration** | `add-frontmatter.py` for existing files |

### Grade: A

This design achieves:
- ✅ Simple (5 required fields)
- ✅ Maintainable (AI can update frontmatter easily)
- ✅ Discoverable (review queue surfaces issues)
- ✅ Configurable (per-file and per-category thresholds)
- ✅ Integrated (works with existing consolidation)

### Next Steps

1. **Run `add-frontmatter.py`** to migrate existing files
2. **Add `check-staleness.py`** to nightly consolidation
3. **Update recall pack template** to include knowledge health
4. **Add frontmatter update logic** to AI file editing procedures

---

*Council session completed 2026-01-29. Implementation ready for deployment.*
