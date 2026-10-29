/**
 * Rendering a sound (Review 2026-10-26, Finding 21): what the render worker (render.worker.ts) runs and what the page keys its stored copies by. This
 * file and everything it imports (catalog.ts, the recipes, palette.ts, dsp.ts, analysis.ts) stay pure: no DOM, no Web Audio, no storage. That is what
 * lets the same code run in the worker, in Node (tests, scripts/sound/render.ts) and, as a last resort, on the page.
 * Godot plan phase 3: these files live in @openmtg/play (the client re-exports them at their old paths, packages/client/src/audio), so the local server
 * renders the same sounds for the Godot table too (packages/server/src/sounds: GET /api/sounds/manifest and /api/sounds/<id>/<variant>.wav; wav.ts).
 *
 * A rendered sound is kept in the browser (pcmStore.ts) under `soundCacheKey`: its id, its variant and `recipeHash`, a hash of everything the render
 * depends on that the page can see: the catalog entry (its metadata and its recipe's code), the palette and DSP building blocks' code and constants,
 * the render rate, and `AUDIO_RENDER_VERSION`. A recipe or palette edit changes the hash by itself; a change the hash cannot see (a helper private to
 * dsp.ts or to a recipe file, analysis.ts's loudness) needs `AUDIO_RENDER_VERSION` bumped, or players keep hearing the old sound.
 */
import { RECIPES, renderSound, SOUND_IDS, SOUND_META, type SoundId } from './catalog';
import * as dsp from './dsp';
import { hashString, type Stereo } from './dsp';
import * as palette from './palette';

/** The rate every sound is rendered at; the browser resamples to the device's rate on playback. */
export const RENDER_RATE = 48000;

/** Bump when dsp.ts (or anything else a rendered sound depends on that `recipeHash` cannot see) changes: every stored sound is then rendered again. */
export const AUDIO_RENDER_VERSION = 1;

/** What the page asks the render worker for. */
export interface RenderRequest {
  /** The page's number for this job (its answer carries it back). */
  job: number;
  id: SoundId;
  variant: number;
}

/** The worker's answer: the two channels (transferred, not copied), or why it could not. */
export type RenderReply = { job: number; ok: true; l: Float32Array; r: Float32Array } | { job: number; ok: false; message: string };

/** A sound rendered at RENDER_RATE, its two channels in buffers of their own (so both can be transferred). */
export function renderStereo(id: SoundId, variant: number): Stereo {
  const st = renderSound(id, RENDER_RATE, variant);
  return { l: st.l, r: st.r.buffer === st.l.buffer ? st.r.slice() : st.r };
}

/** The worker's whole job, as a function (the worker calls it; tests call it without a worker). */
export function answerRender(req: RenderRequest): { reply: RenderReply; transfer: ArrayBuffer[] } {
  try {
    const st = renderStereo(req.id, req.variant);
    return { reply: { job: req.job, ok: true, l: st.l, r: st.r }, transfer: [st.l.buffer as ArrayBuffer, st.r.buffer as ArrayBuffer] };
  } catch (e) {
    return { reply: { job: req.job, ok: false, message: e instanceof Error ? e.message : String(e) }, transfer: [] };
  }
}

/** A module's exports as text: functions and classes by their code, everything else as JSON, in name order. */
function moduleText(mod: Record<string, unknown>): string {
  return Object.keys(mod)
    .sort()
    .map((k) => {
      const v = mod[k];
      return `${k}=${typeof v === 'function' ? v.toString() : JSON.stringify(v)}`;
    })
    .join('\n');
}

let shared: string | null = null;
const hashes = new Map<SoundId, string>();

/** The part of every recipe hash shared by all sounds: the render version and rate, and the palette and DSP building blocks. */
function sharedPart(): string {
  shared ??= `v${AUDIO_RENDER_VERSION}@${RENDER_RATE}|${hashString(moduleText(palette as unknown as Record<string, unknown>)).toString(36)}|${hashString(moduleText(dsp as unknown as Record<string, unknown>)).toString(36)}`;
  return shared;
}

/**
 * A stable hash of what a sound's render depends on (see the file comment): the same in every session of the same build. In a minified build the code
 * text changes with most releases, so a new release renders its sounds again once (in the worker).
 */
export function recipeHash(id: SoundId): string {
  let h = hashes.get(id);
  if (h === undefined) {
    const recipe = RECIPES[id];
    const entry = `${id}|${JSON.stringify(SOUND_META[id])}|${recipe ? recipe.toString() : 'placeholder'}`;
    h = `${hashString(sharedPart()).toString(36)}-${hashString(entry).toString(36)}`;
    hashes.set(id, h);
  }
  return h;
}

/** Where a rendered sound is kept: `${id}#${variant}#${recipeHash}`. */
export function soundCacheKey(id: SoundId, variant: number): string {
  return `${id}#${variant}#${recipeHash(id)}`;
}

/**
 * Godot plan phase 3: one hash of the whole catalog (every sound's `recipeHash`, in catalog order): what a copy of the rendered sounds is kept under (the
 * server's cache, the Godot table's `user://sounds/<hash>/`). Any change to any sound, the palette, the DSP or the render version gives a new one.
 */
export function catalogHash(): string {
  return hashString(SOUND_IDS.map((id) => `${id}=${recipeHash(id)}`).join('|')).toString(36);
}

/** Tests only: forget the hashes worked out so far (after changing a recipe or a catalog entry). */
export function forgetRecipeHashesForTests(): void {
  shared = null;
  hashes.clear();
}
