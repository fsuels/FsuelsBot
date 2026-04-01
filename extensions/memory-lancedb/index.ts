/**
 * OpenClaw Memory (LanceDB) Plugin
 *
 * Long-term memory with vector search for AI conversations.
 * Uses LanceDB for storage and OpenAI for embeddings.
 * Provides seamless auto-recall and auto-capture via lifecycle hooks.
 */

import type * as LanceDB from "@lancedb/lancedb";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { stringEnum } from "openclaw/plugin-sdk";
import { MEMORY_TYPES, type MemoryType, memoryConfigSchema, vectorDimsForModel } from "./config.js";
import {
  buildRecallView,
  classifyMemoryType,
  formatRecallLine,
  prepareMemoryForStorage,
  shouldIgnoreMemory,
  type MemoryInputType,
  type PreparedMemory,
} from "./policy.js";

// ============================================================================
// Types
// ============================================================================

let lancedbImportPromise: Promise<typeof import("@lancedb/lancedb")> | null = null;
const loadLanceDB = async (): Promise<typeof import("@lancedb/lancedb")> => {
  if (!lancedbImportPromise) {
    lancedbImportPromise = import("@lancedb/lancedb");
  }
  try {
    return await lancedbImportPromise;
  } catch (err) {
    // Common on macOS today: upstream package may not ship darwin native bindings.
    throw new Error(`memory-lancedb: failed to load LanceDB. ${String(err)}`, { cause: err });
  }
};

type MemoryEntry = {
  id: string;
  text: string;
  vector: number[];
  importance: number;
  type: MemoryType;
  category?: string;
  savedAt: number;
  createdAt: number;
};

type MemorySearchResult = {
  entry: MemoryEntry;
  score: number;
};

function normalizeStoredType(type: unknown, category: unknown, text: string): MemoryType {
  const candidate = typeof type === "string" ? type : typeof category === "string" ? category : "";
  if (MEMORY_TYPES.includes(candidate as MemoryType)) {
    return candidate as MemoryType;
  }
  switch (candidate) {
    case "preference":
    case "entity":
      return "user";
    case "decision":
      return "project";
    case "fact":
      return classifyMemoryType(text, "user") ?? "reference";
    case "other":
      return "reference";
  }
  return classifyMemoryType(text, "user") ?? "reference";
}

// ============================================================================
// LanceDB Provider
// ============================================================================

const TABLE_NAME = "memories";

class MemoryDB {
  private db: LanceDB.Connection | null = null;
  private table: LanceDB.Table | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly dbPath: string,
    private readonly vectorDim: number,
  ) {}

  private async ensureInitialized(): Promise<void> {
    if (this.table) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    const lancedb = await loadLanceDB();
    this.db = await lancedb.connect(this.dbPath);
    const tables = await this.db.tableNames();

    if (tables.includes(TABLE_NAME)) {
      this.table = await this.db.openTable(TABLE_NAME);
    } else {
      this.table = await this.db.createTable(TABLE_NAME, [
        {
          id: "__schema__",
          text: "",
          vector: Array.from({ length: this.vectorDim }).fill(0),
          importance: 0,
          type: "reference",
          category: "reference",
          savedAt: 0,
          createdAt: 0,
        },
      ]);
      await this.table.delete('id = "__schema__"');
    }
  }

  async store(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<MemoryEntry> {
    await this.ensureInitialized();

    const savedAt = Number.isFinite(entry.savedAt) ? entry.savedAt : Date.now();
    const fullEntry: MemoryEntry = {
      ...entry,
      id: randomUUID(),
      savedAt,
      createdAt: savedAt,
    };

    await this.table!.add([fullEntry]);
    return fullEntry;
  }

  async search(vector: number[], limit = 5, minScore = 0.5): Promise<MemorySearchResult[]> {
    await this.ensureInitialized();

    const results = await this.table!.vectorSearch(vector).limit(limit).toArray();

    // LanceDB uses L2 distance by default; convert to similarity score
    const mapped = results.map((row) => {
      const distance = row._distance ?? 0;
      // Use inverse for a 0-1 range: sim = 1 / (1 + d)
      const score = 1 / (1 + distance);
      return {
        entry: {
          id: row.id as string,
          text: row.text as string,
          vector: row.vector as number[],
          importance: row.importance as number,
          type: normalizeStoredType(row.type, row.category, row.text as string),
          category:
            typeof row.category === "string"
              ? row.category
              : typeof row.type === "string"
                ? row.type
                : undefined,
          savedAt:
            typeof row.savedAt === "number" && Number.isFinite(row.savedAt)
              ? row.savedAt
              : typeof row.createdAt === "number" && Number.isFinite(row.createdAt)
                ? row.createdAt
                : 0,
          createdAt:
            typeof row.createdAt === "number" && Number.isFinite(row.createdAt)
              ? row.createdAt
              : typeof row.savedAt === "number" && Number.isFinite(row.savedAt)
                ? row.savedAt
                : 0,
        },
        score,
      };
    });

    return mapped.filter((r) => r.score >= minScore);
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureInitialized();
    // Validate UUID format to prevent injection
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      throw new Error(`Invalid memory ID format: ${id}`);
    }
    await this.table!.delete(`id = '${id}'`);
    return true;
  }

  async count(): Promise<number> {
    await this.ensureInitialized();
    return this.table!.countRows();
  }
}

// ============================================================================
// OpenAI Embeddings
// ============================================================================

class Embeddings {
  private client: OpenAI;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    return response.data[0].embedding;
  }
}

export function shouldCapture(text: string): boolean {
  return prepareMemoryForStorage({ text, sourceRole: "user" }) !== null;
}

export function detectCategory(text: string): MemoryType {
  return classifyMemoryType(text, "user") ?? "reference";
}

function extractRecentUserTexts(messages: readonly unknown[], limit = 4): string[] {
  const texts: string[] = [];
  for (const raw of [...messages].reverse()) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const message = raw as Record<string, unknown>;
    if (message.role !== "user") {
      continue;
    }
    const content = message.content;
    if (typeof content === "string") {
      texts.push(content);
      if (texts.length >= limit) {
        break;
      }
      continue;
    }
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        "type" in block &&
        (block as Record<string, unknown>).type === "text" &&
        "text" in block &&
        typeof (block as Record<string, unknown>).text === "string"
      ) {
        texts.push((block as Record<string, unknown>).text as string);
        if (texts.length >= limit) {
          break;
        }
      }
    }
    if (texts.length >= limit) {
      break;
    }
  }
  return texts.reverse();
}

// ============================================================================
// Plugin Definition
// ============================================================================

const memoryPlugin = {
  id: "memory-lancedb",
  name: "Memory (LanceDB)",
  description: "LanceDB-backed long-term memory with auto-recall/capture",
  kind: "memory" as const,
  configSchema: memoryConfigSchema,

  register(api: OpenClawPluginApi) {
    const cfg = memoryConfigSchema.parse(api.pluginConfig);
    const resolvedDbPath = api.resolvePath(cfg.dbPath!);
    const vectorDim = vectorDimsForModel(cfg.embedding.model ?? "text-embedding-3-small");
    const db = new MemoryDB(resolvedDbPath, vectorDim);
    const embeddings = new Embeddings(cfg.embedding.apiKey, cfg.embedding.model!);

    api.logger.info(`memory-lancedb: plugin registered (db: ${resolvedDbPath}, lazy init)`);

    const storePreparedMemory = async (prepared: PreparedMemory) => {
      const vector = await embeddings.embed(prepared.text);
      const existing = await db.search(vector, 1, 0.95);
      if (existing.length > 0) {
        return {
          action: "duplicate" as const,
          existingId: existing[0].entry.id,
          existingText: existing[0].entry.text,
        };
      }

      const entry = await db.store({
        text: prepared.text,
        vector,
        importance: prepared.importance,
        type: prepared.type,
        category: prepared.type,
        savedAt: prepared.savedAt,
      });
      return { action: "created" as const, id: entry.id, text: entry.text };
    };

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "memory_recall",
        label: "Memory Recall",
        description:
          "Search through long-term memories. Use when you need context about user preferences, past decisions, or previously discussed topics.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query" }),
          limit: Type.Optional(Type.Number({ description: "Max results (default: 5)" })),
        }),
        async execute(_toolCallId, params) {
          const { query, limit = 5 } = params as { query: string; limit?: number };

          const vector = await embeddings.embed(query);
          const results = await db.search(vector, limit, 0.1);

          if (results.length === 0) {
            return {
              content: [{ type: "text", text: "No relevant memories found." }],
              details: { count: 0 },
            };
          }

          const recallViews = await Promise.all(
            results.map(async (result) => ({
              result,
              view: await buildRecallView({ candidate: result.entry }),
            })),
          );
          const text = recallViews
            .map(
              ({ result, view }, i) =>
                `${i + 1}. ${formatRecallLine({ view, score: result.score, includeBody: true })}`,
            )
            .join("\n\n");

          // Strip vector data for serialization (typed arrays can't be cloned)
          const sanitizedResults = recallViews.map(({ result, view }) => ({
            id: result.entry.id,
            text: result.entry.text,
            type: view.type,
            category: view.type,
            importance: result.entry.importance,
            savedAt: view.savedAt,
            stale: view.stale,
            stalenessNote: view.stalenessNote,
            verification: view.verification,
            score: result.score,
          }));

          return {
            content: [{ type: "text", text: `Found ${recallViews.length} memories:\n\n${text}` }],
            details: { count: recallViews.length, memories: sanitizedResults },
          };
        },
      },
      { name: "memory_recall" },
    );

    api.registerTool(
      {
        name: "memory_store",
        label: "Memory Store",
        description:
          "Save durable, non-derivable memory such as user preferences, reusable feedback, project conventions, or reference pointers.",
        parameters: Type.Object({
          text: Type.String({ description: "Information to remember" }),
          importance: Type.Optional(Type.Number({ description: "Importance 0-1 (optional)" })),
          type: Type.Optional(stringEnum(MEMORY_TYPES)),
          category: Type.Optional(Type.String({ description: "Legacy alias for type" })),
        }),
        async execute(_toolCallId, params) {
          const { text, importance, type, category } = params as {
            text: string;
            importance?: number;
            type?: MemoryType;
            category?: MemoryInputType;
          };
          const prepared = prepareMemoryForStorage({
            text,
            importance,
            explicitType: type ?? category,
            sourceRole: "user",
          });
          if (!prepared) {
            return {
              content: [
                {
                  type: "text",
                  text: "Skipped: memory must be durable, non-derivable context such as user preferences, reusable feedback, project conventions, or reference pointers.",
                },
              ],
              details: { action: "skipped", reason: "policy_rejected" },
            };
          }

          const stored = await storePreparedMemory(prepared);
          if (stored.action === "duplicate") {
            return {
              content: [
                {
                  type: "text",
                  text: `Similar memory already exists: "${stored.existingText}"`,
                },
              ],
              details: stored,
            };
          }

          return {
            content: [{ type: "text", text: `Stored: "${prepared.text.slice(0, 100)}..."` }],
            details: {
              action: "created",
              id: stored.id,
              type: prepared.type,
              savedAt: prepared.savedAt,
            },
          };
        },
      },
      { name: "memory_store" },
    );

    api.registerTool(
      {
        name: "memory_forget",
        label: "Memory Forget",
        description: "Delete specific memories. GDPR-compliant.",
        parameters: Type.Object({
          query: Type.Optional(Type.String({ description: "Search to find memory" })),
          memoryId: Type.Optional(Type.String({ description: "Specific memory ID" })),
        }),
        async execute(_toolCallId, params) {
          const { query, memoryId } = params as { query?: string; memoryId?: string };

          if (memoryId) {
            await db.delete(memoryId);
            return {
              content: [{ type: "text", text: `Memory ${memoryId} forgotten.` }],
              details: { action: "deleted", id: memoryId },
            };
          }

          if (query) {
            const vector = await embeddings.embed(query);
            const results = await db.search(vector, 5, 0.7);

            if (results.length === 0) {
              return {
                content: [{ type: "text", text: "No matching memories found." }],
                details: { found: 0 },
              };
            }

            if (results.length === 1 && results[0].score > 0.9) {
              await db.delete(results[0].entry.id);
              return {
                content: [{ type: "text", text: `Forgotten: "${results[0].entry.text}"` }],
                details: { action: "deleted", id: results[0].entry.id },
              };
            }

            const list = results
              .map((r) => `- [${r.entry.id.slice(0, 8)}] ${r.entry.text.slice(0, 60)}...`)
              .join("\n");

            // Strip vector data for serialization
            const sanitizedCandidates = results.map((r) => ({
              id: r.entry.id,
              text: r.entry.text,
              type: r.entry.type,
              category: r.entry.type,
              savedAt: r.entry.savedAt,
              score: r.score,
            }));

            return {
              content: [
                {
                  type: "text",
                  text: `Found ${results.length} candidates. Specify memoryId:\n${list}`,
                },
              ],
              details: { action: "candidates", candidates: sanitizedCandidates },
            };
          }

          return {
            content: [{ type: "text", text: "Provide query or memoryId." }],
            details: { error: "missing_param" },
          };
        },
      },
      { name: "memory_forget" },
    );

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const memory = program.command("ltm").description("LanceDB memory plugin commands");

        memory
          .command("list")
          .description("List memories")
          .action(async () => {
            const count = await db.count();
            console.log(`Total memories: ${count}`);
          });

        memory
          .command("search")
          .description("Search memories")
          .argument("<query>", "Search query")
          .option("--limit <n>", "Max results", "5")
          .action(async (query, opts) => {
            const vector = await embeddings.embed(query);
            const results = await db.search(vector, parseInt(opts.limit), 0.3);
            // Strip vectors for output
            const output = results.map((r) => ({
              id: r.entry.id,
              text: r.entry.text,
              type: r.entry.type,
              importance: r.entry.importance,
              savedAt: r.entry.savedAt,
              score: r.score,
            }));
            console.log(JSON.stringify(output, null, 2));
          });

        memory
          .command("stats")
          .description("Show memory statistics")
          .action(async () => {
            const count = await db.count();
            console.log(`Total memories: ${count}`);
          });
      },
      { commands: ["ltm"] },
    );

    // ========================================================================
    // Lifecycle Hooks
    // ========================================================================

    // Auto-recall: inject relevant memories before agent starts
    if (cfg.autoRecall) {
      api.on("before_agent_start", async (event, ctx) => {
        if (!event.prompt || event.prompt.length < 5) {
          return;
        }
        if (shouldIgnoreMemory({ prompt: event.prompt, messages: event.messages })) {
          api.logger.info?.(
            "memory-lancedb: skipping recall because the user asked to ignore memory",
          );
          return;
        }

        try {
          const vector = await embeddings.embed(event.prompt);
          const results = await db.search(vector, 5, 0.3);

          if (results.length === 0) {
            return;
          }

          const recallViews = await Promise.all(
            results.map(async (result) => ({
              result,
              view: await buildRecallView({
                candidate: result.entry,
                workspaceDir: ctx.workspaceDir,
              }),
            })),
          );
          const recallable = recallViews
            .filter(({ view }) => view.verification.status !== "conflict")
            .slice(0, 3);
          const conflicts = recallViews.filter(
            ({ view }) => view.verification.status === "conflict",
          );
          if (conflicts.length > 0) {
            api.logger.warn(
              `memory-lancedb: skipped ${conflicts.length} conflicting memories that no longer match the workspace`,
            );
          }
          if (recallable.length === 0) {
            return;
          }

          const memoryContext = recallable
            .map(({ result, view }) => `- ${formatRecallLine({ view, score: result.score })}`)
            .join("\n");

          api.logger.info?.(`memory-lancedb: injecting ${recallable.length} memories into context`);

          return {
            prependContext: `<relevant-memories>\nThe following memories may be relevant to this conversation:\n${memoryContext}\n</relevant-memories>`,
          };
        } catch (err) {
          api.logger.warn(`memory-lancedb: recall failed: ${String(err)}`);
        }
      });
    }

    // Auto-capture: analyze and store important information after agent ends
    if (cfg.autoCapture) {
      api.on("agent_end", async (event) => {
        if (!event.success || !event.messages || event.messages.length === 0) {
          return;
        }

        try {
          const texts = extractRecentUserTexts(event.messages, 6);
          const prepared = texts
            .map((text) =>
              prepareMemoryForStorage({
                text,
                sourceRole: "user",
              }),
            )
            .filter((entry): entry is PreparedMemory => entry !== null);
          const uniquePrepared = Array.from(
            new Map(prepared.map((entry) => [entry.text, entry])).values(),
          ).slice(0, 3);
          if (uniquePrepared.length === 0) {
            return;
          }

          let stored = 0;
          for (const entry of uniquePrepared) {
            const result = await storePreparedMemory(entry);
            if (result.action === "created") {
              stored += 1;
            }
          }

          if (stored > 0) {
            api.logger.info(`memory-lancedb: auto-captured ${stored} memories`);
          }
        } catch (err) {
          api.logger.warn(`memory-lancedb: capture failed: ${String(err)}`);
        }
      });
    }

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "memory-lancedb",
      start: () => {
        api.logger.info(
          `memory-lancedb: initialized (db: ${resolvedDbPath}, model: ${cfg.embedding.model})`,
        );
      },
      stop: () => {
        api.logger.info("memory-lancedb: stopped");
      },
    });
  },
};

export default memoryPlugin;
