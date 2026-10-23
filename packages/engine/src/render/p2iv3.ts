/**
 * p2-intervening-3 (lane p2-intervening): the words of the conditions parser/holes/p2iv3.ts reads (CR 603.4 intervening "if" clauses), called from render/cond.ts
 * (the `all` / `any` case and the zone-change history). Null for any other shape.
 */
import type { Condition } from '../types/ability';
import { alt, numWord } from './text';

const json = (v: unknown): string => JSON.stringify(v);
const COLORS = ['W', 'U', 'B', 'R', 'G'];
/** parser/holes/p2iv3.ts#ATTACKING_MOST_LIFE (render imports no parser module, design 5.4). */
const ATTACKING_MOST_LIFE = {
  cond: 'all',
  of: [
    { cond: 'matches', object: { ref: 'self' }, filter: { attacking: { defender: 'opponent' } } },
    { cond: 'compare', left: { q: 'countPlayers', of: { ref: 'each', who: 'player' }, lifeVs: { op: '>', than: { ref: 'defending' } } }, op: '==', right: 0 },
  ],
};

/** "it's attacking the player with the most life or tied for most life"; "at least three mana of the same color was spent to cast it". */
export function p2iv3AllAny(c: Extract<Condition, { cond: 'all' | 'any' }>): string | null {
  if (json(c) === json(ATTACKING_MOST_LIFE)) return alt("it's attacking the player with the most life or tied for most life", 'it is attacking the player with the most life or tied for most life');
  if (c.cond !== 'any' || c.of.length !== 5) return null;
  const spent = c.of.map((x) => (x.cond === 'wasCast' && x.spent !== undefined && Object.keys(x).length === 2 ? x.spent : null));
  const n = spent[0]?.atLeast;
  if (n === undefined || spent.some((s, i) => s === null || s.color !== COLORS[i] || s.atLeast !== n)) return null;
  return `at least ${numWord(n)} mana of the same color was spent to cast it`;
}

/** "a permanent was put into your hand from the battlefield this turn" (CR 400.3), beside the generic words of the zone-change history. */
export function p2iv3Moved(c: Extract<Condition, { cond: 'happened' }>, generic: string): string {
  const mine = json(c) === json({ cond: 'happened', event: { ev: 'zoneChange', subject: { owner: 'you' }, from: 'battlefield', to: 'hand' }, scope: 'turn' })
    ? 'a permanent was put into your hand from the battlefield this turn' : null;
  return mine === null ? generic : alt(generic, mine);
}
