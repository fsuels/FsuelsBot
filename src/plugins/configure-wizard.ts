import type { OpenClawConfig } from "../config/config.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import type { PluginConfigUiHint } from "./types.js";
import { WizardCancelledError } from "../wizard/prompts.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";

type JsonSchemaObject = Record<string, unknown>;

type SupportedFieldType = "string" | "integer" | "number" | "boolean" | "string[]";

type SupportedFieldSchema = {
  type: SupportedFieldType;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
};

export type PluginConfigWizardMode = "required" | "guided";

export type PluginConfigDescriptor = {
  pluginId: string;
  name?: string;
  configSchema?: Record<string, unknown>;
  configUiHints?: Record<string, PluginConfigUiHint>;
};

export type PluginConfigStep = {
  key: string;
  path: string[];
  title: string;
  subtitle?: string;
  schema: SupportedFieldSchema;
  sensitive: boolean;
  required: boolean;
  advanced: boolean;
  placeholder?: string;
  currentValue?: unknown;
};

export type PluginConfigWizardResult =
  | {
      status: "configured";
      config: OpenClawConfig;
      stepsCompleted: number;
      message: string;
    }
  | {
      status: "skipped";
      config: OpenClawConfig;
      message: string;
    }
  | {
      status: "error";
      config: OpenClawConfig;
      message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cloneRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return value ? structuredClone(value) : {};
}

function asSchemaObject(value: unknown): JsonSchemaObject | null {
  return isRecord(value) ? value : null;
}

function normalizeEnum(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function resolveSupportedFieldSchema(value: unknown): SupportedFieldSchema | null {
  const schema = asSchemaObject(value);
  if (!schema) {
    return null;
  }
  const type = typeof schema.type === "string" ? schema.type : "";
  if (type === "string") {
    return {
      type,
      enum: normalizeEnum(schema.enum),
      pattern: typeof schema.pattern === "string" ? schema.pattern : undefined,
    };
  }
  if (type === "integer" || type === "number") {
    return {
      type,
      minimum: typeof schema.minimum === "number" ? schema.minimum : undefined,
      maximum: typeof schema.maximum === "number" ? schema.maximum : undefined,
    };
  }
  if (type === "boolean") {
    return { type };
  }
  if (type === "array") {
    const items = asSchemaObject(schema.items);
    if (items?.type === "string") {
      return { type: "string[]" };
    }
  }
  return null;
}

function formatPathSegmentLabel(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());
}

function getPathValue(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function setPathValue(
  value: Record<string, unknown>,
  path: string[],
  nextValue: unknown,
): Record<string, unknown> {
  if (path.length === 0) {
    return value;
  }
  const [head, ...rest] = path;
  const existingChild = isRecord(value[head]) ? value[head] : {};
  if (rest.length === 0) {
    return {
      ...value,
      [head]: nextValue,
    };
  }
  return {
    ...value,
    [head]: setPathValue(existingChild, rest, nextValue),
  };
}

function buildStepTitle(
  path: string[],
  uiHints: Record<string, PluginConfigUiHint> | undefined,
): { title: string; hint?: PluginConfigUiHint } {
  const key = path.join(".");
  const hint = uiHints?.[key];
  return {
    title: hint?.label?.trim() || formatPathSegmentLabel(path[path.length - 1] ?? "Config"),
    hint,
  };
}

function collectPluginConfigStepsFromSchema(params: {
  schema: Record<string, unknown>;
  uiHints?: Record<string, PluginConfigUiHint>;
  existingConfig?: Record<string, unknown>;
  mode: PluginConfigWizardMode;
  includeAdvanced?: boolean;
}): PluginConfigStep[] {
  const steps: PluginConfigStep[] = [];

  const visit = (
    schemaValue: unknown,
    path: string[],
    required: boolean,
    existingValue: unknown,
  ) => {
    const schema = asSchemaObject(schemaValue);
    if (!schema) {
      return;
    }

    const fieldSchema = resolveSupportedFieldSchema(schema);
    if (fieldSchema) {
      const { title, hint } = buildStepTitle(path, params.uiHints);
      const advanced = hint?.advanced === true;
      const includeStep =
        params.mode === "guided"
          ? params.includeAdvanced === true || !advanced || required
          : required && existingValue === undefined;
      if (!includeStep) {
        return;
      }
      if (params.mode === "required" && existingValue !== undefined) {
        return;
      }
      steps.push({
        key: path.join("."),
        path,
        title,
        subtitle: hint?.help?.trim(),
        schema: fieldSchema,
        sensitive: hint?.sensitive === true,
        required,
        advanced,
        placeholder: hint?.placeholder?.trim() || undefined,
        currentValue: existingValue,
      });
      return;
    }

    if (schema.type !== "object") {
      return;
    }

    const properties = asSchemaObject(schema.properties);
    if (!properties) {
      return;
    }

    const requiredKeys = new Set(
      Array.isArray(schema.required)
        ? schema.required
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter(Boolean)
        : [],
    );

    for (const [key, childSchema] of Object.entries(properties)) {
      const childPath = [...path, key];
      const childRequired = requiredKeys.has(key);
      const childExisting = getPathValue(params.existingConfig, childPath);
      const shouldDescend =
        params.mode === "guided" ||
        childRequired ||
        (isRecord(existingValue) && Object.prototype.hasOwnProperty.call(existingValue, key));
      if (!shouldDescend) {
        continue;
      }
      visit(childSchema, childPath, childRequired, childExisting);
    }
  };

  visit(params.schema, [], false, params.existingConfig);
  return steps;
}

function validateTextStepInput(step: PluginConfigStep, rawValue: string): string | undefined {
  const trimmed = rawValue.trim();
  if (trimmed === "") {
    if (step.required && step.currentValue === undefined) {
      return "Value required";
    }
    return undefined;
  }

  if (step.schema.type === "integer") {
    if (!/^-?\d+$/.test(trimmed)) {
      return "Enter an integer";
    }
    const value = Number.parseInt(trimmed, 10);
    if (step.schema.minimum !== undefined && value < step.schema.minimum) {
      return `Must be at least ${step.schema.minimum}`;
    }
    if (step.schema.maximum !== undefined && value > step.schema.maximum) {
      return `Must be at most ${step.schema.maximum}`;
    }
  }

  if (step.schema.type === "number") {
    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      return "Enter a number";
    }
    if (step.schema.minimum !== undefined && value < step.schema.minimum) {
      return `Must be at least ${step.schema.minimum}`;
    }
    if (step.schema.maximum !== undefined && value > step.schema.maximum) {
      return `Must be at most ${step.schema.maximum}`;
    }
  }

  if (step.schema.type === "string" && step.schema.pattern) {
    const pattern = new RegExp(step.schema.pattern);
    if (!pattern.test(trimmed)) {
      return "Value does not match the required format";
    }
  }

  return undefined;
}

function formatInitialValue(step: PluginConfigStep): string | undefined {
  if (step.sensitive) {
    return undefined;
  }
  if (typeof step.currentValue === "string") {
    return step.currentValue;
  }
  if (typeof step.currentValue === "number") {
    return String(step.currentValue);
  }
  if (Array.isArray(step.currentValue)) {
    return step.currentValue
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
      .join(", ");
  }
  return undefined;
}

function resolveTextPlaceholder(step: PluginConfigStep): string | undefined {
  if (step.sensitive && step.currentValue !== undefined) {
    return "Leave blank to keep current";
  }
  return step.placeholder;
}

function applyResolvedValue(
  step: PluginConfigStep,
  rawValue: unknown,
): { shouldWrite: boolean; value?: unknown } {
  if (step.schema.type === "boolean") {
    if (typeof rawValue !== "boolean") {
      return { shouldWrite: false };
    }
    if (rawValue === step.currentValue) {
      return { shouldWrite: false };
    }
    return { shouldWrite: true, value: rawValue };
  }

  const textValue = typeof rawValue === "string" ? rawValue.trim() : "";
  if (textValue === "") {
    if (step.currentValue !== undefined) {
      return { shouldWrite: false };
    }
    return { shouldWrite: false };
  }

  if (step.schema.type === "integer") {
    return { shouldWrite: true, value: Number.parseInt(textValue, 10) };
  }
  if (step.schema.type === "number") {
    return { shouldWrite: true, value: Number(textValue) };
  }
  if (step.schema.type === "string[]") {
    return {
      shouldWrite: true,
      value: textValue
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    };
  }
  return { shouldWrite: true, value: textValue };
}

export function buildPluginConfigSteps(params: {
  descriptor: PluginConfigDescriptor;
  existingConfig?: Record<string, unknown>;
  mode: PluginConfigWizardMode;
  includeAdvanced?: boolean;
}): PluginConfigStep[] {
  if (!params.descriptor.configSchema) {
    return [];
  }
  return collectPluginConfigStepsFromSchema({
    schema: params.descriptor.configSchema,
    uiHints: params.descriptor.configUiHints,
    existingConfig: params.existingConfig,
    mode: params.mode,
    includeAdvanced: params.includeAdvanced,
  });
}

export function applyPluginConfigStepValue(params: {
  currentConfig?: Record<string, unknown>;
  step: PluginConfigStep;
  input: unknown;
}): { nextConfig: Record<string, unknown>; wrote: boolean } {
  const base = cloneRecord(params.currentConfig);
  const resolved = applyResolvedValue(params.step, params.input);
  if (!resolved.shouldWrite) {
    return { nextConfig: base, wrote: false };
  }
  return {
    nextConfig: setPathValue(base, params.step.path, resolved.value),
    wrote: true,
  };
}

async function promptForStep(
  prompter: WizardPrompter,
  step: PluginConfigStep,
  pluginLabel: string,
) {
  const message = `${pluginLabel}: ${step.title}`;
  if (step.schema.type === "boolean") {
    return await prompter.confirm({
      message,
      initialValue: typeof step.currentValue === "boolean" ? step.currentValue : false,
    });
  }
  if (step.schema.enum && step.schema.enum.length > 0) {
    return await prompter.select<string>({
      message,
      options: step.schema.enum.map((value) => ({ value, label: value })),
      initialValue:
        typeof step.currentValue === "string" && step.schema.enum.includes(step.currentValue)
          ? step.currentValue
          : step.schema.enum[0],
    });
  }
  return await prompter.text({
    message,
    initialValue: formatInitialValue(step),
    placeholder: resolveTextPlaceholder(step),
    validate: (value) => validateTextStepInput(step, value),
  });
}

function resolvePluginDescriptor(params: {
  config: OpenClawConfig;
  pluginId: string;
  workspaceDir?: string;
  descriptor?: PluginConfigDescriptor;
}): PluginConfigDescriptor | null {
  if (params.descriptor) {
    return params.descriptor;
  }
  const registry = loadPluginManifestRegistry({
    config: params.config,
    workspaceDir: params.workspaceDir,
    cache: false,
  });
  const plugin = registry.plugins.find((entry) => entry.id === params.pluginId);
  if (!plugin) {
    return null;
  }
  return {
    pluginId: plugin.id,
    name: plugin.name,
    configSchema: plugin.configSchema,
    configUiHints: plugin.configUiHints,
  };
}

export async function runPluginConfigWizard(params: {
  config: OpenClawConfig;
  pluginId: string;
  prompter: WizardPrompter;
  mode: PluginConfigWizardMode;
  includeAdvanced?: boolean;
  workspaceDir?: string;
  descriptor?: PluginConfigDescriptor;
}): Promise<PluginConfigWizardResult> {
  const descriptor = resolvePluginDescriptor(params);
  if (!descriptor) {
    return {
      status: "error",
      config: params.config,
      message: `Plugin not found: ${params.pluginId}`,
    };
  }

  const pluginLabel = descriptor.name?.trim() || descriptor.pluginId;
  const existingConfig = isRecord(params.config.plugins?.entries?.[descriptor.pluginId]?.config)
    ? (params.config.plugins?.entries?.[descriptor.pluginId]?.config as Record<string, unknown>)
    : undefined;

  const steps = buildPluginConfigSteps({
    descriptor,
    existingConfig,
    mode: params.mode,
    includeAdvanced: params.includeAdvanced,
  });

  if (steps.length === 0) {
    return {
      status: "skipped",
      config: params.config,
      message:
        params.mode === "required"
          ? `No required plugin configuration is missing for "${pluginLabel}".`
          : `No configurable plugin fields found for "${pluginLabel}".`,
    };
  }

  await params.prompter.note(
    `${pluginLabel} has ${steps.length} ${steps.length === 1 ? "field" : "fields"} to review.`,
    params.mode === "required" ? "Plugin setup" : "Plugin config",
  );

  let pluginConfig = cloneRecord(existingConfig);
  let wrote = false;

  try {
    for (const step of steps) {
      const input = await promptForStep(params.prompter, step, pluginLabel);
      const applied = applyPluginConfigStepValue({
        currentConfig: pluginConfig,
        step,
        input,
      });
      pluginConfig = applied.nextConfig;
      wrote ||= applied.wrote;
    }
  } catch (err) {
    if (err instanceof WizardCancelledError) {
      return {
        status: "skipped",
        config: params.config,
        message: `Plugin configuration cancelled for "${pluginLabel}".`,
      };
    }
    return {
      status: "error",
      config: params.config,
      message: `Failed to configure plugin "${pluginLabel}": ${String(err)}`,
    };
  }

  if (!wrote) {
    return {
      status: "skipped",
      config: params.config,
      message: `No plugin config changes applied for "${pluginLabel}".`,
    };
  }

  return {
    status: "configured",
    config: {
      ...params.config,
      plugins: {
        ...params.config.plugins,
        entries: {
          ...params.config.plugins?.entries,
          [descriptor.pluginId]: {
            ...(params.config.plugins?.entries?.[descriptor.pluginId] as
              | Record<string, unknown>
              | undefined),
            config: pluginConfig,
          },
        },
      },
    },
    stepsCompleted: steps.length,
    message: `Configured plugin "${pluginLabel}".`,
  };
}
