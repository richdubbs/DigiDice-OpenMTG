/**
 * WP14 review findings for the zone ops (move, sacrifice, sacrificeChoice, counter, attach, changeFace, phaseOut) and the stack primitives: each test is named
 * after the rule the finding was about and failed before the fix.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectProgram, EffectStep, GameState, TargetSpec } from '../../../src/index';
import { evalCond } from '../../../src/effects/eval';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { capabilitiesOf } from '../../../src/model';
import { normalize } from '../../../src/triggers/normalize';
import { chosenObject, ctxOn } from '../eval/helpers';
import { find, put, scenario, tweak } from '../helpers';
import { continuous, fixedOn, withEffect } from '../statics/fixtures';
import { pipeline } from './pipeline';
import { decisionOf, putOnStack, runProgram, runSteps } from './support';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).proposeModule }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).manualModule }));

beforeEach(() => pipeline.reset());

const creature: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' };
const spellSpec: TargetSpec = { id: 't0', kind: 'spell', min: 1, max: 1, text: 'target spell' };
const prog = (steps: EffectStep[], targets: TargetSpec[] = []): EffectProgram => ({ targets, steps });
const newIdOf = (s: GameState, id: string): string => s.lki[id]!.newId!;

function board(): GameState {
  return scenario(['Lightning Bolt', 'Counterspell', 'Grizzly Bears', 'Hill Giant', 'Pacifism', 'Bonesplitter', 'Delver of Secrets // Insectile Aberration'], {
    p1: { hand: ['Lightning Bolt'], battlefield: ['Hill Giant', 'Bonesplitter', 'Delver of Secrets // Insectile Aberration'], graveyard: ['Grizzly Bears', 'Pacifism', 'Bonesplitter'], library: ['Hill Giant', 'Hill Giant'] },
    p2: { battlefield: ['Grizzly Bears'], graveyard: ['Hill Giant', 'Lightning Bolt'] },
  });
}

describe('CR 607.2a: a linked ability remembers what EVERY resolution of the other ability did', () => {
  it('CR 607.2a: two resolutions of an exile ability with a link both stay linked (move)', () => {
    const s = board();
    const giant = find(s, 'Hill Giant', 'battlefield');
    const exile = (name: string): EffectProgram => prog([{ op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', name, owner: 'you' } }, to: { zone: 'exile' }, link: 'ex' }]);
    const r1 = runProgram(s, { name: 'Hill Giant', kind: 'activated', sourceId: giant }, exile('Grizzly Bears'));
    const r2 = runProgram(r1.state, { name: 'Hill Giant', kind: 'activated', sourceId: giant }, exile('Pacifism'));
    const linked = r2.state.objects[giant]!.links!['ex']!.objects!;
    expect(linked.map((h) => r2.state.defs[r2.state.objects[h.id]!.defId]!.name)).toEqual(['Grizzly Bears', 'Pacifism']); // insertion order kept ("the last card exiled")
  });

  it('CR 607.2a: two resolutions of a token-making ability with a link both stay linked (createToken)', () => {
    const s = board();
    const giant = find(s, 'Hill Giant', 'battlefield');
    const make = prog([{ op: 'createToken', who: { ref: 'you' }, count: 1, token: { name: 'Spirit', types: ['Creature'], subtypes: ['Spirit'], power: 1, toughness: 1 }, link: 'made' }]);
    const r1 = runProgram(s, { name: 'Hill Giant', kind: 'activated', sourceId: giant }, make);
    const r2 = runProgram(r1.state, { name: 'Hill Giant', kind: 'activated', sourceId: giant }, make);
    expect(r2.state.objects[giant]!.links!['made']!.objects).toHaveLength(2);
  });
});

describe('CR 701.21a: a player can sacrifice only a permanent they control', () => {
  it('CR 701.21a: "sacrifice it" on a permanent another player controls does nothing', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const r = runProgram(s, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] }, prog([{ op: 'sacrifice', what: { ref: 'target', id: 't0' } }], [creature]));
    expect(r.state.objects[bears]?.zone).toBe('battlefield');
    expect(r.results[0]!.performed).toBe(false);
    expect(r.state.log.some((l) => l.rules?.includes('CR 701.21a') && /can't sacrifice/.test(l.text))).toBe(true);
  });

  it('CR 701.21a, 613.1b: "sacrifice it" follows the controller after layer 2, not the stored field', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p2');
    const s = withEffect(s0, continuous(fixedOn(s0, bears), [{ layer: 2, controller: { ref: 'fixed', players: ['p1'] } }])); // p1 gained control of it
    const r = runProgram(s, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] }, prog([{ op: 'sacrifice', what: { ref: 'target', id: 't0' } }], [creature]));
    expect(r.state.objects[bears]).toBeUndefined();
  });

  it('CR 701.21a, 613.1b: "each player sacrifices a creature" offers each player the creatures they control after layer 2', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p2');
    const s = withEffect(s0, continuous(fixedOn(s0, bears), [{ layer: 2, controller: { ref: 'fixed', players: ['p1'] } }]));
    const step: EffectStep = { op: 'sacrificeChoice', who: { ref: 'each', who: 'player' }, filter: { types: ['Creature'] }, count: 1 };
    const d = decisionOf(() => runProgram(s, { name: 'Lightning Bolt' }, prog([step])));
    expect(d.kind).toBe('chooseObjects');
    expect((d as Extract<typeof d, { kind: 'chooseObjects' }>).options).toContain(bears); // p1's choice includes the stolen Bears
  });
});

describe('CR 701.6a, 401.3: counter puts the spell exactly where the step says, or is resolved by hand', () => {
  function withBolt(): { t: GameState; bolt: string } {
    const t = structuredClone(board());
    return { t, bolt: putOnStack(t, { name: 'Lightning Bolt', owner: 'p2' }) };
  }

  it('CR 401.3: "counter it and put it into its owner\'s library third from the top" ({nth:3})', () => {
    const { t, bolt } = withBolt();
    const u = tweak(t, (x) => { for (let i = 0; i < 3; i++) put(x, 'p2', 'library', 'Hill Giant'); });
    const r = runProgram(u, { name: 'Counterspell', targets: [[chosenObject(bolt)]] }, prog([{ op: 'counter', what: { ref: 'target', id: 't0' }, to: { zone: 'library', position: { nth: 3 } } }], [spellSpec]));
    expect(r.state.zones.library['p2']!.indexOf(newIdOf(r.state, bolt))).toBe(2);
  });

  it('CR 701.6a: a destination a countered spell is not put into by this build (the battlefield) is resolved by hand, never skipped silently', () => {
    const { t, bolt } = withBolt();
    const r = runProgram(t, { name: 'Counterspell', targets: [[chosenObject(bolt)]] }, prog([{ op: 'counter', what: { ref: 'target', id: 't0' }, to: { zone: 'battlefield', controller: { ref: 'you' } } }], [spellSpec]));
    expect(pipeline.manual).toHaveLength(1);
    expect(r.state.objects[bolt]!.zone).toBe('stack');
  });

  it('CR 701.6a: the capability walker names a counter onto the battlefield, so the card is not classified automated', () => {
    const caps = capabilitiesOf({ kind: 'spell', text: 'x', effect: prog([{ op: 'counter', what: { ref: 'target', id: 't0' }, to: { zone: 'battlefield', controller: { ref: 'you' } } }], [spellSpec]) });
    expect(caps).toContain('op:counter.to.battlefield');
    expect(ENGINE_CAPABILITIES.has('op:counter.to.battlefield')).toBe(false);
  });
});

describe('CR 707.10: a copy of a spell is not cast, and a copy of an ability is not a spell', () => {
  it('CR 707.10: wasCast {from} is false for a copy (where the original was cast from is not a choice), wasCast {kicked} stays true', () => {
    const t = structuredClone(board());
    const bolt = putOnStack(t, { name: 'Lightning Bolt', owner: 'p2', castFrom: 'hand', costsPaid: { kicked: 1 } });
    const r = runProgram(t, { name: 'Counterspell', targets: [[chosenObject(bolt)]] }, prog([{ op: 'copy', what: { ref: 'target', id: 't0' }, result: 'spell', who: { ref: 'you' } }], [spellSpec]));
    const copy = r.state.zones.stack[r.state.zones.stack.length - 1]!;
    const cx = ctxOn(r.state, copy, { targets: [], steps: [] });
    expect(evalCond(cx, { cond: 'wasCast', from: 'hand' })).toBe(false);
    expect(evalCond(cx, { cond: 'wasCast', kicked: true })).toBe(true);
  });

  it('CR 707.10, 113.1: copying an ability emits no "spell copied" event, so "whenever you cast or copy a spell" doesn\'t see it', () => {
    const t = structuredClone(board());
    const ab = putOnStack(t, { name: 'Hill Giant', kind: 'activated', sourceId: find(t, 'Hill Giant', 'battlefield') });
    const abilitySpec: TargetSpec = { id: 't0', kind: 'ability', min: 1, max: 1, text: 'target activated ability' };
    const r = runProgram(t, { name: 'Counterspell', targets: [[chosenObject(ab)]] }, prog([{ op: 'copy', what: { ref: 'target', id: 't0' }, result: 'spell', who: { ref: 'you' } }], [abilitySpec]));
    expect(r.results[0]!.count).toBe(1);
    expect(r.cx.g.events.some((e) => e.type === 'spellCopied')).toBe(false);
    expect(normalize(r.cx.g, r.cx.g.events, 1).some((e) => e.ev === 'cast')).toBe(false);
  });
});

describe('CR 702.26b: a phased-out permanent is treated as though it doesn\'t exist', () => {
  const phased = (): GameState => tweak(board(), (x) => { x.objects[find(x, 'Hill Giant', 'battlefield')]!.phasedOut = true; });

  it('CR 702.26b: "exile each creature" doesn\'t exile a phased-out creature', () => {
    const s = phased();
    const giant = find(s, 'Hill Giant', 'battlefield');
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'move', what: { ref: 'each', filter: { types: ['Creature'] } }, to: { zone: 'exile' } }]));
    expect(r.state.objects[giant]?.zone).toBe('battlefield');
  });

  it('CR 702.26b (its own example): a count of the creatures you control doesn\'t count a phased-out one', () => {
    const s = phased();
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'createToken', who: { ref: 'you' }, count: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } }, token: { name: 'Soldier', types: ['Creature'], subtypes: ['Soldier'], power: 1, toughness: 1 } }]));
    expect(r.results[0]!.count).toBe(1); // Delver only: the phased-out Hill Giant isn't counted
  });

  it('CR 702.26b: a token copy of a phased-out permanent is not created', () => {
    const s = phased();
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'copy', what: { ref: 'each', filter: { name: 'Hill Giant' } }, result: 'token', who: { ref: 'you' } }]));
    expect(r.results[0]!.count).toBe(0);
  });
});

describe('CR 701.3d: becoming unattached', () => {
  it('CR 701.3d: re-attaching an Equipment to another creature makes it become unattached from the first', () => {
    const s0 = board();
    const eq = find(s0, 'Bonesplitter', 'battlefield');
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const s = tweak(s0, (x) => { x.objects[eq]!.attachedTo = giant; });
    const r = runProgram(s, { name: 'Bonesplitter', kind: 'activated', sourceId: eq }, prog([{ op: 'attach', what: { ref: 'self' }, to: { ref: 'each', filter: { name: 'Delver of Secrets' } } }]));
    const sem = normalize(r.cx.g, r.cx.g.events, 1);
    expect(sem.some((e) => e.ev === 'becomes' && e.data['what'] === 'unattached')).toBe(true);
    expect(sem.some((e) => e.ev === 'becomes' && e.data['what'] === 'attached')).toBe(true);
  });

  it('CR 701.3d, 603.10: "becomes unattached" is not advertised while leaving the battlefield and the 704.5m-n state-based actions emit nothing', () => {
    expect(ENGINE_CAPABILITIES.has('feature:ev.becomes.unattached')).toBe(false);
  });
});

describe('CR 701.27f: a permanent that transformed since is not transformed again', () => {
  it('CR 701.27f: a delayed triggered ability of a permanent doesn\'t transform it back after it transformed', () => {
    const s = board();
    const delver = find(s, 'Delver of Secrets // Insectile Aberration', 'battlefield');
    const t = structuredClone(s);
    const ab = putOnStack(t, { name: 'Delver of Secrets // Insectile Aberration', kind: 'triggered', sourceId: delver });
    t.objects[ab]!.stack!.abilityRef = { source: 'delayed', face: 0, index: 0 };
    t.objects[delver]!.face = 1;
    t.objects[delver]!.timestamp = t.counters.timestamp++; // transformed after the delayed trigger was put on the stack
    const program = prog([{ op: 'changeFace', what: { ref: 'self' }, to: 'transform' }]);
    runSteps(ctxOn(t, ab, program), program.steps);
    expect(t.objects[delver]!.face).toBe(1);
  });

  // M6-4 (m6 design 3.6): the delayed record's creation time is kept (triggers/delayed.ts), so the engine can tell (test/m6/dfc/transform.test.ts)
  it('CR 701.27f: a delayed triggered ability of a permanent that hasn\'t transformed since it was created transforms it (M6-4: no longer by hand)', () => {
    const s = board();
    const delver = find(s, 'Delver of Secrets // Insectile Aberration', 'battlefield');
    const t = structuredClone(s);
    const ab = putOnStack(t, { name: 'Delver of Secrets // Insectile Aberration', kind: 'triggered', sourceId: delver });
    t.objects[ab]!.stack!.abilityRef = { source: 'delayed', face: 0, index: 0 };
    const program = prog([{ op: 'changeFace', what: { ref: 'self' }, to: 'transform' }]);
    runSteps(ctxOn(t, ab, program), program.steps);
    expect(pipeline.manual).toHaveLength(0);
    expect(t.objects[delver]!.face).toBe(1);
  });

  it('CR 701.27f: the walker names a delayed trigger that transforms its own source', () => {
    const caps = capabilitiesOf({ kind: 'spell', text: 'x', effect: prog([{ op: 'delay', when: { ev: 'beginStep', step: 'end' }, do: [{ op: 'changeFace', what: { ref: 'self' }, to: 'transform' }] } as unknown as EffectStep]) });
    expect(caps).toContain('op:changeFace.delayedSelf');
  });
});

describe('CR 301.5e, 303.4h: only an Aura depends on what it enters attached to', () => {
  it('CR 301.5e: an Equipment put onto the battlefield "attached to" a creature that has left enters unattached', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const gone = tweak(s, (x) => { x.zones.battlefield = x.zones.battlefield.filter((id) => id !== bears); x.objects[bears]!.zone = 'graveyard'; x.zones.graveyard['p2']!.push(bears); });
    const eq = find(gone, 'Bonesplitter', 'graveyard');
    const r = runProgram(gone, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] }, prog([{ op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', name: 'Bonesplitter' } }, to: { zone: 'battlefield', controller: { ref: 'you' }, attachedTo: { ref: 'target', id: 't0' } } }], [creature]));
    const o = r.state.objects[newIdOf(r.state, eq)]!;
    expect([o.zone, o.attachedTo]).toEqual(['battlefield', undefined]);
  });

  it('CR 303.4h: a creature put onto the battlefield "attached to" something enters unattached (no attachTo is proposed)', () => {
    const s = board();
    const giant = find(s, 'Hill Giant', 'battlefield');
    runProgram(s, { name: 'Lightning Bolt', targets: [[chosenObject(giant)]] }, prog([{ op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', name: 'Grizzly Bears' } }, to: { zone: 'battlefield', controller: { ref: 'you' }, attachedTo: { ref: 'target', id: 't0' } } }], [creature]));
    const p = pipeline.proposals.find((x) => x.ev === 'zoneChange')! as Extract<(typeof pipeline.proposals)[number], { ev: 'zoneChange' }>;
    expect(p.destination.attachTo).toBeUndefined();
  });
});

describe('CR 401.4: only cards put in a specific position are arranged', () => {
  it('CR 401.4: "shuffle your graveyard into your library" moves the cards without an order decision', () => {
    const s = board();
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([
      { op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', owner: 'you' } }, to: { zone: 'library' } },
    ]));
    expect(r.results[0]!.count).toBe(3);
    expect(r.state.zones.graveyard['p1']).toEqual([]);
  });
});
