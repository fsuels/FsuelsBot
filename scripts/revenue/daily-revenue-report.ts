#!/usr/bin/env -S node --import tsx
import { runDailyRevenueReport } from "../../src/revenue/jobs.js";

async function main() {
  const result = await runDailyRevenueReport();
  console.log(`daily report: ${result.reportPath}`);
  console.log(
    `revenue=$${result.summary.revenueUsd.toFixed(2)} cash=$${result.summary.cashSpentUsd.toFixed(2)} hours=${result.summary.hoursSpent.toFixed(2)}`,
  );
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
