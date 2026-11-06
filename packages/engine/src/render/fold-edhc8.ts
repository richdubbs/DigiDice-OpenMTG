/**
 * edh-c-8 (Commander effort, coordinator C): the folds of its templates (parser/templates/zz-cloud/edh-c-8.json), called from render/fold.ts#foldAtPlain. Each applies only when every
 * part is exactly what the idiom says.
 *
 * `revealNCardsYouChoose` (CR 701.20a, 402.3, 608.2c-d; Blackmail, eff.edhv8.player.reveals.nCardsFromHand.youChoose): "Target player reveals three cards from their hand and you choose
 * one of them.": that player chooses a fixed number of cards of their own hand (all of them when they have fewer) and reveals exactly those, and you choose one of the cards revealed.
 */
import type { EffectStep, ObjectFilter, PlayerRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { bind } from './steps-util';
import type { RenderState } from './state';
import { numWord } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function revealNCardsYouChoose(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'reveal' || c?.op !== 'chooseObjects' || a.as === undefined || c.as === undefined) return null;
  if (a.random === true || a.guard !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined || typeof a.min !== 'number' || a.min < 2 || a.min !== a.max) return null;
  if (b.guard !== undefined || b.to !== undefined || b.what.ref !== 'bound' || b.what.name !== a.as || !same(a.who, b.who) || b.as === undefined) return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (f === null || Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join() !== 'owner,zone' || f.zone !== 'hand' || !same(f.owner, a.who) || a.who.ref === 'you') return null;
  if (c.guard !== undefined || c.random === true || c.groupLimit !== undefined || c.perPlayer !== undefined || c.startingWith !== undefined || c.who.ref !== 'you' || c.min !== 1 || c.max !== 1) return null;
  if (c.from.ref !== 'each' || !('filter' in c.from) || !same(c.from.filter, { is: { ref: 'bound', name: a.as }, zone: 'any' })) return null;
  const who = K.player(a.who as PlayerRef, st, 'subject');
  if (who.person !== 'sg') return null;
  // the cards chosen and the cards revealed are one group (a later "them" may read either name), the one card you choose is "that card" later
  bind(st, a.as, { nouns: ['card'], plural: true });
  bind(st, b.as, { nouns: ['card'], plural: true, sameAs: `b:${a.as}` });
  bind(st, c.as, { nouns: ['card'], plural: false });
  return { clauses: [plain(`${who.text} reveals ${numWord(a.min)} cards from their hand and you choose one of them`, { standalone: true })], consumed: 3 };
}

/**
 * `revealHandChooseTwoDiscard` (CR 701.20a, 701.20e, 608.2d, 701.9a; Distended Mindbender, eff.edhv8.hand.chooseTwoKinds + eff.edhv8.discard.thoseTwoChosen): "Target opponent reveals their hand. You choose
 * from it a nonland card with mana value 3 or less and a card with mana value 4 or greater. That player discards those cards.": the reveal of a hand, a choice of one card of each of two
 * descriptions among it (bound `chosenA`, `chosenB`) and the discard of exactly those two. Only that shape.
 */
function revealHandChooseTwoDiscard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [r, a, b, d] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (r?.op !== 'reveal' || a?.op !== 'chooseObjects' || b?.op !== 'chooseObjects' || d?.op !== 'discard' || r.as === undefined || a.as !== 'chosenA' || b.as !== 'chosenB') return null;
  if (r.guard !== undefined || a.guard !== undefined || b.guard !== undefined || d.guard !== undefined || r.to !== undefined) return null;
  for (const c of [a, b]) {
    if (c.who.ref !== 'you' || c.min !== 1 || c.max !== 1 || c.random === true || c.groupLimit !== undefined || c.perPlayer !== undefined || c.startingWith !== undefined || c.from.ref !== 'each' || !('filter' in c.from)) return null;
    const f = c.from.filter;
    if (f.anyOf?.length !== 1 || !same(f.is, { ref: 'bound', name: r.as }) || f.zone !== 'any' || Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join() !== 'anyOf,is,zone') return null;
  }
  if (d.count !== 2 || d.mode !== undefined || d.filter === undefined || !same(d.filter, { is: { ref: 'union', of: [{ ref: 'bound', name: 'chosenA' }, { ref: 'bound', name: 'chosenB' }] } })) return null;
  const aDesc = (a.from as { filter: { anyOf: ObjectFilter[] } }).filter.anyOf[0]!;
  const bDesc = (b.from as { filter: { anyOf: ObjectFilter[] } }).filter.anyOf[0]!;
  const reveal = K.clause(r, st);
  if (reveal.standalone === true && !reveal.imp.includes('reveals their hand') && !reveal.sub.includes('reveals their hand')) return null;
  bind(st, a.as, { nouns: ['card'], plural: false });
  bind(st, b.as, { nouns: ['card'], plural: false });
  const who = K.player(d.who as PlayerRef, st, 'subject');
  return {
    clauses: [
      reveal,
      plain(`you choose from it ${K.np({ ...aDesc, zone: 'hand' }, st, { det: 'a', noZone: true })} and ${K.np({ ...bDesc, zone: 'hand' }, st, { det: 'a', noZone: true })}`, { standalone: true }),
      plain(`${who.text} discards those cards`, { standalone: true }),
    ],
    consumed: 4,
  };
}

/** The folds of edh-c-8's templates (render/fold.ts#foldAtPlain). */
export function foldEdhC8(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return revealNCardsYouChoose(list, i, st) ?? revealHandChooseTwoDiscard(list, i, st);
}
