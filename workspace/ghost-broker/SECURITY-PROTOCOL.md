# Ghost Broker Security Protocol
**Created:** 2026-01-31
**Status:** MANDATORY — Never Skip

## 🚨 INCIDENT: Credentials Exposed (2026-01-31)
`credentials.md` was committed to GitHub with all passwords in plaintext.
**THIS CAN NEVER HAPPEN AGAIN.**

---

## Pre-Commit Checklist (EVERY commit)

Before ANY `git add` or `git commit`:

```
□ Run: git status — review ALL files being added
□ Check for: .env, credentials, secrets, keys, passwords, tokens
□ Verify .gitignore exists and covers sensitive patterns
□ If unsure about a file → DO NOT COMMIT, ask Francisco
```

## Files That Must NEVER Be Committed

| Pattern | Why |
|---------|-----|
| `*.env` | Environment variables with secrets |
| `credentials*` | Login credentials |
| `secrets/` | Any secrets folder |
| `*.key` | Private keys |
| `*.pem` | Certificates |
| `*password*` | Anything with password in name |
| `*token*` | API tokens |
| `*apikey*` | API keys |

## .gitignore Requirements

Every project MUST have `.gitignore` with:
```
.env
.env.*
*.env
credentials*
secrets/
*.secret
*.key
*.pem
*.private
config/local.*
```

## If Credentials Are Ever Exposed

1. **IMMEDIATELY** rotate ALL exposed passwords
2. Revoke ALL exposed API keys/tokens
3. Remove from git history (or accept it's permanent)
4. Notify Francisco
5. Document in this file

## Password Storage Rules

- **NEVER** store passwords in git repos
- Use password manager (1Password, Bitwarden, etc.)
- For bot access: Use environment variables, not files
- Credentials that must be in files → encrypt or exclude from git

## Automated Protection (TODO)

- [ ] Pre-commit hook to scan for secrets
- [ ] Git-secrets or similar tool
- [ ] CI check for credential patterns

---

**Signed:** Bot acknowledges this protocol is MANDATORY.
**Date:** 2026-01-31
