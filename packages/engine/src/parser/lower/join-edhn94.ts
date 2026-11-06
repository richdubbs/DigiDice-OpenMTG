/**
 * edh-next-94 sentence join (parser/lower/ability.ts#buildProgram): "You may tap any number of untapped <things> you control. Draw a card for each <thing> tapped this way." is one
 * instruction (CR 701.26a, 608.2c, 608.2d; Guild Summit): the cards drawn count what the first sentence tapped, so the two sentences are joined and one template reads them
 * (eff.edhn94.tap.anyNumber.draw). Joined only when the noun of the second sentence is the singular of the first's (same plain word), else both stay as they are.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');
const FIRST = /^you may tap any number of untapped ([a-z]+) you control \.$/;
const SECOND = /^draw a card for each ([a-z]+) tapped this way \.$/;

export function joinEdhN94TapAny<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    const m1 = FIRST.exec(norms(p.tokens));
    const m2 = a === undefined ? null : SECOND.exec(norms(a.tokens));
    if (a !== undefined && m1 !== null && m2 !== null && m1[1] === `${m2[1]}s`) {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}
