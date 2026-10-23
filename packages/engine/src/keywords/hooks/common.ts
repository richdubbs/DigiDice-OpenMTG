/**
 * Helpers shared by the per-keyword hook modules (design 7.3). Owner: WP3.
 *
 * `charsOfId` reads an object's characteristics through the characteristics function (CR 109.3, never from definitions). While a provider call is being
 * answered (`cached`), the characteristics of each object are computed once and shared by every keyword hook of that call, so splitting the milestone 4 provider
 * into one module per keyword costs no extra `getChars`. The cache lives for exactly one synchronous provider call and never outlives it.
 */
import { charsOfObject, type Chars } from '../../rules/characteristics';
import type { GameLike } from '../../rules/hookpoints';
import type { GameObject } from '../../types/state';
import type { ObjectId } from '../../types/ids';

/** A creature's name for messages: a face-down creature has none (CR 708.2a). */
export const nm = (c: Chars): string => c.name || 'a face-down creature';

export const shares = (a: readonly string[], b: readonly string[]): boolean => a.some((x) => b.includes(x));

let active: Map<ObjectId, Chars> | null = null;

/** Run one provider call with a per-call characteristics cache (re-entrant: an inner call shares the outer cache). */
export function cached<T>(fn: () => T): T {
  if (active !== null) return fn();
  active = new Map();
  try {
    return fn();
  } finally {
    active = null;
  }
}

export const objectOf = (g: GameLike, id: ObjectId): GameObject | undefined => g.s.objects[id];

/** The characteristics of a game object (null for an id that is not an object, such as a player). */
export function charsOfId(g: GameLike, id: ObjectId): Chars | null {
  const o = g.s.objects[id];
  if (o === undefined) return null;
  const hit = active?.get(id);
  if (hit !== undefined) return hit;
  const c = charsOfObject(g.s, o);
  active?.set(id, c);
  return c;
}

/** The names of the keywords among `cs` (the dispatcher asks only the hooks of keywords that are present on an involved object). */
export const keywordNames = (...cs: Chars[]): Set<string> => new Set(cs.flatMap((c) => c.keywords.map((k) => k.keyword)));
