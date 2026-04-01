import {
  INVALID_STRICT_PRIMITIVE,
  parseBooleanStrict,
  parseIntegerStrict,
  parseNumberStrict,
} from "../utils/strict-primitives.js";

type JsonSchemaObject = Record<string, unknown>;

export type EnumOption = {
  value: string;
  label: string;
};

export type SupportedStringFormat = "email" | "uri" | "url" | "date" | "date-time";

export type SupportedFieldSchema =
  | {
      type: "string";
      format?: SupportedStringFormat;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
    }
  | {
      type: "integer";
      minimum?: number;
      maximum?: number;
    }
  | {
      type: "number";
      minimum?: number;
      maximum?: number;
    }
  | {
      type: "boolean";
    }
  | {
      type: "enum";
      options: EnumOption[];
    }
  | {
      type: "multi-select-enum";
      options: EnumOption[];
      minItems?: number;
      maxItems?: number;
      uniqueItems?: boolean;
    }
  | {
      type: "string[]";
      minItems?: number;
      maxItems?: number;
      uniqueItems?: boolean;
    };

export type SchemaValidationResult =
  | {
      isValid: true;
      value: unknown;
    }
  | {
      isValid: false;
      error: string;
    };

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRecord(value: unknown): value is JsonSchemaObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asSchemaObject(value: unknown): JsonSchemaObject | null {
  return isRecord(value) ? value : null;
}

function readNumericConstraint(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function buildEnumOptionsFromEntries(entries: unknown[]): EnumOption[] | undefined {
  const options = entries
    .map((entry) => {
      const schema = asSchemaObject(entry);
      if (!schema) {
        return null;
      }
      const constValue =
        typeof schema.const === "string"
          ? schema.const.trim()
          : Array.isArray(schema.enum) &&
              schema.enum.length === 1 &&
              typeof schema.enum[0] === "string"
            ? schema.enum[0].trim()
            : "";
      if (!constValue) {
        return null;
      }
      const label =
        typeof schema.title === "string" && schema.title.trim()
          ? schema.title.trim()
          : typeof schema.description === "string" && schema.description.trim()
            ? schema.description.trim()
            : constValue;
      return { value: constValue, label };
    })
    .filter((entry): entry is EnumOption => Boolean(entry));
  return options.length > 0 ? options : undefined;
}

function extractEnumOptions(schema: JsonSchemaObject): EnumOption[] | undefined {
  const directEnum = normalizeStringList(schema.enum);
  if (directEnum) {
    return directEnum.map((value) => ({ value, label: value }));
  }
  const unionEntries = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : undefined;
  if (!unionEntries) {
    return undefined;
  }
  return buildEnumOptionsFromEntries(unionEntries);
}

function joinSentences(parts: Array<string | undefined>): string | undefined {
  const filtered = parts.map((part) => part?.trim()).filter(Boolean);
  return filtered.length > 0 ? filtered.join(" ") : undefined;
}

function formatOptionLabels(options: EnumOption[]): string {
  return options.map((option) => option.label).join(", ");
}

function formatLengthHint(
  schema: Extract<SupportedFieldSchema, { type: "string" }>,
): string | undefined {
  if (schema.minLength !== undefined && schema.maxLength !== undefined) {
    return `Enter ${schema.minLength}-${schema.maxLength} characters.`;
  }
  if (schema.minLength !== undefined) {
    return `Enter at least ${schema.minLength} characters.`;
  }
  if (schema.maxLength !== undefined) {
    return `Enter at most ${schema.maxLength} characters.`;
  }
  return undefined;
}

function formatNumericHint(
  schema: Extract<SupportedFieldSchema, { type: "integer" | "number" }>,
): string | undefined {
  const noun = schema.type === "integer" ? "integer" : "number";
  if (schema.minimum !== undefined && schema.maximum !== undefined) {
    return `Enter a ${noun} between ${schema.minimum} and ${schema.maximum}.`;
  }
  if (schema.minimum !== undefined) {
    return `Enter a ${noun} of at least ${schema.minimum}.`;
  }
  if (schema.maximum !== undefined) {
    return `Enter a ${noun} of at most ${schema.maximum}.`;
  }
  return `Enter a ${noun}.`;
}

function formatItemsHint(
  schema: Extract<SupportedFieldSchema, { type: "multi-select-enum" | "string[]" }>,
) {
  if (schema.minItems !== undefined && schema.maxItems !== undefined) {
    return `Choose ${schema.minItems}-${schema.maxItems} items.`;
  }
  if (schema.minItems !== undefined) {
    return `Choose at least ${schema.minItems} items.`;
  }
  if (schema.maxItems !== undefined) {
    return `Choose at most ${schema.maxItems} items.`;
  }
  return undefined;
}

function formatRangeError(params: {
  minimum?: number;
  maximum?: number;
  noun?: string;
}): string | undefined {
  const noun = params.noun?.trim() || "value";
  if (params.minimum !== undefined && params.maximum !== undefined) {
    return `Must be between ${params.minimum} and ${params.maximum}${noun === "value" ? "" : ` ${noun}`}.`;
  }
  if (params.minimum !== undefined) {
    return `Must be at least ${params.minimum}${noun === "value" ? "" : ` ${noun}`}.`;
  }
  if (params.maximum !== undefined) {
    return `Must be at most ${params.maximum}${noun === "value" ? "" : ` ${noun}`}.`;
  }
  return undefined;
}

function formatItemsError(params: { minItems?: number; maxItems?: number }): string | undefined {
  if (params.minItems !== undefined && params.maxItems !== undefined) {
    return `Choose between ${params.minItems} and ${params.maxItems} items.`;
  }
  if (params.minItems !== undefined) {
    return `Choose at least ${params.minItems} items.`;
  }
  if (params.maxItems !== undefined) {
    return `Choose at most ${params.maxItems} items.`;
  }
  return undefined;
}

function validateIsoDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
  );
}

function validateIsoDateTime(value: string): boolean {
  return ISO_DATE_TIME_RE.test(value) && Number.isFinite(Date.parse(value));
}

function validateStringFormat(
  value: string,
  format: SupportedStringFormat | undefined,
): string | undefined {
  if (!format) {
    return undefined;
  }
  if (format === "email") {
    return SIMPLE_EMAIL_RE.test(value) ? undefined : "Enter a valid email address.";
  }
  if (format === "uri" || format === "url") {
    try {
      const parsed = new URL(value);
      return parsed.protocol ? undefined : "Enter a valid URL.";
    } catch {
      return "Enter a valid URL.";
    }
  }
  if (format === "date") {
    return validateIsoDate(value) ? undefined : "Use YYYY-MM-DD.";
  }
  if (format === "date-time") {
    return validateIsoDateTime(value)
      ? undefined
      : "Use ISO 8601 date-time, for example 2026-03-31T15:00:00Z.";
  }
  return undefined;
}

function matchEnumOption(raw: string, options: EnumOption[]): EnumOption | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return (
    options.find((option) => option.value === trimmed) ??
    options.find((option) => option.label === trimmed)
  );
}

function parseStringList(raw: unknown): string[] | null {
  if (Array.isArray(raw)) {
    const values = raw
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
    return values;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return [];
    }
    return trimmed
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return null;
}

function validateStringValue(
  raw: unknown,
  schema: Extract<SupportedFieldSchema, { type: "string" }>,
): SchemaValidationResult {
  if (typeof raw !== "string") {
    return { isValid: false, error: "Enter text." };
  }
  const value = raw.trim();
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    return {
      isValid: false,
      error: formatRangeError({
        minimum: schema.minLength,
        maximum: schema.maxLength,
        noun: "characters",
      })!,
    };
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    return {
      isValid: false,
      error: formatRangeError({
        minimum: schema.minLength,
        maximum: schema.maxLength,
        noun: "characters",
      })!,
    };
  }
  const formatError = validateStringFormat(value, schema.format);
  if (formatError) {
    return { isValid: false, error: formatError };
  }
  if (schema.pattern) {
    const pattern = new RegExp(schema.pattern);
    if (!pattern.test(value)) {
      return { isValid: false, error: "Value does not match the required format." };
    }
  }
  return { isValid: true, value };
}

function validateNumericValue(
  raw: unknown,
  schema: Extract<SupportedFieldSchema, { type: "integer" | "number" }>,
): SchemaValidationResult {
  const parsed = schema.type === "integer" ? parseIntegerStrict(raw) : parseNumberStrict(raw);
  if (parsed === INVALID_STRICT_PRIMITIVE) {
    return {
      isValid: false,
      error: schema.type === "integer" ? "Enter an integer." : "Enter a number.",
    };
  }
  if (schema.minimum !== undefined && parsed < schema.minimum) {
    return {
      isValid: false,
      error: formatRangeError({ minimum: schema.minimum, maximum: schema.maximum })!,
    };
  }
  if (schema.maximum !== undefined && parsed > schema.maximum) {
    return {
      isValid: false,
      error: formatRangeError({ minimum: schema.minimum, maximum: schema.maximum })!,
    };
  }
  return { isValid: true, value: parsed };
}

function validateEnumValue(
  raw: unknown,
  schema: Extract<SupportedFieldSchema, { type: "enum" }>,
): SchemaValidationResult {
  if (typeof raw !== "string") {
    return {
      isValid: false,
      error: `Choose one of: ${formatOptionLabels(schema.options)}.`,
    };
  }
  const match = matchEnumOption(raw, schema.options);
  if (!match) {
    return {
      isValid: false,
      error: `Choose one of: ${formatOptionLabels(schema.options)}.`,
    };
  }
  return { isValid: true, value: match.value };
}

function validateStringArrayValue(
  raw: unknown,
  schema: Extract<SupportedFieldSchema, { type: "string[]" }>,
): SchemaValidationResult {
  const values = parseStringList(raw);
  if (!values) {
    return { isValid: false, error: "Enter a comma-separated list." };
  }
  const normalized = schema.uniqueItems === false ? values : Array.from(new Set(values));
  const itemsError = formatItemsError(schema);
  if (schema.minItems !== undefined && normalized.length < schema.minItems) {
    return { isValid: false, error: itemsError ?? "Too few items." };
  }
  if (schema.maxItems !== undefined && normalized.length > schema.maxItems) {
    return { isValid: false, error: itemsError ?? "Too many items." };
  }
  return { isValid: true, value: normalized };
}

function validateMultiSelectEnumValue(
  raw: unknown,
  schema: Extract<SupportedFieldSchema, { type: "multi-select-enum" }>,
): SchemaValidationResult {
  const values = parseStringList(raw);
  if (!values) {
    return {
      isValid: false,
      error: `Choose one or more of: ${formatOptionLabels(schema.options)}.`,
    };
  }
  const normalized: string[] = [];
  for (const entry of values) {
    const match = matchEnumOption(entry, schema.options);
    if (!match) {
      return {
        isValid: false,
        error: `Unknown option "${entry}". Choose from: ${formatOptionLabels(schema.options)}.`,
      };
    }
    if (schema.uniqueItems === false || !normalized.includes(match.value)) {
      normalized.push(match.value);
    }
  }
  const itemsError = formatItemsError(schema);
  if (schema.minItems !== undefined && normalized.length < schema.minItems) {
    return { isValid: false, error: itemsError ?? "Too few items." };
  }
  if (schema.maxItems !== undefined && normalized.length > schema.maxItems) {
    return { isValid: false, error: itemsError ?? "Too many items." };
  }
  return { isValid: true, value: normalized };
}

export function resolveSupportedFieldSchema(value: unknown): SupportedFieldSchema | null {
  const schema = asSchemaObject(value);
  if (!schema) {
    return null;
  }

  const enumOptions = extractEnumOptions(schema);
  if (enumOptions) {
    return {
      type: "enum",
      options: enumOptions,
    };
  }

  const type = typeof schema.type === "string" ? schema.type : "";
  if (type === "string") {
    const format = typeof schema.format === "string" ? schema.format : undefined;
    const supportedFormat =
      format === "email" ||
      format === "uri" ||
      format === "url" ||
      format === "date" ||
      format === "date-time"
        ? format
        : undefined;
    return {
      type,
      format: supportedFormat,
      minLength: readNumericConstraint(schema.minLength),
      maxLength: readNumericConstraint(schema.maxLength),
      pattern: typeof schema.pattern === "string" ? schema.pattern : undefined,
    };
  }
  if (type === "integer" || type === "number") {
    return {
      type,
      minimum: readNumericConstraint(schema.minimum),
      maximum: readNumericConstraint(schema.maximum),
    };
  }
  if (type === "boolean") {
    return { type };
  }
  if (type === "array") {
    const items = asSchemaObject(schema.items);
    if (!items) {
      return null;
    }
    const optionValues = extractEnumOptions(items);
    if (optionValues) {
      return {
        type: "multi-select-enum",
        options: optionValues,
        minItems: readNumericConstraint(schema.minItems),
        maxItems: readNumericConstraint(schema.maxItems),
        uniqueItems: typeof schema.uniqueItems === "boolean" ? schema.uniqueItems : true,
      };
    }
    if (items.type === "string") {
      return {
        type: "string[]",
        minItems: readNumericConstraint(schema.minItems),
        maxItems: readNumericConstraint(schema.maxItems),
        uniqueItems: typeof schema.uniqueItems === "boolean" ? schema.uniqueItems : true,
      };
    }
  }
  return null;
}

export function isEnumSchema(
  schema: SupportedFieldSchema,
): schema is Extract<SupportedFieldSchema, { type: "enum" }> {
  return schema.type === "enum";
}

export function isMultiSelectEnumSchema(
  schema: SupportedFieldSchema,
): schema is Extract<SupportedFieldSchema, { type: "multi-select-enum" }> {
  return schema.type === "multi-select-enum";
}

export function getEnumValues(schema: Extract<SupportedFieldSchema, { type: "enum" }>): string[] {
  return schema.options.map((option) => option.value);
}

export function getEnumLabels(schema: Extract<SupportedFieldSchema, { type: "enum" }>): string[] {
  return schema.options.map((option) => option.label);
}

export function getMultiSelectValues(
  schema: Extract<SupportedFieldSchema, { type: "multi-select-enum" }>,
): string[] {
  return schema.options.map((option) => option.value);
}

export function getMultiSelectLabels(
  schema: Extract<SupportedFieldSchema, { type: "multi-select-enum" }>,
): string[] {
  return schema.options.map((option) => option.label);
}

export function getFormatHint(schema: SupportedFieldSchema): string | undefined {
  if (schema.type === "enum") {
    return `Choose one of: ${formatOptionLabels(schema.options)}.`;
  }
  if (schema.type === "multi-select-enum") {
    return joinSentences([
      `Choose one or more of: ${formatOptionLabels(schema.options)}.`,
      formatItemsHint(schema),
    ]);
  }
  if (schema.type === "string[]") {
    return joinSentences(["Enter a comma-separated list.", formatItemsHint(schema)]);
  }
  if (schema.type === "boolean") {
    return "Choose yes or no.";
  }
  if (schema.type === "integer" || schema.type === "number") {
    return formatNumericHint(schema);
  }
  if (schema.format === "email") {
    return joinSentences([
      "Use a valid email address, like name@example.com.",
      formatLengthHint(schema),
    ]);
  }
  if (schema.format === "uri" || schema.format === "url") {
    return joinSentences(["Use a full URL, like https://example.com.", formatLengthHint(schema)]);
  }
  if (schema.format === "date") {
    return joinSentences(["Use YYYY-MM-DD.", formatLengthHint(schema)]);
  }
  if (schema.format === "date-time") {
    return joinSentences([
      "Use ISO 8601 date-time, like 2026-03-31T15:00:00Z.",
      formatLengthHint(schema),
    ]);
  }
  if (schema.pattern) {
    return joinSentences(["Use the required format.", formatLengthHint(schema)]);
  }
  return formatLengthHint(schema);
}

export function validateInputSync(
  raw: unknown,
  schema: SupportedFieldSchema,
): SchemaValidationResult {
  if (schema.type === "string") {
    return validateStringValue(raw, schema);
  }
  if (schema.type === "integer" || schema.type === "number") {
    return validateNumericValue(raw, schema);
  }
  if (schema.type === "boolean") {
    const parsed = parseBooleanStrict(raw);
    if (parsed === INVALID_STRICT_PRIMITIVE) {
      return { isValid: false, error: "Choose yes or no." };
    }
    return { isValid: true, value: parsed };
  }
  if (schema.type === "enum") {
    return validateEnumValue(raw, schema);
  }
  if (schema.type === "multi-select-enum") {
    return validateMultiSelectEnumValue(raw, schema);
  }
  return validateStringArrayValue(raw, schema);
}

export async function validateInputAsync(
  raw: unknown,
  schema: SupportedFieldSchema,
  context?: { signal?: AbortSignal },
): Promise<SchemaValidationResult> {
  if (context?.signal?.aborted) {
    return { isValid: false, error: "Input validation aborted." };
  }
  return validateInputSync(raw, schema);
}
