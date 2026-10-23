/**
 * WP11 review: a new destination (CR 614.1a, `modify.destination`) is carried out in full or not at all. "Shuffle it into its owner's library instead"
 * (Darksteel Colossus, Progenitus, Nexus of Fate) puts it into the library and shuffles that library (CR 701.24a, 701.24c); "exile it face down" exiles it face
 * down (CR 406.3). A field the pipeline can't apply makes the ability partial (discipline.test.ts) and the replacement is never half-applied.
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, ReplacementDef } from '../../../src/index';
import { destroy } from '../../../src/rules/destroy';
import { find, inGraveyard, onBattlefield, scenario } from '../helpers';
import { eventsOf, permanent, run, staticAbility } from './support';

const colossus = (destination: Extract<ReplacementDef['body'], { b: 'modify' }>['destination']): CardDef =>
  permanent('Test Colossus', 'Artifact Creature — Golem', [
    staticAbility('If ~ would be put into a graveyard from anywhere, do something else instead.', [
      { s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'graveyard' }, body: { b: 'modify', destination: destination! } },
    ], { zone: ['battlefield', 'hand', 'library', 'stack', 'exile', 'graveyard'] }),
  ], { pt: ['11', '11'] });

describe('CR 614.1a: the new destination of a self replacement', () => {
  it('CR 701.24a, 701.24c: "shuffle it into its owner\'s library instead": it goes into the library and that library is shuffled', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Colossus'], library: Array(20).fill('Plains') as string[] }, defs: [colossus({ zone: 'library', position: 'random' })] });
    const r = run(s0, (g) => destroy(g, find(s0, 'Test Colossus', 'battlefield')));
    expect(r.result).toBe('destroyed');
    const lib = r.g.s.zones.library.p1!;
    expect(lib.filter((id) => r.g.s.objects[id]!.defId === 'Test Colossus')).toHaveLength(1);
    expect(inGraveyard(r.g.s, 'Test Colossus', 'p1')).toBe(false);
    expect(eventsOf(r.g, 'shuffled')).toEqual([{ type: 'shuffled', player: 'p1' }]);
    expect(r.g.s.log.some((l) => l.level === 'manual')).toBe(false);
  });

  it('CR 406.3: "exile it face down instead": it is exiled face down', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Colossus'] }, defs: [colossus({ zone: 'exile', faceDown: true })] });
    const r = run(s0, (g) => destroy(g, find(s0, 'Test Colossus', 'battlefield')));
    const exiled = r.g.s.zones.exile.map((id) => r.g.s.objects[id]!);
    expect(exiled).toHaveLength(1);
    expect(exiled[0]!.faceDown).toBe(true);
  });

  it('design 5.2: a destination field the pipeline can\'t apply (attached to something) is not half-applied: the replacement does not apply at all', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Colossus'] }, defs: [colossus({ zone: 'hand', attachedTo: { ref: 'self' } })] });
    const r = run(s0, (g) => destroy(g, find(s0, 'Test Colossus', 'battlefield')));
    expect(inGraveyard(r.g.s, 'Test Colossus', 'p1')).toBe(true);
    expect(r.g.s.zones.hand.p1!.some((id) => r.g.s.objects[id]!.defId === 'Test Colossus')).toBe(false);
    expect(onBattlefield(r.g.s, 'Test Colossus')).toBe(false);
  });
});
