import type { Command } from "commander";
import {
  skillFactoryBackfillCommand,
  skillFactoryEvaluateCommand,
  skillFactoryPromoteCommand,
  skillFactoryStatusCommand,
} from "../../commands/skill-factory.js";
import { defaultRuntime } from "../../runtime.js";
import { runCommandWithRuntime } from "../cli-utils.js";

export function registerSkillFactoryCommands(program: Command) {
  const root = program
    .command("skill-factory")
    .description("Manage proactive skill creation and promotion lifecycle");

  root
    .command("status")
    .description("Show skill-factory state for an agent")
    .option("--agent <id>", "Agent id")
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await skillFactoryStatusCommand({ agent: opts.agent }, defaultRuntime);
      });
    });

  root
    .command("backfill")
    .description("Extract episodes from transcript history")
    .option("--agent <id>", "Agent id")
    .option("--full", "Reprocess all transcript files", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await skillFactoryBackfillCommand(
          {
            agent: opts.agent,
            full: Boolean(opts.full),
          },
          defaultRuntime,
        );
      });
    });

  root
    .command("evaluate")
    .description("Evaluate a draft/candidate version")
    .requiredOption("--skill <key>", "Skill key")
    .option("--hash <hash>", "Specific version hash")
    .option("--agent <id>", "Agent id")
    .option("--promote-if-pass", "Promote automatically if eval passes", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await skillFactoryEvaluateCommand(
          {
            skill: opts.skill,
            hash: opts.hash,
            agent: opts.agent,
            promoteIfPass: Boolean(opts.promoteIfPass),
          },
          defaultRuntime,
        );
      });
    });

  root
    .command("promote")
    .description("Promote a candidate/draft version to trusted")
    .requiredOption("--skill <key>", "Skill key")
    .requiredOption("--hash <hash>", "Version hash")
    .option("--agent <id>", "Agent id")
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await skillFactoryPromoteCommand(
          {
            skill: opts.skill,
            hash: opts.hash,
            agent: opts.agent,
          },
          defaultRuntime,
        );
      });
    });
}
