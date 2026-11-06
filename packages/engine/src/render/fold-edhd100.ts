/**
 * edh-d-100 (Commander coordinator D, MUST-FINISH round of the EDHREC band 5,001-10,000): the folds of its templates (parser/templates/zz-cloud/edh-d-100.json), called from
 * render/fold.ts#foldAt. Each applies only when every part is exactly what the template builds.
 *
 * `exileCastSpellThenMayCastOther` (CR 607.2a, 608.2c, 608.2g, 118.9; Knowledge Pool): "that player exiles it. If the player does, they may cast a spell from among other cards exiled with
 * ~ without paying its mana cost.": the spell of a cast trigger is exiled (and linked to the source), and only if it was, the player who cast it may cast one nonland card the source
 * exiled other than that one, free. A card exiled from the stack is exiled the same whoever exiles it (family owner-exiles-chosen-card), so "that player" is the move's wording only.
 *
 * `lookTopOfEachOpponentExileFaceDown` (CR 406.3, 406.3a, 608.2c; Lobelia, Defender of Bag End): "look at the top card of each opponent's library and exile those cards face down": you look
 * at one card of each opponent's library, then every card you looked at is exiled face down (you may keep looking at them, CR 406.3: zones-move.ts#performExiledSeers). Exactly the look
 * and the move the template builds.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const EVENT_PLAYER = { ref: 'event', role: 'player' };
/** The step without its display data (the sentence it came from). */
const strip = (x: object): Record<string, unknown> => Object.fromEntries(Object.entries(x).filter(([key, v]) => v !== undefined && key !== 'sentence' && key !== 'span'));

function exileCastSpellThenMayCastOther(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [m, f] = [list[i], list[i + 1]];
  if (m?.op !== 'move' || f?.op !== 'if' || m.guard !== undefined || f.guard !== undefined || f.else !== undefined || f.intervening !== undefined) return null;
  if (!same(strip(m), { op: 'move', what: { ref: 'event', role: 'spell' }, to: { zone: 'exile' }, link: 'exiled', as: 'kpExiled' })) return null;
  if (!same(f.cond, { cond: 'did', step: 'kpExiled' }) || f.then.length !== 2) return null;
  const [c, k] = f.then;
  if (c?.op !== 'chooseObjects' || k?.op !== 'cast' || c.guard !== undefined || k.guard !== undefined) return null;
  if (!same(strip(c), { op: 'chooseObjects', who: EVENT_PLAYER, from: { ref: 'each', filter: { notTypes: ['Land'], is: { ref: 'linked', link: 'exiled' }, zone: 'exile', not: { is: { ref: 'bound', name: 'kpExiled' } } } }, min: 0, max: 1, as: 'cast' })) return null;
  if (!same(strip(k), { op: 'cast', who: EVENT_PLAYER, what: { ref: 'bound', name: 'cast' }, free: true })) return null;
  const me = K.obj({ ref: 'self' }, st, 'object').text;
  return { clauses: [plain(`that player exiles it. if the player does, they may cast a spell from among other cards exiled with ${me} without paying its mana cost`, { standalone: true })], consumed: 2 };
}

function lookTopOfEachOpponentExileFaceDown(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'look' || b?.op !== 'move' || typeof a.as !== 'string') return null;
  if (!same(strip(a), { op: 'look', who: { ref: 'you' }, at: { ref: 'topCards', player: { ref: 'each', who: 'opponent' }, count: 1 }, as: a.as })) return null;
  if (!same(strip(b), { op: 'move', what: { ref: 'bound', name: a.as }, to: { zone: 'exile', faceDown: true }, ...(b.link !== undefined ? { link: b.link } : {}) })) return null;
  return { clauses: [plain("look at the top card of each opponent's library and exile those cards face down")], consumed: 2 };
}

export function foldEdhD100(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return exileCastSpellThenMayCastOther(list, i, st) ?? lookTopOfEachOpponentExileFaceDown(list, i, st);
}
