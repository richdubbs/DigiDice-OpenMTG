/**
 * M12-3 (m12 design D7, 4.3; CR 701.38a-b): votes in the hole grammars.
 *
 *  - VoteWords: "carnage or homage": the two words players vote for (CR 701.38b: "words with no rules meaning that are each connected to a different
 *    effect"). The words are a CLOSED list, the vote words printed on cards (VOTE_WORDS): a free word would defeat guard G2 (a nonsense word must never
 *    leave an automated ability), as a free `Text` hole would.
 *  - Cond: "<word> gets more votes" (more votes than the other word) and "<word> gets more votes or the vote is tied": a comparison of two vote counts of the
 *    vote before the sentence (`{q:'votes', step:'', $vote}` markers that parser/lower/conditions.ts#resolveVotes resolves to that vote step's name and the
 *    other word; anything else leaves the sentence manual).
 *  - Objs: "each permanent with the most votes or tied for most votes": the objects (or players) the vote before bound (`{ref:'bound', name:'', $vote}`).
 *  - Qty: "the number of <word> votes"; M12F: "the number of opponents who voted for a choice you voted for / you didn't vote for" (`countPlayers` of the
 *    `voters` reference, read from the ballots of "whenever players finish voting", CR 701.38a).
 */
import type { Condition, Quantity } from '../../types/ability';
import type { Alt, HoleCtx, HoleFn } from './core';
import { P, phraseAt } from './core';

/** The vote words printed on cards (CR 701.38b), one word each; a vote for other words stays manual. */
export const VOTE_WORDS: readonly string[] = [
  'aid', 'bribery', 'carnage', 'chaos', 'condemnation', 'consequences', 'death', 'denial', 'dominion', 'duplication', 'embark', 'evidence', 'feather',
  'fellowship', 'free', 'grace', 'guidance', 'guilty', 'harvest', 'homage', 'innocent', 'knowledge', 'money', 'nah', 'numbers', 'past', 'planeswalk',
  'present', 'profit', 'psychosis', 'quill', 'return', 'security', 'sickness', 'sprout', 'strength', 'taxes', 'time', 'torture', 'truth', 'wild', 'yeah',
];
for (const w of VOTE_WORDS) P(w);

const W_OR = P('or');
const W_GETS_MORE_VOTES = P('gets more votes');
const W_OR_THE_VOTE_IS_TIED = P('or the vote is tied');
const W_EACH = P('each');
const W_WITH_THE_MOST = P('with the most votes or tied for most votes');
const W_THE_NUMBER_OF = P('the number of');
const W_VOTES = P('votes');
const W_GOT_VOTES = P('got votes'); // edhd27
/** What "each <noun> with the most votes or tied for most votes" may name (render/steps-lasting.ts#VOTE_NOUNS says the same nouns). */
const VOTE_NOUNS: readonly string[] = ['permanent', 'creature', 'card', 'artifact', 'enchantment', 'land', 'planeswalker'];
for (const n of VOTE_NOUNS) P(n);

/** edh-next-101 (CR 701.38b; Travel Through Caradhras): vote words of more than one word, printed with capitals; the word is the lower-cased phrase ("redhorn pass"). */
export const VOTE_PHRASES: readonly string[] = ['redhorn pass', 'mines of moria'];
const VOTE_PHRASE_WORDS: readonly (readonly [string, string[]])[] = VOTE_PHRASES.map((w) => [w, P(w)] as const);

/** The vote word at `pos` and where it ends: one token of VOTE_WORDS, or one of VOTE_PHRASES. */
const voteWordSpan = (ctx: HoleCtx, pos: number): { word: string; end: number } | undefined => {
  const t = ctx.toks[pos];
  if (t !== undefined && t.kind === 'WORD' && VOTE_WORDS.includes(t.norm)) return { word: t.norm, end: pos + 1 };
  for (const [word, ws] of VOTE_PHRASE_WORDS) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) return { word, end: e };
  }
  return undefined;
};

/** The vote marker of a quantity: the votes `choice` got in the vote before the sentence (lower/conditions.ts#resolveVotes names the step). */
const votesOf = (choice: string): Quantity => ({ q: 'votes', step: '', choice, $vote: 'previous' } as unknown as Quantity);

/** VoteCount: "evidence vote" (edh-players-13: "For each evidence vote, investigate."): the votes that word got in the vote before the sentence (the Qty marker, resolved by lower/conditions.ts#resolveVotes). */
export const voteCount: HoleFn = (ctx, pos) => {
  const w = voteWordSpan(ctx, pos);
  if (w === undefined) return [];
  const e = phraseAt(ctx, w.end, P('vote'));
  return e >= 0 ? [{ end: e, value: votesOf(w.word) as never }] : [];
};

/** VoteWords: "carnage or homage" (two different words). */
export const voteWords: HoleFn = (ctx, pos) => {
  const a = voteWordSpan(ctx, pos);
  if (a === undefined) return [];
  const or = phraseAt(ctx, a.end, W_OR);
  const b = or >= 0 ? voteWordSpan(ctx, or) : undefined;
  return b !== undefined && b.word !== a.word ? [{ end: b.end, value: [a.word, b.word] }] : [];
};

/** Cond atoms: "<word> gets more votes [or the vote is tied]". The other word of the comparison is filled in by the lowering pass (`$other`). */
export function voteCondAt(ctx: HoleCtx, pos: number): Alt[] {
  // edhd27 (CR 701.38a): "no creature got votes": nothing the vote before is for has the most votes (a vote of "up to one", where nobody voted, binds nothing)
  if (ctx.toks[pos]?.norm === 'no') {
    const noun = ctx.toks[pos + 1]?.norm;
    const e = noun !== undefined && VOTE_NOUNS.includes(noun) ? phraseAt(ctx, pos + 2, W_GOT_VOTES) : -1;
    return e >= 0 ? [{ end: e, value: { cond: 'not', of: { cond: 'exists', of: { ref: 'bound', name: '', $vote: 'previous' } } } as unknown as Condition }] : [];
  }
  const ws = voteWordSpan(ctx, pos);
  if (ws === undefined) return [];
  const w = ws.word;
  const more = phraseAt(ctx, ws.end, W_GETS_MORE_VOTES);
  if (more < 0) return [];
  const other = { ...(votesOf('') as object), $other: true } as unknown as Quantity;
  const out: Alt[] = [{ end: more, value: { cond: 'compare', left: votesOf(w), op: '>', right: other } satisfies Condition }];
  const tied = phraseAt(ctx, more, W_OR_THE_VOTE_IS_TIED);
  if (tied >= 0) out.push({ end: tied, value: { cond: 'compare', left: votesOf(w), op: '>=', right: other } satisfies Condition });
  return out;
}

/** Objs atom: "each permanent with the most votes or tied for most votes" (what the vote before bound, CR 701.38a). */
export function voteObjsAt(ctx: HoleCtx, pos: number): Alt[] {
  const each = phraseAt(ctx, pos, W_EACH);
  const noun = each >= 0 ? ctx.toks[each]?.norm : undefined;
  if (noun === undefined || !VOTE_NOUNS.includes(noun)) return [];
  const e = phraseAt(ctx, each + 1, W_WITH_THE_MOST);
  return e >= 0 ? [{ end: e, value: { ref: 'bound', name: '', $vote: 'previous' } }] : [];
}

const W_VOTERS: readonly [string[], boolean][] = [[P('opponents who voted for a choice you voted for'), true], [P("opponents who voted for a choice you didn't vote for"), false]];

/** Qty atom: "the number of <word> votes"; M12F: "the number of opponents who voted for a choice you (didn't) vote for". */
export function voteQtyAt(ctx: HoleCtx, pos: number): Alt[] {
  // edhd19 (CR 701.38a-b, 608.2h; Orchard Elemental): "for each sprout vote" (a count after "each" only: the votes that word got)
  if (pos > 0 && ctx.toks[pos - 1]?.norm === 'each') {
    const bare = voteWordSpan(ctx, pos);
    const e = bare === undefined ? -1 : phraseAt(ctx, bare.end, P('vote'));
    // not before a comma: "For each bribery vote, create a Treasure token." is the repeat of eff.edhp13.forEachVote, not a count in "for each {Qty}, create ..."
    return bare !== undefined && e >= 0 && ctx.toks[e]?.norm !== ',' ? [{ end: e, value: votesOf(bare.word) as never }] : [];
  }
  const n = phraseAt(ctx, pos, W_THE_NUMBER_OF);
  if (n >= 0) {
    for (const [ws, agree] of W_VOTERS) {
      const e = phraseAt(ctx, n, ws);
      if (e >= 0) return [{ end: e, value: { q: 'countPlayers', of: { ref: 'voters', agree } } satisfies Quantity }];
    }
  }
  const w = n >= 0 ? voteWordSpan(ctx, n) : undefined;
  if (w === undefined) return [];
  const e = phraseAt(ctx, w.end, W_VOTES);
  return e >= 0 ? [{ end: e, value: votesOf(w.word) as never }] : [];
}

/**
 * edhd27 (CR 701.38a-b, 608.2c): the votes a player or an object received in the vote before the sentence (a Qty marker `votesFor`, resolved by lower/conditions.ts#resolveVotes).
 *  - VoteYou: "vote you received" (the controller), VoteThey: "vote they received" (the player a group instruction is at, `iterating`), VoteOpp: "vote an opponent received"
 *    (the opponent a forEach is at, `iterating`; only the template that builds that forEach reads it).
 *  - VotedCreature: "creature with one or more votes": every object the vote could be for, `{ref:'bound', $voted}`; ThatManyVotes: "that many", the votes the object a forEach (named `votedObj`) is at got.
 */
const votesForMarker = (of: object): Quantity => ({ q: 'votesFor', step: '', of, $vote: 'previous' } as unknown as Quantity);
const receivedAt = (phrase: string[], of: object): HoleFn => (ctx, pos) => {
  const e = phraseAt(ctx, pos, phrase);
  return e >= 0 ? [{ end: e, value: votesForMarker(of) as never }] : [];
};
export const voteYou: HoleFn = receivedAt(P('vote you received'), { ref: 'you' });
export const voteThey: HoleFn = receivedAt(P('vote they received'), { ref: 'iterating' });
export const voteOpp: HoleFn = receivedAt(P('vote an opponent received'), { ref: 'iterating' });
export const votedCreature: HoleFn = (ctx, pos) => {
  const e = phraseAt(ctx, pos, P('creature with one or more votes'));
  return e >= 0 ? [{ end: e, value: { ref: 'bound', name: '', $vote: 'previous', $voted: true } as never }] : [];
};
export const thatManyVotes: HoleFn = (ctx, pos) => {
  const e = phraseAt(ctx, pos, P('that many'));
  return e >= 0 ? [{ end: e, value: votesForMarker({ ref: 'bound', name: 'votedObj' }) as never }] : [];
};
/** NoVotesReceived: "who received no votes" (Círdan the Shipwright): the votes the player a group instruction is at received (compared with 0 by the template). */
export const noVotesReceived: HoleFn = (ctx, pos) => {
  const e = phraseAt(ctx, pos, P('who received no votes'));
  return e >= 0 ? [{ end: e, value: votesForMarker({ ref: 'iterating' }) as never }] : [];
};
