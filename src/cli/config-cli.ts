import type { Command } from "commander";
import JSON5 from "json5";
import {
  getConfigValueAtPath,
  parseConfigPath,
  setConfigValueAtPath,
  unsetConfigValueAtPath,
} from "../config/config-paths.js";
import { readConfigFileSnapshot, writeConfigFile } from "../config/config.js";
import { danger, info } from "../globals.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { shortenHomePath } from "../utils.js";
import { formatCliCommand } from "./command-format.js";

type PathSegment = string;

function parsePath(raw: string): PathSegment[] {
  const parsed = parseConfigPath(raw);
  if (!parsed.ok || !parsed.path) {
    throw new Error(parsed.error ?? `Invalid path: ${raw}`);
  }
  return parsed.path;
}

function parseValue(raw: string, opts: { json?: boolean }): unknown {
  const trimmed = raw.trim();
  if (opts.json) {
    try {
      return JSON5.parse(trimmed);
    } catch (err) {
      throw new Error(`Failed to parse JSON5 value: ${String(err)}`, { cause: err });
    }
  }

  try {
    return JSON5.parse(trimmed);
  } catch {
    return raw;
  }
}

async function loadValidConfig() {
  const snapshot = await readConfigFileSnapshot();
  if (snapshot.valid) {
    return snapshot;
  }
  defaultRuntime.error(`Config invalid at ${shortenHomePath(snapshot.path)}.`);
  for (const issue of snapshot.issues) {
    defaultRuntime.error(`- ${issue.path || "<root>"}: ${issue.message}`);
  }
  defaultRuntime.error(`Run \`${formatCliCommand("openclaw doctor")}\` to repair, then retry.`);
  defaultRuntime.exit(1);
  return snapshot;
}

export function registerConfigCli(program: Command) {
  const cmd = program
    .command("config")
    .description("Config helpers (get/set/unset). Run without subcommand for the wizard.")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/config", "docs.openclaw.ai/cli/config")}\n`,
    )
    .option(
      "--section <section>",
      "Configure wizard sections (repeatable). Use with no subcommand.",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .action(async (opts) => {
      const { CONFIGURE_WIZARD_SECTIONS, configureCommand, configureCommandWithSections } =
        await import("../commands/configure.js");
      const sections: string[] = Array.isArray(opts.section)
        ? opts.section
            .map((value: unknown) => (typeof value === "string" ? value.trim() : ""))
            .filter(Boolean)
        : [];
      if (sections.length === 0) {
        await configureCommand(defaultRuntime);
        return;
      }

      const invalid = sections.filter((s) => !CONFIGURE_WIZARD_SECTIONS.includes(s as never));
      if (invalid.length > 0) {
        defaultRuntime.error(
          `Invalid --section: ${invalid.join(", ")}. Expected one of: ${CONFIGURE_WIZARD_SECTIONS.join(", ")}.`,
        );
        defaultRuntime.exit(1);
        return;
      }

      await configureCommandWithSections(sections as never, defaultRuntime);
    });

  cmd
    .command("get")
    .description("Get a config value by dot path")
    .argument("<path>", "Config path (dot or bracket notation)")
    .option("--json", "Output JSON", false)
    .action(async (path: string, opts) => {
      try {
        const parsedPath = parsePath(path);
        if (parsedPath.length === 0) {
          throw new Error("Path is empty.");
        }
        const snapshot = await loadValidConfig();
        const value = getConfigValueAtPath(snapshot.config as Record<string, unknown>, parsedPath);
        if (value === undefined) {
          defaultRuntime.error(danger(`Config path not found: ${path}`));
          defaultRuntime.exit(1);
          return;
        }
        if (opts.json) {
          defaultRuntime.log(JSON.stringify(value ?? null, null, 2));
          return;
        }
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          defaultRuntime.log(String(value));
          return;
        }
        defaultRuntime.log(JSON.stringify(value ?? null, null, 2));
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });

  cmd
    .command("set")
    .description("Set a config value by dot path")
    .argument("<path>", "Config path (dot or bracket notation)")
    .argument("<value>", "Value (JSON5 or raw string)")
    .option("--json", "Parse value as JSON5 (required)", false)
    .action(async (path: string, value: string, opts) => {
      try {
        const parsedPath = parsePath(path);
        if (parsedPath.length === 0) {
          throw new Error("Path is empty.");
        }
        const parsedValue = parseValue(value, opts);
        const snapshot = await loadValidConfig();
        const next = snapshot.config as Record<string, unknown>;
        setConfigValueAtPath(next, parsedPath, parsedValue);
        await writeConfigFile(next);
        defaultRuntime.log(info(`Updated ${path}. Restart the gateway to apply.`));
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });

  cmd
    .command("unset")
    .description("Remove a config value by dot path")
    .argument("<path>", "Config path (dot or bracket notation)")
    .action(async (path: string) => {
      try {
        const parsedPath = parsePath(path);
        if (parsedPath.length === 0) {
          throw new Error("Path is empty.");
        }
        const snapshot = await loadValidConfig();
        const next = snapshot.config as Record<string, unknown>;
        const removed = unsetConfigValueAtPath(next, parsedPath);
        if (!removed) {
          defaultRuntime.error(danger(`Config path not found: ${path}`));
          defaultRuntime.exit(1);
          return;
        }
        await writeConfigFile(next);
        defaultRuntime.log(info(`Removed ${path}. Restart the gateway to apply.`));
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });
}
