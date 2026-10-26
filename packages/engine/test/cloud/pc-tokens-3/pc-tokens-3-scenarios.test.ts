/**
 * Lane pc-tokens, round pc-tokens-3 (Commander precon decks), the cards ported from the stopped round p2-typechange-4, played through the engine with synthetic cards
 * (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified.
 *
 *   CR 613.1d, 613.1f, 205.3   "Noncreature, non-Equipment artifacts you control are Equipment in addition to their other types and have ..." (Dan Lewis)
 *   CR 613.8                   "Creatures you control with +1/+1 counters on them are artifacts ... Nonartifact creatures get -1/-1." (The Flesh Is Weak)
 *   CR 205.3m, 611.2c          "Creatures you control get +2/+0 and gain all creature types until end of turn."; "... lose all creature types"
 *   CR 702.6, 613.1f           "Blood tokens you control are Equipment ... equip {2}" (Arterial Alchemy)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
function drive(s0: GameState, targets: ObjectId[][] = []): GameState {
  let s = s0;
  const tq = [...targets];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => ({ kind: 'player' as const, id } as never)) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s0: GameState, name: string, targets: ObjectId[][] = [], who: PlayerId = 'p1'): GameState => {
  let s = drive(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), targets);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, targets);
  return s;
};

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });

describe('CR 613.1d, 613.1f: "Noncreature, non-Equipment artifacts you control are Equipment in addition to their other types and have \'Equipped creature gets +1/+0\' and equip {1}."', () => {
  const LEWIS = card('Test Lewis', 'Enchantment', 'Noncreature, non-Equipment artifacts you control are Equipment in addition to their other types and have "Equipped creature gets +1/+0" and equip {1}.');
  const RELIC = card('Test Relic', 'Artifact', '');
  const AXE = card('Test Axe', 'Artifact — Equipment', 'Equipped creature gets +3/+0.\nEquip {3}');
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['1', '1'] });
  const defs = [LEWIS, RELIC, AXE, GOLEM, BEAR];
  it('is fully automated', () => expect(full(LEWIS)).toBe(true));
  it('a plain artifact becomes an Equipment (and stays one: the non-Equipment limit does not flicker), with equip {1}', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Lewis', 'Test Relic'] } });
    const c = chars(s, find(s, 'Test Relic', 'battlefield', 'p1'));
    expect(c.subtypes).toContain('Equipment');
    expect(c.types).toContain('Artifact');
    expect(JSON.stringify(c.abilities ?? c)).toContain('equip');
  });
  it('an artifact creature and an artifact that was already Equipment get nothing (no second equip), and the opponent\'s artifact is untouched', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Lewis', 'Test Golem', 'Test Axe'] }, p2: { battlefield: ['Test Relic'] } });
    expect(chars(s, find(s, 'Test Golem', 'battlefield', 'p1')).subtypes).not.toContain('Equipment');
    expect(JSON.stringify(chars(s, find(s, 'Test Axe', 'battlefield', 'p1')).abilities ?? '')).not.toContain('"cost":{"mana":[{"amount":1');
    expect(chars(s, find(s, 'Test Relic', 'battlefield', 'p2')).subtypes).not.toContain('Equipment');
  });
});

describe('CR 613.8, 613.1d: "Creatures you control with +1/+1 counters on them are artifacts in addition to their other types. Nonartifact creatures get -1/-1."', () => {
  const FLESH = card('Test Flesh', 'Enchantment', 'Creatures you control with +1/+1 counters on them are artifacts in addition to their other types.\nNonartifact creatures get -1/-1.');
  const defs = [FLESH, BEAR];
  it('is fully automated', () => expect(full(FLESH)).toBe(true));
  it('a creature of yours with a counter is an artifact and escapes the -1/-1; one without, and the opponent\'s, get -1/-1', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Flesh', { name: 'Test Bear', counters: { '+1/+1': 1 } }, 'Test Bear'] }, p2: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 1 } }] } });
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear' && s.objects[id]!.controller === 'p1');
    const withCounter = mine.find((id) => (s.objects[id]!.counters['+1/+1'] ?? 0) > 0)!;
    const without = mine.find((id) => id !== withCounter)!;
    expect(chars(s, withCounter).types).toContain('Artifact');
    expect(chars(s, withCounter).power).toBe('3'); // 2/2 + the counter, no -1/-1
    expect(chars(s, without).power).toBe('1');
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(chars(s, theirs).types).not.toContain('Artifact');
    expect(chars(s, theirs).power).toBe('2'); // 2/2 + counter - 1
  });
});

describe('CR 205.3m, 611.2c: creature types for a turn', () => {
  const CLAWS = card('Test Claws', 'Sorcery', 'Until end of turn, creatures you control get +2/+0 and gain all creature types.');
  const ERASE = card('Test Erase', 'Sorcery', 'Creatures target player controls get -2/-0 and lose all creature types until end of turn.');
  const defs = [CLAWS, ERASE, BEAR];
  it('are fully automated', () => { expect(full(CLAWS)).toBe(true); expect(full(ERASE)).toBe(true); });
  it('Claws: your creatures get +2/+0 and every creature type; the opponent\'s do not; a creature that arrives later is not affected (the group is fixed when it resolves)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Claws'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Claws');
    const mine = chars(s, find(s, 'Test Bear', 'battlefield', 'p1'));
    expect(mine.power).toBe('4');
    expect(mine.subtypes.length).toBeGreaterThan(20); // every creature type
    const theirs = chars(s, find(s, 'Test Bear', 'battlefield', 'p2'));
    expect(theirs.power).toBe('2');
    expect(theirs.subtypes).toEqual(['Bear']);
  });
  it('Erase: the targeted player\'s creatures get -2/-0 and lose every creature type; yours are untouched', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Erase'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Erase', [['p2']]);
    const theirs = chars(s, find(s, 'Test Bear', 'battlefield', 'p2'));
    expect(theirs.power).toBe('0');
    expect(theirs.subtypes).toEqual([]);
    expect(chars(s, find(s, 'Test Bear', 'battlefield', 'p1')).subtypes).toEqual(['Bear']);
  });
});

describe('CR 205.1b, 613.1d: "All permanents are enchantments in addition to their other types."', () => {
  const EVENING = card('Test Evening', 'Enchantment', 'All permanents are enchantments in addition to their other types.');
  it('every permanent, both players\', is an enchantment as well', () => {
    expect(full(EVENING)).toBe(true);
    const s = scenario([], { defs: [EVENING, BEAR], p1: { battlefield: ['Test Evening', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Plains'] } });
    for (const id of s.zones.battlefield) expect(chars(s, id).types, s.objects[id]!.defId).toContain('Enchantment');
    expect(chars(s, find(s, 'Test Bear', 'battlefield', 'p2')).types).toContain('Creature');
  });
});

describe('CR 700.4, 400.3, 603.10a: "Create a 3/3 green Beast creature token for each creature put into your graveyard from the battlefield this turn."', () => {
  const WRATH = card('Test Wrath', 'Sorcery', 'Destroy all creatures.');
  const MEAT = card('Test Meat', 'Sorcery', 'Create a 3/3 green Beast creature token for each creature put into your graveyard from the battlefield this turn.');
  const NONTOKEN = card('Test Callers', 'Sorcery', 'Create a 2/2 green Bear creature token for each nontoken creature put into your graveyard from the battlefield this turn.');
  const MAKER = card('Test Maker', 'Sorcery', 'Create a 1/1 white Soldier creature token.');
  const defs = [WRATH, MEAT, NONTOKEN, MAKER, BEAR];
  const tokensOf = (s: GameState, who: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === who);
  it('are fully automated', () => { expect(full(MEAT)).toBe(true); expect(full(NONTOKEN)).toBe(true); });
  it('counts your creatures that died this turn only (the opponent\'s do not count), and none before any died', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Wrath', 'Test Meat'], battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] } });
    s = cast(s, 'Test Wrath');
    s = cast(s, 'Test Meat');
    expect(tokensOf(s, 'p1').length).toBe(2);
    let z = scenario([], { defs, p1: { hand: ['Test Meat'], battlefield: ['Test Bear'] } });
    z = cast(z, 'Test Meat');
    expect(tokensOf(z, 'p1').length).toBe(0);
  });
  it('the nontoken form leaves out a token of yours that died', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Maker', 'Test Wrath', 'Test Callers'], battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Maker');
    s = cast(s, 'Test Wrath');
    s = cast(s, 'Test Callers');
    expect(tokensOf(s, 'p1').length).toBe(1); // the Bear died (nontoken): one Bear token; the Soldier token that died is not counted
    expect(chars(s, tokensOf(s, 'p1')[0]!).subtypes).toContain('Bear');
  });
});
