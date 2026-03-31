import type { ToolValidationResult } from "../tool-contract.js";

export type ActionFieldPresence = "nonEmpty" | "defined";

export type ActionFieldSpec =
  | string
  | {
      key: string;
      label?: string;
      presence?: ActionFieldPresence;
    };

export type ActionOneOfGroup = {
  keys: ActionFieldSpec[];
  label?: string;
};

export type ActionValidationRule = {
  required?: ActionFieldSpec[];
  oneOf?: ActionOneOfGroup[];
  forbid?: ActionFieldSpec[];
  custom?: (input: Record<string, unknown>) => string | undefined;
};

function resolveFieldSpec(field: ActionFieldSpec) {
  if (typeof field === "string") {
    return {
      key: field,
      label: field,
      presence: "nonEmpty" as const,
    };
  }
  return {
    key: field.key,
    label: field.label ?? field.key,
    presence: field.presence ?? "nonEmpty",
  };
}

function hasFieldValue(value: unknown, presence: ActionFieldPresence): boolean {
  if (presence === "defined") {
    return value !== undefined && value !== null;
  }
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return true;
}

export function hasActionField(input: Record<string, unknown>, field: ActionFieldSpec): boolean {
  const spec = resolveFieldSpec(field);
  return hasFieldValue(input[spec.key], spec.presence);
}

function invalidInput(message: string): ToolValidationResult {
  return {
    result: false,
    errorCode: 400,
    message,
  };
}

export function validateFlatActionInput(params: {
  toolName: string;
  action: string;
  input: Record<string, unknown>;
  rules: Record<string, ActionValidationRule>;
}): ToolValidationResult {
  const rule = params.rules[params.action];
  if (!rule) {
    return invalidInput(`Unsupported ${params.toolName} action: ${params.action}`);
  }

  for (const field of rule.required ?? []) {
    const spec = resolveFieldSpec(field);
    if (!hasFieldValue(params.input[spec.key], spec.presence)) {
      return invalidInput(`${spec.label} required for action=${params.action}`);
    }
  }

  for (const group of rule.oneOf ?? []) {
    const matched = group.keys.some((field) => hasActionField(params.input, field));
    if (!matched) {
      const label =
        group.label ?? group.keys.map((field) => resolveFieldSpec(field).label).join(" or ");
      return invalidInput(`${label} required for action=${params.action}`);
    }
  }

  for (const field of rule.forbid ?? []) {
    const spec = resolveFieldSpec(field);
    if (hasFieldValue(params.input[spec.key], spec.presence)) {
      return invalidInput(`${spec.label} is not supported for action=${params.action}`);
    }
  }

  const customError = rule.custom?.(params.input);
  if (customError) {
    return invalidInput(customError);
  }

  return { result: true };
}
