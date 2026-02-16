#!/usr/bin/env -S node --import tsx
import { runWeekdayDeliveryBatch } from "../../src/revenue/jobs.js";

function parseArgs(argv: string[]): { limit?: number } {
  const limitIndex = argv.findIndex((arg) => arg === "--limit");
  if (limitIndex >= 0 && argv[limitIndex + 1]) {
    const parsed = Number.parseInt(argv[limitIndex + 1], 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return { limit: parsed };
    }
  }
  return {};
}

async function main() {
  const result = await runWeekdayDeliveryBatch(parseArgs(process.argv.slice(2)));
  console.log(`delivery report: ${result.reportPath}`);
  console.log(`generated=${result.generated} approvalsQueued=${result.approvalsQueued}`);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
