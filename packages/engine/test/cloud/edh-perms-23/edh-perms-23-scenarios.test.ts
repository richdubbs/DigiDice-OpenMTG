/**
 * Commander lane edh-perms, round edh-perms-23: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler. Alice (p1) is the active player. CR cites checked against the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 707.2, 611.2a, 611.2c      "... Then you may choose a token you control. If you do, each other token you control becomes a copy of that token."
 *   CR 107.3a, 605.3b             "{T}, Pay 2 life, Tap X untapped tokens you control: Add X mana in any combination of colors." (X announced as the mana ability is activated)
 *   CR 707.2, 111.2               "... create a token that's a copy of target token you control. If that token is a Squirrel, instead create two tokens that are copies of it."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; colors?: string[]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const obj = (id: string): TargetChoice => ({ kind: 'object', id });

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const ENGINEER = card('Test Token Smith', 'Creature — Construct', 'Creature tokens you control have haste.\nAt the beginning of combat on your turn, create a 2/1 blue Phyrexian Myr artifact creature token. Then you may choose a token you control. If you do, each other token you control becomes a copy of that token.', { pt: ['2', '2'], colors: ['U'] });
const SOLDIER_MAKER = card('Test Soldier Maker', 'Artifact', '{0}: Create a 1/1 white Soldier creature token.');
const TREASURE_MAKER = card('Test Gold Maker', 'Artifact', '{0}: Create a Treasure token.');
const SQUIRREL_MAKER = card('Test Squirrel Maker', 'Artifact', '{0}: Create a 1/1 green Squirrel creature token.');
const HAZEL = card('Test Nut Queen', 'Legendary Creature — Squirrel Noble', '{T}, Pay 2 life, Tap X untapped tokens you control: Add X mana in any combination of colors.\nAt the beginning of your end step, create a token that\'s a copy of target token you control. If that token is a Squirrel, instead create two tokens that are copies of it.', { pt: ['2', '2'], colors: ['G'] });
const DEFS = [BEAR, ENGINEER, SOLDIER_MAKER, TREASURE_MAKER, SQUIRREL_MAKER, HAZEL];

/** Answer every decision until the stack is empty; passes priority only while something is on the stack. */
function settle(s0: GameState, targets: TargetChoice[] = [], pick: (options: ObjectId[], min: number) => ObjectId[] = (o, min) => o.slice(0, min), color = 'G'): GameState {
  let s = s0;
  for (let g = 0; g < 80; g++) {
    const p = s.pending;
    if (p === undefined || p === null) break;
    if (p.kind === 'priority') {
      if (s.zones.stack.length === 0) break;
      s = pass(s);
    } else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (p.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color } as never);
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick(p.options, p.min) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else throw new Error(`unexpected decision ${p.kind}: ${p.prompt}`);
  }
  return s;
}
const onField = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]?.name === name);
const inYard = (s: GameState, name: string, owner = 'p1'): boolean => s.zones.graveyard[owner]!.some((id) => s.defs[s.objects[id]!.defId]?.name === name);
const controllerOf = (s: GameState, id: ObjectId): string => getChars(s, id) && s.objects[id]!.controller;
const tokensOf = (s: GameState, player: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === player);
const makeToken = (s0: GameState, maker: string): GameState => {
  const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, maker, 'battlefield') && !x.isMana);
  if (!a) throw new Error(`${maker} is not activatable`);
  return settle(act(s0, a.action));
};

describe('design 6.9: the round\'s test cards compile fully', () => {
  it('the smith and the queen are fully automated', () => {
    for (const d of [ENGINEER, HAZEL]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 707.2, 611.2a, 611.2c: "Then you may choose a token you control. If you do, each other token you control becomes a copy of that token."', () => {
  const setup = (): GameState => {
    const s0 = scenario([], { p1: { battlefield: ['Test Token Smith', 'Test Soldier Maker', 'Test Gold Maker'] }, p2: { battlefield: ['Test Soldier Maker'] }, defs: DEFS });
    return makeToken(makeToken(s0, 'Test Soldier Maker'), 'Test Gold Maker');
  };
  const run = (s0: GameState, pickName: string | null): GameState => {
    let s = advanceTo(s0, 1, 'beginCombat');
    for (let g = 0; g < 40 && s.pending; g++) {
      const p = s.pending;
      if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: pickName !== null });
      else if (p.kind === 'chooseObjects') {
        const want = tokensOf(s, 'p1').find((id) => getChars(s, id)!.name.startsWith(pickName ?? ''));
        s = answer(s, { kind: 'chooseObjects', ids: [want ?? p.options[0]!] });
      } else if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${p.kind}: ${p.prompt}`);
    }
    return s;
  };
  it('the chosen Soldier token stays, the Treasure and the new Myr token become copies of it', () => {
    const s = run(setup(), 'Soldier');
    const mine = tokensOf(s, 'p1');
    expect(mine).toHaveLength(3);
    for (const id of mine) {
      const c = getChars(s, id)!;
      expect(c.name, `${id}`).toBe('Soldier Token');
      expect(c.types).toContain('Creature');
    }
  });
  it('the effect has no duration: it is still in force at the next turn', () => {
    const s = advanceTo(run(setup(), 'Soldier'), 2, 'upkeep');
    for (const id of tokensOf(s, 'p1')) expect(getChars(s, id)!.name).toBe('Soldier Token');
  });
  it('negative: the choice is declined, so no token becomes a copy of another', () => {
    const s = run(setup(), null);
    const names = tokensOf(s, 'p1').map((id) => getChars(s, id)!.name);
    expect(new Set(names).size).toBe(3);
    expect(names.filter((n) => n.startsWith('Soldier'))).toHaveLength(1);
  });
  it('negative: an opponent\'s token is not a token you control: it is neither offered nor changed', () => {
    const s0 = setup();
    const theirs = s0.zones.battlefield.find((id) => s0.objects[id]!.controller === 'p2' && s0.defs[s0.objects[id]!.defId]?.name === 'Test Soldier Maker')!;
    // a token of Bob's, made by hand for the setup (the state is a plain object)
    const tokId = `o${s0.counters.object++}`;
    s0.objects[tokId] = { ...s0.objects[theirs]!, id: tokId, kind: 'token', owner: 'p2', controller: 'p2', defId: 'Test Gold Maker' } as never;
    s0.zones.battlefield.push(tokId);
    let offered: string[] = [];
    let s = advanceTo(s0, 1, 'beginCombat');
    for (let g = 0; g < 40 && s.pending; g++) {
      const p = s.pending;
      if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (p.kind === 'chooseObjects') { offered = [...p.options]; s = answer(s, { kind: 'chooseObjects', ids: [p.options[0]!] }); }
      else if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${p.kind}: ${p.prompt}`);
    }
    expect(offered).not.toContain(tokId);
    expect(s.objects[tokId]!.defId).toBe('Test Gold Maker');
  });
});

describe('CR 107.3a, 605.3b: "{T}, Pay 2 life, Tap X untapped tokens you control: Add X mana in any combination of colors."', () => {
  const setup = (squirrels: number, others = 0): GameState => {
    let s = scenario([], { p1: { battlefield: ['Test Nut Queen', 'Test Squirrel Maker', 'Test Soldier Maker'] }, defs: DEFS });
    for (let i = 0; i < squirrels; i++) s = makeToken(s, 'Test Squirrel Maker');
    for (let i = 0; i < others; i++) s = makeToken(s, 'Test Soldier Maker');
    return s;
  };
  const tap = (s0: GameState, x: number): { s: GameState; asked: number[] } => {
    const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.isMana === true && l.object === find(s0, 'Test Nut Queen', 'battlefield'));
    if (!a) throw new Error('no mana ability offered');
    const asked: number[] = [];
    let s = act(s0, a.action);
    for (let g = 0; g < 30 && s.pending && s.pending.kind !== 'priority'; g++) {
      const p = s.pending as unknown as { kind: string; max?: number; options: ObjectId[]; min: number };
      if (p.kind === 'chooseNumber') { asked.push(p.max ?? -1); s = answer(s, { kind: 'chooseNumber', n: x }); }
      else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
      else if (p.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: 'G' } as never);
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${p.kind}`);
    }
    return { s, asked };
  };
  const pool = (s: GameState): string => s.players[0]!.manaPool.map((u) => u.type).sort().join('');
  it('X is announced up to the untapped tokens: three tokens, X = 2 taps two of them, costs 2 life and adds two mana at once (no stack)', () => {
    const { s, asked } = tap(setup(3), 2);
    expect(asked).toEqual([3]);
    expect(pool(s)).toBe('GG');
    expect(s.players[0]!.life).toBe(18);
    expect(tokensOf(s, 'p1').filter((id) => s.objects[id]!.tapped)).toHaveLength(2);
    expect(s.objects[find(s, 'Test Nut Queen', 'battlefield')]!.tapped).toBe(true);
    expect(s.zones.stack.length).toBe(0);
  });
  it('X = 0: no token is tapped and no mana is added (the life and the {T} are still paid)', () => {
    const { s } = tap(setup(2), 0);
    expect(pool(s)).toBe('');
    expect(tokensOf(s, 'p1').filter((id) => s.objects[id]!.tapped)).toHaveLength(0);
  });
  it('tokens that entered this turn can be tapped for the cost (ruling 2024-07-26), and a token that is not a creature too: any token you control', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Nut Queen', 'Test Gold Maker'] }, defs: DEFS });
    const { s, asked } = tap(makeToken(s0, 'Test Gold Maker'), 1);
    expect(asked).toEqual([1]);
    expect(pool(s)).toBe('G');
  });
  it('negative: a tapped token is not an untapped one: X is announced up to the untapped tokens only', () => {
    const s0 = setup(3);
    s0.objects[tokensOf(s0, 'p1')[0]!]!.tapped = true;
    const { asked } = tap(s0, 1);
    expect(asked).toEqual([2]);
  });
  it('negative: only tokens: with no token nothing is asked and nothing is added; a card that is not a token is never tapped for it', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Nut Queen', 'Test Bear'] }, defs: DEFS });
    const { s, asked } = tap(s0, 0);
    expect(asked).toEqual([]);
    expect(pool(s)).toBe('');
    expect(s.objects[find(s, 'Test Bear', 'battlefield')]!.tapped).toBe(false);
  });
});

describe('CR 707.2, 111.2: "create a token that\'s a copy of target token you control. If that token is a Squirrel, instead create two tokens that are copies of it."', () => {
  const endStep = (s0: GameState, target: ObjectId): GameState => {
    let s = advanceTo(s0, 1, 'end');
    for (let g = 0; g < 30 && s.pending; g++) {
      const p = s.pending;
      if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [obj(target)] });
      else if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${p.kind}: ${p.prompt}`);
    }
    return s;
  };
  it('a Squirrel token: two copies of it are made', () => {
    const s0 = makeToken(scenario([], { p1: { battlefield: ['Test Nut Queen', 'Test Squirrel Maker'] }, defs: DEFS }), 'Test Squirrel Maker');
    const original = tokensOf(s0, 'p1')[0]!;
    const s = endStep(s0, original);
    const toks = tokensOf(s, 'p1');
    expect(toks).toHaveLength(3);
    for (const id of toks) expect(getChars(s, id)!.subtypes).toContain('Squirrel');
  });
  it('negative: a token that is not a Squirrel: one copy only', () => {
    const s0 = makeToken(scenario([], { p1: { battlefield: ['Test Nut Queen', 'Test Soldier Maker'] }, defs: DEFS }), 'Test Soldier Maker');
    const original = tokensOf(s0, 'p1')[0]!;
    const s = endStep(s0, original);
    const toks = tokensOf(s, 'p1');
    expect(toks).toHaveLength(2);
    for (const id of toks) expect(getChars(s, id)!.name).toBe('Soldier Token');
  });
});
