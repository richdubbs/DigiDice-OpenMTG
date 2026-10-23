/**
 * WP14: the `copy` op. Copies of spells and abilities (CR 707.10, 707.10c, 702.40a) and tokens that are copies of objects (CR 707.2, 707.8a, 111).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../../../src/core/game';
import { moveObject } from '../../../src/core/zones';
import { charsOfObject } from '../../../src/rules/characteristics';
import type { EffectProgram, EffectStep, GameState, TargetSpec } from '../../../src/index';
import { chosenObject, chosenPlayer } from '../eval/helpers';
import { find, scenario, tweak } from '../helpers';
import { pipeline } from '../zones/pipeline';
import { decisionOf, putOnStack, runProgram } from '../zones/support';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('../zones/pipeline')).proposeModule }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('../zones/pipeline')).manualModule }));

beforeEach(() => pipeline.reset());

const spellSpec: TargetSpec = { id: 't0', kind: 'spell', filter: { types: ['Instant', 'Sorcery'] }, min: 1, max: 1, text: 'target instant or sorcery spell' };
const twincast: EffectProgram = { targets: [spellSpec], steps: [{ op: 'copy', what: { ref: 'target', id: 't0' }, result: 'spell', who: { ref: 'you' }, newTargets: 'may', as: 'c' }] };
const prog = (steps: EffectStep[], targets: TargetSpec[] = []): EffectProgram => ({ targets, steps });

/** p2's Lightning Bolt on the stack, targeting p1 (its program: "deals 3 damage to any target"). */
function board(): { s: GameState; bolt: string } {
  const base = scenario(['Lightning Bolt', 'Twincast', 'Fork', 'Grizzly Bears', 'Hill Giant', 'Delver of Secrets // Insectile Aberration'], {
    p1: { hand: ['Twincast', 'Fork'], battlefield: ['Hill Giant', 'Delver of Secrets // Insectile Aberration'] },
    p2: { battlefield: ['Grizzly Bears'] },
  });
  let bolt = '';
  const s = tweak(base, (t) => {
    const id = Object.keys(t.defs).find((k) => t.defs[k]!.name === 'Lightning Bolt')!;
    const def = t.defs[id]!;
    t.defs = { ...t.defs, [id]: { ...def, faces: [{ ...def.faces[0]!, abilities: [{ kind: 'spell', text: '~ deals 3 damage to any target.', effect: { targets: [{ id: 't0', kind: 'anyTarget', min: 1, max: 1, text: 'any target' }], steps: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 3 }] } }] }] } };
    bolt = putOnStack(t, { name: 'Lightning Bolt', owner: 'p2', targets: [[chosenPlayer('p1')]], x: 0, costsPaid: { kicked: 1 } });
    t.objects[bolt]!.stack!.flags = ['cantBeCountered'];
  });
  return { s, bolt };
}

describe('copies of spells (CR 707.10)', () => {
  it('CR 707.10: the copy goes on the stack under its new controller with the original\'s choices; it is not cast (spellCopied, not spellCast)', () => {
    const { s, bolt } = board();
    const r = runProgram(s, { name: 'Twincast', targets: [[chosenObject(bolt)]] }, twincast, [{ kind: 'yesNo', yes: false }]);
    const copyId = r.state.zones.stack[r.state.zones.stack.length - 1]!;
    const c = r.state.objects[copyId]!;
    expect([c.kind, c.owner, c.controller, c.defId, c.zone]).toEqual(['spellCopy', 'p1', 'p1', 'Lightning Bolt', 'stack']);
    expect(c.stack).toMatchObject({ isCopy: true, targets: [[{ kind: 'player', id: 'p1' }]], x: 0, costsPaid: { kicked: 1 } });
    expect(c.stack!.flags).toBeUndefined(); // "can't be countered" came from the mana spent on the original (CR 106.6); the copy wasn't cast with it
    expect(r.cx.g.events).toContainEqual({ type: 'spellCopied', objectId: copyId, copyOf: bolt });
    expect(r.cx.g.events).toContainEqual({ type: 'becameTarget', objectId: 'p1', byStackId: copyId, byController: 'p1' });
    expect(r.cx.g.events.some((e) => e.type === 'spellCast')).toBe(false);
    expect(r.cx.bindings.get('c')!.objects).toEqual([{ id: copyId, zone: 'stack' }]);
  });

  it('CR 707.10c: "you may choose new targets": a changed target must be legal, an unchanged one may stay; the number of targets is the same', () => {
    const { s, bolt } = board();
    const d = decisionOf(() => runProgram(s, { name: 'Twincast', targets: [[chosenObject(bolt)]] }, twincast, [{ kind: 'yesNo', yes: true }]));
    expect(d.kind).toBe('chooseTargets');
    const ct = d as Extract<typeof d, { kind: 'chooseTargets' }>;
    expect([ct.min, ct.max]).toEqual([1, 1]);
    expect(ct.players.sort()).toEqual(['p1', 'p2']);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    expect(ct.objects).toContain(bears);
    const r = runProgram(s, { name: 'Twincast', targets: [[chosenObject(bolt)]] }, twincast, [{ kind: 'yesNo', yes: true }, { kind: 'chooseTargets', targets: [chosenObject(bears)] }]);
    const copy = r.state.objects[r.state.zones.stack[r.state.zones.stack.length - 1]!]!;
    expect(copy.stack!.targets).toEqual([[{ kind: 'object', id: bears }]]);
    expect(r.state.objects[bolt]!.stack!.targets).toEqual([[{ kind: 'player', id: 'p1' }]]); // the original keeps its own
  });

  it('CR 707.10c: `count` makes several copies, each with its own target choice', () => {
    const { s, bolt } = board();
    const r = runProgram(s, { name: 'Twincast', targets: [[chosenObject(bolt)]] }, { ...twincast, steps: [{ ...twincast.steps[0]!, count: 2 } as EffectStep] }, [{ kind: 'yesNo', yes: false }, { kind: 'yesNo', yes: false }]);
    expect(r.state.zones.stack.filter((id) => r.state.objects[id]!.kind === 'spellCopy')).toHaveLength(2);
  });

  it('CR 702.40a, 608.2h: storm copies the spell even after it has left the stack, from its last known information', () => {
    const { s, bolt } = board();
    const t = structuredClone(s);
    moveObject(new Game(t), bolt, 'graveyard', { cause: 'counter' }); // countered in response
    const r = runProgram(t, { name: 'Lightning Bolt', owner: 'p2', kind: 'triggered', sourceId: bolt }, prog([{ op: 'copy', what: { ref: 'self' }, result: 'spell', who: { ref: 'you' }, count: 2 }]));
    const copies = r.state.zones.stack.filter((id) => r.state.objects[id]!.kind === 'spellCopy');
    expect(copies).toHaveLength(2);
    expect(r.state.objects[copies[0]!]!.stack!.targets).toEqual([[{ kind: 'player', id: 'p1' }]]);
  });

  it('CR 707.10: a copy of an activated ability is an ability with the same source', () => {
    const { s } = board();
    const t = structuredClone(s);
    const giant = find(t, 'Hill Giant', 'battlefield');
    const ab = putOnStack(t, { name: 'Hill Giant', kind: 'activated', sourceId: giant });
    const abilitySpec: TargetSpec = { id: 't0', kind: 'ability', min: 1, max: 1, text: 'target activated ability' };
    const r = runProgram(t, { name: 'Twincast', targets: [[chosenObject(ab)]] }, prog([{ op: 'copy', what: { ref: 'target', id: 't0' }, result: 'spell', who: { ref: 'you' } }], [abilitySpec]));
    const copy = r.state.objects[r.state.zones.stack[r.state.zones.stack.length - 1]!]!;
    expect([copy.kind, copy.stack!.sourceId, copy.stack!.isCopy]).toEqual(['ability', giant, true]);
  });

  // CLOUD std-misc: a spell copy's color exception runs (effects/handlers/token-defs.ts#exceptedSpellDef); it was resolved by hand before (milestone 6 pin)
  it('CR 707.9b, 707.10: Fork\'s "except that the copy is red" is part of the copy\'s copiable values: the copy goes on the stack red, the original keeps its colors', () => {
    const { s, bolt } = board();
    const forkAs = (color: 'R' | 'G'): EffectProgram => ({ targets: [spellSpec], steps: [{ op: 'copy', what: { ref: 'target', id: 't0' }, result: 'spell', who: { ref: 'you' }, newTargets: 'may', except: [{ layer: 5, colors: { set: [color] } }] }] });
    const r = runProgram(s, { name: 'Fork', targets: [[chosenObject(bolt)]] }, forkAs('R'), [{ kind: 'yesNo', yes: false }]);
    expect(pipeline.manual).toHaveLength(0);
    const copy = r.state.objects[r.state.zones.stack[r.state.zones.stack.length - 1]!]!;
    expect([copy.kind, copy.controller, r.state.defs[copy.defId]!.name, charsOfObject(r.state, copy).colors]).toEqual(['spellCopy', 'p1', 'Lightning Bolt', ['R']]);
    expect(copy.stack).toMatchObject({ isCopy: true, targets: [[{ kind: 'player', id: 'p1' }]] });
    // the exception sets the colors (layer 5 of the copiable values): "except that the copy is green" makes a green copy of the red original
    const g = runProgram(s, { name: 'Fork', targets: [[chosenObject(bolt)]] }, forkAs('G'), [{ kind: 'yesNo', yes: false }]);
    const green = g.state.objects[g.state.zones.stack[g.state.zones.stack.length - 1]!]!;
    expect([charsOfObject(g.state, green).colors, charsOfObject(g.state, g.state.objects[bolt]!).colors]).toEqual([['G'], ['R']]);
  });

  it('CR 707.10f (M6-2): a copy of a permanent spell is put onto the stack (it becomes a token as it resolves: test/m6/copy)', () => {
    const { s } = board();
    const t = structuredClone(s);
    const bears = putOnStack(t, { name: 'Grizzly Bears', owner: 'p2' });
    const anySpell: TargetSpec = { id: 't0', kind: 'spell', min: 1, max: 1, text: 'target spell' };
    const r = runProgram(t, { name: 'Twincast', targets: [[chosenObject(bears)]] }, prog([{ op: 'copy', what: { ref: 'target', id: 't0' }, result: 'spell', who: { ref: 'you' } }], [anySpell]));
    expect(pipeline.manual).toHaveLength(0);
    expect(r.state.zones.stack.filter((id) => r.state.objects[id]!.kind === 'spellCopy')).toHaveLength(1);
  });
});

describe('token copies (CR 707.2, 111)', () => {
  const tokensOf = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');

  it('CR 707.2: a token that is a copy of a creature has its copiable values (name, mana cost, types, P/T, abilities), not its status or counters', () => {
    const { s } = board();
    const t = tweak(s, (x) => { const b = x.objects[find(x, 'Grizzly Bears', 'battlefield')]!; b.counters['+1/+1'] = 2; b.tapped = true; });
    const bears = find(t, 'Grizzly Bears', 'battlefield');
    const creature: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' };
    const r = runProgram(t, { name: 'Twincast', targets: [[chosenObject(bears)]] }, prog([{ op: 'copy', what: { ref: 'target', id: 't0' }, result: 'token', who: { ref: 'you' } }], [creature]));
    const [tok] = tokensOf(r.state);
    const o = r.state.objects[tok!]!;
    const def = r.state.defs[o.defId]!;
    expect([o.controller, o.owner, o.tapped, o.counters]).toEqual(['p1', 'p1', false, {}]);
    expect([def.isToken, def.name, def.faces[0]!.power, def.faces[0]!.toughness]).toEqual([true, 'Grizzly Bears', '2', '2']);
    expect(def.faces[0]!.manaCost).toEqual(r.state.defs['Grizzly Bears']!.faces[0]!.manaCost);
  });

  it('CR 707.8a: a token copy of a double-faced permanent is a double-faced token', () => {
    const { s } = board();
    const r = runProgram(s, { name: 'Twincast' }, prog([{ op: 'copy', what: { ref: 'each', filter: { name: 'Delver of Secrets' } }, result: 'token', who: { ref: 'you' } }]));
    const def = r.state.defs[r.state.objects[tokensOf(r.state)[0]!]!.defId]!;
    expect([def.layout, def.faces.length, r.state.objects[tokensOf(r.state)[0]!]!.face]).toEqual(['double_faced_token', 2, 0]);
  });

  // M6-4 (m6 design 3.6): a token copy of a transformed permanent is double-faced and enters back face up (test/m6/dfc/transform.test.ts)
  it('CR 707.8a: a token copy of a transformed permanent enters back face up (M6-4: no longer by hand)', () => {
    const { s } = board();
    const t = tweak(s, (x) => { x.objects[find(x, 'Delver of Secrets // Insectile Aberration', 'battlefield')]!.face = 1; });
    const r = runProgram(t, { name: 'Twincast' }, prog([{ op: 'copy', what: { ref: 'each', filter: { name: 'Insectile Aberration' } }, result: 'token', who: { ref: 'you' } }]));
    expect(pipeline.manual).toHaveLength(0);
    expect(tokensOf(r.state)).toHaveLength(1); // (the face it enters with is the real pipeline's: this file's pipeline is a stand-in)
  });

  it('CR 608.2h: a token copy of a creature that has left the battlefield uses its last known information', () => {
    const { s } = board();
    const r = runProgram(s, { name: 'Twincast' }, prog([
      { op: 'destroy', what: { ref: 'each', filter: { name: 'Grizzly Bears' } }, as: 'dead' },
      { op: 'copy', what: { ref: 'bound', name: 'dead' }, result: 'token', who: { ref: 'you' } },
    ]));
    expect(tokensOf(r.state).map((id) => r.state.defs[r.state.objects[id]!.defId]!.name)).toEqual(['Grizzly Bears']);
  });
});
