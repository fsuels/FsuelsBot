#!/usr/bin/env node
/**
 * Permanent fix for orphaned tool_result blocks that cause:
 *   "unexpected tool_use_id found in tool_result blocks"
 *
 * Root cause: limitHistoryTurns() in history.js slices conversation history
 * AFTER sanitizeSessionHistory() repairs tool_use/tool_result pairing.
 * The slice can remove assistant messages with tool_use blocks while keeping
 * their orphaned tool_result messages, which Anthropic's API then rejects.
 *
 * This script patches two files idempotently (safe to run multiple times):
 *   1. history.js         — strips orphaned toolResults after slicing
 *   2. transform-messages.js — defense-in-depth: strips orphans before API call
 *
 * Usage:
 *   node patches/apply-tool-result-fix.mjs
 *   node patches/apply-tool-result-fix.mjs --check   (dry-run, exit 0 if already applied)
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const CHECK_ONLY = process.argv.includes("--check");

// Find clawdbot installation
function findClawdbotRoot() {
  // Try global npm prefix
  try {
    const prefix = execSync("npm prefix -g", { encoding: "utf-8" }).trim();
    const candidate = path.join(prefix, "node_modules", "clawdbot");
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
  } catch {}
  // Try npx-style
  const appData = process.env.APPDATA;
  if (appData) {
    const candidate = path.join(appData, "npm", "node_modules", "clawdbot");
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  console.error("[patch] Could not find clawdbot installation.");
  process.exit(1);
}

const root = findClawdbotRoot();
console.log(`[patch] clawdbot root: ${root}`);

// --- Patch 1: history.js ---
const historyPath = path.join(root, "dist", "agents", "pi-embedded-runner", "history.js");
const HISTORY_MARKER = "stripLeadingOrphanedToolResults";

const STRIP_FN = `
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

function patchHistory() {
  let src = fs.readFileSync(historyPath, "utf-8");
  if (src.includes(HISTORY_MARKER)) {
    console.log("[patch] history.js — already patched.");
    return false;
  }
  if (CHECK_ONLY) {
    console.log("[patch] history.js — NOT patched (dry-run).");
    return true;
  }

  // Replace the return inside limitHistoryTurns to call our strip function
  src = src.replace(
    /if \(userCount > limit\) \{\s*return messages\.slice\(lastUserIndex\);\s*\}/,
    `if (userCount > limit) {
                const sliced = messages.slice(lastUserIndex);
                return stripLeadingOrphanedToolResults(sliced);
            }`
  );

  // Insert the helper function before getDmHistoryLimitFromSessionKey
  src = src.replace(
    /\/\*\*\s*\n\s*\* Extract provider \+ user ID/,
    STRIP_FN + "\n/**\n * Extract provider + user ID"
  );

  fs.writeFileSync(historyPath, src, "utf-8");
  console.log("[patch] history.js — PATCHED.");
  return true;
}

// --- Patch 2: transform-messages.js ---
const transformPath = path.join(
  root, "node_modules", "@mariozechner", "pi-ai", "dist", "providers", "transform-messages.js"
);
const TRANSFORM_MARKER = "Third pass: strip orphaned toolResult";

function patchTransformMessages() {
  if (!fs.existsSync(transformPath)) {
    console.log("[patch] transform-messages.js — file not found, skipping.");
    return false;
  }

  let src = fs.readFileSync(transformPath, "utf-8");
  if (src.includes(TRANSFORM_MARKER)) {
    console.log("[patch] transform-messages.js — already patched.");
    return false;
  }
  if (CHECK_ONLY) {
    console.log("[patch] transform-messages.js — NOT patched (dry-run).");
    return true;
  }

  const THIRD_PASS = `
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

  // Replace the final "return result;" with the third pass + return cleaned
  // Match the last "return result;" in the transformMessages function
  const lastReturn = src.lastIndexOf("    return result;\n}");
  if (lastReturn === -1) {
    console.error("[patch] transform-messages.js — could not find insertion point.");
    return false;
  }

  src = src.slice(0, lastReturn) + THIRD_PASS + "\n}\n" + src.slice(src.indexOf("\n", lastReturn + "    return result;\n}".length) + 1);

  fs.writeFileSync(transformPath, src, "utf-8");
  console.log("[patch] transform-messages.js — PATCHED.");
  return true;
}

// --- Run ---
const changed1 = patchHistory();
const changed2 = patchTransformMessages();

if (CHECK_ONLY) {
  process.exit(changed1 || changed2 ? 1 : 0);
} else {
  console.log(changed1 || changed2 ? "[patch] Done. Restart the gateway to apply." : "[patch] All patches already applied.");
}
