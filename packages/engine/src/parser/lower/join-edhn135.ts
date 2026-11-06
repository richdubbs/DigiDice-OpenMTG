/**
 * edh-next-135 sentence joins (parser/lower/ability.ts#buildProgram). Each joins sentences that are one instruction only for exactly their shape; anything else stays as it is.
 *
 * `joinEdhN135SearchShuffleOneCastOthers` (CR 608.2c, 608.2d, 608.2g; Emergent Ultimatum): "Search your library for up to three monocolored cards with different names and exile them. An
 * opponent chooses one of those cards. Shuffle that card into your library. You may cast the other cards without paying their mana costs.": "those cards", "that card" and "the other
 * cards" are the cards the search exiled and the one the opponent chose of them, so the four sentences are joined and one template reads them
 * (eff.edhn135.searchDifferentNames.exile.opponentShufflesOne.castOthersFree).
 *
 * `joinEdhN135SearchRevealOpponentChooses` (CR 608.2c, 608.2d; Threats Undetected): "Search your library for up to four creature cards with different powers and reveal them. An opponent chooses
 * two of those cards. Shuffle the chosen cards into your library and put the rest into your hand.": "those cards", "the chosen cards" and "the rest" are the cards found and the ones the
 * opponent chose of them (eff.edhn135.searchDifferentPowers.reveal.opponentChooses.shuffleChosen.restToHand).
 *
 * `joinEdhN135OpponentChoosesFromHandCastOne` (CR 608.2c, 608.2d, 608.2g; Extract Brain): "Target opponent chooses X cards from their hand. Look at those cards. You may cast a spell from among
 * them without paying its mana cost.": "those cards" and "them" are the cards the opponent chose (eff.edhn135.playerChoosesFromHand.look.castOneFree).
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');
const SEARCH = /^search your library for up to \S+ .+ with different names and exile them \.$/;
const REST = ['an opponent chooses one of those cards .', 'shuffle that card into your library .', 'you may cast the other cards without paying their mana costs .'];

export function joinEdhN135SearchShuffleOneCastOthers<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces.slice(i + 1, i + 1 + REST.length);
    if (SEARCH.test(norms(p.tokens)) && next.length === REST.length && next.every((x, k) => norms(x.tokens) === REST[k])) {
      out.push({ ...p, tokens: [...p.tokens, ...next.flatMap((x) => x.tokens)] });
      i += REST.length;
      continue;
    }
    out.push(p);
  }
  return out;
}

const SEARCH_REVEAL = /^search your library for up to \S+ .+ with different powers and reveal them \.$/;
const OPPONENT_CHOOSES = /^an opponent chooses \S+ of those cards \.$/;
const SHUFFLE_CHOSEN_REST = 'shuffle the chosen cards into your library and put the rest into your hand .';

export function joinEdhN135SearchRevealOpponentChooses<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const [a, b] = [pieces[i + 1], pieces[i + 2]];
    if (a !== undefined && b !== undefined && SEARCH_REVEAL.test(norms(p.tokens)) && OPPONENT_CHOOSES.test(norms(a.tokens)) && norms(b.tokens) === SHUFFLE_CHOSEN_REST) {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens, ...b.tokens] });
      i += 2;
      continue;
    }
    out.push(p);
  }
  return out;
}

const CHOOSES_FROM_HAND = /^target opponent chooses \S+ cards from their hand \.$/;
const LOOK_CAST = ['look at those cards .', 'you may cast a spell from among them without paying its mana cost .'];

export function joinEdhN135OpponentChoosesFromHandCastOne<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces.slice(i + 1, i + 1 + LOOK_CAST.length);
    if (CHOOSES_FROM_HAND.test(norms(p.tokens)) && next.length === LOOK_CAST.length && next.every((x, k) => norms(x.tokens) === LOOK_CAST[k])) {
      out.push({ ...p, tokens: [...p.tokens, ...next.flatMap((x) => x.tokens)] });
      i += LOOK_CAST.length;
      continue;
    }
    out.push(p);
  }
  return out;
}

const GUESS = [
  /(^|, )look at the top two cards of your library , put them back in any order , then choose land or nonland \.$/,
  /^an opponent guesses whether the top card of your library is the chosen kind \.$/,
  /^reveal that card \.$/,
  /^if they guessed right , remove (~|it) from combat \.$/,
  /^otherwise , you draw a card and ~ can't be blocked this turn \.$/,
];

export function joinEdhN135GuessKind<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const run = pieces.slice(i, i + GUESS.length);
    if (run.length === GUESS.length && run.every((x, k) => GUESS[k]!.test(norms(x.tokens)))) {
      out.push({ ...p, tokens: run.flatMap((x) => x.tokens) });
      i += GUESS.length - 1;
      continue;
    }
    out.push(p);
  }
  return out;
}

const GUESS_MV = [
  /(^|, )choose a card in your hand \.$/,
  /^that player guesses whether the card 's mana value is greater than \S+ \.$/,
  /^if the player guessed wrong , you may cast the card without paying its mana cost \.$/,
];

export function joinEdhN135GuessManaValue<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const run = pieces.slice(i, i + GUESS_MV.length);
    if (run.length === GUESS_MV.length && run.every((x, k) => GUESS_MV[k]!.test(norms(x.tokens)))) {
      out.push({ ...p, tokens: run.flatMap((x) => x.tokens) });
      i += GUESS_MV.length - 1;
      continue;
    }
    out.push(p);
  }
  return out;
}

const AUCTION = [
  'exile all nontoken permanents .',
  'starting with you , each player chooses one of the exiled cards and puts it onto the battlefield tapped under their control .',
  'repeat this process until all cards exiled this way have been chosen .',
];

export function joinEdhN135Auction<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const run = pieces.slice(i, i + AUCTION.length);
    if (run.length === AUCTION.length && run.every((x, k) => norms(x.tokens) === AUCTION[k])) {
      out.push({ ...p, tokens: run.flatMap((x) => x.tokens) });
      i += AUCTION.length - 1;
      continue;
    }
    out.push(p);
  }
  return out;
}
