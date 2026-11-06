/**
 * Round edh-d-73 (lane face-down): "As ~ is turned face up, you may attach it to a creature." (Gift of Doom; CR 708.11, 702.37, 303.4f, 701.3a), played through the engine with a synthetic
 * Aura (invented name and wording, design 6.10) that is cast face down with morph and turned face up by the special action. Two players (the m6 face-down scenario helpers).
 */
import { describe, expect, it } from 'vitest';
import { getChars } from '../../../src/index';
import { castFaceDown, drive, faceDownOf, find, lands, putFaceDown, resolveTop, scenario, synthetic, turnUp } from '../../m6/face-down/support';

const CURSE = synthetic('Test Veiled Boon', 'Enchantment — Aura', '{2}{B}', 'Enchant creature\nEnchanted creature has deathtouch.\nMorph {1}\nAs this Aura is turned face up, you may attach it to a creature.');
const BEAR = synthetic('Test Grizzly', 'Creature — Bear', '{1}{G}', 'Trample', { power: '2', toughness: '2' });
const board = () => scenario([], { defs: [CURSE, BEAR], p1: { hand: ['Test Veiled Boon'], battlefield: [...lands('Plains', 4), 'Test Grizzly'] }, p2: { battlefield: ['Test Grizzly'] } });

describe('CR 708.11, 303.4f: "As this Aura is turned face up, you may attach it to a creature."', () => {
  it('is automated', () => expect(CURSE.automation.level, JSON.stringify(CURSE.automation)).toBe('full'));
  it('turned face up, the Aura is attached to the creature its controller chooses (any creature, an opponent\'s too) and gives its bonus', () => {
    let s = resolveTop(castFaceDown(board(), 'Test Veiled Boon'));
    const [aura] = faceDownOf(s, 'p1');
    expect(aura).toBeDefined();
    const theirs = find(s, 'Test Grizzly', 'battlefield', 'p2');
    s = turnUp(s, aura!, 'morph', [{ kind: 'yesNo', yes: true }, { kind: 'chooseObjects', ids: [theirs] }]);
    expect(s.objects[aura!]!.faceDown).toBe(false);
    expect(s.objects[aura!]!.attachedTo).toBe(theirs);
    expect(s.zones.battlefield).toContain(aura!);
    expect(getChars(s, theirs)!.abilities.some((a) => /deathtouch/i.test(a.def.kind === 'keyword' ? a.def.keyword : ''))).toBe(true);
  });
  it('negative: declined, the Aura is not attached to anything and is put into its owner\'s graveyard (CR 704.5m)', () => {
    let s = resolveTop(castFaceDown(board(), 'Test Veiled Boon'));
    const [aura] = faceDownOf(s, 'p1');
    s = turnUp(s, aura!, 'morph', [{ kind: 'yesNo', yes: false }]);
    expect(s.zones.battlefield).not.toContain(aura!);
    expect(s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === 'Test Veiled Boon')).toBe(true);
  });
  it('negative: a face-down Aura that is turned face up while no creature is on the battlefield except the face-down one itself cannot be attached to itself: it goes to the graveyard', () => {
    const s0 = scenario([], { defs: [CURSE, BEAR], p1: { hand: ['Test Veiled Boon'], battlefield: lands('Plains', 4) } });
    let s = resolveTop(castFaceDown(s0, 'Test Veiled Boon'));
    const [aura] = faceDownOf(s, 'p1');
    s = turnUp(s, aura!, 'morph', [{ kind: 'yesNo', yes: true }]);
    expect(s.zones.battlefield).not.toContain(aura!);
  });
});
void drive; void putFaceDown;
