/**
 * PUSH1 T1: the keyword actions the T1 templates produce, run through `applyAction`, the parser (synthetic Oracle text compiled by the default pipeline), the
 * interpreter's `action` op and the proposal pipeline: proliferate (CR 701.34a) and bolster (CR 701.39a), the native handlers of
 * effects/handlers/actions-native-counters.ts, and explore (CR 701.44a) and connive (CR 701.50a) with the permanent's controller as the acting player.
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState } from '../../../src/index';
import { compileCard } from '../../../src/index';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { answer, castAuto, find, passBoth, scenario } from '../helpers';

/** A sorcery or creature compiled from synthetic Oracle text by the game's default pipeline (the T1 templates included). */
function compiled(name: string, type: string, text: string, cost = '{1}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as never);
}

const spreader = compiled('Test Spreader', 'Sorcery', 'Proliferate, then you gain 1 life.');
const doubleSpreader = compiled('Test Double Spreader', 'Sorcery', 'Proliferate twice.');
const rally = compiled('Test Rally', 'Sorcery', 'Bolster 3, then you gain 1 life.');
const scout = compiled('Test Scout', 'Sorcery', 'You gain 1 life, then target creature you control explores.');
const schemer = compiled('Test Schemer', 'Sorcery', 'Target creature you control connives.');
const watcher: CardDef = compileCard(
  { name: 'Test Watcher', layout: 'normal', type_line: 'Enchantment', oracle_text: '(synthetic)', mana_cost: '{2}' } as never,
  () => ({ abilities: [{ kind: 'manual', text: 'If you would proliferate, instead proliferate three times.', reason: 'not parsed', shape: 'static' }], unsupported: [] }),
);

/** A manual TRIGGER on proliferating does not change how proliferate is performed (CR 603.2): it is left to its own "Trigger now". */
const listener: CardDef = compileCard(
  { name: 'Test Listener', layout: 'normal', type_line: 'Enchantment', oracle_text: '(synthetic)', mana_cost: '{2}' } as never,
  () => ({ abilities: [{ kind: 'manual', text: 'Whenever you proliferate, you gain 1 life.', reason: 'not parsed', shape: 'triggered' }], unsupported: [] }),
);
/** A manual replacement of exploring ("would explore", CR 614.1a): the explore macro is resolved by hand while it is in play. */
const detour: CardDef = compileCard(
  { name: 'Test Detour', layout: 'normal', type_line: 'Enchantment', oracle_text: '(synthetic)', mana_cost: '{2}' } as never,
  () => ({ abilities: [{ kind: 'manual', text: 'If a creature you control would explore, instead you gain 1 life, then it explores.', reason: 'not parsed', shape: 'static' }], unsupported: [] }),
);

/** The permanent's controller is not the caster (CR 701.44a, 701.50a), and the permanent may be gone (CR 701.44c, 701.50b). */
const wildScout = compiled('Test Wild Scout', 'Sorcery', 'Target creature explores.');
const wildSchemer = compiled('Test Wild Schemer', 'Sorcery', 'Target creature connives.');
const prowler = compiled('Test Prowler', 'Creature — Test', 'When this creature enters, you gain 1 life, then it explores.', '{1}', ['1', '1']);
const plotter = compiled('Test Plotter', 'Creature — Test', 'When this creature enters, you gain 1 life, then it connives.', '{1}', ['1', '1']);
const recall = compiled('Test Recall', 'Instant', 'Return target creature to its owner\'s hand. You gain 1 life.');

const DEFS = [spreader, doubleSpreader, rally, scout, schemer, watcher, listener, detour, wildScout, wildSchemer, prowler, plotter, recall];
const CARDS = ['Forest', 'Plains', 'Grizzly Bears', 'Hill Giant'];
const lands = ['Forest', 'Forest', 'Forest', 'Forest'];

const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const countersOf = (s: GameState, name: string): Record<string, number> => s.objects[find(s, name, 'battlefield')]!.counters;
const poison = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.poison;
const handOf = (s: GameState, p: string): string[] => s.zones.hand[p]!.map((id) => nameOf(s, id)).sort();

describe('PUSH1 T1: the compiled cards are automated (no manual step), and the actions are advertised only because their handlers exist', () => {
  it('proliferate, bolster, explore and connive parse into one action step each', () => {
    for (const [d, action] of [[spreader, 'proliferate'], [rally, 'bolster'], [scout, 'explore'], [schemer, 'connive']] as const) {
      const steps = (d.faces[0]!.abilities[0] as { effect: { steps: { op: string; action?: string }[] } }).effect.steps;
      expect(steps.filter((x) => x.op === 'action'), d.name).toMatchObject([{ op: 'action', action }]);
      expect(JSON.stringify(d.faces[0]!.abilities), d.name).not.toContain('"manual"');
    }
  });
  it('design 5.2: action:proliferate and action:bolster are capabilities (native handlers); so are venture (MX4: effects/handlers/venture.ts, CR 701.49) and the Ring (MX3: test/mx3/ring.test.ts)', () => {
    for (const c of ['action:proliferate', 'action:bolster', 'feature:action.native.proliferate', 'feature:action.native.bolster', 'action:venture', 'action:ringTempts']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
  });
});

describe('CR 701.34a: proliferate', () => {
  const board = (): GameState => scenario(CARDS, {
    defs: DEFS,
    p1: { hand: ['Test Spreader', 'Test Double Spreader'], battlefield: [...lands, { name: 'Grizzly Bears', counters: { '+1/+1': 1, shield: 1 } }, 'Hill Giant'] },
    p2: { battlefield: [{ name: 'Grizzly Bears', counters: { '-1/-1': 1 } }] },
  });
  const withPoison = (s: GameState): GameState => { s.players.find((p) => p.id === 'p2')!.poison = 2; return s; };

  it('offers exactly the permanents and players that have a counter (not Hill Giant, not p1), and gives each chosen one a counter of EACH kind it has', () => {
    const s0 = withPoison(board());
    const asked = passBoth(castAuto(s0, 'Test Spreader'));
    expect(asked.pending).toMatchObject({ kind: 'chooseOption', player: 'p1', min: 0 });
    const options = (asked.pending as unknown as { options: { id: string; label: string }[] }).options;
    expect(options.map((o) => o.label).sort()).toEqual(['Bob (poison)', 'Grizzly Bears (+1/+1, shield)', 'Grizzly Bears (-1/-1)'].sort());
    const mine = options.find((o) => /shield/.test(o.label))!;
    const bob = options.find((o) => /poison/.test(o.label))!;
    const s = answer(asked, { kind: 'chooseOption', ids: [mine.id, bob.id] });
    const bears = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Grizzly Bears');
    const own = bears.find((id) => s.objects[id]!.controller === 'p1')!;
    const theirs = bears.find((id) => s.objects[id]!.controller === 'p2')!;
    expect(s.objects[own]!.counters).toEqual({ '+1/+1': 2, shield: 2 });
    expect(s.objects[theirs]!.counters).toEqual({ '-1/-1': 1 }); // not chosen
    expect(poison(s, 'p2')).toBe(3);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(21); // the next step of the spell ran
  });

  it('choosing nothing is legal (any number, CR 701.34a): nothing changes', () => {
    const asked = passBoth(castAuto(board(), 'Test Spreader'));
    const s = answer(asked, { kind: 'chooseOption', ids: [] });
    expect(countersOf(s, 'Hill Giant')).toEqual({});
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Grizzly Bears').map((id) => s.objects[id]!.counters)).toEqual([{ '+1/+1': 1, shield: 1 }, { '-1/-1': 1 }]);
  });

  it('with no counter anywhere no one is asked', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Spreader'], battlefield: [...lands, 'Hill Giant'] } });
    const s = passBoth(castAuto(s0, 'Test Spreader'));
    expect(s.pending?.kind).toBe('priority');
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(21);
  });

  it('"proliferate twice" is two whole proliferates: the second sees the counters the first gave', () => {
    const asked = passBoth(castAuto(board(), 'Test Double Spreader'));
    const pick = (t: GameState): string => (t.pending as unknown as { options: { id: string; label: string }[] }).options.find((o) => /shield/.test(o.label))!.id;
    const second = answer(asked, { kind: 'chooseOption', ids: [pick(asked)] });
    expect(second.pending).toMatchObject({ kind: 'chooseOption' });
    const s = answer(second, { kind: 'chooseOption', ids: [pick(second)] });
    const own = s.zones.battlefield.find((id) => nameOf(s, id) === 'Grizzly Bears' && s.objects[id]!.controller === 'p1')!;
    expect(s.objects[own]!.counters).toEqual({ '+1/+1': 3, shield: 3 });
  });

  it('design 10: while text the engine does not run mentions proliferating, the action is resolved by hand, never approximately', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Spreader'], battlefield: [...lands, 'Test Watcher', { name: 'Grizzly Bears', counters: { '+1/+1': 1 } }] } });
    const s = passBoth(castAuto(s0, 'Test Spreader'));
    expect(s.pending).toMatchObject({ kind: 'manualResolve', player: 'p1' });
  });

  it('CR 603.2: a manual trigger on proliferating does not make the proliferate itself manual', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Spreader'], battlefield: [...lands, 'Test Listener', { name: 'Grizzly Bears', counters: { '+1/+1': 1 } }] } });
    const asked = passBoth(castAuto(s0, 'Test Spreader'));
    expect(asked.pending).toMatchObject({ kind: 'chooseOption', player: 'p1' });
  });
});

describe('CR 614.1a, design 10: a macro action that manual text replaces ("would explore") is resolved by hand', () => {
  it('explore with a manual "would explore" replacement in play asks the players instead of running the macro', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Scout'], battlefield: [...lands, 'Test Detour', 'Grizzly Bears'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = passBoth(castAuto(s0, 'Test Scout', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }] }));
    expect(s.pending).toMatchObject({ kind: 'manualResolve', player: 'p1' });
    expect(s.objects[bears]!.counters).toEqual({});
  });
});

describe('CR 701.39a: bolster', () => {
  it('the creature with the least toughness gets the counters; no one is asked when it is the only one', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Rally'], battlefield: [...lands, 'Grizzly Bears', 'Hill Giant'] }, p2: { battlefield: [{ name: 'Grizzly Bears', counters: { '-1/-1': 1 } }] } });
    const s = passBoth(castAuto(s0, 'Test Rally'));
    expect(s.pending?.kind).toBe('priority');
    const own = s.zones.battlefield.find((id) => nameOf(s, id) === 'Grizzly Bears' && s.objects[id]!.controller === 'p1')!;
    expect(s.objects[own]!.counters).toEqual({ '+1/+1': 3 });
    expect(countersOf(s, 'Hill Giant')).toEqual({});
  });

  it('toughness is the current one (counters count, CR 613.4c): a 2/2 with two +1/+1 counters is no longer the least', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Rally'], battlefield: [...lands, { name: 'Grizzly Bears', counters: { '+1/+1': 2 } }, 'Hill Giant'] } });
    const s = passBoth(castAuto(s0, 'Test Rally'));
    expect(countersOf(s, 'Hill Giant')).toEqual({ '+1/+1': 3 });
  });

  it('a tie is the controller\'s choice among the tied creatures only', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Rally'], battlefield: [...lands, 'Grizzly Bears', 'Grizzly Bears', 'Hill Giant'] } });
    const asked = passBoth(castAuto(s0, 'Test Rally'));
    expect(asked.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 1, max: 1 });
    const options = (asked.pending as unknown as { options: string[] }).options;
    expect(options.map((id) => nameOf(asked, id))).toEqual(['Grizzly Bears', 'Grizzly Bears']);
    const s = answer(asked, { kind: 'chooseObjects', ids: [options[1]!] });
    expect(s.objects[options[1]!]!.counters).toEqual({ '+1/+1': 3 });
    expect(s.objects[options[0]!]!.counters).toEqual({});
  });

  it('with no creature, nothing happens', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Rally'], battlefield: lands }, p2: { battlefield: ['Grizzly Bears'] } });
    const s = passBoth(castAuto(s0, 'Test Rally'));
    expect(s.pending?.kind).toBe('priority');
    expect(countersOf(s, 'Grizzly Bears')).toEqual({});
  });
});

describe('CR 701.44a, 701.50a: explore and connive act through the permanent\'s controller', () => {
  it('explore: a land on top goes to the controller\'s hand and the creature gets no counter', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Scout'], battlefield: [...lands, 'Grizzly Bears'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const hand = s0.zones.hand['p1']!.length;
    const s = passBoth(castAuto(s0, 'Test Scout', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }] }));
    expect(s.zones.hand['p1']!.length).toBe(hand); // the scout left the hand, the revealed Plains came in
    expect(s.zones.hand['p1']!.map((id) => nameOf(s, id))).toContain('Plains');
    expect(s.objects[bears]!.counters).toEqual({});
  });

  it('connive: the controller draws a card, then discards a card; a nonland card discarded gives a +1/+1 counter', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Schemer', 'Hill Giant'], battlefield: [...lands, 'Grizzly Bears'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const asked = passBoth(castAuto(s0, 'Test Schemer', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }] }));
    expect(asked.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1' });
    const giant = find(asked, 'Hill Giant', 'hand');
    const s = answer(asked, { kind: 'chooseObjects', ids: [giant] });
    expect(s.objects[bears]!.counters).toEqual({ '+1/+1': 1 });
  });

  it('CR 701.44a: an opponent\'s creature explores: its controller (p2), not the caster, reveals and takes the land', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Wild Scout'], battlefield: lands }, p2: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const mine = handOf(s0, 'p1').length;
    const theirs = handOf(s0, 'p2');
    const s = passBoth(castAuto(s0, 'Test Wild Scout', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }] }));
    expect(handOf(s, 'p2')).toEqual([...theirs, 'Plains'].sort());
    expect(handOf(s, 'p1').length).toBe(mine - 1); // only the spell left p1's hand
    expect(s.objects[bears]!.counters).toEqual({});
  });

  it('CR 701.50a: an opponent\'s creature connives: its controller (p2) draws, then p2 chooses the discard', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Wild Schemer'], battlefield: lands }, p2: { hand: ['Hill Giant'], battlefield: ['Grizzly Bears'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const asked = passBoth(castAuto(s0, 'Test Wild Schemer', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] }] }));
    expect(asked.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2' });
    expect(handOf(asked, 'p2')).toEqual(['Hill Giant', 'Plains']);
    const s = answer(asked, { kind: 'chooseObjects', ids: [find(asked, 'Hill Giant', 'hand', 'p2')] });
    expect(s.objects[bears]!.counters).toEqual({ '+1/+1': 1 });
  });

  it('CR 701.44c: a creature that left before its "it explores" trigger resolves explores by last known information; its last controller reveals', () => {
    const s1 = passBoth(castAuto(scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Prowler', 'Test Recall'], battlefield: lands } }), 'Test Prowler'));
    const prowler = find(s1, 'Test Prowler', 'battlefield');
    expect(s1.zones.stack.length, 'the enters trigger waits on the stack').toBe(1);
    const gone = passBoth(castAuto(s1, 'Test Recall', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: prowler }] }] }));
    expect(handOf(gone, 'p1')).toEqual(['Test Prowler']);
    const s = passBoth(gone);
    expect(s.zones.stack).toEqual([]);
    expect(handOf(s, 'p1')).toEqual(['Plains', 'Test Prowler']);
  });

  it('CR 701.50b: a creature that left before its "it connives" trigger resolves connives by last known information; its last controller draws and discards', () => {
    const s1 = passBoth(castAuto(scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Plotter', 'Test Recall'], battlefield: lands } }), 'Test Plotter'));
    const plotter = find(s1, 'Test Plotter', 'battlefield');
    const gone = passBoth(castAuto(s1, 'Test Recall', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: plotter }] }] }));
    const asked = passBoth(gone);
    expect(asked.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1' });
    expect(handOf(asked, 'p1')).toEqual(['Plains', 'Test Plotter']);
  });
});
