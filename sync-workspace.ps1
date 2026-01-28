# sync-workspace.ps1 — Sync workspace files to FsuelsBot repo and push
# Run daily via cron or manually

$repo = "C:\dev\FsuelsBot"

# No robocopy needed — workspace already lives inside the repo at C:\dev\FsuelsBot\workspace

# Commit and push
Set-Location $repo
git add workspace/
$date = Get-Date -Format "yyyy-MM-dd HH:mm"
$status = git status --porcelain workspace/
if ($status) {
    git commit -m "Auto-sync workspace: $date"
    git push origin main
    Write-Output "Synced and pushed at $date"
} else {
    Write-Output "No changes to sync at $date"
}
