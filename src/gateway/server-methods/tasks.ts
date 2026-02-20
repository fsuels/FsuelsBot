import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { GatewayRequestHandlers } from "./types.js";
import { resolveAgentWorkspaceDir } from "../../agents/workspace.js";
import { loadConfig } from "../../config/config.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

export const tasksHandlers: GatewayRequestHandlers = {
  "tasks.get": async ({ params, respond }) => {
    const cfg = loadConfig();
    const agentId = String(params?.agentId ?? cfg.agents?.default ?? "main");
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const tasksPath = path.join(workspaceDir, "memory", "tasks.json");
    try {
      const raw = await fs.readFile(tasksPath, "utf-8");
      const data = JSON.parse(raw);
      respond(true, data, undefined);
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
