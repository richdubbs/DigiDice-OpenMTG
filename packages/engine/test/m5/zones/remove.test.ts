/**
 * WP14: `destroy` (CR 701.8, 701.19, 702.12b), `sacrifice` and `sacrificeChoice` (CR 701.21, 608.2e), `counter` (CR 701.6, 101.2, 702.34a). Each acts through the
 * faked WP11 pipeline (pipeline.ts): a destruction is a `destroy` proposal, a sacrifice or a countered spell a `zoneChange` with its cause.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addRegenerationShield } from '../../../src/rules/destroy';
import { Game } from '../../../src/core/game';
import type { AbilityDef, EffectProgram, EffectStep, GameState, TargetSpec } from '../../../src/index';
import { bind, chosenObject, ctxOn } from '../eval/helpers';
import { find, keyword, scenario, synth } from '../helpers';
import { pipeline } from './pipeline';
import { decisionOf, putOnStack, runProgram, runSteps } from './support';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).proposeModule }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).manualModule }));

beforeEach(() => pipeline.reset());

const creature: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' };
const spellSpec: TargetSpec = { id: 't0', kind: 'spell', min: 1, max: 1, text: 'target spell' };
const prog = (steps: EffectStep[], targets: TargetSpec[] = []): EffectProgram => ({ targets, steps });
const allCreatures = { ref: 'each' as const, filter: { types: ['Creature'] } };
const tough = synth({ name: 'Test Wall', cost: '{1}', type: 'Creature — Wall', pt: ['0', '4'], abilities: [keyword('indestructible')] as AbilityDef[] });

function board(): GameState {
  return scenario(['Lightning Bolt', 'Shock', 'Counterspell', 'Grizzly Bears', 'Hill Giant', 'Llanowar Elves', 'Forest'], {
    defs: [tough],
    p1: { hand: ['Lightning Bolt', 'Shock'], battlefield: ['Hill Giant', 'Llanowar Elves', 'Forest'] },
    p2: { battlefield: ['Grizzly Bears', 'Test Wall', 'Forest'] },
  });
}

/** Regeneration shield on a permanent (what a resolved "regenerate" leaves, CR 701.19a). */
function shielded(s: GameState, id: string): GameState {
  const t = structuredClone(s);
  addRegenerationShield(new Game(t), id);
  return t;
}

describe('destroy (CR 701.8)', () => {
  it('CR 701.8a: destroy target creature: one `destroy` proposal; the creature goes to its owner\'s graveyard', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const r = runProgram(s, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] }, prog([{ op: 'destroy', what: { ref: 'target', id: 't0' }, as: 'gone' }], [creature]));
    // FAST5X E17 (CR 608.2h): a named destroy step also reports what it destroyed as it last existed (StepResult.before: "a creature you controlled was destroyed this way")
    expect(r.results[0]).toMatchObject({ performed: true, count: 1, before: [{ leftZone: 'battlefield', object: { id: bears, controller: 'p2' } }] });
    expect(pipeline.proposals).toEqual([{ ev: 'destroy', object: { id: bears, zone: 'battlefield' }, canRegenerate: true }]);
    expect(r.state.zones.graveyard['p2']).toContain(r.state.lki[bears]!.newId);
    expect(r.cx.bindings.get('gone')!.objects).toEqual([{ id: r.state.lki[bears]!.newId!, zone: 'graveyard' }]);
  });

  it('CR 702.12b: an indestructible permanent is not destroyed and the step counts it as not done', () => {
    const s = board();
    const wall = find(s, 'Test Wall', 'battlefield');
    const r = runProgram(s, { name: 'Lightning Bolt', targets: [[chosenObject(wall)]] }, prog([{ op: 'destroy', what: { ref: 'target', id: 't0' } }], [creature]));
    expect(r.results[0]).toEqual({ performed: false, count: 0 });
    expect(r.state.objects[wall]!.zone).toBe('battlefield');
  });

  it('CR 608.2f, 701.19c: "Destroy all creatures. They can\'t be regenerated." destroys each creature, shields don\'t apply (Wrath of God trace, design 8.5)', () => {
    const s = shielded(board(), find(board(), 'Grizzly Bears', 'battlefield', 'p2'));
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'destroy', what: allCreatures, regeneration: 'cant' }]));
    expect(pipeline.proposals.every((p) => p.ev === 'destroy' && !p.canRegenerate)).toBe(true);
    expect(pipeline.proposals).toHaveLength(4);
    const left = r.state.zones.battlefield.map((id) => r.state.objects[id]!.defId);
    expect(left.sort()).toEqual(['Forest', 'Forest', 'Test Wall']); // indestructible survives (CR 702.12b)
    expect(r.results[0]!.count).toBe(3);
  });

  it('CR 701.19a: without "can\'t be regenerated", a regeneration shield replaces the destruction', () => {
    const base = board();
    const bears = find(base, 'Grizzly Bears', 'battlefield', 'p2');
    const s = shielded(base, bears);
    const r = runProgram(s, { name: 'Lightning Bolt', targets: [[chosenObject(bears)]] }, prog([{ op: 'destroy', what: { ref: 'target', id: 't0' } }], [creature]));
    expect(r.results[0]!.performed).toBe(false);
    expect(r.state.objects[bears]!.tapped).toBe(true);
  });

  it('CR 400.7j, design 3.1 rule 2: "destroy it, then return it to its owner\'s hand": the binding is re-based onto the card in the graveyard', () => {
    const s = board();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const t = structuredClone(s);
    const id = putOnStack(t, { name: 'Lightning Bolt' });
    const program = prog([{ op: 'destroy', what: { ref: 'bound', name: 'it' } }, { op: 'move', what: { ref: 'bound', name: 'it' }, to: { zone: 'hand' } }]);
    const cx = ctxOn(t, id, program);
    bind(cx, 'it', [{ id: bears, zone: 'battlefield' }]);
    const results = runSteps(cx, program.steps);
    expect(results.map((r) => r.count)).toEqual([1, 1]);
    expect(t.zones.hand['p2']).toContain(t.lki[t.lki[bears]!.newId!]!.newId);
  });
});

describe('sacrifice (CR 701.21)', () => {
  it('CR 701.21a: "sacrifice it": its controller moves it to its owner\'s graveyard, cause "sacrifice" (the action the trigger normalizer reads)', () => {
    const s = board();
    const giant = find(s, 'Hill Giant', 'battlefield', 'p1');
    const r = runProgram(s, { name: 'Hill Giant', kind: 'activated', sourceId: giant }, prog([{ op: 'sacrifice', what: { ref: 'self' } }]));
    expect(r.results[0]).toEqual({ performed: true, count: 1 });
    expect(pipeline.proposals[0]).toMatchObject({ ev: 'zoneChange', from: 'battlefield', to: 'graveyard', destination: { cause: 'sacrifice' } });
    expect(r.state.log.some((l) => /sacrifices Hill Giant/.test(l.text) && l.rules?.includes('CR 701.21a'))).toBe(true);
  });

  it('CR 701.21a: sacrifice is not destruction: indestructible and regeneration don\'t apply', () => {
    const s = shielded(board(), find(board(), 'Test Wall', 'battlefield'));
    // p2's own effect (CR 701.21a: only the controller of a permanent can sacrifice it)
    const r = runProgram(s, { name: 'Lightning Bolt', owner: 'p2' }, prog([{ op: 'sacrifice', what: { ref: 'each', filter: { name: 'Test Wall' } } }]));
    expect(r.results[0]!.count).toBe(1);
    expect(r.state.zones.graveyard['p2']!.some((id) => r.state.objects[id]!.defId === 'Test Wall')).toBe(true);
  });

  it('CR 608.2e: "each player sacrifices a creature": the active player chooses first, then the other; the sacrifices happen together', () => {
    const s = board();
    const step: EffectStep = { op: 'sacrificeChoice', who: { ref: 'each', who: 'player' }, filter: { types: ['Creature'] }, count: 1 };
    const d1 = decisionOf(() => runProgram(s, { name: 'Lightning Bolt' }, prog([step])));
    expect([d1.kind, d1.player]).toEqual(['chooseObjects', 'p1']);
    const elves = find(s, 'Llanowar Elves', 'battlefield');
    const d2 = decisionOf(() => runProgram(s, { name: 'Lightning Bolt' }, prog([step]), [{ kind: 'chooseObjects', ids: [elves] }]));
    expect([d2.kind, d2.player]).toEqual(['chooseObjects', 'p2']);
    expect(pipeline.proposals).toEqual([]); // nothing was sacrificed while a player was still choosing
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([step]), [{ kind: 'chooseObjects', ids: [elves] }, { kind: 'chooseObjects', ids: [bears] }]);
    expect(r.results[0]!.count).toBe(2);
    expect(r.state.objects[elves]).toBeUndefined();
    expect(r.state.objects[bears]).toBeUndefined();
  });

  it('CR 608.2d: with no more matching permanents than the count there is no choice; only permanents the player controls count (CR 701.21a)', () => {
    const s = board();
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'sacrificeChoice', who: { ref: 'each', who: 'opponent' }, filter: { types: ['Land'] }, count: 2 }]));
    expect(r.results[0]!.count).toBe(1); // p2's one Forest; p1's Forest is not theirs
    expect(r.state.zones.battlefield.some((id) => r.state.objects[id]!.defId === 'Forest' && r.state.objects[id]!.controller === 'p1')).toBe(true);
  });

  it('CR 701.21a: "sacrifice all creatures you control" (`mode: all`)', () => {
    const s = board();
    const r = runProgram(s, { name: 'Lightning Bolt' }, prog([{ op: 'sacrificeChoice', who: { ref: 'you' }, filter: { types: ['Creature'] }, count: 0, mode: 'all' }]));
    expect(r.results[0]!.count).toBe(2);
  });
});

describe('counter (CR 701.6)', () => {
  function withSpell(s: GameState, opts: { flashback?: boolean; flags?: string[] } = {}): { t: GameState; bolt: string } {
    const t = structuredClone(s);
    const bolt = putOnStack(t, { name: 'Lightning Bolt', owner: 'p2', ...(opts.flashback ? { costsPaid: { alternative: 'flashback' }, castFrom: 'graveyard' as const } : {}) });
    if (opts.flags) t.objects[bolt]!.stack!.flags = opts.flags;
    return { t, bolt };
  }

  it('CR 701.6a: "counter target spell": it goes to its owner\'s graveyard (Counterspell)', () => {
    const { t, bolt } = withSpell(board());
    const r = runProgram(t, { name: 'Counterspell', targets: [[chosenObject(bolt)]] }, prog([{ op: 'counter', what: { ref: 'target', id: 't0' } }], [spellSpec]));
    expect(r.results[0]).toEqual({ performed: true, count: 1 });
    expect(r.state.zones.graveyard['p2']).toContain(r.state.lki[bolt]!.newId);
    expect(pipeline.proposals[0]).toMatchObject({ ev: 'zoneChange', from: 'stack', to: 'graveyard', destination: { cause: 'counter' } });
    expect(r.cx.g.events.some((e) => e.type === 'countered' && e.objectId === bolt)).toBe(true);
  });

  it('CR 101.2, 106.6: a spell that can\'t be countered stays on the stack', () => {
    const { t, bolt } = withSpell(board(), { flags: ['cantBeCountered'] });
    const r = runProgram(t, { name: 'Counterspell', targets: [[chosenObject(bolt)]] }, prog([{ op: 'counter', what: { ref: 'target', id: 't0' } }], [spellSpec]));
    expect(r.results[0]!.performed).toBe(false);
    expect(r.state.objects[bolt]!.zone).toBe('stack');
  });

  it('CR 702.34a: a countered flashback spell is exiled', () => {
    const { t, bolt } = withSpell(board(), { flashback: true });
    const r = runProgram(t, { name: 'Counterspell', targets: [[chosenObject(bolt)]] }, prog([{ op: 'counter', what: { ref: 'target', id: 't0' } }], [spellSpec]));
    expect(r.state.zones.exile).toContain(r.state.lki[bolt]!.newId);
  });

  it('CR 701.6a, Memory Lapse: "put it on top of its owner\'s library instead" (`to`)', () => {
    const { t, bolt } = withSpell(board());
    const r = runProgram(t, { name: 'Counterspell', targets: [[chosenObject(bolt)]] }, prog([{ op: 'counter', what: { ref: 'target', id: 't0' }, to: { zone: 'library', position: 'top' } }], [spellSpec]));
    expect(r.state.zones.library['p2']![0]).toBe(r.state.lki[bolt]!.newId);
  });

  it('CR 701.6a, 113.7a: a countered ability is removed from the stack and ceases to exist', () => {
    const s = board();
    const t = structuredClone(s);
    const ab = putOnStack(t, { name: 'Hill Giant', kind: 'activated', sourceId: find(t, 'Hill Giant', 'battlefield') });
    const abilitySpec: TargetSpec = { id: 't0', kind: 'ability', min: 1, max: 1, text: 'target activated ability' };
    const r = runProgram(t, { name: 'Counterspell', targets: [[chosenObject(ab)]] }, prog([{ op: 'counter', what: { ref: 'target', id: 't0' } }], [abilitySpec]));
    expect(r.results[0]!.count).toBe(1);
    expect(r.state.objects[ab]).toBeUndefined();
    expect(r.state.zones.stack).not.toContain(ab);
    expect(r.cx.g.events.some((e) => e.type === 'abilityCountered' && e.objectId === ab)).toBe(true);
  });
});
