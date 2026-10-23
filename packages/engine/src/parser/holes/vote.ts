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
/** What "each <noun> with the most votes or tied for most votes" may name (render/steps-lasting.ts#VOTE_NOUNS says the same nouns). */
const VOTE_NOUNS: readonly string[] = ['permanent', 'creature', 'card', 'artifact', 'enchantment', 'land', 'planeswalker'];
for (const n of VOTE_NOUNS) P(n);

const voteWordAt = (ctx: HoleCtx, pos: number): string | undefined => {
  const t = ctx.toks[pos];
  return t !== undefined && t.kind === 'WORD' && VOTE_WORDS.includes(t.norm) ? t.norm : undefined;
};

/** The vote marker of a quantity: the votes `choice` got in the vote before the sentence (lower/conditions.ts#resolveVotes names the step). */
const votesOf = (choice: string): Quantity => ({ q: 'votes', step: '', choice, $vote: 'previous' } as unknown as Quantity);

/** VoteWords: "carnage or homage" (two different words). */
export const voteWords: HoleFn = (ctx, pos) => {
  const a = voteWordAt(ctx, pos);
  if (a === undefined) return [];
  const or = phraseAt(ctx, pos + 1, W_OR);
  const b = or >= 0 ? voteWordAt(ctx, or) : undefined;
  return b !== undefined && b !== a ? [{ end: or + 1, value: [a, b] }] : [];
};

/** Cond atoms: "<word> gets more votes [or the vote is tied]". The other word of the comparison is filled in by the lowering pass (`$other`). */
export function voteCondAt(ctx: HoleCtx, pos: number): Alt[] {
  const w = voteWordAt(ctx, pos);
  if (w === undefined) return [];
  const more = phraseAt(ctx, pos + 1, W_GETS_MORE_VOTES);
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
  const n = phraseAt(ctx, pos, W_THE_NUMBER_OF);
  if (n >= 0) {
    for (const [ws, agree] of W_VOTERS) {
      const e = phraseAt(ctx, n, ws);
      if (e >= 0) return [{ end: e, value: { q: 'countPlayers', of: { ref: 'voters', agree } } satisfies Quantity }];
    }
  }
  const w = n >= 0 ? voteWordAt(ctx, n) : undefined;
  if (w === undefined) return [];
  const e = phraseAt(ctx, n + 1, W_VOTES);
  return e >= 0 ? [{ end: e, value: votesOf(w) as never }] : [];
}
