/**
 * edh-d-97 (Commander coordinator D, band 5,001-10,000, graveyard-exile-cast part 2): the folds of this round's templates, called from render/fold.ts#foldAtPlain. Each returns null
 * for any other shape (the general renderers then say it or refuse).
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';
import { K } from './kernel';
import { parseMarked, serializeMarked, type MarkedNode } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** CR 400.1, 404.1, 402.1: a permanent you control, or a card in your hand or your graveyard (template eff.edhd97.forEachLifeLost.exilePermanentOrHandGraveyard). */
export const PERMANENT_OR_HAND_OR_GRAVEYARD = { anyOf: [{ zone: 'battlefield', controller: 'you' }, { zone: 'hand', owner: 'you', isCard: true }, { zone: 'graveyard', owner: 'you', isCard: true }], zone: ['battlefield', 'hand', 'graveyard'] };

/**
 * CR 119.3, 608.2c, 406.2 (Lich's Mastery and its rulings 2018-04-27): "for each 1 life you lost, exile a permanent you control or a card from your hand or graveyard": you choose as many of
 * your permanents and cards in your hand and graveyard as the life the triggering loss took (all of them when there are fewer, from any mix of the three), then exile them. Exactly the
 * two steps the template builds.
 */
function exileForEachLifeLost(list: EffectStep[], i: number): Folded | null {
  const [choose, move] = [list[i], list[i + 1]];
  if (choose?.op !== 'chooseObjects' || move?.op !== 'move') return null;
  const amount = { q: 'eventAmount' };
  if (!same(choose, { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: PERMANENT_OR_HAND_OR_GRAVEYARD }, min: amount, max: amount, as: choose.as })) return null;
  if (!same(move, { op: 'move', what: { ref: 'bound', name: choose.as }, to: { zone: 'exile' } })) return null;
  return { clauses: [plain('for each 1 life you lost, exile a permanent you control or a card from your hand or graveyard', { standalone: true })], consumed: 2 };
}

/**
 * CR 400.7a, 400.7h, 611.2c (Strago and Relm, template eff.edhd97.creatureCastThisWay.gains): "If you cast a creature spell this way, it gains haste and "At the beginning of the end step,
 * sacrifice this creature."": a lasting effect (no duration) on the spell the earlier cast of the ability cast when that spell is a creature spell (the permanent it becomes keeps it,
 * CR 400.7a). Said by render/steps-lasting.ts for the one `effect` step of that shape; null for any other.
 */
export function creatureCastThisWayGains(s: Extract<EffectStep, { op: 'effect' }>, st: RenderState): string | null {
  const c = s.effects[0];
  if (s.effects.length !== 1 || !same(s.duration, { d: 'permanent' }) || c?.s !== 'continuous' || c.mods.length !== 1 || Object.keys(c).some((k) => !['s', 'affects', 'mods'].includes(k))) return null;
  const a = c.affects;
  if (a.ref !== 'each' || !('filter' in a)) return null;
  const is = a.filter.is;
  if (is?.ref !== 'bound' || !same(a.filter, { is, types: ['Creature'], zone: 'stack' })) return null;
  const m = c.mods[0]!;
  if (m.layer !== 6 || m.add === undefined || m.add.length === 0 || Object.keys(m).some((k) => k !== 'layer' && k !== 'add')) return null;
  // the abilities as the general renderer says them for an object it names by itself ("~ gains haste and ..."), the subject of every reading then said "it" (the spell the sentence's
  // own condition just named): the words are those of the step, never a binding of the spell's own
  const gains = K.clause({ op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [m] }] } as EffectStep, st).sub;
  let ok = true;
  const startIt = (nodes: MarkedNode[]): MarkedNode[] => {
    const [first, ...rest] = nodes;
    if (typeof first === 'string') {
      if (first.startsWith('~')) return [`it${first.slice(1)}`, ...rest];
      if (!/^it\b/.test(first)) ok = false;
      return nodes;
    }
    if (first === undefined) { ok = false; return nodes; }
    return [{ alts: first.alts.map(startIt) }, ...rest];
  };
  const it = serializeMarked(startIt(parseMarked(gains)));
  return ok ? `if you cast a creature spell this way, ${it}` : null;
}

/** The folds of this round's templates. */
export function foldEdhD97(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  return exileForEachLifeLost(list, i);
}
