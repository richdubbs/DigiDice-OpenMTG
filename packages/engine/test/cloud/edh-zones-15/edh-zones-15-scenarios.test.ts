/**
 * edh-zones-15 (Commander effort, lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites checked
 * against the 2026-09-25 text in the round record.
 *
 *   CR 701.13a, 608.2c, 601.2b, 701.20a   "As an additional cost to cast this spell, reveal a colorless creature card from your hand. Exile target creature if its power is less than or
 *                                          equal to the revealed card's power." (Titan's Presence): the guard is read as the spell resolves, the revealed card by what it was in the hand
 *   CR 608.2d, 406.1, 400.7               "Exile any number of other nonland permanents you own and control. Return those cards to the battlefield at the beginning of the next end step."
 *                                          (Yorion, Sky Nomad)
 *   CR 608.2d, 610.3, 610.3c              "Exile any number of other nonland permanents you control until ~ leaves the battlefield. Create a 1/1 ... token for each permanent exiled this
 *                                          way." (Abdel Adrian, Gorion's Ward)
 *   CR 406.1, 601.2a, 401.4, 400.3        "... exiles cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost.
 *                                          Then put the exiled cards that weren't cast this way on the bottom of that library in a random order." (Chaos Wand; Gríma, Saruman's Footman)
 *   CR 614.1a, 614.6, 121.1, 701.20e      "If you would draw a card, instead look at the top three cards of your library, then put one into your hand and the rest into your graveyard."
 *                                          (Underrealm Lich)
 */
import { describe, expect, it } from 'vitest';
import { put } from '../../m3/scenario';
import type { GameState } from '../../../src/index';
import { advanceTo, answer, pass } from '../../m3/scenario';
import { life, noManual, card, obj, player, nameOf, exileNames, gyNames, handNames, onBf, yes, no, drive, resolveAll, castAt, activate, act, find, scenario } from './support';

const setLibrary = (s: GameState, p: 'p1' | 'p2', libNames: string[]): void => {
  for (const id of s.zones.library[p]!) delete s.objects[id];
  s.zones.library[p] = [];
  for (const n of libNames) put(s, p, 'library', n);
};
const libNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.library[p]!.map((id) => nameOf(s, id));
const choose = (...ids: string[]) => ({ kind: 'chooseObjects', ids }) as const;

describe('"Exile target creature if its power is less than or equal to the revealed card\'s power." (CR 701.13a, 608.2c, 601.2b; Titan\'s Presence)', () => {
  const SMITE = card('Test Reveal Smite', 'Instant', 'As an additional cost to cast this spell, reveal a colorless creature card from your hand.\nExile target creature if its power is less than or equal to the revealed card\'s power.', { cost: '{0}' });
  const BIG = card('Test Big Golem', 'Artifact Creature — Golem', '', { pt: ['3', '3'] });
  const SMALL = card('Test Small Golem', 'Artifact Creature — Golem', '', { pt: ['2', '2'] });
  const HUGE = card('Test Huge Golem', 'Artifact Creature — Golem', '', { pt: ['4', '4'] });
  const EVEN = card('Test Even Golem', 'Artifact Creature — Golem', '', { pt: ['3', '1'] });
  const GREEN = card('Test Green Bear', 'Creature — Bear', '', { pt: ['6', '6'], colors: ['G'] });
  const defs = [SMITE, BIG, SMALL, HUGE, EVEN, GREEN];
  const cast = (target: string, hand = ['Test Reveal Smite', 'Test Big Golem']): GameState => {
    const s0 = scenario([], { p1: { hand }, p2: { battlefield: ['Test Small Golem', 'Test Huge Golem', 'Test Even Golem', 'Test Green Bear'] }, defs });
    return resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Reveal Smite', 'hand', 'p1') }), [], [[obj(find(s0, target, 'battlefield', 'p2'))]]));
  };
  it('has no manual part', () => expect(noManual(SMITE)).toBe(true));

  it('a creature with less power than the revealed card is exiled; the revealed card stays in the hand (it was only revealed)', () => {
    const s = cast('Test Small Golem');
    expect(exileNames(s)).toEqual(['Test Small Golem']);
    expect(handNames(s, 'p1')).toEqual(['Test Big Golem']);
  });
  it('equal power is "less than or equal": exiled too', () => {
    const s = cast('Test Even Golem');
    expect(exileNames(s)).toEqual(['Test Even Golem']);
  });
  it('the negative case: a creature with more power than the revealed card stays on the battlefield and nothing is exiled', () => {
    const s = cast('Test Huge Golem');
    expect(exileNames(s)).toEqual([]);
    expect(onBf(s, 'Test Huge Golem')).toHaveLength(1);
    expect(gyNames(s, 'p1')).toEqual(['Test Reveal Smite']); // the spell resolved and is in its owner's graveyard
  });
  it('the negative case: a colored creature card cannot be revealed for the cost, so the spell cannot be cast', () => {
    const s0 = scenario([], { p1: { hand: ['Test Reveal Smite', 'Test Green Bear'] }, p2: { battlefield: ['Test Small Golem'] }, defs });
    // (the cost cannot be paid: no card of the hand is a colorless creature card, CR 601.2b, 118.3)
    expect(() => act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Reveal Smite', 'hand', 'p1') })).toThrow(/enough permanents or cards to pay|Reveal/);
    expect(exileNames(s0)).toEqual([]);
  });
});

describe('"Exile any number of other nonland permanents you own and control. Return those cards to the battlefield at the beginning of the next end step." (CR 608.2d, 406.1, 400.7; Yorion, Sky Nomad)', () => {
  const NOMAD = card('Test Sky Nomad', 'Creature — Bird', 'Flying\nWhen this creature enters, exile any number of other nonland permanents you own and control. Return those cards to the battlefield at the beginning of the next end step.', { pt: ['4', '5'], cost: '{0}' });
  const OX = card('Test Ox', 'Creature — Ox', '', { pt: ['2', '2'] });
  const RING = card('Test Ring', 'Artifact', '');
  const HOUND = card('Test Hound', 'Creature — Dog', '', { pt: ['1', '1'] });
  const defs = [NOMAD, OX, RING, HOUND];
  const enter = (): GameState => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Sky Nomad'], battlefield: ['Test Ox', 'Test Ring', 'Plains'] }, p2: { battlefield: ['Test Hound'] }, defs });
    return drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Sky Nomad', 'hand', 'p1') }));
  };
  it('has no manual part', () => expect(noManual(NOMAD)).toBe(true));

  it('the chosen permanents are exiled when it enters and return at the beginning of the next end step; the others are untouched', () => {
    let s = enter();
    const ox = find(s, 'Test Ox', 'battlefield', 'p1');
    const ring = find(s, 'Test Ring', 'battlefield', 'p1');
    s = resolveAll(s, [choose(ox, ring)]);
    expect(exileNames(s)).toEqual(['Test Ox', 'Test Ring']);
    expect(onBf(s, 'Plains')).toHaveLength(1);
    expect(onBf(s, 'Test Hound')).toHaveLength(1);
    expect(onBf(s, 'Test Sky Nomad')).toHaveLength(1);
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(exileNames(s)).toEqual([]);
    expect(onBf(s, 'Test Ox')).toHaveLength(1);
    expect(onBf(s, 'Test Ring')).toHaveLength(1);
  });
  it('the negative case: lands, the creature itself and an opponent\'s permanent are not offered, so they cannot be exiled', () => {
    const s = resolveAll(enter());
    expect(s.pending?.kind).toBe('chooseObjects');
    const pending = JSON.stringify(s.pending);
    expect(pending).toContain(find(s, 'Test Ox', 'battlefield', 'p1'));
    expect(pending).toContain(find(s, 'Test Ring', 'battlefield', 'p1'));
    expect(pending).not.toContain(find(s, 'Plains', 'battlefield', 'p1'));
    expect(pending).not.toContain(find(s, 'Test Hound', 'battlefield', 'p2'));
    expect(pending).not.toContain(find(s, 'Test Sky Nomad', 'battlefield', 'p1'));
  });
  it('the negative case (ruling 2020-04-17): a permanent you control but do not own, and one you own but do not control, cannot be exiled', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Sky Nomad'], battlefield: ['Test Ox', 'Test Ring'] }, p2: { battlefield: ['Test Hound'] }, defs });
    const taken = find(s0, 'Test Hound', 'battlefield', 'p2'); // owned by p2, controlled by p1
    const lent = find(s0, 'Test Ox', 'battlefield', 'p1'); // owned by p1, controlled by p2
    s0.objects[taken]!.controller = 'p1';
    s0.objects[lent]!.controller = 'p2';
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Sky Nomad', 'hand', 'p1') })));
    expect(s.pending?.kind).toBe('chooseObjects');
    const pending = JSON.stringify(s.pending);
    expect(pending).toContain(find(s0, 'Test Ring', 'battlefield', 'p1')); // (what you own and control is offered)
    expect(pending).not.toContain(taken);
    expect(pending).not.toContain(lent);
  });
  it('choosing none exiles nothing', () => {
    const s = resolveAll(enter(), [choose()]);
    expect(exileNames(s)).toEqual([]);
    expect(onBf(s, 'Test Ox')).toHaveLength(1);
  });
});

describe('"Exile any number of other nonland permanents you control until ~ leaves the battlefield. Create a 1/1 ... token for each permanent exiled this way." (CR 608.2d, 610.3, 610.3c; Abdel Adrian)', () => {
  const WARD = card('Test Ward Knight', 'Creature — Human Knight', 'When this creature enters, exile any number of other nonland permanents you control until this creature leaves the battlefield. Create a 1/1 white Soldier creature token for each permanent exiled this way.', { pt: ['3', '3'], cost: '{0}' });
  const OX = card('Test Ox', 'Creature — Ox', '', { pt: ['2', '2'] });
  const RING = card('Test Ring', 'Artifact', '');
  const KILL = card('Test Zap', 'Instant', 'Destroy target creature.', { cost: '{0}' });
  const defs = [WARD, OX, RING, KILL];
  const enter = (): GameState => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Ward Knight', 'Test Zap'], battlefield: ['Test Ox', 'Test Ring', 'Plains'] }, defs });
    return drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ward Knight', 'hand', 'p1') }));
  };
  it('has no manual part', () => expect(noManual(WARD)).toBe(true));

  it('one 1/1 token for each permanent exiled, and the permanents come back when the creature leaves the battlefield', () => {
    let s = enter();
    s = resolveAll(s, [choose(find(s, 'Test Ox', 'battlefield', 'p1'), find(s, 'Test Ring', 'battlefield', 'p1'))]);
    expect(exileNames(s)).toEqual(['Test Ox', 'Test Ring']);
    expect(onBf(s, 'Soldier Token').length + onBf(s, 'Soldier').length).toBe(2);
    s = castAt(s, 'Test Zap', [[obj(find(s, 'Test Ward Knight', 'battlefield', 'p1'))]]);
    expect(exileNames(s)).toEqual([]);
    expect(onBf(s, 'Test Ox')).toHaveLength(1);
    expect(onBf(s, 'Test Ring')).toHaveLength(1);
  });
  it('ruling 2022-06-10: if it leaves the battlefield before the ability resolves nothing is exiled and no token is created', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Ward Knight', 'Test Zap'], battlefield: ['Test Ox', 'Test Ring', 'Plains'] }, defs });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ward Knight', 'hand', 'p1') }));
    s = pass(pass(s)); // both players pass: the creature resolves, its enters trigger goes on the stack
    expect(s.zones.stack.length).toBeGreaterThan(0);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Zap', 'hand', 'p1') }), [], [[obj(find(s, 'Test Ward Knight', 'battlefield', 'p1'))]]);
    s = resolveAll(s, [choose(find(s, 'Test Ox', 'battlefield', 'p1'), find(s, 'Test Ring', 'battlefield', 'p1'))]);
    expect(exileNames(s)).toEqual([]); // whatever was chosen did not stay exiled
    expect(onBf(s, 'Test Ox')).toHaveLength(1);
    expect(onBf(s, 'Test Ring')).toHaveLength(1);
    expect(s.zones.battlefield.map((id) => nameOf(s, id)).filter((n) => /Soldier/.test(n))).toEqual([]);
  });
  it('ruling 2022-06-10: a token exiled this way ceases to exist, is not returned later, and still counts for a Soldier token', () => {
    const MAKER = card('Test Spirit Maker', 'Sorcery', 'Create a 1/1 white Spirit creature token.', { cost: '{0}' });
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Spirit Maker', 'Test Ward Knight', 'Test Zap'], battlefield: ['Test Ox', 'Plains'] }, defs: [...defs, MAKER] });
    let s = castAt(s0, 'Test Spirit Maker');
    const spirit = s.zones.battlefield.find((id) => /Spirit/.test(nameOf(s, id)))!;
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ward Knight', 'hand', 'p1') }));
    s = resolveAll(s, [choose(spirit, find(s, 'Test Ox', 'battlefield', 'p1'))]);
    expect(s.zones.battlefield.map((id) => nameOf(s, id)).filter((n) => /Soldier/.test(n))).toHaveLength(2);
    expect(s.zones.battlefield.some((id) => /Spirit/.test(nameOf(s, id)))).toBe(false);
    s = castAt(s, 'Test Zap', [[obj(find(s, 'Test Ward Knight', 'battlefield', 'p1'))]]);
    expect(onBf(s, 'Test Ox')).toHaveLength(1);
    expect(s.zones.battlefield.some((id) => /Spirit/.test(nameOf(s, id)))).toBe(false); // the token did not come back
  });
  it('the negative case: none chosen creates no token and exiles nothing', () => {
    const s = resolveAll(enter(), [choose()]);
    expect(exileNames(s)).toEqual([]);
    expect(s.zones.battlefield.map((id) => nameOf(s, id)).filter((n) => /Soldier/.test(n))).toEqual([]);
  });
});

describe('"Exile cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost. Then put the exiled cards that weren\'t cast this way on the bottom of that library in a random order." (CR 406.1, 601.2a, 401.4; Chaos Wand, Gríma)', () => {
  const WAND = card('Test Chaos Rod', 'Artifact', '{0}: Target opponent exiles cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost. Then put the exiled cards that weren\'t cast this way on the bottom of that library in a random order.');
  const SPIRIT = card('Test Footman', 'Creature — Human', 'Whenever this creature deals combat damage to a player, that player exiles cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost. Then that player puts the exiled cards that weren\'t cast this way on the bottom of their library in a random order.', { pt: ['2', '2'] });
  const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 3 damage to any target.', { cost: '{R}' });
  const SALVE = card('Test Salve', 'Sorcery', 'You gain 4 life.', { cost: '{4}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [WAND, SPIRIT, BOLT, SALVE, BEAR];
  const run = (answers: Parameters<typeof resolveAll>[1], lib = ['Test Bear', 'Test Bear', 'Test Spark', 'Test Bear', 'Test Salve'], extra: Parameters<typeof resolveAll>[2] = []): GameState => {
    const s0 = scenario([], { p1: { battlefield: ['Test Chaos Rod'] }, p2: {}, defs });
    setLibrary(s0, 'p2', lib);
    return activate(s0, find(s0, 'Test Chaos Rod', 'battlefield', 'p1'), [[player('p2')], ...extra], answers);
  };
  it('has no manual part', () => {
    expect(noManual(WAND)).toBe(true);
    expect(noManual(SPIRIT)).toBe(true);
  });

  it('declined: the cards exiled, the instant included, go to the bottom of that library and nothing stays in exile; the cards below the instant stay on top', () => {
    const s = run([no]);
    expect(exileNames(s)).toEqual([]);
    const lib = libNames(s, 'p2');
    expect(lib).toHaveLength(5);
    expect(lib.slice(0, 2)).toEqual(['Test Bear', 'Test Salve']); // the two cards below the instant were never exiled: they stay on top
    expect([...lib.slice(2)].sort()).toEqual(['Test Bear', 'Test Bear', 'Test Spark']); // the three exiled cards, the instant too, are the bottom three
  });
  it('cast: the card that was cast is not put on the bottom (it left exile for the stack); the cards exiled before it are', () => {
    const s = run([yes], undefined, [[player('p1')]]);
    expect(exileNames(s)).toEqual([]);
    expect(life(s, 'p1')).toBe(17); // the instant was cast for free: 3 damage to its caster
    const lib = libNames(s, 'p2');
    expect(lib).toHaveLength(4);
    expect(lib).not.toContain('Test Spark');
    expect(lib.slice(0, 2)).toEqual(['Test Bear', 'Test Salve']);
    expect(lib.slice(2)).toEqual(['Test Bear', 'Test Bear']); // the two cards exiled before the instant
  });
  it('the negative case: with no instant or sorcery in the library every card is exiled, none is castable, and all of them are put back (the opponent\'s own library)', () => {
    const s = run([], ['Test Bear', 'Test Bear', 'Test Bear']);
    expect(exileNames(s)).toEqual([]);
    expect(libNames(s, 'p2')).toEqual(['Test Bear', 'Test Bear', 'Test Bear']);
    expect(libNames(s, 'p1').every((n) => n === 'Plains')).toBe(true);
  });
  it('the put-back is the opponent\'s: your own library is not changed', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Chaos Rod'] }, defs });
    setLibrary(s0, 'p2', ['Test Spark', 'Test Bear']);
    const before = libNames(s0, 'p1');
    const s = activate(s0, find(s0, 'Test Chaos Rod', 'battlefield', 'p1'), [[player('p2')]], [no]);
    expect(libNames(s, 'p1')).toEqual(before);
    expect(libNames(s, 'p2').sort()).toEqual(['Test Bear', 'Test Spark']);
  });
});

describe('"... that player exiles cards from the top of their library until they exile an instant or sorcery card. ... Then that player puts the exiled cards that weren\'t cast this way on the bottom of their library in a random order." (CR 406.1, 601.2a, 401.4; Gríma, Saruman\'s Footman)', () => {
  const FOOTMAN = card('Test Footman', 'Creature — Human', 'Whenever this creature deals combat damage to a player, that player exiles cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost. Then that player puts the exiled cards that weren\'t cast this way on the bottom of their library in a random order.', { pt: ['2', '2'] });
  const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 3 damage to any target.', { cost: '{R}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [FOOTMAN, BOLT, BEAR];
  it('the damaged player\'s library is the one exiled from and refilled; the declined instant goes to the bottom with the cards above it', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Footman'] }, defs });
    setLibrary(s0, 'p2', ['Test Bear', 'Test Spark', 'Test Bear']);
    let s = advanceTo(s0, 1, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Footman', 'battlefield', 'p1'), defender: 'p2' }] });
    s = resolveAll(advanceTo(s, 1, 'combatDamage'), [no]);
    expect(exileNames(s)).toEqual([]);
    expect(life(s, 'p2')).toBe(18);
    const lib = libNames(s, 'p2');
    expect(lib).toHaveLength(3);
    expect(lib[0]).toBe('Test Bear');
    expect([...lib.slice(1)].sort()).toEqual(['Test Bear', 'Test Spark']);
    expect(libNames(s, 'p1').every((n) => n === 'Plains')).toBe(true);
  });
});

describe('"If you would draw a card, instead look at the top three cards of your library, then put one into your hand and the rest into your graveyard." (CR 614.1a, 614.6, 121.1, 701.20e; Underrealm Lich)', () => {
  const LICH = card('Test Grave Warden', 'Enchantment', 'If you would draw a card, instead look at the top three cards of your library, then put one into your hand and the rest into your graveyard.');
  const DRAW = card('Test Insight', 'Sorcery', 'Draw a card.', { cost: '{0}' });
  const A = card('Test Card A', 'Artifact', '');
  const B = card('Test Card B', 'Artifact', '');
  const C = card('Test Card C', 'Artifact', '');
  const D = card('Test Card D', 'Artifact', '');
  const defs = [LICH, DRAW, A, B, C, D];
  it('has no manual part', () => expect(noManual(LICH)).toBe(true));

  it('the draw is replaced: one of the top three is put into your hand (not drawn), the other two into your graveyard, the fourth card stays on top', () => {
    const s0 = scenario([], { p1: { hand: ['Test Insight'], battlefield: ['Test Grave Warden'] }, defs });
    setLibrary(s0, 'p1', ['Test Card A', 'Test Card B', 'Test Card C', 'Test Card D']);
    const pick = find(s0, 'Test Card B', 'library', 'p1');
    const s = castAt(s0, 'Test Insight', [], [choose(pick)]);
    expect(handNames(s, 'p1')).toEqual(['Test Card B']);
    expect(gyNames(s, 'p1')).toEqual(['Test Card A', 'Test Card C', 'Test Insight']);
    expect(libNames(s, 'p1')).toEqual(['Test Card D']);
  });
  it('ruling 2018-10-05: drawing two cards is two replaced draws, one after the other (six cards looked at, two in hand, four in the graveyard)', () => {
    const TWO = card('Test Insight Two', 'Sorcery', 'Draw two cards.', { cost: '{0}' });
    const s0 = scenario([], { p1: { hand: ['Test Insight Two'], battlefield: ['Test Grave Warden'] }, defs: [...defs, TWO] });
    setLibrary(s0, 'p1', ['Test Card A', 'Test Card B', 'Test Card C', 'Test Card D', 'Test Card A', 'Test Card B', 'Test Card C']);
    const ids = s0.zones.library.p1!;
    const s = castAt(s0, 'Test Insight Two', [], [choose(ids[0]!), choose(ids[4]!)]);
    expect(handNames(s, 'p1')).toEqual(['Test Card A', 'Test Card A']);
    expect(gyNames(s, 'p1')).toHaveLength(5); // four of the six looked at, and the spell
    expect(libNames(s, 'p1')).toEqual(['Test Card C']);
  });
  it('fewer than three cards: the cards that are there are looked at (one card goes to the hand, none to the graveyard); an empty library looks at nothing and the replaced draw loses nothing', () => {
    const s0 = scenario([], { p1: { hand: ['Test Insight'], battlefield: ['Test Grave Warden'] }, defs });
    setLibrary(s0, 'p1', ['Test Card A']);
    const s = castAt(s0, 'Test Insight', [], [choose(find(s0, 'Test Card A', 'library', 'p1'))]);
    expect(handNames(s, 'p1')).toEqual(['Test Card A']);
    expect(gyNames(s, 'p1')).toEqual(['Test Insight']);
    const e0 = scenario([], { p1: { hand: ['Test Insight'], battlefield: ['Test Grave Warden'] }, defs });
    setLibrary(e0, 'p1', []);
    const e = castAt(e0, 'Test Insight');
    expect(e.result).toBeNull(); // a draw that was replaced is not a draw from an empty library (CR 704.5b needs a draw to happen, CR 614.6)
    expect(handNames(e, 'p1')).toEqual([]);
  });
  it('the negative case: an opponent\'s draw is not replaced (it is a normal draw into their hand)', () => {
    const OPP = card('Test Opp Draw', 'Sorcery', 'Target player draws a card.', { cost: '{0}' });
    const s0 = scenario([], { p1: { hand: ['Test Opp Draw'], battlefield: ['Test Grave Warden'] }, p2: {}, defs: [...defs, OPP] });
    setLibrary(s0, 'p2', ['Test Card A', 'Test Card B', 'Test Card C']);
    const s = castAt(s0, 'Test Opp Draw', [[player('p2')]]);
    expect(s.pending?.kind).not.toBe('chooseObjects');
    expect(handNames(s, 'p2')).toEqual(['Test Card A']);
    expect(gyNames(s, 'p2')).toEqual([]);
  });

});
