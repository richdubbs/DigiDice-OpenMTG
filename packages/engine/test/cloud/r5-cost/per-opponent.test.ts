/**
 * r5-cost: a target for each opponent with a calculated amount (zz-cloud/r5-cost.json), played with synthetic cards (design 6.10).
 *
 *   CR 115.1, 601.2c, 107.3   "for each opponent, put X -1/-1 counters on up to one target creature that player controls, where X is ...": one target at most,
 *                             controlled by an opponent; X is counted as the ability resolves (CR 608.2h)
 *   CR 115.1, 601.2c          "... that opponent controls": the same target for each opponent
 */
import { describe, expect, it } from 'vitest';
import { answer, card, cast, find, full, obj, passBoth, resolveAll, scenario } from './support';

const FANG = card('Test Fang Priest', 'Creature — Human Cleric', 'When this creature enters, for each opponent, put X -1/-1 counters on up to one target creature that player controls, where X is the number of cards in your hand.', '{0}', ['1', '1']);
const TAPPER = card('Test Gate Warden', 'Creature — Human Soldier', 'When this creature enters, for each opponent, tap up to one target nonland permanent that opponent controls.', '{0}', ['1', '1']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{3}', ['3', '3']);
const DEFS = [FANG, TAPPER, OGRE];

describe('r5-cost: a target for each opponent', () => {
  it('the cards are automated', () => {
    for (const d of [FANG, TAPPER]) expect(full(d), d.name).toBe(true);
  });

  it('CR 115.1, 601.2c, 107.3: only a creature an opponent controls can be the target; X is the cards in hand as the ability resolves', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Fang Priest', 'Plains', 'Plains'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Ogre'] } });
    // the creature spell resolves; its trigger asks for its target: only p2's Ogre
    let s = passBoth(cast(s0, 'Test Fang Priest'));
    expect(s.pending?.kind).toBe('chooseTargets');
    if (s.pending?.kind !== 'chooseTargets') return;
    const theirs = find(s0, 'Test Ogre', 'battlefield', 'p2');
    expect(s.pending.objects).toEqual([theirs]);
    expect(s.pending.max).toBe(1);
    s = resolveAll(answer(s, { kind: 'chooseTargets', targets: [obj(theirs)] }));
    expect(s.objects[theirs]!.counters?.['-1/-1']).toBe(2); // two cards left in hand
    expect(s.objects[find(s0, 'Test Ogre', 'battlefield', 'p1')]!.counters?.['-1/-1'] ?? 0).toBe(0);
  });

  it('CR 115.1, 601.2c: "that opponent controls" taps a permanent of the opponent', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Gate Warden'] }, p2: { battlefield: ['Test Ogre'] } });
    const theirs = find(s0, 'Test Ogre', 'battlefield', 'p2');
    const s = resolveAll(cast(s0, 'Test Gate Warden'), { targets: [[obj(theirs)]] });
    expect(s.objects[theirs]!.tapped).toBe(true);
  });
});
