/**
 * WP7 review 2, modes: the printed number of modes must be chosen (CR 601.2b, 700.2, 702.42a) — never clamped to what is usable — and the cost of the CHOSEN
 * SET of modes (CR 700.2h) must be payable, not just each mode alone. A mode that can be repeated (CR 700.2d) keeps its targets apart per instance or is not offered.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ModeSpec } from '../../../src/index';
import { answer, find, legal, reject, scenario } from '../helpers';
import { additionalCost, castCard, drive, mana, spec, spell, staticAbility } from './support';

const plain = (text: string): ModeSpec['options'][number] => ({ text, program: { targets: [], steps: [] } });

const board = (hand: string[], defs: ReturnType<typeof spell>[], lands = 4): GameState =>
  scenario(['Mountain', 'Grizzly Bears', 'Hill Giant'], { p1: { hand, battlefield: [...Array(lands).fill('Mountain') as string[], 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] }, defs });

const decisionOptions = (s: GameState) => (s.pending as unknown as { options: { id: string; disabled?: string }[] }).options;

describe('CR 601.2b, 700.2: a modal spell is cast with the number of modes it requires, never fewer', () => {
  const modes: ModeSpec = { min: 1, max: 'any', options: [{ ...plain('cheap'), cost: { mana: mana('{1}') } }, { ...plain('dear'), cost: { mana: mana('{2}') } }] };
  const card = spell('Test Spree All', '{R}', [], { modes });

  it('CR 700.2h: with mana for no mode at all the spell is not castable (it used to be listed and cast with zero modes)', () => {
    const s = board(['Test Spree All'], [card], 1);
    expect(legal(s, 'p1', 'cast')).toEqual([]);
    const err = reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spree All', 'hand') });
    expect(err.rules).toContain('CR 700.2');
  });

  it('CR 700.2h: with mana for one mode it is castable, that mode is the only choice, and choosing none is refused', () => {
    let s = board(['Test Spree All'], [card], 2); // {R} + {1}
    expect(legal(s, 'p1', 'cast')).toHaveLength(1);
    s = castCard(s, 'Test Spree All');
    expect(s.pending).toMatchObject({ kind: 'chooseOption', min: 1 });
    expect(decisionOptions(s).map((o) => o.disabled !== undefined)).toEqual([false, true]);
    reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseOption', ids: [] } });
    s = drive(answer(s, { kind: 'chooseOption', ids: ['0'] }), []);
    expect(s.objects[s.zones.stack[0]!]!.stack!.modes).toEqual([0]);
  });

  it('CR 700.2h: two modes that are each affordable but not together are refused when chosen; the mode decision stays open', () => {
    const s = castCard(board(['Test Spree All'], [card], 3), 'Test Spree All'); // {R}+{1} and {R}+{2} fit, {R}+{1}+{2} does not
    expect(decisionOptions(s).map((o) => o.disabled)).toEqual([undefined, undefined]);
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseOption', ids: ['0', '1'] } });
    expect(err.rules).toContain('CR 700.2h');
    const ok = answer(s, { kind: 'chooseOption', ids: ['1'] });
    expect(ok.pending?.kind).toBe('payCost');
  });
});

describe('CR 702.42a: entwine means ALL modes — it is not offered when all of them cannot be chosen', () => {
  const entwine = staticAbility('Entwine {2}', [additionalCost('entwine', { mana: mana('{2}') }, { optional: true })]);
  const modes: ModeSpec = {
    min: 1, max: 1, override: { when: { cond: 'wasCast', kicked: 'entwine' }, min: 2, max: 2 },
    options: [
      { text: 'destroy target artifact', program: { targets: [spec({ id: 't0', filter: { types: ['Artifact'] }, text: 'target artifact' })], steps: [] } },
      { text: 'destroy target creature', program: { targets: [spec({ id: 't1' })], steps: [] } },
    ],
  };
  const card = spell('Test Entwine Pair', '{R}', [], { modes, abilities: [entwine], type: 'Sorcery' });

  it('no artifact to destroy: the entwine question is not asked (and its cost is not paid for one mode); the single mode is chosen', () => {
    let s = castCard(board(['Test Entwine Pair'], [card]), 'Test Entwine Pair');
    expect(s.pending).toMatchObject({ kind: 'chooseOption', min: 1, max: 1 });
    expect(decisionOptions(s).map((o) => o.disabled !== undefined)).toEqual([true, false]);
    s = drive(answer(s, { kind: 'chooseOption', ids: ['1'] }), []);
    expect(s.objects[s.zones.stack[0]!]!.stack).toMatchObject({ modes: [1], costsPaid: {} });
    expect(s.objects[s.zones.stack[0]!]!.stack!.costsPaid.additional).toBeUndefined();
  });
});

describe('CR 700.2d, 115.3: a mode chosen more than once is that many instances, each with targets of its own (std-blb: rules/mode-instances.ts renames the ids of later instances)', () => {
  const targeted = (id: string) => ({ text: 'target creature', program: { targets: [spec({ id })], steps: [] } });

  it('allowRepeat with a targeted mode is offered, and each instance announces its own target (one list per instance on the stack)', () => {
    const modes: ModeSpec = { min: 2, max: 2, allowRepeat: true, options: [targeted('t0'), plain('draw')] };
    let s = board(['Test Repeat Target'], [spell('Test Repeat Target', '{R}', [], { modes })]);
    expect(legal(s, 'p1', 'cast')).toHaveLength(1);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield');
    s = castCard(s, 'Test Repeat Target');
    s = drive(answer(s, { kind: 'chooseOption', ids: ['0', '0'] }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }, { kind: 'chooseTargets', targets: [{ kind: 'object', id: giant }] }]);
    const stack = s.objects[s.zones.stack[0]!]!.stack!;
    expect(stack.modes).toEqual([0, 0]);
    expect(stack.targets.map((l) => l.map((t) => (t as { id: string }).id))).toEqual([[bears], [giant]]);
  });

  it('allowRepeat with modes that have no targets stays fully supported', () => {
    const modes: ModeSpec = { min: 2, max: 2, allowRepeat: true, options: [plain('a'), plain('b')] };
    let s = board(['Test Repeat Plain'], [spell('Test Repeat Plain', '{R}', [], { modes })]);
    s = castCard(s, 'Test Repeat Plain');
    expect(s.pending).toMatchObject({ kind: 'chooseOption', allowRepeat: true });
    s = drive(answer(s, { kind: 'chooseOption', ids: ['0', '0'] }), []);
    expect(s.objects[s.zones.stack[0]!]!.stack!.modes).toEqual([0, 0]);
  });
});
