/**
 * WP14: `tap`, `untap` (CR 701.26), `attach` (CR 701.3), `changeFace` (CR 701.27, 712), `phaseOut` (CR 702.26, 502.1), `regenerate` (CR 701.19),
 * `removeFromCombat` (CR 506.4) and `exchange` (CR 701.12).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectProgram, EffectStep, GameState, TargetSpec } from '../../../src/index';
import type { CombatState } from '../../../src/types/state';
import { addPlayerRestriction } from '../../../src/rules/restrictions';
import { Game } from '../../../src/core/game';
import { chosenObject, chosenPlayer, ctxOn } from '../eval/helpers';
import { act, answer, find, put, scenario, tweak } from '../helpers';
import { pipeline } from './pipeline';
import { putOnStack, runProgram, runSteps } from './support';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).proposeModule }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).manualModule }));

beforeEach(() => pipeline.reset());

const creature: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' };
const prog = (steps: EffectStep[], targets: TargetSpec[] = []): EffectProgram => ({ targets, steps });

/** p2's Pacifism enchants p2's Grizzly Bears (put after the setup: an unattached Aura would go to the graveyard, CR 704.5m). */
function board(): GameState {
  const s = scenario(['Lightning Bolt', 'Grizzly Bears', 'Hill Giant', 'Pacifism', 'Bonesplitter', 'Delver of Secrets // Insectile Aberration', 'Forest'], {
    p1: { hand: ['Lightning Bolt'], battlefield: ['Hill Giant', 'Bonesplitter', 'Delver of Secrets // Insectile Aberration', 'Forest', { name: 'Grizzly Bears', tapped: true }] },
    p2: { battlefield: ['Grizzly Bears'] },
  });
  return tweak(s, (t) => { t.objects[put(t, 'p2', 'battlefield', 'Pacifism')]!.attachedTo = find(t, 'Grizzly Bears', 'battlefield', 'p2'); });
}

describe('tap and untap (CR 701.26)', () => {
  it('CR 701.26a: only untapped permanents become tapped; the count is how many changed, and each emits `tapped`', () => {
    const s = board();
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'tap', what: { ref: 'each', filter: { types: ['Creature'] } } }]));
    expect(r.results[0]!.count).toBe(3); // Hill Giant, Delver, p2's bears; p1's bears were tapped already
    expect(r.cx.g.events.filter((e) => e.type === 'tapped')).toHaveLength(3);
  });

  it('CR 701.26b: untap target permanent', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    const r = runProgram(s, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] }, prog([{ op: 'untap', what: { ref: 'target', id: 't0' } }], [creature]));
    expect(r.state.objects[bears]!.tapped).toBe(false);
    expect(r.results[0]!.count).toBe(1);
  });
});

describe('attach (CR 701.3)', () => {
  it('CR 702.6a, 701.3c: equip attaches the Equipment to a creature and gives it a new timestamp', () => {
    const s = board();
    const eq = find(s, 'Bonesplitter', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield');
    const before = s.objects[eq]!.timestamp;
    const r = runProgram(s, { name: 'Bonesplitter', kind: 'activated', sourceId: eq, targets: [[chosenObject(giant)]] }, prog([{ op: 'attach', what: { ref: 'self' }, to: { ref: 'target', id: 't0' } }], [creature]));
    expect(r.state.objects[eq]!.attachedTo).toBe(giant);
    expect(r.state.objects[eq]!.timestamp).toBeGreaterThan(before);
    expect(r.cx.g.events).toContainEqual({ type: 'attached', objectId: eq, to: giant });
  });

  it('CR 701.3b: attaching to what it is already attached to does nothing; an Equipment can\'t be attached to a noncreature (CR 301.5c)', () => {
    const s = tweak(board(), (t) => { t.objects[find(t, 'Bonesplitter', 'battlefield')]!.attachedTo = find(t, 'Hill Giant', 'battlefield'); });
    const eq = find(s, 'Bonesplitter', 'battlefield');
    const same = runProgram(s, { name: 'Bonesplitter', kind: 'activated', sourceId: eq }, prog([{ op: 'attach', what: { ref: 'self' }, to: { ref: 'each', filter: { name: 'Hill Giant' } } }]));
    expect(same.results[0]!.performed).toBe(false);
    const land = runProgram(s, { name: 'Bonesplitter', kind: 'activated', sourceId: eq }, prog([{ op: 'attach', what: { ref: 'self' }, to: { ref: 'each', filter: { name: 'Forest' } } }]));
    expect(land.results[0]!.performed).toBe(false);
    expect(land.state.objects[eq]!.attachedTo).toBe(find(s, 'Hill Giant', 'battlefield'));
  });

  it('CR 303.4a: an Aura moves only to an object its enchant ability allows', () => {
    const s = board();
    const aura = find(s, 'Pacifism', 'battlefield');
    const r1 = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'attach', what: { ref: 'each', filter: { name: 'Pacifism' } }, to: { ref: 'each', filter: { name: 'Forest' } } }]));
    expect(r1.results[0]!.performed).toBe(false);
    const r2 = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'attach', what: { ref: 'each', filter: { name: 'Pacifism' } }, to: { ref: 'each', filter: { name: 'Hill Giant' } } }]));
    expect(r2.state.objects[aura]!.attachedTo).toBe(find(s, 'Hill Giant', 'battlefield'));
  });

  it('CR 701.3d: unattach (`to: null`) leaves the Equipment on the battlefield attached to nothing', () => {
    const s = tweak(board(), (t) => { t.objects[find(t, 'Bonesplitter', 'battlefield')]!.attachedTo = find(t, 'Hill Giant', 'battlefield'); });
    const eq = find(s, 'Bonesplitter', 'battlefield');
    const r = runProgram(s, { name: 'Bonesplitter', kind: 'activated', sourceId: eq }, prog([{ op: 'attach', what: { ref: 'self' }, to: null }]));
    expect(r.state.objects[eq]!.attachedTo).toBeUndefined();
    expect(r.cx.g.events).toContainEqual({ type: 'attached', objectId: eq, to: null });
  });
});

describe('transform (CR 701.27)', () => {
  it('CR 701.27a, 712.18, 613.7g: a double-faced permanent turns to its other face: same object, new timestamp, `transformed` event', () => {
    const s = board();
    const delver = find(s, 'Delver of Secrets // Insectile Aberration', 'battlefield');
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'changeFace', what: { ref: 'each', filter: { name: 'Delver of Secrets' } }, to: 'transform' }]));
    const o = r.state.objects[delver]!;
    expect(o.face).toBe(1);
    expect(o.timestamp).toBeGreaterThan(s.objects[delver]!.timestamp);
    expect(r.cx.g.events).toContainEqual({ type: 'transformed', objectId: delver });
    expect(r.state.log.some((l) => /transforms into Insectile Aberration/.test(l.text))).toBe(true);
  });

  it('CR 701.27c, 712.9: a permanent that is not double-faced doesn\'t transform', () => {
    const s = board();
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'changeFace', what: { ref: 'each', filter: { name: 'Hill Giant' } }, to: 'transform' }]));
    expect(r.results[0]!.performed).toBe(false);
  });

  it('CR 701.27f: an ability of the permanent doesn\'t transform it if it transformed since the ability was put on the stack', () => {
    const s = board();
    const delver = find(s, 'Delver of Secrets // Insectile Aberration', 'battlefield');
    const t = structuredClone(s);
    const ab = putOnStack(t, { name: 'Delver of Secrets // Insectile Aberration', kind: 'triggered', sourceId: delver });
    t.objects[delver]!.face = 1; // it transformed in response (CR 613.7g: a new timestamp)
    t.objects[delver]!.timestamp = t.counters.timestamp++;
    const program = prog([{ op: 'changeFace', what: { ref: 'self' }, to: 'transform' }]);
    runSteps(ctxOn(t, ab, program), program.steps);
    expect(t.objects[delver]!.face).toBe(1);
    // Without the transformation in between, the same ability transforms it.
    const u = structuredClone(s);
    const ab2 = putOnStack(u, { name: 'Delver of Secrets // Insectile Aberration', kind: 'triggered', sourceId: delver });
    runSteps(ctxOn(u, ab2, program), program.steps);
    expect(u.objects[delver]!.face).toBe(1);
  });

  // M6-0 (m6 design 4.3) left a milestone 6 absence pin here; M6-3 updated it (turn face up is performed through CHANGE_FACE); M6-4 converts and flips
  // (effects/handlers/dfc-ops.ts; their own tests: test/m6/dfc/).
  it('CR 701.28, 710, 708.7: no form of changeFace is resolved by hand any more (M6-3, M6-4)', () => {
    const s = board();
    for (const to of ['faceUp', 'convert', 'flip'] as const) runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'changeFace', what: { ref: 'self' }, to }]));
    expect(pipeline.manual).toHaveLength(0);
  });
});

describe('phasing (CR 702.26, 502.1)', () => {
  it('CR 702.26b, 702.26g: a creature phases out with the Aura attached to it; both phase in during its controller\'s next untap step (CR 502.1)', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const aura = find(s, 'Pacifism', 'battlefield');
    const r = runProgram(s, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] }, prog([{ op: 'phaseOut', what: { ref: 'target', id: 't0' } }], [creature]));
    expect(r.results[0]!.count).toBe(2);
    expect([r.state.objects[bears]!.phasedOut, r.state.objects[aura]!.phasedOut]).toEqual([true, true]);
    expect(r.cx.g.events.filter((e) => e.type === 'phasedOut').map((e) => (e as { objectId: string }).objectId)).toEqual([bears, aura]);
    // CR 702.26d: not a zone change: no zoneChanged event, same objects
    expect(r.cx.g.events.some((e) => e.type === 'zoneChanged')).toBe(false);
    // The rest of p1's turn and p2's untap step: the pair phases in together.
    let t = tweak(r.state, (x) => { for (const id of x.zones.stack) delete x.objects[id]; x.zones.stack = []; }); // the test spell is gone
    for (let i = 0; i < 40 && !(t.turn.activePlayer === 'p2' && t.turn.step === 'upkeep'); i++) t = t.pending!.kind === 'declareAttackers' ? answer(t, { kind: 'declareAttackers', attacks: [] }) : act(t, { type: 'pass', player: t.pending!.player });
    expect([t.objects[bears]!.phasedOut, t.objects[aura]!.phasedOut]).toEqual([false, false]);
    expect(t.objects[aura]!.attachedTo).toBe(bears);
  });

  it('CR 506.4: a permanent that phases out is removed from combat', () => {
    const s = tweak(board(), (t) => {
      const giant = find(t, 'Hill Giant', 'battlefield');
      t.combat = { number: 1, attacked: true, attackers: [{ id: giant, defender: 'p2', defendingPlayer: 'p2', blockedBy: [], blocked: false }], blockers: [], damageSteps: 0, extraDamageStep: false, firstStrikers: [] } satisfies CombatState;
    });
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'phaseOut', what: { ref: 'each', filter: { name: 'Hill Giant' } } }]));
    expect(r.state.combat!.attackers).toEqual([]);
  });
});

describe('regenerate (CR 701.19), remove from combat (CR 506.4)', () => {
  it('CR 701.19a: "regenerate target creature" leaves a shield; the next destruction this turn is replaced', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const r = runProgram(s, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] }, prog([
      { op: 'regenerate', what: { ref: 'target', id: 't0' } },
      { op: 'destroy', what: { ref: 'target', id: 't0' } },
    ], [creature]));
    expect(r.results.map((x) => x.performed)).toEqual([true, false]);
    expect(r.state.objects[bears]!.zone).toBe('battlefield');
    expect(r.state.objects[bears]!.tapped).toBe(true);
  });

  it('CR 701.19a: a shield lasting beyond this turn is resolved by hand', () => {
    const s = board();
    runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'regenerate', what: { ref: 'each', filter: { name: 'Hill Giant' } }, duration: { d: 'untilNextTurn', whose: { ref: 'you' } } }]));
    expect(pipeline.manual).toHaveLength(1);
  });

  it('CR 506.4: remove target attacking creature from combat; a creature not in combat is not counted', () => {
    const s = tweak(board(), (t) => {
      const giant = find(t, 'Hill Giant', 'battlefield');
      const bears = find(t, 'Grizzly Bears', 'battlefield', 'p2');
      t.combat = { number: 1, attacked: true, attackers: [{ id: giant, defender: 'p2', defendingPlayer: 'p2', blockedBy: [bears], blocked: true }], blockers: [{ id: bears, blocking: [giant], defendingPlayer: 'p2' }], damageSteps: 0, extraDamageStep: false, firstStrikers: [] } satisfies CombatState;
    });
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'removeFromCombat', what: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } }]));
    expect(r.results[0]!.count).toBe(1);
    expect(r.state.combat!.attackers).toEqual([]);
    expect(r.state.combat!.blockers[0]!.blocking).toEqual([]);
  });
});

describe('exchange (CR 701.12)', () => {
  it('CR 701.12c: life totals: each player gains or loses the difference through the pipeline', () => {
    const s = tweak(board(), (t) => { t.players[1]!.life = 7; });
    const r = runProgram(s, { name: 'Lightning Bolt', targets: [[chosenPlayer('p2')]] }, prog([{ op: 'exchange', a: { ref: 'you' }, b: { ref: 'target', id: 't0' }, what: 'life' }], [{ id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' }]));
    expect(r.state.players.map((p) => p.life)).toEqual([7, 20]);
    expect(pipeline.proposals).toEqual([{ ev: 'life', change: 'loss', player: 'p1', amount: 13 }, { ev: 'life', change: 'gain', player: 'p2', amount: 13 }]);
  });

  it('CR 701.12a, 119.7: if a player can\'t gain life, no part of the exchange happens', () => {
    const s = tweak(board(), (t) => { t.players[1]!.life = 7; addPlayerRestriction(new Game(t), 'p2', 'cantGainLife'); });
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'exchange', a: { ref: 'you' }, b: { ref: 'each', who: 'opponent' }, what: 'life' }]));
    expect(r.state.players.map((p) => p.life)).toEqual([20, 7]);
    expect(pipeline.proposals).toEqual([]);
  });

  it('CR 701.12b (MX2): an exchange of control is two layer-2 effects; the stored controllers change at once (core/control.ts)', () => {
    const s = board();
    const giant = find(s, 'Hill Giant', 'battlefield');
    const pacifism = find(s, 'Pacifism', 'battlefield');
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'exchange', a: { ref: 'each', filter: { name: 'Hill Giant' } }, b: { ref: 'each', filter: { name: 'Pacifism' } }, what: 'control' }]));
    expect(pipeline.manual).toEqual([]);
    expect([r.state.objects[giant]!.controller, r.state.objects[pacifism]!.controller]).toEqual(['p2', 'p1']);
    expect(r.state.continuousEffects.filter((e) => JSON.stringify(e.effect).includes('"layer":2'))).toHaveLength(2);
  });

  it('E3XP (CR 701.12a-b, 108.4): a permanent and a spell on the stack exchange control like two permanents (Perplexing Chimera); one controller of both: nothing happens', () => {
    const s = board();
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'exchange', a: { ref: 'each', filter: { name: 'Hill Giant' } }, b: { ref: 'self' }, what: 'control' }]));
    expect(pipeline.manual).toEqual([]);
    expect(r.state.objects[r.id]!.controller).toBe('p1');
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const x = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'exchange', a: { ref: 'each', filter: { name: 'Grizzly Bears', controller: 'opponent' } }, b: { ref: 'self' }, what: 'control' }]));
    expect(pipeline.manual).toEqual([]);
    expect([x.state.objects[bears]!.controller, x.state.objects[x.id]!.controller]).toEqual(['p1', 'p2']);
  });
});

