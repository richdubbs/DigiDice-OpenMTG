/**
 * WP30 review: "X announced" is decided from the announcement, never from whether the stack object exists. A spell or ability is put on the stack (CR 601.2a,
 * 602.2a) BEFORE its modes, optional costs and X are chosen (CR 601.2b), so every check made there must not refuse what some X would allow; a triggered
 * ability announces no X and reads the X its source was cast with (CR 107.3m), at announcement (CR 603.3d) and at the CR 608.2b re-check alike.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, CostDef, GameState, ObjectFilter, Quantity, TargetSpec } from '../../../src/index';
import { recheckTargets } from '../../../src/rules/targets';
import { act, activated, answer, find, legal, passBoth, scenario, synth } from '../helpers';
import { trig, entersSelf } from '../triggers/cards';
import { additionalCost, castCard, drive, mana, objectTarget, spec, spell, staticAbility } from './support';

const X: Quantity = { q: 'X' };
const mvAtMostX: ObjectFilter = { types: ['Creature'], manaValue: { op: '<=', value: X } };
const xSpec = (id = 't0'): TargetSpec => spec({ id, filter: mvAtMostX, text: 'target creature with mana value X or less' });
const playerSpec = (id: string): TargetSpec => ({ id, kind: 'player', min: 1, max: 1, text: 'target player' });

/** p1: six Mountains and Grizzly Bears (mana value 2). */
const board = (hand: string[], defs: ReturnType<typeof synth>[], battlefield: string[] = []): GameState =>
  scenario(['Mountain', 'Grizzly Bears'], { p1: { hand, battlefield: [...Array(6).fill('Mountain'), 'Grizzly Bears', ...battlefield] }, defs });
const bears = (s: GameState) => find(s, 'Grizzly Bears', 'battlefield');

describe('CR 601.2b, 700.2a: a mode whose target compares with X can be chosen (modes come before X)', () => {
  // Kozilek's Command shape: "Choose one: destroy target creature with mana value X or less; or target player ...".
  const modal = spell('Test X Command', '{X}{R}', [], {
    type: 'Sorcery',
    modes: { min: 1, max: 1, options: [{ text: 'destroy target creature with mana value X or less', program: { targets: [xSpec('t0')], steps: [] } }, { text: 'target player', program: { targets: [playerSpec('t1')], steps: [] } }] },
  });

  it('CR 700.2a: the X mode of a modal {X} spell is offered at the mode choice, and its target is read with the announced X', () => {
    let s = board(['Test X Command'], [modal]);
    s = castCard(s, 'Test X Command');
    expect(s.pending).toMatchObject({ kind: 'chooseOption' });
    const opts = (s.pending as { options: { id: string; disabled?: string }[] }).options;
    expect(opts[0]!.disabled).toBeUndefined();
    s = answer(s, { kind: 'chooseOption', ids: ['0'] });
    expect(s.pending).toMatchObject({ kind: 'chooseNumber' });
    s = answer(s, { kind: 'chooseNumber', n: 2 });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', objects: [bears(s)] });
  });

  it('CR 602.2b, 700.2a: the same for a modal activated ability with {X}', () => {
    const ability: AbilityDef = {
      kind: 'activated', text: '{X}: Choose one ...', cost: { mana: mana('{X}') } as CostDef,
      effect: { targets: [], steps: [], modes: { min: 1, max: 1, options: [{ text: 'destroy target creature with mana value X or less', program: { targets: [xSpec('t0')], steps: [] } }, { text: 'target player', program: { targets: [playerSpec('t1')], steps: [] } }] } },
    };
    const engine = synth({ name: 'Test X Engine', cost: '{1}', type: 'Artifact', abilities: [ability] });
    const s0 = board([], [engine], ['Test X Engine']);
    let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test X Engine', 'battlefield'), ability: 'p:0:0' });
    expect(s.pending).toMatchObject({ kind: 'chooseOption' });
    expect((s.pending as { options: { disabled?: string }[] }).options[0]!.disabled).toBeUndefined();
    s = answer(s, { kind: 'chooseOption', ids: ['0'] });
    s = answer(s, { kind: 'chooseNumber', n: 3 });
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', objects: [bears(s)] });
  });
});

describe('CR 601.2b, 702.33a: kicker on an X spell whose target compares with X', () => {
  it('the kicker is offered: the affordability check made before X is announced does not read X as "nothing"', () => {
    const kicked = spell('Test X Kicked', '{X}{R}', [xSpec()], { abilities: [staticAbility('Kicker {1}', [additionalCost('kicker', { mana: mana('{1}') }, { optional: true })])] });
    let s = board(['Test X Kicked'], [kicked]);
    s = castCard(s, 'Test X Kicked');
    expect(s.pending).toMatchObject({ kind: 'yesNo' });
    expect(s.log.some((l) => l.text.includes("can't pay the kicker"))).toBe(false);
  });
});

describe('CR 107.3m, 603.3d, 608.2b: a triggered ability reads the X its source was cast with', () => {
  // Dune Drifter / Kinetic Ooze shape: "When this creature enters, destroy target creature with mana value X or less."
  const ooze = synth({
    name: 'Test X Ooze', cost: '{X}{R}', type: 'Creature — Ooze', pt: ['1', '1'],
    abilities: [trig('When ~ enters, destroy target creature with mana value X or less.', [entersSelf], { targets: [{ ...xSpec(), filter: { ...mvAtMostX, other: true } }], steps: [] })],
  });

  it('CR 603.3d: its target is chosen with X = 3 (the cast X), and the CR 608.2b re-check agrees', () => {
    let s = board(['Test X Ooze'], [ooze]);
    s = castCard(s, 'Test X Ooze');
    s = drive(answer(s, { kind: 'chooseNumber', n: 3 }), []);
    s = passBoth(s); // the creature spell resolves; its enters trigger goes on the stack
    expect(s.log.some((l) => l.text.includes('is removed from the stack'))).toBe(false);
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', objects: [bears(s)] });
    s = answer(s, { kind: 'chooseTargets', targets: [objectTarget(bears(s))] });
    const trigId = s.zones.stack[s.zones.stack.length - 1]!;
    const info = s.objects[trigId]!.stack!;
    expect(info.kind).toBe('triggered');
    const oozeId = find(s, 'Test X Ooze', 'battlefield');
    expect(recheckTargets(s, [{ ...xSpec(), filter: { ...mvAtMostX, other: true } }], info.targets, 'p1', oozeId, trigId)).toEqual({ legal: 1, total: 1 });
  });

  it('with X = 1 (cast X), the Bears (mana value 2) are not a legal target and the trigger is removed (CR 603.3d)', () => {
    let s = board(['Test X Ooze'], [ooze]);
    s = castCard(s, 'Test X Ooze');
    s = drive(answer(s, { kind: 'chooseNumber', n: 1 }), []);
    s = passBoth(s);
    expect(s.log.some((l) => l.text.includes('is removed from the stack'))).toBe(true);
  });
});

describe('CR 601.2c, 601.3: the legality check bounds X by what can be paid', () => {
  it('a spell whose X-filtered target needs an X the player cannot pay for is not offered', () => {
    const xKill = spell('Test X Kill', '{X}{R}', [xSpec()]);
    // Two Mountains: X is at most 1; the only creature has mana value 2.
    const s = scenario(['Mountain', 'Grizzly Bears'], { p1: { hand: ['Test X Kill'], battlefield: ['Mountain', 'Mountain', 'Grizzly Bears'] }, defs: [xKill] });
    expect(legal(s, 'p1', 'cast')).toHaveLength(0);
    // Three Mountains: X = 2 can be paid, so it is offered.
    const t = scenario(['Mountain', 'Grizzly Bears'], { p1: { hand: ['Test X Kill'], battlefield: ['Mountain', 'Mountain', 'Mountain', 'Grizzly Bears'] }, defs: [xKill] });
    expect(legal(t, 'p1', 'cast')).toHaveLength(1);
  });
});

describe('CR 107.3a, 601.2b: an X that appears only in a cost part\'s filter is announced', () => {
  // Scrap Welder shape: "{T}, Sacrifice an artifact with mana value X: Return target artifact card with mana value less than X ..." (here: target player).
  const welder = synth({
    name: 'Test X Welder', cost: '{2}', type: 'Artifact',
    abilities: [activated('{T}, Sacrifice an artifact with mana value X: Target player ...', { tap: true, other: [{ kind: 'sacrifice', filter: { types: ['Artifact'], manaValue: { op: '==', value: X } }, count: 1 }] } as CostDef, [playerSpec('t0')])],
  });
  const zero = synth({ name: 'Test Zero Trinket', cost: '{0}', type: 'Artifact', abilities: [] });
  const two = synth({ name: 'Test Two Trinket', cost: '{2}', type: 'Artifact', abilities: [] });

  it('with only a mana value 2 artifact (and the Welder itself, mana value 2) the ability is offered and X = 2 is announced', () => {
    const s0 = board([], [welder, two], ['Test X Welder', 'Test Two Trinket']);
    expect(legal(s0, 'p1', 'activate').some((a) => a.action.type === 'activate' && a.action.source === find(s0, 'Test X Welder', 'battlefield'))).toBe(true);
    let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test X Welder', 'battlefield'), ability: 'p:0:0' });
    // Only X = 2 can be paid, so it is the announced value without a question (no other value is legal, CR 601.2h).
    expect(s.pending).toMatchObject({ kind: 'chooseTargets' });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    const top = s.objects[s.zones.stack[s.zones.stack.length - 1]!]!;
    expect(top.stack!.x).toBe(2);
  });

  it('with a mana value 0 and a mana value 2 artifact the player chooses X, and the sacrifice follows the announced X', () => {
    const s0 = board([], [welder, zero, two], ['Test X Welder', 'Test Zero Trinket', 'Test Two Trinket']);
    let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test X Welder', 'battlefield'), ability: 'p:0:0' });
    expect(s.pending).toMatchObject({ kind: 'chooseNumber', min: 0, max: 2 });
    // X = 1: nothing has mana value 1, so that X is refused (CR 601.2h) and the decision stays open.
    const bad = applyOrNull(s, 1);
    expect(bad).toBeNull();
    s = drive(answer(s, { kind: 'chooseNumber', n: 2 }), [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    const top = s.objects[s.zones.stack[s.zones.stack.length - 1]!]!;
    expect(top.stack!.x).toBe(2);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Zero Trinket')).toBe(true); // the 0-drop was not sacrificed
  });
});

function applyOrNull(s: GameState, n: number): GameState | null {
  try {
    return answer(s, { kind: 'chooseNumber', n });
  } catch {
    return null;
  }
}
