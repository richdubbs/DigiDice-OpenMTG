/**
 * edh-d-94 (Commander band 5,001-10,000, group counters part 3): sentence joins, so that one template reads sentences that make one instruction (as the joins of lower/ability.ts). Any
 * other sentences are left as they are.
 *
 * `joinEdhD94` (CR 406.1, 608.2c, 608.2h; Oversimplify, eff.edhd94.exileAllCreatures.eachPlayerToken.countersTotalPowerTheyControlled): "Exile all creatures. Each player creates a ... token
 * and puts a number of +1/+1 counters on it equal to the total power of creatures they controlled that were exiled this way." is one instruction: "exiled this way" are the creatures the
 * first sentence exiled, counted for each player by who controlled them as they last existed. And Suppression Ray's four sentences (below).
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');

export function joinEdhD94<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces[i + 1];
    if (next !== undefined && norms(p.tokens) === 'exile all creatures .'
      && /^each player creates .+ token and puts a number of \S+ counters on it equal to the total power of creatures they controlled that were exiled this way \.$/.test(norms(next.tokens))) {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i += 1;
      continue;
    }
    // CR 701.26a, 107.14, 608.2c (Suppression Ray, eff.edhd94.tapAll.mayPayAnyEnergy.chooseUpToTappedThisWay.stunEach): the tap, the optional payment of any amount of {E}, the choice of up
    // to that many of the creatures tapped this way and the stun counters are one instruction ("that many" is the energy paid, "them" the chosen creatures)
    const [b, c, e] = [pieces[i + 1], pieces[i + 2], pieces[i + 3]];
    if (b !== undefined && c !== undefined && e !== undefined && /^tap all creatures [a-z ]+ controls \.$/.test(norms(p.tokens)) && /^you may pay any amount of \S+ \.$/.test(norms(b.tokens))
      && norms(c.tokens) === 'if you do , choose up to that many creatures tapped this way .' && /^put a \S+ counter on each of them \.$/.test(norms(e.tokens))) {
      out.push({ ...p, tokens: [...p.tokens, ...b.tokens, ...c.tokens, ...e.tokens] });
      i += 3;
      continue;
    }
    // CR 701.20a, 603.12 (Yuna's Whistle, eff.edhd94.revealUntil.putHandRestBottom.whenRevealedThisWay.countersMv): the reveal, the moves and the reflexive ability that waits for a
    // creature card revealed this way are one instruction ("this way" and "that card" are the card the first sentence stopped at)
    if (b !== undefined && c !== undefined && norms(p.tokens) === 'reveal cards from the top of your library until you reveal a creature card .'
      && norms(b.tokens) === 'put that card into your hand and the rest on the bottom of your library in a random order .'
      && /^when you reveal a creature card this way , put x \S+ counters on .+ , where x is the mana value of that card \.$/.test(norms(c.tokens))) {
      out.push({ ...p, tokens: [...p.tokens, ...b.tokens, ...c.tokens] });
      i += 2;
      continue;
    }
    // CR 111.1, 122.6, 614.1c (Printlifter Ooze, eff.edhd94.token.thenEntersWithCountersNumberOfOther): the creation of one token and the sentence that says it enters with counters are one
    // instruction ("the token" and "it" are the token the first sentence creates)
    if (b !== undefined && /^(?:.+ , )?create a .+ token(?: with [a-z ,]+)? \.$/.test(norms(p.tokens)) && /^the token enters with x \S+ counters on it , where x is the number of other [a-z ]+ \.$/.test(norms(b.tokens))) {
      out.push({ ...p, tokens: [...p.tokens, ...b.tokens] });
      i += 1;
      continue;
    }
    // CR 122.1, 608.2c (Contractual Safeguard, eff.edhd94.chooseCounterKindOnYours.putOnEachOther): the choice of a kind of counter on a creature you control and the counters of that kind
    // on each OTHER creature you control are one instruction ("other" than the creature the kind was chosen on)
    if (b !== undefined && norms(p.tokens) === 'choose a kind of counter on a creature you control .' && norms(b.tokens) === 'put a counter of that kind on each other creature you control .') {
      out.push({ ...p, tokens: [...p.tokens, ...b.tokens] });
      i += 1;
      continue;
    }
    out.push(p);
  }
  return out;
}
