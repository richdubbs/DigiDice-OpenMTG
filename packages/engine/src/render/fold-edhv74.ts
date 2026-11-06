/**
 * edh-c-74 (Commander lane edh-c): the folds of its templates (parser/templates/zz-cloud/edh-c-74.json), called from render/fold.ts#foldAt. Each applies only when every part is
 * exactly what the idiom says.
 *
 * `controllerSacrificesOneOfTargets` (CR 701.21a, 608.2d, 115.1; Incriminate, eff.edhv74.player.sacrificesOneOf.theirChoice): "That player sacrifices one of them of their choice." after
 * "Choose two target creatures controlled by the same player.": the one controller of the targets chooses one of the targets (the whole set, named by its target id) and sacrifices it.
 */
import type { EffectStep, PlayerRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function controllerSacrificesOneOfTargets(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'sacrificeChoice' || s.guard !== undefined || s.mode !== undefined || s.cantAs !== undefined || s.exploit !== undefined || s.keepTypes !== undefined || s.keepFilter !== undefined || s.chooser !== undefined || s.as !== undefined) return null;
  if (s.count !== 1 || s.who.ref !== 'controllerOf' || s.who.object.ref !== 'target' || !same(Object.keys(s.filter), ['is']) || !same(s.filter.is, s.who.object)) return null;
  const id = s.who.object.id;
  const spec = st.specs.get(id);
  if (spec?.kind !== 'object' || spec.sameController !== true || spec.max !== 2 || spec.min !== 2 || spec.filter?.controller !== undefined || !st.mentioned.has(`t:${id}`)) return null;
  return { clauses: [plain('that player sacrifices 1 of them of their choice', { standalone: true })], consumed: 1 };
}

/**
 * `revealHandAndTopChooseBottom` (CR 701.20a, 701.20e, 401.4, 608.2d; Psychotic Episode, eff.edhv74.player.reveals.handAndTop + eff.edhv74.you.choose.revealedThisWay +
 * eff.edhv74.player.puts.chosen.bottom): "Target player reveals their hand and the top card of their library. You choose a card revealed this way. That player puts the chosen card on
 * the bottom of their library.": the reveal of a hand and of the top card (bound `revealedHand`, `revealedTop`), your choice of one card of either, and its move to the bottom of the
 * library of its owner. Exactly those four steps.
 */
function revealHandAndTopChooseBottom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [h, t, c, m] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (h?.op !== 'reveal' || t?.op !== 'reveal' || c?.op !== 'chooseObjects' || m?.op !== 'move') return null;
  if (h.guard !== undefined || t.guard !== undefined || c.guard !== undefined || m.guard !== undefined || h.as !== 'revealedHand' || t.as !== 'revealedTop' || h.to !== undefined || t.to !== undefined) return null;
  if (!same(h.who, t.who) || h.who.ref !== 'target' || !same(h.what, { ref: 'each', filter: { zone: 'hand', owner: h.who } }) || !same(t.what, { ref: 'topCards', player: h.who, count: 1 })) return null;
  if (c.as !== 'chosen' || c.random === true || c.groupLimit !== undefined || c.perPlayer !== undefined || c.startingWith !== undefined || !same(c.who, { ref: 'you' }) || c.min !== 1 || c.max !== 1) return null;
  if (!same(c.from, { ref: 'union', of: [{ ref: 'bound', name: 'revealedHand' }, { ref: 'bound', name: 'revealedTop' }] })) return null;
  if (m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || !same(m.what, { ref: 'bound', name: 'chosen' }) || !same(m.to, { zone: 'library', position: 'bottom' })) return null;
  if (list.slice(i + 4).some((x) => JSON.stringify(x).includes('"name":"chosen"'))) return null;
  const who = K.player(h.who as PlayerRef, st, 'subject');
  if (who.person !== 'sg') return null;
  bind(st, 'chosen', { nouns: ['card'], plural: false });
  return { clauses: [plain(`${who.text} reveals their hand and the top card of their library. you choose 1 card revealed this way. that player puts the chosen card on the bottom of their library`, { standalone: true })], consumed: 4 };
}

/**
 * `revealHandDiscardAllThatSpellsMv` (CR 701.20a, 701.9a, 202.3, 603.2; Infernal Kirin, eff.edhv74.player.reveals.hand.discardsAll.thatSpellsMv): "Target player reveals their hand and discards all cards
 * with that spell's mana value.": the reveal of a hand (bound `revealedHand`) and the discard of every card of it with the mana value of the spell the trigger is about. Exactly those two steps.
 */
function revealHandDiscardAllThatSpellsMv(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [r, d] = [list[i], list[i + 1]];
  if (r?.op !== 'reveal' || d?.op !== 'discard' || r.guard !== undefined || d.guard !== undefined || r.as !== 'revealedHand' || r.to !== undefined || r.who.ref !== 'target' || !same(d.who, r.who)) return null;
  if (!same(r.what, { ref: 'each', filter: { zone: 'hand', owner: r.who } }) || d.mode !== undefined || d.cantAs !== undefined) return null;
  const filter = { manaValue: { op: '==', value: { q: 'stat', stat: 'manaValue', of: { ref: 'event', role: 'spell' } } }, zone: 'any', owner: r.who, is: { ref: 'bound', name: 'revealedHand' } };
  const want = { ...filter, owner: undefined };
  const f = d.filter as Record<string, unknown> | undefined;
  if (f === undefined || !same({ manaValue: f['manaValue'], zone: f['zone'], is: f['is'] }, { manaValue: want.manaValue, zone: 'any', is: want.is }) || Object.keys(f).length !== 4 || !same(f['owner'], r.who)) return null;
  if (!same(d.count, { q: 'count', of: { ref: 'each', filter: f } })) return null;
  const who = K.player(r.who as PlayerRef, st, 'subject');
  if (who.person !== 'sg') return null;
  return { clauses: [plain(`${who.text} reveals their hand and discards all cards with that spell's mana value`, { standalone: true })], consumed: 2 };
}

export function foldEdhV74(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return controllerSacrificesOneOfTargets(list, i, st) ?? revealHandAndTopChooseBottom(list, i, st) ?? revealHandDiscardAllThatSpellsMv(list, i, st);
}
