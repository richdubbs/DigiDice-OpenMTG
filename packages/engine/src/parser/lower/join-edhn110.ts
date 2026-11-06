/**
 * edh-next-110 sentence join (parser/lower/ability.ts#buildProgram): "Choose a player. They put N <kind> counters on a <thing> they control. Choose a second player to draw a card. Then
 * choose a third player to create N <tokens>." is one instruction of three different players' choices (CR 608.2d, 102.1; Gluntch, the Bestower): the second and third choices offer only
 * players not chosen before, so the four sentences are joined and one template reads them (eff.edhn110.choosePlayers.three). Joined only in exactly this order; otherwise each sentence
 * stays as it is.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');
const FIRST = /^choose a player \.$/;
const SECOND = /^(?:they|that player) put .* counters? on an? .* they control \.$/;
const THIRD = /^choose a second player to draw a card \.$/;
const FOURTH = /^then choose a third player to create .* \.$/;

export function joinEdhN110ChoosePlayers<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const quad = pieces.slice(i, i + 4);
    if (quad.length === 4 && FIRST.test(norms(quad[0]!.tokens)) && SECOND.test(norms(quad[1]!.tokens)) && THIRD.test(norms(quad[2]!.tokens)) && FOURTH.test(norms(quad[3]!.tokens))) {
      out.push({ ...p, tokens: quad.flatMap((x) => x.tokens) });
      i += 3;
      continue;
    }
    out.push(p);
  }
  return out;
}
