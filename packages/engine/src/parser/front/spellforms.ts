/**
 * What stays out of an instant's or sorcery's one spell ability (design 6.2 rows 8 and 10). Owner: WP5. Pure; reads the tokens of one line.
 *
 * An instant or sorcery has exactly one spell ability (CR 113.3a): all of its effect lines are resolved together (CR 608.2). Two kinds of line on a spell face
 * are not part of it:
 *
 *   - static abilities that work while the spell is on the stack or in a hand (CR 113.6, 604.1): an alternative cost (CR 118.9, 601.2b), a cost increase or
 *     reduction (CR 601.2f), an additional cost (CR 601.2b), "can't be countered" (CR 101.2), characteristic-defining and flash-granting statics. They are
 *     recognised by their words, anywhere in the first sentence of the line (a condition such as "If X is 5 or more," or "During your turn," may come first),
 *     and always about the spell itself (`~`), so that "You may cast target card ... rather than pay its mana cost" stays an effect;
 *   - triggers that the spell creates when it resolves (CR 603.7, delayed triggered abilities): "At the beginning of your next upkeep, ...", "When you next
 *     cast an instant or sorcery spell this turn, ..." are part of the effect (CR 608.2), not printed triggered abilities (CR 603.2).
 */
import type { Token } from '../tokenize';
import type { LexiconIndex } from './lexicon-index';

/** The words of the first sentence of `toks`: everything up to the first top-level period. */
function firstSentence(toks: readonly Token[]): string[] {
  const out: string[] = [];
  for (const t of toks) {
    if (t.kind === 'PUNCT' && t.norm === '.') break;
    out.push(t.norm);
  }
  return out;
}

/** Index of the word sequence `seq` in `w`, from `from`, or -1. */
function find(w: readonly string[], seq: readonly string[], from = 0): number {
  for (let i = from; i + seq.length <= w.length; i++) {
    let k = 0;
    while (k < seq.length && w[i + k] === seq[k]) k++;
    if (k === seq.length) return i;
  }
  return -1;
}

/**
 * The line is one of the static forms of a spell face. `~` is the spell itself (preprocess replaced "this spell" and the card's name).
 */
export function isSpellStaticForm(toks: readonly Token[], ix: LexiconIndex): boolean {
  const w = firstSentence(toks);
  // CR 118.9: "[You may] ... rather than pay ~'s mana cost" (alternative cost, with or without a condition before it).
  if (find(w, ['rather', 'than', 'pay', '~']) >= 0) return true;
  // CR 601.2f: "~ costs {2} less to cast", "~ costs {1} more to cast if ...", after a condition or "During your turn,".
  if (w[0] === '~' && (w[1] === 'costs' || w[1] === 'cost')) return true;
  for (const verb of ['costs', 'cost']) {
    for (let i = find(w, ['~', verb]); i >= 0; i = find(w, ['~', verb], i + 1)) if (w.slice(i + 2).some((x) => x === 'less' || x === 'more')) return true;
  }
  // CR 101.2: "~ can't be countered", also after "If X is 5 or more,".
  if (find(w, ['~', "can't", 'be', 'countered']) >= 0 || (w[0] === '~' && w[1] === "can't")) return true;
  // CR 601.2b: "As an additional cost to cast ~, ...".
  if (find(w, ['as', 'an', 'additional', 'cost', 'to', 'cast', '~']) >= 0 || w.slice(0, 5).join(' ') === 'as an additional cost to') return true;
  // CR 601.2: "You may cast ~ [without paying its mana cost / as though it had flash / from your graveyard]", "Cast ~ only during combat."
  if (find(w, ['you', 'may', 'cast', '~']) >= 0 || (w[0] === 'cast' && w[1] === '~')) return true;
  // CR 604.1: "~ has flash as long as ...".
  const has = find(w, ['~', 'has']);
  if (has >= 0 && find(w, ['as', 'long', 'as'], has) >= 0) return true;
  // CR 604.3: characteristic-defining statics: "~ is colorless", "~ is all colors", "~ is red and blue".
  for (let i = find(w, ['~', 'is']); i >= 0; i = find(w, ['~', 'is'], i + 1)) {
    const next = w[i + 2];
    if (next === 'colorless' || (next === 'all' && w[i + 3] === 'colors') || (next !== undefined && ix.colors.has(next))) return true;
  }
  // CMDF (CR 113.6n, 903.3a): "~ can be your commander", a deck-construction ability (Ashaya's Enduring Bond, a legendary sorcery): the whole line only.
  if (w.length === 5 && w.join(' ') === '~ can be your commander') return true;
  // r5-mech (CR 100.2a, 113.6n): "A deck can have any number of cards named Slime Against Humanity.", a deck-construction ability of an instant or sorcery
  // (Slime Against Humanity, Sphinx's Approach, Dragon's Approach): the whole line only (r3-mech's static template reads it).
  if (w.slice(0, 9).join(' ') === 'a deck can have any number of cards named') return true;
  // "~ enters ..." (existing form: a spell face that has a replacement-like line; kept anywhere in the first sentence after a condition).
  if (find(w, ['~', 'enters']) >= 0) return true;
  return false;
}

/**
 * A line of a spell face that starts like a trigger (when / whenever / at) but is created by the spell's resolution: its condition (the words before the first
 * comma) names the rest of this turn, this combat or a next occurrence (CR 603.7: "this turn", "this combat", "next upkeep", "next end step").
 */
export function isDelayedTriggerLine(toks: readonly Token[]): boolean {
  const clause: string[] = [];
  for (const t of toks) {
    if (t.kind === 'PUNCT' && t.norm === ',') break;
    clause.push(t.norm);
  }
  return find(clause, ['this', 'turn']) >= 0 || find(clause, ['this', 'combat']) >= 0 || clause.includes('next');
}
