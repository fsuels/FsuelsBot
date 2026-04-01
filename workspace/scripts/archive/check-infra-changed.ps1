# check-infra-changed.ps1
# Returns exit code 0 if infrastructure changed since last check, 1 if unchanged
# Used by weekly A+ validation to skip if no changes

param(
    [switch]$Update  # Update the stored hash after checking
)

$HashFile = "C:\dev\FsuelsBot\workspace\memory\infra-hash.txt"
$InfraFiles = @(
    "C:\dev\FsuelsBot\workspace\AGENTS.md",
    "C:\dev\FsuelsBot\workspace\SOUL.md",
    "C:\dev\FsuelsBot\workspace\scripts\*.ps1",
    "C:\dev\FsuelsBot\workspace\scripts\*.py",
    "C:\dev\FsuelsBot\workspace\scripts\*.cjs",
    "C:\dev\FsuelsBot\workspace\procedures\*.md",
    "C:\dev\FsuelsBot\workspace\memory\lock_manager.py"
)

# Calculate current hash of all infrastructure files
$AllContent = ""
foreach ($Pattern in $InfraFiles) {
    $Files = Get-ChildItem -Path $Pattern -ErrorAction SilentlyContinue
    foreach ($File in $Files) {
        $AllContent += (Get-FileHash $File.FullName -Algorithm SHA256).Hash
    }
}

$CurrentHash = [System.BitConverter]::ToString(
    [System.Security.Cryptography.SHA256]::Create().ComputeHash(
        [System.Text.Encoding]::UTF8.GetBytes($AllContent)
    )
).Replace("-", "").Substring(0, 16)

# Check against stored hash
$Changed = $true
if (Test-Path $HashFile) {
    $StoredHash = Get-Content $HashFile -Raw
    if ($StoredHash.Trim() -eq $CurrentHash) {
        $Changed = $false
    }
}

# Update hash if requested
if ($Update) {
    $CurrentHash | Out-File -FilePath $HashFile -NoNewline
    Write-Host "Hash updated: $CurrentHash"
}

# Output result
if ($Changed) {
    Write-Host "CHANGED - Infrastructure files modified since last check"
    exit 0
} else {
    Write-Host "UNCHANGED - No infrastructure changes detected"
    exit 1
}
