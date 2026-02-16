#!/usr/bin/env -S node --import tsx
import { runDailyDemandScan } from "../../src/revenue/jobs.js";

function parseArgs(argv: string[]): { consumeInbox: boolean; limit?: number } {
  const consumeInbox = argv.includes("--consume-inbox");
  const limitIndex = argv.findIndex((arg) => arg === "--limit");
  let limit: number | undefined;
  if (limitIndex >= 0 && argv[limitIndex + 1]) {
    const parsed = Number.parseInt(argv[limitIndex + 1], 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = parsed;
    }
  }
  return { consumeInbox, limit };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runDailyDemandScan(args);
  console.log(`demand report: ${result.reportPath}`);
  console.log(
    `processed=${result.processed} inserted=${result.inserted} duplicate=${result.duplicates} go=${result.goCount} watch=${result.watchCount} no-go=${result.noGoCount}`,
  );
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
