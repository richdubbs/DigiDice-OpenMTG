/**
 * Commander coordinator D, round edh-d-14 (EDHREC ranks 13,751-15,000, fourth pass): the round's readings played through the engine with synthetic cards (invented names, design
 * 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites
 * not checked against the Comprehensive Rules text are listed as unverified in the round's record.
 *
 *   CR 701.9a, 115.1, 109.4     "~ deals X damage to target opponent or planeswalker. That player or that planeswalker's controller discards X cards." (Rakdos's Return)
 *   CR 601.3b, 702.8a, 611.2    "The next creature card you play this turn can be played as though it had flash." (Scout's Warning)
 *   CR 702.33a, 107.3, 122.1    "Kicker {X}{2}", "When ~ enters, if it was kicked, put X feather counters on it." (Kangee, Aerie Keeper)
 *   CR 121.2, 113.6m, 603.2     "When you draw your third card in a turn, return ~ from your graveyard to the battlefield tapped." (Sneaky Snacker)
 *   CR 702.6a, 702.6c, 111.1    "Equip creature token {1}" beside "Equip {3}" (Team Pennant)
 *   CR 614.1c, 614.12, 601.2i   "Creatures played by your opponents enter tapped." (Uphill Battle)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, activations, advanceTo, card, cast, drive, find, full, legal, obj, resolveAll, scenario } from '../r3-cost/support';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const handNames = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => nameOf(s, id)).sort();
const gyNames = (s: GameState, p: PlayerId): string[] => s.zones.graveyard[p]!.map((id) => nameOf(s, id)).sort();
const idOn = (s: GameState, name: string, p?: PlayerId): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === name && (p === undefined || s.objects[id]!.controller === p))!;
const onBf = (s: GameState, name: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name && (p === undefined || s.objects[id]!.controller === p));

describe('"~ deals X damage to target opponent or planeswalker. That player or that planeswalker\'s controller discards X cards." (CR 701.9a, 115.1, 109.4; Rakdos\'s Return)', () => {
  const RET = card('Test Dual Return', 'Sorcery', 'Test Dual Return deals X damage to target opponent or planeswalker. That player or that planeswalker\'s controller discards X cards.', '{X}');
  const WALKER = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Test', oracle_text: '', colors: [], keywords: [], loyalty: '4' } as OracleCard);
  const CARD = card('Test Card', 'Artifact', '');
  const defs = [RET, WALKER, CARD];
  const start = () => scenario([], { p1: { hand: ['Test Dual Return'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] }, p2: { hand: ['Test Card', 'Test Card', 'Test Card', 'Test Card'], battlefield: [{ name: 'Test Walker', counters: { loyalty: 4 } }] }, defs });
  it('has no manual part', () => expect(full(RET)).toBe(true));
  it('targeting the opponent: X damage and that player discards X cards', () => {
    const s0 = start();
    const s = resolveAll(cast(s0, 'Test Dual Return', { x: [2], targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(18);
    expect(s.zones.hand.p2!.length).toBe(2);
  });
  it('the negative case: targeting a planeswalker, its controller (not the other way round) discards X cards', () => {
    const s0 = start();
    const w = idOn(s0, 'Test Walker', 'p2');
    const s = resolveAll(cast(s0, 'Test Dual Return', { x: [3], targets: [[obj(w)]] }));
    expect(s.zones.hand.p2!.length).toBe(1);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(20);
  });
});

describe('"The next creature card you play this turn can be played as though it had flash." (CR 601.3b, 702.8a, 611.2; Scout\'s Warning)', () => {
  const WARN = card('Test Warning', 'Instant', 'The next creature card you play this turn can be played as though it had flash.\nDraw a card.', '{W}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const ARTI = card('Test Relic', 'Artifact', '', '{1}');
  const defs = [WARN, BEAR, ARTI];
  const start = () => scenario([], { p1: { hand: ['Test Warning', 'Test Bear', 'Test Bear', 'Test Relic'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] }, p2: {}, defs });
  it('has no manual part', () => expect(full(WARN)).toBe(true));
  const CANTRIP = card('Test Flicker', 'Instant', 'Draw a card.', '{0}');
  const defs2 = [WARN, BEAR, ARTI, CANTRIP];
  const start2 = () => scenario([], { p1: { hand: ['Test Warning', 'Test Flicker', 'Test Bear', 'Test Bear', 'Test Relic'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] }, p2: {}, defs: defs2 });
  const castable = (s: GameState, n: string): boolean => legal(s, 'p1', 'cast').some((a) => nameOf(s, a.object!) === n);
  it('after it resolves, a creature card can be cast while a spell is on the stack (instant timing), once; the second creature cannot', () => {
    let s = resolveAll(cast(start2(), 'Test Warning'));
    s = cast(s, 'Test Flicker'); // leaves a spell on the stack: only an instant-speed cast is legal now
    expect(castable(s, 'Test Bear')).toBe(true);
    s = cast(s, 'Test Bear');
    expect(castable(s, 'Test Bear')).toBe(false);
  });
  it('the negative case: an artifact card cannot be cast at instant timing, and without the spell a creature cannot either', () => {
    let s = resolveAll(cast(start2(), 'Test Warning'));
    s = cast(s, 'Test Flicker');
    expect(castable(s, 'Test Relic')).toBe(false);
    const t = cast(start2(), 'Test Flicker');
    expect(castable(t, 'Test Bear')).toBe(false);
  });
});

describe('"Kicker {X}{2}", "When ~ enters, if it was kicked, put X feather counters on it." (CR 702.33a, 107.3; Kangee, Aerie Keeper)', () => {
  const KANGEE = card('Test Keeper', 'Creature — Bird Wizard', 'Kicker {X}{2}\nFlying\nWhen Test Keeper enters, if it was kicked, put X feather counters on it.\nOther Bird creatures get +1/+1 for each feather counter on Test Keeper.', '{2}{W}', ['2', '2']);
  const BIRD = card('Test Sparrow', 'Creature — Bird', '', '{0}', ['1', '1']);
  const defs = [KANGEE, BIRD];
  const start = () => scenario([], { p1: { hand: ['Test Keeper'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', { name: 'Test Sparrow' }] }, p2: {}, defs });
  it('has no manual part', () => expect(full(KANGEE)).toBe(true));
  it('kicked with X = 2: two feather counters, and the other Bird gets +2/+2', () => {
    const s = resolveAll(cast(start(), 'Test Keeper', { yes: [true], x: [2] }));
    const k = idOn(s, 'Test Keeper')!;
    expect(s.objects[k]!.counters['feather'] ?? 0).toBe(2);
    const sp = idOn(s, 'Test Sparrow')!;
    expect(Number(getChars(s, sp).power)).toBe(3);
  });
  it('the negative case: not kicked, no counters', () => {
    const s = resolveAll(cast(start(), 'Test Keeper', { yes: [false] }));
    const k = idOn(s, 'Test Keeper')!;
    expect(s.objects[k]!.counters['feather'] ?? 0).toBe(0);
  });
});

describe('"When you draw your third card in a turn, return ~ from your graveyard to the battlefield tapped." (CR 121.2, 113.6m; Sneaky Snacker)', () => {
  const SNACK = card('Test Snacker', 'Creature — Faerie Rogue', 'Flying\nWhen you draw your third card in a turn, return Test Snacker from your graveyard to the battlefield tapped.', '{U}{B}', ['1', '1']);
  const DRAW3 = card('Test Cantrip', 'Instant', 'Draw three cards.', '{0}');
  const DRAW2 = card('Test Twice', 'Instant', 'Draw two cards.', '{0}');
  const defs = [SNACK, DRAW3, DRAW2];
  it('has no manual part', () => expect(full(SNACK)).toBe(true));
  it('drawing three cards in one turn returns it from the graveyard tapped', () => {
    const s0 = scenario([], { p1: { hand: ['Test Cantrip'], graveyard: ['Test Snacker'] }, p2: {}, defs });
    const s = resolveAll(cast(s0, 'Test Cantrip'));
    expect(idOn(s, 'Test Snacker', 'p1')).toBeDefined();
    expect(s.objects[idOn(s, 'Test Snacker', 'p1')!]!.tapped).toBe(true);
    expect(gyNames(s, 'p1')).not.toContain('Test Snacker');
  });
  it('the negative case: only two cards drawn, it stays in the graveyard', () => {
    const s0 = scenario([], { p1: { hand: ['Test Twice'], graveyard: ['Test Snacker'] }, p2: {}, defs });
    const s = resolveAll(cast(s0, 'Test Twice'));
    expect(idOn(s, 'Test Snacker', 'p1')).toBeUndefined();
    expect(gyNames(s, 'p1')).toContain('Test Snacker');
  });
});

describe('"Equip creature token {1}" and "Equip {3}" (CR 702.6a, 702.6c, 111.1; Team Pennant)', () => {
  const PENNANT = card('Test Pennant', 'Artifact — Equipment', 'Equipped creature gets +1/+1 and has vigilance and trample.\nEquip creature token {1}\nEquip {3}', '{1}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const TOKENMAKER = card('Test Maker', 'Artifact', '{0}: Create a 1/1 white Soldier creature token.');
  const defs = [PENNANT, BEAR, TOKENMAKER];
  it('has no manual part', () => expect(full(PENNANT)).toBe(true));
  /** The creatures the equip ability number `n` of the Pennant can target, found by trying it. */
  const equipTargets = (s: GameState, n: number): string[] => {
    const acts = legal(s, 'p1', 'activate').filter((a) => a.object === find(s, 'Test Pennant', 'battlefield', 'p1') && a.isMana !== true);
    const d = act(s, acts[n]!.action).pending as unknown as { kind: string; objects: string[] };
    return d.objects.map((id) => nameOf(s, id)).sort();
  };
  it('the {1} ability can target a creature token only; the {3} ability any creature you control', () => {
    let s = scenario([], { p1: { battlefield: ['Plains', 'Plains', 'Plains', 'Plains', { name: 'Test Pennant' }, { name: 'Test Bear' }, { name: 'Test Maker' }] }, p2: {}, defs });
    s = resolveAll(act(s, activations(s, 'Test Maker')[0]!.action));
    const all = legal(s, 'p1', 'activate').filter((a) => a.object === find(s, 'Test Pennant', 'battlefield', 'p1'));
    expect(all.length).toBe(2);
    expect(equipTargets(s, 0)).toEqual(['Soldier Token']);
    expect(equipTargets(s, 1)).toEqual(['Soldier Token', 'Test Bear']);
  });
  it('the negative case: with no creature token, only the {3} ability is offered a target', () => {
    const s = scenario([], { p1: { battlefield: ['Plains', 'Plains', 'Plains', 'Plains', { name: 'Test Pennant' }, { name: 'Test Bear' }] }, p2: {}, defs });
    const acts = legal(s, 'p1', 'activate').filter((a) => a.object === find(s, 'Test Pennant', 'battlefield', 'p1'));
    expect(acts.length).toBeLessThanOrEqual(2);
    expect(equipTargets(s, acts.length - 1)).toEqual(['Test Bear']);
  });
});

describe('"Creatures played by your opponents enter tapped." (CR 614.1c, 614.12, 601.2i; Uphill Battle)', () => {
  const BATTLE = card('Test Hill', 'Enchantment', 'Creatures played by your opponents enter tapped.', '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const MAKER = card('Test Maker', 'Artifact', '{0}: Create a 1/1 white Soldier creature token.');
  const defs = [BATTLE, BEAR, MAKER];
  it('has no manual part', () => expect(full(BATTLE)).toBe(true));
  it('a creature spell cast by the opponent enters tapped; your own creature spell enters untapped; an opponent\'s token enters untapped', () => {
    let s = scenario([], { p1: { hand: ['Test Bear'], battlefield: [{ name: 'Test Hill' }] }, p2: { hand: ['Test Bear'], battlefield: [{ name: 'Test Maker' }] }, defs });
    s = resolveAll(cast(s, 'Test Bear'));
    expect(s.objects[idOn(s, 'Test Bear', 'p1')!]!.tapped).toBe(false);
    s = advanceTo(s, 2, 'main1');
    s = resolveAll(cast(s, 'Test Bear', {}, 'p2'));
    expect(s.objects[idOn(s, 'Test Bear', 'p2')!]!.tapped).toBe(true);
    s = resolveAll(act(s, activations(s, 'Test Maker', false, 'p2')[0]!.action));
    const token = s.zones.battlefield.find((id) => nameOf(s, id) === 'Soldier Token' && s.objects[id]!.controller === 'p2')!;
    expect(s.objects[token]!.tapped).toBe(false);
  });
});

describe('"When ~ enters, if it entered from your graveyard or you cast it from your graveyard, exile it. If you do, create a 5/5 black Demon creature token with flying." (CR 400.7, 603.4, 601.2a; Archfiend\'s Vessel)', () => {
  const VESSEL = card('Test Vessel', 'Creature — Human Cleric', 'Lifelink\nWhen Test Vessel enters, if it entered from your graveyard or you cast it from your graveyard, exile it. If you do, create a 5/5 black Demon creature token with flying.', '{1}', ['1', '1']);
  const RAISE = card('Test Raise', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.', '{0}');
  const defs = [VESSEL, RAISE];
  it('has no manual part', () => expect(full(VESSEL)).toBe(true));
  it('returned from the graveyard to the battlefield: exiled, and a 5/5 flying Demon token appears', () => {
    const s0 = scenario([], { p1: { hand: ['Test Raise'], graveyard: ['Test Vessel'] }, p2: {}, defs });
    const v = find(s0, 'Test Vessel', 'graveyard', 'p1');
    const s = resolveAll(cast(s0, 'Test Raise', { targets: [[obj(v)]] }));
    expect(onBf(s, 'Test Vessel').length).toBe(0);
    expect(s.zones.exile.some((id) => nameOf(s, id) === 'Test Vessel')).toBe(true);
    const demon = s.zones.battlefield.find((id) => nameOf(s, id) === 'Demon Token')!;
    expect(demon).toBeDefined();
    expect(Number(getChars(s, demon).power)).toBe(5);
  });
  it('the negative case: cast from the hand, it stays and no Demon is made', () => {
    const s0 = scenario([], { p1: { hand: ['Test Vessel'], battlefield: ['Plains'] }, p2: {}, defs });
    const s = resolveAll(cast(s0, 'Test Vessel'));
    expect(onBf(s, 'Test Vessel', 'p1').length).toBe(1);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Demon Token')).toBe(false);
  });
});

describe('"Tap any number of untapped creatures you control. Create a 4/4 white Angel creature token with flying for each creature tapped this way." (CR 701.26a, 608.2c, 608.2h; Devout Invocation)', () => {
  const INVOKE = card('Test Invocation', 'Sorcery', 'Tap any number of untapped creatures you control. Create a 4/4 white Angel creature token with flying for each creature tapped this way.', '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const defs = [INVOKE, BEAR];
  const start = () => scenario([], { p1: { hand: ['Test Invocation'], battlefield: ['Test Bear', 'Test Bear', { name: 'Test Bear', tapped: true }] }, p2: { battlefield: ['Test Bear'] }, defs });
  const angels = (s: GameState): number => s.zones.battlefield.filter((id) => nameOf(s, id) === 'Angel Token').length;
  it('has no manual part', () => expect(full(INVOKE)).toBe(true));
  it('tapping two of your untapped creatures makes two Angels (the tapped one and the opponent\'s creature are not counted)', () => {
    const s0 = start();
    const mine = onBf(s0, 'Test Bear', 'p1').filter((id) => !s0.objects[id]!.tapped);
    expect(mine.length).toBe(2);
    const s = resolveAll(cast(s0, 'Test Invocation'), { objects: [mine] });
    expect(angels(s)).toBe(2);
    expect(mine.every((id) => s.objects[id]!.tapped)).toBe(true);
  });
  it('the negative case: tapping none makes none', () => {
    const s = resolveAll(cast(start(), 'Test Invocation'), { objects: [[]] });
    expect(angels(s)).toBe(0);
  });
});

describe('Uphill Battle: a copy of a creature spell is not cast, and a creature of your own cast spell enters tapped only when an opponent played it (CR 707.10, 601.2i)', () => {
  const BATTLE = card('Test Hill', 'Enchantment', 'Creatures played by your opponents enter tapped.', '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const MIRROR = card('Test Mirror', 'Instant', 'Copy target creature spell you control.', '{0}');
  const defs = [BATTLE, BEAR, MIRROR];
  it('the cast Bear enters tapped, the token copy of the spell enters untapped', () => {
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Hill' }] }, p2: { hand: ['Test Bear', 'Test Mirror'] }, defs });
    s = advanceTo(s, 2, 'main1');
    s = cast(s, 'Test Bear', {}, 'p2');
    const spell = s.zones.stack[s.zones.stack.length - 1]!;
    s = cast(s, 'Test Mirror', { targets: [[obj(spell)]] }, 'p2');
    s = resolveAll(s);
    const bears = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Bear' && s.objects[id]!.controller === 'p2');
    expect(bears.length).toBe(2);
    expect(bears.filter((id) => s.objects[id]!.tapped).length).toBe(1);
  });
});

describe('Archfiend\'s Vessel: only a card that came from YOUR graveyard counts (CR 109.5, 603.4)', () => {
  const VESSEL = card('Test Vessel', 'Creature — Human Cleric', 'Lifelink\nWhen Test Vessel enters, if it entered from your graveyard or you cast it from your graveyard, exile it. If you do, create a 5/5 black Demon creature token with flying.', '{1}', ['1', '1']);
  const STEAL = card('Test Steal', 'Sorcery', 'Put target creature card from a graveyard onto the battlefield under your control.', '{0}');
  it('an opponent bringing it back from your graveyard keeps it and gets no Demon', () => {
    let s = scenario([], { p1: { graveyard: ['Test Vessel'] }, p2: { hand: ['Test Steal'] }, defs: [VESSEL, STEAL] });
    s = advanceTo(s, 2, 'main1');
    const v = find(s, 'Test Vessel', 'graveyard', 'p1');
    s = resolveAll(cast(s, 'Test Steal', { targets: [[obj(v)]] }, 'p2'));
    expect(onBf(s, 'Test Vessel', 'p2').length).toBe(1);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Demon Token')).toBe(false);
  });
});
