/**
 * edh-zones-18 (Commander lane edh-zones): the folds of its templates (parser/templates/zz-cloud/edh-zones-18.json), called from render/fold.ts#foldAt. Each applies only when
 * every part is exactly what the idiom says.
 *
 * `manaLifeForEachRevealed` (CR 701.20a, 106.1, 119.3, 605.1a, 608.2c; Selvala, Explorer Returned): "For each nonland card revealed this way, add {G} and you gain 1 life.":
 * an amount of one type of mana and the same amount of life, both counted over the cards an earlier reveal revealed. Exactly the two steps of template
 * eff.edhz18.mana.lifeForEachRevealed.
 *
 * `revealHandOrTop` (CR 701.20a, 401.2, 402.3, 608.2d; Eladamri, Korvecdal): "Reveal a card from your hand or the top card of your library.": the choice of one card among the
 * cards in your hand and the top card of your library, and the reveal of the card chosen. Exactly the two steps of template eff.edhz18.revealHandOrTop.
 *
 * `eachPlayerLooksMayRevealLandSpell` (CR 701.20a, 701.20e, 401.4, 608.2c; Explore the Vastlands): "Each player looks at the top five cards of their library and may reveal a land card
 * and/or an instant or sorcery card from among them. Each player puts the cards they revealed this way into their hand and the rest on the bottom of their library in a random
 * order.": for each player in turn, the look, the two optional choices of one card each, the reveal of what was chosen, the cards revealed into the hand and the rest of the cards
 * looked at on the bottom of the library in a random order. Exactly the one step of template eff.edhz18.eachPlayer.lookMayRevealLandAndOrSpell.handRestBottom.
 *
 * `mayFetchArtifactOutsideOrExile` (CR 400.11, 400.11b, 701.20a, 406.3, 608.2c, 608.2d; Karn, the Great Creator): "You may reveal an artifact card you own from outside the game or
 * choose a face-up artifact card you own in exile. Put that card into your hand.": the choice of where the card comes from, the card fetched from outside the game (revealed and
 * put into the hand) or the face-up artifact card in exile put into the hand. Exactly the one step of template eff.edhz18.mayFetchArtifactOutsideOrExile.toHand.
 *
 * `ifRevealedCreaturePut` (CR 701.20a, 608.2c, 110.2a; Eladamri, Korvecdal): "If you reveal a creature card this way, put it onto the battlefield.": the card the reveal of
 * `revealHandOrTop` revealed, when it is a creature card (it is in your hand or your library, where it was revealed), is put onto the battlefield under your control. Exactly
 * the one step of template eff.edhz18.ifRevealedCreatureThisWay.putBattlefield.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { countParts } from './qty';
import { numWord } from './text';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function manaLifeForEachRevealed(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'addMana' || b?.op !== 'gainLife' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  if (!same(a.who, { ref: 'you' }) || !same(b.who, { ref: 'you' }) || Object.keys(a).length !== 3 || Object.keys(b).length !== 3) return null;
  const d = a.dynamic;
  if (d === undefined || d.kind !== 'ofType' || Object.keys(d).length !== 3 || typeof d.count === 'number' || !same(d.count, b.amount)) return null;
  const q = d.count;
  if (q.q !== 'count' || q.of.ref !== 'each' || q.of.filter.is?.ref !== 'bound' || st.info.get(`b:${q.of.filter.is.name}`)?.thisWay !== 'revealed this way') return null;
  const parts = countParts(q, st);
  if (parts === null) return null;
  return { clauses: [plain(`for each ${parts.singular}, add {${d.type.toLowerCase()}} and you gain 1 life`, { standalone: true })], consumed: 2 };
}

function revealHandOrTop(list: EffectStep[], i: number): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'reveal' || a.guard !== undefined || b.guard !== undefined || typeof a.as !== 'string' || b.as === undefined) return null;
  if (!same(a.who, { ref: 'you' }) || !same(b.who, { ref: 'you' }) || a.min !== 1 || a.max !== 1 || !same(b.what, { ref: 'bound', name: a.as }) || b.to !== undefined) return null;
  if (!same(a.from, { ref: 'union', of: [{ ref: 'each', filter: { zone: 'hand', owner: 'you' } }, { ref: 'topCards', player: { ref: 'you' }, count: 1 }] })) return null;
  if (Object.keys(a).length !== 6 || Object.keys(b).length !== 4) return null;
  return { clauses: [plain('reveal a card from your hand or the top card of your library', { standalone: true })], consumed: 2 };
}

const bound = (name: string) => ({ ref: 'bound', name });
function eachPlayerLooksMayRevealLandSpell(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'forEach' || a.guard !== undefined || a.as !== 'zonesPlayer' || a.gather !== undefined || !same(a.over, { ref: 'each', who: 'player' }) || a.do.length !== 6 || Object.keys(a).length !== 4) return null;
  const [look, land, spell, reveal, hand, rest] = a.do;
  const p = bound('zonesPlayer');
  if (look?.op !== 'look' || !same(look.who, p) || look.as !== 'zonesSeen' || look.at.ref !== 'topCards' || !same(look.at.player, p) || look.at.allButBottom !== undefined || Object.keys(look).length !== 4) return null;
  if (land?.op !== 'chooseObjects' || !same(land.who, p) || land.min !== 0 || land.max !== 1 || land.as !== 'zonesLand' || Object.keys(land).length !== 6
    || !same(land.from, { ref: 'each', filter: { types: ['Land'], isCard: true, is: bound('zonesSeen'), zone: 'library' } })) return null;
  if (spell?.op !== 'chooseObjects' || !same(spell.who, p) || spell.min !== 0 || spell.max !== 1 || spell.as !== 'zonesSpell' || Object.keys(spell).length !== 6
    || !same(spell.from, { ref: 'each', filter: { anyOf: [{ types: ['Instant'] }, { types: ['Sorcery'] }], isCard: true, is: bound('zonesSeen'), zone: 'library' } })) return null;
  if (reveal?.op !== 'reveal' || !same(reveal.who, p) || reveal.as !== 'zonesRevealed' || reveal.to !== undefined || Object.keys(reveal).length !== 4 || !same(reveal.what, { ref: 'union', of: [bound('zonesLand'), bound('zonesSpell')] })) return null;
  if (hand?.op !== 'move' || !same(hand.what, bound('zonesRevealed')) || !same(hand.to, { zone: 'hand' }) || Object.keys(hand).length !== 3) return null;
  if (rest?.op !== 'move' || !same(rest.what, { ref: 'each', filter: { is: bound('zonesSeen'), zone: 'library' } }) || !same(rest.to, { zone: 'library', position: 'bottom', order: 'random' }) || Object.keys(rest).length !== 3) return null;
  const n = look.at.count;
  const count = typeof n === 'number' ? numWord(n) : K.qty(n, st);
  return { clauses: [
    plain(`each player looks at the top ${count} cards of their library and may reveal a land card and/or an instant or sorcery card from among them`, { standalone: true }),
    plain('each player puts the cards they revealed this way into their hand and the rest on the bottom of their library in a random order', { standalone: true }),
  ], consumed: 1 };
}

function mayFetchArtifactOutsideOrExile(list: EffectStep[], i: number): Folded | null {
  const a = list[i];
  if (a?.op !== 'may' || a.guard !== undefined || a.as !== undefined || !same(a.who, { ref: 'you' }) || a.do.length !== 2 || Object.keys(a).length !== 3) return null;
  const [pick, branch] = a.do;
  const you = { ref: 'you' };
  if (pick?.op !== 'chooseValue' || !same(pick, { op: 'chooseValue', who: you, what: 'option', options: ['outside', 'exile'], as: 'karnSource', link: 'karnSource' })) return null;
  if (branch?.op !== 'if' || branch.guard !== undefined || branch.as !== undefined || Object.keys(branch).length !== 4 || !same(branch.cond, { cond: 'chosen', link: 'karnSource', equals: 'outside' })) return null;
  if (!same(branch.then, [{ op: 'fromOutside', who: you, filter: { types: ['Artifact'] }, reveal: true }])) return null;
  if (!same(branch.else, [
    { op: 'chooseObjects', who: you, from: { ref: 'each', filter: { types: ['Artifact'], isCard: true, owner: 'you', zone: 'exile', faceDown: false } }, min: 1, max: 1, as: 'karnPick' },
    { op: 'move', what: bound('karnPick'), to: { zone: 'hand' } },
  ])) return null;
  return { clauses: [plain('you may reveal an artifact card you own from outside the game or choose a face-up artifact card you own in exile', { standalone: true }), plain('put that card into your hand', { standalone: true })], consumed: 1 };
}

function ifRevealedCreaturePut(list: EffectStep[], i: number): Folded | null {
  const a = list[i];
  if (a?.op !== 'if' || a.guard !== undefined || a.as !== undefined || a.else !== undefined || a.then.length !== 1 || Object.keys(a).length !== 3) return null;
  const bound = { ref: 'bound', name: 'revealHandOrTop' };
  if (!same(a.cond, { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], isCard: true, is: bound, zone: ['hand', 'library'] } } })) return null;
  const [m] = a.then;
  if (m?.op !== 'move' || m.guard !== undefined || !same(m.what, bound) || !same(m.to, { zone: 'battlefield', controller: { ref: 'you' } }) || Object.keys(m).length !== 3) return null;
  return { clauses: [plain('if you reveal a creature card this way, put it onto the battlefield', { standalone: true })], consumed: 1 };
}

/** The folds of edh-zones-18 (render/fold.ts#foldAt). */
export function foldEdhZones18(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return manaLifeForEachRevealed(list, i, st) ?? revealHandOrTop(list, i) ?? ifRevealedCreaturePut(list, i) ?? eachPlayerLooksMayRevealLandSpell(list, i, st) ?? mayFetchArtifactOutsideOrExile(list, i);
}
