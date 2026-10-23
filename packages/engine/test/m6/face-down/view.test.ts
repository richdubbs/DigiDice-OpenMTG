/**
 * M6-3 (m6 design D7, E7, 3.4 "Hidden information"): what other players see of face-down permanents and spells (core/view.ts): the public pseudo-definition of
 * the profile, the public method (megamorph shown as morph, CR 702.37b-c), no card id or memory; a card exiled face down shows nothing (CR 406.3a); and the
 * reveals of CR 708.9 when the owner leaves the game and at the end of the game.
 */
import { describe, expect, it } from 'vitest';
import { getChars } from '../../../src/index';
import { castFaceDown, lands, putFaceDown, scenario, tweak, viewChars, viewFor } from './support';

describe('CR 708.5: only its controller may look at a face-down permanent or spell', () => {
  it('the controller sees the card; the opponent and a spectator see the pseudo-definition, its counters and status, and getChars on the view gives the 2/2', () => {
    let [s, id] = putFaceDown(scenario(['Exalted Angel', 'Glorious Anthem'], { p1: { battlefield: ['Glorious Anthem'] } }), 'p1', 'Exalted Angel');
    s = tweak(s, (t) => Object.assign(t.objects[id]!, { tapped: true, counters: { '+1/+1': 1 }, chosen: { color: 'W' }, cast: { costsPaid: { alternative: 'morph' }, from: 'hand', via: 'morph', turn: 1 } }));
    expect(viewFor(s, 'p1').objects[id]!.defId).toBe('Exalted Angel');
    for (const viewer of ['p2', null] as const) {
      const v = viewFor(s, viewer);
      const o = v.objects[id]!;
      expect(o).toMatchObject({ defId: '__facedown__', faceDown: true, tapped: true, counters: { '+1/+1': 1 }, faceDownInfo: { by: 'morph', profile: 'plain' } });
      for (const k of ['cardId', 'chosen', 'cast', 'links', 'faceUpX'] as const) expect(o[k], k).toBeUndefined();
      expect(viewChars(v, id)).toMatchObject({ name: '', power: '4', toughness: '4' }); // 2/2, +1/+1 from the anthem, +1/+1 counter
      expect(JSON.stringify(v)).not.toMatch(/Exalted Angel/);
    }
  });

  it('CR 702.37b-c: a megamorph is shown to other players as a morph (the state keeps the truth)', () => {
    const [s, id] = putFaceDown(scenario(['Den Protector']), 'p1', 'Den Protector', { by: 'megamorph', profile: 'plain' });
    expect(viewFor(s, 'p1').objects[id]!.faceDownInfo!.by).toBe('megamorph');
    expect(viewFor(s, 'p2').objects[id]!.faceDownInfo!.by).toBe('morph');
    expect(JSON.stringify(viewFor(s, 'p2'))).not.toMatch(/megamorph/i);
  });

  it('a face-down megamorph spell on the stack: its alternative cost is shown as "morph"; disguise shows the ward {2} pseudo-definition', () => {
    const s = castFaceDown(scenario(['Den Protector', 'Forest'], { p1: { hand: ['Den Protector'], battlefield: lands('Forest', 3) } }), 'Den Protector');
    const spell = s.zones.stack[0]!;
    const theirs = viewFor(s, 'p2').objects[spell]!;
    expect(theirs).toMatchObject({ defId: '__facedown__', faceDownInfo: { by: 'morph' }, stack: { kind: 'spell', costsPaid: { alternative: 'morph' }, castFrom: 'hand', targets: [] } });
    expect(JSON.stringify(viewFor(s, 'p2'))).not.toMatch(/megamorph|Den Protector/i);
    const [s2, id2] = putFaceDown(scenario(['Alley Assailant']), 'p1', 'Alley Assailant', { by: 'disguise', profile: 'ward2' });
    expect(viewFor(s2, 'p2').objects[id2]!.defId).toBe('__facedown_ward2__');
    expect(viewChars(viewFor(s2, 'p2'), id2).keywords.map((k) => k.keyword)).toEqual(['ward']);
  });

  it('CR 406.3a: a card exiled face down shows nothing to other players (no pseudo-definition: it has no characteristics)', () => {
    const s0 = scenario(['Exalted Angel'], { p1: { battlefield: ['Exalted Angel'] } });
    const id = s0.zones.battlefield.find((x) => s0.objects[x]!.defId === 'Exalted Angel')!;
    const s = tweak(s0, (t) => {
      t.zones.battlefield = t.zones.battlefield.filter((x) => x !== id);
      t.zones.exile.push(id);
      Object.assign(t.objects[id]!, { zone: 'exile', faceDown: true });
    });
    expect(viewFor(s, 'p2').objects[id]!.defId).toBe('__hidden__');
  });
});

describe('CR 708.9: face-down permanents and spells are revealed when their owner leaves the game and at the end of the game', () => {
  it('at the end of the game every player sees them', () => {
    const [s0, id] = putFaceDown(scenario(['Exalted Angel']), 'p1', 'Exalted Angel');
    const s = tweak(s0, (t) => { t.result = { winner: 'p2', reason: 'test' } as never; });
    expect(viewFor(s, 'p2').objects[id]!.defId).toBe('Exalted Angel');
  });

  it('when its owner has left the game (lost), the others see it', () => {
    const [s0, id] = putFaceDown(scenario(['Exalted Angel']), 'p1', 'Exalted Angel');
    const s = tweak(s0, (t) => { t.players[0]!.hasLost = true; });
    expect(viewFor(s, 'p2').objects[id]!.defId).toBe('Exalted Angel');
  });
});
