/**
 * keywords/actions (design 7.5, WP3): the CR 701 keyword actions that can be written faithfully as macros over the primitive ops. A macro is a pure function
 * from one `{op:'action'}` step to primitive steps; the interpreter runs the primitive form (so the renderer and the gate see it). The actions that cannot be
 * written faithfully are NOT registered (a card using them stays manual), and these tests pin that list too.
 */
import { describe, expect, it } from 'vitest';
import type { EffectStep, KeywordActionName } from '../../../src/index';
import { ACTION_MACROS, UNREGISTERED_ACTIONS } from '../../../src/keywords/actions';
import { NATIVE_ACTIONS } from '../../../src/effects/handlers/actions-native';
import type { ActionStep } from '../../../src/keywords/actions/common';
import { exploreOnce } from '../../../src/keywords/actions/library';

const you = { ref: 'you' } as const;
const step = (action: KeywordActionName, rest: Partial<ActionStep> = {}): ActionStep => ({ op: 'action', action, who: you, ...rest });
const run = (action: KeywordActionName, rest: Partial<ActionStep> = {}): EffectStep[] => {
  const m = ACTION_MACROS[action];
  if (!m?.expand) throw new Error(`no macro ${action}`);
  return m.expand(step(action, rest));
};

/** Every op name in a step tree (then/else/do and nested). */
function ops(steps: readonly EffectStep[], out: string[] = []): string[] {
  for (const s of steps) {
    out.push(s.op);
    for (const key of ['then', 'else', 'do'] as const) {
      const inner = (s as unknown as Record<string, unknown>)[key];
      if (Array.isArray(inner)) ops(inner as EffectStep[], out);
    }
  }
  return out;
}

describe('which actions are macros', () => {
  it('registered: investigate, incubate, populate, amass, explore, connive, adapt, support, doubleCounters, detain; native (WP32): cascade, discover, vote; native (PUSH1 T1): proliferate, bolster; native (FAST5 T37): monstrosity', () => {
    expect(Object.keys(ACTION_MACROS).sort()).toEqual([
      'adapt', 'amass', 'bolster', 'cascade', 'cloak', 'connive', 'detain', 'discover', 'doubleCounters', 'explore', 'incubate', 'investigate', 'learn', 'manifest', 'manifestDread',
      'meld', 'meldPair', 'monstrosity', 'openAttraction' /* FAST5 T38: native, effects/handlers/attraction.ts */, 'populate', 'proliferate', 'ringTempts', 'support', 'venture', 'vote',
      'giveGift', // FAST5X E1: native (effects/handlers/gift.ts), CR 702.174c
      'earthbend', 'empower', 'endure', // FAST5 MX6 (keywords/actions/bending.ts)
      'blight', // FAST5X E9: a macro (keywords/actions/counters.ts), CR 701.68a
      'airbend', // FAST5X E10: native (effects/handlers/airbend.ts), CR 701.65a
      'behold', // FAST5X E11: native (effects/handlers/behold.ts), CR 701.4a
      'suspect', 'collectEvidence', // FAST5X E12 (keywords/actions/evidence.ts): suspect expands to designateObject; collect evidence is native (effects/handlers/evidence.ts)
      'recruit', // FAST5X E18: a macro (keywords/actions/library.ts), reminder text
      'exert', 'forage', // FAST5X E28 (keywords/actions/exert-forage.ts): forage is native (effects/handlers/forage.ts); std-ry8: exert is native too (effects/handlers/exert.ts)
      'renown', // std-ry8: native (effects/handlers/actions-native-counters.ts), the effect of keyword renown's trigger, CR 702.112a
      'goad', // M12-3: native (effects/handlers/goad.ts), CR 701.15a; its requirements in statics/requirements.ts
      'doubleEachKind', // cloud std-spm: native (effects/handlers/actions-native-counters.ts), CR 701.10e
      'anotherOfEachKind', // r5-refs: native (effects/handlers/actions-native-counters.ts), CR 701.34a's "another counter of each kind already there"
      'assimilate', // trek-1: a macro (keywords/actions/assimilate.ts), Star Trek reminder text
    ].sort()); // M6-3: manifest, cloak, manifest dread (native, effects/handlers/face-ops.ts); M6-4: meld (native, effects/handlers/dfc-ops.ts); MX2: meldPair (native, effects/handlers/meld-pair.ts); MX4: venture (native, effects/handlers/venture.ts); FAST5 MX7: learn (native, effects/handlers/learn.ts); MX3: ringTempts (native, effects/handlers/ring.ts); FAST5 T37: monstrosity (native)
  });

  it('not registered on purpose: what the primitive ops cannot say faithfully (a card with them stays manual, never approximately automated), each with its reason', () => {
    for (const name of ['clash', 'doublePT'] as const) { // FAST5X E12: suspect and collectEvidence are registered now; FAST5X E28: exert and forage; M12-3: goad
      expect(ACTION_MACROS[name as KeywordActionName], name).toBeUndefined();
      expect(UNREGISTERED_ACTIONS[name]?.length ?? 0, `${name} needs a reason`).toBeGreaterThan(20);
    }
    for (const name of Object.keys(UNREGISTERED_ACTIONS)) expect(ACTION_MACROS[name as KeywordActionName], `${name} has a reason but is registered`).toBeUndefined();
  });

  it('every macro names itself, cites its CR 701 rule, and either expands or names its native handler (WP32: cascade, discover, vote; effects/handlers/actions-native.ts)', () => {
    const rules: Record<string, string> = {
      investigate: 'CR 701.16', incubate: 'CR 701.53', populate: 'CR 701.36', amass: 'CR 701.47', explore: 'CR 701.44', connive: 'CR 701.50', adapt: 'CR 701.46',
      support: 'CR 701.41', doubleCounters: 'CR 701.10', detain: 'CR 701.35', cascade: 'CR 702.85a', discover: 'CR 701.57a', vote: 'CR 701.38a',
      proliferate: 'CR 701.34a', bolster: 'CR 701.39a', // PUSH1 T1: native (effects/handlers/actions-native-counters.ts)
      manifest: 'CR 701.40a', cloak: 'CR 701.58a', manifestDread: 'CR 701.62a', // M6-3: native (effects/handlers/face-ops.ts)
      meld: 'CR 701.42a', // M6-4: native (effects/handlers/dfc-ops.ts)
      meldPair: 'CR 701.42a', // MX2: native (effects/handlers/meld-pair.ts)
      giveGift: 'CR 702.174c', // FAST5X E1: native (effects/handlers/gift.ts)
      venture: 'CR 701.49', // MX4: native (effects/handlers/venture.ts)
      learn: 'CR 701.48a', // FAST5 MX7: native (effects/handlers/learn.ts)
      ringTempts: 'CR 701.54a', // MX3: native (effects/handlers/ring.ts, core/ring.ts)
      endure: 'CR 701.63', earthbend: 'CR 701.66', empower: 'CR 701.71a', // FAST5 MX6 (empower Jace: CR 701.71a since the 2026-09-25 edition)
      monstrosity: 'CR 701.37a', // FAST5 T37: native (effects/handlers/actions-native-counters.ts)
      doubleEachKind: 'CR 701.10e', // cloud std-spm: native (effects/handlers/actions-native-counters.ts)
      anotherOfEachKind: 'CR 701.34a', // r5-refs: native (effects/handlers/actions-native-counters.ts)
      blight: 'CR 701.68', // FAST5X E9: a macro over chooseObjects and putCounters
      openAttraction: 'CR 701.51a', // FAST5 T38: native (effects/handlers/attraction.ts)
      airbend: 'CR 701.65a', // FAST5X E10: native (effects/handlers/airbend.ts)
      behold: 'CR 701.4a', // FAST5X E11: native (effects/handlers/behold.ts)
      suspect: 'CR 701.60a', collectEvidence: 'CR 701.59a', // FAST5X E12: suspect expands; collect evidence is native (effects/handlers/evidence.ts)
      recruit: 'CR 701.70a', // FAST5X E18 (connive's shape, CR 701.50a)
      exert: 'CR 701.43a', forage: 'CR 701.61a', // FAST5X E28: forage is native (effects/handlers/forage.ts); std-ry8: exert is native (effects/handlers/exert.ts)
      renown: 'CR 702.112a', // std-ry8: native (effects/handlers/actions-native-counters.ts)
      goad: 'CR 701.15a', // M12-3: native (effects/handlers/goad.ts)
      assimilate: 'CR 701 (reminder text)', // trek-1: a macro over move and a layer 4 effect (Star Trek; rule number unverified)
    };
    const native = new Set(['cascade', 'discover', 'vote', 'proliferate', 'bolster', 'manifest', 'cloak', 'manifestDread', 'meld', 'meldPair', 'giveGift', 'venture', 'learn', 'ringTempts', 'monstrosity', 'openAttraction', 'airbend', 'behold', 'collectEvidence', 'forage' /* FAST5X E28 */, 'goad' /* M12-3 */, 'doubleEachKind' /* cloud std-spm */, 'anotherOfEachKind' /* r5-refs */, 'explore' /* std-lci: effects/handlers/explore.ts */, 'exert', 'renown' /* std-ry8 */]);
    for (const [name, m] of Object.entries(ACTION_MACROS)) {
      expect(m.name).toBe(name);
      expect(m.rule).toBe(rules[name]);
      if (native.has(name)) {
        expect(m.expand).toBeUndefined();
        expect(m.native).toBe(name);
        expect(Object.hasOwn(NATIVE_ACTIONS, m.native!)).toBe(true);
      } else {
        expect(typeof m.expand).toBe('function');
        expect(m.native).toBeUndefined();
      }
    }
  });

  it('no macro expands into another action: the output is primitive ops only (design 7.5)', () => {
    const samples: [KeywordActionName, Partial<ActionStep>][] = [
      ['investigate', {}], ['incubate', { n: 2 }], ['populate', {}], ['amass', { n: 2 }], ['connive', {}], ['adapt', { n: 1 }],
      ['support', { subject: { ref: 'target', id: 't0' } }], ['doubleCounters', { subject: { ref: 'self' }, arg: '+1/+1' }], ['detain', { subject: { ref: 'target', id: 't0' } }],
    ];
    for (const [a, rest] of samples) expect(ops(run(a, rest)), a).not.toContain('action');
    expect(ops(exploreOnce(step('explore'))), 'explore').not.toContain('action'); // std-lci: explore is native, its handler runs these steps once per explore
  });
});

describe('CR 701.16: investigate', () => {
  it('creates a Clue token (CR 111.10f); "investigate twice" creates two; the step\'s name goes to the token', () => {
    expect(run('investigate')).toEqual([{ op: 'createToken', who: you, token: { predefined: 'Clue' }, count: 1 }]);
    expect(run('investigate', { n: 2, as: 'clues' })).toEqual([{ op: 'createToken', who: you, token: { predefined: 'Clue' }, count: 2, as: 'clues' }]);
  });
});

describe('CR 701.53: incubate', () => {
  it('creates an Incubator token that enters with N +1/+1 counters', () => {
    expect(run('incubate', { n: 3 })).toEqual([{ op: 'createToken', who: you, token: { predefined: 'Incubator' }, count: 1, counters: [{ kind: '+1/+1', count: 3 }] }]);
  });

  it('without N the players resolve it by hand (never silently skipped)', () => {
    expect(run('incubate')).toEqual([{ op: 'manual', text: 'incubate', reason: 'incubate needs its number N' }]);
  });
});

describe('CR 701.36: populate', () => {
  it('chooses a creature token you control and creates a token that is a copy of it; with none, nothing is chosen and nothing is created', () => {
    const [choose, copy] = run('populate', { as: 'copy' });
    expect(choose).toMatchObject({ op: 'chooseObjects', who: you, min: 1, max: 1, as: '_populate', from: { ref: 'each', filter: { types: ['Creature'], token: true, controller: 'you' } } });
    expect(copy).toEqual({ op: 'copy', what: { ref: 'bound', name: '_populate' }, result: 'token', who: you, as: 'copy' });
  });
});

describe('CR 701.47: amass', () => {
  it('creates a 0/0 black Army only if you control none, chooses an Army, puts N +1/+1 counters on it, and makes it the subtype if it is not (Zombie by default, CR 701.47d)', () => {
    const [make, choose, counters, becomes] = run('amass', { n: 2, as: 'army' }) as Extract<EffectStep, { op: 'if' | 'chooseObjects' | 'putCounters' }>[];
    expect(make).toMatchObject({
      op: 'if',
      cond: { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], subtypes: ['Army'], controller: 'you' } } } },
      then: [{ op: 'createToken', token: { colors: ['B'], types: ['Creature'], subtypes: ['Zombie', 'Army'], power: 0, toughness: 0 }, count: 1 }],
    });
    expect(choose).toMatchObject({ op: 'chooseObjects', who: you, min: 1, max: 1, as: 'army' }); // "the Army you amassed" (CR 701.47c)
    expect(counters).toEqual({ op: 'putCounters', on: { ref: 'bound', name: 'army' }, kind: '+1/+1', count: 2 });
    expect(becomes).toMatchObject({
      op: 'if',
      cond: { cond: 'matches', object: { ref: 'bound', name: 'army' }, filter: { notSubtypes: ['Zombie'] } },
      then: [{ op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: { ref: 'bound', name: 'army' }, mods: [{ layer: 4, subtypes: { add: ['Zombie'] } }] }] }],
    });
  });

  it('amass Orcs: the token and the chosen Army get that subtype', () => {
    const [make] = run('amass', { n: 1, arg: 'Orc' }) as { then: { token: { name?: string; subtypes: string[] } }[] }[];
    expect(make!.then[0]!.token).toMatchObject({ subtypes: ['Orc', 'Army'] });
    expect(make!.then[0]!.token.name, 'no stated name: "Orc Army Token" (CR 111.4)').toBeUndefined();
  });

  it('without N it is manual', () => {
    expect(run('amass')[0]).toMatchObject({ op: 'manual', reason: 'amass needs its number N' });
  });
});

// std-lci: explore is native (effects/handlers/explore.ts reports each explore, CR 701.44b); these are the steps of ONE explore it runs (library.ts#exploreOnce)
describe('CR 701.44: explore', () => {
  it('reveals the top card; a land goes to the hand; otherwise (also with no card, CR 701.44b) +1/+1 counter and the controller may put the card into the graveyard', () => {
    const [reveal, branch] = exploreOnce(step('explore', { subject: { ref: 'bound', name: 'creature' } })) as Extract<EffectStep, { op: 'reveal' | 'if' }>[];
    expect(reveal).toEqual({ op: 'reveal', who: you, what: { ref: 'topCards', player: you, count: 1 }, as: '_explored' });
    const card = { ref: 'bound', name: '_explored' };
    expect(branch).toEqual({
      op: 'if',
      cond: { cond: 'all', of: [{ cond: 'exists', of: card }, { cond: 'matches', object: card, filter: { types: ['Land'] } }] },
      then: [{ op: 'move', what: card, to: { zone: 'hand' } }],
      else: [
        { op: 'putCounters', on: { ref: 'bound', name: 'creature' }, kind: '+1/+1', count: 1 },
        { op: 'may', who: you, do: [{ op: 'move', what: card, to: { zone: 'graveyard' } }], guard: { cond: 'exists', of: card } },
      ],
    });
  });

  it('the exploring permanent defaults to the source; "explore twice" repeats the whole process', () => {
    const once = exploreOnce(step('explore'));
    expect(JSON.stringify(once)).toContain('"on":{"ref":"self"}');
    // the native handler runs the process once per repetition (test/cloud/std-lci: "it explores, then it explores again")
    expect(ACTION_MACROS.explore?.native).toBe('explore');
    expect(Object.hasOwn(NATIVE_ACTIONS, 'explore')).toBe(true);
  });
});

describe('CR 701.50: connive', () => {
  it('draws, discards, then puts a +1/+1 counter for each nonland card discarded this way', () => {
    const [draw, discard, each] = run('connive') as Extract<EffectStep, { op: 'draw' | 'discard' | 'forEach' }>[];
    expect(draw).toEqual({ op: 'draw', who: you, count: 1 });
    expect(discard).toEqual({ op: 'discard', who: you, count: 1, as: '_connived' });
    expect(each).toEqual({
      op: 'forEach',
      over: { ref: 'bound', name: '_connived' },
      as: '_conniveCard',
      do: [{ op: 'if', cond: { cond: 'matches', object: { ref: 'bound', name: '_conniveCard' }, filter: { notTypes: ['Land'] } }, then: [{ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: 1 }] }],
    });
  });

  it('connive N (CR 701.50d) draws and discards N; connive 0 does nothing (CR 701.50e)', () => {
    expect(run('connive', { n: 3 })[0]).toEqual({ op: 'draw', who: you, count: 3 });
    expect(run('connive', { n: 0 })).toEqual([]);
  });
});

describe('CR 701.46: adapt', () => {
  it('puts N +1/+1 counters only if the permanent has none', () => {
    expect(run('adapt', { n: 3 })).toEqual([
      { op: 'if', cond: { cond: 'compare', left: { q: 'counters', on: { ref: 'self' }, kind: '+1/+1' }, op: '==', right: 0 }, then: [{ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: 3 }] },
    ]);
    expect(run('adapt')[0]).toMatchObject({ op: 'manual' });
  });
});

describe('CR 701.41: support', () => {
  it('puts a +1/+1 counter on each of the targets the step names; without them it is manual', () => {
    expect(run('support', { subject: { ref: 'target', id: 't0' } })).toEqual([{ op: 'putCounters', on: { ref: 'target', id: 't0' }, kind: '+1/+1', count: 1 }]);
    expect(run('support')[0]).toMatchObject({ op: 'manual' });
  });
});

describe('CR 701.10e: double the counters', () => {
  it('gives each thing as many counters of the kind as it already has, one at a time (a set is doubled object by object)', () => {
    const each = { ref: 'bound', name: '_double' };
    expect(run('doubleCounters', { subject: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, arg: '+1/+1' })).toEqual([
      {
        op: 'forEach', over: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, as: '_double',
        do: [{ op: 'putCounters', on: each, kind: '+1/+1', count: { q: 'counters', on: each, kind: '+1/+1' } }],
      },
    ]);
    expect(run('doubleCounters', { subject: { ref: 'self' } })[0]).toMatchObject({ op: 'manual' });
  });
});

describe('what every macro keeps of the step it expands', () => {
  it('a guard governs the WHOLE expansion (one `if` step), and sentence and span reach every produced step', () => {
    const guard = { cond: 'did', step: 'paid' } as const;
    const out = run('connive', { guard, sentence: 4, span: 'It connives.' });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ op: 'if', cond: guard, sentence: 4, span: 'It connives.' });
    for (const inner of (out[0] as Extract<EffectStep, { op: 'if' }>).then) expect(inner).toMatchObject({ sentence: 4, span: 'It connives.' });
  });

  it('is pure: the step is not changed, and the same step gives the same steps', () => {
    const s = step('amass', { n: 2, arg: 'Zombie', as: 'army', span: 'Amass Zombies 2.' });
    const before = JSON.stringify(s);
    const a = ACTION_MACROS.amass!.expand!(s);
    expect(JSON.stringify(s)).toBe(before);
    expect(ACTION_MACROS.amass!.expand!(s)).toEqual(a);
  });
});
