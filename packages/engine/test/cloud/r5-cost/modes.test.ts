/**
 * r5-cost: modal headers r4-cost left (parser/lower/ability.ts#withModes), played with synthetic cards (design 6.10).
 *
 *   CR 603.12, 603.3c, 700.2   "you may pay {1}. When you do, choose one -- • ...": a reflexive trigger whose modes are chosen as it is put on the stack, after
 *                              the payment; no payment, no trigger
 *   CR 107.3m, 603.3c, 700.2   "When this creature enters, choose up to X --": X is the X the creature was cast with (0 when it was not cast), read as the modes
 *                              are chosen
 *   CR 700.2, 700.2d           "Choose up to three. You may choose the same mode more than once.": a mode chosen twice has two targets of its own
 */
import { describe, expect, it } from 'vitest';
import { act, answer, attackWith, card, cast, drive, find, full, lifeOf, named, obj, passBoth, resolveAll, scenario } from './support';

const PT: [string, string] = ['2', '2'];
const WARLOCK = card('Test Frost Warlock', 'Creature — Human Warlock', 'Whenever this creature attacks, you may pay {1}. When you do, choose one --\n• Create a 1/1 white Soldier creature token.\n• Target opponent loses 3 life.\n• You gain 2 life.', '{0}', PT);
const CREW = card('Test Wrecking Gang', 'Creature — Human Villain', 'This creature enters with X +1/+1 counters on it.\nWhen this creature enters, choose up to X --\n• You gain 1 life.\n• Target opponent loses 2 life.\n• Draw a card.', '{X}', ['0', '0']);
const RECKON = card('Test Reckoning', 'Sorcery', 'Choose up to three. You may choose the same mode more than once.\n• Destroy target creature.\n• You gain 2 life.', '{0}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{3}', ['3', '3']);
const DEFS = [WARLOCK, CREW, RECKON, OGRE];

describe('r5-cost: modal headers', () => {
  it('the cards are automated', () => {
    for (const d of [WARLOCK, CREW, RECKON]) expect(full(d), d.name).toBe(true);
  });

  it('CR 603.12, 603.3c, 700.2: paying {1} makes the reflexive trigger, whose mode and target are chosen as it is put on the stack', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Frost Warlock', 'Plains'] } });
    const warlock = find(s0, 'Test Frost Warlock', 'battlefield', 'p1');
    // the attack trigger: pay {1} (yes), then the reflexive trigger: the second mode, targeting p2
    const s = attackWith(s0, [warlock], 'p2', { yes: [true], options: [['1']], targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(lifeOf(s, 'p2')).toBe(20 - 2 - 3); // combat damage, then the mode
    expect(s.objects[find(s0, 'Plains', 'battlefield', 'p1')]!.tapped).toBe(true); // {1} paid
  });

  it('CR 603.12: declining to pay makes no reflexive trigger: no mode is chosen and nothing happens', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Frost Warlock', 'Plains'] } });
    const warlock = find(s0, 'Test Frost Warlock', 'battlefield', 'p1');
    const s = attackWith(s0, [warlock], 'p2', { yes: [false], options: [['2']] });
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(lifeOf(s, 'p1')).toBe(20);
  });

  it('CR 107.3m, 700.2: cast with X = 2, at most two modes can be chosen; both run', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Wrecking Gang'], battlefield: ['Plains', 'Plains'], library: ['Plains'] } });
    const s1 = passBoth(cast(s0, 'Test Wrecking Gang', { x: [2] })); // the creature resolves; its trigger asks for modes
    const d = s1.pending;
    expect(d?.kind).toBe('chooseOption');
    if (d?.kind !== 'chooseOption') return;
    expect(d.max).toBe(2);
    expect(() => answer(s1, { kind: 'chooseOption', ids: ['0', '1', '2'] })).toThrow();
    const s = resolveAll(drive(s1, { options: [['0', '1']], targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(lifeOf(s, 'p1')).toBe(21);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(s.objects[named(s, 'Test Wrecking Gang')[0]!]!.counters?.['+1/+1']).toBe(2);
  });

  it('CR 107.3m, 603.3c: cast with X = 0, no mode can be chosen and the trigger is removed', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Wrecking Gang'] } });
    const s1 = passBoth(cast(s0, 'Test Wrecking Gang', { x: [0] }));
    expect(s1.pending?.kind).toBe('priority'); // no mode to choose
    const s = resolveAll(s1);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(lifeOf(s, 'p2')).toBe(20);
  });

  it('CR 700.2d: "Destroy target creature" chosen twice destroys two creatures, each its own target', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Reckoning'] }, p2: { battlefield: ['Test Ogre', 'Test Ogre'] } });
    const [a, b] = named(s0, 'Test Ogre');
    const s = resolveAll(cast(s0, 'Test Reckoning', { options: [['0', '0', '1']], targets: [[obj(a!)], [obj(b!)]] }));
    expect(named(s, 'Test Ogre')).toHaveLength(0);
    expect(lifeOf(s, 'p1')).toBe(22);
  });

  it('CR 700.2: "up to three": a fourth mode is refused', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Reckoning'] } });
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Reckoning', 'hand', 'p1') });
    expect(s1.pending?.kind).toBe('chooseOption');
    expect(() => answer(s1, { kind: 'chooseOption', ids: ['1', '1', '1', '1'] })).toThrow();
    expect(lifeOf(resolveAll(drive(s1, { options: [['1', '1', '1']] })), 'p1')).toBe(26);
  });
});
