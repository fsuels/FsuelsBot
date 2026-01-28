import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Auto-patch hook: runs on gateway:startup to fix orphaned tool_result blocks.
 *
 * Bug: limitHistoryTurns() truncates conversation history AFTER tool_use/tool_result
 * pairing is repaired, which can slice away assistant messages with tool_use blocks
 * while leaving orphaned tool_result messages. Anthropic's API then rejects with:
 *   "unexpected tool_use_id found in tool_result blocks"
 *
 * Patches applied (idempotent):
 *   1. history.js         — strips orphaned toolResults after history slicing
 *   2. transform-messages.js — defense-in-depth strip before API call
 */

const HISTORY_MARKER = "stripLeadingOrphanedToolResults";
const TRANSFORM_MARKER = "Third pass: strip orphaned toolResult";

function findClawdbotRoot() {
  // Walk up from this file to find the clawdbot package
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Workspace hooks live at <workspace>/hooks/auto-patch/handler.js
  // clawdbot is at the global npm prefix
  const candidates = [
    // Global npm on Windows
    path.join(process.env.APPDATA || "", "npm", "node_modules", "clawdbot"),
    // Global npm on Unix
    "/usr/local/lib/node_modules/clawdbot",
    "/usr/lib/node_modules/clawdbot",
  ];

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "package.json"))) return c;
  }

  // Fallback: resolve from require
  try {
    const entry = import.meta.resolve?.("clawdbot");
    if (entry) {
      const resolved = entry.startsWith("file://") ? fileURLToPath(entry) : entry;
      const idx = resolved.indexOf("clawdbot");
      if (idx !== -1) {
        const root = resolved.slice(0, idx + "clawdbot".length);
        if (fs.existsSync(path.join(root, "package.json"))) return root;
      }
    }
  } catch {}

  return null;
}

function patchHistory(root) {
  const filePath = path.join(root, "dist", "agents", "pi-embedded-runner", "history.js");
  if (!fs.existsSync(filePath)) return false;

  let src = fs.readFileSync(filePath, "utf-8");
  if (src.includes(HISTORY_MARKER)) return false; // already patched

  // Replace the return inside limitHistoryTurns
  const oldReturn = /if \(userCount > limit\) \{\s*return messages\.slice\(lastUserIndex\);\s*\}/;
  if (!oldReturn.test(src)) {
    console.warn("[auto-patch] history.js — could not find insertion point, skipping.");
    return false;
  }

  src = src.replace(
    oldReturn,
    `if (userCount > limit) {
                const sliced = messages.slice(lastUserIndex);
                return stripLeadingOrphanedToolResults(sliced);
            }`
  );

  const stripFn = `
/**
 * Remove toolResult messages whose tool_use_id does not match any
 * assistant tool call in the array. Prevents Anthropic API rejection
 * after limitHistoryTurns slices away the matching assistant message.
 */
function stripLeadingOrphanedToolResults(messages) {
    const validToolCallIds = new Set();
    for (const msg of messages) {
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
            for (const block of msg.content) {
                if (block && typeof block === "object" && typeof block.id === "string" &&
                    (block.type === "toolCall" || block.type === "toolUse" || block.type === "functionCall")) {
                    validToolCallIds.add(block.id);
                }
            }
        }
    }
    return messages.filter((msg) => {
        if (msg.role !== "toolResult")
            return true;
        const toolCallId = msg.toolCallId ?? msg.toolUseId;
        if (!toolCallId)
            return true;
        return validToolCallIds.has(toolCallId);
    });
}`;

  // Insert helper before getDmHistoryLimitFromSessionKey
  src = src.replace(
    /\/\*\*\s*\n\s*\* Extract provider \+ user ID/,
    stripFn + "\n/**\n * Extract provider + user ID"
  );

  fs.writeFileSync(filePath, src, "utf-8");
  return true;
}

function patchTransformMessages(root) {
  const filePath = path.join(
    root, "node_modules", "@mariozechner", "pi-ai", "dist", "providers", "transform-messages.js"
  );
  if (!fs.existsSync(filePath)) return false;

  let src = fs.readFileSync(filePath, "utf-8");
  if (src.includes(TRANSFORM_MARKER)) return false; // already patched

  const thirdPass = `
    // Third pass: strip orphaned toolResult messages whose tool_use_id has no
    // matching tool_use block from any assistant message in the conversation.
    // This can happen when history truncation (limitHistoryTurns) or compaction
    // removes assistant messages but leaves their tool results behind.
    const allToolCallIds = new Set();
    for (const msg of result) {
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
            for (const block of msg.content) {
                if (block && block.type === "toolCall" && typeof block.id === "string") {
                    allToolCallIds.add(block.id);
                }
            }
        }
    }
    const cleaned = result.filter((msg) => {
        if (msg.role !== "toolResult")
            return true;
        const id = msg.toolCallId;
        return typeof id === "string" && allToolCallIds.has(id);
    });
    return cleaned;`;

  // Replace final "return result;" with third pass
  const lastReturn = src.lastIndexOf("    return result;\n}");
  if (lastReturn === -1) {
    console.warn("[auto-patch] transform-messages.js — could not find insertion point, skipping.");
    return false;
  }

  const afterClose = src.indexOf("\n", lastReturn + "    return result;\n}".length);
  src = src.slice(0, lastReturn) + thirdPass + "\n}" +
    (afterClose !== -1 ? src.slice(afterClose) : "\n");

  fs.writeFileSync(filePath, src, "utf-8");
  return true;
}

const handler = async (event) => {
  if (event.type !== "gateway" || event.action !== "startup") return;

  const root = findClawdbotRoot();
  if (!root) {
    console.warn("[auto-patch] clawdbot root not found, skipping patches.");
    return;
  }

  const p1 = patchHistory(root);
  const p2 = patchTransformMessages(root);

  if (p1 || p2) {
    console.log(`[auto-patch] Applied orphaned tool_result fixes (history=${p1}, transform=${p2}).`);
    console.log("[auto-patch] Note: patches take effect on the NEXT agent request (no restart needed).");
  }
};

export default handler;
