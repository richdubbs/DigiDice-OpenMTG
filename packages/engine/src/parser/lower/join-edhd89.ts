/**
 * edh-d-89 sentence join (parser/lower/ability.ts#buildProgram): "If ~ and a creature named <partner> are attacking, and you both own and control them, exile them, then meld them into <result>. It
 * enters tapped and attacking." is one instruction (CR 701.42a, 712.4a, 508.4; Mishra, Claimed by Gix): "It" is the melded permanent the first sentence makes, so the two sentences are joined and one
 * template reads them (eff.edhd89.meldPair.bothAttacking.entersAttacking). Joined only when the first sentence melds ("exile them, then meld them into") and the second is exactly "It enters tapped and
 * attacking."; any other sentences are left as they are.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');
const MELDS = ', exile them , then meld them into ';
const SECOND = 'it enters tapped and attacking .';

export function joinEdhD89MeldEntersAttacking<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    if (a !== undefined && p.tokens[0]?.norm === 'if' && norms(p.tokens).includes(MELDS) && norms(a.tokens) === SECOND) {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}
