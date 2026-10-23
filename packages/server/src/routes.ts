/**
 * The route table: one entry per endpoint of api.ts. Adding an endpoint means adding it to `ApiEndpoints`, `ENDPOINTS` and here (a test checks that the
 * table and `ENDPOINTS` agree).
 */
import type { EndpointKey, Method } from './api';
import type { Handler } from './context';
import { compileDefs } from './defs';
import { matchImages } from './images';
import { resolveDeck } from './resolve';
import { cardDetail, listSets, searchCards } from './search';
import { getStatus } from './status';
import { getUpdate, postUpdate } from './update';
import { validateDeck } from './validate';

type AnyHandler = Handler<EndpointKey>;

export const ROUTES: { readonly [K in EndpointKey]: Handler<K> } = {
  'GET /api/status': getStatus,
  'GET /api/cards/search': searchCards,
  'GET /api/cards/:name': cardDetail,
  'GET /api/sets': listSets,
  'POST /api/decks/resolve': resolveDeck,
  'POST /api/cards/defs': compileDefs,
  'POST /api/decks/validate': validateDeck,
  'POST /api/images/match': matchImages,
  'GET /api/update': getUpdate,
  'POST /api/update': postUpdate,
};

interface CompiledRoute {
  key: EndpointKey;
  method: Method;
  segments: string[];
}

const COMPILED: CompiledRoute[] = (Object.keys(ROUTES) as EndpointKey[]).map((key) => {
  const [method, pattern] = key.split(' ') as [Method, string];
  return { key, method, segments: pattern.split('/').filter(Boolean) };
});

export type RouteMatch =
  | { kind: 'found'; key: EndpointKey; handler: AnyHandler; params: Record<string, string> }
  | { kind: 'methodNotAllowed'; allow: Method[] }
  | { kind: 'notFound' };

function matchSegments(pattern: string[], parts: string[]): Record<string, string> | null {
  if (pattern.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    const v = parts[i]!;
    if (p.startsWith(':')) {
      try {
        params[p.slice(1)] = decodeURIComponent(v);
      } catch {
        return null; // malformed percent-encoding
      }
    } else if (p !== v) return null;
  }
  return params;
}

/** Find the handler for a method and path (without the query string). Literal routes win over parameter routes ("/api/cards/search"). */
export function matchRoute(method: string, pathname: string): RouteMatch {
  const parts = pathname.split('/').filter(Boolean);
  const candidates = COMPILED.map((r) => ({ r, params: matchSegments(r.segments, parts) }))
    .filter((c): c is { r: CompiledRoute; params: Record<string, string> } => c.params !== null)
    .sort((a, b) => Object.keys(a.params).length - Object.keys(b.params).length);
  if (candidates.length === 0) return { kind: 'notFound' };
  const hit = candidates.find((c) => c.r.method === method);
  if (!hit) return { kind: 'methodNotAllowed', allow: [...new Set(candidates.map((c) => c.r.method))] };
  return { kind: 'found', key: hit.r.key, handler: ROUTES[hit.r.key] as AnyHandler, params: hit.params };
}
