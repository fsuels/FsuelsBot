# Config Runtime Safety

This note documents the config runtime rules that matter most for agent safety and live-reload correctness.

## Precedence And Merge Semantics

- OpenClaw still uses a single main config file as the source of truth.
- `$include` fragments are resolved first, then sibling keys in the main file override included values.
- Object values deep-merge during include resolution.
- Array values concatenate during include resolution.
- Write paths (`writeConfigFile`, `config.apply`, `config.patch`, CLI mutations) serialize the final config state instead of merge-patching arrays back to disk.

## Trust Boundaries

OpenClaw does not currently implement a full multi-source admin/user/project policy stack. Instead, it hardens the source model it already has: one main config file plus included fragments.

The following safety-sensitive settings are root-only and are ignored when they come from `$include` fragments:

- `env.shellEnv`
- `browser.noSandbox`
- `tools.exec.ask`
- `tools.exec.security`
- `gateway.controlUi.allowInsecureAuth`
- `gateway.controlUi.dangerouslyDisableDeviceAuth`
- `gateway.nodes.allowCommands`
- `skills.invoke.trusted`

This prevents shared or checked-in config fragments from silently weakening consent, sandboxing, remote command, or trust posture on behalf of the local user.

## Validation Errors

Runtime validation is driven from the Zod config schema and plugin JSON Schemas. Validation issues may include:

- `file`
- `path`
- `message`
- `expected`
- `invalidValue`
- `suggestion`
- `docLink`

The extra fields are intended to help agents and UI flows repair bad config without guessing.

## Reload And Cache Behavior

- `loadConfig()` caches parsed config briefly, but cached snapshots are cloned before reuse so caller mutations do not leak back into the cache.
- Internal config writes mark the config path so the gateway watcher can suppress its own write echoes.
- The gateway watcher gives `unlink -> add` save patterns a short grace window and treats them as one external change instead of briefly reloading an empty config.

## Migration Behavior

- Legacy config migration still runs before normal gateway startup when legacy keys are detected.
- Root-only include stripping happens before runtime validation, so the final validated config represents the effective safety posture the process will actually use.
