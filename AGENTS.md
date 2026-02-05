# REPO GUIDELINES — moltbot/moltbot
Scope: Rules for working in this repository (build/test/docs/PRs/releases).  
Non-scope: Personal workspace/agent autonomy rules (those belong in your local workspace AGENTS.md).

## HARD RULES (read first)
1. **No fake newlines in GH text**: Issues/PR comments must use literal newlines or a heredoc (`-F - <<'EOF'`). Never embed `\\n`.
2. **Docs must be generic**: No real hostnames, device names, local paths, tokens, phone numbers. Use placeholders (e.g., `user@gateway-host`).
3. **Plugins deps live in the plugin**: Extension-only deps go in `extensions/<name>/package.json`. Don’t add to root unless core uses them.
4. **Plugin install is prod-only**: `npm install --omit=dev` runs inside plugin dirs. Runtime deps must be in `dependencies`.
5. **Avoid `workspace:*` in plugin dependencies**: It breaks `npm install`. Put `moltbot` in `devDependencies` or `peerDependencies`.
6. **Do not patch deps by default**: Any `pnpm.patchedDependencies` must be exact versions; adding/altering patches/overrides requires explicit approval.
7. **Multi-agent safety**: Do not switch branches, do not autostash, do not modify worktrees unless explicitly requested.

---

## Repo Layout
- Source: `src/`
  - CLI wiring: `src/cli`
  - Commands: `src/commands`
  - Web provider: `src/provider-web.ts`
  - Infra: `src/infra`
  - Media: `src/media`
- Tests: colocated `*.test.ts` (`*.e2e.test.ts` for e2e)
- Docs: `docs/` (Mintlify) — built output: `dist/`
- Extensions: `extensions/*` (workspace packages)

When refactoring shared logic, include **core + extensions**:
- Core channel docs: `docs/channels/`
- Core channel code: `src/telegram`, `src/discord`, `src/slack`, `src/signal`, `src/imessage`, `src/web`, `src/channels`, `src/routing`
- Extensions: `extensions/*` (e.g. `msteams`, `matrix`, `zalo`, `zalouser`, `voice-call`)
- If adding channels/extensions/apps/docs, check `.github/labeler.yml`.

---

## Docs (Mintlify)
- Internal links in `docs/**/*.md`: root-relative, **no** `.md`/`.mdx`
  - Example: `[Config](/configuration)`
- Section refs: root-relative + anchor
  - Example: `[Hooks](/configuration#hooks)`
- Avoid em dashes/apostrophes in headings (Mintlify anchor breakage).
- When asked for links, provide absolute `https://docs.molt.bot/...` URLs.
- If you touched docs, end your reply with the full `https://docs.molt.bot/...` URLs you referenced.
- GitHub README should keep absolute docs URLs too.

---

## Build / Test / Dev (local)
Baseline: **Node 22+** (keep Node + Bun paths working).

Common commands:
- Install: `pnpm install`
- Pre-commit: `prek install` (same checks as CI)
- Build/typecheck: `pnpm build`
- Lint/format: `pnpm lint` (oxlint), `pnpm format` (oxfmt)
- Test: `pnpm test` (vitest)
- Coverage: `pnpm test:coverage`

Also supported:
- `bun install` (keep `pnpm-lock.yaml` + Bun patching consistent)
- Prefer Bun for TS execution: `bun <file.ts>`, `bunx <tool>`

Live tests (real keys):
- `CLAWDBOT_LIVE_TEST=1 pnpm test:live` (Moltbot-only)
- `LIVE=1 pnpm test:live` (includes provider live tests)
- Docker: `pnpm test:docker:live-models`, `pnpm test:docker:live-gateway`
- Onboarding Docker E2E: `pnpm test:docker:onboard`
- Full guidance: `docs/testing.md`

Test constraints:
- Coverage thresholds: 70% (lines/branches/functions/statements)
- Do not set test workers above 16

---

## Coding Style
- TypeScript (ESM), prefer strict typing; avoid `any`.
- Run `pnpm lint` before committing.
- Keep files concise; extract helpers instead of creating “V2” copies.
- Use existing DI pattern (`createDefaultDeps`) and CLI option patterns.
- UI/TTY:
  - Progress: `src/cli/progress.ts` (osc-progress + @clack/prompts)
  - Tables: `src/terminal/table.ts` (ANSI-safe wrapping)
  - Palette: `src/terminal/palette.ts` (no hardcoded colors)

---

## Releases (naming + safety)
Channels:
- stable: tagged releases `vYYYY.M.D`, npm dist-tag `latest`
- beta: `vYYYY.M.D-beta.N`, npm dist-tag `beta`
- dev: moving head on `main`

Before release work:
- Read: `docs/reference/RELEASING.md` and `docs/platforms/mac/release.md`
- Do not change versions or run publish/release steps without explicit operator consent.

Version locations (non-exhaustive):
- `package.json` (CLI)
- Android: `apps/android/app/build.gradle.kts`
- iOS: `apps/ios/Sources/Info.plist` + `apps/ios/Tests/Info.plist`
- macOS: `apps/macos/.../Info.plist`
- Docs pin: `docs/install/updating.md`
- mac release examples: `docs/platforms/mac/release.md`

---

## PR Workflow (Review vs Landing)
### Review mode (PR link only)
- Use: `gh pr view`, `gh pr diff`
- **Do not** switch branches
- **Do not** modify code

### Landing mode (we are merging)
Default strategy:
- Prefer **rebase** when history is clean.
- Prefer **squash** when history is messy.
- Merge allowed if conflicts/complexity make it safer.

Process:
1. `git pull` (stop if local changes/unpushed commits exist; alert operator)
2. Create integration branch from `main`
3. Bring in PR commits (rebase/squash/merge as chosen)
4. Apply fixes, add changelog entry (include PR # + thanks)
5. Run gate locally: `pnpm lint && pnpm build && pnpm test`
6. Commit, merge back to `main`, delete integration branch
7. Leave PR comment explaining what changed and include SHAs
8. If new contributor: add avatar to README clawtributors list; run `bun scripts/update-clawtributors.ts` if needed

Commit helper:
- Use `scripts/committer "<msg>" <file...>` for scoped staging (avoid manual broad staging unless asked).

---

## VM Ops (exe.dev) — if applicable
- Access: `ssh exe.dev` then `ssh vm-name`
- Update: `sudo npm i -g moltbot@latest`
- Ensure: `gateway.mode=local`
- Restart:
  `pkill -9 -f moltbot-gateway || true; nohup moltbot gateway run --bind loopback --port 18789 --force > /tmp/moltbot-gateway.log 2>&1 &`
- Verify:
  - `moltbot channels status --probe`
  - `ss -ltnp | rg 18789`
  - `tail -n 120 /tmp/moltbot-gateway.log`

---

## Security / Privacy
- Web provider creds: `~/.clawdbot/credentials/`
- Never commit/publish real secrets, phone numbers, videos, or live config values.
- Troubleshooting: `moltbot doctor` (see `docs/gateway/doctor.md`)

---

## Agent-specific notes (only if you are an agent runner)
- “makeup” = “mac app”
- Never edit `node_modules`
- Do not update Carbon dependency
- Do not rebuild macOS app over SSH; rebuild locally on Mac
- Do not create/apply/drop `git stash` unless explicitly requested
- Do not create/modify `git worktree` unless explicitly requested
- If asked to open a session file: use `~/.clawdbot/agents/<agentId>/sessions/*.jsonl` (newest unless specified)
- For “push”: you may `git pull --rebase` first (never discard others’ work)
- For “commit”: scope to your changes; “commit all” means grouped, sensible chunks

---

## NPM publish via 1Password (publish/verify)
Run `op` in a fresh tmux session.
- Sign in: `eval "$(op signin --account my.1password.com)"`
- OTP: `op read 'op://Private/Npmjs/one-time password?attribute=otp'`
- Publish: `npm publish --access public --otp="<otp>"`
- Verify (no npmrc side effects):
  `npm view <pkg> version --userconfig "$(mktemp)"`
Kill tmux session after publish.
