import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { GatewayRequestHandlers } from "./types.js";
import { resolveAgentWorkspaceDir } from "../../agents/workspace.js";
import { loadConfig } from "../../config/config.js";
import { decorateTaskWithReadiness } from "../../infra/task-readiness.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const tasksHandlers: GatewayRequestHandlers = {
  "tasks.get": async ({ params, respond }) => {
    const cfg = loadConfig();
    const agentId = String(params?.agentId ?? cfg.agents?.default ?? "main");
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const tasksPath = path.join(workspaceDir, "memory", "tasks.json");
    try {
      const raw = await fs.readFile(tasksPath, "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      const tasks = isPlainObject(data.tasks) ? data.tasks : {};
      const normalizedTasks = Object.fromEntries(
        Object.entries(tasks).map(([taskId, task]) => [
          taskId,
          isPlainObject(task) ? decorateTaskWithReadiness(task) : task,
        ]),
      );
      respond(true, { ...data, tasks: normalizedTasks }, undefined);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        respond(true, { lanes: {}, tasks: {} }, undefined);
        return;
      }
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to read tasks.json: ${String(err)}`),
      );
    }
  },
};
