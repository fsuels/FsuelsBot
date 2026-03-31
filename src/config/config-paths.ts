type PathNode = Record<string, unknown> | unknown[];

const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const PATH_USAGE = "Invalid path. Use dot or bracket notation (e.g. foo.bar or foo[0].bar).";

function isIndexSegment(raw: string): boolean {
  return /^[0-9]+$/.test(raw);
}

export function parseConfigPath(raw: string): {
  ok: boolean;
  path?: string[];
  error?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: PATH_USAGE,
    };
  }

  const parts: string[] = [];
  let current = "";

  for (let index = 0; index < trimmed.length; index += 1) {
    const ch = trimmed[index];
    if (ch === "\\") {
      const next = trimmed[index + 1];
      if (!next) {
        return { ok: false, error: PATH_USAGE };
      }
      current += next;
      index += 1;
      continue;
    }
    if (ch === ".") {
      if (current) {
        parts.push(current);
        current = "";
        continue;
      }
      if (trimmed[index - 1] === "]") {
        continue;
      }
      return { ok: false, error: PATH_USAGE };
    }
    if (ch === "[") {
      if (current) {
        parts.push(current);
        current = "";
      }
      const close = trimmed.indexOf("]", index + 1);
      if (close === -1) {
        return { ok: false, error: PATH_USAGE };
      }
      const segment = trimmed.slice(index + 1, close).trim();
      if (!segment) {
        return { ok: false, error: PATH_USAGE };
      }
      parts.push(segment);
      index = close;
      continue;
    }
    current += ch;
  }

  if (current) {
    parts.push(current);
  }

  if (parts.length === 0 || parts.some((part) => !part)) {
    return {
      ok: false,
      error: PATH_USAGE,
    };
  }
  if (parts.some((part) => BLOCKED_KEYS.has(part))) {
    return { ok: false, error: "Invalid path segment." };
  }
  return { ok: true, path: parts };
}

export function setConfigValueAtPath(root: PathNode, path: string[], value: unknown): void {
  let cursor: PathNode = root;
  for (let idx = 0; idx < path.length - 1; idx += 1) {
    const segment = path[idx];
    const nextSegment = path[idx + 1];
    const nextContainer: PathNode = isIndexSegment(nextSegment) ? [] : {};
    if (Array.isArray(cursor)) {
      if (!isIndexSegment(segment)) {
        throw new Error(`Expected numeric index for array segment "${segment}".`);
      }
      const index = Number.parseInt(segment, 10);
      const next = cursor[index];
      if (!isContainer(next)) {
        cursor[index] = nextContainer;
      }
      cursor = cursor[index] as PathNode;
      continue;
    }
    const next = cursor[segment];
    if (!isContainer(next)) {
      cursor[segment] = nextContainer;
    }
    cursor = cursor[segment] as PathNode;
  }
  const leaf = path[path.length - 1];
  if (Array.isArray(cursor)) {
    if (!isIndexSegment(leaf)) {
      throw new Error(`Expected numeric index for array segment "${leaf}".`);
    }
    cursor[Number.parseInt(leaf, 10)] = value;
    return;
  }
  cursor[leaf] = value;
}

export function unsetConfigValueAtPath(root: PathNode, path: string[]): boolean {
  const stack: Array<{ node: PathNode; key: string }> = [];
  let cursor: PathNode = root;
  for (let idx = 0; idx < path.length - 1; idx += 1) {
    const key = path[idx];
    const next = getChildAtPathSegment(cursor, key);
    if (!isContainer(next)) {
      return false;
    }
    stack.push({ node: cursor, key });
    cursor = next;
  }
  const leafKey = path[path.length - 1];
  if (!deleteChildAtPathSegment(cursor, leafKey)) {
    return false;
  }
  for (let idx = stack.length - 1; idx >= 0; idx -= 1) {
    const { node, key } = stack[idx];
    const child = getChildAtPathSegment(node, key);
    if (child === undefined) {
      continue;
    }
    if (!isContainer(child)) {
      break;
    }
    if (isContainerEmpty(child)) {
      deleteChildAtPathSegment(node, key);
    } else {
      break;
    }
  }
  return true;
}

export function getConfigValueAtPath(root: PathNode, path: string[]): unknown {
  let cursor: unknown = root;
  for (const key of path) {
    if (!isContainer(cursor)) {
      return undefined;
    }
    cursor = getChildAtPathSegment(cursor, key);
  }
  return cursor;
}

export function hasConfigValueAtPath(root: PathNode, path: string[]): boolean {
  let cursor: unknown = root;
  for (const key of path) {
    if (!isContainer(cursor)) {
      return false;
    }
    if (Array.isArray(cursor)) {
      if (!isIndexSegment(key)) {
        return false;
      }
      const index = Number.parseInt(key, 10);
      if (index < 0 || index >= cursor.length) {
        return false;
      }
      cursor = cursor[index];
      continue;
    }
    if (!(key in cursor)) {
      return false;
    }
    cursor = cursor[key];
  }
  return true;
}

function getChildAtPathSegment(node: PathNode, key: string): unknown {
  if (Array.isArray(node)) {
    if (!isIndexSegment(key)) {
      return undefined;
    }
    const index = Number.parseInt(key, 10);
    if (index < 0 || index >= node.length) {
      return undefined;
    }
    return node[index];
  }
  return node[key];
}

function deleteChildAtPathSegment(node: PathNode, key: string): boolean {
  if (Array.isArray(node)) {
    if (!isIndexSegment(key)) {
      return false;
    }
    const index = Number.parseInt(key, 10);
    if (index < 0 || index >= node.length) {
      return false;
    }
    node.splice(index, 1);
    return true;
  }
  if (!(key in node)) {
    return false;
  }
  delete node[key];
  return true;
}

function isContainerEmpty(value: PathNode): boolean {
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return Object.keys(value).length === 0;
}

function isContainer(value: unknown): value is PathNode {
  return Array.isArray(value) || isPlainObject(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}
