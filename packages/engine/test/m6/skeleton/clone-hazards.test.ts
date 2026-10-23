/**
 * M6-0 (m6 design 2.2): the clone hazards of milestone 5 design 4.3, one case per new `GameObject` field. `util/clone.ts#cloneObject` deep-copies the nested
 * records (`faceDownInfo`, `components`) and carries the scalar fields, so an action that edits them in place can never corrupt the state it started from.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, cloneState, type GameObject, type GameState } from '../../../src/index';
import { cloneObject } from '../../../src/util/clone';
import { find, scenario, tweak } from '../helpers';

const SCALARS = { faceUpX: 3, prototyped: true, classLevel: 2, solved: true, prepared: true, preparedCopy: 'o901', preparedFor: 'o902', transformedAt: 17 } as const;

function withM6Fields(): { s: GameState; bears: string } {
  const s0 = scenario(['Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] } });
  const bears = find(s0, 'Grizzly Bears', 'battlefield');
  const s = tweak(s0, (t) => {
    const o = t.objects[bears]! as GameObject;
    o.faceDown = true;
    o.faceDownInfo = { by: 'morph', profile: 'plain' };
    o.components = [{ kind: 'card', defId: 'Grizzly Bears', cardId: 'c1', owner: 'p1' }, { kind: 'token', defId: 'Hill Giant', owner: 'p1', faceDown: true }];
    Object.assign(o, SCALARS);
  });
  return { s, bears };
}

describe('M6-0, design 4.3: cloneObject copies the milestone 6 object fields', () => {
  it('faceDownInfo and components are deep-copied: editing a clone\'s leaves the base state untouched', () => {
    const { s, bears } = withM6Fields();
    const before = JSON.stringify(s.objects[bears]);
    const copy = cloneState(s);
    const o = copy.objects[bears]!;
    expect(o.faceDownInfo).toEqual(s.objects[bears]!.faceDownInfo);
    expect(o.faceDownInfo).not.toBe(s.objects[bears]!.faceDownInfo);
    expect(o.components).toEqual(s.objects[bears]!.components);
    expect(o.components).not.toBe(s.objects[bears]!.components);
    expect(o.components![0]).not.toBe(s.objects[bears]!.components![0]);
    o.faceDownInfo!.by = 'megamorph';
    o.faceDownInfo!.profile = 'ward2';
    o.components![0]!.defId = 'Hill Giant';
    o.components!.push({ kind: 'card', defId: 'x', owner: 'p2' });
    expect(JSON.stringify(s.objects[bears])).toBe(before);
  });

  it('the scalar fields are carried by the clone and editing them leaves the base untouched', () => {
    const { s, bears } = withM6Fields();
    const c = cloneObject(s.objects[bears]!);
    for (const [k, v] of Object.entries(SCALARS)) expect((c as unknown as Record<string, unknown>)[k], k).toBe(v);
    c.classLevel = 3;
    c.solved = false;
    expect(s.objects[bears]!.classLevel).toBe(2);
    expect(s.objects[bears]!.solved).toBe(true);
  });

  it('cloneObject does not invent the records on an ordinary object', () => {
    const { s } = withM6Fields();
    const plain = cloneObject(s.objects[find(s, 'Hill Giant', 'battlefield')]!);
    for (const k of ['faceDownInfo', 'components', ...Object.keys(SCALARS)]) expect(k in plain, k).toBe(false);
  });

  it('an action applied to a state with the fields never changes that state (replay stays deterministic)', () => {
    const { s } = withM6Fields();
    const before = JSON.stringify(s);
    const r = applyAction(s, { type: 'pass', player: 'p1' });
    expect(r.error).toBeUndefined();
    expect(JSON.stringify(s)).toBe(before);
  });
});
