/**
 * WP25: the executability smoke test (design 8.10.5, 11.3 gate 7, 15.4): every automated ability of every fixture card runs on a generated board through
 * `applyAction` without EngineBug, exception, inconsistent state (state-based actions included) or a run-time backstop on any card (guard G11). The
 * harness is also shown to catch broken abilities: a never-bound name (EngineBug, design 3.1 rule 6) and an op without a handler (manualResolve from
 * the backstop, on a full card and on a partial one, G11).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type AbilityDef, type CardDef, type Decision, type GameState, type OracleCard } from '@openmtg/engine';
import { answerFor } from '../../src/smoke/answer';
import { FILLER_CARDS, fillerDefinitions, makeBoard } from '../../src/smoke/board';
import { formatSmoke, invariantProblems, isSmokeCandidate, sbaProblems, smokeCard, summarize } from '../../src/smoke/run';
import { fixtureRuns } from './support';

// M12F (STATUS "Wave M12" gap 9): whole-fixture work (compiling, the CLI, the smoke run) sits near Vitest's 5 s default under load: an explicit
// timeout for every test here (a test's own longer one still applies).
describe('WP25 smoke: the run-time backstop is reported on partial cards too (G11)', { timeout: 60_000 }, () => {
  const bolt = (): CardDef => fixtureRuns().find((r) => r.card.name === 'Lightning Bolt')!.def!;
  /** Lightning Bolt with the given steps, plus one manual ability, classified partial. */
  const partialWith = (steps: unknown[]): CardDef => {
    const def = bolt();
    const a = def.faces[0]!.abilities[0] as AbilityDef & { effect: { steps: unknown[] } };
    const manual = { kind: 'manual', shape: 'static', text: 'Players can\'t whistle.', reason: 'no template matches the sentence', src: [1] } as unknown as AbilityDef;
    return { ...def, faces: [{ ...def.faces[0]!, abilities: [{ ...a, effect: { ...a.effect, steps } } as AbilityDef, manual] }], automation: { ...def.automation, level: 'partial', faces: undefined } as CardDef['automation'] };
  };
  it('CR 608.2 (G11): an op without a handler in an AUTOMATED ability of a partial card is a failure, not an expected manual prompt', () => {
    const r = smokeCard(partialWith([{ op: 'frobnicate' }]));
    expect(r.failures.map((f) => f.kind)).toEqual(['unexpected-manual']);
    expect(r.failures[0]!.message).toMatch(/the engine cannot perform this step yet \(frobnicate\).*backstop/);
  }, 60_000); // the first test of the file compiles every fixture card (fixtureRuns, 892 at the FAST5X batch 1 merge): over 5 s on a loaded machine
  it('CR 608.2: a partial card prompting for its own manual step is expected (no failure)', () => {
    const r = smokeCard(partialWith([
      { op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 3 },
      { op: 'manual', text: 'You may whistle a tune.', reason: 'no template matches the sentence' },
    ]));
    expect(r.failures).toEqual([]);
    expect(r.manualPrompts).toBeGreaterThan(0);
  });
});

describe('WP25 smoke: the state check includes the state-based actions (CR 704.3, 117.5)', { timeout: 60_000 }, () => {
  const board = (): GameState => structuredClone(makeBoard(fixtureRuns().find((r) => r.card.name === 'Lightning Bolt')!.def!, { inHand: true, onBattlefield: false }).state);
  it('CR 704.5g: a creature with lethal damage still on the battlefield while a player has priority is a problem', () => {
    const s = board();
    expect(sbaProblems(s)).toEqual([]);
    const bear = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Smoke Bear')!;
    s.objects[bear]!.damage = 2;
    expect(sbaProblems(s).join('\n')).toMatch(/CR 704\.5g: .*lethal damage/);
    expect(invariantProblems(s).join('\n')).toMatch(/CR 704\.5g/);
  });
  it('CR 704.5a: a player at 0 life without a game result while a player has priority is a problem', () => {
    const s = board();
    s.players[1]!.life = 0;
    expect(sbaProblems(s).join('\n')).toMatch(/CR 704\.5a: p2 has 0 life/);
  });
  it('CR 704.5i: a planeswalker without loyalty is a problem', () => {
    const s = board();
    const walker = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Smoke Walker')!;
    s.objects[walker]!.counters = {};
    expect(sbaProblems(s).join('\n')).toMatch(/CR 704\.5i/);
  });
});

describe('WP25 smoke: battles enter with defense counters and a protector (CR 310.4b, 310.12a)', { timeout: 60_000 }, () => {
  it('CR 310.4b, 310.12a: a Siege put on the generated board has its printed defense and an opponent as protector, and survives the state-based actions', () => {
    const run = fixtureRuns().find((r) => r.card.name.startsWith('Invasion of Ergamon'))!;
    const def = run.def!;
    const b = makeBoard(def, { inHand: false, onBattlefield: true });
    const o = b.state.objects[b.permanent!]!;
    expect(o.counters['defense']).toBe(Number(def.faces[0]!.defense));
    expect(o.protector).toBe('p2');
    expect(invariantProblems(b.state)).toEqual([]);
  });
  it('CR 704.5f: a permanent that leaves before anything of it ran is "not exercised" in the turn cycle, never "completed"', () => {
    const wisp = compileCard({ name: 'Smoke Wisp', layout: 'normal', type_line: 'Creature — Spirit', oracle_text: 'Flying', mana_cost: '{1}', power: '0', toughness: '0', colors: [], keywords: ['Flying'] } as unknown as OracleCard);
    const r = smokeCard(wisp);
    expect(r.leftEarly).toEqual(['turn cycle']);
    expect(r.failures.filter((f) => f.kind !== 'stuck')).toEqual([]);
  });
});

type NonPriority = Exclude<Decision, { kind: 'priority' }>;
const base = { id: 'd1', player: 'p1', prompt: 'test' } as const;

describe('WP25 smoke: decision policy', { timeout: 60_000 }, () => {
  const ctx = { cardName: 'Sample Card', attacker: 'o9' };
  it('answers within the bounds every decision states', () => {
    const t = answerFor({ ...base, kind: 'chooseTargets', targetText: 'target creature', objects: ['o1', 'o2'], players: ['p2'], min: 1, max: 2 } as NonPriority, ctx);
    expect(t).toEqual({ kind: 'chooseTargets', targets: [{ kind: 'object', id: 'o1' }] });
    const up = answerFor({ ...base, kind: 'chooseObjects', options: ['o1', 'o2', 'o3'], min: 0, max: 3 } as NonPriority, ctx);
    expect(up).toEqual({ kind: 'chooseObjects', ids: ['o1'] });
    const div = answerFor({ ...base, kind: 'chooseDivision', what: 'damage', total: 5, targets: [{ id: 'o1', label: 'a' }, { id: 'p2', label: 'b' }] } as NonPriority, ctx);
    expect(div).toEqual({ kind: 'chooseDivision', amounts: [4, 1] });
    const dmg = answerFor({ ...base, kind: 'assignDamage', attacker: 'o9', amount: 6, canTrample: true, recipients: [{ id: 'o1', lethal: 2 }, { id: 'p2', lethal: 0, trampleTarget: true }] } as NonPriority, ctx);
    expect(dmg).toEqual({ kind: 'assignDamage', amounts: [{ id: 'o1', amount: 2 }, { id: 'p2', amount: 4 }] });
    const att = answerFor({ ...base, kind: 'declareAttackers', candidates: [{ id: 'o8', defenders: ['p2'] }, { id: 'o9', defenders: ['p2'] }, { id: 'o7', defenders: ['p2'], mustAttack: true }] } as NonPriority, ctx);
    expect(att).toEqual({ kind: 'declareAttackers', attacks: [{ attacker: 'o9', defender: 'p2' }, { attacker: 'o7', defender: 'p2' }] });
    expect(answerFor({ ...base, kind: 'chooseNumber', min: 0, max: 10 } as NonPriority, ctx)).toEqual({ kind: 'chooseNumber', n: 2 });
    expect(answerFor({ ...base, kind: 'chooseOption', options: [{ id: 'a', label: 'a', disabled: 'no' }, { id: 'b', label: 'b' }], min: 1, max: 1 } as NonPriority, ctx)).toEqual({ kind: 'chooseOption', ids: ['b'] });
    expect(answerFor({ ...base, kind: 'chooseName', what: 'cardName' } as NonPriority, ctx)).toEqual({ kind: 'chooseName', name: 'Sample Card' });
    expect(answerFor({ ...base, kind: 'yesNo' } as NonPriority, ctx)).toEqual({ kind: 'yesNo', yes: true });
  });
});

describe('WP25 smoke: generated board', { timeout: 60_000 }, () => {
  it('uses only synthetic filler (design 6.10) and puts the card in hand and on the battlefield, in the first main phase with p1 to act', () => {
    expect(FILLER_CARDS.every((c) => c.name.startsWith('Smoke '))).toBe(true);
    const bolt = fixtureRuns().find((r) => r.card.name === 'Lightning Bolt')!.def!;
    const b = makeBoard(bolt, { inHand: true, onBattlefield: false });
    expect(b.state.turn.step).toBe('main1');
    expect(b.state.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(b.state.zones.hand['p1']).toContain(b.hand);
    expect(b.state.zones.battlefield.filter((id) => b.state.objects[id]!.controller === 'p2').length).toBeGreaterThan(5);
    expect(legalActions(b.state, 'p1').some((l) => l.kind === 'cast' && l.object === b.hand)).toBe(true);
    expect(fillerDefinitions().every((d) => d.automation.level === 'full')).toBe(true);
    expect(invariantProblems(b.state)).toEqual([]);
  });
  it('the invariant check finds a zone entry without an object and an object listed in two zones', () => {
    const bolt = fixtureRuns().find((r) => r.card.name === 'Lightning Bolt')!.def!;
    const s: GameState = structuredClone(makeBoard(bolt, { inHand: true, onBattlefield: false }).state);
    s.zones.battlefield.push('o-missing');
    s.zones.exile.push(s.zones.battlefield[0]!);
    expect(invariantProblems(s).length).toBeGreaterThanOrEqual(2);
  });
});

describe('WP25 smoke: the fixture set (G11)', { timeout: 60_000 }, () => {
  it('every automated ability of every fixture card runs without EngineBug, exception, broken state or a backstop on a full card', () => {
    const runs = fixtureRuns();
    const candidates = runs.filter((r) => r.def && isSmokeCandidate(r.def));
    const results = candidates.map((r) => smokeCard(r.def!));
    const s = summarize(results, runs.length);
    expect(s.candidates).toBeGreaterThan(50);
    expect(s.failures.filter((f) => f.kind !== 'stuck'), formatSmoke(s).join('\n')).toEqual([]);
    expect(s.resolved.spell).toBeGreaterThan(20);
    expect(s.resolved.triggered).toBeGreaterThan(0);
    expect(s.completed).toBe(s.tried - s.refused - s.byKind.stuck);
    // std-ry6: 600 s (was 300 s): the fixture set grew past 1,600 cards with card wave 2 and the run took 310-330 s at ~1,490 on a 4-CPU cloud machine (std-rw9 raised the
    // mutation budgets for the same reason); the same G11 check runs inside the fixture gate
  }, 600_000);
});

describe('WP25 smoke: the harness catches broken abilities', { timeout: 60_000 }, () => {
  const bolt = (): CardDef => fixtureRuns().find((r) => r.card.name === 'Lightning Bolt')!.def!;
  const withStep = (step: unknown): CardDef => {
    const def = bolt();
    const a = def.faces[0]!.abilities[0] as AbilityDef & { effect: { steps: unknown[] } };
    return { ...def, faces: [{ ...def.faces[0]!, abilities: [{ ...a, effect: { ...a.effect, steps: [step] } } as AbilityDef] }] };
  };
  it('a name that was never bound is an EngineBug (design 3.1 rule 6)', () => {
    const r = smokeCard(withStep({ op: 'damage', source: { ref: 'bound', name: 'ghost' }, to: { ref: 'target', id: 't0' }, amount: 3 }));
    expect(r.failures.map((f) => f.kind)).toContain('EngineBug');
  });
  it('an op without a handler on a card classified full raises the run-time backstop, which the smoke test reports (G11)', () => {
    const r = smokeCard(withStep({ op: 'frobnicate' }));
    expect(r.failures.map((f) => f.kind)).toEqual(['unexpected-manual']);
  });
});
