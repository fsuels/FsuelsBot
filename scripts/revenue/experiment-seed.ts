#!/usr/bin/env -S node --import tsx
import { seedExperimentFromTopGoOpportunity } from "../../src/revenue/jobs.js";

async function main() {
  const result = await seedExperimentFromTopGoOpportunity();
  console.log(`experiment seed report: ${result.reportPath}`);
  console.log(`created=${result.created} experimentId=${result.experimentId ?? "n/a"}`);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
