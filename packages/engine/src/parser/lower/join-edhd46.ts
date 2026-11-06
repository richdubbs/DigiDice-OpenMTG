/**
 * edh-d-46 (Commander lane lands, second pass): sentence joins, so that one template reads sentences that make one instruction (as the joins of lower/ability.ts). Any other sentences
 * are left as they are.
 *
 * `joinEdhD46` (CR 701.23a, 608.2c; Tithe, eff.edhd46.search.additional.ifOpponentMoreLands.toHand): "Search your library for a Plains card. If target opponent controls more lands than you,
 * you may search your library for an additional Plains card. Reveal those cards, put them into your hand, then shuffle." is one search whose second part depends on a condition and whose
 * last sentence moves both finds.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');

export function joinEdhD46<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces[i + 1];
    const third = pieces[i + 2];
    if (next !== undefined && third !== undefined && /^search your library for a [a-z ]+ card \.$/.test(norms(p.tokens)) && /^if [a-z ]+ controls more lands than you , you may search your library for an additional [a-z ]+ card \.$/.test(norms(next.tokens))
      && norms(third.tokens) === 'reveal those cards , put them into your hand , then shuffle .') {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens, ...third.tokens] });
      i += 2;
      continue;
    }
    // CR 702.33a, 701.26b, 613.1d (Hunting Wilds, eff.edhd46.ifKicked.untapAllPutThisWay.become.creatures): the kicked rider that untaps the lands put onto the battlefield and the sentence that makes "them" creatures
    if (next !== undefined && /^if ~ was kicked , untap all [a-z ]+ put onto the battlefield this way \.$/.test(norms(p.tokens)) && /^they become \S+ [a-z]+ creatures with [a-z, ]+ that are still lands \.$/.test(norms(next.tokens))) {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i += 1;
      continue;
    }
    out.push(p);
  }
  return out;
}
