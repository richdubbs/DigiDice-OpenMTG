/**
 * Verified examples for the prompt (design 11.2 EXAMPLES): five canonical cards always (in the cached SYSTEM prompt), plus the nearest by text similarity
 * (in the USER message). Examples are cards the game path compiles `full` (every ability passed the parser's gates), shown as their normalized lines and
 * their stored JSON. Pure.
 */
import { compileCardDetailed, defaultCompileSources, type CompileSources, type OracleCard } from '@openmtg/engine';
import { faceViews } from './face-lines';
import { promptAbility, type PromptExample } from './prompt';

/** A spell, a pump with a duration, an activated ability, a mana ability, a keyword line: one of each shape the model must write. */
export const CANONICAL_NAMES: readonly string[] = ['Lightning Bolt', 'Giant Growth', 'Prodigal Pyromancer', 'Llanowar Elves', 'Serra Angel'];

/** The example of a single-faced card the sources compile `full`, or null. */
export function exampleOf(card: OracleCard, sources: CompileSources = defaultCompileSources()): PromptExample | null {
  if (card.card_faces && card.card_faces.length > 1) return null;
  const { def } = compileCardDetailed(card, sources);
  if (def.automation.level !== 'full' || def.faces.length !== 1) return null;
  const view = faceViews(card, sources.parse)[0];
  const abilities = def.faces[0]!.abilities;
  if (!view || abilities.length === 0) return null;
  return { typeLine: view.typeLine, lines: view.lines, abilities: abilities.map(promptAbility) };
}

/** The canonical examples (in CANONICAL_NAMES order) and the pool of the others, from a list of cards (the committed fixture set by default). */
export function buildExamples(cards: readonly OracleCard[], sources: CompileSources = defaultCompileSources()): { canonical: PromptExample[]; pool: PromptExample[]; poolIds: string[] } {
  const canonical: PromptExample[] = [];
  for (const n of CANONICAL_NAMES) {
    const c = cards.find((x) => x.name === n);
    const e = c ? exampleOf(c, sources) : null;
    if (e) canonical.push(e);
  }
  const pool: PromptExample[] = [];
  const poolIds: string[] = [];
  for (const c of cards) {
    if (CANONICAL_NAMES.includes(c.name)) continue;
    const e = exampleOf(c, sources);
    if (e) {
      pool.push(e);
      poolIds.push(c.oracle_id ?? c.name);
    }
  }
  return { canonical, pool, poolIds };
}
