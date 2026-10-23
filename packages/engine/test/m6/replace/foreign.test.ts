/**
 * M6-1: the replacement effects of OTHER objects (`feature:replace.foreign`, m6 design 3.1.1-3.1.2, 3.1.4, E1, E3, D4; CR 614.12, 616.1). The three traces of
 * design 8.5 of milestone 5 as full scenarios, the chooser (the affected object's controller after layer 2), the entering object judged as it would exist on
 * the battlefield, and the index (indexed = scanned).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, CardDef, GameState } from '../../../src/index';
import { propose, proposeResult } from '../../../src/effects/propose';
import { replacementIndex, scanReplacements } from '../../../src/effects/replacement-index';
import { destroy } from '../../../src/rules/destroy';
import { find, inGraveyard, scenario, synth, tweak } from '../../m5/helpers';
import { equivalent } from '../../m5/cr-examples/helpers';
import { DOUBLING_SEASON, enchantment, eventsOf, LEYLINE, ORB_OF_DREAMS, REST_IN_PEACE, run } from './support';

const soldier: CardDef = { ...synth({ name: 'Soldier', type: 'Token Creature — Soldier', pt: ['1', '1'], abilities: [] }), isToken: true };
const exiled = (s: GameState, name: string): boolean => s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === name);

describe('design 8.5, the three traces of milestone 5, now applied (CR 614.1a, 616.1, 616.1g)', () => {
  it('trace 1: Doubling Season and Rest in Peace; "create two 1/1 Soldier tokens" creates four, each entering as its own zone change (CR 616.1g, 603.2c)', () => {
    const s = scenario([], { p1: { battlefield: ['Doubling Season', 'Rest in Peace'] }, defs: [DOUBLING_SEASON, REST_IN_PEACE, soldier] });
    const r = run(s, (g) => proposeResult(g, { ev: 'createToken', player: 'p1', count: 2, token: 'Soldier' }));
    expect(r.need).toBeUndefined();
    expect(r.result!.newIds).toHaveLength(4);
    expect(eventsOf(r.g, 'zoneChanged').filter((e) => e.to === 'battlefield' && e.name === 'Soldier')).toHaveLength(4);
  });

  it('trace 2: Leyline of the Void and Rest in Peace; Bob\'s creature is destroyed: Bob (its controller) chooses which applies, and it is exiled either way (CR 616.1, 616.1e)', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Leyline of the Void', 'Rest in Peace'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [LEYLINE, REST_IN_PEACE] });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const go = (g: Parameters<Parameters<typeof run>[1]>[0]) => propose(g, { ev: 'destroy', object: { id: bears, zone: 'battlefield' }, canRegenerate: true });
    const r = run(s, go);
    expect(r.need?.kind).toBe('chooseReplacement');
    expect(r.need!.player).toBe('p2');
    for (const o of r.need!.kind === 'chooseReplacement' ? r.need!.options : []) {
      const done = run(s, go, [{ kind: 'chooseReplacement', id: o.id }]);
      expect(done.need).toBeUndefined(); // the other one no longer applies: the event is a move to exile now (CR 616.1f)
      expect(exiled(done.g.s, 'Grizzly Bears')).toBe(true);
      expect(inGraveyard(done.g.s, 'Grizzly Bears', 'p2')).toBe(false);
    }
  });

  it('trace 3: Leyline of the Void exiles only an opponent\'s cards: Alice\'s own creature still dies (CR 109.5: "opponent" is relative to Leyline\'s controller)', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Leyline of the Void', 'Grizzly Bears'] }, defs: [LEYLINE] });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const r = run(s, (g) => destroy(g, bears));
    expect(inGraveyard(r.g.s, 'Grizzly Bears', 'p1')).toBe(true);
  });
});

describe('CR 616.1, 616.1f: who chooses, and an effect that no longer applies does nothing', () => {
  // "If ~ would die, instead shuffle it into its owner's library." (the CR 616.1f example's creature)
  const shuffler = equivalent({ name: 'Test Shuffler', type_line: 'Creature — Golem', mana_cost: '{3}', power: '3', toughness: '3' }, [{
    kind: 'static', text: "If ~ would die, instead shuffle it into its owner's library.",
    effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'library', position: 'random' } } }],
  }] as AbilityDef[]);
  const libraryHas = (s: GameState, p: 'p1' | 'p2', name: string) => s.zones.library[p]!.some((id) => s.defs[s.objects[id]!.defId]!.name === name);

  it('CR 616.1f: Rest in Peace and a creature\'s "shuffle it into its library instead": its controller chooses; the other then does nothing', () => {
    const s = scenario([], { p1: { battlefield: ['Rest in Peace'] }, p2: { battlefield: ['Test Shuffler'] }, defs: [REST_IN_PEACE, shuffler] });
    const id = find(s, 'Test Shuffler', 'battlefield');
    const go = (g: Parameters<Parameters<typeof run>[1]>[0]) => destroy(g, id);
    const r = run(s, go);
    expect(r.need?.kind).toBe('chooseReplacement');
    expect(r.need!.player).toBe('p2');
    const opts = r.need!.kind === 'chooseReplacement' ? r.need!.options : [];
    const rip = run(s, go, [{ kind: 'chooseReplacement', id: opts.find((o) => /Rest in Peace/.test(o.label))!.id }]);
    expect(exiled(rip.g.s, 'Test Shuffler')).toBe(true);
    const own = run(s, go, [{ kind: 'chooseReplacement', id: opts.find((o) => /Test Shuffler/.test(o.label))!.id }]);
    expect(libraryHas(own.g.s, 'p2', 'Test Shuffler')).toBe(true);
    expect(exiled(own.g.s, 'Test Shuffler')).toBe(false);
  });

  it('CR 616.1, 108.4 (m6 design D4): the affected object\'s controller is judged after layer 2: Alice, who gained control of Bob\'s creature, chooses', () => {
    const s0 = scenario([], { p1: { battlefield: ['Rest in Peace'] }, p2: { battlefield: ['Test Shuffler'] }, defs: [REST_IN_PEACE, shuffler] });
    const id = find(s0, 'Test Shuffler', 'battlefield');
    // a layer 2 effect gives Alice control of it (Act of Treason's effect, CR 613.1b); the stored controller stays Bob's
    const s = tweak(s0, (t) => {
      t.continuousEffects.push({
        id: 'e70', source: null, sourceName: 'Test Treason', controller: 'p1', timestamp: 950, startedTurn: 1, duration: { d: 'endOfTurn' },
        effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id, zone: 'battlefield' }] }, mods: [{ layer: 2, controller: { ref: 'you' } }] },
      });
    });
    expect(s.objects[id]!.controller).toBe('p2');
    const go = (g: Parameters<Parameters<typeof run>[1]>[0]) => destroy(g, id);
    const r = run(s, go);
    expect(r.need?.kind).toBe('chooseReplacement');
    expect(r.need!.player).toBe('p1');
  });
});

describe('CR 614.12: an entering permanent is judged as it would exist on the battlefield', () => {
  it('CR 614.12: Orb of Dreams\' "Permanents enter tapped" does not affect Orb of Dreams itself, and does affect what enters after it', () => {
    const s = scenario(['Grizzly Bears', 'Orb of Dreams'], { p1: { graveyard: ['Orb of Dreams', 'Grizzly Bears'] }, defs: [ORB_OF_DREAMS] });
    const orb = find(s, 'Orb of Dreams', 'graveyard');
    const r1 = run(s, (g) => proposeResult(g, { ev: 'zoneChange', object: { id: orb, zone: 'graveyard' }, from: 'graveyard', to: 'battlefield', destination: {} }));
    const orbNow = r1.result!.newIds[0]!;
    expect(r1.g.s.objects[orbNow]!.tapped).toBe(false);
    const bears = find(r1.g.s, 'Grizzly Bears', 'graveyard');
    const r2 = run(r1.g.s, (g) => proposeResult(g, { ev: 'zoneChange', object: { id: bears, zone: 'graveyard' }, from: 'graveyard', to: 'battlefield', destination: {} }));
    expect(r2.g.s.objects[r2.result!.newIds[0]!]!.tapped).toBe(true);
  });

  it('CR 614.12, 616.1 (m6 design E3): "creatures your opponents control enter tapped" sees the player a creature enters under, not its owner', () => {
    const gate = enchantment('Test Opposing Gate', [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'opponent' }, to: 'battlefield' }, body: { b: 'enters', tapped: true } }]);
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Test Opposing Gate'] }, p2: { graveyard: ['Grizzly Bears', 'Grizzly Bears'] }, defs: [gate] });
    const [b1, b2] = s.zones.graveyard.p2!;
    // returned under Alice's control (she controls the gate): not an opponent's creature as it would enter, so untapped
    const mine = run(s, (g) => proposeResult(g, { ev: 'zoneChange', object: { id: b1!, zone: 'graveyard' }, from: 'graveyard', to: 'battlefield', destination: { controller: 'p1' } }));
    expect(mine.g.s.objects[mine.result!.newIds[0]!]!.tapped).toBe(false);
    // returned under Bob's control: tapped
    const theirs = run(s, (g) => proposeResult(g, { ev: 'zoneChange', object: { id: b2!, zone: 'graveyard' }, from: 'graveyard', to: 'battlefield', destination: { controller: 'p2' } }));
    expect(theirs.g.s.objects[theirs.result!.newIds[0]!]!.tapped).toBe(true);
  });
});

describe('m6 design E1: the index of foreign replacement effects', () => {
  const keys = (s: GameState): string[] => [...replacementIndex(s).values()].flat().map((x) => `${x.object}:${x.key}:${x.index}`).sort();
  const scanned = (s: GameState): string[] => scanReplacements(s).map((x) => `${x.object}:${x.key}:${x.index}`).sort();

  it('indexed = scanned, on the intrinsic path and the layered path, before and after the objects move, phase out or lose their abilities', () => {
    const humility = synth({ name: 'Test Blank', type: 'Enchantment', abilities: [{ kind: 'static', text: 'All creatures lose all abilities.', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'] } }, mods: [{ layer: 6, removeAll: true } as never] }] }] });
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Leyline of the Void', 'Doubling Season'], hand: ['Rest in Peace'] }, defs: [LEYLINE, DOUBLING_SEASON, REST_IN_PEACE, humility] });
    const states: GameState[] = [s0];
    states.push(tweak(s0, (t) => { t.objects[find(t, 'Leyline of the Void', 'battlefield')]!.phasedOut = true; }));
    states.push(tweak(s0, (t) => {
      const id = find(t, 'Doubling Season', 'battlefield');
      t.zones.battlefield = t.zones.battlefield.filter((x) => x !== id);
      t.objects[id]!.zone = 'graveyard';
      t.zones.graveyard.p1!.push(id);
    }));
    states.push(tweak(s0, (t) => {
      // a layer source: the layered path (allChars)
      t.continuousEffects.push({ id: 'e77', source: null, sourceName: 'Test', controller: 'p1', timestamp: 999, startedTurn: 1, duration: { d: 'endOfTurn' }, effect: { s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'] } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] } });
    }));
    for (const s of states) expect(keys(s)).toEqual(scanned(s));
    expect(keys(s0)).toHaveLength(3); // Leyline's one effect, Doubling Season's two; Rest in Peace in the hand does not function there (CR 113.6)
    expect(keys(states[1]!)).toHaveLength(2); // CR 702.26b: a phased-out permanent is treated as though it does not exist
    expect(keys(states[2]!)).toHaveLength(1);
    expect(keys(states[3]!)).toHaveLength(3);
  });

  it('CR 113.6: an effect that functions in another zone is indexed there (a graveyard ability), and only there', () => {
    const dredgeLike = synth({ name: 'Test Graveyard Replacer', type: 'Creature — Test', pt: ['1', '1'], abilities: [{
      kind: 'static', text: 'x', zone: ['graveyard'],
      effects: [{ s: 'replace', replaces: { ev: 'draw', player: 'you' }, optional: true, body: { b: 'instead', do: [{ op: 'mill', who: { ref: 'you' }, count: 1 }] } }],
    }] });
    // and a keyword's expansion (dredge, CR 702.52a): Golgari Thug in the graveyard, not on the battlefield
    const s = scenario(['Golgari Thug'], { p1: { graveyard: ['Test Graveyard Replacer', 'Golgari Thug'] }, p2: { battlefield: ['Test Graveyard Replacer', 'Golgari Thug'] }, defs: [dredgeLike] });
    expect(scanReplacements(s).map((x) => x.zone)).toEqual(['graveyard', 'graveyard']);
    expect(keys(s)).toEqual(scanned(s));
  });
});
