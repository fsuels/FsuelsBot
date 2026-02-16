#!/usr/bin/env -S node --import tsx
import { runBaselineSnapshot } from "../../src/revenue/jobs.js";

async function main() {
  const result = await runBaselineSnapshot();
  console.log(`baseline report: ${result.reportPath}`);
  console.log(`config path: ${result.configPath}`);
  console.log(`opportunities: ${result.snapshot.opportunitiesCount}`);
  console.log(`active experiments: ${result.snapshot.activeExperimentsCount}`);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
