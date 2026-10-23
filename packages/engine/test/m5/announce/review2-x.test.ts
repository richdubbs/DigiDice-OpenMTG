/**
 * WP7 review 2, X (CR 107.3a): X is announced when ANY cost that will be paid has an X — the mana cost, an alternative cost, a mandatory or chosen additional cost
 * (kicker {X}), the cost of a chosen mode, or a non-mana part of an activation cost (pay X life, remove X counters) — and every one of those costs is paid with the announced X.
 */
import { describe, expect, it } from 'vitest';
import type { CostDef, GameState, ModeSpec } from '../../../src/index';
import { act, activated, answer, find, legal, life, scenario, synth } from '../helpers';
import { alternativeCost, additionalCost, castCard, drive, mana, spell, staticAbility } from './support';

const stackInfo = (s: GameState) => s.objects[s.zones.stack[0]!]!.stack!;
const payLifeX: CostDef = { other: [{ kind: 'payLife', amount: { q: 'X' } }] };
const swamps = (n: number, hand: string[], defs: ReturnType<typeof spell>[]): GameState =>
  scenario(['Swamp', 'Mountain'], { p1: { hand, battlefield: Array(n).fill('Swamp') as string[] }, defs });

describe('CR 107.3a: X in an additional cost that is not mana (Toxic Deluge: "pay X life")', () => {
  const deluge = spell('Test Deluge', '{2}{B}', [], { type: 'Sorcery', abilities: [staticAbility('As an additional cost to cast this spell, pay X life.', [additionalCost(undefined, payLifeX)])] });

  it('the caster announces X and pays that much life (it used to resolve X as 0: a free Toxic Deluge)', () => {
    let s = castCard(swamps(3, ['Test Deluge'], [deluge]), 'Test Deluge');
    expect(s.pending).toMatchObject({ kind: 'chooseNumber', min: 0 });
    s = drive(answer(s, { kind: 'chooseNumber', n: 3 }), []);
    expect(life(s, 'p1')).toBe(17);
    expect(stackInfo(s).x).toBe(3);
  });

  it('X is capped by what can be paid: you cannot pay more life than you have', () => {
    const s = castCard(swamps(3, ['Test Deluge'], [deluge]), 'Test Deluge');
    expect((s.pending as unknown as { max: number }).max).toBeLessThanOrEqual(20);
  });
});

describe('CR 107.3a: X in an optional additional cost is announced only when that cost is paid (Inscription of Abundance: "Kicker {X}")', () => {
  const card = spell('Test Xkicker', '{R}', [], { abilities: [staticAbility('Kicker {X}', [additionalCost('kicker', { mana: mana('{X}') }, { optional: true })])] });
  const board = (): GameState => scenario(['Mountain'], { p1: { hand: ['Test Xkicker'], battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain'] }, defs: [card] });

  it('kicked: X is asked and the kicker costs {X}', () => {
    let s = castCard(board(), 'Test Xkicker');
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending).toMatchObject({ kind: 'chooseNumber', max: 3 });
    s = drive(answer(s, { kind: 'chooseNumber', n: 2 }), []);
    expect(stackInfo(s)).toMatchObject({ x: 2, costsPaid: { kicked: 1 } });
    expect(stackInfo(s).costsPaid.manaSpent).toHaveLength(3);
  });

  it('not kicked: X is not asked and is 0', () => {
    let s = castCard(board(), 'Test Xkicker');
    s = drive(answer(s, { kind: 'yesNo', yes: false }), []);
    expect(stackInfo(s).x).toBeUndefined();
    expect(stackInfo(s).costsPaid.manaSpent).toHaveLength(1);
  });
});

describe('CR 107.3a, 700.2h: X in the cost of a chosen mode, and in a non-mana part of an alternative cost', () => {
  it('a mode that costs {X} announces X once it is chosen', () => {
    const modes: ModeSpec = { min: 1, max: 1, options: [{ text: 'big', cost: { mana: mana('{X}') }, program: { targets: [], steps: [] } }, { text: 'small', program: { targets: [], steps: [] } }] };
    let s = castCard(scenario(['Mountain'], { p1: { hand: ['Test Xmode'], battlefield: ['Mountain', 'Mountain', 'Mountain'] }, defs: [spell('Test Xmode', '{R}', [], { modes })] }), 'Test Xmode');
    s = answer(s, { kind: 'chooseOption', ids: ['0'] });
    expect(s.pending).toMatchObject({ kind: 'chooseNumber', max: 2 });
    s = drive(answer(s, { kind: 'chooseNumber', n: 2 }), []);
    expect(stackInfo(s).costsPaid.manaSpent).toHaveLength(3);
  });

  it('an alternative cost "pay X life" announces X', () => {
    const card = spell('Test Xlife', '{3}{B}', [], { abilities: [staticAbility('You may pay X life rather than pay this spell\'s mana cost.', [alternativeCost('xlife', payLifeX)])] });
    let s = castCard(swamps(0, ['Test Xlife'], [card]), 'Test Xlife', { method: 'xlife' });
    expect(s.pending).toMatchObject({ kind: 'chooseNumber' });
    s = drive(answer(s, { kind: 'chooseNumber', n: 4 }), []);
    expect(life(s, 'p1')).toBe(16);
    expect(stackInfo(s).x).toBe(4);
  });
});

describe('CR 107.3a, 602.2b: X in the non-mana cost of an activated ability', () => {
  it('"Pay X life": X is asked and paid', () => {
    const siphon = synth({ name: 'Test Siphon', type: 'Artifact', abilities: [activated('Pay X life: Do it.', payLifeX)] });
    let s = scenario([], { p1: { battlefield: ['Test Siphon'] }, defs: [siphon] });
    expect(legal(s, 'p1', 'activate')).toHaveLength(1);
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Siphon', 'battlefield'), ability: 'p:0:0' });
    expect(s.pending).toMatchObject({ kind: 'chooseNumber' });
    s = drive(answer(s, { kind: 'chooseNumber', n: 4 }), []);
    expect(life(s, 'p1')).toBe(16);
    expect(stackInfo(s).x).toBe(4);
  });

  it('"Remove X +1/+1 counters from this": X is capped by the counters and they are removed', () => {
    const totem = synth({ name: 'Test Counter Totem', type: 'Artifact', abilities: [activated('Remove X +1/+1 counters from this: Do it.', { other: [{ kind: 'removeCounters', counter: '+1/+1', count: { q: 'X' } }] })] });
    let s = scenario([], { p1: { battlefield: [{ name: 'Test Counter Totem', counters: { '+1/+1': 3 } }] }, defs: [totem] });
    const id = find(s, 'Test Counter Totem', 'battlefield');
    s = act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' });
    expect(s.pending).toMatchObject({ kind: 'chooseNumber', max: 3 });
    s = drive(answer(s, { kind: 'chooseNumber', n: 2 }), []);
    expect(s.objects[id]!.counters['+1/+1']).toBe(1);
  });
});
