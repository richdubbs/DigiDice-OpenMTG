/**
 * edh-next-105 sentence join (parser/lower/ability.ts#buildProgram): "Exile that card instead of putting it into your graveyard as it resolves. If you do, return it to your hand at the
 * beginning of the next end step." is one instruction (CR 614.1a, 608.2n, 603.7; Feather, the Redeemed): the "if you do" is the replacement of the spell's destination having applied,
 * and "it" is that card, so the two sentences are joined and one template reads them (eff.edhn105.castSpell.exileAsItResolves.thenReturnNextEnd). Joined only for exactly these two
 * sentences, else both stay as they are.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');
const FIRST = 'exile that card instead of putting it into your graveyard as it resolves .';
const SECOND = 'if you do , return it to your hand at the beginning of the next end step .';

export function joinEdhN105ExileThenReturn<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    if (a !== undefined && norms(p.tokens) === FIRST && norms(a.tokens) === SECOND) {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}
