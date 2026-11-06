/**
 * edh-mana-keywords-11 (lane edh-mana-keywords): the folds of its templates (parser/templates/zz-cloud/edh-mana-keywords-11.json), called from render/fold.ts#foldAt.
 *
 * `counterExileWithCountersGainsSuspend` (CR 701.6a, 614.15, 122.1, 702.62a, 611.2c; Delay): "Counter target spell. If the spell is countered this way, exile it with three time
 * counters on it instead of putting it into its owner's graveyard. If it doesn't have suspend, it gains suspend." The counter of a spell with the card it became in exile named,
 * time counters on it, then a permanent grant of suspend to that card when it doesn't have the keyword. Only that exact shape: no guard, no `toIf`, no `sourceEffect`, exile with
 * time counters and nothing else, and the `if` on that name with no `else`.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind, byPlayer } from './steps-util';

/**
 * `exileRandomFromHand` (CR 701.13a, 608.2d, 400.3; Rona, Tolarian Obliterator): "that source's controller exiles a card from their hand at random": one card of that player's hand
 * chosen at random, then exiled; "it" names the exiled card afterwards. Only that exact shape: one player (a group would pick among all their hands), exactly one card, no description.
 */
function exileRandomFromHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.as === undefined || a.random !== true || a.guard !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  if (a.min !== 1 || a.max !== 1 || a.who.ref === 'each' || a.who.ref === 'eachWho') return null;
  if (b.guard !== undefined || b.until !== undefined || b.link !== undefined || b.remember !== undefined || b.as === undefined || JSON.stringify(b.what) !== JSON.stringify({ ref: 'bound', name: a.as })) return null;
  if (JSON.stringify(b.to) !== JSON.stringify({ zone: 'exile' })) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from) || a.from.filter === undefined) return null;
  const f = a.from.filter;
  if (Object.keys(f).some((k) => k !== 'zone' && k !== 'owner') || f.zone !== 'hand' || JSON.stringify(f.owner) !== JSON.stringify(a.who)) return null;
  if (JSON.stringify(list.slice(i + 2)).includes(`"name":"${b.as}"`)) return null; // the later sentences read the chosen name (the parser's binding), never the exiled one
  const clause = byPlayer(a.who, st, 'exile', 'a card from their hand at random', { standalone: true });
  bind(st, a.as, { nouns: ['card'], plural: false, zone: 'exile' }); // after the clause is written: "it" names the card exiled (the chosen card, which the move re-bases)
  return { clauses: [clause], consumed: 2 };
}

export function foldEdhMk11(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const rona = exileRandomFromHand(list, i, st);
  if (rona !== null) return rona;
  const a = list[i];
  if (a?.op !== 'counter' || a.guard !== undefined || a.toIf !== undefined || a.sourceEffect !== undefined || a.as === undefined || a.to === undefined) return null;
  const to = a.to as { zone: string; counters?: { kind: string; count: unknown }[] };
  if (to.zone !== 'exile' || Object.keys(to).some((k) => k !== 'zone' && k !== 'counters') || to.counters?.length !== 1) return null;
  const c = to.counters[0]!;
  if (c.kind !== 'time' || typeof c.count !== 'number' || c.count < 1) return null;
  const exiled = { ref: 'bound', name: a.as };
  const gain = { op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: exiled, mods: [{ layer: 6, add: [{ kind: 'keyword', keyword: 'suspend', text: 'suspend' }] }] }] };
  const want = { op: 'if', cond: { cond: 'not', of: { cond: 'matches', object: exiled, filter: { keyword: 'suspend' } } }, then: [gain] };
  if (JSON.stringify(list[i + 1]) !== JSON.stringify(want) || JSON.stringify(list.slice(i + 2)).includes(`"name":"${a.as}"`)) return null;
  const what = K.obj(a.what, st, 'object').text;
  if (!/^target ([a-z]+ )?spell$/.test(what)) return null;
  const counters = `${K.qty(c.count, st)} time counter${c.count === 1 ? '' : 's'}`;
  bind(st, a.as, { nouns: ['card'], plural: false, zone: 'exile' });
  return { clauses: [plain(`counter ${what}. if the spell is countered this way, exile it with ${counters} on it instead of putting it into its owner's graveyard. if it doesn't have suspend, it gains suspend`, { standalone: true })], consumed: 2 };
}
