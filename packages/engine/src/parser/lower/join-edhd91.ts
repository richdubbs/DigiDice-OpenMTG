/**
 * edh-d-91 (Commander coordinator D, EDHREC ranks 5,001-10,000, group combat): sentence joins, so that one template reads sentences that make one instruction (as the joins of
 * lower/ability.ts). Any other sentences are left as they are.
 *
 * `joinEdhD91` (CR 118.12, 608.2d, 701.21a, 701.23a, 201.2; Canoptek Wraith, eff.edhd91.mayPaySacrificeIt.chooseLand.searchSameName): "You may pay {3} and sacrifice it. If you do, choose a
 * land you control. Then search your library for up to two basic land cards which have the same name as the chosen land, put them onto the battlefield tapped, then shuffle." is ONE optional
 * payment (the mana and the sacrifice of the source together: CR 118.12, a cost that can't be paid in full is not paid, so a Wraith that has left the battlefield pays nothing and nothing
 * happens) whose "if you do" covers both later sentences (the search names "the chosen land", which only the payment's branch chooses). Only these exact three sentences.
 * Also Timothar's three sentences (one payment, its token, the token's granted ability), and Chiss-Goria's "You may cast an artifact spell from among them this turn. If you do, it has affinity for artifacts." (one permission with its rider).
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');

export function joinEdhD91<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces[i + 1];
    const third = pieces[i + 2];
    if (next !== undefined && third !== undefined && /^you may pay (\{[^ ]+\} )+and sacrifice it \.$/.test(norms(p.tokens)) && norms(next.tokens) === 'if you do , choose a land you control .'
      && norms(third.tokens) === 'then search your library for up to two basic land cards which have the same name as the chosen land , put them onto the battlefield tapped , then shuffle .') {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens, ...third.tokens] });
      i += 2;
      continue;
    }
    // CR 601.3, 601.2f, 702.41a (Chiss-Goria, Forge Tyrant; eff.edhd91.mayCastArtifactFromGroup.thisTurn.hasAffinity): the permission and its "If you do, it has affinity for artifacts" (the spell
    // cast with that permission has the keyword as it is cast), one instruction
    if (next !== undefined && /^you may cast an artifact spell from among [a-z ]+ this turn \.$/.test(norms(p.tokens)) && norms(next.tokens) === 'if you do , it has affinity for artifacts .') {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i += 1;
      continue;
    }
    // CR 118.12, 607.2a, 613.1f (Timothar, Baron of Bats; eff.edhd91.mayPayExileIt.batToken.gainsReturnQuote): "you may pay {1} and exile it. If you do, create <token>. It gains "<quote>"." is one
    // optional payment (no card to exile, no payment: ruling 2021-11-19) with a token whose granted ability returns the card this resolution exiled
    if (next !== undefined && third !== undefined && /^you may pay (\{[^ ]+\} )+and exile it \.$/.test(norms(p.tokens)) && /^if you do , create a [^.]+ token with flying \.$/.test(norms(next.tokens))
      && norms(third.tokens).replace(/\s+/g, '') === 'itgains"when~dealscombatdamagetoaplayer,sacrificeitandreturntheexiledcardtothebattlefieldtapped."') {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens, ...third.tokens] });
      i += 2;
      continue;
    }
    out.push(p);
  }
  return out;
}
