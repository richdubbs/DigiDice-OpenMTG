/**
 * edh-next-134 sentence join (parser/lower/ability.ts#buildProgram): "its controller chooses target permanent another player controls that shares a card type with it. Exchange
 * control of those permanents." is one instruction (CR 701.12a, 603.3d; Confusion in the Ranks): "those permanents" are the target the first sentence names and the permanent "it" is,
 * so the two sentences are joined and one template reads them (eff.edhn134.itsControllerChoosesTarget.sharesCardType.exchangeControl). Joined only for exactly these two sentences.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm.toLowerCase()).join(' ');
const FIRST = "its controller chooses target permanent another player controls that shares a card type with it .";
const SECOND = 'exchange control of those permanents .';

/**
 * ... and (CR 701.55a, 508.4; Midnight Crusader Shuttle): "<player> faces a villainous choice -- That player sacrifices a creature of their choice, or you gain control of a creature of your
 * choice that player controls until end of turn. If you gain control of a creature this way, tap it, and it's attacking that player.": the second sentence is the rest of the second option
 * (eff.edhn134.villainous.sacrificeOrStealAttacking). Joined only for a first sentence ending with exactly that second option and exactly this second sentence.
 */
const VILLAIN_END = / faces a villainous choice -- that player sacrifices a creature of their choice , or you gain control of a creature of your choice that player controls until end of turn \.$/;
const VILLAIN_SECOND = "if you gain control of a creature this way , tap it , and it's attacking that player .";

export function joinEdhN134ChooseThenExchange<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    if (a !== undefined && ((norms(p.tokens) === FIRST && norms(a.tokens) === SECOND) || (VILLAIN_END.test(norms(p.tokens)) && norms(a.tokens) === VILLAIN_SECOND))) {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}
