/**
 * std-copy-6 (lane std-copy): the folds of its templates (parser/templates/zz-cloud/std-copy-6.json), called from render/fold.ts#foldAt.
 *
 * `copyThenExileSpellCast` (CR 707.10, 608.2c, 122.1, 702.62a-b): "copy it, then exile the spell you cast with four time counters on it. If it doesn't have suspend, it
 * gains suspend." (Taigam, Master Opportunist): a copy of the spell of the cast event; the move of that same spell from the stack to exile with time counters on it,
 * named; then, if the card it became doesn't have suspend, a permanent grant of suspend to it. Oracle names the spell a second time as "the spell you cast" (the copy
 * is a spell too) and the exiled card "it". Only that exact shape: the copy with nothing else (no count, exception, new targets, guard or name), the move with no
 * guard and no duration, exile with time counters, and the `if` on that name with no `else`.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';

const EVENT_SPELL = JSON.stringify({ ref: 'event', role: 'spell' });

function copyThenExileSpellCast(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'copy' || a.result !== 'spell' || JSON.stringify(a.what) !== EVENT_SPELL || JSON.stringify(a.who) !== JSON.stringify({ ref: 'you' })) return null;
  if (a.count !== undefined || a.except !== undefined || a.newTargets !== undefined || a.noManaCost !== undefined || a.guard !== undefined || a.as !== undefined) return null;
  if (b?.op !== 'move' || JSON.stringify(b.what) !== EVENT_SPELL || b.guard !== undefined || b.until !== undefined || b.link !== undefined || b.remember !== undefined) return null;
  const to = b.to as { zone: string; counters?: { kind: string; count: unknown }[] };
  if (to.zone !== 'exile' || Object.keys(to).some((k) => k !== 'zone' && k !== 'counters') || to.counters?.length !== 1) return null;
  const c = to.counters[0]!;
  if (c.kind !== 'time' || typeof c.count !== 'number' || c.count < 1 || b.as === undefined) return null;
  const exiled = { ref: 'bound', name: b.as };
  const gain = { op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: exiled, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'suspend', text: 'suspend' }] }] }] };
  const want = { op: 'if', cond: { cond: 'not', of: { cond: 'matches', object: exiled, filter: { keyword: 'suspend' } } }, then: [gain] };
  if (JSON.stringify(list[i + 2]) !== JSON.stringify(want) || JSON.stringify(list.slice(i + 3)).includes(`"name":"${b.as}"`)) return null;
  const it = K.obj(a.what, st, 'object').text;
  const counters = `${K.qty(c.count, st)} time counter${c.count === 1 ? '' : 's'}`;
  bind(st, b.as, { nouns: ['card'], plural: false, zone: 'exile' });
  return { clauses: [plain(`copy ${it}, then exile the spell you cast with ${counters} on it. if it doesn't have suspend, it gains suspend`, { standalone: true })], consumed: 3 };
}

export function foldStdCopy6(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return copyThenExileSpellCast(list, i, st);
}
