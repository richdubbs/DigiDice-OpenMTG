/**
 * The volatile layer inputs (performance, review 2026-10-26): parts of the state that change during most actions but that the layer system reads only when a
 * definition or a resolved effect asks for them. The characteristics cache (rules/characteristics.ts) leaves each of them out of its key unless the computation
 * that produced the entry READ it, so passing a step, tapping a land for mana or casting a spell does not recompute the layers of every object for nothing.
 *
 * How it stays exact: every place in the code the layer system runs (statics/layers.ts#computeAll and everything it calls) and in the rule effects' collection
 * that shares its cache entry (statics/rule-sources.ts#collectSources) that reads one of these parts calls `noteLayerRead` first; `trackingLayerReads` returns
 * the parts a computation noted. A deterministic computation that read none of the parts that changed reads the same values, takes the same path and gives the
 * same answer. Adding a read of one of these parts to that code means adding the note next to it (test/perf/layer-reads.test.ts checks cached answers against
 * fresh ones over real games, and pins the read sites).
 *
 * Synchronous and scoped: nothing outlives a tracked call; nested tracked calls also count for the outer one (a conservative superset).
 */

/** The current step (`GameState.turn.step`): read by "during your <step>" conditions (statics/match.ts `turnOf`). */
export const READ_STEP = 1;
/** Whether a permanent is tapped (`GameObject.tapped`): the `tapped` filter, the "for as long as it remains tapped" durations. */
export const READ_TAPPED = 2;
/** The combat (`GameState.combat`): the attacking / blocking filters, a history scope of "this combat". */
export const READ_COMBAT = 4;
/** A player's mana pool (`PlayerState.manaPool`): the `unspentMana` quantity. */
export const READ_MANA_POOL = 8;
/** A player's counts for the turn (`PlayerState.turnStats`): "cards drawn this turn", "life lost this turn" and the like. */
export const READ_TURN_STATS = 16;
/** A player's life total (`PlayerState.life`): life quantities and comparisons. */
export const READ_LIFE = 32;

let noted = 0;

/** Called by the layer code right before it reads one of the volatile parts (`READ_*`). */
export function noteLayerRead(part: number): void {
  noted |= part;
}

/** Runs `f` and returns its result with the volatile parts it read (`READ_*` bits). */
export function trackingLayerReads<T>(f: () => T): { value: T; reads: number } {
  const outer = noted;
  noted = 0;
  try {
    const value = f();
    return { value, reads: noted };
  } finally {
    noted |= outer;
  }
}

/**
 * Tests set `on` to make every answer the caches give from an entry whose key left volatile parts out (rules/characteristics.ts, statics/rule-sources.ts) be
 * computed again and compared (an EngineBug if they differ): the cached-versus-uncached check. Never set by the engine.
 */
export const LAYER_READS_VERIFY = { on: false };
