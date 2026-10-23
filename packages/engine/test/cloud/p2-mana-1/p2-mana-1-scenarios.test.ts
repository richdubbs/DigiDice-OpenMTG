/**
 * Phase 2 lane p2-mana, round p2-mana-1: the round's engine concepts played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 107.1c, 107.3a, 601.2b, 602.2b, 605.3b   "{T}, Remove any number of moss counters from ~: Add {G} for each moss counter removed this way.": a mana ability
 *                                              whose X is the number of counters its cost removes (rules/mana.ts#counterXPart): the player announces X (0 up to
 *                                              the counters on it) as it is activated, the cost removes that many, the mana is X; it never uses the stack
 *   (the same)                                 "Add {R}, then add an additional {R} for each fuel counter removed this way.": one more than X
 */
import { describe, expect, it } from 'vitest';
import { act, answer, find, scenario } from '../../m3/scenario';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** The card is parsed and automated without a manual unit (an experimental template's cap is not checked here). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const poolOf = (s: GameState): string => s.players[0]!.manaPool.map((u) => u.type).sort().join('');

/** Activate `source`'s (one) mana ability, announcing `x` when asked; returns the state and how many times a number was asked (and its max). */
function tapFor(s0: GameState, source: ObjectId, x: number): { s: GameState; asked: number[] } {
  const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.isMana === true && l.object === source);
  if (!a) throw new Error('no mana ability offered');
  const asked: number[] = [];
  let s = act(s0, a.action);
  for (let guard = 0; guard < 10 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const d = s.pending as unknown as { kind: string; max?: number };
    if (d.kind !== 'chooseNumber') throw new Error(`unexpected decision ${d.kind}`);
    asked.push(d.max ?? -1);
    s = answer(s, { kind: 'chooseNumber', n: x });
  }
  return { s, asked };
}

describe('CR 107.1c, 601.2b, 602.2b, 605.3b: "{T}, Remove any number of moss counters from ~: Add {G} for each moss counter removed this way" (counterXPart)', () => {
  const VAULT = card('Test Moss Cellar', 'Land', '{T}, Remove any number of moss counters from ~: Add {G} for each moss counter removed this way.');
  const setup = (n: number): { s: GameState; id: ObjectId } => {
    const s = scenario([], { p1: { battlefield: [{ name: 'Test Moss Cellar', counters: { moss: n } }] }, defs: [VAULT] });
    return { s, id: find(s, 'Test Moss Cellar', 'battlefield', 'p1') };
  };
  it('is parsed and automated: the cost removes X counters and the mana is X', () => {
    expect(automated(VAULT)).toBe(true);
    const json = JSON.stringify(VAULT.faces[0]!.abilities);
    expect(json).toContain('"kind":"removeCounters","counter":"moss","count":{"q":"X"},"self":true,"anyNumber":true');
    expect(json).toContain('"dynamic":{"kind":"ofType","type":"G","count":{"q":"X"}}');
  });
  it('three counters, X = 2: two counters are removed and {G}{G} is added at once (no stack)', () => {
    const { s: s0, id } = setup(3);
    const { s, asked } = tapFor(s0, id, 2);
    expect(asked).toEqual([3]);
    expect(poolOf(s)).toBe('GG');
    expect(s.objects[id]!.counters['moss']).toBe(1);
    expect(s.objects[id]!.tapped).toBe(true);
    expect(s.zones.stack.length).toBe(0);
  });
  it('X = 0: no counter removed, no mana; with no counters nothing is asked', () => {
    const a = setup(2);
    const r = tapFor(a.s, a.id, 0);
    expect(poolOf(r.s)).toBe('');
    expect(r.s.objects[a.id]!.counters['moss']).toBe(2);
    const b = setup(0);
    const r2 = tapFor(b.s, b.id, 0);
    expect(r2.asked).toEqual([]);
    expect(poolOf(r2.s)).toBe('');
  });
});

describe('CR 107.1c, 602.2b: "Add {R}, then add an additional {R} for each fuel counter removed this way"', () => {
  const CELL = card('Test Fuel Cell', 'Artifact', '{T}, Remove any number of fuel counters from ~: Add {R}, then add an additional {R} for each fuel counter removed this way.');
  it('two counters, X = 2: {R}{R}{R}', () => {
    expect(automated(CELL)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Fuel Cell', counters: { fuel: 2 } }] }, defs: [CELL] });
    const id = find(s0, 'Test Fuel Cell', 'battlefield', 'p1');
    const { s } = tapFor(s0, id, 2);
    expect(poolOf(s)).toBe('RRR');
    expect(s.objects[id]!.counters['fuel'] ?? 0).toBe(0);
  });
});

describe('CR 107.3a, 602.2b: "{T}, Remove X spark counters from ~: Add an amount of {C} equal to X plus one."', () => {
  const TOY = card('Test Spark Toy', 'Artifact', '{T}, Remove X spark counters from ~: Add an amount of {C} equal to X plus one.');
  it('X = 1 of 2: {C}{C}, one counter left', () => {
    expect(automated(TOY)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Spark Toy', counters: { spark: 2 } }] }, defs: [TOY] });
    const id = find(s0, 'Test Spark Toy', 'battlefield', 'p1');
    const { s } = tapFor(s0, id, 1);
    expect(poolOf(s)).toBe('CC');
    expect(s.objects[id]!.counters['spark']).toBe(1);
  });
});

describe('CR 106.7: "{T}: Add one mana of any color that a land an opponent controls could produce" (couldProduce)', () => {
  const SCOUT = card('Test Border Scout', 'Creature — Elf Scout', '{T}: Add one mana of any color that a land an opponent controls could produce.', ['1', '1']);
  const WOODS = card('Test Woods', 'Land — Forest', '');
  const ISLE = card('Test Isle', 'Land — Island', '');
  const WASTE = card('Test Grey Waste', 'Land', '{T}: Add {C}.');
  const DEFS = [SCOUT, WOODS, ISLE, WASTE];
  const offered = (s0: GameState, scout: ObjectId): string[] => {
    const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.isMana === true && l.object === scout)!;
    const s = act(s0, a.action);
    const d = s.pending as unknown as { kind: string; options?: string[] };
    return d?.kind === 'chooseColor' ? [...(d.options ?? [])].sort() : [];
  };
  it('is parsed and automated', () => {
    expect(automated(SCOUT)).toBe(true);
    expect(JSON.stringify(SCOUT.faces[0]!.abilities)).toContain('"dynamic":{"kind":"couldProduce","count":1,"among":{"ref":"each","filter":{"types":["Land"],"controller":"opponent"}},"colorsOnly":true}');
  });
  it('the colors the opponent\'s lands could produce are offered; the player\'s own lands do not count', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Border Scout', 'Test Isle'] }, p2: { battlefield: ['Test Woods', 'Test Grey Waste'] }, defs: DEFS });
    const scout = find(s0, 'Test Border Scout', 'battlefield', 'p1');
    expect(offered(s0, scout)).toEqual([]); // {C} is no color and the Island is p1's: only {G}, so nothing is asked
    const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.isMana === true && l.object === scout)!;
    expect(poolOf(act(s0, a.action))).toBe('G');
    const s1 = scenario([], { p1: { battlefield: ['Test Border Scout'] }, p2: { battlefield: ['Test Woods', 'Test Isle', 'Test Grey Waste'] }, defs: DEFS });
    expect(offered(s1, find(s1, 'Test Border Scout', 'battlefield', 'p1'))).toEqual(['G', 'U']);
  });
  it('one color only: no question, that mana is added; none: no mana (CR 106.7)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Border Scout'] }, p2: { battlefield: ['Test Isle'] }, defs: DEFS });
    const scout = find(s0, 'Test Border Scout', 'battlefield', 'p1');
    const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.isMana === true && l.object === scout)!;
    expect(poolOf(act(s0, a.action))).toBe('U');
    const s1 = scenario([], { p1: { battlefield: ['Test Border Scout'] }, p2: { battlefield: ['Test Grey Waste'] }, defs: DEFS });
    const b = legalActions(s1, 'p1').find((l) => l.kind === 'activate' && l.isMana === true && l.object === find(s1, 'Test Border Scout', 'battlefield', 'p1'))!;
    expect(poolOf(act(s1, b.action))).toBe('');
  });
  it('another "could produce" ability defines no type: two Scouts facing each other add nothing from each other (CR 106.7)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Border Scout'] }, p2: { battlefield: ['Test Border Scout'] }, defs: DEFS });
    const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.isMana === true && l.object === find(s0, 'Test Border Scout', 'battlefield', 'p1'))!;
    const s = act(s0, a.action);
    expect(s.pending?.kind).toBe('priority'); // nothing asked, nothing manual
    expect(poolOf(s)).toBe('');
  });
});
