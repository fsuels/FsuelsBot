import type { Snapshot } from "../protocol/index.js";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { getHealthSnapshot, type HealthSummary } from "../../commands/health.js";
import { loadBootstrapConfig } from "../../config/bootstrap.js";
import { CONFIG_PATH, STATE_DIR } from "../../config/paths.js";
import { resolveMainSessionKey } from "../../config/sessions.js";
import { createSingleflightCache } from "../../infra/singleflight.js";
import { listSystemPresence } from "../../infra/system-presence.js";
import { normalizeMainKey } from "../../routing/session-key.js";

let presenceVersion = 1;
let healthVersion = 1;
let healthCache: HealthSummary | null = null;
let broadcastHealthUpdate: ((snap: HealthSummary) => void) | null = null;
const healthRefreshGate = createSingleflightCache<string, HealthSummary>({
  classifyError: () => "transient",
});

export function buildGatewaySnapshot(): Snapshot {
  const cfg = loadBootstrapConfig();
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const mainKey = normalizeMainKey(cfg.session?.mainKey);
  const mainSessionKey = resolveMainSessionKey(cfg);
  const scope = cfg.session?.scope ?? "per-sender";
  const presence = listSystemPresence();
  const uptimeMs = Math.round(process.uptime() * 1000);
  // Health is async; caller should await getHealthSnapshot and replace later if needed.
  const emptyHealth: unknown = {};
  return {
    presence,
    health: emptyHealth,
    stateVersion: { presence: presenceVersion, health: healthVersion },
    uptimeMs,
    // Surface resolved paths so UIs can display the true config location.
    configPath: CONFIG_PATH,
    stateDir: STATE_DIR,
    sessionDefaults: {
      defaultAgentId,
      mainKey,
      mainSessionKey,
      scope,
    },
  };
}

export function getHealthCache(): HealthSummary | null {
  return healthCache;
}

export function getHealthVersion(): number {
  return healthVersion;
}

export function incrementPresenceVersion(): number {
  presenceVersion += 1;
  return presenceVersion;
}

export function getPresenceVersion(): number {
  return presenceVersion;
}

export function setBroadcastHealthUpdate(fn: ((snap: HealthSummary) => void) | null) {
  broadcastHealthUpdate = fn;
}

export async function refreshGatewayHealthSnapshot(opts?: { probe?: boolean }) {
  return await healthRefreshGate.run(
    "gateway-health-refresh",
    async () => {
      const snap = await getHealthSnapshot({ probe: opts?.probe });
      healthCache = snap;
      healthVersion += 1;
      if (broadcastHealthUpdate) {
        broadcastHealthUpdate(snap);
      }
      return snap;
    },
    { cacheSuccessMs: 0 },
  );
}
