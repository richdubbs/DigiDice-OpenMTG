/**
 * edh-next-16: sentence joins, so that one template reads two sentences that make one instruction (as the joins of lower/ability.ts). Any other sentences are left as they are.
 *
 * `joinCountLibraryLife` (CR 119.5, 608.2c; Invincible Hymn, eff.edhn16.countLibrary.lifeBecomes): "Count the number of cards in your library. Your life total becomes that number." is one
 * instruction: the first sentence counts and the next sets the life total to that count. Also the choice of lands or creatures with its rider on the creatures destroyed (Catastrophe,
 * eff.edhn16.destroyAll.landsOrCreatures.noRegenCreatures).
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');

export function joinEdhN16<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces[i + 1];
    if (next !== undefined && norms(p.tokens) === 'count the number of cards in your library .' && norms(next.tokens) === 'your life total becomes that number .') {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i++;
      continue;
    }
    // CR 701.8a, 701.19c (Catastrophe, eff.edhn16.destroyAll.landsOrCreatures.noRegenCreatures): the choice of lands or creatures and the rider on the creatures destroyed
    if (next !== undefined && norms(p.tokens) === 'destroy all lands or all creatures .' && norms(next.tokens) === "creatures destroyed this way can't be regenerated .") {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}
