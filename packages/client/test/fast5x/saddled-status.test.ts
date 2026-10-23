/**
 * FAST5X E3: the board shows the saddled designation (CR 702.171b) as a status line of the permanent, like a Case's "Solved" or "Prepared"; both players see
 * it (a designation of a permanent is public information).
 */
import { describe, expect, it } from 'vitest';
import { viewFor } from '@openmtg/engine';
import { statusLines } from '../../src/cards/objectStatus';
import { find, scenario, tweak } from '../prompts/harness';

describe('CR 702.171b: a saddled permanent', () => {
  it('has the status line "Saddled" for both players; an unsaddled one has none', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const id = find(s0, 'Grizzly Bears', 'battlefield');
    expect(statusLines(viewFor(s0, 'p1'), viewFor(s0, 'p1').objects[id]!).map((l) => l.text)).not.toContain('Saddled');
    const s = tweak(s0, (t) => { t.objects[id]!.saddled = true; });
    for (const p of ['p1', 'p2'] as const) {
      const v = viewFor(s, p);
      const line = statusLines(v, v.objects[id]!).find((l) => l.key === 'saddled');
      expect(line?.text, p).toBe('Saddled');
      expect(line?.rule, p).toMatch(/CR 702\.171b/);
    }
  });
});
