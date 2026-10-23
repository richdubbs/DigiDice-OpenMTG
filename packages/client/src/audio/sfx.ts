/**
 * The page's sound engine (audio/engine.ts), created on first use and bound to the settings store (Settings, Sound), and the shortcut every screen
 * uses: `sfx('ui.confirm')`. Tests replace the engine (`resetSoundEngineForTests`) or record what the page asks for (`recordSounds`).
 */
import { settingsStore } from '../settings/settings';
import type { SoundId } from './catalog';
import { SoundEngine, type PlayOpts } from './engine';

let shared: SoundEngine | null = null;
let unsubscribe: (() => void) | null = null;

export function soundEngine(): SoundEngine {
  if (!shared) {
    const store = settingsStore();
    const engine = new SoundEngine(() => store.get().sound);
    unsubscribe = store.subscribe(() => engine.applySettings());
    shared = engine;
  }
  return shared;
}

/** Play a sound (nothing is heard before the first user gesture, or with sound off). */
export function sfx(id: SoundId, opts?: PlayOpts): void {
  soundEngine().play(id, opts);
}

/** Tests only: forget the page-wide engine (the next `soundEngine()` makes a new one), or use `engine`. */
export function resetSoundEngineForTests(engine: SoundEngine | null = null): void {
  unsubscribe?.();
  unsubscribe = null;
  shared = engine;
}

export interface SoundRecording {
  /** The ids asked for, in order. */
  readonly ids: SoundId[];
  readonly calls: { id: SoundId; opts: PlayOpts }[];
  stop(): void;
}

/** Tests: records every sound the page asks for from now on (heard or not). */
export function recordSounds(): SoundRecording {
  const calls: { id: SoundId; opts: PlayOpts }[] = [];
  const ids: SoundId[] = [];
  const stop = soundEngine().subscribe((id, opts) => {
    calls.push({ id, opts });
    ids.push(id);
  });
  return { ids, calls, stop };
}
