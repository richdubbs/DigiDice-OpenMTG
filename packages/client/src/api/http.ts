/**
 * Typed calls to the local server's API (types in packages/server/src/api.ts). Same origin: `npm run play` serves the client and the API together; in
 * development Vite proxies /api to the server.
 */
import type { ApiEndpoints, ApiError, EndpointKey } from '@openmtg/server/api';

type GetKey = Extract<EndpointKey, `GET ${string}`>;
type PostKey = Extract<EndpointKey, `POST ${string}`>;

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** The URL of an endpoint: fills `:param` segments (URL-encoded) and appends the defined query parameters in a stable order. */
export function apiPath(key: EndpointKey, params: Record<string, string> = {}, query: object = {}): string {
  const pattern = key.slice(key.indexOf(' ') + 1);
  const filled = pattern.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const v = params[name];
    if (v === undefined) throw new Error(`Missing path parameter ${name} for ${key}`);
    return encodeURIComponent(v);
  });
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query).sort(([a], [b]) => a.localeCompare(b))) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${filled}?${s}` : filled;
}

async function parse<T>(res: Response, key: EndpointKey): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = body && typeof body === 'object' && 'error' in body ? (body as ApiError) : null;
    throw new ApiRequestError(res.status, err, err?.error ?? `${key} failed with HTTP ${res.status}`);
  }
  return body as T;
}

export async function apiGet<K extends GetKey>(
  key: K,
  opts: { params?: Record<string, string>; query?: ApiEndpoints[K]['query']; signal?: AbortSignal } = {},
): Promise<ApiEndpoints[K]['response']> {
  const res = await fetch(apiPath(key, opts.params, opts.query ?? {}), { method: 'GET', headers: { Accept: 'application/json' }, signal: opts.signal ?? null });
  return parse(res, key);
}

export async function apiPost<K extends PostKey>(key: K, body: ApiEndpoints[K]['body'], opts: { signal?: AbortSignal } = {}): Promise<ApiEndpoints[K]['response']> {
  const res = await fetch(apiPath(key), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal ?? null,
  });
  return parse(res, key);
}
