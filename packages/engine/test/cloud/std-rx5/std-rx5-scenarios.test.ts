/**
 * std-rx5 (wave-2 slice s22): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 607.2a, 614.1a  "If a nontoken creature an opponent controls would die, instead exile it ..." and "Put target creature card exiled with ~ onto the
 *                      battlefield tapped under your control with two additional +1/+1 counters on it." (the replacement's exile is the linked instruction;
 *                      a card exiled by anything else is not a legal target)
 *   CR 110.2, 122.6    the card enters under your control, tapped, with two +1/+1 counters
 *   CR 107.1c, 602.2b  "Remove any number of +1/+1 counters from ~: Create that many 1/1 ... tokens" (the number chosen as the cost is paid, at most the counters
 *                      ~ has; "that many" is that number) and "... : It deals that much damage to any target"
 *   CR 614.12a, 607.2d "As ~ enters, choose a number between 1 and 10." and "Whenever an opponent casts a spell with mana value, power, or toughness equal to the
 *                      chosen number, that player loses 2 life and you draw a card." (only 1-10 offered; a spell whose statistics all differ does nothing)
 *   CR 611.2a, 613.1d  "If it's not a creature, it becomes a 0/0 Robot artifact creature." (no duration: it stays one; an artifact creature is not changed)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => d.automation.level === 'full';

/** The largest number each number choice offered (CR 107.1c: at most the counters the cost can remove). */
const offeredMax: number[] = [];
/** Answer the decisions that come up until priority (payments automatic; targets in order). */
function drive(s0: GameState, targets: ObjectId[][] = [], n?: number): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (q.shift() ?? []).map((id) => (id === 'p1' || id === 'p2' ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else if (p.kind === 'chooseNumber') { offeredMax.push(p.max); s = answer(s, { kind: 'chooseNumber', n: n ?? p.max }); }
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, n?: number): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), [], n);
  return s;
}
const cast = (s: GameState, name: string, targets: ObjectId[][]): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets));

describe('CR 607.2a, 614.1a: "Put target creature card exiled with ~ onto the battlefield tapped under your control with two additional +1/+1 counters on it"', () => {
  const PRISM = card('Test Gloom Prism', 'Artifact',
    'If a nontoken creature an opponent controls would die, instead exile it and you gain 1 life.\n{0}, {T}: Put target creature card exiled with ~ onto the battlefield tapped under your control with two additional +1/+1 counters on it.');
  const SLAY = card('Test Slay', 'Sorcery', 'Destroy target creature.');
  const BANISH = card('Test Banish', 'Sorcery', 'Exile target creature.');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'] });
  const DEFS = [PRISM, SLAY, BANISH, OGRE];
  const start = (spell: string): { s: GameState; exiled: ObjectId } => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Gloom Prism'], hand: [spell] }, p2: { battlefield: ['Test Ogre'] } });
    const s = cast(s0, spell, [[find(s0, 'Test Ogre', 'battlefield', 'p2')]]);
    return { s, exiled: s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Ogre')! };
  };
  const activate = (s: GameState, target: ObjectId): GameState =>
    resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Gloom Prism', 'battlefield', 'p1'), ability: 'p:0:1' }), [[target]]));

  it('is understood', () => expect(noManual(PRISM), JSON.stringify(PRISM.automation)).toBe(true));
  it('the card its replacement effect exiled enters under your control, tapped, with two +1/+1 counters', () => {
    const { s: s1, exiled } = start('Test Slay');
    expect(exiled).toBeDefined();
    expect(life(s1, 'p1')).toBe(21);
    const s = activate(s1, exiled);
    const ogre = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Ogre')!;
    expect(ogre).toBeDefined();
    const o = s.objects[ogre]!;
    expect(o.controller).toBe('p1');
    expect(o.tapped).toBe(true);
    expect(o.counters?.['+1/+1']).toBe(2);
  });
  it('a creature card exiled by another effect is not exiled with ~: not a legal target', () => {
    const { s, exiled } = start('Test Banish');
    expect(exiled).toBeDefined();
    expect(life(s, 'p1')).toBe(20);
    expect(() => activate(s, exiled)).toThrow(/target/i);
    expect(s.zones.exile).toContain(exiled);
  });
});

describe('CR 107.1c, 602.2b: "Remove any number of +1/+1 counters from ~: Create that many 1/1 green Insect creature tokens."', () => {
  const BREEDER = card('Test Hive Keeper', 'Creature — Human Scientist', 'Remove any number of +1/+1 counters from this creature: Create that many 1/1 green Insect creature tokens.', { pt: ['1', '1'] });
  const SPARKER = card('Test Spark Jar', 'Artifact', '{0}: Put a charge counter on this artifact.\n{1}, Remove any number of charge counters from this artifact: It deals that much damage to any target.');
  const DEFS = [BREEDER, SPARKER];
  const insects = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length;
  const withCounters = (n: number): { s: GameState; keeper: ObjectId } => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Hive Keeper'] } });
    const keeper = find(s0, 'Test Hive Keeper', 'battlefield', 'p1');
    const s = structuredClone(s0);
    s.objects[keeper]!.counters = { '+1/+1': n };
    return { s, keeper };
  };
  const remove = (s: GameState, keeper: ObjectId, n: number): GameState =>
    resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: keeper, ability: 'p:0:0' }), [], n));

  it('is understood', () => {
    expect(noManual(BREEDER), JSON.stringify(BREEDER.automation)).toBe(true);
    expect(noManual(SPARKER), JSON.stringify(SPARKER.automation)).toBe(true);
  });
  it('removing two of three counters creates two tokens and leaves one counter; at most three were offered', () => {
    offeredMax.length = 0;
    const { s: s0, keeper } = withCounters(3);
    const s = remove(s0, keeper, 2);
    expect(offeredMax).toEqual([3]);
    expect(insects(s)).toBe(2);
    expect(s.objects[keeper]!.counters?.['+1/+1'] ?? 0).toBe(1);
  });
  it('removing zero counters creates no token (any number includes zero)', () => {
    const { s: s0, keeper } = withCounters(2);
    const s = remove(s0, keeper, 0);
    expect(insects(s)).toBe(0);
    expect(s.objects[keeper]!.counters?.['+1/+1']).toBe(2);
  });
  it('"that much damage": the counters removed, dealt to the target', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Spark Jar', 'Plains'] } });
    const jar = find(s0, 'Test Spark Jar', 'battlefield', 'p1');
    const s1 = structuredClone(s0);
    s1.objects[jar]!.counters = { charge: 4 };
    const s = resolveAll(drive(act(s1, { type: 'activate', player: 'p1', source: jar, ability: 'p:0:1' }), [['p2' as ObjectId]], 3));
    expect(life(s, 'p2')).toBe(17);
    expect(s.objects[jar]!.counters?.charge).toBe(1);
  });
});

describe('CR 611.2a, 613.1d: "If it\'s not a creature, it becomes a 0/0 Robot artifact creature." (eff.stdrx5.becomes.pt.subtype.artifactcreature.noDuration)', () => {
  const FORGE = card('Test Robot Forge', 'Sorcery', "Put three +1/+1 counters on target artifact you control. If it's not a creature, it becomes a 0/0 Robot artifact creature.");
  const BOX = card('Test Box', 'Artifact', '');
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['1', '1'] });
  const DEFS = [FORGE, BOX, GOLEM];
  const run = (artifact: string): { s: GameState; id: ObjectId } => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: [artifact], hand: ['Test Robot Forge'] } });
    const id = find(s0, artifact, 'battlefield', 'p1');
    let s = cast(s0, 'Test Robot Forge', [[id]]);
    s = pass(pass(s)); // the effect has no duration: it still applies in the next turn (CR 611.2a)
    return { s, id };
  };
  it('is understood', () => expect(noManual(FORGE), JSON.stringify(FORGE.automation)).toBe(true));
  it('a noncreature artifact becomes a 3/3 Robot artifact creature, and stays one', () => {
    const { s, id } = run('Test Box');
    const c = getChars(s, id);
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(c.subtypes).toContain('Robot');
    expect([c.power, c.toughness]).toEqual(['3', '3']);
  });
  it('an artifact creature only gets the counters (it keeps its own type and base 1/1)', () => {
    const { s, id } = run('Test Golem');
    const c = getChars(s, id);
    expect(c.subtypes).toEqual(['Golem']);
    expect([c.power, c.toughness]).toEqual(['4', '4']);
  });
});

describe('CR 614.12a, 607.2d: "As ~ enters, choose a number between 1 and 10." and "... a spell with mana value, power, or toughness equal to the chosen number"', () => {
  const LORD = card('Test Kindly Warden', 'Creature — Faerie', 'Flying\nAs this creature enters, choose a number between 1 and 10.\nWhenever an opponent casts a spell with mana value, power, or toughness equal to the chosen number, that player loses 2 life and you draw a card.', { pt: ['2', '2'] });
  const THREE = card('Test Quick Ogre', 'Creature — Ogre', 'Flash', { pt: ['3', '1'] });
  const TWO = card('Test Quick Bear', 'Creature — Bear', 'Flash', { pt: ['2', '2'] });
  const DEFS = [LORD, THREE, TWO];
  const run = (spell: string): { s: GameState; hand0: number } => {
    offeredMax.length = 0;
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Kindly Warden'], library: ['Plains', 'Plains'] }, p2: { hand: [spell] } });
    let s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kindly Warden', 'hand', 'p1') })), 3);
    const hand0 = zoneNames(s, 'hand', 'p1').length;
    s = pass(s); // p2 gets priority
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p2', card: find(s, spell, 'hand', 'p2') })));
    return { s, hand0 };
  };
  it('is understood', () => expect(noManual(LORD), JSON.stringify(LORD.automation)).toBe(true));
  it('chosen 3 (at most 10 offered): a spell with power 3 makes its caster lose 2 life and you draw a card', () => {
    const { s, hand0 } = run('Test Quick Ogre');
    expect(offeredMax).toEqual([10]);
    expect(life(s, 'p2')).toBe(18);
    expect(zoneNames(s, 'hand', 'p1').length).toBe(hand0 + 1);
  });
  it('a spell with mana value 0, power 2 and toughness 2 does nothing', () => {
    const { s, hand0 } = run('Test Quick Bear');
    expect(life(s, 'p2')).toBe(20);
    expect(zoneNames(s, 'hand', 'p1').length).toBe(hand0);
  });
});
