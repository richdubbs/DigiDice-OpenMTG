/**
 * edh-cast-12 scenarios (Commander lane edh-cast): each new reading played through the engine with synthetic cards (invented names, design 6.10), with its negative case.
 * Rules (Comprehensive Rules 2026-09-25; cites from memory unless the record says otherwise):
 *   CR 202.3, 202.3e, 601.2i, 608.2h   "deals damage to each creature your opponents control equal to the total mana value of other spells you've cast this turn" (Call Forth the Tempest)
 *   CR 601.3, 401.5, 611.2c, 702.10a   "You may cast creature spells with power 4 or greater from the top of your library. If you cast a creature spell this way, it gains haste
 *                                      until end of turn." (Thundermane Dragon)
 *   CR 101.2, 107.3, 615.12            "If X is 5 or more, this spell can't be countered and the damage can't be prevented." (Banefire)
 *   CR 707.10, 707.10c, 702.34a        "Copy target instant or sorcery spell you control. If this spell was cast from a graveyard, copy that spell twice instead. You may choose
 *                                      new targets for the copies." (Increasing Vengeance)
 *   CR 202.3, 404.1, 608.2b            "Counter target spell with mana value less than or equal to the number of cards in its controller's graveyard." (Drown in the Loch)
 */
import { describe, expect, it } from 'vitest';
import { charsOfObject, legalActions, type GameState, type ObjectId } from '../../../src/index';
import { act, advanceTo, answer, card, drive, find, full, lifeOf, named, obj, passBoth, resolveAll, scenario } from '../r3-cost/support';

const PLAINS = (n: number): string[] => Array(n).fill('Plains') as string[];
const hasHaste = (s: GameState, id: ObjectId): boolean => charsOfObject(s, s.objects[id]!).keywords.some((k) => k.keyword === 'haste');
const castTop = (s: GameState): GameState => drive(act(s, { type: 'cast', player: 'p1', card: s.zones.library.p1![0]! }));

describe('CR 202.3, 601.2i, 608.2h: "deals damage to each creature your opponents control equal to the total mana value of other spells you\'ve cast this turn" (Call Forth the Tempest)', () => {
  const STORM = card('Test Storm Wave', 'Sorcery', "Test Storm Wave deals damage to each creature your opponents control equal to the total mana value of other spells you've cast this turn.", '{1}');
  const ONE = card('Test Cheap Charm', 'Instant', 'You gain 1 life.', '{1}');
  const TWO = card('Test Mid Charm', 'Instant', 'You gain 1 life.', '{2}');
  const XSPELL = card('Test Scaling Charm', 'Instant', 'You gain 1 life.', '{X}');
  const BEAR = card('Test Opposing Bear', 'Creature — Bear', '', '{2}', ['3', '3']);
  const OWN = card('Test Own Bear', 'Creature — Bear', '', '{2}', ['3', '3']);
  const SMALL = card('Test Opposing Mouse', 'Creature — Mouse', '', '{1}', ['1', '2']);
  const DEFS = [STORM, ONE, TWO, XSPELL, BEAR, OWN, SMALL];
  const base = (hand: string[]) => scenario([], { defs: DEFS, p1: { battlefield: [...PLAINS(8), 'Test Own Bear'], hand }, p2: { battlefield: ['Test Opposing Bear', 'Test Opposing Mouse'] } });
  it('is automated', () => { expect(full(STORM)).toBe(true); });
  it('CR 202.3: the other spells cast this turn are added up (1 + 2 = 3): the 3/3 bear and the 1/2 mouse of the opponent die, your own bear lives', () => {
    let s = base(['Test Cheap Charm', 'Test Mid Charm', 'Test Storm Wave']);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Cheap Charm', 'hand', 'p1') })));
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mid Charm', 'hand', 'p1') })));
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Storm Wave', 'hand', 'p1') })));
    expect(named(s, 'Test Opposing Bear')).toHaveLength(0);
    expect(named(s, 'Test Opposing Mouse')).toHaveLength(0);
    expect(named(s, 'Test Own Bear')).toHaveLength(1);
    expect(named(s, 'Test Own Bear').every((id) => s.objects[id]!.damage === 0)).toBe(true);
  });
  it('CR 608.2h: the spell itself is not one of the other spells: cast first, it deals 0 damage', () => {
    let s = base(['Test Storm Wave']);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Storm Wave', 'hand', 'p1') })));
    expect(named(s, 'Test Opposing Bear')).toHaveLength(1);
    expect(named(s, 'Test Opposing Bear').every((id) => s.objects[id]!.damage === 0)).toBe(true);
  });
  it('CR 202.3e: a spell cast with X = 2 counts its announced X (mana value 2), two spells: 1 + 2 = 3', () => {
    let s = base(['Test Cheap Charm', 'Test Scaling Charm', 'Test Storm Wave']);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Cheap Charm', 'hand', 'p1') })));
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Scaling Charm', 'hand', 'p1') }), { x: [2] }));
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Storm Wave', 'hand', 'p1') })));
    expect(named(s, 'Test Opposing Bear')).toHaveLength(0);
  });
  it('only the spells YOU cast: a 2-mana instant the opponent casts in response is not counted, so the 1/2 mouse survives', () => {
    const OPP = card('Test Opp Charm', 'Instant', 'You gain 1 life.', '{0}');
    let s = scenario([], { defs: [...DEFS, OPP], p1: { battlefield: [...PLAINS(8), 'Test Own Bear'], hand: ['Test Storm Wave'] }, p2: { battlefield: ['Test Opposing Mouse'], hand: ['Test Opp Charm'] } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Storm Wave', 'hand', 'p1') }));
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Opp Charm', 'hand', 'p2') }));
    s = resolveAll(s);
    expect(named(s, 'Test Opposing Mouse')).toHaveLength(1);
    expect(named(s, 'Test Opposing Mouse').every((id) => s.objects[id]!.damage === 0)).toBe(true);
  });
  it("a spell cast in an earlier turn is not counted", () => {
    let s = base(['Test Mid Charm', 'Test Storm Wave']);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mid Charm', 'hand', 'p1') })));
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Storm Wave', 'hand', 'p1') })));
    expect(named(s, 'Test Opposing Bear')).toHaveLength(1);
  });
});

describe('CR 601.3, 401.5, 611.2c: "You may cast creature spells with power 4 or greater from the top of your library. If you cast a creature spell this way, it gains haste until end of turn." (Thundermane Dragon)', () => {
  const DRAKE = card('Test Thunder Drake', 'Creature — Drake', 'You may look at the top card of your library any time.\nYou may cast creature spells with power 4 or greater from the top of your library. If you cast a creature spell this way, it gains haste until end of turn.', '{4}', ['4', '4']);
  const BIG = card('Test Big Beast', 'Creature — Beast', '', '{3}', ['5', '5']);
  const SMALL = card('Test Small Beast', 'Creature — Beast', '', '{1}', ['3', '3']);
  const SPELL = card('Test Plain Charm', 'Instant', '', '{1}');
  const DEFS = [DRAKE, BIG, SMALL, SPELL];
  const withTop = (top: string, hand: string[] = []) => scenario([], { defs: DEFS, p1: { battlefield: [...PLAINS(6), 'Test Thunder Drake'], hand, library: [top, 'Test Small Beast'] } });
  it('is automated', () => { expect(full(DRAKE)).toBe(true); });
  it('a creature spell with power 5 cast from the top of the library gains haste, and it is gone at the next turn', () => {
    let s = withTop('Test Big Beast');
    s = resolveAll(castTop(s));
    const beast = named(s, 'Test Big Beast')[0]!;
    expect(beast).toBeDefined();
    expect(hasHaste(s, beast)).toBe(true);
    s = advanceTo(s, 3, 'main1');
    expect(hasHaste(s, named(s, 'Test Big Beast')[0]!)).toBe(false);
  });
  it('the same creature cast from the HAND has no haste (the rider is for spells cast this way)', () => {
    let s = withTop('Test Small Beast', ['Test Big Beast']);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Big Beast', 'hand', 'p1') })));
    expect(hasHaste(s, named(s, 'Test Big Beast')[0]!)).toBe(false);
  });
  it('CR 601.3: with another top-card cast permission also in play (either order) the spell is still cast with the haste permission', () => {
    const VIZ = card('Test Top Seer', 'Creature — Wizard', 'You may look at the top card of your library any time.\nYou may cast creature spells from the top of your library.', '{2}', ['1', '1']);
    for (const order of [['Test Top Seer', 'Test Thunder Drake'], ['Test Thunder Drake', 'Test Top Seer']]) {
      let s = scenario([], { defs: [...DEFS, VIZ], p1: { battlefield: [...PLAINS(6), ...order], library: ['Test Big Beast', 'Test Small Beast'] } });
      s = resolveAll(castTop(s));
      expect(hasHaste(s, named(s, 'Test Big Beast')[0]!)).toBe(true);
    }
  });
  it('a creature spell with power 3 on top is not castable from the library (the permission is for power 4 or greater)', () => {
    const s = withTop('Test Small Beast');
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === s.zones.library.p1![0])).toBe(false);
  });
});

describe('CR 101.2, 107.3, 615.12: "If X is 5 or more, this spell can\'t be countered and the damage can\'t be prevented." (Banefire)', () => {
  const PYRE = card('Test Big Pyre', 'Sorcery', "Test Big Pyre deals X damage to any target.\nIf X is 5 or more, this spell can't be countered and the damage can't be prevented.", '{X}{W}');
  const CANCEL = card('Test Quick Cancel', 'Instant', 'Counter target spell.', '{0}');
  const WARD = card('Test Quick Ward', 'Instant', 'Prevent all damage that would be dealt to you this turn.', '{0}');
  const DEFS = [PYRE, CANCEL, WARD];
  const setup = (x: number, p2hand: string[]) => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: PLAINS(9), hand: ['Test Big Pyre'] }, p2: { hand: p2hand } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Big Pyre', 'hand', 'p1') });
    s = drive(s, { x: [x], targets: [[{ kind: 'player', id: 'p2' }]] });
    return act(s, { type: 'pass', player: 'p1' }); // the opponent gets priority with the spell on the stack
  };
  const respond = (s: GameState, name: string): GameState => {
    const id = find(s, name, 'hand', 'p2');
    return drive(act(s, { type: 'cast', player: 'p2', card: id }), { targets: [[obj(s.zones.stack[s.zones.stack.length - 1]!)]] });
  };
  it('is automated', () => { expect(full(PYRE)).toBe(true); });
  it('X = 4: the spell can be countered (the opponent counters it and takes nothing)', () => {
    let s = setup(4, ['Test Quick Cancel']);
    s = resolveAll(respond(s, 'Test Quick Cancel'));
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it("X = 5: the spell can't be countered: the counterspell resolves, the damage is dealt", () => {
    let s = setup(5, ['Test Quick Cancel']);
    s = resolveAll(respond(s, 'Test Quick Cancel'));
    expect(lifeOf(s, 'p2')).toBe(15);
  });
  it('X = 4: damage that would be dealt can be prevented', () => {
    let s = setup(4, ['Test Quick Ward']);
    s = resolveAll(respond(s, 'Test Quick Ward'));
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it("CR 615.12: X = 5: the damage can't be prevented (the prevention of the opponent does nothing)", () => {
    let s = setup(5, ['Test Quick Ward']);
    s = resolveAll(respond(s, 'Test Quick Ward'));
    expect(lifeOf(s, 'p2')).toBe(15);
  });
});

describe('CR 707.10, 707.10c, 702.34a: "Copy target instant or sorcery spell you control. If this spell was cast from a graveyard, copy that spell twice instead." (Increasing Vengeance)', () => {
  const ECHO = card('Test Echo Charm', 'Instant', 'Copy target instant or sorcery spell you control. If this spell was cast from a graveyard, copy that spell twice instead. You may choose new targets for the copies.\nFlashback {1}', '{1}');
  const ZAP = card('Test Zap Bolt', 'Instant', 'Test Zap Bolt deals 1 damage to any target.', '{1}');
  const DEFS = [ECHO, ZAP];
  const play = (echoZone: 'hand' | 'graveyard') => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: PLAINS(8), hand: echoZone === 'hand' ? ['Test Zap Bolt', 'Test Echo Charm'] : ['Test Zap Bolt'], graveyard: echoZone === 'graveyard' ? ['Test Echo Charm'] : [] } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Zap Bolt', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    const zap = s.zones.stack[s.zones.stack.length - 1]!;
    const echoId = find(s, 'Test Echo Charm', echoZone, 'p1');
    s = drive(act(s, { type: 'cast', player: 'p1', card: echoId, ...(echoZone === 'graveyard' ? { method: 'flashback' } : {}) }), { targets: [[obj(zap)]] });
    return resolveAll(s);
  };
  it('is automated', () => { expect(full(ECHO)).toBe(true); });
  it('cast from the hand: one copy: the bolt and one copy deal 1 damage each', () => {
    expect(lifeOf(play('hand'), 'p2')).toBe(18);
  });
  it('cast from the graveyard (flashback): two copies: the bolt and two copies deal 3 damage', () => {
    expect(lifeOf(play('graveyard'), 'p2')).toBe(17);
  });
});

describe('CR 202.3, 404.1, 608.2b: "mana value less than or equal to the number of cards in its controller\'s graveyard" (Drown in the Loch)', () => {
  const LOCH = card('Test Loch Charm', 'Instant', "Choose one --\n• Counter target spell with mana value less than or equal to the number of cards in its controller's graveyard.\n• Destroy target creature with mana value less than or equal to the number of cards in its controller's graveyard.", '{0}');
  const BEAR = card('Test Grave Bear', 'Creature — Bear', '', '{2}', ['2', '2']);
  const WURM = card('Test Grave Wurm', 'Creature — Wurm', '', '{3}', ['3', '3']);
  const DEFS = [LOCH, BEAR, WURM];
  const stackOf = (p2gy: number, p1gy: number) => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: PLAINS(0), hand: ['Test Loch Charm'], graveyard: Array(p1gy).fill('Test Grave Bear') }, p2: { battlefield: PLAINS(5), hand: ['Test Grave Wurm'], graveyard: Array(p2gy).fill('Test Grave Bear') } });
    s = advanceTo(s, 2, 'main1');
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Grave Wurm', 'hand', 'p2') }));
    return act(s, { type: 'pass', player: 'p2' }); // p1 has priority with the creature spell on the stack
  };
  const loch = (s: GameState) => legalActions(s, 'p1').filter((a) => a.kind === 'cast' && a.object === find(s, 'Test Loch Charm', 'hand', 'p1'));
  it('is automated', () => { expect(full(LOCH)).toBe(true); });
  it("the counter mode: the spell has mana value 3 and its controller's graveyard holds 3 cards: it can be countered", () => {
    let s = stackOf(3, 0);
    const wurm = s.zones.stack[s.zones.stack.length - 1]!;
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Loch Charm', 'hand', 'p1') }), { options: [['0']], targets: [[obj(wurm)]] }));
    expect(named(s, 'Test Grave Wurm')).toHaveLength(0);
  });
  it("negative: with 2 cards in the controller's graveyard (mana value 3 is more) the spell is not a legal target, whatever is in YOUR graveyard: the charm cannot be cast", () => {
    const s = stackOf(2, 6);
    expect(loch(s)).toHaveLength(0);
  });
  const onBoard = (p2gy: number, p1gy: number) => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Loch Charm'], graveyard: Array(p1gy).fill('Test Grave Bear') }, p2: { battlefield: ['Test Grave Wurm'], graveyard: Array(p2gy).fill('Test Grave Bear') } });
    return s;
  };
  it("the destroy mode: a creature with mana value 3 whose controller has 3 cards in the graveyard is destroyed", () => {
    let s = onBoard(3, 0);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Loch Charm', 'hand', 'p1') }), { options: [['1']], targets: [[obj(named(s, 'Test Grave Wurm')[0]!)]] }));
    expect(named(s, 'Test Grave Wurm')).toHaveLength(0);
  });
  it("negative: the same creature with 2 cards in its controller's graveyard is no target, though the caster's graveyard has 6 (the charm cannot be cast)", () => {
    expect(loch(onBoard(2, 6))).toHaveLength(0);
  });
});
