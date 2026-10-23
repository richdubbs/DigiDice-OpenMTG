/**
 * WP2: totality fuzz. Thousands of seeded, type-valid abilities (test/m5/render/gen.ts) cover every discriminator of the model. The renderer must print
 * each one or refuse it with `NoRenderer` (which the gate turns into a rejection); a TypeError or any other exception is a bug. The gate must never throw.
 */
import { describe, expect, it } from 'vitest';
import { renderAbility, renderGate } from '../../../src/index';
import '../../../src/render/boot';
import { K } from '../../../src/render/kernel';
import { newState } from '../../../src/render/state';
import { NoRenderer } from '../../../src/render/text';
import { Gen, rng } from './gen';

const ctx = { selfNames: ['Test Card'], selfTypes: ['Creature'] };

describe('design 6.8 and CR 608.2: fuzz: the renderer is total on valid JSON', () => {
  it('prints or refuses 6000 random abilities, never crashes', () => {
    let printed = 0;
    let refused = 0;
    for (let seed = 1; seed <= 6000; seed++) {
      const def = new Gen(rng(seed)).ability();
      try {
        const text = K.ability(def, newState(ctx));
        expect(typeof text).toBe('string');
        printed++;
      } catch (e) {
        if (!(e instanceof NoRenderer)) throw new Error(`seed ${seed}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n${JSON.stringify(def)}`);
        refused++;
      }
    }
    // the generator is type-valid, not meaningful: it combines fields that no card has, and the renderer refuses what it cannot say; most is still printed
    expect(printed).toBeGreaterThan(refused * 2);
  });

  it('renderAbility and renderGate are total, and a random ability does not pass against unrelated text', () => {
    for (let seed = 1; seed <= 1500; seed++) {
      const def = new Gen(rng(seed)).ability();
      const lines = renderAbility(def, ctx);
      expect(Array.isArray(lines)).toBe(true);
      const r = renderGate(def, ['Draw a card.'], ctx);
      expect(typeof r.ok).toBe('boolean');
      // the gate is exact: a random ability passes against "Draw a card." only if it says exactly that (CR 121.1), which needs a draw step in it
      if (r.ok) expect(JSON.stringify(def), `seed ${seed} passed against unrelated text`).toContain('"op":"draw"');
      expect(typeof r.rendered).toBe('string');
      expect(typeof r.expected).toBe('string');
    }
  });

  it('an ability passes the gate against its own display text (the renderer agrees with itself)', () => {
    let checked = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const def = new Gen(rng(seed)).ability();
      let marked: string;
      try {
        marked = K.ability(def, newState(ctx));
      } catch {
        continue;
      }
      // a display-only option ("attached creature") is a neutral label the gate never accepts, so such an ability is not compared with itself
      if (marked.includes('')) continue;
      const display = renderAbility(def, ctx);
      const r = renderGate(def, display, ctx);
      expect(r.ok, `seed ${seed}\n${display.join(' | ')}\n${r.rendered}\n${r.expected}`).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(2000);
  });
});
