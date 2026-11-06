/**
 * edh-players-13 (CR 608.2d): the words players choose between that have no rules meaning of their own, "Each opponent chooses fame or fortune." (Seize the Spotlight),
 * "Each opponent chooses money, friends, or secrets." (Master of Ceremonies), and "for each player who chose fame". Like the vote words (parser/holes/vote.ts) a CLOSED
 * list, the words printed on cards (CHOICE_WORDS): a free word would defeat guard G2 (a nonsense word must never leave an automated ability).
 *
 *  - ChoiceWords: two or three different words, "fame or fortune" / "money, friends, or secrets"; value string[] in the order printed.
 *  - ChoiceWord: one word; value the word.
 */
import type { HoleCtx, HoleFn } from './core';
import { P, phraseAt } from './core';

/** The choice words printed on cards (one word each). */
export const CHOICE_WORDS: readonly string[] = ['fame', 'fortune', 'money', 'friends', 'secrets', 'silence' /* edh-next-120: Prisoner's Dilemma */, 'snitch'];
for (const w of CHOICE_WORDS) P(w);

const W_OR = P('or');
const W_COMMA_OR = P(', or');
const W_COMMA = P(',');

const wordAt = (ctx: HoleCtx, pos: number): string | undefined => {
  const t = ctx.toks[pos];
  return t !== undefined && t.kind === 'WORD' && CHOICE_WORDS.includes(t.norm) ? t.norm : undefined;
};

/** ChoiceWord: one choice word. */
export const choiceWord: HoleFn = (ctx, pos) => {
  const w = wordAt(ctx, pos);
  return w === undefined ? [] : [{ end: pos + 1, value: w }];
};

/** ChoiceWords: "fame or fortune", "money, friends, or secrets" (different words). */
export const choiceWords: HoleFn = (ctx, pos) => {
  const a = wordAt(ctx, pos);
  if (a === undefined) return [];
  const or = phraseAt(ctx, pos + 1, W_OR);
  const b = or >= 0 ? wordAt(ctx, or) : undefined;
  if (b !== undefined && b !== a) return [{ end: or + 1, value: [a, b] }];
  const c1 = phraseAt(ctx, pos + 1, W_COMMA);
  const b2 = c1 >= 0 ? wordAt(ctx, c1) : undefined;
  if (b2 === undefined || b2 === a) return [];
  const c2 = phraseAt(ctx, c1 + 1, W_COMMA_OR);
  const c = c2 >= 0 ? wordAt(ctx, c2) : undefined;
  return c !== undefined && c !== a && c !== b2 ? [{ end: c2 + 1, value: [a, b2, c] }] : [];
};

const W_OF_A_TYPE_CHOSEN_THIS_WAY = P('of a type chosen this way');

/**
 * ChosenAll: "of a type chosen this way", any of the types the players of an earlier "Each player chooses a creature type." chose (Patriarch's Bidding; CR 608.2d, 607.2d).
 * The `chosen` field of a filter with the link placeholder (parser/lower/links.ts links it to the one earlier choice; the kind is that choice's). render/np.ts says
 * it only for a link every player chose for (RenderState.groupChoices).
 */
export const chosenAll: HoleFn = (ctx, pos) => {
  const e = phraseAt(ctx, pos, W_OF_A_TYPE_CHOSEN_THIS_WAY);
  return e >= 0 ? [{ end: e, value: { link: '$link', quality: '$chosenType' } }] : [];
};
