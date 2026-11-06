/**
 * Commander lane edh-c, round edh-c-1: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default
 * compiler, in 4-player games. Each group has its negative cases. CR cites are checked against the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 614.1c, 122.6   "~ enters with a +1/+1 counter on ~ for each land you control." (the lands the entering permanent's controller has, none of the others')
 *   CR 701.9a, 603.12  "Then you may discard a nonland card. When you do, ..." (a land is no choice; declining or having none: no reflexive trigger)
 *   CR 701.24a         "Whenever an opponent shuffles their library, ..." (opponents only; also an empty library, the Scryfall ruling of 2009-10-01)
 *   CR 601.2i          "Whenever you cast your third spell in a turn, ..." (the third one, your own, once)
 *   CR 700.4, 603.4    "At the beginning of each player's end step, if no creatures died this turn, ..." (checked as the step begins and when it resolves)
 *   CR 119.3, 608.2c   "each player loses 1 life. Put a +1/+1 counter on ~ for each 1 life lost this way." (every player's loss counted)
 *   CR 603.12, 608.2h  "Whenever you gain life, you may pay {G/W}. When you do, target creature gets +X/+X ... where X is the amount of life you gained."
 *   CR 702.29a, 601.2f "~ costs {2} less to cast for each card you've cycled or discarded this turn." (generic only, never below {0})
 *   CR 702.6a, 601.2f  "Equip costs you pay cost {1} less." and "As long as ~ is equipped, each creature you control that's a Soldier or a Knight gets +1/+1."
 *   CR 614.1a, 120.3   "If a noncreature source you control would deal damage to a creature, battle, or opponent, it deals that much damage plus 2 instead."
 *   CR 611.2a, 613.1f  "Until end of turn, up to two target creatures you control each gain "Whenever ~ deals combat damage to a player, draw a card.""
 *   CR 701.16a, 608.2h "Whenever ~ attacks, investigate once for each nontoken attacking creature."
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { act, answer, find, mpScenario, pass } from '../../m12/rules/helpers';
import { advanceTo, legal } from '../../m3/scenario';
import { card, counters, full, pt, resolveAll, settle } from '../cmd3/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const onBf = (s: GameState, p: string, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && s.objects[id]!.controller === p);
const castAs = (s: GameState, name: string, player: string, picks: Parameters<typeof settle>[1] = {}): GameState => settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never), picks);
/** Pass priority (answering every other decision the default way) until the end of combat step is reached with an empty stack. */
const toEndOfCombat = (s0: GameState): GameState => {
  let s = s0;
  for (let i = 0; i < 120 && !(s.turn.step === 'endCombat' && s.zones.stack.length === 0 && s.pending?.kind === 'priority'); i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
  return s;
};
const toPriority = (s0: GameState, who: string): GameState => { let s = s0; for (let i = 0; i < 8 && s.pending?.player !== who; i++) s = pass(s); return s; };

describe('CR 614.1c, 122.6: "~ enters with a +1/+1 counter on ~ for each land you control."', () => {
  const TURTLE = card('Test Shell Turtle', 'Creature — Turtle', 'Trample\n~ enters with a +1/+1 counter on ~ for each land you control.', ['1', '1']);
  const start = (): GameState => mpScenario({ defs: [TURTLE], zones: { p1: { hand: ['Test Shell Turtle'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Plains', 'Plains', 'Plains'] } } });
  it('is automated', () => expect(full(TURTLE)).toBe(true));
  it('counts the lands its controller has (two) and not the opponents\' (three)', () => {
    const s = resolveAll(castAs(start(), 'Test Shell Turtle', 'p1'));
    const t = onBf(s, 'p1', 'Test Shell Turtle')[0]!;
    expect(counters(s, t, '+1/+1')).toBe(2);
    expect(pt(s, t)).toBe('3/3');
  });
  it('a player without lands gets a plain 1/1 (no counters)', () => {
    const s = resolveAll(castAs(mpScenario({ defs: [TURTLE], zones: { p1: { hand: ['Test Shell Turtle'] }, p2: { battlefield: ['Plains'] } } }), 'Test Shell Turtle', 'p1'));
    expect(counters(s, onBf(s, 'p1', 'Test Shell Turtle')[0]!, '+1/+1')).toBe(0);
  });
});

describe('CR 701.9a, 603.12: "Then you may discard a nonland card. When you do, ~ deals 4 damage to target creature."', () => {
  const HYPO = card('Test Spark Study', 'Sorcery', 'Draw two cards. Then you may discard a nonland card. When you do, ~ deals 4 damage to target creature.');
  const OTHER = card('Test Idle Notes', 'Sorcery', 'You gain 1 life.');
  const BEAR = card('Test Wide Bear', 'Creature — Bear', '', ['3', '3']);
  const start = (hand: string[]): GameState => mpScenario({ defs: [HYPO, OTHER, BEAR], zones: { p1: { hand: ['Test Spark Study', ...hand] }, p2: { battlefield: ['Test Wide Bear'] } } });
  const bearId = (s: GameState): ObjectId => onBf(s, 'p2', 'Test Wide Bear')[0]!;
  it('is automated', () => expect(full(HYPO)).toBe(true));
  it('discarding a nonland card makes the reflexive trigger deal 4 damage to the chosen creature', () => {
    const s0 = start(['Test Idle Notes']);
    const bear = bearId(s0);
    const s = resolveAll(castAs(s0, 'Test Spark Study', 'p1', { yes: true, targets: [{ kind: 'object', id: bear }] }), { yes: true, targets: [{ kind: 'object', id: bear }] });
    expect(s.zones.battlefield.includes(bear)).toBe(false);
    expect((s.zones.graveyard.p1 ?? []).some((id) => s.objects[id]!.defId === 'Test Idle Notes')).toBe(true);
  });
  it('a hand with only lands (the two drawn cards, no nonland card) discards nothing and deals no damage', () => {
    const s0 = start([]);
    const bear = bearId(s0);
    const s = resolveAll(castAs(s0, 'Test Spark Study', 'p1', { yes: true, targets: [{ kind: 'object', id: bear }] }), { yes: true, targets: [{ kind: 'object', id: bear }] });
    expect(s.zones.battlefield.includes(bear)).toBe(true);
    expect((s.zones.graveyard.p1 ?? []).map((id) => s.objects[id]!.defId)).toEqual(['Test Spark Study']);
  });
  it('declining the discard deals no damage and keeps the card', () => {
    const s0 = start(['Test Idle Notes']);
    const bear = bearId(s0);
    const s = resolveAll(castAs(s0, 'Test Spark Study', 'p1', { yes: false }), { yes: false });
    expect(s.zones.battlefield.includes(bear)).toBe(true);
    expect((s.zones.hand.p1 ?? []).some((id) => s.objects[id]!.defId === 'Test Idle Notes')).toBe(true);
  });
});

describe('CR 701.24a: "Whenever an opponent shuffles their library, you may put a +1/+1 counter on ~."', () => {
  const TRICK = card('Test Deck Watcher', 'Creature — Faerie', 'Whenever an opponent shuffles their library, you may put a +1/+1 counter on ~.', ['1', '1']);
  const MIX = card('Test Quick Mix', 'Instant', 'Shuffle your library.');
  const start = (): GameState => mpScenario({ defs: [TRICK, MIX], zones: { p1: { battlefield: ['Test Deck Watcher'], hand: ['Test Quick Mix'] }, p2: { hand: ['Test Quick Mix'] }, p3: { hand: ['Test Quick Mix'] } } });
  const mix = (s0: GameState, who: string): GameState => {
    let s = toPriority(s0, who);
    s = castAs(s, 'Test Quick Mix', who);
    return resolveAll(s, { yes: true });
  };
  it('is automated', () => expect(full(TRICK)).toBe(true));
  it('an opponent shuffling (in a four-player game, either of two) gives a counter each time', () => {
    let s = mix(start(), 'p2');
    const watcher = onBf(s, 'p1', 'Test Deck Watcher')[0]!;
    expect(counters(s, watcher, '+1/+1')).toBe(1);
    s = mix(s, 'p3');
    expect(counters(s, watcher, '+1/+1')).toBe(2);
  });
  it('its controller shuffling their own library gives nothing (negative)', () => {
    const s = mix(start(), 'p1');
    expect(counters(s, onBf(s, 'p1', 'Test Deck Watcher')[0]!, '+1/+1')).toBe(0);
  });
  it('an opponent with an empty library still triggers it (Scryfall ruling 2009-10-01)', () => {
    const s0 = start();
    for (const id of s0.zones.library.p2!) delete s0.objects[id];
    s0.zones.library.p2 = [];
    const s = mix(s0, 'p2');
    expect(counters(s, onBf(s, 'p1', 'Test Deck Watcher')[0]!, '+1/+1')).toBe(1);
  });
});

describe('CR 601.2i, 603.2: "Whenever you cast your third spell in a turn, ..."', () => {
  const GATE = card('Test Third Gate', 'Enchantment', 'Whenever you cast your third spell in a turn, you gain 5 life.');
  const FREE = card('Test Free Spell', 'Instant', 'Draw a card.');
  const start = (): GameState => mpScenario({ defs: [GATE, FREE], zones: { p1: { battlefield: ['Test Third Gate'], hand: ['Test Free Spell', 'Test Free Spell', 'Test Free Spell', 'Test Free Spell'] }, p2: { hand: ['Test Free Spell', 'Test Free Spell', 'Test Free Spell'] } } });
  it('is automated', () => expect(full(GATE)).toBe(true));
  it('the third spell gains life once; the first two and the fourth do not', () => {
    let s = start();
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) { s = resolveAll(castAs(s, 'Test Free Spell', 'p1')); seen.push(life(s, 'p1')); }
    expect(seen).toEqual([20, 20, 25, 25]);
  });
  it('spells an opponent casts are not yours (negative)', () => {
    let s = start();
    for (let i = 0; i < 3; i++) { s = toPriority(s, 'p2'); s = resolveAll(castAs(s, 'Test Free Spell', 'p2')); }
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 700.4, 603.4: "At the beginning of each player\'s end step, if no creatures died this turn, ~ deals 4 damage to that player."', () => {
  const HUNT = card('Test Quiet Hunter', 'Creature — Human', 'At the beginning of each player\'s end step, if no creatures died this turn, ~ deals 4 damage to that player.', ['2', '2']);
  const SNIP = card('Test Plain Snipe', 'Instant', 'Destroy target creature.');
  const MOUSE = card('Test Small Mouse', 'Creature — Mouse', '', ['1', '1']);
  const start = (): GameState => mpScenario({ defs: [HUNT, SNIP, MOUSE], zones: { p1: { battlefield: ['Test Quiet Hunter'], hand: ['Test Plain Snipe'] }, p2: { battlefield: ['Test Small Mouse'] } } });
  const toEnd = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 60 && !(s.turn.step === 'end' && s.zones.stack.length === 0 && s.pending?.kind === 'priority'); i++) {
      s = s.pending?.kind === 'priority' ? pass(s) : s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : settle(s);
    }
    return s;
  };
  it('is automated', () => expect(full(HUNT)).toBe(true));
  it('no creature died: the active player takes 4', () => {
    const s = toEnd(start());
    expect(life(s, 'p1')).toBe(16);
  });
  it('a creature died this turn: no damage', () => {
    let s = resolveAll(castAs(start(), 'Test Plain Snipe', 'p1', { targets: [{ kind: 'object', id: onBf(start(), 'p2', 'Test Small Mouse')[0]! }] }), { targets: [] });
    s = toEnd(s);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 119.3, 608.2c: "each player loses 1 life. Put a +1/+1 counter on ~ for each 1 life lost this way."', () => {
  const TYRANT = card('Test Gaunt Tyrant', 'Creature — Vampire', 'At the beginning of your upkeep, each player loses 1 life. Put a +1/+1 counter on ~ for each 1 life lost this way.', ['2', '2']);
  it('is automated', () => expect(full(TYRANT)).toBe(true));
  it('four players each lose 1 life and it gets four counters', () => {
    let s = mpScenario({ defs: [TYRANT], zones: { p1: { battlefield: ['Test Gaunt Tyrant'] } } });
    s = advanceTo(s, 5, 'upkeep');
    s = resolveAll(s);
    for (const p of ['p1', 'p2', 'p3', 'p4']) expect(life(s, p)).toBe(19);
    expect(counters(s, onBf(s, 'p1', 'Test Gaunt Tyrant')[0]!, '+1/+1')).toBe(4);
  });
  it('a second upkeep adds four more counters (eight in all), not more: only the life lost this way is counted each time', () => {
    let s = mpScenario({ defs: [TYRANT], zones: { p1: { battlefield: ['Test Gaunt Tyrant'] } } });
    s = resolveAll(advanceTo(s, 5, 'upkeep'));
    s = resolveAll(advanceTo(s, 9, 'upkeep'));
    expect(counters(s, onBf(s, 'p1', 'Test Gaunt Tyrant')[0]!, '+1/+1')).toBe(8);
    expect(life(s, 'p2')).toBe(18);
  });
});

describe('CR 603.12, 608.2h: "Whenever you gain life, you may pay {G/W}. When you do, target creature gets +X/+X until end of turn, where X is the amount of life you gained."', () => {
  const SWEET = card('Test Sweet Bear', 'Creature — Bear', 'Whenever you gain life, you may pay {G/W}. When you do, target creature gets +X/+X until end of turn, where X is the amount of life you gained.', ['2', '2']);
  const SIP = card('Test Warm Sip', 'Instant', 'You gain 3 life.');
  const OPP = card('Test Opposing Ox', 'Creature — Ox', '', ['3', '3']);
  const start = (): GameState => mpScenario({ defs: [SWEET, SIP, OPP], zones: { p1: { battlefield: ['Test Sweet Bear', 'Plains'], hand: ['Test Warm Sip'] }, p2: { battlefield: ['Test Opposing Ox'] } } });
  it('is automated', () => expect(full(SWEET)).toBe(true));
  it('gaining 3 and paying: the chosen creature gets +3/+3 (the amount gained, calculated as the reflexive ability resolves)', () => {
    const s0 = start();
    const ox = onBf(s0, 'p2', 'Test Opposing Ox')[0]!;
    const s = resolveAll(castAs(s0, 'Test Warm Sip', 'p1', { yes: true, targets: [{ kind: 'object', id: ox }] }), { yes: true, targets: [{ kind: 'object', id: ox }] });
    expect(pt(s, ox)).toBe('6/6');
    expect(life(s, 'p1')).toBe(23);
  });
  it('"the amount of life you gained" after an opponent\'s life gain is not understood (negative)', () => {
    expect(full(card('Test Odd Bear', 'Creature — Bear', 'Whenever an opponent gains life, target creature gets +X/+X until end of turn, where X is the amount of life you gained.', ['2', '2']))).toBe(false);
  });
  it('declining to pay: nothing happens (negative)', () => {
    const s0 = start();
    const ox = onBf(s0, 'p2', 'Test Opposing Ox')[0]!;
    const s = resolveAll(castAs(s0, 'Test Warm Sip', 'p1', { yes: false }), { yes: false });
    expect(pt(s, ox)).toBe('3/3');
  });
  it('an opponent gaining life does not trigger it (negative)', () => {
    const s0 = mpScenario({ defs: [SWEET, SIP, OPP], zones: { p1: { battlefield: ['Test Sweet Bear', 'Plains'] }, p2: { hand: ['Test Warm Sip'], battlefield: ['Test Opposing Ox'] } } });
    const ox = onBf(s0, 'p2', 'Test Opposing Ox')[0]!;
    const s = resolveAll(castAs(toPriority(s0, 'p2'), 'Test Warm Sip', 'p2', { yes: true, targets: [{ kind: 'object', id: ox }] }), { yes: true, targets: [{ kind: 'object', id: ox }] });
    expect(pt(s, ox)).toBe('3/3');
  });
});

describe('CR 702.29a, 701.9a, 601.2f: "~ costs {2} less to cast for each card you\'ve cycled or discarded this turn."', () => {
  const HOLLOW = card('Test Hollow Shade', 'Creature — Shade', 'This spell costs {2} less to cast for each card you\'ve cycled or discarded this turn.\nCycling {2}', ['3', '3'], '{5}');
  const LOSE = card('Test Loose Notes', 'Instant', 'Discard a card.');
  const CHAFF = card('Test Chaff Card', 'Sorcery', 'You gain 1 life.');
  const fixture = (lands: number, extra: string[] = []) => ({ defs: [HOLLOW, LOSE, CHAFF], zones: { p1: { battlefield: Array(lands).fill('Plains') as string[], hand: ['Test Hollow Shade', 'Test Loose Notes', 'Test Chaff Card', ...extra] }, p2: { hand: ['Test Loose Notes', 'Test Chaff Card'] } } });
  const castable = (s: GameState, name: string, player = 'p1'): boolean => legal(s, player, 'cast').some((a) => s.defs[s.objects[a.object!]!.defId]!.name === name);
  it('is automated', () => expect(full(HOLLOW)).toBe(true));
  it('costs {5} at first (three lands are not enough) and {3} after one discard', () => {
    const s0 = mpScenario(fixture(3));
    expect(castable(s0, 'Test Hollow Shade')).toBe(false);
    const chaff = find(s0, 'Test Chaff Card', 'hand', 'p1');
    const s1 = resolveAll(castAs(s0, 'Test Loose Notes', 'p1', { objects: [chaff] }), { objects: [chaff] });
    expect(castable(s1, 'Test Hollow Shade')).toBe(true);
  });
  it('two discards make it cost {1}, and three or more never make it cost less than {0} (Scryfall ruling 2021-03-19)', () => {
    const s0 = mpScenario(fixture(1, ['Test Loose Notes', 'Test Chaff Card', 'Test Chaff Card']));
    expect(castable(s0, 'Test Hollow Shade')).toBe(false);
    let s = s0;
    for (let i = 0; i < 2; i++) {
      const pick = (s.zones.hand.p1 ?? []).find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Chaff Card')!;
      s = resolveAll(castAs(s, 'Test Loose Notes', 'p1', { objects: [pick] }), { objects: [pick] });
    }
    expect(castable(s, 'Test Hollow Shade')).toBe(true); // {5} - {4} = {1}, one land
  });
  it('cycling a card counts as discarding it', () => {
    const s0 = mpScenario(fixture(5, ['Test Hollow Shade']));
    expect(castable(s0, 'Test Hollow Shade')).toBe(true);
    const copies = (s0.zones.hand.p1 ?? []).filter((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Test Hollow Shade');
    const cyc = legal(s0, 'p1', 'activate').find((a) => a.object === copies[0] && a.label.toLowerCase().includes('cycl'))!;
    const s1 = resolveAll(settle(act(s0, cyc.action)));
    // five lands, two spent on cycling: three left, and the other Shade costs {5} - {2} = {3}
    expect(castable(s1, 'Test Hollow Shade')).toBe(true);
    const s2 = mpScenario(fixture(3, ['Test Hollow Shade']));
    expect(castable(s2, 'Test Hollow Shade')).toBe(false);
  });
  it('an opponent\'s discard does not make it cheaper (negative)', () => {
    let s = mpScenario(fixture(3));
    const chaff = find(s, 'Test Chaff Card', 'hand', 'p2');
    s = resolveAll(castAs(toPriority(s, 'p2'), 'Test Loose Notes', 'p2', { objects: [chaff] }), { objects: [chaff] });
    expect(castable(s, 'Test Hollow Shade')).toBe(false);
  });
});

describe('CR 702.6a, 601.2f: "Equip costs you pay cost {1} less." and "As long as ~ is equipped, each creature you control that\'s a Soldier or a Knight gets +1/+1."', () => {
  const SMITH = card('Test Plate Smith', 'Creature — Human Artificer', 'Equip costs you pay cost {1} less.\nAs long as ~ is equipped, each creature you control that\'s a Soldier or a Knight gets +1/+1.', ['1', '1']);
  const BLADE = card('Test Short Blade', 'Artifact — Equipment', 'Equipped creature gets +0/+0.\nEquip {2}');
  const FOOT = card('Test Footman', 'Creature — Human Soldier', '', ['2', '2']);
  const WIZ = card('Test Hedge Wizard', 'Creature — Human Wizard', '', ['1', '1']);
  const GIZMO = card('Test Idle Gizmo', 'Artifact', '{2}: You gain 1 life.');
  const equipAction = (s: GameState, player = 'p1') => legal(s, player, 'activate').find((a) => a.label.toLowerCase().includes('equip'));
  const start = (lands: number, withSmith = true): GameState => mpScenario({ defs: [SMITH, BLADE, FOOT, WIZ, GIZMO], zones: { p1: { battlefield: [...(withSmith ? ['Test Plate Smith'] : []), 'Test Short Blade', 'Test Footman', 'Test Hedge Wizard', 'Test Idle Gizmo', ...(Array(lands).fill('Plains') as string[])] } } });
  it('is automated', () => expect(full(SMITH)).toBe(true));
  it('with one land the equip ability ({2}, reduced to {1}) can be activated; without the card it cannot', () => {
    expect(equipAction(start(1))).toBeDefined();
    expect(equipAction(start(1, false))).toBeUndefined();
  });
  it('only equip costs get cheaper: another activated ability still costs {2} (negative)', () => {
    const s = start(1);
    expect(legal(s, 'p1', 'activate').some((a) => a.label.toLowerCase().includes('gain 1 life'))).toBe(false);
  });
  it('as long as it is equipped, Soldiers and Knights get +1/+1, others do not; unequipped, nobody does', () => {
    const s0 = start(2);
    const foot = onBf(s0, 'p1', 'Test Footman')[0]!;
    const wiz = onBf(s0, 'p1', 'Test Hedge Wizard')[0]!;
    expect(pt(s0, foot)).toBe('2/2');
    const smith = onBf(s0, 'p1', 'Test Plate Smith')[0]!;
    const eq = equipAction(s0)!;
    const s1 = resolveAll(settle(act(s0, eq.action), { targets: [{ kind: 'object', id: smith }] }), { targets: [{ kind: 'object', id: smith }] });
    expect(s1.objects[onBf(s1, 'p1', 'Test Short Blade')[0]!]!.attachedTo).toBe(smith);
    expect(pt(s1, foot)).toBe('3/3');
    expect(pt(s1, wiz)).toBe('1/1');
  });
});

describe('CR 614.1a, 120.3: "If a noncreature source you control would deal damage to a creature, battle, or opponent, it deals that much damage plus 2 instead."', () => {
  const DISC = card('Test Burning Choir', 'Enchantment', 'If a noncreature source you control would deal damage to a creature, battle, or opponent, it deals that much damage plus 2 instead.');
  const ZIP = card('Test Sparkle Zip', 'Instant', '~ deals 2 damage to any target.');
  const PROD = card('Test Hot Prod', 'Artifact', '{T}: ~ deals 1 damage to any target.');
  const IMP = card('Test Tiny Imp', 'Creature — Imp', '{T}: ~ deals 1 damage to any target.', ['1', '1']);
  const OX = card('Test Steady Ox', 'Creature — Ox', '', ['1', '5']);
  const defs = [DISC, ZIP, PROD, IMP, OX];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Burning Choir', 'Test Hot Prod', 'Test Tiny Imp', 'Test Steady Ox'], hand: ['Test Sparkle Zip'] }, p2: { battlefield: ['Test Steady Ox'], hand: ['Test Sparkle Zip'] } } });
  const target = (id: string, kind: 'object' | 'player' = 'object') => ({ kind, id } as never);
  const damageOf = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;
  it('is automated', () => expect(full(DISC)).toBe(true));
  it('an instant of yours deals 2 + 2 to a creature (any controller) and to an opponent', () => {
    const s0 = start();
    const ox2 = onBf(s0, 'p2', 'Test Steady Ox')[0]!;
    const s1 = resolveAll(castAs(s0, 'Test Sparkle Zip', 'p1', { targets: [target(ox2)] }), { targets: [target(ox2)] });
    expect(damageOf(s1, ox2)).toBe(4);
    const s2 = resolveAll(castAs(s0, 'Test Sparkle Zip', 'p1', { targets: [target('p2', 'player')] }), { targets: [target('p2', 'player')] });
    expect(life(s2, 'p2')).toBe(16);
    const ox1 = onBf(s0, 'p1', 'Test Steady Ox')[0]!;
    const s3 = resolveAll(castAs(s0, 'Test Sparkle Zip', 'p1', { targets: [target(ox1)] }), { targets: [target(ox1)] });
    expect(damageOf(s3, ox1)).toBe(4);
  });
  it('damage to yourself is not raised, and neither is damage from a creature source (negatives)', () => {
    const s0 = start();
    const s1 = resolveAll(castAs(s0, 'Test Sparkle Zip', 'p1', { targets: [target('p1', 'player')] }), { targets: [target('p1', 'player')] });
    expect(life(s1, 'p1')).toBe(18);
    const imp = onBf(s0, 'p1', 'Test Tiny Imp')[0]!;
    const act1 = legal(s0, 'p1', 'activate').find((a) => a.object === imp && !a.isMana)!;
    const s2 = resolveAll(settle(act(s0, act1.action), { targets: [target('p2', 'player')] }), { targets: [target('p2', 'player')] });
    expect(life(s2, 'p2')).toBe(19);
  });
  it('a noncreature permanent source of yours (an artifact) deals 1 + 2', () => {
    const s0 = start();
    const prod = onBf(s0, 'p1', 'Test Hot Prod')[0]!;
    const act1 = legal(s0, 'p1', 'activate').find((a) => a.object === prod && !a.isMana)!;
    const s1 = resolveAll(settle(act(s0, act1.action), { targets: [target('p2', 'player')] }), { targets: [target('p2', 'player')] });
    expect(life(s1, 'p2')).toBe(17);
  });
  it('an opponent\'s noncreature source is not raised (negative)', () => {
    const s0 = start();
    const s1 = resolveAll(castAs(toPriority(s0, 'p2'), 'Test Sparkle Zip', 'p2', { targets: [target('p3', 'player')] }), { targets: [target('p3', 'player')] });
    expect(life(s1, 'p3')).toBe(18);
  });
});

describe('CR 611.2a, 613.1f: "Until end of turn, up to two target creatures you control each gain "Whenever ~ deals combat damage to a player, draw a card.""', () => {
  const LESSON = card('Test Hard Lesson', 'Instant', 'Until end of turn, up to two target creatures you control each gain "Whenever ~ deals combat damage to a player, draw a card."');
  const KNIGHT = card('Test Lone Knight', 'Creature — Human Knight', '', ['2', '2']);
  const start = (): GameState => mpScenario({ defs: [LESSON, KNIGHT], zones: { p1: { battlefield: ['Test Lone Knight', 'Test Lone Knight', 'Test Lone Knight'], hand: ['Test Hard Lesson'] } } });
  const handCount = (s: GameState): number => (s.zones.hand.p1 ?? []).length;
  /** Cast the Lesson on the first `n` Knights, attack with all three unblocked, finish the combat damage and its triggers. */
  const play = (n: number): GameState => {
    const s0 = start();
    const knights = onBf(s0, 'p1', 'Test Lone Knight');
    let s = resolveAll(castAs(s0, 'Test Hard Lesson', 'p1', { targets: knights.slice(0, n).map((id) => ({ kind: 'object', id }) as never) }), { targets: knights.slice(0, n).map((id) => ({ kind: 'object', id }) as never) });
    s = declareAttackers(toDeclareAttackers(s), knights.map((id) => [id] as [ObjectId]));
    return toEndOfCombat(s);
  };
  it('is automated', () => expect(full(LESSON)).toBe(true));
  it('two chosen creatures that deal combat damage to a player draw a card each; the third, unchosen, draws none', () => {
    const before = handCount(start()) - 1; // the Lesson itself leaves the hand
    expect(handCount(play(2)) - before).toBe(2);
  });
  it('one chosen creature draws one card (up to two targets)', () => {
    const before = handCount(start()) - 1;
    expect(handCount(play(1)) - before).toBe(1);
  });
});

describe('CR 701.16a, 608.2h: "Whenever ~ attacks, investigate once for each nontoken attacking creature."', () => {
  const SOPH = card('Test Clue Scout', 'Legendary Creature — Human Detective', 'Menace\nWhenever ~ attacks, investigate once for each nontoken attacking creature.', ['2', '2']);
  const PAWN = card('Test Pawn Guard', 'Creature — Human', '', ['1', '1']);
  const TOKS = card('Test Token Maker', 'Sorcery', 'Create a 1/1 white Soldier creature token with haste.');
  const clues = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.kind === 'token' && s.objects[id]!.defId.includes('Clue')).length;
  it('is automated', () => expect(full(SOPH)).toBe(true));
  it('three nontoken attackers: three Clues; a token attacking beside them is not counted', () => {
    const s0 = mpScenario({ defs: [SOPH, PAWN, TOKS], zones: { p1: { battlefield: ['Test Clue Scout', 'Test Pawn Guard', 'Test Pawn Guard'], hand: ['Test Token Maker'] } } });
    const s1 = resolveAll(castAs(s0, 'Test Token Maker', 'p1'));
    const attackers = s1.zones.battlefield.filter((id) => s1.objects[id]!.controller === 'p1' && s1.objects[id]!.kind !== 'ability');
    const tokensOn = attackers.filter((id) => s1.objects[id]!.kind === 'token');
    let s = declareAttackers(toDeclareAttackers(s1), attackers.map((id) => [id] as [ObjectId]));
    s = toEndOfCombat(s);
    expect(tokensOn.length).toBe(1);
    expect(clues(s)).toBe(3);
  });
  it('attacking alone: one Clue', () => {
    const s0 = mpScenario({ defs: [SOPH, PAWN], zones: { p1: { battlefield: ['Test Clue Scout', 'Test Pawn Guard'] } } });
    const scout = onBf(s0, 'p1', 'Test Clue Scout')[0]!;
    let s = declareAttackers(toDeclareAttackers(s0), [[scout]]);
    s = toEndOfCombat(s);
    expect(clues(s)).toBe(1);
  });
});
