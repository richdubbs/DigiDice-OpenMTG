/**
 * FAST5X E12: the board shows the suspected designation (CR 701.60a-c) as a status line of the permanent, like "Saddled" or "Solved"; both players see it (a
 * designation of a permanent is public information). Its menace shows with the keywords (the layer system grants it, statics/suspect.ts).
 */
import { describe, expect, it } from 'vitest';
import { viewFor } from '@openmtg/engine';
import { statusLines } from '../../src/cards/objectStatus';
import { find, scenario, tweak } from '../prompts/harness';

describe('CR 701.60c: a suspected permanent', () => {
  it('has the status line "Suspected" for both players; an unsuspected one has none', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const id = find(s0, 'Grizzly Bears', 'battlefield');
    expect(statusLines(viewFor(s0, 'p1'), viewFor(s0, 'p1').objects[id]!).map((l) => l.text)).not.toContain('Suspected');
    const s = tweak(s0, (t) => { t.objects[id]!.suspected = 1; });
    for (const p of ['p1', 'p2'] as const) {
      const v = viewFor(s, p);
      const line = statusLines(v, v.objects[id]!).find((l) => l.key === 'suspected');
      expect(line?.text, p).toBe('Suspected');
      expect(line?.rule, p).toMatch(/CR 701\.60c/);
    }
  });
});
