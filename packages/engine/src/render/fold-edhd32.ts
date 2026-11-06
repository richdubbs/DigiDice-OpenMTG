/**
 * edh-d-32 (lane pile-open-phase): the folds of its templates (parser/templates/zz-cloud/edh-d-32.json), called from render/fold.ts#foldAt.
 *
 * `oppFaceDownPiles` (CR 700.3, 700.3a, 700.3d, 701.20e, 608.2d; templates eff.edhd32.piles.oppLooksTopFaceDown and eff.edhd32.piles.putOneAndOther; Fortune's Favor, Atris, Oracle of
 * Half-Truths, Sauron's Ransom): "Target opponent looks at the top four cards of your library and separates them into a face-down pile and a face-up pile. Put one pile into your hand
 * and the other into your graveyard.": ANOTHER player looks at your top cards and separates exactly those cards into a face-down and a face-up pile; you choose a pile, put it into one zone
 * and the other pile into another. Only that exact shape (the moves of the two piles read by nothing after).
 */
import type { EffectStep } from '../types/ability';
import { fragment, plain } from './clause';
import { alt } from './text';
import type { Folded } from './fold';
import { K } from './kernel';
import { destPhrase } from './steps-util';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const boundTo = (r: unknown, name: string | undefined): boolean => name !== undefined && same(r, { ref: 'bound', name });

function oppFaceDownPiles(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const l = list[i];
  const p = list[i + 1];
  const m1 = list[i + 2];
  const m2 = list[i + 3];
  if (l?.op !== 'look' || p?.op !== 'piles' || m1?.op !== 'move' || m2?.op !== 'move' || p.faceDown !== true) return null;
  if (l.guard !== undefined || p.guard !== undefined || m1.guard !== undefined || m2.guard !== undefined || m1.until || m2.until || m1.as !== undefined || m2.as !== undefined) return null;
  if (l.who.ref === 'you' || !same(l.at, { ref: 'topCards', player: { ref: 'you' }, count: (l.at as { count: unknown }).count }) || !boundTo(p.cards, l.as)) return null;
  if (!same(p.separator, l.who) || !same(p.chooser, { ref: 'you' }) || !boundTo(m1.what, p.chosen) || !boundTo(m2.what, p.other)) return null;
  const simple = (z: string): boolean => z === 'hand' || z === 'graveyard';
  if (!simple(m1.to.zone) || !simple(m2.to.zone) || m1.to.zone === m2.to.zone) return null;
  if (list.slice(i + 4).some((x) => [l.as, p.chosen, p.other].some((n) => n !== undefined && JSON.stringify(x).includes(`"${n}"`)))) return null;
  const look = fragment(K.clause(l, st));
  K.clause(p, st); // binds the pile names ("one pile", "the other pile")
  const who = K.player(p.separator, st, 'subject');
  // edh-d-69 (CR 608.2c, 700.3; Sauron's Ransom): the chosen player of "Choose an opponent." is also "they" (a plural verb: "they look at ... and separate them")
  const verb = who.person === 'sg' ? (JSON.stringify(l.who) === JSON.stringify({ ref: 'bound', name: 'chosenPlayer' }) ? alt('separates', 'separate') : 'separates') : 'separate';
  const saved = st.actor;
  st.actor = 'you';
  const moves = `put one pile ${destPhrase(m1.to, st, false, true)} and the other ${destPhrase(m2.to, st, false, true)}`;
  st.actor = saved;
  return { clauses: [plain(`${look} and ${verb} them into a face-down pile and a face-up pile. ${moves}`, { standalone: true })], consumed: 4 };
}

const noGuards = (...steps: (EffectStep | undefined)[]): boolean => steps.every((x) => x !== undefined && x.guard === undefined);
const unread = (list: EffectStep[], from: number, names: string[]): boolean => !list.slice(from).some((x) => names.some((n) => JSON.stringify(x).includes(`"${n}"`)));

/**
 * `separateGraveyardCreatures` (CR 700.3, 700.3c, 608.2d; templates eff.edhd32.piles.graveyardCreatures and eff.edhd32.piles.exileChosenReturnOther; Death or Glory): "Separate all creature
 * cards in your graveyard into two piles. Exile the pile of an opponent's choice and return the other to the battlefield.": you separate your graveyard's creature cards, an opponent
 * chooses a pile, which is exiled, and the other pile returns to the battlefield under your control.
 */
function separateGraveyardCreatures(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const p = list[i];
  const m1 = list[i + 1];
  const m2 = list[i + 2];
  if (p?.op !== 'piles' || m1?.op !== 'move' || m2?.op !== 'move' || !noGuards(p, m1, m2) || p.faceDown !== undefined || m1.until || m2.until || m1.as !== undefined || m2.as !== undefined) return null;
  if (!same(p.cards, { ref: 'each', filter: { types: ['Creature'], zone: 'graveyard', owner: 'you', isCard: true } }) || !same(p.separator, { ref: 'you' }) || !same(p.chooser, { ref: 'anOpponent' })) return null;
  if (!boundTo(m1.what, p.chosen) || !boundTo(m2.what, p.other) || !same(m1.to, { zone: 'exile' }) || !same(m2.to, { zone: 'battlefield', controller: { ref: 'you' } }) || !unread(list, i + 3, [p.chosen, p.other])) return null;
  K.clause(p, st); // binds the pile names
  return { clauses: [plain(`separate all creature cards in your graveyard into two piles. exile the pile of an opponent's choice and return the other to the battlefield`, { standalone: true })], consumed: 3 };
}

/**
 * `separateCreaturesDestroyChosen` (CR 700.3, 701.8a, 701.19c, 608.2d; templates eff.edhd32.piles.separateCreatures and eff.edhd32.piles.destroyChosenPile; Do or Die): "Separate all
 * creatures target player controls into two piles. Destroy all creatures in the pile of that player's choice. They can't be regenerated.": that player chooses the pile.
 */
function separateCreaturesDestroyChosen(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const p = list[i];
  const d = list[i + 1];
  if (p?.op !== 'piles' || d?.op !== 'destroy' || !noGuards(p, d) || p.faceDown !== undefined || d.regeneration !== 'cant' || d.boundTo !== undefined || !same(p.separator, { ref: 'you' }) || p.chooser.ref === 'you' || p.chooser.ref === 'each') return null; // review: "each player" would put every player's creatures into one pair of piles
  if (p.cards.ref !== 'each' || !('filter' in p.cards) || !same(p.cards.filter, { types: ['Creature'], controller: p.chooser }) || !boundTo(d.what, p.chosen) || !unread(list, i + 2, [p.chosen, p.other])) return null;
  const who = K.player(p.chooser, st, 'subject');
  if (who.plural) return null;
  K.clause(p, st); // binds the pile names
  return { clauses: [plain(`separate all creatures ${who.text} controls into two piles. destroy all creatures in the pile of that player's choice. they can't be regenerated`, { standalone: true })], consumed: 2 };
}

/**
 * `eachOpponentSeparatesSacrifices` (CR 700.3, 701.21a, 101.4, 608.2d, 608.2f; templates eff.edhd32.piles.eachOpponentSeparatesCreatures, .youChooseTheirPile and
 * .eachOpponentSacrificesChosen; Make an Example): "Each opponent separates the creatures they control into two piles. For each opponent, you choose one of their piles. Each opponent
 * sacrifices the creatures in their chosen pile.": each opponent separates, you choose one pile of each (gathered), then the creatures of the chosen piles are sacrificed.
 */
function eachOpponentSeparatesSacrifices(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const f = list[i];
  const s = list[i + 1];
  if (f?.op !== 'forEach' || s?.op !== 'sacrificeChoice' || !noGuards(f, s) || f.gather === undefined || f.do.length !== 1) return null;
  const p = f.do[0]!;
  if (p.op !== 'piles' || p.guard !== undefined || p.faceDown !== undefined || !same(f.over, { ref: 'each', who: 'opponent' })) return null;
  const it = { ref: 'iterating' };
  if (!same(p.cards, { ref: 'each', filter: { types: ['Creature'], controller: it } }) || !same(p.separator, it) || !same(p.chooser, { ref: 'you' }) || p.chosen !== f.gather) return null;
  if (!same(s.who, { ref: 'each', who: 'opponent' }) || !same(s.filter, { is: { ref: 'bound', name: f.gather } }) || s.count !== 1 || s.mode !== 'all' || s.chooser !== undefined || s.cantAs !== undefined || s.exploit !== undefined || s.keepTypes !== undefined || s.keepFilter !== undefined || !unread(list, i + 2, [p.chosen, p.other])) return null;
  return { clauses: [plain(`each opponent separates the creatures they control into two piles. for each opponent, you choose one of their piles. each opponent sacrifices the creatures in their chosen pile`, { standalone: true })], consumed: 2 };
}

/**
 * `exileSeparateReturnChosen` (CR 700.3, 608.2d, 110.2a, 400.3; templates eff.piles, eff.edhd32.piles.putChosenBattlefieldRestOwners; Boneyard Parley): "Exile up to five target creature cards
 * from graveyards. An opponent separates those cards into two piles. Put all cards from the pile of your choice onto the battlefield under your control and the rest into their owners'
 * graveyards.": the exiled targets are separated by an opponent, you choose a pile, which enters the battlefield under your control; the rest go to their owners' graveyards.
 */
function exileSeparateReturnChosen(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const e = list[i];
  const p = list[i + 1];
  const m1 = list[i + 2];
  const m2 = list[i + 3];
  if (e?.op !== 'move' || p?.op !== 'piles' || m1?.op !== 'move' || m2?.op !== 'move' || !noGuards(e, p, m1, m2) || p.faceDown !== undefined) return null;
  if (!same(e.to, { zone: 'exile' }) || e.until || e.as !== undefined || !same(p.cards, e.what) || !same(p.separator, { ref: 'anOpponent' }) || !same(p.chooser, { ref: 'you' })) return null;
  if (!boundTo(m1.what, p.chosen) || !boundTo(m2.what, p.other) || m1.as !== undefined || m2.as !== undefined || m1.until || m2.until) return null;
  if (!same(m1.to, { zone: 'battlefield', controller: { ref: 'you' } }) || !same(m2.to, { zone: 'graveyard' }) || !unread(list, i + 4, [p.chosen, p.other])) return null;
  const exile = fragment(K.clause(e, st)).replace(/ from an? graveyard\b/g, ' from graveyards');
  K.clause(p, st); // binds the pile names
  return { clauses: [plain(`${exile}. an opponent separates those cards into two piles. put all cards from the pile of your choice onto the battlefield under your control and the rest into their owners' graveyards`, { standalone: true })], consumed: 4 };
}

/**
 * `revealSeparatePickOne` (CR 700.3, 701.20a, 608.2d, 401.4; templates eff.stdrx30.reveal.separate.twoPiles, rid.r5dig.opponentChoosesPile, eff.edhd32.piles.putCardFromChosenThenRestBottom; Truth or
 * Tale): "Reveal the top five cards of your library and separate them into two piles. An opponent chooses one of those piles. Put a card from the chosen pile into your hand, then put all other
 * cards revealed this way on the bottom of your library in any order.": you reveal and separate, an opponent chooses a pile, you take one card of it, and the other revealed cards go to the
 * bottom in the order you choose.
 */
function revealSeparatePickOne(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const r = list[i];
  const p = list[i + 1];
  const c = list[i + 2];
  const m1 = list[i + 3];
  const m2 = list[i + 4];
  if (r?.op !== 'reveal' || p?.op !== 'piles' || c?.op !== 'chooseObjects' || m1?.op !== 'move' || m2?.op !== 'move' || !noGuards(r, p, c, m1, m2) || p.faceDown !== undefined) return null;
  if (r.as === undefined || r.to !== undefined || !same(r.who, { ref: 'you' }) || r.what.ref !== 'topCards' || !same(r.what.player, { ref: 'you' }) || !boundTo(p.cards, r.as) || !same(p.separator, { ref: 'you' }) || !same(p.chooser, { ref: 'anOpponent' })) return null;
  if (c.min !== 1 || c.max !== 1 || c.as === undefined || !same(c.who, { ref: 'you' }) || !same(c.from, { ref: 'each', filter: { is: { ref: 'bound', name: p.chosen }, zone: 'library' } })) return null;
  if (!boundTo(m1.what, c.as) || !same(m1.to, { zone: 'hand' }) || m1.as !== undefined || m2.as !== undefined || m1.until || m2.until) return null;
  if (!same(m2.what, { ref: 'each', filter: { is: { ref: 'bound', name: r.as }, not: { is: { ref: 'bound', name: c.as } }, zone: 'library' } }) || !same(m2.to, { zone: 'library', position: 'bottom', order: 'chosen' })) return null;
  if (!unread(list, i + 5, [r.as, p.chosen, p.other, c.as])) return null;
  const reveal = fragment(K.clause(r, st));
  K.clause(p, st); // binds the pile names
  return { clauses: [plain(`${reveal} and separate them into two piles. an opponent chooses one of those piles. put a card from the chosen pile into your hand, then put all other cards revealed this way on the bottom of your library in any order`, { standalone: true })], consumed: 5 };
}

export function foldEdhD32(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return oppFaceDownPiles(list, i, st) ?? separateGraveyardCreatures(list, i, st) ?? separateCreaturesDestroyChosen(list, i, st) ?? eachOpponentSeparatesSacrifices(list, i, st) ?? exileSeparateReturnChosen(list, i, st) ?? revealSeparatePickOne(list, i, st);
}
