import type { PostTurnMaintenanceManager } from "../../post-turn-maintenance.js";
import { ensureOpenClawModelsJson } from "../../models-config.js";
import { getGlobalPostTurnMaintenanceManager } from "../../post-turn-maintenance.global.js";
import { compactEmbeddedPiSessionDirect } from "../compact.js";
import { resolveModel } from "../model.js";
import { runEmbeddedAttempt } from "./attempt.js";

export type EmbeddedPiRunDeps = {
  now: () => number;
  ensureModelsJson: typeof ensureOpenClawModelsJson;
  resolveModel: typeof resolveModel;
  compactSession: typeof compactEmbeddedPiSessionDirect;
  runAttempt: typeof runEmbeddedAttempt;
  postTurnMaintenanceManager: PostTurnMaintenanceManager;
};

export function productionEmbeddedPiRunDeps(): EmbeddedPiRunDeps {
  return {
    now: () => Date.now(),
    ensureModelsJson: ensureOpenClawModelsJson,
    resolveModel,
    compactSession: compactEmbeddedPiSessionDirect,
    runAttempt: runEmbeddedAttempt,
    postTurnMaintenanceManager: getGlobalPostTurnMaintenanceManager(),
  };
}
