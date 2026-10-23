/** The classification index's background build (automation.ts) pauses while a request a player waits on holds it (`whilePaused`). */
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AutomationIndex } from '../src/automation';
import { makeFixtureCache, type FixtureCache } from './fixture-cache';

vi.setConfig({ testTimeout: 60_000 });

let fx: FixtureCache;

beforeAll(() => {
  fx = makeFixtureCache();
});

afterAll(() => {
  fx.cleanup();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** A few cards are enough (compiling the whole fixture set takes seconds). */
const cards = () => fx.deckCards.slice(0, 8);

/** Every card ends a slice (the clock moves past the slice length at each reading), so the build reaches its pause point after each card. */
function slicePerCard() {
  let now = 0;
  return vi.spyOn(performance, 'now').mockImplementation(() => (now += 1000));
}

describe('AutomationIndex.whilePaused', () => {
  it('the build classifies nothing more while a request holds it, and finishes once it is released', async () => {
    const clock = slicePerCard();
    const index = new AutomationIndex(path.join(fx.dir, 'compiled-paused'), cards());
    let build: Promise<void> | undefined;
    await index.whilePaused(async () => {
      build = index.start();
      await wait(200);
      const held = index.progress().done;
      expect(held).toBeLessThan(cards().length);
      await wait(200);
      expect(index.progress().done).toBe(held);
      expect(index.isComplete).toBe(false);
    });
    clock.mockRestore();
    await build;
    expect(index.isComplete).toBe(true);
    expect(index.progress().done).toBe(cards().length);
  });

  it('stop() ends a paused build (shutdown never waits for the request)', async () => {
    slicePerCard();
    const index = new AutomationIndex(path.join(fx.dir, 'compiled-stopped'), cards());
    let release!: () => void;
    const held = index.whilePaused(() => new Promise<void>((resolve) => (release = resolve)));
    const build = index.start();
    await wait(200);
    index.stop();
    await build;
    expect(index.isComplete).toBe(false);
    release();
    await held;
  });
});
