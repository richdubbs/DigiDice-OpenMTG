/**
 * WP7: modes (CR 601.2b, 700.2): the kicked / entwined override of the mode count (CR 601.4, 702.42), a chooser other than the caster (CR 700.2e), the cost of a
 * mode (CR 700.2h) and modes with no legal target (CR 700.2a).
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ModeSpec } from '../../../src/index';
import { answer, find, legal, reject, scenario } from '../helpers';
import { additionalCost, castCard, drive, mana, objectTarget, spec, spell, staticAbility } from './support';

const plain = (text: string): ModeSpec['options'][number] => ({ text, program: { targets: [], steps: [] } });

const board = (hand: string[], defs: ReturnType<typeof spell>[], lands = 4): GameState =>
  scenario(['Mountain', 'Grizzly Bears', 'Hill Giant'], { p1: { hand, battlefield: [...Array(lands).fill('Mountain') as string[], 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] }, defs });

const manaSpent = (s: GameState): number => s.objects[s.zones.stack[0]!]!.stack!.costsPaid.manaSpent!.length;

describe('CR 601.4, 700.2: "if this spell was kicked, choose any number instead"', () => {
  const kicker = staticAbility('Kicker {2}', [additionalCost('kicker', { mana: mana('{2}') }, { optional: true })]);
  const modes: ModeSpec = {
    min: 1, max: 1, override: { when: { cond: 'wasCast', kicked: true }, min: 1, max: 'any' },
    options: [plain('one'), plain('two'), plain('three')],
  };
  const card = spell('Test Kicked Charm', '{R}', [], { modes, abilities: [kicker] });

  it('unkicked the caster chooses exactly one mode', () => {
    let s = board(['Test Kicked Charm'], [card]);
    s = castCard(s, 'Test Kicked Charm');
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(s.pending).toMatchObject({ kind: 'chooseOption', min: 1, max: 1 });
  });

  it('kicked the caster may choose any number; the choice is made after the kicker (CR 601.4)', () => {
    let s = board(['Test Kicked Charm'], [card]);
    s = castCard(s, 'Test Kicked Charm');
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.pending).toMatchObject({ kind: 'chooseOption', min: 1, max: 3 });
    s = answer(s, { kind: 'chooseOption', ids: ['0', '2'] });
    s = drive(s, []);
    expect(s.objects[s.zones.stack[0]!]!.stack).toMatchObject({ modes: [0, 2], costsPaid: { kicked: 1, additional: ['kicker'] } });
    expect(manaSpent(s)).toBe(3);
  });

  it('a condition the engine cannot read keeps the spell out instead of guessing (never silently the wrong count)', () => {
    // cloud std-tdm / std-blb: an activation restriction reads this turn's history (model/forms.ts#turnHistoryAtAnnouncement); last turn's is read nowhere
    const unreadable = spell('Test Odd Charm', '{R}', [], { modes: { ...modes, override: { when: { cond: 'happened', event: { ev: 'draw' }, scope: 'lastTurn' }, min: 1, max: 3 } } });
    const s = board(['Test Odd Charm'], [unreadable]);
    expect(legal(s, 'p1', 'cast')).toEqual([]);
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Odd Charm', 'hand') }).message).toContain("can't read part of this yet");
  });
});

describe('CR 702.42: entwine is an additional cost that lets the caster choose all modes', () => {
  const entwine = staticAbility('Entwine {2}', [additionalCost('entwine', { mana: mana('{2}') }, { optional: true })]);
  const modes: ModeSpec = { min: 1, max: 1, override: { when: { cond: 'wasCast', kicked: 'entwine' }, min: 2, max: 2 }, options: [plain('first'), plain('second')] };
  const card = spell('Test Entwine', '{R}', [], { modes, abilities: [entwine], type: 'Sorcery' });

  it('entwined: both modes are chosen without a question and recorded in costsPaid.additional', () => {
    let s = board(['Test Entwine'], [card]);
    s = castCard(s, 'Test Entwine');
    s = answer(s, { kind: 'yesNo', yes: true });
    s = drive(s, []);
    expect(s.objects[s.zones.stack[0]!]!.stack).toMatchObject({ modes: [0, 1], costsPaid: { additional: ['entwine'] } });
    expect(manaSpent(s)).toBe(3);
  });

  it('not entwined: one of the two modes', () => {
    let s = board(['Test Entwine'], [card]);
    s = castCard(s, 'Test Entwine');
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(s.pending).toMatchObject({ kind: 'chooseOption', min: 1, max: 1 });
  });

  it('entwine is not offered when the player cannot pay for it (the spell is cast without it)', () => {
    let s = board(['Test Entwine'], [card], 1);
    s = castCard(s, 'Test Entwine');
    expect(s.pending).toMatchObject({ kind: 'chooseOption', min: 1, max: 1 });
    expect(s.log.some((l) => l.text.includes("can't pay the entwine cost"))).toBe(true);
  });
});

describe('CR 700.2h: a mode with its own cost (Spree)', () => {
  const modes: ModeSpec = {
    min: 1, max: 'any',
    options: [{ ...plain('cheap'), cost: { mana: mana('{1}') } }, { ...plain('dear'), cost: { mana: mana('{2}') } }, plain('free')],
  };
  const card = spell('Test Spree', '{R}', [], { modes });

  it('the costs of the chosen modes are added to the total cost', () => {
    let s = board(['Test Spree'], [card]);
    s = castCard(s, 'Test Spree');
    s = answer(s, { kind: 'chooseOption', ids: ['0', '1'] });
    s = drive(s, []);
    expect(manaSpent(s)).toBe(1 + 1 + 2);
  });

  it('a mode whose cost cannot be paid on top of the rest is disabled with a reason', () => {
    let s = board(['Test Spree'], [card], 3); // {R} + {2} fits; {R} + {1} + {2} is not asked together, but each mode alone must fit
    s = castCard(s, 'Test Spree');
    expect((s.pending as { options: { id: string; disabled?: string }[] }).options.map((o) => o.disabled)).toEqual([undefined, undefined, undefined]);
    let t = board(['Test Spree'], [card], 2);
    t = castCard(t, 'Test Spree');
    expect((t.pending as { options: { id: string; disabled?: string }[] }).options.map((o) => o.disabled !== undefined)).toEqual([false, true, false]);
  });
});

describe('CR 700.2e: a player other than the controller chooses the mode', () => {
  it('the opponent answers the mode question and cannot cancel it', () => {
    const modes: ModeSpec = { min: 1, max: 1, chooser: { ref: 'anOpponent' }, options: [plain('a'), plain('b')] };
    let s = board(['Test Pick'], [spell('Test Pick', '{R}', [], { modes })]);
    s = castCard(s, 'Test Pick');
    expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p2', cancellable: false });
    s = answer(s, { kind: 'chooseOption', ids: ['1'] });
    s = drive(s, []);
    expect(s.objects[s.zones.stack[0]!]!.stack!.modes).toEqual([1]);
  });
});

describe('CR 700.2a: a mode that would be illegal (no legal target) cannot be chosen', () => {
  it('it is listed as disabled with the reason, and the other mode is still available', () => {
    const modes: ModeSpec = { min: 1, max: 1, options: [{ text: 'destroy a planeswalker', program: { targets: [spec({ id: 't0', filter: { types: ['Planeswalker'] }, text: 'target planeswalker' })], steps: [] } }, plain('nothing')] };
    let s = board(['Test Half'], [spell('Test Half', '{R}', [], { modes })]);
    s = castCard(s, 'Test Half');
    expect(s.pending).toMatchObject({ kind: 'chooseOption', options: [{ id: '0', disabled: 'it has no legal targets' }, { id: '1' }] });
    s = answer(s, { kind: 'chooseOption', ids: ['1'] });
    expect(s.pending?.kind).toBe('payCost');
  });

  it('a chosen mode brings its own targets, and ids stay unique across the modes (Cryptic-Command style)', () => {
    const modes: ModeSpec = {
      min: 2, max: 2,
      options: [
        { text: 'counter', program: { targets: [spec({ id: 't0', kind: 'spell', filter: undefined, text: 'target spell' })], steps: [] } },
        { text: 'bounce', program: { targets: [spec({ id: 't1', text: 'target creature' })], steps: [] } },
        plain('draw'),
      ],
    };
    let s = board(['Test Cryptic'], [spell('Test Cryptic', '{R}', [], { modes })]);
    s = castCard(s, 'Test Cryptic');
    // No spell is on the stack to counter: that mode is disabled, so the two chosen modes are bounce and draw.
    expect((s.pending as { options: { disabled?: string }[] }).options.map((o) => o.disabled !== undefined)).toEqual([true, false, false]);
    s = answer(s, { kind: 'chooseOption', ids: ['1', '2'] });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', targetText: 'target creature' });
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(find(s, 'Hill Giant', 'battlefield'))] });
    s = drive(s, []);
    expect(s.objects[s.zones.stack[0]!]!.stack).toMatchObject({ modes: [1, 2], targets: [[objectTarget(find(s, 'Hill Giant', 'battlefield'))]] });
  });
});
