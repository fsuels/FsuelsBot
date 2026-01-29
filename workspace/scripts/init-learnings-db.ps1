# init-learnings-db.ps1
# Creates SQLite learnings.db with Council-approved schema
# Council A+ requirement #4

param(
    [switch]$Force  # Recreate even if exists
)

$ErrorActionPreference = "Stop"
$workspace = "C:\dev\FsuelsBot\workspace"
$dbPath = "$workspace\memory\learnings.db"

# Check if sqlite3 is available
$sqlite = Get-Command sqlite3 -ErrorAction SilentlyContinue
if (-not $sqlite) {
    Write-Host "[ERROR] sqlite3 not found. Install SQLite CLI tools." -ForegroundColor Red
    Write-Host "Download from: https://www.sqlite.org/download.html"
    exit 1
}

# Check if DB exists
if ((Test-Path $dbPath) -and -not $Force) {
    Write-Host "learnings.db already exists at $dbPath" -ForegroundColor Yellow
    Write-Host "Use -Force to recreate"
    exit 0
}

# Remove old DB if Force
if ($Force -and (Test-Path $dbPath)) {
    Remove-Item $dbPath -Force
    Write-Host "Removed existing learnings.db" -ForegroundColor Yellow
}

Write-Host "=== Creating learnings.db ===" -ForegroundColor Cyan

# Schema SQL
$schema = @"
-- learnings.db schema
-- Council-approved MVP design (2026-01-29)
-- 6 kinds: fact, decision, preference, constraint, procedure, insight

CREATE TABLE IF NOT EXISTS learning (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Core content
    statement TEXT NOT NULL,           -- The actual learning
    kind TEXT NOT NULL CHECK (kind IN ('fact', 'decision', 'preference', 'constraint', 'procedure', 'insight')),
    
    -- Deduplication
    canonical_hash TEXT UNIQUE NOT NULL,  -- SHA256 of normalized statement
    
    -- Metadata
    tags TEXT DEFAULT '[]',            -- JSON array of tags
    source TEXT,                       -- Where this came from (session, file, etc.)
    entity TEXT,                       -- Related entity (person, project, tool)
    
    -- Confidence & lifecycle
    confidence REAL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
    is_pinned INTEGER DEFAULT 0,       -- 1 = protected from pruning (P0 learnings)
    is_active INTEGER DEFAULT 1,       -- 0 = soft deleted
    
    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,                   -- NULL = never expires
    last_accessed_at TEXT,             -- For relevance tracking
    
    -- Audit
    created_by TEXT DEFAULT 'system',
    supersedes_id INTEGER REFERENCES learning(id)  -- Points to learning this replaces
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_learning_kind ON learning(kind);
CREATE INDEX IF NOT EXISTS idx_learning_active ON learning(is_active);
CREATE INDEX IF NOT EXISTS idx_learning_pinned ON learning(is_pinned);
CREATE INDEX IF NOT EXISTS idx_learning_confidence ON learning(confidence);
CREATE INDEX IF NOT EXISTS idx_learning_hash ON learning(canonical_hash);
CREATE INDEX IF NOT EXISTS idx_learning_entity ON learning(entity);

-- View for active learnings (what recall pack queries)
CREATE VIEW IF NOT EXISTS active_learnings AS
SELECT * FROM learning 
WHERE is_active = 1 
  AND (expires_at IS NULL OR expires_at > datetime('now'))
ORDER BY is_pinned DESC, confidence DESC, updated_at DESC;

-- View for learnings needing review (low confidence, old)
CREATE VIEW IF NOT EXISTS learnings_to_review AS
SELECT * FROM learning
WHERE is_active = 1
  AND is_pinned = 0
  AND (confidence < 0.5 OR updated_at < datetime('now', '-30 days'))
ORDER BY confidence ASC, updated_at ASC;
"@

# Write schema to temp file and execute
$schemaFile = "$workspace\memory\learnings_schema.sql"
$schema | Out-File -FilePath $schemaFile -Encoding UTF8

# Execute schema
sqlite3 $dbPath ".read `"$schemaFile`""

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ learnings.db created successfully" -ForegroundColor Green
    Write-Host "Location: $dbPath"
    Write-Host ""
    Write-Host "Schema includes:"
    Write-Host "  - learning table (6 kinds)"
    Write-Host "  - canonical_hash for deduplication"
    Write-Host "  - is_pinned for P0 protection"
    Write-Host "  - confidence scoring"
    Write-Host "  - expires_at for auto-cleanup"
    Write-Host "  - active_learnings view"
    Write-Host "  - learnings_to_review view"
    
    # Clean up
    Remove-Item $schemaFile -Force
    exit 0
} else {
    Write-Host "❌ Failed to create learnings.db" -ForegroundColor Red
    exit 1
}
