<#
.SYNOPSIS
    Add missing 'updated' dates to knowledge files
.DESCRIPTION
    Scans knowledge/ for .md files without 'updated:' frontmatter and adds it
    based on file's LastWriteTime
#>

param([switch]$DryRun)

$WORKSPACE = "C:\dev\FsuelsBot\workspace"
$fixed = 0

Get-ChildItem -Path "$WORKSPACE\knowledge" -Recurse -Filter "*.md" | ForEach-Object {
    $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $content) { return }
    
    # Check if has frontmatter with updated
    if ($content -match "^---" -and $content -notmatch "updated:\s*\d{4}-\d{2}-\d{2}") {
        $date = $_.LastWriteTime.ToString("yyyy-MM-dd")
        $name = $_.FullName.Replace("$WORKSPACE\knowledge\", "")
        
        if ($DryRun) {
            Write-Output "Would add: updated: $date to $name"
        } else {
            # Add updated after first ---
            $newContent = $content -replace "^---\r?\n", "---`nupdated: $date`n"
            Set-Content $_.FullName -Value $newContent -Encoding UTF8
            Write-Output "Added: updated: $date to $name"
        }
        $script:fixed++
    } elseif ($content -notmatch "^---") {
        # No frontmatter at all - add it
        $date = $_.LastWriteTime.ToString("yyyy-MM-dd")
        $name = $_.FullName.Replace("$WORKSPACE\knowledge\", "")
        
        if ($DryRun) {
            Write-Output "Would add frontmatter to $name"
        } else {
            $newContent = "---`nupdated: $date`n---`n`n$content"
            Set-Content $_.FullName -Value $newContent -Encoding UTF8
            Write-Output "Added frontmatter to $name"
        }
        $script:fixed++
    }
}

Write-Output "`nTotal: $fixed files"
