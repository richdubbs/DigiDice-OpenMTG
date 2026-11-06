/**
 * edh-c-102: a sentence join, so that one template reads two sentences that make one instruction (as the joins of lower/ability.ts). Any other sentences are left as they are.
 *
 * `joinEdhV102` (CR 119.5, 608.2c; Touch of the Eternal, eff.edhv102.countPermanents.lifeBecomes): "Count the number of permanents you control. Your life total becomes that number." is
 * one instruction: the first sentence counts and the next sets the life total to that count (as join-edhn16.ts does for the cards in your library).
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');

export function joinEdhV102<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces[i + 1];
    if (next !== undefined && norms(p.tokens) === 'count the number of permanents you control .' && norms(next.tokens) === 'your life total becomes that number .') {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i++;
      continue;
    }
    // CR 608.2c, 608.2h (Martyr's Cry, eff.edhv102.exileAll.controllersDraw): "Exile all white creatures." and "For each creature exiled this way, its controller draws a card." are one instruction
    if (next !== undefined && norms(p.tokens).startsWith('exile all ') && norms(next.tokens) === 'for each creature exiled this way , its controller draws a card .') {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i++;
      continue;
    }
    // CR 608.2c, 611.2a, 609.4b (edh-d-58; Heartless Conscription, eff.edhd58.permit.play.eachExiled.dur.anyType): "Exile all creatures." and "For each card exiled this way, you may play that card for as
    // long as it remains exiled, and mana of any type can be spent to cast that spell." are one instruction (the permission is for the cards the exile took)
    if (next !== undefined && norms(p.tokens).startsWith('exile all ') && norms(next.tokens).startsWith('for each card exiled this way , you may play that card ')) {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i++;
      continue;
    }
    // CR 118.9, 601.2b, 205.3 (edh-d-58; Nahiri, Forged in Fury, eff.edhd58.permit.play.impulse.freeSubtype): "You may play that card this turn." and "You may cast Equipment spells this way without paying
    // their mana costs." are one permission (the cards of that subtype may be cast for nothing)
    if (next !== undefined && /^you may play (that card|it) (this turn|until end of turn) \.$/.test(norms(p.tokens)) && /^you may cast [a-z]+ spells this way without paying their mana costs \.$/.test(norms(next.tokens))) {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i++;
      continue;
    }
    // CR 111.4, 208.3 (Ritual of the Returned, eff.edhv102.zombieToken.ptOfCard): the token and the sentence that sets its power and toughness from the exiled card
    if (next !== undefined && norms(p.tokens) === 'create a black zombie creature token .' && norms(next.tokens).startsWith('its power is equal to')) {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}
