/**
 * One pack entry against one card's text (design 12.5: a pack entry passes "schema, lint, capability degrade, and the exact render gate at install, on
 * the player's own text"; updates.md: "Invalid entries are rejected individually and reported"). The same check runs when a maintainer builds a pack
 * (on the maintainer's text) and when a player installs it (on the player's text). Pure.
 */
import { ABILITY_MODEL_VERSION, compileCardDetailed, type CompileSources, type CompiledCardEntry, type OracleCard } from '@openmtg/engine';
import { cardTextIn } from './card-text';
import { sourcesWith } from './sources';

export type EntryCheck =
  | { status: 'apply'; requiresEngine: string[] }
  /** The entry was made for another wording (errata since): not used, the parser decides. */
  | { status: 'textChanged' }
  /** Made for a newer ability model: not used until OpenMTG is updated. */
  | { status: 'newer' }
  /** Not usable on this text: the reason (render gate, lint, coverage, card text, trust). */
  | { status: 'rejected'; reason: string };

/** Compile `card` with `entry` as its only pack entry (on top of `base`, whose own pack entries are ignored) and judge the result. */
export function checkPackEntry(card: OracleCard, entry: CompiledCardEntry, base: CompileSources): EntryCheck {
  if (cardTextIn(entry, card) !== null) return { status: 'rejected', reason: 'contains card text (a name or a run of the Oracle text): packs ship structure only' };
  const r = compileCardDetailed(card, sourcesWith({ pack: { entries: new Map([[entry.oracleId, entry]]), templates: [] } }, base));
  if (r.report.textHash !== entry.textHash) return { status: 'textChanged' };
  if (entry.modelVersion > ABILITY_MODEL_VERSION) return { status: 'newer' };
  if (r.report.pack !== null) {
    const why = r.report.pack === 'trust' ? 'not trusted under your LLM trust setting' : r.report.pack;
    return { status: 'rejected', reason: `${why}${r.report.notApplied[0] ? `: ${r.report.notApplied[0].reason}` : ''}` };
  }
  if (r.report.notApplied.length > 0) return { status: 'rejected', reason: r.report.notApplied[0]!.reason };
  for (let i = 0; i < r.def.faces.length; i++) {
    const face = r.report.faces[i];
    const overlaid = new Set(face?.overlaid ?? []);
    for (const a of r.def.faces[i]!.abilities) {
      // the entry's abilities: a whole pack face, or the lines an overlay entry took (`covers`)
      const fromEntry = face?.source === 'pack' || ((a.src ?? []).length > 0 && (a.src ?? []).every((l) => overlaid.has(l)));
      // the pipeline's own demotion of an entry ability that failed the exact render gate or the lint on this text (cards/pipeline.ts#verifyForeign)
      if (fromEntry && a.kind === 'manual' && /^(gate-mismatch|lint)\b/.test(a.reason)) return { status: 'rejected', reason: a.reason };
    }
  }
  return { status: 'apply', requiresEngine: [...(r.def.automation.requiresEngine ?? [])] };
}
