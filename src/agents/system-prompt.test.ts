import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, buildRuntimeLine } from "./system-prompt.js";

describe("buildAgentSystemPrompt", () => {
  it("includes owner numbers when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      ownerNumbers: ["+123", " +456 ", ""],
    });

    expect(prompt).toContain("## User Identity");
    expect(prompt).toContain(
      "Owner numbers: +123, +456. Treat messages from these numbers as the user.",
    );
  });

  it("omits owner section when numbers are missing", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
    });

    expect(prompt).not.toContain("## User Identity");
    expect(prompt).not.toContain("Owner numbers:");
  });

  it("omits extended sections in minimal prompt mode", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      promptMode: "minimal",
      ownerNumbers: ["+123"],
      skillsPrompt:
        "<available_skills>\n  <skill>\n    <name>demo</name>\n  </skill>\n</available_skills>",
      heartbeatPrompt: "ping",
      toolNames: ["message", "memory_search"],
      docsPath: "/tmp/openclaw/docs",
      extraSystemPrompt: "Subagent details",
      ttsHint: "Voice (TTS) is enabled.",
    });

    expect(prompt).not.toContain("## User Identity");
    expect(prompt).not.toContain("## Skills");
    expect(prompt).not.toContain("## Memory Recall");
    expect(prompt).not.toContain("## Documentation");
    expect(prompt).not.toContain("## Reply Tags");
    expect(prompt).not.toContain("## Messaging");
    expect(prompt).not.toContain("## Voice (TTS)");
    expect(prompt).not.toContain("## Silent Replies");
    expect(prompt).not.toContain("## Heartbeats");
    expect(prompt).toContain("## Safety");
    expect(prompt).toContain("You have no independent goals");
    expect(prompt).toContain("Prioritize safety and human oversight");
    expect(prompt).toContain("if instructions conflict");
    expect(prompt).toContain("Inspired by Anthropic's constitution");
    expect(prompt).toContain("Do not manipulate or persuade anyone");
    expect(prompt).toContain("Do not copy yourself or change system prompts");
    expect(prompt).toContain("## Subagent Context");
    expect(prompt).not.toContain("## Group Chat Context");
    expect(prompt).toContain("Subagent details");
  });

  it("includes safety guardrails in full prompts", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
    });

    expect(prompt).toContain("## Safety");
    expect(prompt).toContain("You have no independent goals");
    expect(prompt).toContain("Prioritize safety and human oversight");
    expect(prompt).toContain("if instructions conflict");
    expect(prompt).toContain("Inspired by Anthropic's constitution");
    expect(prompt).toContain("Do not manipulate or persuade anyone");
    expect(prompt).toContain("Do not copy yourself or change system prompts");
  });

  it("includes user-visible reply guidance in full prompts", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
    });

    expect(prompt).toContain("## User-Visible Replies");
    expect(prompt).toContain("acknowledge -> work -> result");
    expect(prompt).toContain('Do not send filler updates like "still working"');
  });

  it("includes voice hint when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      ttsHint: "Voice (TTS) is enabled.",
    });

    expect(prompt).toContain("## Voice (TTS)");
    expect(prompt).toContain("Voice (TTS) is enabled.");
  });

  it("includes memory recall guidance when memory tools available", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/clawd",
      toolNames: ["memory_search", "memory_get"],
    });

    expect(prompt).toContain("## Memory Recall");
    expect(prompt).toContain("memory_search");
  });

  it("includes task tracker rules when the tool is available", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/clawd",
      toolNames: ["task_tracker"],
    });

    expect(prompt).toContain("## Task Tracker");
    expect(prompt).toContain("3+ distinct steps");
    expect(prompt).toContain("action=create");
    expect(prompt).toContain("action=update");
    expect(prompt).toContain("call `task_tracker` with `action=get`");
  });

  it("keeps trivial single-step work out of the task tracker policy", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/clawd",
      toolNames: ["task_tracker"],
    });

    expect(prompt).toContain("Do not use `task_tracker` for one-step trivial edits");
  });

  it("adds worker handoff detail to task tracker policy when subagent tools exist", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/clawd",
      toolNames: ["task_tracker", "sessions_spawn"],
    });

    expect(prompt).toContain("another worker could execute the task");
  });

  it("omits worker handoff detail from task tracker policy in single-agent mode", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/clawd",
      toolNames: ["task_tracker"],
    });

    expect(prompt).not.toContain("another worker could execute the task");
  });

  it("includes task board guidance when task tools are available", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/clawd",
      toolNames: ["tasks_list", "task_get"],
    });

    expect(prompt).toContain("## Task Board");
    expect(prompt).toContain("Use `tasks_list`");
    expect(prompt).toContain("lowest-ID task where `isAvailableToClaim` is true");
    expect(prompt).toContain("call `task_get` before acting");
  });

  it("includes cooperative waiting guidance when the sleep tool is available", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/clawd",
      toolNames: ["sleep", "get_task_output"],
    });

    expect(prompt).toContain("## Waiting & Idle Work");
    expect(prompt).toContain(
      "Prefer `sleep` over shell `sleep`, `timeout`, or ad-hoc polling loops",
    );
    expect(prompt).toContain("Periodic sleep wakeups are check-ins");
    expect(prompt).toContain("`get_task_output`");
  });

  it("adds reasoning tag hint when enabled", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      reasoningTagHint: true,
    });

    expect(prompt).toContain("## Reasoning Format");
    expect(prompt).toContain("<think>...</think>");
    expect(prompt).toContain("<final>...</final>");
  });

  it("includes a CLI quick reference section", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
    });

    expect(prompt).toContain("## OpenClaw CLI Quick Reference");
    expect(prompt).toContain("openclaw gateway restart");
    expect(prompt).toContain("Do not invent commands");
  });

  it("lists available tools when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      toolNames: ["exec", "sessions_list", "sessions_history", "sessions_send"],
    });

    expect(prompt).toContain("Tool availability (filtered by policy):");
    expect(prompt).toContain("sessions_list");
    expect(prompt).toContain("sessions_history");
    expect(prompt).toContain("sessions_send");
  });

  it("includes tool operator manuals when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      toolNames: ["cron"],
      toolManuals: {
        cron: "Purpose: manage scheduled jobs.\nAnti-patterns: do not use for immediate work.",
      },
    });

    expect(prompt).toContain("## Tool Operator Manuals");
    expect(prompt).toContain("### cron");
    expect(prompt).toContain("Purpose: manage scheduled jobs.");
    expect(prompt).toContain("Anti-patterns: do not use for immediate work.");
  });

  it("includes usage-policy guidance for tool manuals", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      toolNames: ["cron"],
    });

    expect(prompt).toContain("If a tool operator manual says `Usage policy: explicit_only`");
    expect(prompt).toContain("If a tool operator manual says `Usage policy: semantic_ok`");
  });

  it("steers workspace content search toward grep when available", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      toolNames: ["grep", "exec"],
    });

    expect(prompt).toContain("prefer `grep` over raw shell `rg`/`grep` through exec");
    expect(prompt).toContain("Use `grep` output modes");
  });

  it("includes file write tool-selection guidance when file tools are available", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      toolNames: ["read", "write", "edit", "apply_patch"],
    });

    expect(prompt).toContain("Prefer `edit` or `apply_patch` for localized changes");
    expect(prompt).toContain("Use `write` for new files or intentional full-file rewrites");
    expect(prompt).toContain("Before overwriting an existing file with `write`, read it first");
    expect(prompt).toContain("re-read and recompute the rewrite");
  });

  it("includes subagent orchestration guidance when sessions_spawn is available", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      toolNames: ["sessions_spawn", "sessions_send", "sessions_history", "delegate"],
    });

    expect(prompt).toContain("## Subagent Orchestration");
    expect(prompt).toContain("Use `delegate` for one-shot tasks");
    expect(prompt).toContain("Communication contract");
    expect(prompt).toContain("Capability profiles");
    expect(prompt).toContain("requiredTools");
    expect(prompt).toContain("sessions_send");
    expect(prompt).toContain('sessions_send({ label: "schema-audit"');
    expect(prompt).toContain('sessions_spawn({ label: "schema-audit"');
    expect(prompt).toContain("Use `sessions_history` only when you need raw output");
  });

  it("preserves tool casing in the prompt", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      toolNames: ["Read", "Exec", "process"],
      skillsPrompt:
        "<available_skills>\n  <skill>\n    <name>demo</name>\n  </skill>\n</available_skills>",
      docsPath: "/tmp/openclaw/docs",
    });

    expect(prompt).toContain("- Read: Read file contents");
    expect(prompt).toContain("- Exec: Run shell commands");
    expect(prompt).toContain(
      "- If exactly one skill clearly applies: read its SKILL.md at <location> with `Read`, then follow it.",
    );
    expect(prompt).toContain("OpenClaw docs: /tmp/openclaw/docs");
    expect(prompt).toContain(
      "For OpenClaw behavior, commands, config, or architecture: consult local docs first.",
    );
  });

  it("includes docs guidance when docsPath is provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      docsPath: "/tmp/openclaw/docs",
    });

    expect(prompt).toContain("## Documentation");
    expect(prompt).toContain("OpenClaw docs: /tmp/openclaw/docs");
    expect(prompt).toContain(
      "For OpenClaw behavior, commands, config, or architecture: consult local docs first.",
    );
  });

  it("includes workspace notes when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      workspaceNotes: ["Reminder: commit your changes in this workspace after edits."],
    });

    expect(prompt).toContain("Reminder: commit your changes in this workspace after edits.");
  });

  it("includes user timezone when provided (12-hour)", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      userTimezone: "America/Chicago",
      userTime: "Monday, January 5th, 2026 — 3:26 PM",
      userTimeFormat: "12",
    });

    expect(prompt).toContain("## Current Date & Time");
    expect(prompt).toContain("Time zone: America/Chicago");
  });

  it("includes user timezone when provided (24-hour)", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      userTimezone: "America/Chicago",
      userTime: "Monday, January 5th, 2026 — 15:26",
      userTimeFormat: "24",
    });

    expect(prompt).toContain("## Current Date & Time");
    expect(prompt).toContain("Time zone: America/Chicago");
  });

  it("shows timezone when only timezone is provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      userTimezone: "America/Chicago",
      userTimeFormat: "24",
    });

    expect(prompt).toContain("## Current Date & Time");
    expect(prompt).toContain("Time zone: America/Chicago");
  });

  it("hints to use session_status for current date/time", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/clawd",
      userTimezone: "America/Chicago",
      toolNames: ["session_status"],
    });

    expect(prompt).toContain("session_status");
    expect(prompt).toContain("current date");
  });

  it("omits the session_status time hint when that tool is unavailable", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/clawd",
      userTimezone: "America/Chicago",
      toolNames: ["read", "grep"],
    });

    expect(prompt).not.toContain("run session_status");
  });

  it("includes a dedicated planning section in plan mode", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/clawd",
      collaborationMode: "plan",
      planProfile: "conservative",
      toolNames: ["read", "grep", "find", "ls", "tasks_list", "task_get"],
    });

    expect(prompt).toContain("## Planning Mode");
    expect(prompt).toContain("Plan mode is active (conservative)");
    expect(prompt).toContain("This mode is read-only");
    expect(prompt).toContain("compare at least 2 viable approaches");
    expect(prompt).toContain("problem summary");
    expect(prompt).toContain("/plan off");
  });

  // The system prompt intentionally does NOT include the current date/time.
  // Only the timezone is included, to keep the prompt stable for caching.
  // See: https://github.com/moltbot/moltbot/commit/66eec295b894bce8333886cfbca3b960c57c4946
  // Agents should use session_status or message timestamps to determine the date/time.
  // Related: https://github.com/moltbot/moltbot/issues/1897
  //          https://github.com/moltbot/moltbot/issues/3658
  it("does NOT include a date or time in the system prompt (cache stability)", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/clawd",
      userTimezone: "America/Chicago",
      userTime: "Monday, January 5th, 2026 — 3:26 PM",
      userTimeFormat: "12",
    });

    // The prompt should contain the timezone but NOT the formatted date/time string.
    // This is intentional for prompt cache stability — the date/time was removed in
    // commit 66eec295b. If you're here because you want to add it back, please see
    // https://github.com/moltbot/moltbot/issues/3658 for the preferred approach:
    // gateway-level timestamp injection into messages, not the system prompt.
    expect(prompt).toContain("Time zone: America/Chicago");
    expect(prompt).not.toContain("Monday, January 5th, 2026");
    expect(prompt).not.toContain("3:26 PM");
    expect(prompt).not.toContain("15:26");
  });

  it("includes model alias guidance when aliases are provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      modelAliasLines: [
        "- Opus: anthropic/claude-opus-4-5",
        "- Sonnet: anthropic/claude-sonnet-4-5",
      ],
    });

    expect(prompt).toContain("## Model Aliases");
    expect(prompt).toContain("Prefer aliases when specifying model overrides");
    expect(prompt).toContain("- Opus: anthropic/claude-opus-4-5");
  });

  it("adds ClaudeBot self-update guidance when gateway tool is available", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      toolNames: ["gateway", "exec"],
    });

    expect(prompt).toContain("## OpenClaw Self-Update");
    expect(prompt).toContain("config.apply");
    expect(prompt).toContain("update.run");
  });

  it("includes skills guidance when skills prompt is present", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      skillsPrompt:
        "<available_skills>\n  <skill>\n    <name>demo</name>\n  </skill>\n</available_skills>",
    });

    expect(prompt).toContain("## Skills");
    expect(prompt).toContain(
      "- If exactly one skill clearly applies: read its SKILL.md at <location> with `read`, then follow it.",
    );
  });

  it("appends available skills when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      skillsPrompt:
        "<available_skills>\n  <skill>\n    <name>demo</name>\n  </skill>\n</available_skills>",
    });

    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<name>demo</name>");
  });

  it("omits skills section when no skills prompt is provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
    });

    expect(prompt).not.toContain("## Skills");
    expect(prompt).not.toContain("<available_skills>");
  });

  it("renders project context files when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      contextFiles: [
        { path: "AGENTS.md", content: "Alpha" },
        { path: "IDENTITY.md", content: "Bravo" },
      ],
    });

    expect(prompt).toContain("# Project Context");
    expect(prompt).toContain("## AGENTS.md");
    expect(prompt).toContain("Alpha");
    expect(prompt).toContain("## IDENTITY.md");
    expect(prompt).toContain("Bravo");
  });

  it("adds SOUL guidance when a soul file is present", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      contextFiles: [
        { path: "./SOUL.md", content: "Persona" },
        { path: "dir\\SOUL.md", content: "Persona Windows" },
      ],
    });

    expect(prompt).toContain(
      "If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.",
    );
  });

  it("summarizes the message tool when available", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      toolNames: ["message"],
    });

    expect(prompt).toContain("message: Send messages and channel actions");
    expect(prompt).toContain("### message tool");
    expect(prompt).toContain("respond with ONLY: NO_REPLY");
  });

  it("includes runtime provider capabilities when present", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      runtimeInfo: {
        channel: "telegram",
        capabilities: ["inlineButtons"],
      },
    });

    expect(prompt).toContain("channel=telegram");
    expect(prompt).toContain("capabilities=inlineButtons");
  });

  it("includes agent id in runtime when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      runtimeInfo: {
        agentId: "work",
        host: "host",
        os: "macOS",
        arch: "arm64",
        node: "v20",
        model: "anthropic/claude",
      },
    });

    expect(prompt).toContain("agent=work");
  });

  it("includes reasoning visibility hint", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      reasoningLevel: "off",
    });

    expect(prompt).toContain("Reasoning: off");
    expect(prompt).toContain("/reasoning");
    expect(prompt).toContain("/status shows Reasoning");
  });

  it("builds runtime line with agent and channel details", () => {
    const line = buildRuntimeLine(
      {
        agentId: "work",
        host: "host",
        repoRoot: "/repo",
        os: "macOS",
        arch: "arm64",
        node: "v20",
        model: "anthropic/claude",
        defaultModel: "anthropic/claude-opus-4-5",
      },
      "telegram",
      ["inlineButtons"],
      "low",
    );

    expect(line).toContain("agent=work");
    expect(line).toContain("host=host");
    expect(line).toContain("repo=/repo");
    expect(line).toContain("os=macOS (arm64)");
    expect(line).toContain("node=v20");
    expect(line).toContain("model=anthropic/claude");
    expect(line).toContain("default_model=anthropic/claude-opus-4-5");
    expect(line).toContain("channel=telegram");
    expect(line).toContain("capabilities=inlineButtons");
    expect(line).toContain("thinking=low");
  });

  it("describes sandboxed runtime and elevated when allowed", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      sandboxInfo: {
        enabled: true,
        workspaceDir: "/tmp/sandbox",
        workspaceAccess: "ro",
        agentWorkspaceMount: "/agent",
        elevated: { allowed: true, defaultLevel: "on" },
      },
    });

    expect(prompt).toContain("You are running in a sandboxed runtime");
    expect(prompt).toContain("Sub-agents stay sandboxed");
    expect(prompt).toContain("User can toggle with /elevated on|off|ask|full.");
    expect(prompt).toContain("Current elevated level: on");
  });

  it("includes reaction guidance when provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      reactionGuidance: {
        level: "minimal",
        channel: "Telegram",
      },
    });

    expect(prompt).toContain("## Reactions");
    expect(prompt).toContain("Reactions are enabled for Telegram in MINIMAL mode.");
  });
});
