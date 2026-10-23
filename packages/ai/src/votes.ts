/**
 * M12 gaps (STATUS "Wave M12" gap 7): the bot's vote for words (CR 701.38a-b: "each player votes for carnage or homage. If carnage gets more votes, ...").
 * Before, it always took the first word. Now, with two or more opponents (m12 design D17: the multiplayer heuristics run only then; a two-player game keeps
 * the first word), it reads what each word does in the resolving spell or ability and votes for the word whose outcome is worth more to itself:
 *
 *  - The vote step is found in the program of the object on top of the stack (the resolving one, CR 608.2) by its words; what a word does is each later
 *    step of the same list that reads that word's votes: an `if` that compares its votes with the other word's ("If carnage gets more votes", "or the vote
 *    is tied"), or a step that counts them ("for each money vote", one vote's worth).
 *  - Each instruction is valued for the players it reaches, from the resolving object's controller ("you", "each opponent", "each player"): a card drawn
 *    3, a token 2, an extra turn 8, a +1/+1 counter 1, a life 0.3 gained or 0.6 lost, a card discarded 2, a creature sacrificed 3, and the creatures a
 *    sweep ("destroy all ...", "-N/-N") kills at their value. Good for the bot counts in full; good for an opponent counts against it, shared among its
 *    opponents (one rival's gain is a smaller loss with three of them).
 *  - Text the engine does not understand, targets and anything else not modeled count nothing. A word whose outcome the bot can't value, or two words
 *    worth the same, leave the first word (the earlier default), so a vote it cannot read is never a guess.
 *
 * Strategy only: the engine counts the votes whatever the bot answers.
 */
import type { EffectStep, ObjectFilter, PlayerId, PlayerRef, Quantity } from '@openmtg/engine';
import { controller, creatures, kw, lethalDamage, multi, stackTop, type Ctx } from './context';
import { programOf, qty } from './intent';
import { stackAbility } from './source';
import { value } from './value';

const CARD = 3;
const TOKEN = 2;
const EXTRA_TURN = 8;
const COUNTER = 1;
const LIFE_GAINED = 0.3;
const LIFE_LOST = 0.6;
const DISCARDED = 2;
const SACRIFICED = 3;

/** The word the bot votes for, or undefined to keep the default (the first word): not a word vote, two players, or nothing to tell the words apart. */
export function wordVote(ctx: Ctx, words: readonly string[]): string | undefined {
  if (!multi(ctx) || words.length < 2) return undefined;
  const top = stackTop(ctx);
  if (top === null) return undefined;
  const program = programOf(stackAbility(ctx, top));
  const you = controller(ctx, top);
  if (!program || you === null) return undefined;
  const found = findVote(program.steps, words);
  if (!found) return undefined;
  const { after, name } = found;
  const worth = new Map<string, number>(words.map((w) => [w, 0]));
  for (const st of after) {
    const word = branchWord(st, name, words);
    if (word !== undefined && st.op === 'if') worth.set(word, worth.get(word)! + stepsWorth(ctx, st.then, you));
    else if (word !== undefined) worth.set(word, worth.get(word)! + stepsWorth(ctx, [st], you));
  }
  const best = Math.max(...worth.values());
  const first = worth.get(words[0]!)!;
  if (best <= first) return undefined; // the first word is as good as any: the default stays
  return words.find((w) => worth.get(w) === best);
}

/** The vote step for exactly these words (CR 701.38b) in a step list or a list nested in it, with the steps after it in its own list and its name. */
function findVote(steps: readonly EffectStep[], words: readonly string[]): { after: EffectStep[]; name: string } | undefined {
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i]!;
    if (st.op === 'action' && st.action === 'vote' && st.choices !== undefined && sameWords(st.choices, words)) {
      return typeof st.as === 'string' ? { after: steps.slice(i + 1), name: st.as } : undefined;
    }
    for (const nested of nestedLists(st)) {
      const r = findVote(nested, words);
      if (r) return r;
    }
  }
  return undefined;
}

const sameWords = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((w) => b.includes(w));

function nestedLists(st: EffectStep): EffectStep[][] {
  const out: EffectStep[][] = [];
  const r = st as unknown as Record<string, unknown>;
  for (const k of ['then', 'else', 'do', 'otherwise']) if (Array.isArray(r[k])) out.push(r[k] as EffectStep[]);
  return out;
}

/** The word a step after the vote belongs to: an `if` whose condition reads that word's votes first, or a step that counts one word's votes. */
function branchWord(st: EffectStep, name: string, words: readonly string[]): string | undefined {
  if (st.op === 'if') {
    const c = st.cond;
    if (c.cond !== 'compare' || st.else !== undefined) return undefined;
    const left = votesOf(c.left, name);
    return left !== undefined && words.includes(left) ? left : undefined;
  }
  const text = JSON.stringify(st);
  const counted = words.filter((w) => text.includes(`"q":"votes","step":"${name}","choice":"${w}"`));
  return counted.length === 1 ? counted[0] : undefined;
}

function votesOf(q: Quantity, name: string): string | undefined {
  return typeof q === 'object' && q.q === 'votes' && q.step === name ? q.choice : undefined;
}

/** What the steps are worth to the bot, `you` being the resolving object's controller. */
function stepsWorth(ctx: Ctx, steps: readonly EffectStep[], you: PlayerId): number {
  return steps.reduce((n, st) => n + stepWorth(ctx, st, you), 0);
}

function stepWorth(ctx: Ctx, st: EffectStep, you: PlayerId): number {
  const forEach = (who: PlayerRef, each: number): number => playersWorth(ctx, playersOf(ctx, who, you), each);
  switch (st.op) {
    case 'if': case 'may': case 'forEach': case 'repeat': return 0; // a nested condition or choice: not modeled
    case 'draw': return forEach(st.who, CARD * qty(st.count));
    case 'createToken': return forEach(st.who, TOKEN * qty(st.count));
    case 'extraTurn': return forEach(st.who, EXTRA_TURN * qty(st.count));
    case 'gainLife': return forEach(st.who, LIFE_GAINED * qty(st.amount));
    case 'loseLife': return forEach(st.who, -LIFE_LOST * qty(st.amount));
    case 'discard': return typeof st.count === 'number' ? forEach(st.who, -DISCARDED * st.count) : 0;
    case 'sacrificeChoice': return st.filter.types?.includes('Creature') === true ? forEach(st.who, -SACRIFICED * qty(st.count)) : 0;
    case 'putCounters': return st.kind === '+1/+1' && st.on.ref === 'self' ? playersWorth(ctx, [you], COUNTER * qty(st.count)) : 0;
    case 'destroy': return st.what.ref === 'each' && 'filter' in st.what ? sweepWorth(ctx, st.what.filter, you, Infinity) : 0;
    case 'effect': {
      let n = 0;
      for (const e of st.effects) {
        if (e.s !== 'continuous' || e.affects.ref !== 'each' || !('filter' in e.affects)) continue;
        const shrink = e.mods.reduce((m, x) => m + ('toughness' in x && typeof x.toughness === 'number' && x.toughness < 0 ? -x.toughness : 0), 0);
        if (shrink > 0) n += sweepWorth(ctx, e.affects.filter, you, shrink);
      }
      return n;
    }
    default: return 0;
  }
}

/** The players a player reference reaches, read from the controller `you` (CR 109.5); [] for a reference the bot does not read (a target, "that player"). */
function playersOf(ctx: Ctx, who: PlayerRef, you: PlayerId): PlayerId[] {
  const inGame = ctx.view.players.filter((p) => !p.hasLost).map((p) => p.id);
  if (who.ref === 'you') return [you];
  if (who.ref === 'each' && 'who' in who) return who.who === 'player' ? inGame : inGame.filter((p) => p !== you);
  return [];
}

/** `each` for every one of `players`: in full for the bot, against it (shared among its opponents) for an opponent. */
function playersWorth(ctx: Ctx, players: readonly PlayerId[], each: number): number {
  return players.reduce((n, p) => n + (p === ctx.me ? each : -each / ctx.opps.length), 0);
}

/** A sweep of the creatures `filter` names (by whose they are, from `you`) that `damage` kills (Infinity: destroyed): theirs for the bot, its own against it. */
function sweepWorth(ctx: Ctx, filter: ObjectFilter, you: PlayerId, damage: number): number {
  if (filter.types !== undefined && !filter.types.includes('Creature')) return 0;
  if (filter.notTypes?.includes('Creature')) return 0;
  const whose = filter.controller === 'you' ? [you] : filter.controller === 'opponent' ? ctx.view.players.filter((p) => p.id !== you).map((p) => p.id)
    : filter.controller === undefined || filter.controller === 'any' ? ctx.view.players.map((p) => p.id) : [];
  let n = 0;
  for (const p of whose) {
    for (const id of creatures(ctx, p)) {
      if (kw(ctx, id, 'indestructible') || (damage !== Infinity && lethalDamage(ctx, id) > damage)) continue;
      n += p === ctx.me ? -value(ctx, id) : value(ctx, id) / ctx.opps.length;
    }
  }
  return n;
}
