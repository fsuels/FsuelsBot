# Ghost Broker Deploy Script
# Handles submodule + parent repo + verification
# Usage: .\deploy.ps1 -Message "Your commit message"

param(
    [Parameter(Mandatory=$true)]
    [string]$Message
)

$ErrorActionPreference = "Stop"
$websitePath = "C:\dev\FsuelsBot\workspace\ghost-broker\website"
$parentPath = "C:\dev\FsuelsBot"

Write-Host "🚀 Ghost Broker Deploy Script" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan

# Step 1: Commit and push SUBMODULE
Write-Host "`n📦 Step 1: Push submodule (ghost-broker/website)..." -ForegroundColor Yellow
Set-Location $websitePath
git add -A
$hasChanges = git status --porcelain
if ($hasChanges) {
    git commit -m $Message
    Write-Host "   Committed: $Message" -ForegroundColor Green
} else {
    Write-Host "   No new changes to commit" -ForegroundColor Gray
}
git push origin master:main
Write-Host "   ✅ Submodule pushed to origin/main" -ForegroundColor Green

# Step 2: Update PARENT repo to point to new submodule commit
Write-Host "`n📦 Step 2: Update parent repo..." -ForegroundColor Yellow
Set-Location $parentPath
git add workspace/ghost-broker/website
$hasParentChanges = git status --porcelain -- workspace/ghost-broker/website
if ($hasParentChanges) {
    git commit -m "Update ghost-broker submodule: $Message"
    git push origin main
    Write-Host "   ✅ Parent repo updated and pushed" -ForegroundColor Green
} else {
    Write-Host "   Parent already up to date" -ForegroundColor Gray
}

# Step 3: Wait for Cloudflare to rebuild
Write-Host "`n⏳ Step 3: Waiting 60 seconds for Cloudflare rebuild..." -ForegroundColor Yellow
Start-Sleep -Seconds 60

# Step 4: Verify deployment
Write-Host "`n🔍 Step 4: Verifying deployment..." -ForegroundColor Yellow
$response = curl.exe -s "https://ghostbrokerai.xyz"
if ($response -match $Message.Substring(0, [Math]::Min(20, $Message.Length))) {
    Write-Host "   ✅ VERIFIED: Changes are LIVE!" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Could not auto-verify. Check manually: https://ghostbrokerai.xyz" -ForegroundColor Yellow
}

Write-Host "`n✅ Deploy complete!" -ForegroundColor Green
Write-Host "   Live URL: https://ghostbrokerai.xyz" -ForegroundColor Cyan
