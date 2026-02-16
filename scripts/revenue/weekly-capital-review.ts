#!/usr/bin/env -S node --import tsx
import { runWeeklyCapitalReview } from "../../src/revenue/jobs.js";

async function main() {
  const result = await runWeeklyCapitalReview();
  console.log(`weekly report: ${result.reportPath}`);
  console.log(
    `cashBuffer=$${result.cashBufferUsd.toFixed(2)} decisions=${result.decisions.length}`,
  );
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
