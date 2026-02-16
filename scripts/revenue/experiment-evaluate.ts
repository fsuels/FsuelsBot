#!/usr/bin/env -S node --import tsx
import { runExperimentEvaluation } from "../../src/revenue/jobs.js";

async function main() {
  const result = await runExperimentEvaluation();
  console.log(`experiment evaluation report: ${result.reportPath}`);
  console.log(
    `evaluated=${result.evaluated} passed=${result.passed} killed=${result.killed} held=${result.held}`,
  );
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
