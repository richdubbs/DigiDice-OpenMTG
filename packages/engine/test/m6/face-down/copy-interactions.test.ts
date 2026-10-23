/**
 * M6-3 tests that need M6-2's copy effects (layer 1a; m6 design 4.3: "a test that needs two packages lives in the directory of the one that merges later";
 * M6-3 merges after M6-2). They run when the layer 1a applier exists (statics/copy.ts#LAYER_1A); on a branch without M6-2 they are skipped.
 *
 *  - CR 708.10: a face-down permanent that becomes a copy of another permanent stays the face-down 2/2 (layer 1b after 1a); turned face up, it is the copy.
 *  - CR 707.3 (examples 3-4), 702.37e: the morph cost is the one it would have face up, its 1a copy effects included: a face-down Grinning Demon that became a
 *    copy of Branchsnap Lorian turns up for {G}; one that became a copy of Wandering Ones has no morph face up and can't be turned up that way.
 *  - CR 707.2, 708.2: the copiable values of a face-down permanent are its profile (the pseudo-definition), never the hidden card.
 */
import { describe, expect, it } from 'vitest';
import type { CopiableValues, GameState, ObjectId } from '../../../src/index';
import * as copy from '../../../src/statics/copy';
import { getChars, lands, pt, putFaceDown, scenario, turnUp, turnUpActions, tweak } from './support';

const HAS_1A = copy.LAYER_1A !== null;
const copiableValuesOf = (copy as unknown as { copiableValuesOf?: (s: GameState, id: ObjectId) => CopiableValues }).copiableValuesOf;

/** A resolved copy effect (CR 707.2, 611.2c) that makes `id` a copy of a card of the definition `of` from now on, as M6-2's beginCopy records it. */
function becomesCopy(s: GameState, id: ObjectId, of: string): GameState {
  return tweak(s, (t) => {
    const eid = `e${t.counters.effect++}`;
    t.continuousEffects.push({
      id: eid, source: null, sourceName: 'test copy effect', controller: 'p1', timestamp: t.counters.timestamp++, startedTurn: t.turn.number, duration: { d: 'permanent' },
      effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id, zone: 'battlefield' }] }, mods: [{ layer: '1a', copyOf: { ref: 'fixed', objects: [{ id, zone: 'battlefield' }] } }] },
      copy: { defId: of, face: 0, except: [] },
    } as never);
  });
}

describe('CR 708.10, 707.3 with copy effects (needs M6-2)', () => {
  it.runIf(HAS_1A)('CR 708.10: a face-down Grinning Demon that becomes a copy of Branchsnap Lorian stays a 2/2; CR 707.3: it is turned up for {G} and is Branchsnap Lorian', () => {
    let [s, id] = putFaceDown(scenario(['Grinning Demon', 'Branchsnap Lorian', 'Forest', 'Swamp'], { p1: { battlefield: [...lands('Forest', 1), ...lands('Swamp', 4)] } }), 'p1', 'Grinning Demon');
    s = becomesCopy(s, id, 'Branchsnap Lorian');
    expect(getChars(s, id)).toMatchObject({ name: '', power: '2', toughness: '2', abilities: [] });
    expect(turnUpActions(s).map((a) => a.label)).toEqual(['Turn Grinning Demon face up (morph {G})']);
    s = turnUp(s, id);
    expect(getChars(s, id).name).toBe('Branchsnap Lorian');
    expect(pt(s, id)).toBe('4/1');
  });

  it.runIf(HAS_1A)('CR 707.3: one that became a copy of Wandering Ones (no morph) lists no turn-face-up action', () => {
    let [s, id] = putFaceDown(scenario(['Grinning Demon', 'Wandering Ones', 'Swamp'], { p1: { battlefield: lands('Swamp', 4) } }), 'p1', 'Grinning Demon');
    s = becomesCopy(s, id, 'Wandering Ones');
    expect(turnUpActions(s)).toEqual([]);
  });

  it.runIf(HAS_1A && copiableValuesOf !== undefined)('CR 707.2, 708.2: the copiable values of a face-down permanent are its profile, never the hidden card (a Clone of it is a face-up 2/2 with no abilities)', () => {
    let [s, id] = putFaceDown(scenario(['Grinning Demon', 'Branchsnap Lorian']), 'p1', 'Grinning Demon');
    s = becomesCopy(s, id, 'Branchsnap Lorian');
    const v = copiableValuesOf!(s, id);
    expect(v.defId).toBe('__facedown__');
    expect(JSON.stringify(v)).not.toMatch(/Grinning Demon|Branchsnap Lorian/);
  });
});
