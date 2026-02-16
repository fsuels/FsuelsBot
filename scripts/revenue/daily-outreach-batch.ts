#!/usr/bin/env -S node --import tsx
import { runDailyOutreachBatch } from "../../src/revenue/jobs.js";

function parseArgs(argv: string[]): { maxDrafts?: number } {
  const maxIndex = argv.findIndex((arg) => arg === "--max-drafts");
  if (maxIndex >= 0 && argv[maxIndex + 1]) {
    const parsed = Number.parseInt(argv[maxIndex + 1], 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return { maxDrafts: parsed };
    }
  }
  return {};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runDailyOutreachBatch(args);
  console.log(`approval report: ${result.reportPath}`);
  console.log(
    `drafted=${result.drafted} autoApproved=${result.autoApproved} pending=${result.pending} rejected=${result.rejected}`,
  );
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
