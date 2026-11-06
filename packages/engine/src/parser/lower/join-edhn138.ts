/**
 * edh-next-138 sentence join (parser/lower/ability.ts#buildProgram): "Create three tapped 2/2 black Zombie creature tokens and you gain 3 life. If this spell's madness cost was paid,
 * instead create X of those tokens and you gain X life." (From Under the Floorboards; CR 614.15, 608.2c): the second sentence replaces BOTH instructions of the first (another number of
 * the same tokens, another amount of life), which a rider (one previous step, parser/lower/riders.ts) cannot say; the two sentences are joined and one template reads them
 * (eff.edhn138.tappedTokensAndLife.insteadX). Joined only for exactly this shape, else the sentences stay as they are.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');
const FIRST = /^create \S+ tapped .+ tokens and you gain \S+ life \.$/;
const SECOND = /^if .+ , instead create x of those tokens and you gain x life \.$/;

export function joinEdhN138TokensLifeInstead<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    if (a !== undefined && FIRST.test(norms(p.tokens)) && SECOND.test(norms(a.tokens))) {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}
