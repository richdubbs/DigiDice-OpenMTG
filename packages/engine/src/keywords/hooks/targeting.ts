/**
 * The targeting part shared by shroud, hexproof and protection (CR 115.1). Milestone 4 decided all three in one predicate (`rules/protection.ts#canBeTargeted`);
 * each keyword's hook now asks that SAME predicate about the target as though it had only that keyword, so each keyword answers (and cites) its own rule and the
 * rules code stays single. The keywords function on the battlefield only (CR 113.6, 702.16a); players have none yet.
 */
import { charsOfObject, type Chars } from '../../rules/characteristics';
import { deny, waivable } from '../../rules/denial';
import type { Denial } from '../../rules/denial';
import type { GameLike } from '../../rules/hookpoints';
import { canBeTargeted } from '../../rules/protection';
import type { ObjectId, PlayerId } from '../../types/ids';
import { charsOfId, nm, objectOf } from './common';

/** `source` is the spell or the permanent with the ability; an object that has left the game is read from last known information (null: unknown). */
function sourceChars(g: GameLike, source: ObjectId | null): Chars | null {
  if (source === null) return null;
  const src = g.s.objects[source] ?? g.s.lki[source]?.object;
  return src ? charsOfObject(g.s, src) : null;
}

export function targetingDenial(g: GameLike, target: ObjectId | PlayerId, source: ObjectId | null, controller: PlayerId, keyword: string, why: string, ...rules: string[]): Denial | null {
  const t = objectOf(g, target);
  if (t === undefined || t.zone !== 'battlefield') return null;
  const tc = charsOfId(g, target);
  if (tc === null) return null;
  const only: Chars = { ...tc, keywords: tc.keywords.filter((k) => k.keyword === keyword) };
  if (only.keywords.length === 0 || canBeTargeted(only, t.controller, sourceChars(g, source), controller)) return null;
  const d = deny(`${nm(tc)} can't be the target of that spell or ability (${why}).`, 'CR 115.1', ...rules);
  return keyword === 'hexproof' ? waivable(d, 'targetAsThoughNoHexproof') : d; // std-rx32 (CR 702.11b): "as though it didn't have hexproof" waives it (statics/hooks.ts#permits)
}
