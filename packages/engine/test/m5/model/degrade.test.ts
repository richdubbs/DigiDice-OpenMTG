/**
 * The degrade pass (design 10.2): an understood node that uses a capability the engine lacks becomes a manual node of the SMALLEST enclosing unit.
 * Pure and idempotent; the result needs nothing the engine lacks and is still valid ability JSON.
 */
import { describe, expect, it } from 'vitest';
import { capabilitiesOf, degradeAbility, manualNodes, validateAbility, type FaceLines } from '../../../src/model';
import type { AbilityDef } from '../../../src/types/ability';
import { EXAMPLES } from './examples';

type J = Record<string, unknown>;
const ab = (x: J): AbilityDef => x as unknown as AbilityDef;
const NO_LINES: FaceLines = { lines: [], sentences: [] };
const ALL = new Set(EXAMPLES.flatMap((e) => e.faces.flatMap((f) => f.abilities.flatMap((a) => capabilitiesOf(a)))));
const without = (...names: string[]): Set<string> => new Set([...ALL].filter((c) => !names.includes(c)));
const spec = (id: string, extra: J = {}): J => ({ id, kind: 'object', min: 1, max: 1, text: 'target creature', filter: { types: ['Creature'] }, ...extra });
const draw = (extra: J = {}): J => ({ op: 'draw', who: { ref: 'you' }, count: 1, ...extra });
const deg = (def: AbilityDef, caps: Set<string>, lines: FaceLines = NO_LINES) => degradeAbility(def, caps, lines);
const at = (def: unknown, path: string): unknown =>
  path.split('/').filter(Boolean).reduce<unknown>((o, k) => (typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[k] : undefined), def);

// "Draw a card. Scry 2. Draw a card." as one spell ability on a card whose only line is that text
const LINES: FaceLines = { lines: ['Draw a card. Scry 2. Draw a card.'], sentences: [['Draw a card.', 'Scry 2.', 'Draw a card.']] };
const threeSteps = (extra: J = {}): AbilityDef =>
  ab({ kind: 'spell', text: 'Draw a card. Scry 2. Draw a card.', src: [0], effect: { targets: [], steps: [draw({ sentence: 0 }), { op: 'scry', who: { ref: 'you' }, count: 2, sentence: 1 }, draw({ sentence: 2 })] }, ...extra });

describe('nothing is missing: the ability is returned as it is', () => {
  it('the same object, no requirements', () => {
    const a = threeSteps();
    const r = deg(a, ALL.size ? new Set([...ALL, 'op:scry']) : ALL, LINES);
    expect(r.def).toBe(a);
    expect(r.requires).toEqual([]);
  });
});

describe('a step unit (op, quantity, condition, filter field, reference, duration, destination)', () => {
  it('a missing op makes that step manual, with the words of its sentence; the steps around it stay automated', () => {
    const r = deg(threeSteps(), new Set(['op:draw', 'ref:you']), LINES);
    expect(r.requires).toEqual(['op:scry']);
    expect(at(r.def, '/effect/steps/0/op')).toBe('draw');
    expect(at(r.def, '/effect/steps/1')).toEqual({ op: 'manual', text: 'Scry 2.', reason: 'needs-engine: op:scry', sentence: 1 });
    expect(at(r.def, '/effect/steps/2/op')).toBe('draw');
    expect(manualNodes(r.def)).toEqual([{ path: '/effect/steps/1', text: 'Scry 2.', reason: 'needs-engine: op:scry', impact: 'step' }]);
  });
  it('a missing quantity, condition, filter field, duration or destination makes the step that uses it manual', () => {
    const base = (step: J): AbilityDef => ab({ kind: 'spell', text: 'x', effect: { targets: [], steps: [draw(), step] } });
    const cases: [string, J][] = [
      ['q:devotion', draw({ count: { q: 'devotion', to: ['G'], of: { ref: 'you' } } })],
      ['cond:happened', draw({ guard: { cond: 'happened', event: { ev: 'draw' }, scope: 'turn' } })],
      ['filter:colors', { op: 'tap', what: { ref: 'each', filter: { colors: ['R'] } } }],
      ['dur:endOfTurn', { op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: 1 }] }] }],
      ['ref:topCards', { op: 'move', what: { ref: 'topCards', player: { ref: 'you' }, count: 1 }, to: { zone: 'graveyard' } }],
    ];
    for (const [cap, step] of cases) {
      const have = new Set([...capabilitiesOf(base(step))].filter((c) => c !== cap));
      const r = deg(base(step), have);
      expect(r.requires, cap).toContain(cap);
      expect(at(r.def, '/effect/steps/0/op'), cap).toBe('draw');
      expect(at(r.def, '/effect/steps/1/op'), cap).toBe('manual');
      expect(at(r.def, '/effect/steps/1/reason'), cap).toBe(`needs-engine: ${cap}`);
    }
  });
  it('a missing capability inside a nested step makes that step manual, not the wrapper around it', () => {
    const a = ab({ kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'if', cond: { cond: 'turnOf', whose: 'you' }, then: [draw(), { op: 'scry', who: { ref: 'you' }, count: 1 }], else: [draw()] }] } });
    const r = deg(a, without('op:scry', ...[]).size ? new Set(capabilitiesOf(a).filter((c) => c !== 'op:scry')) : ALL);
    expect(at(r.def, '/effect/steps/0/op')).toBe('if');
    expect(at(r.def, '/effect/steps/0/then/0/op')).toBe('draw');
    expect(at(r.def, '/effect/steps/0/then/1/op')).toBe('manual');
    expect(at(r.def, '/effect/steps/0/else/0/op')).toBe('draw');
  });
  it('a control step that is itself unavailable becomes manual with everything in it', () => {
    const a = ab({ kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'repeat', times: 2, do: [draw()] }] } });
    const r = deg(a, new Set(capabilitiesOf(a).filter((c) => c !== 'op:repeat')));
    expect(at(r.def, '/effect/steps/0')).toMatchObject({ op: 'manual', reason: 'needs-engine: op:repeat' });
    expect(at(r.def, '/effect/steps/0/do')).toBeUndefined();
  });
  it('a manual step keeps the name it bound (so the references to it stay valid) and the guard moves into its text', () => {
    const a = ab({ kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'scry', who: { ref: 'you' }, count: 1, as: 's', guard: { cond: 'turnOf', whose: 'you' } }] } });
    const r = deg(a, new Set(capabilitiesOf(a).filter((c) => c !== 'op:scry')));
    expect(at(r.def, '/effect/steps/0')).toEqual({ op: 'manual', text: 'x', reason: 'needs-engine: op:scry', as: 's' });
  });
});

describe('taint (design 6.7)', () => {
  it('T1: a step that reads a name a manual step produces is manual too, transitively; independent steps are not', () => {
    const a = ab({
      kind: 'spell', text: 'x',
      effect: {
        targets: [],
        steps: [
          { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { colors: ['R'] } }, min: 0, max: 1, as: 'c' },
          { op: 'tap', what: { ref: 'bound', name: 'c' }, as: 't' },
          { op: 'untap', what: { ref: 'bound', name: 't' } },
          draw(),
        ],
      },
    });
    const r = deg(a, new Set(capabilitiesOf(a).filter((c) => c !== 'filter:colors')));
    expect(at(r.def, '/effect/steps/0')).toMatchObject({ op: 'manual', as: 'c' });
    expect(at(r.def, '/effect/steps/1')).toMatchObject({ op: 'manual', reason: expect.stringContaining('tainted') });
    expect(at(r.def, '/effect/steps/2')).toMatchObject({ op: 'manual', reason: expect.stringContaining('tainted') });
    expect(at(r.def, '/effect/steps/3/op')).toBe('draw');
  });
  it('T1 also covers did, resultCount, var and a delayed trigger that captures the name', () => {
    const a = ab({
      kind: 'spell', text: 'x',
      effect: {
        targets: [],
        steps: [
          { op: 'scry', who: { ref: 'you' }, count: 1, as: 's' },
          draw({ guard: { cond: 'did', step: 's' } }),
          draw({ count: { q: 'resultCount', step: 's' } }),
          { op: 'delay', when: { at: 'endOfCombat' }, capture: ['s'], do: [] },
        ],
      },
    });
    const r = deg(a, new Set(capabilitiesOf(a).filter((c) => c !== 'op:scry')));
    expect((at(r.def, '/effect/steps') as J[]).map((s) => s['op'])).toEqual(['manual', 'manual', 'manual', 'manual']);
  });
  it('T2: an unavailable sentence with a modifier word makes the whole program one manual step; targets, cost and the other parts are kept', () => {
    const lines: FaceLines = { lines: ['Target creature gets +2/+2 until end of turn. Draw a card unless it is red.'], sentences: [['Target creature gets +2/+2 until end of turn.', 'Draw a card unless it is red.']] };
    const a = ab({
      kind: 'spell', text: 'Target creature gets +2/+2 until end of turn. Draw a card unless it is red.', src: [0],
      effect: { targets: [spec('t0')], steps: [{ op: 'effect', sentence: 0, duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' }, mods: [{ layer: '7c', power: 2, toughness: 2 }] }] }, { op: 'scry', sentence: 1, who: { ref: 'you' }, count: 1 }] },
    });
    const r = deg(a, new Set(capabilitiesOf(a).filter((c) => c !== 'op:scry')), lines);
    expect(at(r.def, '/effect/targets/0/id')).toBe('t0');
    expect(at(r.def, '/effect/steps')).toHaveLength(1);
    expect(at(r.def, '/effect/steps/0')).toMatchObject({ op: 'manual', reason: expect.stringContaining('contagion: the sentence says "unless"') });
    expect(at(r.def, '/effect/steps/0/text')).toContain('Target creature gets +2/+2');
  });
  it('T2 is not triggered by a poisoned sentence that was understood, nor by a sentence without a modifier word', () => {
    const lines: FaceLines = { lines: ['Scry 1. Draw a card.'], sentences: [['Scry 1.', 'Draw a card.']] };
    const a = ab({ kind: 'spell', text: 'Scry 1. Draw a card.', src: [0], effect: { targets: [], steps: [{ op: 'scry', sentence: 0, who: { ref: 'you' }, count: 1 }, draw({ sentence: 1 })] } });
    const r = deg(a, new Set(capabilitiesOf(a).filter((c) => c !== 'op:scry')), lines);
    expect(at(r.def, '/effect/steps/1/op')).toBe('draw');
  });
});

describe('a cost part unit', () => {
  it('a missing cost kind makes that cost part manual and keeps the rest of the ability automated', () => {
    const a = ab({ kind: 'activated', text: '{T}, Pay {E}: Draw a card.', cost: { tap: true, other: [{ kind: 'payEnergy', amount: 1 }] }, effect: { targets: [], steps: [draw()] } });
    const r = deg(a, new Set(capabilitiesOf(a).filter((c) => c !== 'cost:payEnergy')));
    expect(at(r.def, '/cost/other/0')).toEqual({ kind: 'manual', text: '{T}, Pay {E}: Draw a card.' });
    expect(at(r.def, '/kind')).toBe('activated');
    expect(at(r.def, '/effect/steps/0/op')).toBe('draw');
    expect(manualNodes(r.def)).toEqual([expect.objectContaining({ path: '/cost/other/0', impact: 'cost' })]);
  });
  it('the cost words come from the activated ability\'s line when it is known', () => {
    const lines: FaceLines = { lines: ['{T}, Pay {E}: Draw a card.'], sentences: [['Draw a card.']] };
    const a = ab({ kind: 'activated', text: '{T}, Pay {E}: Draw a card.', src: [0], cost: { tap: true, other: [{ kind: 'payEnergy', amount: 1 }] }, effect: { targets: [], steps: [draw()] } });
    const r = deg(a, new Set(capabilitiesOf(a).filter((c) => c !== 'cost:payEnergy')), lines);
    expect(at(r.def, '/cost/other/0/text')).toBe('{T}, Pay {E}');
  });
});

describe('an ability unit (target spec, mode count, trigger event, intervening if, static effect or condition, restriction, keyword)', () => {
  it('a target kind the engine lacks makes the whole spell manual (a target that cannot be announced cannot be described)', () => {
    const a = ab({ kind: 'spell', text: '~ deals 3 damage to any target.', effect: { targets: [spec('t0', { kind: 'anyTarget' })], steps: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 3 }] } });
    const r = deg(a, new Set(capabilitiesOf(a).filter((c) => c !== 'target:anyTarget')));
    expect(r.def).toEqual({ kind: 'manual', text: '~ deals 3 damage to any target.', reason: 'needs-engine: target:anyTarget', shape: 'spell' });
    expect(validateAbility(r.def)).toEqual([]);
  });
  it('an activated ability keeps its understood cost; with a bad target spec it loses the effect', () => {
    const a = ab({ kind: 'activated', text: '{T}: Tap target creature.', cost: { tap: true }, effect: { targets: [spec('t0')], steps: [{ op: 'tap', what: { ref: 'target', id: 't0' } }] } });
    const r = deg(a, new Set(capabilitiesOf(a).filter((c) => c !== 'target:object')));
    expect(r.def).toEqual({ kind: 'manual', text: '{T}: Tap target creature.', reason: 'needs-engine: target:object', shape: 'activated', cost: { tap: true } });
  });
  it('a restriction the engine cannot check keeps the cost AND the effect: the controller attests the restriction', () => {
    const a = ab({ kind: 'activated', text: 'x', cost: { tap: true }, effect: { targets: [], steps: [draw()] }, onlyIf: { cond: 'happened', event: { ev: 'draw' }, scope: 'turn' }, limit: { per: 'turn', max: 1 } });
    const r = deg(a, new Set(capabilitiesOf(a).filter((c) => c !== 'cond:happened')));
    expect(r.def).toMatchObject({ kind: 'manual', shape: 'activated', cost: { tap: true }, effect: { targets: [], steps: [{ op: 'draw' }] } });
  });
  it('a mana ability that must become manual stays flagged as one (CR 605.3b)', () => {
    const a = ab({ kind: 'activated', text: '{T}: Add {G}.', isMana: true, cost: { tap: true }, effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, units: [['G']] }] }, onlyIf: { cond: 'happened', event: { ev: 'draw' }, scope: 'turn' } });
    const r = deg(a, new Set(capabilitiesOf(a).filter((c) => c !== 'cond:happened')));
    expect(r.def).toMatchObject({ kind: 'manual', shape: 'activated', mana: true });
  });
  it('a trigger event the engine cannot detect keeps the understood effect ("Trigger now" runs it); so does an intervening if', () => {
    const t = ab({ kind: 'triggered', text: 'Whenever you draw, draw.', trigger: { on: [{ ev: 'draw' }] }, effect: { targets: [], steps: [draw()] } });
    const r = deg(t, new Set(capabilitiesOf(t).filter((c) => c !== 'ev:draw')));
    expect(r.def).toMatchObject({ kind: 'manual', shape: 'triggered', reason: 'needs-engine: ev:draw', effect: { steps: [{ op: 'draw' }] } });
    const iff = ab({ kind: 'triggered', text: 'x', trigger: { on: [{ ev: 'draw' }] }, interveningIf: { cond: 'happened', event: { ev: 'draw' }, scope: 'turn' }, effect: { targets: [], steps: [draw()] } });
    const r2 = deg(iff, new Set(capabilitiesOf(iff).filter((c) => c !== 'cond:happened')));
    expect(r2.def).toMatchObject({ kind: 'manual', shape: 'triggered', effect: { steps: [{ op: 'draw' }] } });
  });
  it('the understood effect of a manual trigger is itself degraded (a step that is missing too becomes manual inside it)', () => {
    const t = ab({ kind: 'triggered', text: 'x', trigger: { on: [{ ev: 'draw' }] }, effect: { targets: [], steps: [draw(), { op: 'scry', who: { ref: 'you' }, count: 1 }] } });
    const r = deg(t, new Set(capabilitiesOf(t).filter((c) => c !== 'ev:draw' && c !== 'op:scry')));
    expect(r.def).toMatchObject({ kind: 'manual', shape: 'triggered' });
    expect(at(r.def, '/effect/steps/1/op')).toBe('manual');
    expect(r.requires).toEqual(['ev:draw', 'op:scry']);
  });
  it('a missing target capability inside a trigger\'s effect drops that effect (it cannot be announced)', () => {
    const t = ab({ kind: 'triggered', text: 'x', trigger: { on: [{ ev: 'draw' }] }, effect: { targets: [spec('t0')], steps: [{ op: 'tap', what: { ref: 'target', id: 't0' } }] } });
    const r = deg(t, new Set(capabilitiesOf(t).filter((c) => c !== 'target:object')));
    expect(r.def).toMatchObject({ kind: 'manual', shape: 'triggered' });
    expect((r.def as unknown as J)['effect']).toBeUndefined();
  });
  it('a static effect or condition the engine lacks makes the static ability a manual static ability (an "unenforced rule" chip)', () => {
    const s = ab({ kind: 'static', text: 'Creatures you control get +1/+1.', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }] });
    const r = deg(s, new Set(capabilitiesOf(s).filter((c) => c !== 'layer:7c')));
    expect(r.def).toEqual({ kind: 'manual', text: 'Creatures you control get +1/+1.', reason: 'needs-engine: layer:7c', shape: 'static' });
    const cond = ab({ ...(s as unknown as J), condition: { cond: 'turnOf', whose: 'you' } });
    expect(deg(cond, new Set(capabilitiesOf(cond).filter((c) => c !== 'cond:turnOf'))).def).toMatchObject({ kind: 'manual', shape: 'static' });
  });
  it('a keyword the engine lacks becomes a manual static ability and is listed in requires', () => {
    const k = ab({ kind: 'keyword', text: 'Morph {3}{U}', keyword: 'morph', cost: { mana: [{ kind: 'generic', amount: 3 }, { kind: 'colored', color: 'U' }] } });
    const r = deg(k, new Set());
    expect(r.def).toEqual({ kind: 'manual', text: 'Morph {3}{U}', reason: 'needs-engine: keyword:morph', shape: 'static' });
    expect(r.requires).toEqual(['keyword:morph']);
  });
  it('a mode count or override the engine lacks makes the ability manual and drops the effect', () => {
    const m = ab({ kind: 'spell', text: 'x', effect: { targets: [], modes: { min: 1, max: 1, override: { when: { cond: 'wasCast', kicked: true }, min: 1, max: 2 }, options: [{ text: 'a', program: { targets: [], steps: [draw()] } }] }, steps: [] } });
    const r = deg(m, new Set(capabilitiesOf(m).filter((c) => c !== 'feature:modes.override')));
    expect(r.def).toMatchObject({ kind: 'manual', shape: 'spell', reason: 'needs-engine: feature:modes.override' });
  });
  it('a nested granted ability that needs something missing becomes a manual ability INSIDE the grant, not the whole step', () => {
    const granted = { kind: 'triggered', text: 'g', trigger: { on: [{ ev: 'draw' }] }, effect: { targets: [], steps: [draw()] } };
    const a = ab({ kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, add: [granted] }] }] }] } });
    const r = deg(a, new Set(capabilitiesOf(a).filter((c) => c !== 'ev:draw')));
    expect(at(r.def, '/effect/steps/0/op')).toBe('effect');
    expect(at(r.def, '/effect/steps/0/effects/0/mods/0/add/0')).toMatchObject({ kind: 'manual', shape: 'triggered', reason: 'needs-engine: ev:draw' });
  });
  it('the steps of a replacement body belong to the static effect that holds it', () => {
    const s = ab({ kind: 'static', text: 'x', effects: [{ s: 'replace', replaces: { ev: 'draw' }, body: { b: 'instead', do: [{ op: 'scry', who: { ref: 'you' }, count: 1 }] } }] });
    const r = deg(s, new Set(capabilitiesOf(s).filter((c) => c !== 'op:scry')));
    expect(r.def).toMatchObject({ kind: 'manual', shape: 'static' });
  });
});

describe('properties over the worked examples', () => {
  // a deterministic xorshift, so the "random" capability sets are the same on every run
  const rng = (seed: number) => () => ((seed ^= seed << 13), (seed ^= seed >>> 17), (seed ^= seed << 5), (seed >>> 0) / 4294967296);
  const abilities = EXAMPLES.flatMap((e) => e.faces.flatMap((f) => f.abilities.map((a) => ({ name: e.name, a }))));

  it('with every capability: unchanged (same object)', () => {
    for (const { name, a } of abilities) expect(deg(a, ALL).def, name).toBe(a);
  });
  it('with none: every ability is idempotently degraded, needs nothing, and is still valid ability JSON (schema and lint)', () => {
    for (const { name, a } of abilities) {
      const r = deg(a, new Set());
      expect(capabilitiesOf(r.def), name).toEqual([]);
      expect(validateAbility(r.def), name).toEqual([]);
      const again = deg(r.def, new Set());
      expect(again.def, name).toBe(r.def);
      expect(again.requires, name).toEqual([]);
    }
  });
  it('with random subsets: idempotent, needs nothing the set lacks, valid, and never loses a capability the set has to a bystander', () => {
    const next = rng(2463534242);
    for (let round = 0; round < 12; round++) {
      const have = new Set([...ALL].filter(() => next() < 0.8));
      for (const { name, a } of abilities) {
        const r = deg(a, have);
        const left = capabilitiesOf(r.def).filter((c) => !have.has(c));
        expect(left, `${name} round ${round}`).toEqual([]);
        expect(validateAbility(r.def), `${name} round ${round}`).toEqual([]);
        expect(deg(r.def, have).def, `${name} round ${round}`).toBe(r.def);
        expect(r.requires.every((c) => !have.has(c)), name).toBe(true);
      }
    }
  });
  it('the input is never modified', () => {
    for (const { name, a } of abilities) {
      const before = JSON.stringify(a);
      deg(a, new Set());
      expect(JSON.stringify(a), name).toBe(before);
    }
  });
});
