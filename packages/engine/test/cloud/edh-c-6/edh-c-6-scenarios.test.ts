/**
 * Commander effort, round edh-c-6 (EDHREC ranks 18,126 to 18,750): the round's readings played through the engine with synthetic cards (invented names), compiled by the game's
 * default compiler. Alice (p1) casts and attacks. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 506.2, 506.3, 608.2h     "Attacking creatures get +X/+0 until end of turn, where X is the number of players being attacked."
 *   CR 601.2h, 106.1, 608.2c    "... if {B} was spent to cast this spell": each color of the mana paid counts alone; "Do both if {B}{R} was spent"
 *   CR 614.1c, 122.6, 601.2h    "If {G} was spent to cast this spell, that creature enters with an additional +1/+1 counter on it"; spell mastery
 *   CR 118.12, 305.6, 205.3i    "Counter target spell unless its controller pays {1} for each basic land type among lands you control."
 *   CR 603.4, 208.1             "if that creature is 1/1"
 *   CR 115.3, 122.1             "... on target creature, ... on another target creature, and ... on a third target creature"
 *   CR 401.4, 608.2d            "Target opponent puts a card from their hand on top of their library."
 *   CR 109.4, 608.2c            "Counter target spell if you control more creatures than that spell's controller."
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ObjectId, TargetChoice } from '../../../src/index';
import { act, find, pass, scenario } from '../../m3/scenario';
import { answer, drive, mpScenario, passUntil } from '../../m12/rules/helpers';
import { card, counters, full, inYard, named, pt, resolveAll, settle, type Picks } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const cast = (s: GameState, name: string, p: Picks = {}, who = 'p1'): GameState => settle(act(s, { type: 'cast', player: who, card: find(s, name, 'hand', who) }), p);
/** Cast a spell and answer its target prompts one by one (a list of targets for each target spec of the spell). */
function castAt(s0: GameState, name: string, perSpec: TargetChoice[][], pick: Picks = {}, who = 'p1'): GameState {
  let s = act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) });
  for (let i = 0; i < 12 && s.pending && s.pending.kind !== 'priority'; i++) {
    if (s.pending.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: 1 });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: perSpec.shift() ?? [] });
    else s = settle(s, pick);
  }
  return s;
}
const onBf = (s: GameState, defId: string): boolean => named(s, defId).length > 0;

const REVIVE = card('Test Revive', 'Sorcery', 'Return target creature card from your graveyard to the battlefield. If {G} was spent to cast this spell, that creature enters with an additional +1/+1 counter on it.', undefined, '{2}{B}');
const SURGE = card('Test Surge', 'Sorcery', 'Return up to one target creature card from your graveyard to the battlefield if {B} was spent to cast this spell. Creatures target player controls get +2/+0 and gain haste until end of turn if {R} was spent to cast this spell.', undefined, '{2}{B/R}');
const SUMMON = card('Test Summon', 'Sorcery', 'Put target creature card from a graveyard onto the battlefield under your control.\nSpell mastery — If there are two or more instant and/or sorcery cards in your graveyard, that creature enters with two additional +1/+1 counters on it.', undefined, '{1}{B}');
const DISPEL = card('Test Dispel', 'Instant', 'Counter target spell unless its controller pays {1} for each basic land type among lands you control.', undefined, '{U}');
const WILL = card('Test Will', 'Instant', 'Counter target spell if you control more creatures than that spell\'s controller.', undefined, '{U}');
const HOWL = card('Test Howl', 'Instant', 'Attacking creatures get +X/+0 until end of turn, where X is the number of players being attacked.\nDraw a card.', undefined, '{R}');
const CAPTAIN = card('Test Captain', 'Creature — Rhino Soldier', 'Whenever a creature you control enters, if that creature is 1/1, put two +1/+1 counters on it.', ['4', '4']);
const GROWTH = card('Test Growth', 'Sorcery', 'Put a +1/+1 counter on target creature, two +1/+1 counters on another target creature, and three +1/+1 counters on a third target creature.', undefined, '{3}{G}');
const RATS = card('Test Rats', 'Creature — Rat', 'When this creature enters, target opponent puts a card from their hand on top of their library.', ['1', '1'], '{1}{B}');
const SPASM = card('Test Spasm', 'Instant', 'Test Spasm deals X damage to target creature without flying you don\'t control.', undefined, '{X}{R}');
const ECHO = card('Test Echo', 'Instant', 'Copy target instant or sorcery spell. You may choose new targets for the copy.', undefined, '{0}');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const MOTH = card('Test Moth', 'Creature — Insect', 'Flying', ['2', '2']);
const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
const PEBBLE = card('Test Pebble', 'Sorcery', 'You gain 1 life.', undefined, '{G}');
const SHOCK = card('Test Shock', 'Instant', 'You gain 1 life.', undefined, '{R}');
const DEFS: CardDef[] = [ECHO, REVIVE, SURGE, SUMMON, DISPEL, WILL, HOWL, CAPTAIN, GROWTH, RATS, SPASM, BEAR, MOTH, ELF, PEBBLE, SHOCK];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 614.1c, 122.6, 601.2h: "If {G} was spent to cast this spell, that creature enters with an additional +1/+1 counter on it"', () => {
  const setup = (lands: string[]): GameState => scenario(['Swamp', 'Forest'], { p1: { hand: ['Test Revive'], battlefield: lands, graveyard: ['Test Bear'] }, defs: DEFS });
  it('{G} among the mana paid: the creature returns with one +1/+1 counter', () => {
    let s = setup(['Swamp', 'Swamp', 'Forest']);
    s = resolveAll(cast(s, 'Test Revive', { targets: [obj(find(s, 'Test Bear', 'graveyard'))] }));
    const bear = named(s, 'Test Bear')[0]!;
    expect(counters(s, bear, '+1/+1')).toBe(1);
    expect(pt(s, bear)).toBe('3/3');
  });
  it('no {G} among the mana paid (negative): the creature returns with no counter', () => {
    let s = setup(['Swamp', 'Swamp', 'Swamp']);
    s = resolveAll(cast(s, 'Test Revive', { targets: [obj(find(s, 'Test Bear', 'graveyard'))] }));
    const bear = named(s, 'Test Bear')[0]!;
    expect(counters(s, bear, '+1/+1')).toBe(0);
    expect(pt(s, bear)).toBe('2/2');
  });
});

describe('CR 707.10, 601.2h: a copy of the spell had no mana spent on it (Torrent of Souls ruling 2016-06-08)', () => {
  it('Test Revive paid with {G}, copied: the copy returns the creature with no counter (the original then has no target)', () => {
    let s = scenario(['Swamp', 'Forest'], { p1: { hand: ['Test Revive', 'Test Echo'], battlefield: ['Swamp', 'Swamp', 'Forest'], graveyard: ['Test Bear'] }, defs: DEFS });
    s = castAt(s, 'Test Revive', [[obj(find(s, 'Test Bear', 'graveyard'))]]);
    s = castAt(s, 'Test Echo', [[obj(s.zones.stack[0]!)]], { yes: false });
    s = resolveAll(s, { yes: false });
    expect(counters(s, named(s, 'Test Bear')[0]!, '+1/+1')).toBe(0);
  });
});

describe('CR 614.1c, 122.6: spell mastery gives the returned creature two additional +1/+1 counters', () => {
  const setup = (yard: string[]): GameState => scenario(['Swamp'], { p1: { hand: ['Test Summon'], battlefield: ['Swamp', 'Swamp'], graveyard: yard }, p2: { graveyard: ['Test Bear'] }, defs: DEFS });
  it('two instant and/or sorcery cards in your graveyard: two counters, the creature from an opponent\'s graveyard comes under your control', () => {
    let s = setup(['Test Pebble', 'Test Shock']);
    s = resolveAll(cast(s, 'Test Summon', { targets: [obj(find(s, 'Test Bear', 'graveyard', 'p2'))] }));
    const bear = named(s, 'Test Bear')[0]!;
    expect(s.objects[bear]!.controller).toBe('p1');
    expect(counters(s, bear, '+1/+1')).toBe(2);
  });
  it('only one instant or sorcery card (negative): no counters', () => {
    let s = setup(['Test Pebble']);
    s = resolveAll(cast(s, 'Test Summon', { targets: [obj(find(s, 'Test Bear', 'graveyard', 'p2'))] }));
    const bear = named(s, 'Test Bear')[0]!;
    expect(s.objects[bear]!.controller).toBe('p1');
    expect(counters(s, bear, '+1/+1')).toBe(0);
  });
});

describe('CR 601.2h, 106.1, 608.2c: each "if {C} was spent to cast this spell" is checked alone (Do both if {B}{R} was spent)', () => {
  const setup = (lands: string[]): GameState => scenario(['Swamp', 'Mountain'], { p1: { hand: ['Test Surge'], battlefield: lands, graveyard: ['Test Bear'] }, p2: { battlefield: ['Test Elf'] }, defs: DEFS });
  it('{B} only: the creature returns, nobody gets +2/+0 and haste', () => {
    let s = setup(['Swamp', 'Swamp', 'Swamp']);
    s = resolveAll(castAt(s, 'Test Surge', [[obj(find(s, 'Test Bear', 'graveyard'))], [player('p1')]]));
    expect(onBf(s, 'Test Bear')).toBe(true);
  });
  it('{R} only (negative for the return): nothing returns, the creature gets +2/+0 and haste', () => {
    let s = setup(['Mountain', 'Mountain', 'Mountain']);
    s = resolveAll(castAt(s, 'Test Surge', [[obj(find(s, 'Test Bear', 'graveyard'))], [player('p2')]]));
    expect(onBf(s, 'Test Bear')).toBe(false);
    expect(inYard(s, 'Test Bear')).toBe(true);
    expect(pt(s, named(s, 'Test Elf')[0]!)).toBe('3/1');
  });
  it('{B}{R} both spent: it returns and the target player\'s creatures get +2/+0', () => {
    let s = setup(['Swamp', 'Mountain', 'Mountain']);
    s = resolveAll(castAt(s, 'Test Surge', [[obj(find(s, 'Test Bear', 'graveyard'))], [player('p2')]]));
    expect(onBf(s, 'Test Bear')).toBe(true);
    expect(pt(s, named(s, 'Test Elf')[0]!)).toBe('3/1');
  });
  it('{B} only: the target player\'s creatures are not pumped (negative)', () => {
    let s = setup(['Swamp', 'Swamp', 'Swamp']);
    s = resolveAll(castAt(s, 'Test Surge', [[obj(find(s, 'Test Bear', 'graveyard'))], [player('p2')]]));
    expect(pt(s, named(s, 'Test Elf')[0]!)).toBe('1/1');
  });
});

describe('CR 118.12, 305.6: "unless its controller pays {1} for each basic land type among lands you control"', () => {
  const setup = (spare: string[]): GameState => {
    let s = scenario(['Island', 'Mountain', 'Forest'], { p1: { hand: ['Test Dispel'], battlefield: ['Island', 'Mountain'] }, p2: { hand: ['Test Pebble'], battlefield: ['Forest', ...spare] }, defs: DEFS });
    s = settle(act(s, { type: 'pass', player: 'p1' }), {}); // p1 to p2's turn is long: instead p1 casts Pebble itself below
    return s;
  };
  void setup;
  it('the controller of the spell has too little mana for the two basic land types (Island, Mountain): it is countered', () => {
    let s = scenario(['Island', 'Mountain', 'Forest'], { p1: { hand: ['Test Pebble'], battlefield: ['Forest'] }, p2: { hand: ['Test Dispel'], battlefield: ['Island', 'Mountain'] }, defs: DEFS });
    s = cast(s, 'Test Pebble');
    s = settle(cast(pass(s), 'Test Dispel', { targets: [obj(s.zones.stack[0]!)] }, 'p2'));
    s = resolveAll(s);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(20); // no life gained: countered
  });
  it('the controller of the spell can pay {2}: it resolves (negative)', () => {
    let s = scenario(['Island', 'Mountain', 'Forest'], { p1: { hand: ['Test Pebble'], battlefield: ['Forest', 'Forest', 'Forest'] }, p2: { hand: ['Test Dispel'], battlefield: ['Island', 'Mountain'] }, defs: DEFS });
    s = cast(s, 'Test Pebble');
    s = settle(cast(pass(s), 'Test Dispel', { targets: [obj(s.zones.stack[0]!)] }, 'p2'));
    s = resolveAll(s, { yes: true });
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(21);
  });
});

describe('CR 109.4, 608.2c: "Counter target spell if you control more creatures than that spell\'s controller"', () => {
  const play = (mine: string[], theirs: string[]): GameState => {
    let s = scenario(['Island', 'Forest'], { p1: { hand: ['Test Pebble'], battlefield: ['Forest', ...theirs] }, p2: { hand: ['Test Will'], battlefield: ['Island', ...mine] }, defs: DEFS });
    s = cast(s, 'Test Pebble');
    s = settle(cast(pass(s), 'Test Will', { targets: [obj(s.zones.stack[0]!)] }, 'p2'));
    return resolveAll(s);
  };
  it('two creatures against one: the spell is countered', () => {
    expect(play(['Test Bear', 'Test Elf'], ['Test Moth']).players.find((p) => p.id === 'p1')!.life).toBe(20);
  });
  it('a tie (negative): the spell resolves', () => {
    expect(play(['Test Bear'], ['Test Moth']).players.find((p) => p.id === 'p1')!.life).toBe(21);
  });
  it('fewer creatures (negative): the spell resolves', () => {
    expect(play([], ['Test Moth']).players.find((p) => p.id === 'p1')!.life).toBe(21);
  });
});

describe('CR 506.2, 506.3, 608.2h: "Attacking creatures get +X/+0 until end of turn, where X is the number of players being attacked"', () => {
  const attack = (defenders: string[]): GameState => {
    let s = mpScenario({ cards: ['Mountain'], defs: DEFS, zones: { p1: { hand: ['Test Howl'], battlefield: ['Mountain', 'Test Bear', 'Test Bear'] } } });
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'the attack');
    const bears = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear' && s.objects[id]!.controller === 'p1');
    s = answer(s, { kind: 'declareAttackers', attacks: bears.map((b, i) => ({ attacker: b, defender: defenders[i % defenders.length]! })) });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Howl', 'hand', 'p1') }));
    for (let i = 0; i < 20 && s.zones.stack.length > 0; i++) s = drive(pass(s));
    return s;
  };
  const bearPower = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear').map((id) => pt(s, id));
  it('two creatures attacking one player: X is 1', () => {
    expect(bearPower(attack(['p2']))).toEqual(['3/2', '3/2']);
  });
  it('two creatures attacking two players: X is 2', () => {
    expect(bearPower(attack(['p2', 'p3']))).toEqual(['4/2', '4/2']);
  });
});

describe('CR 603.4, 208.1: "Whenever a creature you control enters, if that creature is 1/1, put two +1/+1 counters on it"', () => {
  it('a 1/1 enters: it gets two counters; a 2/2 (negative) does not', () => {
    let s = scenario(['Swamp'], { p1: { hand: ['Test Elf', 'Test Bear'], battlefield: ['Test Captain'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Elf'));
    expect(counters(s, named(s, 'Test Elf')[0]!, '+1/+1')).toBe(2);
    s = resolveAll(cast(s, 'Test Bear'));
    expect(counters(s, named(s, 'Test Bear')[0]!, '+1/+1')).toBe(0);
  });
});

describe('CR 603.4: two Captains (the ruling of 2009-05-01): the second ability finds the creature no longer 1/1 and does nothing', () => {
  it('a 1/1 entering with two Captains in play ends with two counters, not four', () => {
    let s = scenario(['Swamp'], { p1: { hand: ['Test Elf'], battlefield: ['Test Captain', 'Test Captain'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Elf'));
    expect(counters(s, named(s, 'Test Elf')[0]!, '+1/+1')).toBe(2);
  });
});

describe('CR 115.3, 122.1: "a +1/+1 counter on target creature, two on another target creature, and three on a third target creature"', () => {
  it('three different creatures get one, two and three counters', () => {
    let s = scenario(['Forest'], { p1: { hand: ['Test Growth'], battlefield: ['Forest', 'Forest', 'Forest', 'Forest', 'Test Bear', 'Test Elf', 'Test Moth'] }, defs: DEFS });
    const [a, b, c] = [named(s, 'Test Bear')[0]!, named(s, 'Test Elf')[0]!, named(s, 'Test Moth')[0]!];
    s = resolveAll(castAt(s, 'Test Growth', [[obj(a)], [obj(b)], [obj(c)]]));
    expect([counters(s, a, '+1/+1'), counters(s, b, '+1/+1'), counters(s, c, '+1/+1')]).toEqual([1, 2, 3]);
  });
  it('the same creature cannot be chosen twice (negative): the second and third targets must differ from the first', () => {
    const s = scenario(['Forest'], { p1: { hand: ['Test Growth'], battlefield: ['Forest', 'Forest', 'Forest', 'Forest', 'Test Bear', 'Test Elf', 'Test Moth'] }, defs: DEFS });
    const a = named(s, 'Test Bear')[0]!;
    expect(() => castAt(s, 'Test Growth', [[obj(a)], [obj(a)], [obj(a)]])).toThrow();
  });
});

describe('CR 401.4, 608.2d: "Target opponent puts a card from their hand on top of their library"', () => {
  it('the opponent chooses the card; it goes on top of their own library', () => {
    let s = scenario(['Swamp'], { p1: { hand: ['Test Rats'], battlefield: ['Swamp', 'Swamp'] }, p2: { hand: ['Test Bear', 'Test Elf'] }, defs: DEFS });
    const lib = s.zones.library['p2']!.length;
    s = resolveAll(cast(s, 'Test Rats'), { targets: [player('p2')], objects: [find(s, 'Test Elf', 'hand', 'p2')] });
    expect(s.zones.library['p2']!.length).toBe(lib + 1);
    expect(s.objects[s.zones.library['p2']![0]!]!.defId).toBe('Test Elf');
    expect((s.zones.hand['p2'] ?? []).length).toBe(1);
  });
  it('an empty hand (negative): nothing happens and the library does not grow', () => {
    let s = scenario(['Swamp'], { p1: { hand: ['Test Rats'], battlefield: ['Swamp', 'Swamp'] }, defs: DEFS });
    const lib = s.zones.library['p2']!.length;
    s = resolveAll(cast(s, 'Test Rats'), { targets: [player('p2')] });
    expect(s.zones.library['p2']!.length).toBe(lib);
  });
});

describe('"target creature without flying you don\'t control" (the second wording order)', () => {
  it('damages a non-flying creature of an opponent; a flying one is not a legal target (negative)', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Spasm'], battlefield: ['Mountain', 'Mountain'] }, p2: { battlefield: ['Test Bear', 'Test Moth'] }, defs: DEFS });
    expect(() => castAt(s, 'Test Spasm', [[obj(named(s, 'Test Moth')[0]!)]])).toThrow();
    s = resolveAll(castAt(s, 'Test Spasm', [[obj(named(s, 'Test Bear')[0]!)]]));
    expect(s.objects[named(s, 'Test Bear')[0]!]!.damage).toBe(1); // X is 1 with two Mountains
    expect(s.objects[named(s, 'Test Moth')[0]!]!.damage).toBe(0);
  });
});
