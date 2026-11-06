/**
 * edh-d-99 sentence joins (parser/lower/ability.ts#buildProgram). Each joins sentences that are one instruction only for exactly the shape it names, else the sentences stay as they are.
 *
 * `searchExileRestChosenOnTop` (CR 701.23a, 701.23d, 401.4, 608.2c; Doomsday, ruling 2018-03-16): "Search your library and graveyard for N cards and exile the rest. Put the chosen cards on
 * top of your library in any order.": "the chosen cards" of the second sentence are the cards the search of the first found, so the two sentences are one instruction that one template
 * reads (eff.edhd99.search.libraryAndGraveyard.exactly.exileRest.chosenOnTop).
 *
 * `poisonedExileLookPlay` (CR 406.3, 601.3, 609.4b, 608.2c; Ixhel, Scion of Atraxa): "Each opponent who has N or more poison counters exiles the top card of their library face down. You may look
 * at and play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color to cast those spells.": "those cards" are the cards the opponents
 * exiled, so the two sentences are one instruction (eff.edhd99.eachOpp.poisonAtLeast.exileTopFaceDown.lookPlay.anyColor).
 *
 * `repeatForEachOpponent` (CR 608.2c, 101.4, 119.4; Protection Racket): "Repeat the following process for each opponent in turn order. Reveal the top card of your library. That player may pay
 * life equal to that card's mana value. If they do, exile that card. Otherwise, put it into your hand.": the four sentences after the first are the process done once for each opponent ("that
 * player" is the opponent of the run), so the five sentences are one instruction (eff.edhd99.repeat.eachOpp.revealTop.mayPayLifeMv.exileElseHand). Joined only all five, exactly.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');
const SEARCH_REST = /^search your library and graveyard for \S+ cards and exile the rest \.$/;
const CHOSEN_ON_TOP = 'put the chosen cards on top of your library in any order .';
const POISONED_EXILE = /^each opponent who has \S+ or more poison counters exiles the top card of their library face down \.$/;
const LOOK_PLAY_ANY_COLOR = 'you may look at and play those cards for as long as they remain exiled , and you may spend mana as though it were mana of any color to cast those spells .';
const PAIRS: [RegExp, string][] = [[SEARCH_REST, CHOSEN_ON_TOP], [POISONED_EXILE, LOOK_PLAY_ANY_COLOR]];
const RACKET = ['repeat the following process for each opponent in turn order .', 'reveal the top card of your library .', "that player may pay life equal to that card 's mana value .", 'if they do , exile that card .', 'otherwise , put it into your hand .'];

export function joinEdhD99<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    if (RACKET.every((w, k) => pieces[i + k] !== undefined && norms(pieces[i + k]!.tokens) === w)) {
      out.push({ ...p, tokens: pieces.slice(i, i + RACKET.length).flatMap((x) => x.tokens) });
      i += RACKET.length - 1;
      continue;
    }
    if (a !== undefined && PAIRS.some(([first, second]) => first.test(norms(p.tokens)) && norms(a.tokens) === second)) {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}
