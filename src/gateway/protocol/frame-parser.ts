import type {
  EventFrame,
  HelloOk,
  PresenceEntry,
  ResponseFrame,
  Snapshot,
  StateVersion,
} from "./index.js";

export type GatewayProtocolIssueCode =
  | "invalid_json"
  | "invalid_frame"
  | "invalid_event_frame"
  | "invalid_response_frame"
  | "invalid_hello"
  | "unexpected_ws_payload"
  | "unsupported_frame_type"
  | "invalid_connect_challenge";

export type GatewayProtocolIssue = {
  code: GatewayProtocolIssueCode;
  message: string;
  frameType?: string;
};

export type ParsedGatewayInboundFrame =
  | { kind: "event"; frame: EventFrame }
  | { kind: "response"; frame: ResponseFrame };

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issue: GatewayProtocolIssue };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

function isOptionalInteger(value: unknown, minimum = 0): boolean {
  return value === undefined || isInteger(value, minimum);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => isNonEmptyString(entry));
}

function fail(code: GatewayProtocolIssueCode, message: string, frameType?: string) {
  return { ok: false, issue: { code, message, frameType } } as const;
}

function getStateVersionError(value: unknown, path: string): string | null {
  if (!isRecord(value)) {
    return `${path} must be an object`;
  }
  if (!isInteger(value.presence, 0)) {
    return `${path}.presence must be an integer >= 0`;
  }
  if (!isInteger(value.health, 0)) {
    return `${path}.health must be an integer >= 0`;
  }
  return null;
}

function getPresenceEntryError(value: unknown, path: string): string | null {
  if (!isRecord(value)) {
    return `${path} must be an object`;
  }
  if (!isInteger(value.ts, 0)) {
    return `${path}.ts must be an integer >= 0`;
  }
  if (!isOptionalNonEmptyString(value.host)) {
    return `${path}.host must be a non-empty string`;
  }
  if (!isOptionalNonEmptyString(value.ip)) {
    return `${path}.ip must be a non-empty string`;
  }
  if (!isOptionalNonEmptyString(value.version)) {
    return `${path}.version must be a non-empty string`;
  }
  if (!isOptionalNonEmptyString(value.platform)) {
    return `${path}.platform must be a non-empty string`;
  }
  if (!isOptionalNonEmptyString(value.deviceFamily)) {
    return `${path}.deviceFamily must be a non-empty string`;
  }
  if (!isOptionalNonEmptyString(value.modelIdentifier)) {
    return `${path}.modelIdentifier must be a non-empty string`;
  }
  if (!isOptionalNonEmptyString(value.mode)) {
    return `${path}.mode must be a non-empty string`;
  }
  if (!isOptionalInteger(value.lastInputSeconds, 0)) {
    return `${path}.lastInputSeconds must be an integer >= 0`;
  }
  if (!isOptionalNonEmptyString(value.reason)) {
    return `${path}.reason must be a non-empty string`;
  }
  if (value.tags !== undefined && !isNonEmptyStringArray(value.tags)) {
    return `${path}.tags must be an array of non-empty strings`;
  }
  if (value.text !== undefined && typeof value.text !== "string") {
    return `${path}.text must be a string`;
  }
  if (!isOptionalNonEmptyString(value.deviceId)) {
    return `${path}.deviceId must be a non-empty string`;
  }
  if (value.roles !== undefined && !isNonEmptyStringArray(value.roles)) {
    return `${path}.roles must be an array of non-empty strings`;
  }
  if (value.scopes !== undefined && !isNonEmptyStringArray(value.scopes)) {
    return `${path}.scopes must be an array of non-empty strings`;
  }
  if (!isOptionalNonEmptyString(value.instanceId)) {
    return `${path}.instanceId must be a non-empty string`;
  }
  return null;
}

function getSessionDefaultsError(value: unknown, path: string): string | null {
  if (!isRecord(value)) {
    return `${path} must be an object`;
  }
  if (!isNonEmptyString(value.defaultAgentId)) {
    return `${path}.defaultAgentId must be a non-empty string`;
  }
  if (!isNonEmptyString(value.mainKey)) {
    return `${path}.mainKey must be a non-empty string`;
  }
  if (!isNonEmptyString(value.mainSessionKey)) {
    return `${path}.mainSessionKey must be a non-empty string`;
  }
  if (!isOptionalNonEmptyString(value.scope)) {
    return `${path}.scope must be a non-empty string`;
  }
  return null;
}

function getSnapshotError(value: unknown, path: string): string | null {
  if (!isRecord(value)) {
    return `${path} must be an object`;
  }
  if (!Array.isArray(value.presence)) {
    return `${path}.presence must be an array`;
  }
  for (const [index, entry] of value.presence.entries()) {
    const entryError = getPresenceEntryError(entry, `${path}.presence[${index}]`);
    if (entryError) {
      return entryError;
    }
  }
  if (!Object.prototype.hasOwnProperty.call(value, "health")) {
    return `${path}.health is required`;
  }
  const stateVersionError = getStateVersionError(value.stateVersion, `${path}.stateVersion`);
  if (stateVersionError) {
    return stateVersionError;
  }
  if (!isInteger(value.uptimeMs, 0)) {
    return `${path}.uptimeMs must be an integer >= 0`;
  }
  if (!isOptionalNonEmptyString(value.configPath)) {
    return `${path}.configPath must be a non-empty string`;
  }
  if (!isOptionalNonEmptyString(value.stateDir)) {
    return `${path}.stateDir must be a non-empty string`;
  }
  if (value.sessionDefaults !== undefined) {
    const defaultsError = getSessionDefaultsError(value.sessionDefaults, `${path}.sessionDefaults`);
    if (defaultsError) {
      return defaultsError;
    }
  }
  return null;
}

function getHelloOkError(value: unknown, path: string): string | null {
  if (!isRecord(value)) {
    return `${path} must be an object`;
  }
  if (value.type !== "hello-ok") {
    return `${path}.type must be "hello-ok"`;
  }
  if (!isInteger(value.protocol, 1)) {
    return `${path}.protocol must be an integer >= 1`;
  }
  if (!isRecord(value.server)) {
    return `${path}.server must be an object`;
  }
  if (!isNonEmptyString(value.server.version)) {
    return `${path}.server.version must be a non-empty string`;
  }
  if (!isOptionalNonEmptyString(value.server.commit)) {
    return `${path}.server.commit must be a non-empty string`;
  }
  if (!isOptionalNonEmptyString(value.server.host)) {
    return `${path}.server.host must be a non-empty string`;
  }
  if (!isNonEmptyString(value.server.connId)) {
    return `${path}.server.connId must be a non-empty string`;
  }
  if (!isRecord(value.features)) {
    return `${path}.features must be an object`;
  }
  if (!isNonEmptyStringArray(value.features.methods)) {
    return `${path}.features.methods must be an array of non-empty strings`;
  }
  if (!isNonEmptyStringArray(value.features.events)) {
    return `${path}.features.events must be an array of non-empty strings`;
  }
  const snapshotError = getSnapshotError(value.snapshot, `${path}.snapshot`);
  if (snapshotError) {
    return snapshotError;
  }
  if (value.canvasHostUrl !== undefined && !isNonEmptyString(value.canvasHostUrl)) {
    return `${path}.canvasHostUrl must be a non-empty string`;
  }
  if (value.auth !== undefined) {
    if (!isRecord(value.auth)) {
      return `${path}.auth must be an object`;
    }
    if (!isNonEmptyString(value.auth.deviceToken)) {
      return `${path}.auth.deviceToken must be a non-empty string`;
    }
    if (!isNonEmptyString(value.auth.role)) {
      return `${path}.auth.role must be a non-empty string`;
    }
    if (!isNonEmptyStringArray(value.auth.scopes)) {
      return `${path}.auth.scopes must be an array of non-empty strings`;
    }
    if (!isOptionalInteger(value.auth.issuedAtMs, 0)) {
      return `${path}.auth.issuedAtMs must be an integer >= 0`;
    }
  }
  if (value.resume !== undefined) {
    if (!isRecord(value.resume)) {
      return `${path}.resume must be an object`;
    }
    if (!isInteger(value.resume.requestedSeq, 0)) {
      return `${path}.resume.requestedSeq must be an integer >= 0`;
    }
    if (!isInteger(value.resume.replayedCount, 0)) {
      return `${path}.resume.replayedCount must be an integer >= 0`;
    }
    if (!isOptionalInteger(value.resume.replayedThroughSeq, 0)) {
      return `${path}.resume.replayedThroughSeq must be an integer >= 0`;
    }
    if (!isOptionalInteger(value.resume.bufferedFromSeq, 0)) {
      return `${path}.resume.bufferedFromSeq must be an integer >= 0`;
    }
    if (!isInteger(value.resume.latestSeq, 0)) {
      return `${path}.resume.latestSeq must be an integer >= 0`;
    }
    if (typeof value.resume.gap !== "boolean") {
      return `${path}.resume.gap must be a boolean`;
    }
    if (typeof value.resume.reset !== "boolean") {
      return `${path}.resume.reset must be a boolean`;
    }
  }
  if (!isRecord(value.policy)) {
    return `${path}.policy must be an object`;
  }
  if (!isInteger(value.policy.maxPayload, 1)) {
    return `${path}.policy.maxPayload must be an integer >= 1`;
  }
  if (!isInteger(value.policy.maxBufferedBytes, 1)) {
    return `${path}.policy.maxBufferedBytes must be an integer >= 1`;
  }
  if (!isInteger(value.policy.tickIntervalMs, 1)) {
    return `${path}.policy.tickIntervalMs must be an integer >= 1`;
  }
  return null;
}

function getEventFrameError(value: unknown, path: string): string | null {
  if (!isRecord(value)) {
    return `${path} must be an object`;
  }
  if (value.type !== "event") {
    return `${path}.type must be "event"`;
  }
  if (!isNonEmptyString(value.event)) {
    return `${path}.event must be a non-empty string`;
  }
  if (!isOptionalInteger(value.seq, 0)) {
    return `${path}.seq must be an integer >= 0`;
  }
  if (value.stateVersion !== undefined) {
    const stateVersionError = getStateVersionError(value.stateVersion, `${path}.stateVersion`);
    if (stateVersionError) {
      return stateVersionError;
    }
  }
  return null;
}

function getResponseFrameError(value: unknown, path: string): string | null {
  if (!isRecord(value)) {
    return `${path} must be an object`;
  }
  if (value.type !== "res") {
    return `${path}.type must be "res"`;
  }
  if (!isNonEmptyString(value.id)) {
    return `${path}.id must be a non-empty string`;
  }
  if (typeof value.ok !== "boolean") {
    return `${path}.ok must be a boolean`;
  }
  if (value.error !== undefined) {
    if (!isRecord(value.error)) {
      return `${path}.error must be an object`;
    }
    if (!isNonEmptyString(value.error.code)) {
      return `${path}.error.code must be a non-empty string`;
    }
    if (!isNonEmptyString(value.error.message)) {
      return `${path}.error.message must be a non-empty string`;
    }
    if (value.error.retryable !== undefined && typeof value.error.retryable !== "boolean") {
      return `${path}.error.retryable must be a boolean`;
    }
    if (!isOptionalInteger(value.error.retryAfterMs, 0)) {
      return `${path}.error.retryAfterMs must be an integer >= 0`;
    }
  }
  return null;
}

export function parseGatewayInboundFrame(raw: string): ValidationResult<ParsedGatewayInboundFrame> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("invalid_json", `invalid gateway frame JSON: ${message}`);
  }

  if (!isRecord(parsed)) {
    return fail("invalid_frame", "gateway frame must be an object");
  }

  const frameType = typeof parsed.type === "string" ? parsed.type : undefined;
  if (!frameType) {
    return fail("invalid_frame", "gateway frame type must be a non-empty string");
  }

  if (frameType === "event") {
    const error = getEventFrameError(parsed, "frame");
    if (error) {
      return fail("invalid_event_frame", error, frameType);
    }
    return { ok: true, value: { kind: "event", frame: parsed as EventFrame } };
  }

  if (frameType === "res") {
    const error = getResponseFrameError(parsed, "frame");
    if (error) {
      return fail("invalid_response_frame", error, frameType);
    }
    return { ok: true, value: { kind: "response", frame: parsed as ResponseFrame } };
  }

  return fail("unsupported_frame_type", `unsupported gateway frame type "${frameType}"`, frameType);
}

export function validateGatewayHelloOk(value: unknown): ValidationResult<HelloOk> {
  const error = getHelloOkError(value, "hello");
  if (error) {
    return fail("invalid_hello", `invalid hello-ok payload: ${error}`, "hello-ok");
  }
  return { ok: true, value: value as HelloOk };
}

export function parseConnectChallengeNonce(frame: EventFrame): ValidationResult<string> {
  if (frame.event !== "connect.challenge") {
    return fail(
      "invalid_connect_challenge",
      `connect challenge parser only handles "connect.challenge", got "${frame.event}"`,
      "event",
    );
  }
  if (!isRecord(frame.payload)) {
    return fail(
      "invalid_connect_challenge",
      'invalid connect.challenge payload: payload must be an object with a non-empty "nonce"',
      "event",
    );
  }
  if (!isNonEmptyString(frame.payload.nonce)) {
    return fail(
      "invalid_connect_challenge",
      'invalid connect.challenge payload: nonce must be a non-empty string',
      "event",
    );
  }
  return { ok: true, value: frame.payload.nonce };
}

export type {
  EventFrame,
  HelloOk,
  PresenceEntry,
  ResponseFrame,
  Snapshot,
  StateVersion,
};
