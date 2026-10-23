/**
 * p2-c-dieroll-1 (Phase 2 lane p2-c-dieroll): die rolls and result tables played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names, design 6.10). Every roll comes from the game's seeded generator (design 8.8 rule 2), so each test reads the result it got from the
 * log and checks the outcome against it, over several seeds. CR cites are written from memory (rules/cr/ is not in cloud checkouts): unverified.
 *
 *   CR 706.1-706.3a     "Roll a d20." over result rows: exactly the row the result falls in happens; a row reads the target of the instruction before the table
 *   CR 706.6, 614.1a    "If you would roll one or more dice, instead roll that many dice plus one and ignore the lowest roll": one more die, the lowest ignored
 *                       (not rolled: no trigger); only for its controller's rolls; two such effects add two dice
 *   CR 603.2c           "Whenever you roll one or more dice": once per instruction, however many dice it rolls; "whenever you roll a die": once per kept die
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { answer, find, life, pass, scenario } from '../../m3/scenario';
import { castCard } from '../../m5/announce/support';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);
}
const automated = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');

/** Answer the decisions of what is being done (payment automatic, the given targets, yes/no: no); stop at the next priority. */
function settle(s0: GameState, targets: { kind: 'object' | 'player'; id: string }[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    const p = s.pending as unknown as { kind: string; options: string[]; min: number };
    if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, Math.max(p.min, 0)) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets } as never);
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else break;
  }
  return s;
}
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s);
  return s;
}
const cast = (s: GameState, name: string, targets: { kind: 'object' | 'player'; id: string }[] = []): GameState => resolveAll(settle(castCard(s, name), targets));
/** The rolls of the game's log, in order: every die rolled and the results kept. */
function rolls(s: GameState): { rolled: number[]; kept: number[] }[] {
  const out: { rolled: number[]; kept: number[] }[] = [];
  for (const l of s.log) {
    const one = /rolls a d\d+: (\d+)\./.exec(l.text);
    if (one) { out.push({ rolled: [Number(one[1])], kept: [Number(one[1])] }); continue; }
    const many = /rolls \d+ d\d+ \(([\d, ]+)\) and ignores the lowest (?:roll|\d+ rolls): ([\d, ]+)\./.exec(l.text);
    if (many) out.push({ rolled: many[1]!.split(', ').map(Number), kept: many[2]!.split(', ').map(Number) });
  }
  return out;
}
const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't'];

const OMEN = card('Test Omen', 'Instant', 'Roll a d20.\n1—9 | You gain 1 life.\n10—19 | You gain 3 life.\n20 | You gain 7 life.');
const gainFor = (r: number): number => (r <= 9 ? 1 : r <= 19 ? 3 : 7);

describe('CR 706.1-706.3a: a die-roll result table', () => {
  it('is automated: one roll of a d20 by you with its three rows', () => {
    expect(automated(OMEN)).toBe(true);
    const roll = JSON.stringify(OMEN.faces[0]!.abilities[0]);
    expect(roll).toContain('"op":"rollDie","who":{"ref":"you"},"sides":20,"table":[{"min":1,"max":9,');
    expect(roll).toContain('{"min":20,"max":20,');
  });
  it('exactly the row the result falls in happens, from the seeded generator (the same seed rolls the same)', () => {
    const rows = new Set<number>();
    for (const seed of SEEDS) {
      const s0 = scenario([], { defs: [OMEN], p1: { hand: ['Test Omen'] }, seed });
      const s = cast(s0, 'Test Omen');
      const r = rolls(s);
      expect(r, seed).toHaveLength(1);
      const result = r[0]!.kept[0]!;
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(20);
      expect(life(s, 'p1') - life(s0, 'p1'), `${seed}: rolled ${result}`).toBe(gainFor(result));
      rows.add(gainFor(result));
      expect(cast(s0, 'Test Omen').log.map((l) => l.text)).toEqual(s.log.map((l) => l.text)); // deterministic replay
    }
    expect(rows.size).toBeGreaterThan(1); // the seeds reach more than one row
  });
  it('CR 608.2h: a row reads the target of the instruction before the table ("its controller" of the exiled creature): an opponent\'s creature gives the token to the opponent', () => {
    const SMUGGLE = card('Test Smuggling', 'Instant', 'Exile target creature, then roll a d20.\n1—10 | Its controller creates a 3/3 green Elk creature token.\n11—20 | Its controller creates a 1/1 white Bird creature token with flying.');
    const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
    expect(automated(SMUGGLE)).toBe(true);
    for (const [seed, owner] of [['a', 'p2'], ['b', 'p1'], ['c', 'p2'], ['d', 'p1']] as const) {
      const s0 = scenario([], { defs: [SMUGGLE, BEAR], p1: { hand: ['Test Smuggling'], battlefield: owner === 'p1' ? ['Test Bear'] : [] }, p2: { battlefield: owner === 'p2' ? ['Test Bear'] : [] }, seed });
      const bear = find(s0, 'Test Bear', 'battlefield');
      const s = cast(s0, 'Test Smuggling', [{ kind: 'object', id: bear }]);
      const result = rolls(s)[0]!.kept[0]!;
      const tokens = s.zones.battlefield.map((id) => s.objects[id]!).filter((o) => o.kind === 'token');
      expect(tokens, seed).toHaveLength(1);
      expect(tokens[0]!.controller, seed).toBe(owner);
      expect(JSON.stringify(tokens[0]), `${seed}: rolled ${result}`).toContain(result <= 10 ? 'Elk' : 'Bird');
      expect(() => find(s, 'Test Bear', 'exile'), seed).not.toThrow();
    }
  });
  it('fail closed: rows that leave a result uncovered, or a row that is not understood, keep the whole ability manual', () => {
    expect(card('Test Gap', 'Instant', 'Roll a d20.\n1—9 | You gain 1 life.\n11—20 | You gain 3 life.').automation.level).toBe('manual');
    expect(card('Test Short', 'Instant', 'Roll a d20.\n1—9 | You gain 1 life.\n10—19 | You gain 3 life.').automation.level).toBe('manual');
    expect(card('Test Murk', 'Instant', 'Roll a d20.\n1—9 | You gain 1 life.\n10—20 | Blorfty the gleeb.').automation.level).toBe('manual');
    expect(card('Test Plus', 'Instant', 'Roll a d20.\n1—14 | You gain 1 life.\n15+ | You gain 3 life.').automation.level).toBe('manual');
  });
});

describe('CR 706.6, 614.1a: "If you would roll one or more dice, instead roll that many dice plus one and ignore the lowest roll."', () => {
  const CHARM = card('Test Charm', 'Enchantment', 'If you would roll one or more dice, instead roll that many dice plus one and ignore the lowest roll.');
  it('is automated as the rule diceAdvantage', () => {
    expect(automated(CHARM)).toBe(true);
    expect(JSON.stringify(CHARM.faces[0]!.abilities[0])).toContain('"rule":"diceAdvantage"');
  });
  it('its controller rolls one more die and the lowest roll is ignored: the table reads the highest', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const s0 = scenario([], { defs: [OMEN, CHARM], p1: { hand: ['Test Omen'], battlefield: ['Test Charm'] }, seed });
      const s = cast(s0, 'Test Omen');
      const r = rolls(s);
      expect(r, seed).toHaveLength(1);
      expect(r[0]!.rolled, seed).toHaveLength(2);
      expect(r[0]!.kept, seed).toEqual([Math.max(...r[0]!.rolled)]);
      expect(life(s, 'p1') - life(s0, 'p1'), seed).toBe(gainFor(r[0]!.kept[0]!));
    }
  });
  it('an opponent\'s effect does not change your rolls; two of yours add two dice and ignore the two lowest', () => {
    const theirs = cast(scenario([], { defs: [OMEN, CHARM], p1: { hand: ['Test Omen'] }, p2: { battlefield: ['Test Charm'] } }), 'Test Omen');
    expect(rolls(theirs)[0]!.rolled).toHaveLength(1);
    const two = cast(scenario([], { defs: [OMEN, CHARM], p1: { hand: ['Test Omen'], battlefield: ['Test Charm', 'Test Charm'] } }), 'Test Omen');
    const r = rolls(two)[0]!;
    expect(r.rolled).toHaveLength(3);
    expect(r.kept).toEqual([Math.max(...r.rolled)]);
  });
  it('the ignored roll is not rolled: "whenever you roll a die" triggers once, for the kept die', () => {
    const FAN = card('Test Fan', 'Creature — Elf', 'Whenever you roll a die, you gain 100 life.', ['1', '1']);
    const s0 = scenario([], { defs: [OMEN, CHARM, FAN], p1: { hand: ['Test Omen'], battlefield: ['Test Charm', 'Test Fan'] } });
    const s = cast(s0, 'Test Omen');
    expect(life(s, 'p1') - life(s0, 'p1')).toBe(100 + gainFor(rolls(s)[0]!.kept[0]!));
  });
});

describe('CR 603.2c: "Whenever you roll one or more dice"', () => {
  const DRUMMER = card('Test Drummer', 'Creature — Dwarf', 'Whenever you roll one or more dice, you gain 100 life.', ['1', '1']);
  const PAIR = card('Test Pair', 'Instant', 'Roll a d6. Roll a d6.');
  it('is automated as a batch of dieRoll events', () => {
    expect(automated(DRUMMER)).toBe(true);
    expect(JSON.stringify(DRUMMER.faces[0]!.abilities[0])).toContain('"trigger":{"on":[{"ev":"dieRoll","player":"you"}],"batch":true}');
  });
  it('triggers once for one instruction that rolls two dice, and once for each of two instructions', () => {
    const one = JSON.parse(JSON.stringify(PAIR)) as CardDef;
    const steps = (one.faces[0]!.abilities[0] as unknown as { effect: { steps: { count?: number }[] } }).effect.steps;
    expect(steps).toHaveLength(2);
    steps.splice(1, 1);
    steps[0]!.count = 2; // "roll two d6" as one instruction
    const both = { ...one, id: 'Test Twins', name: 'Test Twins', faces: [{ ...one.faces[0]!, name: 'Test Twins' }] } as CardDef;
    const s0 = scenario([], { defs: [both, PAIR, DRUMMER], p1: { hand: ['Test Twins', 'Test Pair'], battlefield: ['Test Drummer'] } });
    const s1 = cast(s0, 'Test Twins');
    expect(rolls(s1)).toHaveLength(2);
    expect(life(s1, 'p1') - life(s0, 'p1')).toBe(100);
    const s2 = cast(s1, 'Test Pair');
    expect(rolls(s2)).toHaveLength(4);
    expect(life(s2, 'p1') - life(s1, 'p1')).toBe(200);
  });
  it('another player\'s roll does not trigger "you roll" (the drummer\'s controller is the opponent of the player who rolls)', () => {
    const s0 = scenario([], { defs: [OMEN, DRUMMER], p1: { hand: ['Test Omen'] }, p2: { battlefield: ['Test Drummer'] } });
    const s = cast(s0, 'Test Omen');
    expect(rolls(s)).toHaveLength(1);
    expect(life(s, 'p2')).toBe(life(s0, 'p2'));
  });
});
