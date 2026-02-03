#!/usr/bin/env node
import { execSync } from "node:child_process";

const sensitivePaths = new Set([
  "src/memory/manager.ts",
  "src/agents/memory-search.ts",
  "src/agents/tools/memory-tool.ts",
  "src/config/types.tools.ts",
  "src/config/schema.ts",
  "src/config/zod-schema.agent-runtime.ts",
]);

const requiredDoc = "docs/memory/retrieval-migration.md";

function runGit(command) {
  return execSync(command, {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
  }).trim();
}

function listChangedPaths() {
  const baseRef = process.env.RETRIEVAL_MIGRATION_GATE_BASE_REF?.trim();
  const rangesToTry = [];
  if (baseRef) rangesToTry.push(`${baseRef}...HEAD`);
  rangesToTry.push("HEAD~1...HEAD", "HEAD^...HEAD", "HEAD");
  for (const range of rangesToTry) {
    try {
      const output = runGit(`git diff --name-only ${range}`);
      if (!output) return [];
      return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      // Try next strategy.
    }
  }
  return [];
}

const changedPaths = listChangedPaths();
if (changedPaths.length === 0) {
  console.log("retrieval-migration-gate: no changed files detected; skipping.");
  process.exit(0);
}

const touchedSensitivePath = changedPaths.some((path) => sensitivePaths.has(path));
if (!touchedSensitivePath) {
  console.log("retrieval-migration-gate: retrieval-sensitive files unchanged.");
  process.exit(0);
}

if (process.env.RETRIEVAL_MIGRATION_GATE_BYPASS === "true") {
  console.log("retrieval-migration-gate: bypassed via RETRIEVAL_MIGRATION_GATE_BYPASS=true.");
  process.exit(0);
}

const touchedRunbook = changedPaths.includes(requiredDoc);
if (touchedRunbook) {
  console.log(`retrieval-migration-gate: pass (${requiredDoc} updated with retrieval-sensitive changes).`);
  process.exit(0);
}

console.error("retrieval-migration-gate: FAILED.");
console.error(
  `retrieval-sensitive files changed without updating ${requiredDoc}. Update the runbook (or set RETRIEVAL_MIGRATION_GATE_BYPASS=true with justification).`,
);
process.exit(1);
