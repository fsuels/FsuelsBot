const INTERNAL_HOOK_EVENT_REGISTRY = {
  command: ["new", "reset", "stop"],
  session: ["start", "end"],
  agent: ["bootstrap", "error"],
  gateway: ["startup"],
  message: ["received", "sent"],
} as const satisfies Record<string, readonly string[]>;

export { INTERNAL_HOOK_EVENT_REGISTRY };

export type InternalHookEventType = keyof typeof INTERNAL_HOOK_EVENT_REGISTRY;

type SpecificInternalHookEventKey = {
  [K in InternalHookEventType]: `${K}:${(typeof INTERNAL_HOOK_EVENT_REGISTRY)[K][number]}`;
}[InternalHookEventType];

export type InternalHookEventKey = InternalHookEventType | SpecificInternalHookEventKey;

const KNOWN_INTERNAL_HOOK_EVENT_KEYS = [
  ...Object.keys(INTERNAL_HOOK_EVENT_REGISTRY),
  ...Object.entries(INTERNAL_HOOK_EVENT_REGISTRY).flatMap(([eventType, actions]) =>
    actions.map((action) => `${eventType}:${action}`),
  ),
] as InternalHookEventKey[];

export function listKnownInternalHookEventKeys(): InternalHookEventKey[] {
  return [...KNOWN_INTERNAL_HOOK_EVENT_KEYS];
}
export function normalizeInternalHookEventKey(value: string): string {
  return value.trim().toLowerCase();
}

export function isKnownInternalHookEventKey(value: string): value is InternalHookEventKey {
  const normalized = normalizeInternalHookEventKey(value);
  return KNOWN_INTERNAL_HOOK_EVENT_KEYS.includes(normalized as InternalHookEventKey);
}

export function assertKnownInternalHookEventKey(value: string): InternalHookEventKey {
  const normalized = normalizeInternalHookEventKey(value);
  if (isKnownInternalHookEventKey(normalized)) {
    return normalized;
  }
  const known = KNOWN_INTERNAL_HOOK_EVENT_KEYS.join(", ");
  throw new Error(`Unknown internal hook event key "${value}". Known events: ${known}`);
}
