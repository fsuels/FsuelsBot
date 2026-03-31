import { describe, expect, it } from "vitest";
import { resolveSkillDefinitionMetadata, resolveSkillInvocationPolicy } from "./frontmatter.js";

describe("resolveSkillInvocationPolicy", () => {
  it("defaults to enabled behaviors", () => {
    const policy = resolveSkillInvocationPolicy({});
    expect(policy.userInvocable).toBe(true);
    expect(policy.disableModelInvocation).toBe(false);
  });

  it("parses frontmatter boolean strings", () => {
    const policy = resolveSkillInvocationPolicy({
      "user-invocable": "no",
      "disable-model-invocation": "yes",
    });
    expect(policy.userInvocable).toBe(false);
    expect(policy.disableModelInvocation).toBe(true);
  });
});

describe("resolveSkillDefinitionMetadata", () => {
  it("parses aliases and richer definition metadata from frontmatter", () => {
    const definition = resolveSkillDefinitionMetadata({
      aliases: '["docs", "reference"]',
      "when-to-use": "When the user asks for product docs.",
      "argument-hint": "<topic>",
      arguments: '["topic", "section"]',
      "allowed-tools": "read, grep",
      model: "openai/gpt-5.4",
      effort: "high",
      context: "fork",
      agent: "docs-specialist",
      paths: '["docs/**/*.md", "*.mdx"]',
    });

    expect(definition).toEqual({
      aliases: ["docs", "reference"],
      whenToUse: "When the user asks for product docs.",
      argumentHint: "<topic>",
      arguments: ["topic", "section"],
      allowedTools: ["read", "grep"],
      model: "openai/gpt-5.4",
      effort: "high",
      context: "fork",
      agent: "docs-specialist",
      pathFilters: ["docs/**/*.md", "*.mdx"],
    });
  });
});
