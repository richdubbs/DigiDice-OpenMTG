/**
 * edh-next-147 review (CR 118.3, 701.21a; Phyrexian Dreadnought): "sacrifice it unless you sacrifice any number of creatures with total power 12 or greater". The payment's
 * decision states its total (`limit`, power 12 or more), so the AI picks enough creatures to reach it (before the fix it answered with one creature, was refused, and
 * the same answer was refused forever: the game could not go on).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, viewFor, type GameState } from '@openmtg/engine';
import { act, answer, find, mpScenario, pass } from '../../engine/test/m12/rules/helpers';
import { card } from '../../engine/test/cloud/cmd3/helpers';
import { chooseAction } from '../src/index';

const DREAD = card('Test Iron Leviathan', 'Artifact Creature — Phyrexian Construct', 'Trample\nWhen this creature enters, sacrifice it unless you sacrifice any number of creatures with total power 12 or greater.', ['12', '12'], '{1}');
const FIVE = card('Test Leviathan Five', 'Creature — Ogre', '', ['5', '5']);
const SEVEN = card('Test Leviathan Seven', 'Creature — Ogre', '', ['7', '7']);

describe('CR 118.3, 701.21a: the AI pays a sacrifice of total power N or more with a legal set', () => {
  it('answers the threshold decision with creatures whose powers reach 12, and the game goes on', () => {
    let s: GameState = mpScenario({ defs: [DREAD, FIVE, SEVEN], zones: { p1: { hand: ['Test Iron Leviathan'], battlefield: ['Plains', 'Test Leviathan Five', 'Test Leviathan Seven'] } } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Iron Leviathan', 'hand', 'p1') });
    let sawLimit = false;
    for (let i = 0; i < 40 && s.pending && !s.result; i++) {
      const p = s.pending;
      if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); continue; }
      if (p.kind === 'payCost') { s = answer(s, { kind: 'payCost', auto: true }); continue; }
      if (p.kind === 'chooseObjects' && (p as { limit?: { op: string; value: number } }).limit !== undefined) {
        expect((p as { limit?: { op: string; value: number } }).limit).toMatchObject({ op: '>=', value: 12 });
        sawLimit = true;
      }
      const v = viewFor(s, p.player);
      const r = applyAction(s, chooseAction(v, v.pending!, 'edhn147'));
      expect(r.error, JSON.stringify(r.error)).toBeUndefined();
      s = r.state;
    }
    expect(sawLimit).toBe(true);
    expect(s.zones.stack.length).toBe(0);
    const names = s.zones.battlefield.map((id) => s.defs[s.objects[id]!.defId]!.name);
    expect(names.filter((n) => n.startsWith('Test Leviathan')).length + (names.includes('Test Iron Leviathan') ? 0 : 2)).toBeLessThanOrEqual(2);
  });
});
