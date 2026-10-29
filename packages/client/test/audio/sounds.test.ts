/**
 * Every sound of the catalog (audio/catalog.ts, docs/design/sound.md "Checks"): it has a recipe, renders the same every time, fits its length,
 * reaches its loudness without clipping, starts and ends without a click, has no DC, renders fast enough to be made on demand in the browser, and
 * its variants differ.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { analyze } from '../../src/audio/analysis';
import { missingRecipes, renderSound, SOUND_IDS, SOUND_META, variantCount, type SoundMeta } from '../../src/audio/catalog';

const SR = 48000;

describe('the sound catalog', () => {
  // The file runs about a minute of synchronous renders: a turn of the event loop between tests lets the test runner's messages through (without it the
  // runner's "onTaskUpdate" call can time out at 60 s and the run reports an unhandled error).
  beforeEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  it('every sound has a recipe', () => {
    expect(missingRecipes()).toEqual([]);
  });

  it('every sound says what it is for and when it plays', () => {
    for (const id of SOUND_IDS) {
      const m = SOUND_META[id] as SoundMeta;
      expect(m.purpose.length, id).toBeGreaterThan(20);
      expect(m.when.length, id).toBeGreaterThan(10);
      expect(m.maxDur, id).toBeGreaterThan(0);
    }
  });

  describe.each(SOUND_IDS)('%s', (id) => {
    const meta = SOUND_META[id] as SoundMeta;
    it('renders cleanly within its limits', () => {
      const t0 = performance.now();
      const st = renderSound(id, SR, 0);
      const ms = performance.now() - t0;
      expect(st.l.every(Number.isFinite) && st.r.every(Number.isFinite)).toBe(true);
      const a = analyze(st, SR);
      expect(a.duration, 'length (s)').toBeLessThanOrEqual(meta.maxDur + 1e-3);
      expect(a.peakDb, 'peak (dBFS)').toBeLessThanOrEqual(-0.9);
      // Reaches its loudness: a sound held back by the peak limit is too spiky for its place in the mix.
      expect(a.lufs100, 'loudness (LUFS)').toBeGreaterThan(meta.lufs - 1.5);
      expect(a.lufs100, 'loudness (LUFS)').toBeLessThan(meta.lufs + 0.5);
      if (!meta.loop) expect(a.edgeStep, 'click at an edge').toBeLessThan(0.02);
      expect(Math.abs(a.dcOffset), 'DC').toBeLessThan(0.002);
      // Generous in the test (machines vary); the design budget is 60 ms.
      expect(ms, 'render time (ms)').toBeLessThan(400);
    });

    // The comparison of two long buffers (ambient.grid: 576,000 samples) takes about 4 s here, near the default 5 s limit: a longer limit.
    it('renders the same every time', { timeout: 20_000 }, () => {
      expect(renderSound(id, SR, 0).l).toEqual(renderSound(id, SR, 0).l);
    });

    if (variantCount(id) > 1) {
      it('has variants that differ', () => {
        const a = renderSound(id, SR, 0).l;
        for (let v = 1; v < variantCount(id); v++) expect(renderSound(id, SR, v).l, `variant ${v}`).not.toEqual(a);
      });
    }
  });
});
