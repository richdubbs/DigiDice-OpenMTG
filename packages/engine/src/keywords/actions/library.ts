/** CR 701 actions that look at or draw from the library: explore (701.44), connive (701.50). Pure macros over primitive ops. Owner: WP3. */
import type { EffectStep } from '../../types/ability';
import type { ActionMacro } from '../types';
import { carry, countOf, subjectOf } from './common';

/**
 * CR 701.44a: the permanent's controller reveals the top card of their library. If a land card is revealed, they put it into their hand. Otherwise (a nonland
 * card, or no card at all, CR 701.44b), they put a +1/+1 counter on the exploring permanent and may put the revealed card into their graveyard.
 * "Explore twice" performs the process twice, once per instruction (CR 701.44a-b describe one explore; there is no separate rule for repetition).
 */
export const EXPLORE: ActionMacro = {
  name: 'explore',
  rule: 'CR 701.44',
  // std-lci (CR 701.44b): native, effects/handlers/explore.ts runs one explore at a time (`exploreOnce`) and reports each one (`actionPerformed` 'explore')
  native: 'explore',
};

/** std-lci: the process of ONE explore of `step` (CR 701.44a) as primitive ops, which effects/handlers/explore.ts runs once per repetition. */
export function exploreOnce(step: Parameters<NonNullable<ActionMacro['expand']>>[0]): EffectStep[] {
  const me = subjectOf(step);
  const card = { ref: 'bound', name: '_explored' } as const;
  return carry(step, [
    { op: 'reveal', who: step.who, what: { ref: 'topCards', player: step.who, count: 1 }, as: '_explored' },
    {
      op: 'if',
      cond: { cond: 'all', of: [{ cond: 'exists', of: card }, { cond: 'matches', object: card, filter: { types: ['Land'] } }] },
      then: [{ op: 'move', what: card, to: { zone: 'hand' } }],
      else: [
        { op: 'putCounters', on: me, kind: '+1/+1', count: 1 },
        { op: 'may', who: step.who, do: [{ op: 'move', what: card, to: { zone: 'graveyard' } }], guard: { cond: 'exists', of: card } },
      ],
    },
  ]);
}

/**
 * CR 701.50a, 701.50d: connive N = draw N cards, discard N cards, then put a +1/+1 counter on the permanent for each nonland card discarded this way.
 * CR 701.50e: connive 0 does nothing.
 */
export const CONNIVE: ActionMacro = {
  name: 'connive',
  rule: 'CR 701.50',
  expand: (step) => {
    const n = countOf(step);
    if (n === 0) return [];
    const me = subjectOf(step);
    const each = { ref: 'bound', name: '_conniveCard' } as const;
    // cloud r3-mech (CR 608.2h, 107.3a): a computed N ("connives X, where X is the number of attacking creatures") is determined once, as the action begins: the
    // draw and the discard read the same number
    const computed = typeof n === 'object';
    const count = computed ? ({ q: 'var', name: '_conniveN' } as const) : n;
    return carry(step, [
      ...(computed ? [{ op: 'let', name: '_conniveN', value: n } as EffectStep] : []),
      { op: 'draw', who: step.who, count },
      { op: 'discard', who: step.who, count, as: '_connived' },
      {
        op: 'forEach',
        over: { ref: 'bound', name: '_connived' },
        as: '_conniveCard',
        do: [{ op: 'if', cond: { cond: 'matches', object: each, filter: { notTypes: ['Land'] } }, then: [{ op: 'putCounters', on: me, kind: '+1/+1', count: 1 }] }],
      },
    ]);
  },
};

/**
 * FAST5X E18: "recruit", CR 701.70a (2026-09-25 edition; first built from the reminder text, which says the same): "Draw a card, then discard a card. If you
 * discarded a nonland card this way, create a 1/1 white Human Soldier creature token." Modelled on connive (CR 701.50a: draw,
 * discard, then a result for each nonland card discarded this way): CR 121.1 (draw), 701.9 (discard), 111.1 (tokens), 608.2c ("if you discarded" reads the
 * card discarded by this instruction). The player who recruits draws, discards and creates the token (`who`). Recruit has no number; "recruit twice" would be
 * `n` and repeats the whole process (as explore does).
 */
export const RECRUIT: ActionMacro = {
  name: 'recruit',
  rule: 'CR 701.70a', // analogue connive, CR 701.50a
  expand: (step) => {
    const card = { ref: 'bound', name: '_recruitCard' } as const;
    const once: EffectStep[] = [
      { op: 'draw', who: step.who, count: 1 },
      { op: 'discard', who: step.who, count: 1, as: '_recruited' },
      {
        op: 'forEach',
        over: { ref: 'bound', name: '_recruited' },
        as: '_recruitCard',
        do: [{
          op: 'if',
          cond: { cond: 'matches', object: card, filter: { notTypes: ['Land'] } },
          then: [{ op: 'createToken', who: step.who, token: { colors: ['W'], types: ['Creature'], subtypes: ['Human', 'Soldier'], power: 1, toughness: 1 }, count: 1 }],
        }],
      },
    ];
    const n = countOf(step);
    return carry(step, n === 1 ? once : [{ op: 'repeat', times: n, do: once }]);
  },
};
