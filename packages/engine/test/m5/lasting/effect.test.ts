/**
 * The `effect` op (CR 611.2): resolved continuous effects with their values and identities fixed as they are created (design 9.1, CR 611.2c-d), and the
 * section 13 cards that use it (Giant Growth, Aspect of Hydra, History of Benalia III, Oko's +1, Mutavault). Cast and resolved with real actions; the spine
 * (WP10), the pipeline (WP11) and the manual prompt are the fakes of neighbors.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../../../src/core/game';
import { moveObject } from '../../../src/core/zones';
import type { ContinuousEffectRec, Duration, GameState, StaticEffect } from '../../../src/index';
import { getChars } from '../../../src/index';
import { ENGINE_CAPABILITIES } from '../../../src/model';
import { advanceTo, find, passBoth, scenario } from '../helpers';
import { neighbors } from './neighbors';
import { activate, cast, castAndResolve, creatureTarget, example, instant, objectTarget, permanent, playerTarget, programOf, pt, setup, targets, withExamples } from './support';

vi.mock('../../../src/effects/propose', async (o) => (await import('./neighbors')).proposeMock(await o()));
vi.mock('../../../src/effects/manual', async (o) => (await import('./neighbors')).manualMock(await o()));
vi.mock('../../../src/effects/run', async (o) => (await import('./neighbors')).runMock(await o()));
vi.mock('../../../src/core/resolve', async (o) => (await import('./neighbors')).resolveMock(await o()));

beforeEach(setup);

const records = (s: GameState): ContinuousEffectRec[] => s.continuousEffects;

/** Move an object somewhere as a test-only outside event (a new object, CR 400.7). */
function moveAway(s: GameState, id: string, to: 'graveyard' | 'hand' | 'battlefield' = 'graveyard'): GameState {
  const t = structuredClone(s);
  moveObject(new Game(t), id, to, { cause: 'test' });
  return t;
}

describe('Giant Growth: "Target creature gets +3/+3 until end of turn." (CR 611.2, 613.4c, 514.2)', () => {
  const board = (): GameState =>
    withExamples(scenario(['Giant Growth', 'Grizzly Bears', 'Forest'], { p1: { hand: ['Giant Growth'], battlefield: ['Forest', 'Grizzly Bears'] } }), 'Giant Growth');

  it('CR 611.2c: the effect is stored with its affected set fixed to the target and its numbers, and the creature is 5/5', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = castAndResolve(s0, 'Giant Growth', [targets(objectTarget(bears))]);
    expect(pt(s, bears)).toEqual([5, 5]);
    const [rec] = records(s);
    expect(rec!.effect).toEqual({ s: 'continuous', affects: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] }, mods: [{ layer: '7c', power: 3, toughness: 3 }] });
    expect(rec!.duration).toEqual({ d: 'endOfTurn' });
    expect(rec!.controller).toBe('p1');
    expect(rec!.startedTurn).toBe(1);
    expect(s.log.some((l) => /Giant Growth's effect begins/.test(l.text) && l.rules?.includes('CR 611.2c'))).toBe(true);
  });

  it('CR 514.2: the effect ends in the cleanup step; next turn the creature is 2/2 again', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = advanceTo(castAndResolve(s0, 'Giant Growth', [targets(objectTarget(bears))]), 2, 'upkeep');
    expect(records(s)).toEqual([]);
    expect(pt(s, bears)).toEqual([2, 2]);
  });

  it('CR 608.2b: its target gone, Giant Growth does not resolve and creates no effect', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = passBoth(moveAway(cast(s0, 'Giant Growth', [targets(objectTarget(bears))]), bears, 'hand'));
    expect(records(s)).toEqual([]);
  });

  it('CR 400.7: once the creature leaves the battlefield and returns, it is a new object the effect does not affect', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = castAndResolve(s0, 'Giant Growth', [targets(objectTarget(bears))]);
    s = moveAway(moveAway(s, bears, 'hand'), find(moveAway(s, bears, 'hand'), 'Grizzly Bears', 'hand'), 'battlefield');
    expect(pt(s, find(s, 'Grizzly Bears', 'battlefield'))).toEqual([2, 2]);
  });
});

describe('Aspect of Hydra: "+X/+X until end of turn, where X is your devotion to green." (CR 611.2d)', () => {
  const ASPECT = instant('Aspect of Hydra', programOf('Aspect of Hydra').steps, programOf('Aspect of Hydra').targets);

  it('CR 611.2d, 700.5: X is determined once, on resolution; losing devotion later does not shrink the bonus', () => {
    const s0 = scenario(['Hill Giant', 'Llanowar Elves'], { p1: { hand: ['Aspect of Hydra'], battlefield: ['Hill Giant', 'Llanowar Elves', 'Llanowar Elves'] }, defs: [ASPECT] });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    let s = castAndResolve(s0, 'Aspect of Hydra', [targets(objectTarget(giant))]);
    expect(pt(s, giant)).toEqual([5, 5]); // devotion to green 2: two Llanowar Elves ({G} each); Hill Giant is red
    expect(records(s)[0]!.effect).toMatchObject({ mods: [{ layer: '7c', power: 2, toughness: 2 }] });
    s = moveAway(s, find(s, 'Llanowar Elves', 'battlefield'));
    expect(pt(s, giant)).toEqual([5, 5]);
  });
});

describe('History of Benalia III: "Knights you control get +2/+1 until end of turn." (CR 611.2c)', () => {
  const RALLY = instant('Knight Rally', programOf('History of Benalia', 1).steps, [], 'Sorcery');
  const KNIGHT = permanent('Test Knight', 'Creature — Knight', [], ['2', '2']);

  it('CR 611.2c: the Knights are determined as the effect begins; a Knight that enters afterwards is not affected', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Knight Rally', 'Test Knight'], battlefield: ['Test Knight', 'Test Knight', 'Grizzly Bears'] }, p2: { battlefield: ['Test Knight'] }, defs: [RALLY, KNIGHT] });
    let s = castAndResolve(s0, 'Knight Rally');
    const mine = s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Knight' && s.objects[id]!.controller === 'p1');
    for (const k of mine) expect(pt(s, k)).toEqual([4, 3]);
    expect(pt(s, find(s, 'Test Knight', 'battlefield', 'p2'))).toEqual([2, 2]); // "you control"
    expect(pt(s, find(s, 'Grizzly Bears', 'battlefield'))).toEqual([2, 2]);
    s = moveAway(s, find(s, 'Test Knight', 'hand'), 'battlefield');
    const late = s.zones.battlefield[s.zones.battlefield.length - 1]!;
    expect(pt(s, late)).toEqual([2, 2]);
    expect(records(s)[0]!.effect).toMatchObject({ affects: { ref: 'fixed', objects: mine.map((id) => ({ id, zone: 'battlefield' })) } });
  });
});

describe('Oko, Thief of Crowns +1: an effect in layers 4, 5, 6 and 7b with no duration (CR 611.2a, 613.1)', () => {
  const ELK = instant('Elkify', programOf('Oko, Thief of Crowns', 1).steps, programOf('Oko, Thief of Crowns', 1).targets, 'Sorcery');

  it('CR 611.2a: target creature loses its abilities and is a 3/3 green Elk creature until the end of the game', () => {
    const s0 = scenario(['Llanowar Elves'], { p1: { hand: ['Elkify'] }, p2: { battlefield: ['Llanowar Elves'] }, defs: [ELK] });
    const elves = find(s0, 'Llanowar Elves', 'battlefield');
    let s = castAndResolve(s0, 'Elkify', [targets(objectTarget(elves))]);
    const check = (x: GameState): void => {
      const c = getChars(x, elves);
      expect(c.types).toEqual(['Creature']);
      expect(c.subtypes).toEqual(['Elk']);
      expect(c.colors).toEqual(['G']);
      expect(c.abilities).toEqual([]);
      expect(pt(x, elves)).toEqual([3, 3]);
    };
    check(s);
    expect(records(s)[0]!.duration).toEqual({ d: 'permanent' });
    s = advanceTo(s, 3, 'upkeep');
    check(s);
  });
});

describe('Mutavault: "{1}: ~ becomes a 2/2 creature with all creature types until end of turn. It\'s still a land." (CR 611.2c, 205.3m)', () => {
  const VAULT = permanent('Test Vault', 'Land', example('Mutavault'));

  it('the reference to itself is fixed to the land as it is now; it is a 2/2 creature land until end of turn', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Vault', 'Plains'] }, defs: [VAULT] });
    const vault = find(s0, 'Test Vault', 'battlefield');
    let s = passBoth(activate(s0, vault, 1));
    const c = getChars(s, vault);
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(pt(s, vault)).toEqual([2, 2]);
    expect(records(s)[0]!.effect).toMatchObject({ affects: { ref: 'fixed', objects: [{ id: vault, zone: 'battlefield' }] } });
    s = advanceTo(s, 2, 'upkeep');
    expect(getChars(s, vault).types).toEqual(['Land']);
  });
});

describe('CR 611.2d: a value that depends on the object being modified is fixed per object', () => {
  const DOUBLE = instant('Double Up', [{
    op: 'effect', duration: { d: 'endOfTurn' },
    effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: '7c', power: { q: 'stat', stat: 'power', of: { ref: 'subject' } } }] }],
  }]);

  it('"each creature you control gets +X/+0, where X is its power": one record per creature, each with its own number', () => {
    const s0 = scenario(['Grizzly Bears', 'Hill Giant'], { p1: { hand: ['Double Up'], battlefield: ['Grizzly Bears', 'Hill Giant'] }, defs: [DOUBLE] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const giant = find(s0, 'Hill Giant', 'battlefield');
    let s = castAndResolve(s0, 'Double Up');
    expect(pt(s, bears)).toEqual([4, 2]);
    expect(pt(s, giant)).toEqual([6, 3]);
    const recs = records(s);
    expect(recs.map((r) => r.effect)).toEqual([
      { s: 'continuous', affects: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] }, mods: [{ layer: '7c', power: 2 }] },
      { s: 'continuous', affects: { ref: 'fixed', objects: [{ id: giant, zone: 'battlefield' }] }, mods: [{ layer: '7c', power: 3 }] },
    ]);
    expect(new Set(recs.map((r) => r.timestamp)).size).toBe(1); // created together (CR 613.7b)
    s = structuredClone(s);
    s.objects[bears]!.counters['+1/+1'] = 1;
    expect(pt(s, bears)).toEqual([5, 3]); // still +2: the value was fixed
  });
});

describe('CR 107.3, 611.2d: X is replaced by its value', () => {
  const PUMP = instant('Pump X', [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' }, mods: [{ layer: '7c', power: { q: 'X' }, toughness: { q: 'X' } }] }] }], [creatureTarget()], 'Instant', '{X}');

  it('the record holds the number announced for X', () => {
    const s0 = scenario(['Grizzly Bears', 'Plains'], { p1: { hand: ['Pump X'], battlefield: ['Grizzly Bears', 'Plains', 'Plains'] }, defs: [PUMP] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = castAndResolve(s0, 'Pump X', [{ kind: 'chooseNumber', n: 2 }, targets(objectTarget(bears))]);
    expect(records(s)[0]!.effect).toMatchObject({ mods: [{ layer: '7c', power: 2, toughness: 2 }] });
    expect(pt(s, bears)).toEqual([4, 4]);
  });
});

describe('never silently stored: an effect kind the engine does not advertise (no static:<s>) is resolved by hand', () => {
  // Whichever package registers a kind (statics/live.ts, effects/propose.ts, statics/hooks.ts), the first of these the build does not advertise is the probe.
  const CANDIDATES: StaticEffect[] = [
    { s: 'restrict', subject: { ref: 'target', id: 't0' }, mode: 'cant', action: 'block' },
    { s: 'permit', who: { ref: 'you' }, action: 'playLand', count: 1 },
    { s: 'triggerMod', cause: { ev: 'zoneChange', subject: { types: ['Creature'] }, to: 'battlefield' }, abilitiesOf: { controller: 'you' }, additional: 1 },
  ];
  const probe = CANDIDATES.find((e) => !ENGINE_CAPABILITIES.has(`static:${e.s}`));
  const playerSpec = { id: 't1', kind: 'player' as const, min: 1, max: 1, text: 'target player' };
  const spell = (e: StaticEffect, duration: Duration) => instant('Probe Effect', [{ op: 'effect', duration, effects: [e], span: 'The probe sentence.' }], [creatureTarget(), playerSpec]);
  const resolveProbe = (e: StaticEffect, duration: Duration): GameState => {
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Probe Effect'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [spell(e, duration)] });
    return castAndResolve(s0, 'Probe Effect', [targets(objectTarget(find(s0, 'Grizzly Bears', 'battlefield'))), targets(playerTarget('p2'))]);
  };

  it.skipIf(probe === undefined)('it raises a manual prompt and leaves no record', () => {
    const s = resolveProbe(probe!, { d: 'endOfTurn' });
    expect(records(s)).toEqual([]);
    expect(neighbors.manual).toEqual([{ text: 'The probe sentence.', reason: `the engine can't apply an effect of kind "${probe!.s}" yet`, until: { d: 'endOfTurn' } }]);
  });

  it.skipIf(probe === undefined)('CR 611.2a: the chip lasts as long as the effect would, its players fixed ("until target player\'s next turn" ends at THAT player\'s turn)', () => {
    resolveProbe(probe!, { d: 'untilNextTurn', whose: { ref: 'target', id: 't1' } });
    expect(neighbors.manual[0]!.until).toEqual({ d: 'untilNextTurn', whose: { ref: 'fixed', players: ['p2'] } });
  });
});
