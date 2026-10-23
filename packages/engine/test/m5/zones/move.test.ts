/**
 * WP14: the `move` op (CR 400.7, 401.3-401.4, 400.4a, 303.4f-g, 508.4, 607.2a, 610.3, 702.34a, 712.14a). Resolved through the WP10 stand-in over a faked WP11
 * pipeline (pipeline.ts): each move must be ONE `zoneChange` proposal, and what the performer did is read back from the state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectProgram, EffectStep, TargetSpec } from '../../../src/index';
import type { CombatState, GameState } from '../../../src/types/state';
import { bind, chosenObject, ctxOn } from '../eval/helpers';
import { readInfo } from '../../../src/effects/refs';
import { find, scenario } from '../helpers';
import { pipeline } from './pipeline';
import { decisionOf, putOnStack, runProgram, runSteps } from './support';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).proposeModule }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).manualModule }));

beforeEach(() => pipeline.reset());

const creature: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' };
const prog = (steps: EffectStep[], targets: TargetSpec[] = []): EffectProgram => ({ targets, steps });
const zoneOf = (s: GameState, id: string): string | undefined => s.objects[id]?.zone;

function board(): GameState {
  return scenario(['Lightning Bolt', 'Shock', 'Grizzly Bears', 'Hill Giant', 'Pacifism', 'Delver of Secrets // Insectile Aberration'], {
    p1: { hand: ['Lightning Bolt', 'Shock'], battlefield: ['Hill Giant'], graveyard: ['Grizzly Bears', 'Pacifism', 'Delver of Secrets // Insectile Aberration'] },
    p2: { battlefield: ['Grizzly Bears'], graveyard: ['Hill Giant', 'Lightning Bolt'] },
  });
}

describe('move: zones and new objects (CR 400.7)', () => {
  it('CR 400.7, 701.13a: exiling a target makes a new object in exile; the step binds it with the last known information of the creature (CR 608.2h)', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const r = runProgram(s, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] }, prog([{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'exile' }, as: 'x' }], [creature]));
    // Cloud std-fin (CR 608.2c, 608.2h): a named move to exile also reports what it exiled, as it was before it moved ("if a creature card was exiled this way")
    const { before, ...rest } = r.results[0]!;
    expect(rest).toEqual({ performed: true, count: 1 });
    expect(before?.map((b) => b.object.id)).toEqual([bears]);
    expect(r.state.objects[bears]).toBeUndefined();
    const newId = r.state.lki[bears]!.newId!;
    expect(zoneOf(r.state, newId)).toBe('exile');
    expect(pipeline.proposals).toEqual([{ ev: 'zoneChange', object: { id: bears, zone: 'battlefield' }, from: 'battlefield', to: 'exile', destination: { cause: 'exile' } }]);
    const b = r.cx.bindings.get('x')!;
    expect(b.objects).toEqual([{ id: newId, zone: 'exile' }]);
    expect(b.snapshots[newId]!.leftZone).toBe('battlefield'); // "its power", "its controller" read the creature as it last existed
    expect(r.state.log.some((l) => l.rules?.includes('CR 701.13a'))).toBe(true);
  });

  it('CR 400.7j, design 3.1 rule 2: a card put into a hand is a new hidden object; `as` binds nothing the effect can find', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const r = runProgram(s, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] }, prog([{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'hand' }, as: 'x' }], [creature]));
    expect(r.results[0]!.performed).toBe(true);
    expect(zoneOf(r.state, r.state.lki[bears]!.newId!)).toBe('hand');
    expect(r.state.zones.hand['p2']).toContain(r.state.lki[bears]!.newId!); // CR 400.3: its owner's hand
    expect(r.cx.bindings.get('x')!.objects).toEqual([]);
  });

  it('CR 608.2b: a target that left its zone before resolution is illegal and is not moved', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const t = structuredClone(s);
    t.zones.battlefield = t.zones.battlefield.filter((id) => id !== bears);
    t.objects[bears]!.zone = 'graveyard';
    t.zones.graveyard['p2']!.push(bears);
    const r = runProgram(t, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] }, prog([{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'exile' } }], [creature]));
    expect(r.results[0]).toEqual({ performed: false, count: 0 });
    expect(pipeline.proposals).toEqual([]);
  });

  it('CR 614.1a: when a replacement sends the object elsewhere, the binding follows the object it became', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    pipeline.redirect = () => 'exile'; // Leyline of the Void style
    const r = runProgram(s, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] }, prog([{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'graveyard' }, as: 'x' }], [creature]));
    expect(r.cx.bindings.get('x')!.objects[0]!.zone).toBe('exile');
  });

  it('CR 614.6: a pipeline that stops the event: nothing moves and the step did nothing', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    pipeline.veto = () => true;
    const r = runProgram(s, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] }, prog([{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'exile' } }], [creature]));
    expect(r.results[0]).toEqual({ performed: false, count: 0 });
    expect(zoneOf(r.state, bears)).toBe('battlefield');
  });
});

describe('move: libraries (CR 401)', () => {
  const graveCreatures: EffectStep['op'] = 'move';
  const each = { ref: 'each' as const, filter: { zone: 'graveyard' as const, types: ['Creature'], owner: 'you' as const } };

  it('CR 401.4: cards put on the bottom together are arranged by their owner (the order decision lists them top first)', () => {
    const s = board();
    const step: EffectStep = { op: graveCreatures, what: each, to: { zone: 'library', position: 'bottom' } };
    const d = decisionOf(() => runProgram(s, { name: 'Lightning Bolt' }, prog([step])));
    expect(d.kind).toBe('order');
    expect(d.player).toBe('p1');
    const items = (d as Extract<typeof d, { kind: 'order' }>).items.map((i) => i.id);
    expect(items.length).toBe(2);
    const wanted = [items[1]!, items[0]!];
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([step]), [{ kind: 'order', ids: wanted }]);
    const lib = r.state.zones.library['p1']!;
    // H1: arranged after the moves, under new ids (CR 401.4: the order is not revealed), so the cards are compared, not the objects the moves made.
    expect(lib.slice(-2).map((id) => r.state.objects[id]!.cardId)).toEqual(wanted.map((id) => s.objects[id]!.cardId));
  });

  it('CR 401.4: on top, the first card of the answer ends on top', () => {
    const s = board();
    const step: EffectStep = { op: 'move', what: each, to: { zone: 'library', position: 'top' } };
    const d = decisionOf(() => runProgram(s, { name: 'Lightning Bolt' }, prog([step])));
    const items = (d as Extract<typeof d, { kind: 'order' }>).items.map((i) => i.id);
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([step]), [{ kind: 'order', ids: items }]);
    expect(r.state.zones.library['p1']!.slice(0, 2).map((id) => r.state.objects[id]!.cardId)).toEqual(items.map((id) => s.objects[id]!.cardId)); // H1: compared by card
  });

  it('CR 401.3: "third from the top" puts the card at index 2', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'graveyard', 'p1');
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', name: 'Grizzly Bears', owner: 'you' } }, to: { zone: 'library', position: { nth: 3 } } }]));
    expect(r.state.zones.library['p1']![2]).toBe(r.state.lki[bears]!.newId);
  });

  it('design 8.8 rule 2: a random order comes from the state RNG, so the same state and answers give the same library', () => {
    const s = board();
    const step: EffectStep = { op: 'move', what: each, to: { zone: 'library', position: 'bottom', order: 'random' } };
    const a = runProgram(s, { name: 'Lightning Bolt' }, prog([step]));
    const b = runProgram(s, { name: 'Lightning Bolt' }, prog([step]));
    expect(a.state.zones.library['p1']).toEqual(b.state.zones.library['p1']);
    expect(a.state.rng).toEqual(b.state.rng);
  });
});

describe('move: onto the battlefield', () => {
  it('CR 110.2, 122.6: under the named player\'s control, tapped, with counters put on it as it enters', () => {
    const s = board();
    const giant = find(s, 'Hill Giant', 'graveyard', 'p2');
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{
      op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', name: 'Hill Giant' } },
      to: { zone: 'battlefield', controller: { ref: 'you' }, tapped: true, counters: [{ kind: '+1/+1', count: 2 }] },
    }]));
    const o = r.state.objects[r.state.lki[giant]!.newId!]!;
    expect(o.zone).toBe('battlefield');
    expect([o.owner, o.controller, o.tapped, o.counters['+1/+1']]).toEqual(['p2', 'p1', true, 2]);
  });

  it('CR 400.4a: an instant card can\'t enter the battlefield; it stays where it is', () => {
    const s = board();
    const bolt = find(s, 'Lightning Bolt', 'graveyard', 'p2');
    const r = runProgram(s, { name: 'Shock', owner: 'p1' }, prog([{ op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', name: 'Lightning Bolt' } }, to: { zone: 'battlefield', controller: 'owner' } }]));
    expect(r.results[0]).toEqual({ performed: false, count: 0 });
    expect(zoneOf(r.state, bolt)).toBe('graveyard');
    expect(r.state.log.some((l) => l.rules?.includes('CR 400.4a'))).toBe(true);
  });

  it('CR 712.14a: a double-faced card put onto the battlefield transformed enters with its back face up; another card stays where it is', () => {
    const s = board();
    const delver = find(s, 'Delver of Secrets // Insectile Aberration', 'graveyard', 'p1');
    const bears = find(s, 'Grizzly Bears', 'graveyard', 'p1');
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', owner: 'you', types: ['Creature'] } }, to: { zone: 'battlefield', controller: 'owner', transformed: true } }]));
    expect(r.state.objects[r.state.lki[delver]!.newId!]!.face).toBe(1);
    expect(zoneOf(r.state, bears)).toBe('graveyard');
  });

  it('CR 303.4f: an Aura put onto the battlefield without being cast enchants an object chosen as it enters (not targeted)', () => {
    const s = board();
    const step: EffectStep = { op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', name: 'Pacifism' } }, to: { zone: 'battlefield', controller: { ref: 'you' } } };
    const d = decisionOf(() => runProgram(s, { name: 'Lightning Bolt' }, prog([step])));
    expect(d.kind).toBe('chooseObjects');
    expect(d.rules).toContain('CR 303.4f');
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([step]), [{ kind: 'chooseObjects', ids: [bears] }]);
    const aura = r.state.objects[r.state.lki[find(s, 'Pacifism', 'graveyard')]!.newId!]!;
    expect(aura.attachedTo).toBe(bears);
  });

  it('CR 303.4g: with nothing it could enchant, the Aura stays in its zone', () => {
    const s = board();
    const t = structuredClone(s);
    for (const id of [...t.zones.battlefield]) if (t.defs[t.objects[id]!.defId]!.faces[0]!.types.includes('Creature')) t.objects[id]!.phasedOut = true;
    const pac = find(t, 'Pacifism', 'graveyard');
    const r = runProgram(t, { name: 'Lightning Bolt' }, prog([{ op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', name: 'Pacifism' } }, to: { zone: 'battlefield', controller: { ref: 'you' } } }]));
    expect(zoneOf(r.state, pac)).toBe('graveyard');
  });

  it('CR 508.4: put onto the battlefield attacking during combat, it attacks the defending player; outside combat it is just a creature', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'graveyard', 'p1');
    const step: EffectStep = { op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', name: 'Grizzly Bears', owner: 'you' } }, to: { zone: 'battlefield', controller: { ref: 'you' }, tapped: true, attacking: true } };
    const t = structuredClone(s);
    t.combat = { number: 1, attacked: true, attackers: [], blockers: [], damageSteps: 0, extraDamageStep: false, firstStrikers: [] } satisfies CombatState;
    const r = runProgram(t, { name: 'Lightning Bolt' }, prog([step]));
    const id = r.state.lki[bears]!.newId!;
    expect(r.state.combat!.attackers).toEqual([{ id, defender: 'p2', defendingPlayer: 'p2', blockedBy: [], blocked: false }]);
    const out = runProgram(s, { name: 'Lightning Bolt' }, prog([step]));
    expect(out.state.combat).toBeNull();
    expect(out.state.objects[out.state.lki[bears]!.newId!]!.zone).toBe('battlefield');
  });
});

describe('move: special objects and forms', () => {
  it('CR 111.8: a token that has left the battlefield can\'t move again', () => {
    const s = board();
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([
      { op: 'createToken', who: { ref: 'you' }, count: 1, token: { name: 'Soldier', types: ['Creature'], subtypes: ['Soldier'], colors: ['W'], power: 1, toughness: 1 }, as: 'tok' },
      { op: 'move', what: { ref: 'bound', name: 'tok' }, to: { zone: 'graveyard' }, as: 'dead' },
      { op: 'move', what: { ref: 'bound', name: 'dead' }, to: { zone: 'hand' } },
    ]));
    expect(r.results.map((x) => x.count)).toEqual([1, 1, 0]);
  });

  it('CR 702.34a: a flashback spell that would leave the stack is exiled instead', () => {
    const s = board();
    const t = structuredClone(s);
    const bolt = find(t, 'Lightning Bolt', 'hand', 'p1');
    t.zones.hand['p1'] = t.zones.hand['p1']!.filter((id) => id !== bolt);
    t.objects[bolt]!.zone = 'stack';
    t.objects[bolt]!.stack = { kind: 'spell', targets: [], costsPaid: { alternative: 'flashback' }, castFrom: 'graveyard' };
    t.zones.stack.push(bolt);
    const spellSpec: TargetSpec = { id: 't0', kind: 'spell', min: 1, max: 1, text: 'target spell' };
    const r = runProgram(t, { name: 'Shock', targets: [[chosenObject(bolt)]] }, prog([{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'hand' } }], [spellSpec]));
    expect(zoneOf(r.state, r.state.lki[bolt]!.newId!)).toBe('exile');
    expect(r.state.log.some((l) => l.rules?.includes('CR 702.34a'))).toBe(true);
  });

  it('CR 607.2a: `link` makes the source remember the objects it put into exile', () => {
    const s = board();
    const giant = find(s, 'Hill Giant', 'battlefield', 'p1');
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const r = runProgram(s, { name: 'Hill Giant', kind: 'activated', sourceId: giant, targets: [[chosenObject(bears)]] },
      prog([{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'exile' }, link: 'exiled' }], [creature]));
    expect(r.state.objects[giant]!.links?.['exiled']).toEqual({ objects: [{ id: r.state.lki[bears]!.newId!, zone: 'exile' }] });
  });

  // FAST4 MX1: "exile ... until ~ leaves the battlefield" runs (test/fast4/mx1/move-until.test.ts); a move until any other event is still resolved by hand.
  it('CR 610.3: a move "until" an event other than the source leaving the battlefield is resolved by hand; nothing is moved silently', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const r = runProgram(s, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] }, prog([{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'exile' }, until: { d: 'until', event: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' } } }], [creature]));
    expect(pipeline.manual).toHaveLength(1);
    expect(pipeline.manual[0]!.reason).toMatch(/CR 610\.3/);
    expect(zoneOf(r.state, bears)).toBe('battlefield');
  });

  // M6-0 (m6 design 4.3) left a milestone 6 absence pin here; M6-3 updated it: a face-down move is ONE zoneChange proposal carrying `faceDown` (no longer by hand).
  it('CR 406.3 (M6-3): "exile it face down" is proposed face down, not resolved by hand', () => {
    const s = board();
    runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', name: 'Hill Giant' } }, to: { zone: 'exile', faceDown: true } }]));
    expect(pipeline.manual).toEqual([]);
    expect(pipeline.proposals).toMatchObject([{ ev: 'zoneChange', to: 'exile', destination: { faceDown: true, cause: 'exile' } }]);
  });
});

describe('re-basing (design 3.1, CR 400.7j)', () => {
  it('CR 400.7j, design 3.1 rule 2: a move to a public zone re-bases every binding that holds the object; rule 4: a target handle never re-bases', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const t = structuredClone(s);
    const id = putOnStack(t, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] });
    const program = prog([
      { op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'exile' } },
      { op: 'move', what: { ref: 'bound', name: 'chosen' }, to: { zone: 'battlefield', controller: 'owner' }, as: 'back' },
    ], [creature]);
    const cx = ctxOn(t, id, program);
    bind(cx, 'chosen', [{ id: bears, zone: 'battlefield' }]); // what a chooseObjects step would have bound
    const results = runSteps(cx, program.steps);
    const exiled = t.lki[bears]!.newId!;
    expect(results.map((r) => r.count)).toEqual([1, 1]); // "Exile it, then return it": the second step found the exiled card through the re-based binding
    const returned = t.lki[exiled]!.newId!;
    expect(t.objects[returned]!.zone).toBe('battlefield');
    expect(cx.bindings.get('chosen')!.objects).toEqual([{ id: returned, zone: 'battlefield' }]);
    expect(cx.bindings.get('back')!.objects).toEqual([{ id: returned, zone: 'battlefield' }]);
    expect(cx.targets.get('t0')![0]!.handle).toEqual({ id: bears, zone: 'battlefield' }); // rule 4
  });

  it('CR 400.7j, design 3.1 rule 2: a move to a hand does not re-base (a new hidden object); the stale handle still reads last known information', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const t = structuredClone(s);
    const id = putOnStack(t, { name: 'Lightning Bolt' });
    const program = prog([{ op: 'move', what: { ref: 'bound', name: 'chosen' }, to: { zone: 'hand' } }]);
    const cx = ctxOn(t, id, program);
    bind(cx, 'chosen', [{ id: bears, zone: 'battlefield' }]);
    runSteps(cx, program.steps);
    expect(cx.bindings.get('chosen')!.objects).toEqual([{ id: bears, zone: 'battlefield' }]);
    expect(readInfo(cx, { id: bears, zone: 'battlefield' })!.leftZone).toBe('battlefield');
  });
});
