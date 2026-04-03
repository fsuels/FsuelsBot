import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DEFAULT_QUEUE_ROOT = "/Users/fsuels/Library/Mobile Documents/iCloud~md~obsidian/Documents/Fsuels Notes/Pinterest/Queue";
const JOB_ROOT = path.join(ROOT, "workspace/pinterest-jobs");

type QueueRunArgs = {
  queueRoot: string;
  limit: number | null;
  noteFilter: string | null;
  dryRun: boolean;
  stopOnError: boolean;
};

type QueueResult = {
  noteName: string;
  status: "done" | "needs_review" | "skipped";
  liveUrl?: string;
  jobDir?: string;
  error?: string;
};

function parseArgs(argv: string[]): QueueRunArgs {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(current, "true");
      continue;
    }
    args.set(current, next);
    index += 1;
  }

  const limitRaw = args.get("--limit");
  return {
    queueRoot: path.resolve(args.get("--queue-root") ?? DEFAULT_QUEUE_ROOT),
    limit: limitRaw ? Number.parseInt(limitRaw, 10) : null,
    noteFilter: args.get("--note") ?? null,
    dryRun: args.get("--dry-run") === "true",
    stopOnError: args.get("--stop-on-error") === "true"
  };
}

function logStep(message: string) {
  process.stdout.write(`\n[queue ${new Date().toISOString()}] ${message}\n`);
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function listMarkdownFiles(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(dirPath, entry.name))
    .toSorted((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

async function collectQueueNotes(queueRoot: string, noteFilter: string | null): Promise<string[]> {
  const workingDir = path.join(queueRoot, "Working");
  const workingNotes = await listMarkdownFiles(workingDir);
  const rootNotes = (await listMarkdownFiles(queueRoot)).filter((filePath) => {
    const name = path.basename(filePath);
    return name !== "README.md" && !name.startsWith("TEMPLATE");
  });

  const ordered = [...workingNotes, ...rootNotes];
  if (!noteFilter) {
    return ordered;
  }

  const lowerFilter = noteFilter.toLowerCase();
  return ordered.filter((filePath) => path.basename(filePath).toLowerCase().includes(lowerFilter));
}

async function ensureFolder(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function moveIntoQueueSubfolder(notePath: string, queueRoot: string, subfolder: string): Promise<string> {
  const resolvedSource = path.resolve(notePath);
  const currentDir = path.dirname(resolvedSource);
  const targetDir = path.join(queueRoot, subfolder);
  const targetPath = path.join(targetDir, path.basename(resolvedSource));

  if (currentDir === targetDir) {
    return resolvedSource;
  }

  await ensureFolder(targetDir);
  await fs.rename(resolvedSource, targetPath);
  return targetPath;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runNodeScript(label: string, scriptPath: string, extraArgs: string[]): Promise<string> {
  logStep(label);
  const commandArgs = ["--import", "tsx", scriptPath, ...extraArgs];
  const child = spawn(process.execPath, commandArgs, {
    cwd: ROOT,
    env: {
      ...process.env,
      TSX_DISABLE_CACHE: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer | string) => {
    const text = chunk.toString();
    stdout += text;
    process.stdout.write(text);
  });

  child.stderr.on("data", (chunk: Buffer | string) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(text);
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}.${stderr ? ` ${stderr.trim()}` : ""}`);
  }

  return stdout;
}

function extractLiveUrl(output: string): string | null {
  const match = output.match(/"liveUrl"\s*:\s*"([^"]+)"/);
  return match?.[1] ?? null;
}

async function writeFailureArtifact(jobDir: string, notePath: string, error: string) {
  await ensureFolder(jobDir);
  const failurePath = path.join(jobDir, "publish-error.md");
  const contents = [
    "# Publish Error",
    "",
    `- Failed at: \`${new Date().toISOString()}\``,
    `- Queue note: \`${notePath}\``,
    "",
    "## Error",
    "",
    "```text",
    error.trim(),
    "```"
  ].join("\n");
  await fs.writeFile(failurePath, contents + "\n");
}

async function processQueueNote(notePath: string, queueRoot: string, dryRun: boolean): Promise<QueueResult> {
  const noteName = path.basename(notePath);
  const workingPath = await moveIntoQueueSubfolder(notePath, queueRoot, "Working");
  const jobDir = path.join(JOB_ROOT, slugify(path.basename(workingPath, ".md")));
  const packetPath = path.join(jobDir, "packet.json");

  if (dryRun) {
    return {
      noteName,
      status: "skipped",
      jobDir
    };
  }

  try {
    await runNodeScript(`Build job for ${noteName}`, "scripts/pinterest/build-pin-job.ts", ["--queue-note", workingPath]);
    await runNodeScript(`Render image for ${noteName}`, "scripts/pinterest/render-pin-image.ts", ["--job", packetPath]);
    const publishOutput = await runNodeScript(`Publish pin for ${noteName}`, "scripts/pinterest/publish-pin-background.ts", ["--job", packetPath]);
    return {
      noteName,
      status: "done",
      jobDir,
      liveUrl: extractLiveUrl(publishOutput) ?? undefined
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFailureArtifact(jobDir, workingPath, message);
    if (await fileExists(workingPath)) {
      await moveIntoQueueSubfolder(workingPath, queueRoot, "Needs Review");
    }
    return {
      noteName,
      status: "needs_review",
      jobDir,
      error: message
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const notes = await collectQueueNotes(args.queueRoot, args.noteFilter);
  const limitedNotes = args.limit ? notes.slice(0, args.limit) : notes;

  if (limitedNotes.length === 0) {
    process.stdout.write("No queue notes found.\n");
    return;
  }

  logStep(`Queue root: ${args.queueRoot}`);
  logStep(`Notes to process: ${limitedNotes.map((notePath) => path.basename(notePath)).join(", ")}`);

  const results: QueueResult[] = [];
  for (const notePath of limitedNotes) {
    const result = await processQueueNote(notePath, args.queueRoot, args.dryRun);
    results.push(result);
    if (result.status === "needs_review" && args.stopOnError) {
      break;
    }
  }

  const doneCount = results.filter((result) => result.status === "done").length;
  const reviewCount = results.filter((result) => result.status === "needs_review").length;
  const skippedCount = results.filter((result) => result.status === "skipped").length;

  process.stdout.write("\nQueue run summary\n");
  for (const result of results) {
    process.stdout.write(
      `- ${result.noteName}: ${result.status}${result.liveUrl ? ` ${result.liveUrl}` : ""}${result.error ? ` (${result.error})` : ""}\n`
    );
  }
  process.stdout.write(`Done: ${doneCount} | Needs Review: ${reviewCount} | Skipped: ${skippedCount}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message + "\n");
  process.exitCode = 1;
});
