/**
 * WP10, effects/handlers/control.ts and choose.ts: `if`, `let`, `repeat`, `chooseValue` (CR 608.2d, 607.2d), random choices through the game's RNG, the
 * history brought up to date before a `happened` condition is evaluated mid-resolution (W1 open item a), and the capabilities the package registers.
 */
import { describe, expect, it } from 'vitest';
import type { EffectStep, GameState } from '../../../src/index';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { CONTROL_HANDLERS } from '../../../src/effects/handlers/control';
import { OP_HANDLERS } from '../../../src/effects/handlers';
import { flattenProgram, mentionsHistory } from '../../../src/effects/run';
import { effectivePrograms } from '../../../src/actions/announce';
import { seedRng } from '../../../src/rng';
import { act, answer, byHand, castAuto, draw1, drainManual, find, instant, mark, passBoth, pendingOf, scenario, synth, withFakes } from './helpers';

const cast = (s: GameState, name: string): GameState => passBoth(castAuto(s, name));
const run = (steps: EffectStep[], cards: string[] = [], zones: Parameters<typeof scenario>[1] = {}): GameState =>
  cast(scenario(cards, { ...zones, p1: { ...(zones.p1 ?? {}), hand: [...(zones.p1?.hand ?? []), 'Test Steps'] }, defs: [instant('Test Steps', { steps }), ...(zones.defs ?? [])] }), 'Test Steps');

describe('if, let, repeat (CR 608.2c, 608.2h)', () => {
  it('`if`: the condition picks the branch', () => {
    const exists: EffectStep = { op: 'if', cond: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'] } } }, then: [mark('a creature')], else: [mark('no creature')] };
    expect(pendingOf(run([exists]))).toBe('p1 manual: no creature');
    expect(pendingOf(run([exists], ['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } }))).toBe('p1 manual: a creature');
  });

  it('`let` fixes a value once; `repeat` reads its count once', () => {
    const steps: EffectStep[] = [
      { op: 'let', name: 'n', value: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'] } } } },
      { op: 'repeat', times: { q: 'var', name: 'n' }, do: [mark('again')] },
    ];
    const { seen } = drainManual(run(steps, ['Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Grizzly Bears', 'Hill Giant'] } }));
    expect(seen).toEqual(['again', 'again']);
  });

  it('a value that fails to determine (CR 608.2b): `let` stores it as undetermined and the `repeat` that reads it does nothing', () => {
    const steps: EffectStep[] = [
      { op: 'let', name: 'p', value: { q: 'stat', stat: 'power', of: { ref: 'bound', name: 'nothing' } } },
      { op: 'repeat', times: { q: 'var', name: 'p' }, do: [mark('never')] },
      mark('end'),
    ];
    const chooseNothing: EffectStep = { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { types: ['Creature'] } }, min: 0, max: 1, as: 'nothing' };
    const { seen } = drainManual(run([chooseNothing, ...steps]));
    expect(seen).toEqual(['end']);
  });
});

describe('chooseValue (CR 608.2d; a linked ability remembers the choice, CR 607.2d)', () => {
  it('a color chosen by an activated ability is remembered by its source under the link', () => {
    const totem = synth({ name: 'Test Totem', cost: '{1}', type: 'Artifact', abilities: [{
      kind: 'activated', text: '{0}: Choose a color.', cost: {}, effect: { targets: [], steps: [{ op: 'chooseValue', who: { ref: 'you' }, what: 'color', as: 'c', link: 'color' }] },
    }] });
    let s = scenario([], { p1: { battlefield: ['Test Totem'] }, defs: [totem] });
    const id = find(s, 'Test Totem', 'battlefield');
    s = passBoth(act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' }));
    expect(s.pending).toMatchObject({ kind: 'chooseColor', player: 'p1', options: ['W', 'U', 'B', 'R', 'G'], rules: ['CR 608.2d', 'CR 607.2d'] });
    s = answer(s, { kind: 'chooseColor', color: 'R' });
    expect(s.objects[id]!.links).toEqual({ color: { values: ['R'] } });
  });

  it('a chosen number is remembered by its source under the link (CR 607.2d); it is not written to `vars`, which only `let` sets', () => {
    const dial = synth({ name: 'Test Dial', cost: '{1}', type: 'Artifact', abilities: [{
      kind: 'activated', text: '{0}: Choose a number from 0 to 3.', cost: {}, effect: { targets: [], steps: [{ op: 'chooseValue', who: { ref: 'you' }, what: 'number', min: 0, max: 3, as: 'n', link: 'number' }] },
    }] });
    let s = scenario([], { p1: { battlefield: ['Test Dial'] }, defs: [dial] });
    const id = find(s, 'Test Dial', 'battlefield');
    s = passBoth(act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' }));
    expect(s.pending).toMatchObject({ kind: 'chooseNumber', min: 0, max: 3 });
    s = answer(s, { kind: 'chooseNumber', n: 2 });
    expect(s.objects[id]!.links).toEqual({ number: { values: ['2'] } });
  });

  it('a creature type is named from the closed list of CR 205.3m', () => {
    const s = run([{ op: 'chooseValue', who: { ref: 'you' }, what: 'creatureType', as: 't' }]);
    expect(s.pending).toMatchObject({ kind: 'chooseName', what: 'creatureType' });
    if (s.pending?.kind !== 'chooseName') throw new Error('expected chooseName');
    expect(s.pending.options).toContain('Goblin');
    expect(s.pending.options).not.toContain('Forest');
  });

  it('"choose an opponent" in a two-player game needs no question; the binding names the player', () => {
    const s = run([{ op: 'chooseValue', who: { ref: 'you' }, what: 'opponent', as: 'opp' }, mark('after')]);
    expect(s.pending).toMatchObject({ kind: 'manualResolve', bound: [{ name: 'opp', objects: ['Bob'] }] });
  });

  it('"choose one of these" with no option listed is resolved by hand, never guessed', () => {
    const s = run([{ op: 'chooseValue', who: { ref: 'you' }, what: 'option', as: 'o', span: 'Choose one of the listed things.' }]);
    expect(s.pending).toMatchObject({ kind: 'manualResolve', text: 'Choose one of the listed things.' });
  });
});

describe('random choices use the game\'s RNG (design 8.8 rule 2)', () => {
  /** The random pick is exiled (fake `move`), so the card it chose is observable by id. */
  const exileAtRandom = (): EffectStep[] => [
    { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { zone: 'hand', controller: 'opponent' } }, min: 1, max: 1, random: true, as: 'card' },
    { op: 'move', what: { ref: 'bound', name: 'card' }, to: { zone: 'exile' } },
    mark('done'),
  ];
  const cards = ['Grizzly Bears', 'Hill Giant', 'Island', 'Mountain'];
  /** Cast the spell with the game's RNG seeded by `seed`; returns the RNG before resolution, the final state and the name of the card picked. */
  const pickWith = (seed: string): { before: GameState['rng']; s: GameState; picked: string } => withFakes(() => {
    const s0 = scenario(cards, { p1: { hand: ['Test Steps'] }, p2: { hand: [...cards] }, defs: [instant('Test Steps', { steps: exileAtRandom() })] });
    s0.rng = seedRng(seed);
    const before = [...s0.rng] as GameState['rng'];
    const s = cast(s0, 'Test Steps');
    const exiled = s.zones.exile.map((id) => s.objects[id]!.defId);
    expect(exiled).toHaveLength(1);
    return { before, s, picked: exiled[0]! };
  });

  it('the same game picks the same card, without a question, and the pick consumes the RNG in the state', () => {
    const a = pickWith('seed-a');
    const b = pickWith('seed-a');
    expect(pendingOf(a.s)).toBe('p1 manual: done');
    expect(a.picked).toBe(b.picked);
    expect(cards).toContain(a.picked);
    expect(a.s.rng).not.toEqual(a.before);
  });

  it('a different seed can pick a different card (the pick reads the state RNG, nothing else)', () => {
    const picks = new Set(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'].map((seed) => pickWith(seed).picked));
    expect(picks.size).toBeGreaterThan(1);
  });
});

describe('the history is brought up to date before a history condition is evaluated mid-resolution (triggers/stack.ts#syncHistory)', () => {
  it('"if you drew a card this turn" sees the card this very resolution drew (turn 1: the starting player skipped the draw, CR 103.8a)', () => withFakes(() => {
    const ifDrew: EffectStep = { op: 'if', cond: { cond: 'happened', event: { ev: 'draw', player: 'you' }, scope: 'turn' }, then: [mark('drew')], else: [mark('did not draw')] };
    expect(pendingOf(run([ifDrew]))).toBe('p1 manual: did not draw');
    expect(pendingOf(run([draw1(), ifDrew]))).toBe('p1 manual: drew');
  }));

  it('mentionsHistory finds the history nodes: happened, happenedCount and the history filter fields', () => {
    expect(mentionsHistory({ cond: 'happened', event: { ev: 'draw' }, scope: 'turn' })).toBe(true);
    expect(mentionsHistory({ op: 'repeat', times: { q: 'happenedCount', event: { ev: 'draw' }, scope: 'turn' }, do: [] })).toBe(true);
    expect(mentionsHistory({ op: 'if', cond: { cond: 'exists', of: { ref: 'each', filter: { enteredThisTurn: true } } }, then: [] })).toBe(true);
    expect(mentionsHistory({ op: 'if', cond: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'] } } }, then: [] })).toBe(false);
  });
});

describe('the flattened program has the targets in the order announcement stored them (StackInfo.targets[i] is targets[i])', () => {
  it('modes chosen out of order: the same order as actions/announce.ts#effectivePrograms', () => {
    const t = (id: string) => ({ id, kind: 'player' as const, min: 1, max: 1, text: id });
    const program = {
      targets: [t('own')], steps: [],
      modes: { min: 2, max: 3, options: [{ text: 'a', program: { targets: [t('a')], steps: [] } }, { text: 'b', program: { targets: [t('b')], steps: [] } }, { text: 'c', program: { targets: [t('c')], steps: [] } }] },
    };
    const flat = flattenProgram(program, [2, 0], 'x', new Map());
    expect(flat.targets.map((x) => x.id)).toEqual(effectivePrograms([program], [2, 0]).flatMap((p) => p.targets).map((x) => x.id));
    expect(flat.targets.map((x) => x.id)).toEqual(['a', 'c', 'own']);
  });
});

describe('capabilities (design 5.2): WP10 registers its control ops', () => {
  it('op:<op> for each control op (handler and renderer); any other op only with its handler package (WP12-WP15)', () => {
    const ops = ['chooseObjects', 'chooseValue', 'forEach', 'if', 'let', 'manual', 'may', 'pay', 'repeat'];
    expect(Object.keys(CONTROL_HANDLERS).sort()).toEqual(ops);
    for (const op of ops) expect(ENGINE_CAPABILITIES.has(`op:${op}`), op).toBe(true);
    // an op value form (`op:<op>.<form>`, M6-2's copy forms, M6-3's changeFace forms) is registered by its op's handler module
    for (const c of ENGINE_CAPABILITIES) if (c.startsWith('op:')) expect(Object.hasOwn(OP_HANDLERS, c.slice(3).split('.')[0]!), c).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:manual.reminder')).toBe(false); // the chip is made, but nothing ends it yet (WP15)
  });
});

describe('a step after a manual one sees the state the players left (design 8.9)', () => {
  it('the players exile the creature by hand; a later `if` sees it gone', () => {
    const steps: EffectStep[] = [
      mark('Exile a creature.'),
      { op: 'if', cond: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'] } } }, then: [mark('still there')], else: [mark('gone')] },
    ];
    let s = run(steps, ['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    s = byHand(s, [{ op: 'move', object: find(s, 'Grizzly Bears', 'battlefield'), to: 'exile' }]);
    expect(pendingOf(s)).toBe('p1 manual: gone');
  });
});
