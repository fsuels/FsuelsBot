# Ghost Broker Deploy Procedure

## ⚠️ MANDATORY — Read Before ANY Code Change

Ghost Broker website is a **Git submodule**. This means:
- Changes in `ghost-broker/website/` are tracked in a SEPARATE repo
- The parent repo (`FsuelsBot`) only stores a POINTER to a specific commit
- **Both repos must be pushed** for changes to go live

## The Problem (Why This Exists)

On 2026-02-01, I forgot to push the submodule after adding Tawk.to. Result:
- Code was in local files ✓
- Code was committed locally ✓
- Code was NOT on live site ✗
- Francisco discovered the bug
- I wasted time debugging

**Never again.**

## The Solution: Use the Deploy Script

```powershell
cd C:\dev\FsuelsBot\workspace\ghost-broker\scripts
.\deploy.ps1 -Message "Your commit message here"
```

The script handles:
1. ✅ Commit and push submodule to origin/main
2. ✅ Update parent repo pointer
3. ✅ Push parent repo
4. ✅ Wait for Cloudflare rebuild
5. ✅ Verify changes are live

## Manual Steps (If Script Fails)

```powershell
# 1. Push submodule
cd C:\dev\FsuelsBot\workspace\ghost-broker\website
git add -A
git commit -m "Your message"
git push origin master:main

# 2. Update parent
cd C:\dev\FsuelsBot
git add workspace/ghost-broker/website
git commit -m "Update ghost-broker submodule"
git push origin main

# 3. Verify (wait 60 seconds first)
curl.exe -s "https://ghostbrokerai.xyz" | Select-String "your-change"
```

## Verification Gate

**A deploy is NOT complete until:**
- [ ] `curl ghostbrokerai.xyz` returns the new content
- [ ] Task card updated with `completed_at` timestamp
- [ ] If verification fails after 2 minutes, alert Francisco

## Common Mistakes

| Mistake | Consequence | Prevention |
|---------|-------------|------------|
| Push submodule only | Changes not live | Use deploy script |
| Push parent only | Old submodule pointer | Use deploy script |
| Don't verify | Think it's live when it's not | Always curl after deploy |
| Forget to update task | Next session thinks it's not done | Update task IMMEDIATELY |
