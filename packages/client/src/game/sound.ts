/**
 * How the game screen makes a sound (docs/design/sound.md). Every part of the screen (the board's animator, the prompts, the hand, the zone viewers, the
 * result screen) plays through `gameSfx`, `playCues` or `gamePlayer`, which never throw (a sound problem must never break or delay the game) and note when
 * each sound started on the shared clock, so the parts can stay out of each other's way: the prompt's "your move" gives way to the turn banner, the first
 * turn's banner to the game's start, the result to the final blow.
 *
 * A leaf module (the audio engine and nothing else), so the board, the prompts and the game screen can all use it without depending on each other.
 */
import type { SoundId } from '../audio/catalog';
import type { PlayOpts, SoundPlayer } from '../audio/engine';
import { soundEngine } from '../audio/sfx';

/** One sound to play, with its options (delay in seconds from now, as `PlayOpts`). */
export interface SoundCue extends PlayOpts {
  id: SoundId;
}

/** When each sound last started (a delayed one counts from its start), in Date.now() milliseconds. */
export class SoundClock {
  private readonly at = new Map<SoundId, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  note(id: SoundId, delaySeconds = 0): void {
    this.at.set(id, this.now() + Math.max(0, delaySeconds) * 1000);
  }

  /** Milliseconds since `id` started (negative while it is still scheduled); Infinity when it never played. */
  since(id: SoundId): number {
    const t = this.at.get(id);
    return t === undefined ? Infinity : this.now() - t;
  }

  /** True when `id` started less than `ms` ago (or is scheduled to start). */
  recent(id: SoundId, ms: number): boolean {
    return this.since(id) < ms;
  }

  reset(): void {
    this.at.clear();
  }
}

/** The screen's clock (one page, one game screen at a time). */
export const soundClock = new SoundClock();

/** Tests: forget every sound played so far. */
export function resetSoundClockForTests(): void {
  soundClock.reset();
}

/** Play one cue through `player`; never throws. */
export function playCue(player: SoundPlayer | null | undefined, cue: SoundCue, clock: SoundClock = soundClock): void {
  if (!player) return;
  try {
    const { id, ...opts } = cue;
    player.play(id, opts);
    clock.note(id, opts.delay ?? 0);
  } catch (e) {
    console.error('[sound] could not play', cue.id, e);
  }
}

/** RPL-2 (replays design 8): a replay at its condensed speeds, above 4x, mutes the game's sounds (by default; the viewer can turn it off). */
let muted = false;

/** Mute (or unmute) every game sound played through this module: the board's animator, the prompts, the condensed cues. The ambience goes on. */
export function setGameSoundsMuted(on: boolean): void {
  muted = on;
}

export function gameSoundsMuted(): boolean {
  return muted;
}

/** Until when (Date.now() ms) the game's sounds are held back: a replay's jump is shown without sound (replays design 8). */
let quietUntil = 0;

/**
 * Hold the game's sounds back for `ms`: a replay calls it as a jump is drawn, so what reacts to the new view by itself (the result screen's fanfare)
 * stays silent; the next change comes after a pause longer than this.
 */
export function quietGameSounds(ms: number): void {
  quietUntil = Math.max(quietUntil, Date.now() + ms);
}

function engine(): SoundPlayer | null {
  if (muted || Date.now() < quietUntil) return null;
  try {
    return soundEngine();
  } catch {
    return null;
  }
}

/** Play a game-screen sound through the page's engine (silent before the first user gesture or with sound off). */
export function gameSfx(id: SoundId, opts: PlayOpts = {}): void {
  playCue(engine(), { id, ...opts });
}

export function playCues(cues: readonly SoundCue[]): void {
  const player = engine();
  for (const c of cues) playCue(player, c);
}

/** The player the board's animator gets: the page's engine, through the clock. */
export const gamePlayer: SoundPlayer = { play: (id, opts) => playCue(engine(), { id, ...opts }) };

/** At most one go per `ms` (a sweep of the pointer over many cards must not sound like a machine gun). */
export class RateLimit {
  private last = -Infinity;

  constructor(
    private readonly ms: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  take(): boolean {
    const t = this.now();
    if (t - this.last < this.ms) return false;
    this.last = t;
    return true;
  }
}
