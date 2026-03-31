import { describe, expect, it, vi } from "vitest";
import { makePrompter } from "../commands/onboarding/__tests__/test-utils.js";
import { WizardCancelledError } from "../wizard/prompts.js";
import {
  applyPluginConfigStepValue,
  buildPluginConfigSteps,
  runPluginConfigWizard,
  type PluginConfigDescriptor,
  type PluginConfigStep,
} from "./configure-wizard.js";

const descriptorWithRequiredFields: PluginConfigDescriptor = {
  pluginId: "memory-lancedb",
  name: "Memory LanceDB",
  configUiHints: {
    "embedding.apiKey": {
      label: "OpenAI API Key",
      sensitive: true,
      placeholder: "sk-proj-...",
    },
    retryCount: {
      label: "Retry Count",
    },
    advancedField: {
      label: "Advanced Field",
      advanced: true,
    },
  },
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      embedding: {
        type: "object",
        additionalProperties: false,
        properties: {
          apiKey: { type: "string" },
        },
        required: ["apiKey"],
      },
      retryCount: {
        type: "integer",
        minimum: 1,
      },
      advancedField: {
        type: "string",
      },
    },
    required: ["embedding", "retryCount"],
  },
};

describe("plugin configure wizard", () => {
  it("skips when no required config is missing", async () => {
    const result = await runPluginConfigWizard({
      config: {},
      pluginId: "memory-core",
      prompter: makePrompter(),
      mode: "required",
      descriptor: {
        pluginId: "memory-core",
        name: "Memory Core",
        configSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    });

    expect(result.status).toBe("skipped");
    expect(result.message).toContain("No required plugin configuration");
  });

  it("progresses through multiple required fields", async () => {
    const text = vi.fn().mockResolvedValueOnce("sk-test").mockResolvedValueOnce("3");
    const prompter = makePrompter({ text });

    const result = await runPluginConfigWizard({
      config: {},
      pluginId: descriptorWithRequiredFields.pluginId,
      prompter,
      mode: "required",
      descriptor: descriptorWithRequiredFields,
    });

    expect(result.status).toBe("configured");
    if (result.status !== "configured") {
      return;
    }
    expect(result.stepsCompleted).toBe(2);
    expect(result.config.plugins?.entries?.["memory-lancedb"]?.config).toEqual({
      embedding: { apiKey: "sk-test" },
      retryCount: 3,
    });
  });

  it("treats cancellation as a skipped result", async () => {
    const prompter = makePrompter({
      text: vi.fn(async () => {
        throw new WizardCancelledError();
      }),
    });

    const result = await runPluginConfigWizard({
      config: {},
      pluginId: descriptorWithRequiredFields.pluginId,
      prompter,
      mode: "required",
      descriptor: descriptorWithRequiredFields,
    });

    expect(result.status).toBe("skipped");
    expect(result.message).toContain("cancelled");
  });

  it("returns an error when the plugin cannot be resolved", async () => {
    const result = await runPluginConfigWizard({
      config: {},
      pluginId: "missing-plugin",
      prompter: makePrompter(),
      mode: "guided",
    });

    expect(result.status).toBe("error");
    expect(result.message).toContain("Plugin not found");
  });

  it("preserves existing sensitive values when the prompt is left blank", () => {
    const step: PluginConfigStep = {
      key: "embedding.apiKey",
      path: ["embedding", "apiKey"],
      title: "OpenAI API Key",
      schema: { type: "string" },
      sensitive: true,
      required: true,
      advanced: false,
      currentValue: "existing-secret",
    };

    const result = applyPluginConfigStepValue({
      currentConfig: {
        embedding: {
          apiKey: "existing-secret",
        },
      },
      step,
      input: "",
    });

    expect(result.wrote).toBe(false);
    expect(result.nextConfig).toEqual({
      embedding: {
        apiKey: "existing-secret",
      },
    });
  });

  it("does not coerce blank numeric input to zero", () => {
    const step: PluginConfigStep = {
      key: "retryCount",
      path: ["retryCount"],
      title: "Retry Count",
      schema: { type: "integer", minimum: 1 },
      sensitive: false,
      required: false,
      advanced: false,
    };

    const result = applyPluginConfigStepValue({
      currentConfig: {},
      step,
      input: "",
    });

    expect(result.wrote).toBe(false);
    expect(result.nextConfig).toEqual({});
  });

  it("omits advanced fields from guided mode unless requested", () => {
    const steps = buildPluginConfigSteps({
      descriptor: descriptorWithRequiredFields,
      existingConfig: {},
      mode: "guided",
    });

    expect(steps.map((step) => step.key)).toContain("embedding.apiKey");
    expect(steps.map((step) => step.key)).toContain("retryCount");
    expect(steps.map((step) => step.key)).not.toContain("advancedField");
  });
});
