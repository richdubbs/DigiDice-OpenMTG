/**
 * Commander lane edh-top, round edh-top-9: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler, in
 * 4-player games. Each test is named after the rule it checks and the groups have their negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 702.11d, 113.1, 118.12, 122.1   "Flying, hexproof from activated and triggered abilities ... When this creature enters, exchange control of this creature and target creature an opponent controls. If you do, you get {E}{E}{E}{E}, then sacrifice that creature unless you pay an amount of {E} equal to its mana value."
 *   CR 700.2, 602.5b, 701.10e, 122.1   "{0}, {T}: Choose one. Activate only as a sorcery. • Double the number of each kind of counter on target permanent. • Double the number of each kind of counter you have."
 *   CR 701.12a, 608.2b, 608.2c   "exchange control of this creature and up to one target creature an opponent controls. If you don't or can't make an exchange, sacrifice this creature. This ability still resolves if its target becomes illegal."
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { act as mact, answer as mans, find as mfind, mpScenario, pass as mpass } from '../../m12/rules/helpers';
import { card, full, settle, resolveAll } from '../cmd3/helpers';

const on = (s: GameState, zone: 'battlefield' | 'graveyard', p: string, defId: string): ObjectId[] =>
  (zone === 'battlefield' ? s.zones.battlefield : s.zones.graveyard[p]!).filter((id) => s.objects[id]!.defId === defId);
const ctrl = (s: GameState, id: ObjectId): string => s.objects[id]!.controller;

describe('CR 701.12a, 608.2b, 608.2c: "When this creature enters, exchange control of this creature and up to one target creature an opponent controls. If you don\'t or can\'t make an exchange, sacrifice this creature. This ability still resolves if its target becomes illegal."', () => {
  const DRAKE = card('Test Swapdrake', 'Creature — Drake', 'Flying\nWhen this creature enters, exchange control of this creature and up to one target creature an opponent controls. If you don\'t or can\'t make an exchange, sacrifice this creature. This ability still resolves if its target becomes illegal.', ['2', '3']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const ZAP = card('Test Zap', 'Instant', 'Destroy target creature.');
  const defs = [DRAKE, BEAR, ZAP];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Swapdrake'] }, p2: { battlefield: ['Test Plain Bear'], hand: ['Test Zap'] } } });
  /** Cast the drake and let it resolve; the trigger is on the stack with p1 to pass, its target chosen (or none). */
  const toTrigger = (pick: boolean): { s: GameState; bear: ObjectId } => {
    let s = start();
    const bear = on(s, 'battlefield', 'p2', 'Test Plain Bear')[0]!;
    s = settle(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Swapdrake', 'hand', 'p1') }));
    while (s.pending?.kind === 'priority') s = mpass(s); // the drake resolves; its trigger asks for a target
    s = settle(s, { targets: pick ? [{ kind: 'object', id: bear }] : [] });
    return { s, bear };
  };
  it('is automated', () => expect(full(DRAKE)).toBe(true));
  it('CR 701.12a-b: with a legal target, the creatures swap controllers and nothing is sacrificed', () => {
    const { s: s0, bear } = toTrigger(true);
    const s = resolveAll(s0);
    const drake = on(s, 'battlefield', 'p1', 'Test Swapdrake')[0]!;
    expect(ctrl(s, drake)).toBe('p2');
    expect(ctrl(s, bear)).toBe('p1');
  });
  it('CR 608.2b (the card text): the target is destroyed in response: the ability still resolves, makes no exchange, and the drake is sacrificed', () => {
    const { s: s0, bear } = toTrigger(true);
    let s = mpass(s0); // p1 passes; p2 may respond
    s = settle(mact(s, { type: 'cast', player: 'p2', card: mfind(s, 'Test Zap', 'hand', 'p2') }), { targets: [{ kind: 'object', id: bear }] });
    s = resolveAll(s);
    expect(on(s, 'battlefield', 'p2', 'Test Plain Bear')).toHaveLength(0);
    expect(on(s, 'battlefield', 'p1', 'Test Swapdrake')).toHaveLength(0);
    expect(on(s, 'graveyard', 'p1', 'Test Swapdrake')).toHaveLength(1);
  });
  it('CR 701.12a: no target chosen ("up to one"): no exchange, so the drake is sacrificed', () => {
    const { s: s0 } = toTrigger(false);
    const s = resolveAll(s0);
    expect(on(s, 'graveyard', 'p1', 'Test Swapdrake')).toHaveLength(1);
  });
  it('negative: without the sentence the ability is removed from the stack when its only target is illegal (CR 608.2b): the drake stays', () => {
    const PLAIN = card('Test Plaindrake', 'Creature — Drake', 'Flying\nWhen this creature enters, exchange control of this creature and up to one target creature an opponent controls. If you don\'t or can\'t make an exchange, sacrifice this creature.', ['2', '3']);
    let s = mpScenario({ defs: [PLAIN, BEAR, ZAP], zones: { p1: { hand: ['Test Plaindrake'] }, p2: { battlefield: ['Test Plain Bear'], hand: ['Test Zap'] } } });
    const bear = on(s, 'battlefield', 'p2', 'Test Plain Bear')[0]!;
    s = settle(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Plaindrake', 'hand', 'p1') }));
    while (s.pending?.kind === 'priority') s = mpass(s);
    s = settle(s, { targets: [{ kind: 'object', id: bear }] });
    s = mpass(s);
    s = settle(mact(s, { type: 'cast', player: 'p2', card: mfind(s, 'Test Zap', 'hand', 'p2') }), { targets: [{ kind: 'object', id: bear }] });
    s = resolveAll(s);
    expect(on(s, 'battlefield', 'p1', 'Test Plaindrake')).toHaveLength(1);
  });
  it('negative: the sacrifice happens only when no exchange was made (the exchange happened above and the drake is still on the battlefield)', () => {
    const { s: s0 } = toTrigger(true);
    const s = resolveAll(s0);
    expect(on(s, 'graveyard', 'p1', 'Test Swapdrake')).toHaveLength(0);
    expect(on(s, 'graveyard', 'p2', 'Test Swapdrake')).toHaveLength(0);
  });
});

describe('CR 702.11d, 113.1, 118.12, 122.1: "hexproof from activated and triggered abilities"; "If you do, you get {E}{E}{E}{E}, then sacrifice that creature unless you pay an amount of {E} equal to its mana value."', () => {
  const DRAKE = card('Test Voltdrake', 'Creature — Drake', 'Flying, hexproof from activated and triggered abilities\nWhen this creature enters, exchange control of this creature and target creature an opponent controls. If you do, you get {E}{E}{E}{E}, then sacrifice that creature unless you pay an amount of {E} equal to its mana value.', ['2', '3']);
  const CHEAP = card('Test Cheap Bear', 'Creature — Bear', '', ['2', '2'], '{2}');
  const DEAR = card('Test Dear Giant', 'Creature — Giant', '', ['5', '5'], '{5}');
  const PINGER = card('Test Pinger', 'Artifact', '{0}: This artifact deals 1 damage to target creature.');
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to target creature.');
  const defs = [DRAKE, CHEAP, DEAR, PINGER, BOLT];
  const energy = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.counters['energy'] ?? 0;
  const start = (target: string): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Voltdrake', 'Test Bolt'], battlefield: ['Test Pinger'] }, p2: { battlefield: [target] } } });
  const resolveTrigger = (s0: GameState, target: string, pay: boolean): GameState => {
    let s = settle(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Voltdrake', 'hand', 'p1') }));
    const t = on(s, 'battlefield', 'p2', target)[0]!;
    while (s.pending?.kind === 'priority' && s.zones.stack.length > 0 && s.objects[s.zones.stack[s.zones.stack.length - 1]!]!.kind !== 'ability') s = mpass(s);
    s = settle(s, { targets: [{ kind: 'object', id: t }] });
    while (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')) {
      if (s.pending?.kind === 'priority') s = mpass(s);
      else s = settle(s, { yes: pay });
    }
    return s;
  };
  it('is automated', () => expect(full(DRAKE)).toBe(true));
  it('CR 701.12a, 122.1, 118.12: the exchange happens, the player gets four energy and pays the target\'s mana value in energy (2): both creatures stay', () => {
    const s = resolveTrigger(start('Test Cheap Bear'), 'Test Cheap Bear', true);
    expect(on(s, 'battlefield', 'p1', 'Test Cheap Bear').map((id) => ctrl(s, id))).toEqual(['p1']);
    expect(on(s, 'battlefield', 'p1', 'Test Voltdrake').map((id) => ctrl(s, id))).toEqual(['p2']);
    expect(energy(s, 'p1')).toBe(2);
  });
  it('negative: the player declines to pay (or cannot: mana value 5 against four energy): that creature is sacrificed, the energy is kept', () => {
    const declined = resolveTrigger(start('Test Cheap Bear'), 'Test Cheap Bear', false);
    expect(on(declined, 'battlefield', 'p1', 'Test Cheap Bear')).toHaveLength(0);
    expect(on(declined, 'graveyard', 'p2', 'Test Cheap Bear')).toHaveLength(1);
    expect(energy(declined, 'p1')).toBe(4);
    const cannot = resolveTrigger(start('Test Dear Giant'), 'Test Dear Giant', true);
    expect(on(cannot, 'graveyard', 'p2', 'Test Dear Giant')).toHaveLength(1);
    expect(energy(cannot, 'p1')).toBe(4);
  });
  it('CR 702.11d: after the exchange its new controller\'s opponent cannot target it with an activated ability, but can with a spell', () => {
    let s = resolveTrigger(start('Test Cheap Bear'), 'Test Cheap Bear', true);
    const drake = on(s, 'battlefield', 'p1', 'Test Voltdrake')[0]!;
    const bear = on(s, 'battlefield', 'p1', 'Test Cheap Bear')[0]!;
    const pinger = on(s, 'battlefield', 'p1', 'Test Pinger')[0]!;
    s = mact(s, { type: 'activate', player: 'p1', source: pinger, ability: 'p:0:0' });
    const options = (s.pending as unknown as { objects?: ObjectId[] }).objects ?? [];
    expect(options).toContain(bear);
    expect(options).not.toContain(drake);
    s = mact(resolveAll(settle(s, { targets: [{ kind: 'object', id: bear }] })), { type: 'cast', player: 'p1', card: mfind(s, 'Test Bolt', 'hand', 'p1') });
    const spellOptions = (s.pending as unknown as { objects?: ObjectId[] }).objects ?? [];
    expect(spellOptions).toContain(drake);
  });
  it('CR 702.11d, 707.10 (review finding): the copy a storm trigger makes of a spell is a spell: its new targets may be a creature with hexproof from activated and triggered abilities', () => {
    const STORM = card('Test Storm Zap', 'Instant', 'Storm\nTest Storm Zap deals 1 damage to target creature.');
    const LIFE = card('Test Life', 'Instant', 'You gain 1 life.');
    let s = mpScenario({ defs: [DRAKE, CHEAP, STORM, LIFE], zones: { p1: { hand: ['Test Life', 'Test Storm Zap'], battlefield: ['Test Cheap Bear'] }, p2: { battlefield: ['Test Voltdrake'] } } });
    const bear = on(s, 'battlefield', 'p1', 'Test Cheap Bear')[0]!;
    const drake = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Voltdrake')!;
    s = settle(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Life', 'hand', 'p1') }));
    while (s.zones.stack.length > 0) s = mpass(s);
    s = mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Storm Zap', 'hand', 'p1') });
    expect((s.pending as unknown as { objects?: ObjectId[] }).objects).toContain(drake);
    s = settle(s, { targets: [{ kind: 'object', id: bear }] });
    let seen = false;
    for (let i = 0; i < 20; i++) {
      const p = s.pending as unknown as { kind: string; prompt: string; objects?: ObjectId[] } | null | undefined;
      if (!p) break;
      if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = mpass(s); continue; }
      if (p.kind === 'yesNo') { s = mans(s, { kind: 'yesNo', yes: true }); continue; }
      if (p.kind === 'chooseTargets') {
        if (/copy/.test(p.prompt)) { seen = true; expect(p.objects).toContain(drake); }
        s = mans(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] });
        continue;
      }
      break;
    }
    expect(seen).toBe(true);
  });
});

describe('CR 700.2, 602.5b, 701.10e, 122.1: "{0}, {T}: Choose one. Activate only as a sorcery. • Double the number of each kind of counter on target permanent. • Double the number of each kind of counter you have."', () => {
  const DOUBLER = card('Test Doubling Engine', 'Artifact', '{0}, {T}: Choose one. Activate only as a sorcery.\n• Double the number of each kind of counter on target permanent.\n• Double the number of each kind of counter you have.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [DOUBLER, BEAR];
  const start = (): GameState => {
    const s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Doubling Engine', 'Test Plain Bear'] } } });
    s.players.find((x) => x.id === 'p1')!.counters['energy'] = 3;
    s.players.find((x) => x.id === 'p1')!.poison = 1;
    s.players.find((x) => x.id === 'p2')!.counters['energy'] = 5;
    const bear = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Plain Bear')!;
    s.objects[bear]!.counters['+1/+1'] = 2;
    return s;
  };
  const activate = (mode: number): GameState => {
    const s = start();
    const engine = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Doubling Engine')!;
    const bear = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Plain Bear')!;
    let t = mact(s, { type: 'activate', player: 'p1', source: engine, ability: 'p:0:0' });
    t = settle(t, { option: mode === 0 ? undefined : (t.pending as unknown as { options: { id: string }[] }).options[mode]!.id, targets: [{ kind: 'object', id: bear }] });
    return resolveAll(t);
  };
  it('is automated', () => expect(full(DOUBLER)).toBe(true));
  it('CR 122.1: the second mode doubles every kind of counter the player has (energy 3 -> 6, poison 1 -> 2); other players\' counters and creatures\' counters are untouched', () => {
    const s = activate(1);
    const p1 = s.players.find((x) => x.id === 'p1')!;
    expect(p1.counters['energy']).toBe(6);
    expect(p1.poison).toBe(2);
    expect(s.players.find((x) => x.id === 'p2')!.counters['energy']).toBe(5);
    const bear = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Plain Bear')!;
    expect(s.objects[bear]!.counters['+1/+1']).toBe(2);
  });
  it('negative: the first mode doubles the permanent\'s counters (2 -> 4) and leaves the player\'s alone', () => {
    const s = activate(0);
    const bear = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Plain Bear')!;
    expect(s.objects[bear]!.counters['+1/+1']).toBe(4);
    expect(s.players.find((x) => x.id === 'p1')!.counters['energy']).toBe(3);
  });
});
