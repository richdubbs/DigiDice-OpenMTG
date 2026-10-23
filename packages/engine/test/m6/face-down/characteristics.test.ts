/**
 * M6-3 (m6 design 3.4, D6, E6, E16): the characteristics of face-down permanents and spells (layer 1b, CR 613.2b, 708.2) and of cards exiled face down (CR
 * 406.3a). Real fixture cards; the face-down status is set up directly or by real actions.
 */
import { describe, expect, it } from 'vitest';
import { computeAll, intrinsicChars } from '../../../src/statics/layers';
import { act, find, getChars, pt, putFaceDown, scenario, tweak } from './support';

const angelBoard = () => scenario(['Exalted Angel', 'Glorious Anthem', 'Grizzly Bears', 'Plains'], { p1: { hand: ['Glorious Anthem'], battlefield: ['Plains', 'Plains', 'Plains'] } });

describe('CR 708.2a, 613.2b: a face-down permanent is a 2/2 creature with no name, text, subtypes or mana cost (layer 1b)', () => {
  it('CR 708.2a: Exalted Angel face down has none of its own characteristics: no name, no flying, colorless, mana value 0', () => {
    const [s, id] = putFaceDown(angelBoard(), 'p1', 'Exalted Angel');
    const c = getChars(s, id);
    expect(c).toMatchObject({ name: '', names: [], types: ['Creature'], subtypes: [], supertypes: [], colors: [], manaCost: null, manaValue: 0, power: '2', toughness: '2' });
    expect(c.abilities).toEqual([]);
    expect(c.keywords).toEqual([]);
  });

  it('E16: the fast path (no other layer source) and computeAll give the same 2/2, before and after an in-place turn face down', () => {
    const s0 = scenario(['Exalted Angel'], { p1: { battlefield: ['Exalted Angel'] } });
    const id = find(s0, 'Exalted Angel', 'battlefield');
    expect(intrinsicChars(s0, s0.objects[id]!)).toEqual(computeAll(s0).get(id));
    const s = tweak(s0, (t) => Object.assign(t.objects[id]!, { faceDown: true, faceDownInfo: { by: 'effect', profile: 'plain' } }));
    expect(intrinsicChars(s, s.objects[id]!)).toEqual(computeAll(s).get(id));
    expect(intrinsicChars(s, s.objects[id]!)).toMatchObject({ name: '', power: '2', toughness: '2', abilities: [] });
  });

  it('CR 613.2b, 613.4: the face-down profile is layer 1b, so an anthem (layer 7c) still applies: a 3/3 with no name (the layered path)', () => {
    let [s, id] = putFaceDown(angelBoard(), 'p1', 'Exalted Angel');
    s = tweak(s, (t) => { const a = find(t, 'Glorious Anthem', 'hand'); t.zones.hand.p1 = t.zones.hand.p1!.filter((x) => x !== a); t.objects[a]!.zone = 'battlefield'; t.zones.battlefield.push(a); });
    expect(pt(s, id)).toBe('3/3');
    expect(getChars(s, id).name).toBe('');
    expect(computeAll(s).get(id)).toMatchObject({ name: '', power: '3', toughness: '3', abilities: [] });
  });

  it('CR 702.168a, 701.58a: the ward2 profile (disguise, cloak) is a 2/2 with ward {2}, a rule ability of the permanent (never a printed key of the hidden card)', () => {
    const [s, id] = putFaceDown(angelBoard(), 'p1', 'Exalted Angel', { by: 'cloak', profile: 'ward2' });
    const c = getChars(s, id);
    expect(c.keywords.map((k) => k.keyword)).toEqual(['ward']);
    expect(c.abilities.every((a) => a.origin === 'rule' && a.key.startsWith('r:facedown:ward'))).toBe(true);
    expect(c.abilities.some((a) => a.def.kind === 'triggered')).toBe(true); // the ward trigger (CR 702.21a)
    expect(c.name).toBe('');
  });

  it('CR 702.21a: the ward of a cloaked permanent triggers when an opponent targets it (counter it unless that player pays {2})', () => {
    let s = scenario(['Exalted Angel', 'Lightning Bolt', 'Mountain'], { p2: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] } });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Exalted Angel', { by: 'cloak', profile: 'ward2' });
    s = act(s, { type: 'pass', player: 'p1' }); // p2 gets priority
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Lightning Bolt', 'hand', 'p2') });
    while (s.pending && s.pending.kind !== 'priority') {
      const d = s.pending;
      if (d.kind === 'chooseTargets') s = act(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'object', id }] } });
      else s = act(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'payCost', auto: true } });
    }
    const top = s.objects[s.zones.stack[s.zones.stack.length - 1]!]!;
    expect(top.stack?.kind).toBe('triggered');
    expect(top.stack?.inline?.kind).toBe('triggered'); // a rule ability carries its definition inline (CR 113.7a)
    expect(top.stack?.abilityRef?.source).toBe('rule');
  });
});

describe('CR 406.3a, 110.5d: a card exiled face down has no characteristics', () => {
  it('not a creature card, no name, mana value 0 (so "creature cards in exile" does not count it), and no face-down profile', () => {
    const s0 = scenario(['Exalted Angel'], { p1: { battlefield: ['Exalted Angel'] } });
    const id = find(s0, 'Exalted Angel', 'battlefield');
    const s = tweak(s0, (t) => {
      t.zones.battlefield = t.zones.battlefield.filter((x) => x !== id);
      t.zones.exile.push(id);
      Object.assign(t.objects[id]!, { zone: 'exile', faceDown: true });
    });
    const c = getChars(s, id);
    expect(c).toMatchObject({ name: '', types: [], subtypes: [], colors: [], manaValue: 0, abilities: [] });
    expect(c.power).toBeUndefined();
  });
});
