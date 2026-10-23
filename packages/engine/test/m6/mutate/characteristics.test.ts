/**
 * M6-9 (m6 design 3.7, E5, E16, E20): the characteristics of a merged permanent: the rule-generated 1a effect and the fast path agree (E16), keys and link
 * namespaces of the components' abilities, copying a merged permanent (CR 730.2a, 707.2), a copy effect that applied before the merge (CR 730.2c), face-down
 * components (CR 730.2e) and what other players see of them (CR 708.5).
 */
import { describe, expect, it } from 'vitest';
import { getChars, ptNumbers, viewFor as view, type GameState } from '../../../src/index';
import { computeAll, intrinsicChars } from '../../../src/statics/layers';
import { DOOM, ELVES, BEARS, GEMRAZER, OVER, UNDER, act, drive, find, mutate, resolveTop, table, target, tweak } from './support';
import { pick, SHAPESHIFT } from '../dfc/support';
import { turnUp } from '../face-down/support';
import { copiableValuesOf } from '../../../src/statics/copy';

/** A player's view, read as a state (getChars works on views: m6 design D7). */
const viewFor = (s: GameState, p: 'p1' | 'p2'): GameState => view(s, p) as unknown as GameState;
const pt = (s: GameState, id: string): [number | null, number | null] => {
  const n = ptNumbers(getChars(s, id));
  return [n.power, n.toughness];
};
const keys = (s: GameState, id: string): string[] => getChars(s, id).abilities.map((a) => a.key);
const mana = (s: GameState, id: string): boolean => getChars(s, id).abilities.some((a) => a.def.kind === 'activated' && a.def.isMana === true);

describe('E16: the fast path and computeAll agree for a merged permanent', () => {
  it('over and under, with no other layer source in the state', () => {
    for (const how of [OVER, UNDER]) {
      let s = table([ELVES]);
      const elves = find(s, ELVES, 'battlefield');
      s = resolveTop(mutate(s, elves), [how]);
      expect(s.continuousEffects).toEqual([]);
      expect(intrinsicChars(s, s.objects[elves]!)).toEqual(computeAll(s).get(elves));
    }
  });

  it('two merges (each part of the merge effect is its own 1a effect, CR 730.2a, 613.7)', () => {
    for (const [a, b] of [[OVER, UNDER], [UNDER, OVER], [UNDER, UNDER], [OVER, OVER]] as const) {
      let s = table([ELVES, 'Forest', 'Forest', 'Forest'], { hand: [GEMRAZER] });
      const elves = find(s, ELVES, 'battlefield');
      s = resolveTop(mutate(s, elves), [a]);
      s = resolveTop(mutate(s, elves), [b]);
      expect(s.objects[elves]!.components).toHaveLength(3);
      expect(intrinsicChars(s, s.objects[elves]!)).toEqual(computeAll(s).get(elves));
      expect(mana(s, elves)).toBe(true); // CR 702.140e: every component's abilities
    }
  });
});

describe('E5, E20: the keys and link namespaces of the components\' abilities', () => {
  it('under: the original keeps its printed keys; the merged component\'s abilities are keyed c:merge@<object>@<time>:...', () => {
    let s = table([ELVES]);
    const elves = find(s, ELVES, 'battlefield');
    const before = keys(s, elves);
    s = resolveTop(mutate(s, elves), [UNDER]);
    const after = keys(s, elves);
    expect(after.slice(0, before.length)).toEqual(before);
    const at = s.objects[elves]!.components![1]!.mergedAt;
    expect(at).toBeTypeOf('number');
    expect(after.slice(before.length).every((k) => k.startsWith(`c:merge@${elves}@${at}:`))).toBe(true);
    expect(new Set(after).size).toBe(after.length);
  });

  it('over: the topmost card\'s abilities have its namespace; the original card\'s keep the bare link ids (c:merge@<object>@base)', () => {
    let s = table([ELVES]);
    const elves = find(s, ELVES, 'battlefield');
    s = resolveTop(mutate(s, elves), [OVER]);
    const ks = keys(s, elves);
    const at = s.objects[elves]!.components![0]!.mergedAt;
    expect(ks.some((k) => k.startsWith(`c:merge@${elves}@${at}:`))).toBe(true);
    expect(ks.some((k) => k.startsWith(`c:merge@${elves}@base:`))).toBe(true);
    expect(new Set(ks).size).toBe(ks.length);
  });
});

describe('CR 730.2a, 707.2: copying a merged permanent', () => {
  it('a Clone of Gemrazer-over-Llanowar-Elves is Gemrazer with the Elves\' mana ability; it is one card, not merged', () => {
    let s = table([ELVES, 'Island', 'Island', 'Island', 'Island'], { hand: ['Clone'] });
    const elves = find(s, ELVES, 'battlefield');
    s = resolveTop(mutate(s, elves), [OVER]);
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Clone', 'hand') }), []), [pick(elves)]);
    const clone = find(s, GEMRAZER, 'battlefield');
    const c = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Clone')!;
    expect(clone).toBeDefined();
    expect(getChars(s, c).name).toBe(GEMRAZER);
    expect(pt(s, c)).toEqual([4, 4]);
    expect(mana(s, c)).toBe(true);
    expect(s.objects[c]!.components).toBeUndefined();
  });
});

describe('CR 730.2c: a copy effect that applied before the merge keeps applying', () => {
  it('Gemrazer put under a Clone that copies Grizzly Bears: it is still Grizzly Bears, 2/2, with reach and trample', () => {
    let s = table([BEARS, 'Island', 'Island', 'Island', 'Island'], { hand: ['Clone'] });
    const bears = find(s, BEARS, 'battlefield');
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Clone', 'hand') }), []), [pick(bears)]);
    const clone = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Clone')!;
    expect(getChars(s, clone).name).toBe(BEARS);
    s = resolveTop(mutate(s, clone), [UNDER]);
    expect(getChars(s, clone).name).toBe(BEARS);
    expect(pt(s, clone)).toEqual([2, 2]);
    expect(getChars(s, clone).keywords.map((k) => k.keyword)).toEqual(expect.arrayContaining(['reach', 'trample']));
  });
});

describe('CR 730.2e, 708.5: face-down components', () => {
  const faceDownElves = (): { s: GameState; id: string } => {
    let s = table([ELVES], { hand: ['Test Doom'], defs: [DOOM] });
    const id = find(s, ELVES, 'battlefield');
    s = tweak(s, (x) => {
      x.objects[id]!.faceDown = true;
      x.objects[id]!.faceDownInfo = { by: 'morph', profile: 'plain' };
    });
    return { s, id };
  };

  it('a face-down 2/2 is a non-Human creature: Gemrazer on top makes it face up (Gemrazer, 4/4) with no abilities from the face-down card', () => {
    let { s, id } = faceDownElves();
    s = resolveTop(mutate(s, id), [OVER]);
    const o = s.objects[id]!;
    expect(o.faceDown).toBe(false);
    expect(o.faceDownInfo).toBeUndefined();
    expect(o.components?.map((c) => [c.defId, c.faceDown === true])).toEqual([[GEMRAZER, false], [ELVES, true]]);
    expect(getChars(s, id).name).toBe(GEMRAZER);
    expect(mana(s, id)).toBe(false); // CR 708.2a: a face-down component has no abilities
    expect(s.log.some((l) => /turned face up/i.test(l.text))).toBe(false); // nothing counts it as turned face up (CR 730.2e)
  });

  it('the opponent sees the face-down component as the pseudo-definition, without its card; its controller sees the card; it is revealed as it leaves', () => {
    let { s, id } = faceDownElves();
    s = resolveTop(mutate(s, id), [OVER]);
    const theirs = viewFor(s, 'p2');
    const comp = theirs.objects[id]!.components![1]!;
    expect(comp.defId).toBe('__facedown__');
    expect(comp.cardId).toBeUndefined();
    expect(JSON.stringify(theirs.objects[id])).not.toContain(ELVES);
    expect(viewFor(s, 'p1').objects[id]!.components![1]!.defId).toBe(ELVES);
    expect(getChars(theirs, id).name).toBe(GEMRAZER); // the view can compute it
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doom', 'hand') }), [target(id)]));
    expect(s.log.some((l) => /face-down card of the merged permanent is revealed: it is Llanowar Elves/.test(l.text) && l.rules?.includes('CR 708.9'))).toBe(true);
  });

  it('Gemrazer under a face-down creature: it stays a face-down 2/2 (the 1b profile applies after the merge)', () => {
    let { s, id } = faceDownElves();
    s = resolveTop(mutate(s, id), [UNDER]);
    expect(s.objects[id]!.faceDown).toBe(true);
    expect(pt(s, id)).toEqual([2, 2]);
    expect(getChars(s, id).name).toBe('');
    expect(getChars(viewFor(s, 'p2'), id).name).toBe('');
  });
});

describe('CR 730.2f: a face-down merged permanent turned face up turns each face-down component face up', () => {
  it('manifested Llanowar Elves with Gemrazer under it, turned face up: no component stays face down; a Gemrazer put on top later keeps the Elves\' mana ability', () => {
    let s = table([ELVES, 'Forest', 'Forest', 'Forest', 'Forest'], { hand: [GEMRAZER] });
    const id = find(s, ELVES, 'battlefield');
    s = tweak(s, (x) => {
      x.objects[id]!.faceDown = true;
      x.objects[id]!.faceDownInfo = { by: 'manifest', profile: 'plain' };
    });
    s = resolveTop(mutate(s, id), [UNDER]);
    expect(s.objects[id]!.faceDown).toBe(true);
    s = turnUp(s, id, 'manifest');
    expect(s.objects[id]!.faceDown).toBe(false);
    expect(s.objects[id]!.components!.every((c) => c.faceDown !== true)).toBe(true); // CR 730.2f
    expect(viewFor(s, 'p2').objects[id]!.components![0]!.defId).toBe(ELVES); // the opponent sees the card that is face up now
    expect(mana(s, id)).toBe(true);
    s = resolveTop(mutate(s, id), [OVER]);
    expect(getChars(s, id).name).toBe(GEMRAZER);
    expect(mana(s, id)).toBe(true); // CR 702.140e: the Elves card is face up, so the merged permanent has its ability
  });
});

describe('CR 730.2c: a copy effect that began after an earlier merge keeps applying when a spell is put under', () => {
  it('Gemrazer over Elves, then a copy of Grizzly Bears until end of turn, then another Gemrazer under: still Grizzly Bears, 2/2, with reach and trample; flagged', () => {
    let s = table([ELVES, BEARS, 'Forest', 'Forest', 'Forest'], { hand: [GEMRAZER, 'Test Shapeshift'], defs: [SHAPESHIFT] });
    const id = find(s, ELVES, 'battlefield');
    const bears = find(s, BEARS, 'battlefield');
    s = resolveTop(mutate(s, id), [OVER]);
    expect(getChars(s, id).name).toBe(GEMRAZER);
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shapeshift', 'hand') }), [target(id), target(bears)]));
    expect(getChars(s, id).name).toBe(BEARS);
    s = resolveTop(mutate(s, id), [UNDER]);
    expect(getChars(s, id).name).toBe(BEARS); // CR 730.2c: the copy effect still applies; putting a card under doesn't change the topmost values
    expect(pt(s, id)).toEqual([2, 2]);
    expect(getChars(s, id).keywords.map((k) => k.keyword)).toEqual(expect.arrayContaining(['reach', 'trample'])); // CR 702.140e
    const cv = copiableValuesOf(s, id);
    expect(cv.defId).toBe(BEARS);
    expect(cv.alsoAbilitiesOf?.map((x) => x.defId)).toEqual([GEMRAZER]);
    // whether the abilities of the cards merged before the copy effect began come back is not settled: marked for the players
    expect(s.log.some((l) => l.level === 'manual' && l.rules?.includes('CR 730.2c'))).toBe(true);
  });

  it('Gemrazer under a Clone of Grizzly Bears (the copy began before any merge): no manual-level line', () => {
    let s = table([BEARS, 'Island', 'Island', 'Island', 'Island'], { hand: ['Clone'] });
    const bears = find(s, BEARS, 'battlefield');
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Clone', 'hand') }), []), [pick(bears)]);
    const clone = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Clone')!;
    s = resolveTop(mutate(s, clone), [UNDER]);
    expect(getChars(s, clone).name).toBe(BEARS);
    expect(s.log.some((l) => l.level === 'manual')).toBe(false);
  });
});

describe('views: the components\' definitions are sent (core/view-parts/components.ts)', () => {
  it('the opponent\'s view computes the merged permanent with every component\'s abilities', () => {
    let s = table([ELVES]);
    const elves = find(s, ELVES, 'battlefield');
    s = resolveTop(mutate(s, elves), [OVER]);
    const theirs = viewFor(s, 'p2');
    expect(theirs.defs[ELVES]).toBeDefined();
    expect(mana(theirs, elves)).toBe(true);
    expect(getChars(theirs, elves)).toEqual(getChars(s, elves));
  });
});
