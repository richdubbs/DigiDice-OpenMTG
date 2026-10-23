/** JSON pointers (RFC 6901) into ability JSON: the paths of issues, manual spans and degrade units. Owner: WP1. */

type Rec = Record<string, unknown>;

export const parsePointer = (path: string): string[] =>
  path === '' ? [] : path.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));

export function getAt(root: unknown, path: string): unknown {
  let cur = root;
  for (const k of parsePointer(path)) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Rec)[k];
  }
  return cur;
}

/** Replace the value at `path` inside `root` (mutating it) and return the new root (which differs from `root` only when `path` is ""). */
export function setAt(root: unknown, path: string, value: unknown): unknown {
  const keys = parsePointer(path);
  if (keys.length === 0) return value;
  let cur = root as Rec;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Rec;
  cur[keys[keys.length - 1]!] = value;
  return root;
}

/** Is `inner` strictly inside `outer`? */
export const isInside = (inner: string, outer: string): boolean => inner.startsWith(`${outer}/`);
