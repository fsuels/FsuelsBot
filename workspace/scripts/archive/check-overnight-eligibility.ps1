# check-overnight-eligibility.ps1
# Validates if a task is eligible for overnight autonomous execution
# Council A+ requirement #3

param(
    [Parameter(Mandatory=$true)]
    [string]$TaskCategory,
    
    [string]$TaskDescription = "",
    
    [string[]]$PathsTouched = @(),
    
    [switch]$ShowDetails
)

$ErrorActionPreference = "Stop"
$workspace = "C:\dev\FsuelsBot\workspace"
$configPath = "$workspace\config\overnight-eligibility.yaml"

# Simple YAML parser (for our specific format)
function Get-YamlValue {
    param($Content, $Key)
    $pattern = "^\s*$Key\s*:\s*(.+)$"
    $match = $Content | Select-String -Pattern $pattern
    if ($match) {
        return $match.Matches[0].Groups[1].Value.Trim().Trim('"')
    }
    return $null
}

# Load config
if (-not (Test-Path $configPath)) {
    Write-Host "[ERROR] Eligibility config not found: $configPath" -ForegroundColor Red
    exit 1
}

$configContent = Get-Content $configPath -Raw

# Check forbidden categories
$forbiddenCategories = @("financial", "publishing", "deletions", "external_comms", "database", "credentials")
if ($TaskCategory -in $forbiddenCategories) {
    Write-Host "=== Overnight Eligibility Check ===" -ForegroundColor Red
    Write-Host "RESULT: FORBIDDEN" -ForegroundColor Red
    Write-Host "Category '$TaskCategory' is NEVER allowed for overnight work"
    Write-Host ""
    Write-Host "Reason: This category requires human approval"
    exit 1
}

# Check forbidden paths
$forbiddenPaths = @("migrations/", "auth/", ".env", "secrets/", "keys/", "billing", "pricing")
foreach ($path in $PathsTouched) {
    foreach ($forbidden in $forbiddenPaths) {
        if ($path -like "*$forbidden*") {
            Write-Host "=== Overnight Eligibility Check ===" -ForegroundColor Red
            Write-Host "RESULT: FORBIDDEN" -ForegroundColor Red
            Write-Host "Path '$path' matches forbidden pattern '$forbidden'"
            exit 1
        }
    }
}

# Check allowed categories
$allowedCategories = @("seo", "research", "memory", "drafts", "git")
if ($TaskCategory -in $allowedCategories) {
    Write-Host "=== Overnight Eligibility Check ===" -ForegroundColor Green
    Write-Host "RESULT: ALLOWED" -ForegroundColor Green
    Write-Host "Category: $TaskCategory"
    if ($TaskDescription) {
        Write-Host "Task: $TaskDescription"
    }
    Write-Host ""
    Write-Host "Conditions:"
    switch ($TaskCategory) {
        "seo" { 
            Write-Host "  - No pricing changes"
            Write-Host "  - No product deletions"
            Write-Host "  - Draft only, never publish"
        }
        "research" {
            Write-Host "  - Read-only operations"
            Write-Host "  - No external communications"
        }
        "memory" {
            Write-Host "  - Internal files only"
            Write-Host "  - No deletions"
        }
        "drafts" {
            Write-Host "  - Never publish"
            Write-Host "  - Francisco reviews in morning"
        }
        "git" {
            Write-Host "  - Commit to main only"
            Write-Host "  - No force push"
        }
    }
    exit 0
}

# Conditional categories
$conditionalCategories = @("shopify_edits", "bulk_operations")
if ($TaskCategory -in $conditionalCategories) {
    Write-Host "=== Overnight Eligibility Check ===" -ForegroundColor Yellow
    Write-Host "RESULT: CONDITIONAL" -ForegroundColor Yellow
    Write-Host "Category '$TaskCategory' requires extra verification"
    Write-Host ""
    Write-Host "Manual check required before proceeding"
    exit 2
}

# Unknown category
Write-Host "=== Overnight Eligibility Check ===" -ForegroundColor Yellow
Write-Host "RESULT: UNKNOWN" -ForegroundColor Yellow
Write-Host "Category '$TaskCategory' not in eligibility config"
Write-Host "Defaulting to FORBIDDEN for safety"
exit 1
