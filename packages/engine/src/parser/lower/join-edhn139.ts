/**
 * edh-next-139 sentence joins (parser/lower/ability.ts#buildProgram): sentences that only read together, joined so one template reads them.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');

/**
 * CR 608.2c, 608.2d, 120.2b (Master of the Wild Hunt): "Each Wolf tapped this way deals damage equal to its power to target creature. That creature deals damage equal to its power divided
 * as its controller chooses among any number of those Wolves." is one exchange of damage: "that creature" is the target of the first sentence and "those Wolves" the Wolves tapped this way,
 * so the two sentences are joined and one template reads them (eff.edhn139.eachWolfTapped.dealsPower.targetDividesBack). Any other sentences are left as they are.
 */
export function joinEdhN139WolvesTrade<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    if (a !== undefined && norms(p.tokens) === 'each wolf tapped this way deals damage equal to its power to target creature .'
      && norms(a.tokens) === 'that creature deals damage equal to its power divided as its controller chooses among any number of those wolves .') {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens] });
      i += 1;
      continue;
    }
    out.push(p);
  }
  return out;
}
