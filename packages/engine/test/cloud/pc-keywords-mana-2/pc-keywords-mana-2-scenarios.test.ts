/**
 * pc-keywords-mana-2 (precon lane keywords-mana): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites written
 * from memory in a cloud session (no rules/cr/): unverified.
 *
 *   CR 106.6, 603.2, 701.22a  "When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1": the trigger of the mana
 *   CR 903.3d, 205.3m         shares a creature type with your commander, wherever it is (the command zone, the battlefield): a spell of one of its types only
 *   CR 614.1c, 106.6          "If this mana is spent to cast a creature spell, that creature enters with an additional +1/+1 counter on it"
 *   CR 106.1, 122.1, 605.1a   "Add one mana of any color for each charge counter removed this way": one mana for every counter the trigger removed
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { act, commanderScenario, drive, find, legend } from '../../m11/rules/helpers';
import { castCard } from '../../m5/announce/support';
import { scenario } from '../../m3/scenario';
import { next } from '../../m6/dfc/support';
import { tweak } from '../../m4/helpers';
import { resolveAll } from '../../m5/cr-examples/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const pool = (s: GameState): string[] => s.players.find((x) => x.id === 'p1')!.manaPool.map((u) => u.type).sort();

describe('CR 106.6, 903.3d: Path-like land: scry when its mana pays for a creature spell that shares a creature type with your commander', () => {
  const PATH = card('Test Ancestral Trail', 'Land', "{T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1.");
  const CHIEF = legend('Test Elf Chief', '{G}', ['2', '2'], ['G']); // Legendary Creature — Elf Warrior
  const SCOUT = card('Test Elf Scout', 'Creature — Elf', '', { pt: ['1', '1'], cost: '{G}' });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{G}' });
  const board = (): GameState => commanderScenario({ p1Commanders: [CHIEF], p2Commanders: [legend('Test Foe', '{G}', ['1', '1'], ['G'])], defs: [PATH, SCOUT, BEAR],
    p1: { hand: ['Test Elf Scout', 'Test Plain Bear'], battlefield: ['Test Ancestral Trail'] } });
  const castWithTrail = (name: string): GameState => {
    const s = board();
    const trail = find(s, 'Test Ancestral Trail', 'battlefield', 'p1');
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === trail)!;
    let t = drive(act(s, la.action), [{ kind: 'chooseColor', color: 'G' } as DecisionAnswer]);
    expect(pool(t)).toEqual(['G']);
    t = castCard(t, name);
    return drive(t, []);
  };
  it('compiles full', () => expect(noManual(PATH)).toBe(true));
  it('a creature spell that shares a type with the commander in the command zone: the mana puts a scry trigger on the stack', () => {
    const t = castWithTrail('Test Elf Scout');
    const kinds = t.zones.stack.map((id) => t.objects[id]!.kind);
    expect(kinds).toContain('ability');
  });
  it('a creature spell that shares no type with the commander: no trigger', () => {
    const t = castWithTrail('Test Plain Bear');
    expect(t.zones.stack.map((id) => t.objects[id]!.kind)).not.toContain('ability');
  });
});

describe('CR 106.1, 122.1: "Add one mana of any color for each charge counter removed this way"', () => {
  const RELIC = card('Test Prism Hoard', 'Artifact', "{T}: Put a charge counter on this artifact.\nAt the beginning of your first main phase, remove all charge counters from this artifact. Add one mana of any color for each charge counter removed this way.");
  it('compiles full and, at the beginning of your first main phase, adds one mana for each counter removed', () => {
    expect(noManual(RELIC)).toBe(true);
    const s0 = scenario([], { defs: [RELIC], p1: { battlefield: [{ name: 'Test Prism Hoard', counters: { charge: 2 } }] } });
    let t = s0;
    const choose: DecisionAnswer[] = [{ kind: 'chooseColor', color: 'R' } as DecisionAnswer, { kind: 'chooseColor', color: 'U' } as DecisionAnswer];
    for (let i = 0; i < 800 && !(t.turn.step === 'main1' && pool(t).length === 2); i++) {
      if (t.pending?.kind === 'chooseColor') { t = drive(t, [choose.shift() ?? choose[0]!]); }
      else t = t.pending && t.pending.kind !== 'priority' && t.pending.kind !== 'declareAttackers' && t.pending.kind !== 'declareBlockers' ? drive(t) : next(t);
    }
    expect(t.turn.number).toBe(1); // the trigger of the first main phase of the game's first turn
    expect(pool(t)).toEqual(['R', 'U']);
    expect(t.objects[find(t, 'Test Prism Hoard', 'battlefield', 'p1')]!.counters['charge'] ?? 0).toBe(0);
    expect(t.turn.activePlayer).toBe('p1');
  });
});

describe('CR 614.1c, 106.6: "If this mana is spent to cast a creature spell, that creature enters with an additional +1/+1 counter on it"', () => {
  const STONE = card('Test Growth Stone', 'Artifact', '{T}: Add one mana of any color. If this mana is spent to cast a creature spell, that creature enters with an additional +1/+1 counter on it.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{G}' });
  const TRINKET = card('Test Idle Charm', 'Artifact', '', { cost: '{G}' });
  const play = (name: string): GameState => {
    const s = scenario([], { defs: [STONE, BEAR, TRINKET], p1: { hand: [name], battlefield: ['Test Growth Stone'] } });
    const stone = find(s, 'Test Growth Stone', 'battlefield', 'p1');
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === stone)!;
    let t = drive(act(s, la.action), [{ kind: 'chooseColor', color: 'G' } as DecisionAnswer]);
    t = drive(castCard(t, name), []);
    return resolveAll(t);
  };
  it('compiles full', () => expect(noManual(STONE)).toBe(true));
  it('a creature spell paid with that mana enters with +1/+1 counters on top of its own (a 2/2 with one counter)', () => {
    const t = play('Test Plain Bear');
    const bear = find(t, 'Test Plain Bear', 'battlefield', 'p1');
    expect(t.objects[bear]!.counters['+1/+1']).toBe(1);
  });
  it('two units of that mana from one source spent on one creature spell give two counters (each unit adds its counter)', () => {
    const TWIN = card('Test Twin Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{G}{G}' });
    const s0 = scenario([], { defs: [STONE, TWIN], p1: { hand: ['Test Twin Bear'], battlefield: ['Test Growth Stone'] } });
    const stone = find(s0, 'Test Growth Stone', 'battlefield', 'p1');
    const rider = { spells: { types: ['Creature'] }, entersWith: [{ kind: '+1/+1', count: 1 }] };
    const s1 = tweak(s0, (x) => { x.players[0]!.manaPool.push({ type: 'G', sourceId: stone, rider } as never, { type: 'G', sourceId: stone, rider } as never); });
    const t = resolveAll(drive(castCard(s1, 'Test Twin Bear'), []));
    expect(t.objects[find(t, 'Test Twin Bear', 'battlefield', 'p1')]!.counters['+1/+1']).toBe(2);
  });
  it('a spell that is not a creature spell gets nothing', () => {
    const t = play('Test Idle Charm');
    const charm = find(t, 'Test Idle Charm', 'battlefield', 'p1');
    expect(t.objects[charm]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 614.15, 605.1a: "Add one mana of any color. If you control a creature with power 4 or greater, add two mana of any one color instead"', () => {
  const MANA = card('Test Vine Sprite', 'Creature — Plant', '{T}: Add one mana of any color. If you control a creature with power 4 or greater, add two mana of any one color instead.', { pt: ['1', '2'] });
  const BIG = card('Test Big Ox', 'Creature — Ox', '', { pt: ['4', '4'] });
  const SMALL = card('Test Small Ox', 'Creature — Ox', '', { pt: ['3', '3'] });
  const tap = (others: string[]): string[] => {
    const s = scenario([], { defs: [MANA, BIG, SMALL], p1: { battlefield: ['Test Vine Sprite', ...others] } });
    const id = find(s, 'Test Vine Sprite', 'battlefield', 'p1');
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === id)!;
    return pool(drive(act(s, la.action), [{ kind: 'chooseColor', color: 'U' } as DecisionAnswer, { kind: 'chooseColor', color: 'U' } as DecisionAnswer]));
  };
  it('compiles full', () => expect(noManual(MANA)).toBe(true));
  it('with a creature of power 4 or more it adds two mana of one color, otherwise one (a power 3 creature is not enough)', () => {
    expect(tap(['Test Big Ox'])).toEqual(['U', 'U']);
    expect(tap([])).toEqual(['U']);
    expect(tap(['Test Small Ox'])).toEqual(['U']);
  });
});

describe('CR 107.3, 605.1a: "Remove X storage counters from this land: Add X mana in any combination of colors"', () => {
  const CAVE = card('Test Storage Cave', 'Land', '{T}, Remove X storage counters from this land: Add X mana in any combination of colors. Spend this mana only to cast Dragon spells or activate abilities of Dragons.');
  const DRAKE = card('Test Ember Drake', 'Creature — Dragon', '', { pt: ['2', '2'], cost: '{R}{G}' });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{R}{G}' });
  const open = (counters: number): GameState => scenario([], { defs: [CAVE, DRAKE, BEAR], p1: { hand: ['Test Ember Drake', 'Test Plain Bear'], battlefield: [{ name: 'Test Storage Cave', counters: { storage: counters } }] } });
  it('compiles full', () => expect(noManual(CAVE)).toBe(true));
  it('removes the X counters it announces and adds X mana, spendable on Dragon spells only', () => {
    const s = open(3);
    const cave = find(s, 'Test Storage Cave', 'battlefield', 'p1');
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === cave);
    expect(la, 'activation offered').toBeDefined();
    let t = act(s, la!.action);
    for (let i = 0; i < 12 && t.pending && t.pending.kind !== 'priority'; i++) {
      const k = t.pending.kind;
      t = drive(t, [k === 'chooseNumber' ? ({ kind: 'chooseNumber', n: 2 } as DecisionAnswer) : k === 'chooseColor' ? ({ kind: 'chooseColor', color: i % 2 ? 'R' : 'G' } as DecisionAnswer) : ({ kind: 'payCost', auto: true } as DecisionAnswer)]);
    }
    expect(t.objects[cave]!.counters['storage']).toBe(1);
    expect(pool(t).length).toBe(2);
    const names = legalActions(t, 'p1').filter((a) => a.kind === 'cast').map((a) => a.label);
    expect(names.some((n) => n.includes('Ember Drake'))).toBe(true);
    expect(names.some((n) => n.includes('Plain Bear'))).toBe(false);
  });
});
