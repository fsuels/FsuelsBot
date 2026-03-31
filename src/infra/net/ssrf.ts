import { lookup as dnsLookupCb, type LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, type Dispatcher } from "undici";

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

export type SsrFBlockCode =
  | "INVALID_URL"
  | "INVALID_SCHEME"
  | "URL_CREDENTIALS_BLOCKED"
  | "HOSTNAME_BLOCKED"
  | "LOCALHOST_BLOCKED"
  | "LOCAL_NETWORK_HOSTNAME_BLOCKED"
  | "PRIVATE_ADDRESS_BLOCKED"
  | "DNS_RESOLUTION_BLOCKED"
  | "REDIRECT_TARGET_BLOCKED";

export class SsrFBlockedError extends Error {
  readonly code: SsrFBlockCode;
  readonly details?: Record<string, unknown>;

  constructor(code: SsrFBlockCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SsrFBlockedError";
    this.code = code;
    this.details = details;
  }
}

export type LookupFn = typeof dnsLookup;

export type SsrFPolicy = {
  allowPrivateNetwork?: boolean;
  allowedHostnames?: string[];
  blockedHostnames?: string[];
};

const PRIVATE_IPV6_PREFIXES = [
  "fe8",
  "fe9",
  "fea",
  "feb",
  "fec",
  "fed",
  "fee",
  "fef",
  "fc",
  "fd",
  "ff",
  "2001:db8",
];
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata", "metadata.google.internal"]);
const DEFAULT_PORT_BY_PROTOCOL = {
  "http:": "80",
  "https:": "443",
} as const;

function normalizeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function normalizeHostnameSet(values?: string[]): Set<string> {
  if (!values || values.length === 0) {
    return new Set<string>();
  }
  return new Set(values.map((value) => normalizeHostname(value)).filter(Boolean));
}

function defaultPortForProtocol(protocol: string): string {
  if (protocol === "http:") {
    return DEFAULT_PORT_BY_PROTOCOL["http:"];
  }
  if (protocol === "https:") {
    return DEFAULT_PORT_BY_PROTOCOL["https:"];
  }
  return "";
}

function isIpLiteral(hostname: string): boolean {
  return isIP(normalizeHostname(hostname)) !== 0;
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const numbers = parts.map((part) => Number.parseInt(part, 10));
  if (numbers.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return null;
  }
  return numbers;
}

function parseIpv4FromMappedIpv6(mapped: string): number[] | null {
  if (mapped.includes(".")) {
    return parseIpv4(mapped);
  }
  const parts = mapped.split(":").filter(Boolean);
  if (parts.length === 1) {
    const value = Number.parseInt(parts[0], 16);
    if (Number.isNaN(value) || value < 0 || value > 0xffff_ffff) {
      return null;
    }
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
  }
  if (parts.length !== 2) {
    return null;
  }
  const high = Number.parseInt(parts[0], 16);
  const low = Number.parseInt(parts[1], 16);
  if (
    Number.isNaN(high) ||
    Number.isNaN(low) ||
    high < 0 ||
    low < 0 ||
    high > 0xffff ||
    low > 0xffff
  ) {
    return null;
  }
  const value = (high << 16) + low;
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function isPrivateIpv4(parts: number[]): boolean {
  const [octet1, octet2, octet3] = parts;
  if (octet1 === 0) {
    return true;
  }
  if (octet1 === 10) {
    return true;
  }
  if (octet1 === 127) {
    return true;
  }
  if (octet1 === 169 && octet2 === 254) {
    return true;
  }
  if (octet1 === 172 && octet2 >= 16 && octet2 <= 31) {
    return true;
  }
  if (octet1 === 192 && octet2 === 168) {
    return true;
  }
  if (octet1 === 100 && octet2 >= 64 && octet2 <= 127) {
    return true;
  }
  if (octet1 === 192 && octet2 === 0) {
    return true;
  }
  if (octet1 === 192 && octet2 === 88 && octet3 === 99) {
    return true;
  }
  if (octet1 === 198 && (octet2 === 18 || octet2 === 19)) {
    return true;
  }
  if (octet1 === 198 && octet2 === 51 && octet3 === 100) {
    return true;
  }
  if (octet1 === 203 && octet2 === 0 && octet3 === 113) {
    return true;
  }
  if (octet1 >= 224) {
    return true;
  }
  return false;
}

export function isPrivateIpAddress(address: string): boolean {
  let normalized = address.trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  if (!normalized) {
    return false;
  }

  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    const ipv4 = parseIpv4FromMappedIpv6(mapped);
    if (ipv4) {
      return isPrivateIpv4(ipv4);
    }
  }

  if (normalized.includes(":")) {
    if (normalized === "::" || normalized === "::1") {
      return true;
    }
    return PRIVATE_IPV6_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  }

  const ipv4 = parseIpv4(normalized);
  if (!ipv4) {
    return false;
  }
  return isPrivateIpv4(ipv4);
}

function isSingleLabelHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return Boolean(normalized) && !isIpLiteral(normalized) && !normalized.includes(".");
}

export function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    return false;
  }
  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return true;
  }
  return (
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    isSingleLabelHostname(normalized)
  );
}

export type ValidatedFetchUrl = {
  url: URL;
  canonicalUrl: string;
  normalizedHostname: string;
  normalizedPort: string;
};

export function normalizeFetchPort(url: Pick<URL, "protocol" | "port">): string {
  return url.port || defaultPortForProtocol(url.protocol);
}

export function canonicalizeFetchUrl(url: URL): string {
  const canonical = new URL(url.toString());
  if (canonical.port === defaultPortForProtocol(canonical.protocol)) {
    canonical.port = "";
  }
  return canonical.toString();
}

function assertHostnameAllowed(
  hostname: string,
  policy: SsrFPolicy | undefined,
  details: Record<string, unknown>,
): { allowPrivateNetwork: boolean; isExplicitAllowed: boolean } {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    throw new SsrFBlockedError("INVALID_URL", "Invalid hostname", details);
  }

  const allowPrivateNetwork = Boolean(policy?.allowPrivateNetwork);
  const allowedHostnames = normalizeHostnameSet(policy?.allowedHostnames);
  const blockedHostnames = normalizeHostnameSet(policy?.blockedHostnames);
  const isExplicitAllowed = allowedHostnames.has(normalized);

  if (blockedHostnames.has(normalized)) {
    throw new SsrFBlockedError("HOSTNAME_BLOCKED", `Blocked hostname: ${hostname}`, details);
  }

  if (!allowPrivateNetwork && !isExplicitAllowed) {
    if (normalized === "localhost" || normalized.endsWith(".localhost")) {
      throw new SsrFBlockedError("LOCALHOST_BLOCKED", `Blocked hostname: ${hostname}`, details);
    }
    if (isBlockedHostname(normalized)) {
      throw new SsrFBlockedError(
        "LOCAL_NETWORK_HOSTNAME_BLOCKED",
        `Blocked hostname: ${hostname}`,
        details,
      );
    }
    if (isPrivateIpAddress(normalized)) {
      throw new SsrFBlockedError(
        "PRIVATE_ADDRESS_BLOCKED",
        "Blocked: private/internal IP address",
        details,
      );
    }
  }

  return { allowPrivateNetwork, isExplicitAllowed };
}

export function validateFetchUrl(
  value: string,
  params: { policy?: SsrFPolicy } = {},
): ValidatedFetchUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SsrFBlockedError("INVALID_URL", "Invalid URL: must be http or https", {
      url: value,
    });
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new SsrFBlockedError("INVALID_SCHEME", "Invalid URL: must be http or https", {
      url: value,
      scheme: url.protocol,
    });
  }
  if (url.username || url.password) {
    throw new SsrFBlockedError(
      "URL_CREDENTIALS_BLOCKED",
      "Blocked URL: embedded credentials are not allowed",
      { url: value },
    );
  }

  const normalizedHostname = normalizeHostname(url.hostname);
  assertHostnameAllowed(normalizedHostname, params.policy, {
    url: value,
    hostname: normalizedHostname,
  });

  return {
    url,
    canonicalUrl: canonicalizeFetchUrl(url),
    normalizedHostname,
    normalizedPort: normalizeFetchPort(url),
  };
}

export function createPinnedLookup(params: {
  hostname: string;
  addresses: string[];
  fallback?: typeof dnsLookupCb;
}): typeof dnsLookupCb {
  const normalizedHost = normalizeHostname(params.hostname);
  const fallback = params.fallback ?? dnsLookupCb;
  const fallbackLookup = fallback as unknown as (
    hostname: string,
    callback: LookupCallback,
  ) => void;
  const fallbackWithOptions = fallback as unknown as (
    hostname: string,
    options: unknown,
    callback: LookupCallback,
  ) => void;
  const records = params.addresses.map((address) => ({
    address,
    family: address.includes(":") ? 6 : 4,
  }));
  let index = 0;

  return ((host: string, options?: unknown, callback?: unknown) => {
    const cb: LookupCallback =
      typeof options === "function" ? (options as LookupCallback) : (callback as LookupCallback);
    if (!cb) {
      return;
    }
    const normalized = normalizeHostname(host);
    if (!normalized || normalized !== normalizedHost) {
      if (typeof options === "function" || options === undefined) {
        return fallbackLookup(host, cb);
      }
      return fallbackWithOptions(host, options, cb);
    }

    const opts =
      typeof options === "object" && options !== null
        ? (options as { all?: boolean; family?: number })
        : {};
    const requestedFamily =
      typeof options === "number" ? options : typeof opts.family === "number" ? opts.family : 0;
    const candidates =
      requestedFamily === 4 || requestedFamily === 6
        ? records.filter((entry) => entry.family === requestedFamily)
        : records;
    const usable = candidates.length > 0 ? candidates : records;
    if (opts.all) {
      cb(null, usable as LookupAddress[]);
      return;
    }
    const chosen = usable[index % usable.length];
    index += 1;
    cb(null, chosen.address, chosen.family);
  }) as typeof dnsLookupCb;
}

export type PinnedHostname = {
  hostname: string;
  addresses: string[];
  lookup: typeof dnsLookupCb;
};

export async function resolvePinnedHostnameWithPolicy(
  hostname: string,
  params: { lookupFn?: LookupFn; policy?: SsrFPolicy } = {},
): Promise<PinnedHostname> {
  const normalized = normalizeHostname(hostname);
  const { allowPrivateNetwork, isExplicitAllowed } = assertHostnameAllowed(
    normalized,
    params.policy,
    { hostname: normalized },
  );

  const lookupFn = params.lookupFn ?? dnsLookup;
  const results = await lookupFn(normalized, { all: true });
  if (results.length === 0) {
    throw new SsrFBlockedError(
      "DNS_RESOLUTION_BLOCKED",
      `Unable to resolve hostname: ${hostname}`,
      { hostname: normalized },
    );
  }

  if (!allowPrivateNetwork && !isExplicitAllowed) {
    for (const entry of results) {
      if (isPrivateIpAddress(entry.address)) {
        throw new SsrFBlockedError(
          "DNS_RESOLUTION_BLOCKED",
          "Blocked: resolves to private/internal IP address",
          { hostname: normalized, address: entry.address },
        );
      }
    }
  }

  const addresses = Array.from(new Set(results.map((entry) => entry.address)));
  if (addresses.length === 0) {
    throw new SsrFBlockedError(
      "DNS_RESOLUTION_BLOCKED",
      `Unable to resolve hostname: ${hostname}`,
      { hostname: normalized },
    );
  }

  return {
    hostname: normalized,
    addresses,
    lookup: createPinnedLookup({ hostname: normalized, addresses }),
  };
}

export async function resolvePinnedHostname(
  hostname: string,
  lookupFn: LookupFn = dnsLookup,
): Promise<PinnedHostname> {
  return await resolvePinnedHostnameWithPolicy(hostname, { lookupFn });
}

export function createPinnedDispatcher(pinned: PinnedHostname): Dispatcher {
  return new Agent({
    connect: {
      lookup: pinned.lookup,
    },
  });
}

export async function closeDispatcher(dispatcher?: Dispatcher | null): Promise<void> {
  if (!dispatcher) {
    return;
  }
  const candidate = dispatcher as { close?: () => Promise<void> | void; destroy?: () => void };
  try {
    if (typeof candidate.close === "function") {
      await candidate.close();
      return;
    }
    if (typeof candidate.destroy === "function") {
      candidate.destroy();
    }
  } catch {
    // ignore dispatcher cleanup errors
  }
}

export async function assertPublicHostname(
  hostname: string,
  lookupFn: LookupFn = dnsLookup,
): Promise<void> {
  await resolvePinnedHostname(hostname, lookupFn);
}
