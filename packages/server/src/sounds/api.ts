/**
 * Godot plan phase 3, step 4: the sounds of the game for a front end that cannot synthesize them (the Godot table). The local server renders the
 * catalog's sounds (@openmtg/play/audio: the same recipes the browser renders in its worker) to WAV files on demand and keeps them on disk.
 *
 *   GET /api/sounds/manifest                 -> SoundsManifest (JSON)
 *   GET /api/sounds/<id>/<variant>.wav       -> 16-bit PCM stereo WAV at `RENDER_RATE` (48 kHz); 404 for an unknown id or variant
 *
 * A front end downloads every listed variant once and keeps them under the manifest's `hash` (Godot: `user://sounds/<hash>/`); a new hash means the
 * sounds changed. The WAV answers carry an ETag (the hash, the id and the variant), so a copy the front end already has is answered 304 without a body.
 */

export const SOUNDS_PREFIX = '/api/sounds';
export const SOUNDS_MANIFEST_PATH = `${SOUNDS_PREFIX}/manifest`;

/** One sound of the manifest. */
export interface SoundsManifestEntry {
  /** The catalog id ("cast.fire", "ui.click", "ambient.grid"): the path segment of its WAV files. */
  id: string;
  /** How many variants it has (0 to variants - 1, picked at random so a frequent sound never repeats exactly). */
  variants: number;
  /** Its length in milliseconds, the longest of its variants (each WAV's own length is in its header). */
  lengthMs: number;
  /** A seamless loop (the table's ambience). */
  loop?: true;
}

export interface SoundsManifest {
  /** `AUDIO_RENDER_VERSION` (@openmtg/play/audio/render). */
  version: number;
  /** A hash of the whole catalog (`catalogHash`): every recipe, the palette, the DSP, the render rate and version. */
  hash: string;
  /** The sample rate of every WAV (48000). */
  rate: number;
  sounds: SoundsManifestEntry[];
}
