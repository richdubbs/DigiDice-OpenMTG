/**
 * edh-next-58 (Commander lane cost, template code edhn58): readings of the `Cond` hole for the conditions of the Trap cards' alternative costs
 * (CR 118.9, 601.2b: "If <condition>, you may pay {0} rather than pay this spell's mana cost"). All three read the turn's history (CR 603.4 style, rules/history.ts).
 *  - "an opponent searched their library this turn" (Archive Trap; CR 701.23a): some opponent searched their OWN library (the `search` action with `searched: 'ownLibrary'`).
 *  - "a creature spell you cast this turn was countered by a spell or ability an opponent controlled" (Summoning Trap; CR 701.6a, 608.2b): a `counter` action whose
 *    countered object was a creature spell you controlled and whose actor (the controller of the countering spell or ability) is an opponent.
 *  - "an opponent had three or more cards put into their graveyard from anywhere this turn" (Ravenous Trap; CR 400.3, 404.1): some ONE opponent owns at least that many cards
 *    that went to a graveyard (zone changes to the graveyard, `happenedPlayers` over each opponent judged alone from their own side, as Lavaball Trap's lands; four players:
 *    opponents are never added together).
 */
import type { Condition, ObjectFilter, Quantity } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, cmpAt, phraseAt } from './core';

const compare = (left: Quantity, op: '>=', right: Quantity): Condition => ({ cond: 'compare', left, op, right });

const W_THERE_ARE = P('there are');
const W_TOTAL_IN_ALL_GRAVEYARDS = P('total in all graveyards');
const W_SEARCHED = [P('an opponent searched their library this turn'), P('an opponent has searched their library this turn')];
const W_COUNTERED = [P('a creature spell you cast this turn was countered by a spell or ability an opponent controlled'), P('a creature spell you cast this turn was countered by a spell or ability an opponent controls')];
const W_HAD = [P('an opponent had'), P('an opponent has had')];
const W_CARDS_PUT = [P('cards put into their graveyard from anywhere this turn'), P('cards put into their graveyard from anywhere')];

export function edhn58CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const w of W_SEARCHED) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: { cond: 'happened', event: { ev: 'action', verb: 'search', actor: 'opponent', searched: 'ownLibrary' }, scope: 'turn' } });
  }
  for (const w of W_COUNTERED) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: { cond: 'happened', event: { ev: 'action', verb: 'counter', actor: 'opponent', object: { types: ['Creature'], controller: 'you' } }, scope: 'turn' } });
  }
  for (const lead of W_HAD) {
    const e = phraseAt(ctx, pos, lead);
    if (e < 0) continue;
    for (const c of cmpAt(ctx, e)) {
      if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number' || c.cmp.value < 2) continue;
      for (const w of W_CARDS_PUT) {
        const end = phraseAt(ctx, c.end, w);
        if (end >= 0) out.push({ end, value: compare({ q: 'happenedPlayers', of: { ref: 'each', who: 'opponent' }, event: { ev: 'zoneChange', subject: { owner: 'you', isCard: true }, to: 'graveyard' }, scope: 'turn', times: { op: '>=', n: c.cmp.value } }, '>=', 1) });
      }
    }
  }
  // edh-next-58 (CR 404.1, 102.3; Avatar of Woe): "there are ten or more creature cards total in all graveyards": the cards of the description in every graveyard together (the same
  // count as "... in graveyards"; each card is in its owner's graveyard)
  const there = phraseAt(ctx, pos, W_THERE_ARE);
  if (there >= 0) {
    for (const c of cmpAt(ctx, there)) {
      if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number') continue;
      for (const f of ctx.call('Filter', c.end)) {
        const filter = f.value as ObjectFilter;
        if (filter.zone !== undefined || filter.controller !== undefined || filter.owner !== undefined || filter.isCard !== true) continue;
        const end = phraseAt(ctx, f.end, W_TOTAL_IN_ALL_GRAVEYARDS);
        if (end >= 0) out.push({ end, value: { cond: 'exists', of: { ref: 'each', filter: { ...filter, zone: 'graveyard' } }, atLeast: c.cmp.value } });
      }
    }
  }
  return out;
}

const W_CARD_TYPE_SAC = P("card type among permanents you've sacrificed this turn");
const W_CARD_TYPES_SAC = P("card types among permanents you've sacrificed this turn");

/**
 * edh-next-58 (CR 205.2a, 701.21a, 601.2f; Korvold, Gleeful Glutton): "for each card type among permanents you've sacrificed this turn" / "the number of card types among ...":
 * the different card types among the permanents you sacrificed this turn, each as it was when sacrificed (`happenedDistinct` of your sacrifice history).
 */
export function edhn58QtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const value = { q: 'happenedDistinct', event: { ev: 'action', verb: 'sacrifice', actor: 'you' }, scope: 'turn', what: 'cardTypes' } as Quantity;
  const afterEach = ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each';
  if (afterEach) { const e = phraseAt(ctx, pos, W_CARD_TYPE_SAC); if (e >= 0) out.push({ end: e, value }); }
  const c = phraseAt(ctx, pos, W_CARD_TYPES_SAC);
  if (c >= 0 && ctx.toks[pos - 3]?.norm === 'the' && ctx.toks[pos - 2]?.norm === 'number' && ctx.toks[pos - 1]?.norm === 'of') out.push({ end: c, value });
  return out;
}
