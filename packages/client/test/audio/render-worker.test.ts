/**
 * Review 2026-10-26, Finding 21: sounds are made off the page's thread. The cache key of a rendered sound (audio/render.ts), the worker's job, the
 * stored copies (audio/pcmStore.ts), and the engine's promise that `play` never renders: a missing sound is asked of the worker (here a fake one) and
 * the play is skipped; the next play uses the answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECIPES, renderSound, SOUND_IDS, variantCount, type SoundId } from '../../src/audio/catalog';
import { SoundEngine } from '../../src/audio/engine';
import { indexedDbPcmStore, MemoryPcmStore } from '../../src/audio/pcmStore';
import {
  answerRender,
  AUDIO_RENDER_VERSION,
  forgetRecipeHashesForTests,
  recipeHash,
  RENDER_RATE,
  soundCacheKey,
  type RenderReply,
  type RenderRequest,
} from '../../src/audio/render';
import { workerRenderer, type SoundRenderer, type WorkerLike } from '../../src/audio/renderer';
import { DEFAULT_SOUND } from '../../src/settings/settings';
import { fakeIndexedDB } from '../fake-indexeddb';

// The catalog lives in @openmtg/play since the local server renders the sounds too (src/audio/catalog.ts re-exports it): the module render.ts calls is mocked.
vi.mock('@openmtg/play/audio/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmtg/play/audio/catalog')>();
  return { ...actual, renderSound: vi.fn(actual.renderSound) };
});

const renders = vi.mocked(renderSound);

/** A worker that keeps what it is asked and answers when the test says (rendering as the real worker does). */
class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent<RenderReply>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  readonly asked: RenderRequest[] = [];
  terminated = false;
  postMessage(message: RenderRequest): void {
    this.asked.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Answer the oldest request. */
  answer(): RenderRequest {
    const req = this.asked.shift();
    if (!req) throw new Error('nothing asked');
    this.onmessage?.({ data: answerRender(req).reply } as MessageEvent<RenderReply>);
    return req;
  }
}

/** Just enough Web Audio for the engine: every node connects, every parameter takes values; started sources are counted. */
class FakeAudioContext {
  static started: { buffer: unknown; loop: boolean }[] = [];
  static buffers = 0;
  state = 'running';
  currentTime = 0;
  destination = node();
  createDynamicsCompressor = () => node();
  createGain = () => node();
  createChannelSplitter = () => node();
  createChannelMerger = () => node();
  createStereoPanner = () => node();
  createBuffer(_channels: number, length: number, rate: number) {
    FakeAudioContext.buffers++;
    return { duration: length / rate, copyToChannel() {} };
  }
  createBufferSource() {
    const src = {
      ...node(),
      buffer: null as unknown,
      loop: false,
      onended: null,
      start: () => FakeAudioContext.started.push({ buffer: src.buffer, loop: src.loop }),
      stop() {},
    };
    return src;
  }
  resume = () => Promise.resolve();
}

function param() {
  return { value: 0, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} };
}

function node(): Record<string, unknown> {
  const n: Record<string, unknown> = {
    gain: param(),
    threshold: param(),
    knee: param(),
    ratio: param(),
    attack: param(),
    release: param(),
    pan: param(),
    playbackRate: param(),
    connect: (to: unknown) => to,
    disconnect() {},
  };
  return n;
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function engineWith(renderer: SoundRenderer, store: MemoryPcmStore | null = new MemoryPcmStore(), animating = () => false): SoundEngine {
  // random 0: always variant 0 (and no detune), so the tests know which variant is played.
  const e = new SoundEngine(() => DEFAULT_SOUND, () => 0, { renderer, store, animating });
  e.unlock();
  return e;
}

beforeEach(() => {
  FakeAudioContext.started = [];
  FakeAudioContext.buffers = 0;
  (window as unknown as { AudioContext?: unknown }).AudioContext = FakeAudioContext;
  renders.mockClear();
});

afterEach(() => {
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the cache key of a rendered sound', () => {
  it('is id#variant#recipeHash, the same every time', () => {
    const key = soundCacheKey('ui.confirm', 1);
    expect(key).toBe(`ui.confirm#1#${recipeHash('ui.confirm')}`);
    expect(key).toMatch(/^ui\.confirm#1#[0-9a-z]+-[0-9a-z]+$/);
    forgetRecipeHashesForTests();
    expect(soundCacheKey('ui.confirm', 1)).toBe(key);
    expect(soundCacheKey('ui.confirm', 0)).not.toBe(key);
    expect(AUDIO_RENDER_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('differs between sounds, and changes when a recipe changes', () => {
    const all = new Set(SOUND_IDS.map((id) => recipeHash(id)));
    expect(all.size).toBe(SOUND_IDS.length);
    const id: SoundId = 'ui.confirm';
    const before = recipeHash(id);
    const original = RECIPES[id]!;
    try {
      RECIPES[id] = (ctx) => original(ctx);
      forgetRecipeHashesForTests();
      expect(recipeHash(id)).not.toBe(before);
    } finally {
      RECIPES[id] = original;
      forgetRecipeHashesForTests();
    }
    expect(recipeHash(id)).toBe(before);
  });
});

describe('the render worker', () => {
  it('answers with the rendered channels and transfers their buffers', () => {
    const { reply, transfer } = answerRender({ job: 7, id: 'ui.confirm', variant: 0 });
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.job).toBe(7);
    expect(reply.l).toEqual(renderSound('ui.confirm', RENDER_RATE, 0).l);
    expect(transfer).toEqual([reply.l.buffer, reply.r.buffer]);
    expect(reply.l.buffer).not.toBe(reply.r.buffer);
  });

  it('answers a failure instead of throwing', () => {
    renders.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(answerRender({ job: 1, id: 'ui.confirm', variant: 0 }).reply).toEqual({ job: 1, ok: false, message: 'boom' });
  });
});

describe('the sound engine with a render worker', () => {
  it('never renders inside play: a missing sound is asked of the worker, this play is skipped, the next plays it', async () => {
    const worker = new FakeWorker();
    const store = new MemoryPcmStore();
    const engine = engineWith(workerRenderer(() => worker)!, store);
    expect(engine.ready).toBe(true);

    engine.play('ui.confirm');
    expect(renders).not.toHaveBeenCalled();
    expect(FakeAudioContext.started).toHaveLength(0);
    await flush();
    expect(worker.asked).toEqual([{ job: 1, id: 'ui.confirm', variant: 0 }]);
    // Asking again before the answer does not ask twice.
    engine.play('ui.confirm', { delay: 1 });
    await flush();
    expect(worker.asked).toHaveLength(1);

    worker.answer();
    await flush();
    expect(engine.isReady('ui.confirm', 0)).toBe(true);
    expect(store.rows.has(soundCacheKey('ui.confirm', 0))).toBe(true);
    const rendered = renders.mock.calls.length;
    engine.play('ui.confirm', { delay: 2 });
    expect(FakeAudioContext.started).toHaveLength(1);
    // The play itself rendered nothing (the only render was the worker's).
    expect(renders.mock.calls.length).toBe(rendered);
  });

  it('plays a variant that is ready while the one picked is being made', async () => {
    const worker = new FakeWorker();
    let r = 0;
    const engine = new SoundEngine(() => DEFAULT_SOUND, () => r, { renderer: workerRenderer(() => worker)!, store: null, animating: () => false });
    engine.unlock();
    const id = SOUND_IDS.find((s) => variantCount(s) > 1)!;
    const last = variantCount(id) - 1;
    engine.play(id);
    await flush();
    expect(worker.asked.map((q) => q.variant)).toEqual([0]);
    worker.answer();
    await flush();
    // Picks the last variant (not made yet): variant 0 is heard meanwhile and the last one is asked for.
    r = 0.99;
    engine.play(id, { delay: 1 });
    expect(FakeAudioContext.started).toHaveLength(1);
    await flush();
    expect(worker.asked.map((q) => q.variant)).toEqual([last]);
  });

  it('reads stored sounds back instead of asking the worker', async () => {
    const store = new MemoryPcmStore();
    const first = new FakeWorker();
    const a = engineWith(workerRenderer(() => first)!, store);
    a.prerender(['ui.confirm']);
    await flush();
    while (first.asked.length > 0) {
      first.answer();
      await flush();
    }
    const kept = store.rows.size;
    expect(kept).toBe(variantCount('ui.confirm'));

    const second = new FakeWorker();
    const b = engineWith(workerRenderer(() => second)!, store);
    b.prerender(['ui.confirm']);
    await flush();
    expect(second.asked).toEqual([]);
    expect(b.isReady('ui.confirm', 0)).toBe(true);
  });

  it('makes the prerender list in order, one at a time, and waits while the board animates', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    let animating = true;
    const engine = engineWith(workerRenderer(() => worker)!, null, () => animating);
    engine.prerender(['game.start', 'ui.confirm']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(worker.asked).toEqual([]);
    // A play still gets its sound asked for while the list waits.
    engine.play('turn.mine');
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.asked.map((r) => r.id)).toEqual(['turn.mine']);
    worker.answer();
    animating = false;
    await vi.advanceTimersByTimeAsync(300);
    expect(worker.asked.map((r) => `${r.id}#${r.variant}`)).toEqual(['game.start#0']);
    worker.answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.asked.map((r) => `${r.id}#${r.variant}`)).toEqual(['ui.confirm#0']);
  });

  it('starts the ambience when its loop arrives, without rendering it on the page', async () => {
    const worker = new FakeWorker();
    const engine = engineWith(workerRenderer(() => worker)!);
    const release = engine.holdAmbience();
    expect(renders).not.toHaveBeenCalled();
    await flush();
    expect(worker.asked.map((r) => r.id)).toEqual(['ambient.grid']);
    worker.answer();
    await flush();
    expect(FakeAudioContext.started.filter((s) => s.loop)).toHaveLength(1);
    release();
  });

  it('falls back to rendering on the page while idle when the worker cannot start, still never inside play', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const engine = engineWith(
      workerRenderer(() => {
        throw new Error('no workers here');
      })!,
    );
    engine.play('ui.confirm');
    expect(renders).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(engine.isReady('ui.confirm', 0)).toBe(true));
    expect(renders).toHaveBeenCalledTimes(1);
    engine.play('ui.confirm', { delay: 1 });
    expect(FakeAudioContext.started).toHaveLength(1);
  });

  it('hands the jobs of a worker that fails to the fallback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const worker = new FakeWorker();
    const engine = engineWith(workerRenderer(() => worker)!);
    engine.play('ui.confirm');
    await flush();
    expect(worker.asked).toHaveLength(1);
    worker.onerror?.({ message: 'crashed', preventDefault() {} } as ErrorEvent);
    expect(worker.terminated).toBe(true);
    await vi.waitFor(() => expect(engine.isReady('ui.confirm', 0)).toBe(true));
  });
});

describe('the stored sounds', () => {
  it('keeps and reads back rendered sounds in IndexedDB, and prunes keys no longer in use', async () => {
    const idb = fakeIndexedDB();
    const store = indexedDbPcmStore(idb.factory, 'sounds-test')!;
    const st = { l: new Float32Array([0.1, 0.2]), r: new Float32Array([0.3, 0.4]) };
    expect(await store.get('a')).toBeUndefined();
    await store.put('a', st);
    const back = await store.get('a');
    expect(back?.l).toEqual(st.l);
    expect(back?.r).toEqual(st.r);
    expect(idb.rows('sounds-test', 'pcm')).toHaveLength(1);
    // The test IndexedDB has no getAllKeys: pruning fails quietly.
    await expect(store.prune(new Set())).resolves.toBeUndefined();
  });

  it('works without storage: every call answers "nothing stored"', async () => {
    const broken = { open: () => { throw new Error('blocked'); } } as unknown as IDBFactory;
    const store = indexedDbPcmStore(broken)!;
    await store.put('a', { l: new Float32Array(1), r: new Float32Array(1) });
    expect(await store.get('a')).toBeUndefined();
    await expect(store.prune(new Set())).resolves.toBeUndefined();
  });

  it('memory store prunes stale keys', async () => {
    const store = new MemoryPcmStore();
    await store.put('old', { l: new Float32Array(1), r: new Float32Array(1) });
    await store.put('new', { l: new Float32Array(1), r: new Float32Array(1) });
    await store.prune(new Set(['new']));
    expect([...store.rows.keys()]).toEqual(['new']);
  });
});
