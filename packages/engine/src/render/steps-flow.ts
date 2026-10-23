/**
 * Control-flow steps (WP2): if, may, pay, forEach, repeat, let, chooseObjects, chooseValue, manual (design 2.3, CR 608.2, 118.12).
 */
import type { ChoiceKind, Condition, EffectStep, ObjRef } from '../types/ability';
import { acting, EMPTY_CLAUSE, plain, within, type Clause } from './clause';
import { K } from './kernel';
import { rangeWords } from './refs';
import { everyCardInstead, isCastChoice, isFixedChoice, isSelfReplacement, isWideReplacement } from './self-replacement';
import { byPlayer, bind, handChoiceFromIt, modal, movedCondFocus, revealedCondFocus, type StepOf } from './steps-util';
import { counterTail } from './steps-zones';
import { countParts } from './qty';
import { cloneState, objKey, playerKey, withVariants, type RenderState } from './state';
import { ALT_CLOSE, ALT_OPEN, ALT_SEP, alt, joinList, NoRenderer, numWord, pluralize, type Person } from './text';

const CHOICE: Record<ChoiceKind, string> = {
  color: 'a color',
  creatureType: 'a creature type',
  cardType: 'a card type',
  landType: 'a basic land type',
  cardName: 'a card name',
  number: 'a number',
  player: 'a player',
  opponent: 'an opponent',
  option: 'one',
  oddEven: 'odd or even',
};

/** FAST5 T64: the nouns of a group of permanents that are also "permanent" ("for each of two target artifacts, ... that permanent"). */
const PERMANENT_NOUNS: ReadonlySet<string> = new Set(['artifact', 'creature', 'enchantment', 'land', 'planeswalker', 'battle']);

/** "you do" / "you don't" / "that player does" for the player `key` (the actor of a may or pay). */
function didText(key: string | null, who: Parameters<typeof K.player>[0], st: RenderState, negative: boolean): string {
  if (key === 'you' || key === null) return negative ? alt("you don't", 'you did not') : alt('you do', 'you did');
  const p = K.player(who, st, 'subject');
  return negative ? `${p.text} ${p.plural ? "don't" : "doesn't"}` : `${p.text} ${p.plural ? 'do' : 'does'}`;
}

/**
 * FAST1 T6: "you may tap or untap target creature" is a choice among tapping, untapping and neither (CR 701.26a). It is stored as "you may tap it; if you
 * don't, you may untap it" (the same three outcomes); this is that exact shape and nothing else, or null.
 */
/**
 * r4-moved (the parser's reading, parser/holes/moved.ts#notMoved; CR 608.2c, 608.2f, 608.2h, 701.9a): `forEach` over each opponent whose body is one `if`: fewer than N of
 * the cards a discard right before reported discarding (C7's `resultCount` with `which`) were owned by the opponent of the iteration and fit a description. Said "for
 * each opponent who didn't discard N <cards> this way, <body>". Null for any other step.
 */
function didntDiscardEach(s: StepOf<'forEach'>, st: RenderState): Clause | null {
  const over = s.over;
  const [only] = s.do;
  if (!(over.ref === 'each' && 'who' in over && over.who === 'opponent') || s.do.length !== 1 || only?.op !== 'if' || only.else !== undefined || only.guard !== undefined) return null;
  const c = only.cond;
  if (c.cond !== 'compare' || c.op !== '<' || typeof c.right !== 'number' || typeof c.left !== 'object' || c.left.q !== 'resultCount' || c.left.which === undefined) return null;
  const { anyOf, owner, ...rest } = c.left.which;
  if (Object.values(rest).some((v) => v !== undefined) || anyOf?.length !== 1 || typeof owner !== 'object' || owner.ref !== 'bound' || owner.name !== s.as) return null;
  if (st.info.get(`r:${c.left.step}`)?.moved !== 'discarded') return null;
  const np = K.np({ ...anyOf[0]!, zone: 'hand' }, st, { det: 'none', plural: true, noZone: true });
  bind(st, s.as, { nouns: ['player', 'opponent'], plural: false, player: true, iterates: 'opponent' });
  return plain(`for each opponent who didn't discard ${numWord(c.right)} ${np} this way, ${K.steps(only.then, st)}`, { standalone: true });
}

/**
 * r5-moved (CR 608.2c, 608.2f, 608.2h, 400.3): "For each opponent who controlled a creature returned this way, <effects>": `forEach` each opponent, `if` at least one of what the
 * move to a hand right before reported (`resultCount` with `which`: the description and the controller of the iteration, as each permanent last existed) (Faerie Slumber Party).
 */
function controlledReturnedEach(s: StepOf<'forEach'>, st: RenderState): Clause | null {
  const over = s.over;
  const [only] = s.do;
  if (!(over.ref === 'each' && 'who' in over && over.who === 'opponent') || s.do.length !== 1 || only?.op !== 'if' || only.else !== undefined || only.guard !== undefined) return null;
  const c = only.cond;
  if (c.cond !== 'compare' || c.op !== '>=' || c.right !== 1 || typeof c.left !== 'object' || c.left.q !== 'resultCount' || c.left.which === undefined) return null;
  const { anyOf, controller, ...rest } = c.left.which;
  if (Object.values(rest).some((v) => v !== undefined) || anyOf?.length !== 1 || typeof controller !== 'object' || controller.ref !== 'bound' || controller.name !== s.as) return null;
  if (st.info.get(`r:${c.left.step}`)?.moved !== 'hand') return null;
  const np = K.np({ ...anyOf[0]!, zone: 'battlefield' }, st, { det: 'a', noZone: true });
  bind(st, s.as, { nouns: ['player', 'opponent'], plural: false, player: true, iterates: 'opponent' });
  return plain(`for each opponent who controlled ${np} returned this way, ${K.steps(only.then, st)}`, { standalone: true });
}

function tapOrUntap(s: StepOf<'may'>, st: RenderState): Clause | null {
  const [a] = s.do;
  const [inner] = s.otherwise ?? [];
  if (s.do.length !== 1 || s.otherwise?.length !== 1 || a?.op !== 'tap' || inner?.op !== 'may' || inner.otherwise !== undefined || inner.as !== undefined) return null;
  const [b] = inner.do;
  if (inner.do.length !== 1 || b?.op !== 'untap' || JSON.stringify(inner.who) !== JSON.stringify(s.who) || JSON.stringify(a.what) !== JSON.stringify(b.what)) return null;
  if (s.as !== undefined || a.as !== undefined || b.as !== undefined) return null; // "if you do" after it would read only the first choice
  const key = playerKey(s.who);
  const subj = K.player(s.who, st, 'subject');
  const text = `${subj.text} may tap or untap ${K.obj(a.what, st, 'object').text}`;
  return acting(key ?? 'x', text, text, { closesScope: true });
}

/** M6-5: two damage steps from the ability's own object that differ only in their amount (a self-replacement's "it deals N damage instead", CR 614.15). */
function sameDamageButAmount(x: unknown, y: unknown): boolean {
  const a = x as Record<string, unknown> | undefined;
  const b = y as Record<string, unknown> | undefined;
  if (a?.['op'] !== 'damage' || b?.['op'] !== 'damage') return false;
  const src = a['source'] as { ref?: unknown } | undefined;
  if (src?.ref !== 'self' || JSON.stringify(a['source']) !== JSON.stringify(b['source'])) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== 'amount' && k !== 'sentence'));
  return [...keys].every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

/**
 * Cloud r3-repl (CR 614.15, 120.3): one damage step of an object to itself (the same `source` and `to`) and the same step with twice its amount
 * (`{q: 'math', op: '*', args: [2, <the amount>]}`), nothing else different: "it deals twice that much damage to itself instead".
 */
function doubledSelfDamage(then: readonly unknown[], els: readonly unknown[]): boolean {
  if (then.length !== 1 || els.length !== 1) return false;
  const a = then[0] as Record<string, unknown>;
  const b = els[0] as Record<string, unknown>;
  if (a['op'] !== 'damage' || b['op'] !== 'damage' || JSON.stringify(b['source']) !== JSON.stringify(b['to']) || b['source'] === undefined) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== 'amount' && k !== 'sentence'));
  if (![...keys].every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]))) return false;
  return JSON.stringify(a['amount']) === JSON.stringify({ q: 'math', op: '*', args: [2, b['amount']] });
}

/**
 * FAST5X E7 (CR 614.15, 508.4, 702.190b): "Create three 1/1 tokens. If ~'s sneak cost was paid, they enter tapped and attacking.": the same token creation,
 * with the tokens entering tapped and attacking when the condition holds (`if C then [create tapped and attacking] else [create]`; parser rider
 * rid.e7.tokens.enter.attacking builds exactly this shape). The pronoun is "it" for one token, "they" for more. Null when the shape is not that one.
 */
function tokensEnterAttacking(then: readonly unknown[], els: readonly unknown[]): string | null {
  if (then.length !== 1 || els.length !== 1) return null;
  const a = then[0] as Record<string, unknown> | undefined;
  const b = els[0] as Record<string, unknown> | undefined;
  if (a?.['op'] !== 'createToken' || b?.['op'] !== 'createToken' || a['tapped'] !== true || a['attacking'] !== true || b['tapped'] !== undefined || b['attacking'] !== undefined) return null;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== 'tapped' && k !== 'attacking' && k !== 'sentence'));
  if (![...keys].every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]))) return null;
  return b['count'] === 1 ? 'it enters' : 'they enter';
}

/**
 * r4-repl (CR 614.15, 400.7): `if C then [move X to Z2] else [move X to Z1]`, one move of the same object (bound by an earlier instruction, the same name bound
 * by both) to two zones and nothing else different: the fold lower/riders.ts#movesTheOnlyMoved builds of "..., and put it into your hand. If C, put that card
 * onto the battlefield instead.", whose earlier instructions stay before the `if`.
 */
/**
 * std-rj (CR 118.9, 202.3, 601.2): an `if` step with no `else` whose one instruction is the optional free cast of an object by you, under the condition that the mana
 * value of that very object is less than a number (nothing else in the step, the cast or the condition).
 */
function castFreeIfMvLess(s: StepOf<'if'>): boolean {
  const c = s.cond;
  const only = s.then.length === 1 ? s.then[0] : undefined;
  if (c.cond !== 'compare' || c.op !== '<' || typeof c.left !== 'object' || c.left.q !== 'stat' || c.left.stat !== 'manaValue' || Object.keys(c.left).length !== 3) return false;
  if (only?.op !== 'cast' || only.who.ref !== 'you' || only.free !== true || only.optional !== true || only.guard !== undefined || only.costChange !== undefined || only.play !== undefined
    || only.copyIn !== undefined || only.anyManaType !== undefined || only.transformed !== undefined || only.graveyardInstead !== undefined) return false;
  return JSON.stringify(c.left.of) === JSON.stringify(only.what) && s.guard === undefined && s.as === undefined;
}

/**
 * std-rj (CR 119.3, 608.2h): the one instruction of the `else` of an `if` with one instruction, when both are a life loss or gain (`loseLife`/`gainLife`) of the same computed
 * amount (a quantity that is not a plain number, X or a name): the else instruction with the amount said "that much" (an `eventAmount`, which renders so); else null.
 */
function sameAmountElse(s: StepOf<'if'>): EffectStep | null {
  const a = s.then[0];
  const b = s.else?.length === 1 ? s.else[0] : undefined;
  if (a === undefined || b === undefined || (a.op !== 'loseLife' && a.op !== 'gainLife') || (b.op !== 'loseLife' && b.op !== 'gainLife')) return null;
  if (a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  const amount = a.amount;
  if (typeof amount !== 'object' || amount.q === 'X' || amount.q === 'var' || amount.q === 'eventAmount' || amount.q === 'resultCount') return null;
  if (JSON.stringify(amount) !== JSON.stringify(b.amount)) return null;
  return { ...b, amount: { q: 'eventAmount' } } as EffectStep;
}

function replacedLastMove(s: StepOf<'if'>): boolean {
  if (s.then.length !== 1 || s.else?.length !== 1) return false;
  const a = s.then[0] as unknown as Record<string, unknown>;
  const b = s.else[0] as unknown as Record<string, unknown>;
  if (a['op'] !== 'move' || b['op'] !== 'move' || JSON.stringify(a['what']) !== JSON.stringify(b['what']) || (a['what'] as { ref?: unknown } | undefined)?.ref !== 'bound') return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== 'to' && k !== 'sentence'));
  return [...keys].every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k])) && JSON.stringify(a['to']) !== JSON.stringify(b['to']);
}

/**
 * r4-repl (CR 614.15, 613.4b): "Until end of turn, target artifact or creature becomes an artifact creature with base power and toughness 4/3. If C, it has base
 * power and toughness 1/1 until end of turn instead." (Behind the Mask): the same continuous effect until end of turn, its second modification a base power and
 * toughness (layer 7b) with other numbers, nothing else different (the parser's rider rid.r4repl.instead.basePT.only). The new "P/T", or null.
 */
function basePtOnly(then: readonly unknown[], els: readonly unknown[]): string | null {
  if (then.length !== 1 || els.length !== 1) return null;
  const a = then[0] as Record<string, unknown>;
  const b = els[0] as Record<string, unknown>;
  if (a['op'] !== 'effect' || b['op'] !== 'effect' || JSON.stringify(b['duration']) !== JSON.stringify({ d: 'endOfTurn' })) return null;
  const ea = a['effects'] as Record<string, unknown>[] | undefined;
  const eb = b['effects'] as Record<string, unknown>[] | undefined;
  if (ea?.length !== 1 || eb?.length !== 1) return null;
  const ma = ea[0]!['mods'] as Record<string, unknown>[] | undefined;
  const mb = eb[0]!['mods'] as Record<string, unknown>[] | undefined;
  if (ma?.length !== 2 || mb?.length !== 2 || ma[1]!['layer'] !== '7b' || mb[1]!['layer'] !== '7b' || (eb[0]!['affects'] as { ref?: unknown } | undefined)?.ref !== 'target') return null;
  const p = ma[1]!['power'];
  const t = ma[1]!['toughness'];
  if (typeof p !== 'number' || typeof t !== 'number' || Object.keys(ma[1]!).length !== 3) return null;
  const same = JSON.stringify({ ...a, effects: [{ ...ea[0], mods: [ma[0], { ...mb[1] }] }] }) === JSON.stringify(b);
  return same && JSON.stringify(ma[1]) !== JSON.stringify(mb[1]) ? `${p}/${t}` : null;
}

/**
 * r4-repl (CR 614.15, 406.1): "Exile the top two cards of your library. If C, exile the top three cards instead." (Burning Curiosity): the same exile of the top
 * cards of the same player's library with another number of cards, the library named once (the parser's rider rid.r4repl.instead.exileTop.count builds exactly
 * this shape). The new number, or null.
 */
function exileTopCount(then: readonly unknown[], els: readonly unknown[]): unknown {
  if (then.length !== 1 || els.length !== 1) return null;
  const a = then[0] as Record<string, unknown>;
  const b = els[0] as Record<string, unknown>;
  const wa = a['what'] as Record<string, unknown> | undefined;
  const wb = b['what'] as Record<string, unknown> | undefined;
  if (a['op'] !== 'move' || b['op'] !== 'move' || wa?.['ref'] !== 'topCards' || wb?.['ref'] !== 'topCards' || JSON.stringify(a['to']) !== JSON.stringify({ zone: 'exile' })) return null;
  if (JSON.stringify(wa['player']) !== JSON.stringify(wb['player']) || Object.keys(wa).some((k) => k !== 'ref' && k !== 'player' && k !== 'count') || Object.keys(wb).some((k) => k !== 'ref' && k !== 'player' && k !== 'count')) return null;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== 'what' && k !== 'sentence'));
  if (![...keys].every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]))) return null;
  return JSON.stringify(wa['count']) === JSON.stringify(wb['count']) ? null : wa['count'] ?? null;
}

/**
 * r4-repl (CR 614.15, 120.3): "Target creature you control deals damage equal to its power to target creature an opponent controls. If C, the creature you control
 * deals twice that much damage instead." (Chocobo Kick): the same damage step from a target "creature you control", twice the amount, nothing else different (the
 * parser's rider rid.r4repl.instead.sourceYouControl.twice builds exactly this shape).
 */
function doubledTargetCreatureDamage(then: readonly unknown[], els: readonly unknown[], st: RenderState): boolean {
  if (then.length !== 1 || els.length !== 1) return false;
  const a = then[0] as Record<string, unknown>;
  const b = els[0] as Record<string, unknown>;
  const src = b['source'] as { ref?: unknown; id?: unknown } | undefined;
  if (a['op'] !== 'damage' || b['op'] !== 'damage' || src?.ref !== 'target' || typeof src.id !== 'string') return false;
  const spec = st.specs.get(src.id);
  if (spec === undefined || spec.kind !== 'object' || JSON.stringify(spec.filter) !== JSON.stringify({ types: ['Creature'], controller: 'you' })) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== 'amount' && k !== 'sentence'));
  if (![...keys].every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]))) return false;
  return JSON.stringify(a['amount']) === JSON.stringify({ q: 'math', op: '*', args: [2, b['amount']] });
}

/**
 * r4-repl (CR 614.15, 111.1, 707.2): "Create a token that's a copy of target creature. If C, create five of those tokens instead." and "Create two 2/2 tokens. If C,
 * instead create X of those tokens, where X is ...": the same token creation (or token copy) with another number of tokens and nothing else different (the
 * parser's riders rid.r4repl.instead.*.count build exactly this shape). The number as Oracle says it ("five", or "X" with its "where X is"), or null.
 */
function thoseTokensCount(then: readonly unknown[], els: readonly unknown[], st: RenderState): string | null {
  if (then.length !== 1 || els.length !== 1) return null;
  const a = then[0] as Record<string, unknown> | undefined;
  const b = els[0] as Record<string, unknown> | undefined;
  const op = a?.['op'];
  if (op !== b?.['op'] || !(op === 'createToken' || (op === 'copy' && a?.['result'] === 'token')) || a?.['count'] === undefined) return null;
  const keys = new Set([...Object.keys(a!), ...Object.keys(b!)].filter((k) => k !== 'count' && k !== 'sentence'));
  if (![...keys].every((k) => JSON.stringify(a![k]) === JSON.stringify(b![k])) || JSON.stringify(a!['count']) === JSON.stringify(b!['count'])) return null;
  const n = a!['count'];
  if (typeof n === 'number') return String(n);
  const q = K.qty(n as never, st);
  return q === 'X' ? 'X' : `X of those tokens, where X is ${q}`;
}

/**
 * FAST4 T34 (CR 118.12a): "~ deals 3 damage to target creature unless that creature's controller has ~ deal 5 damage to them" is "that creature's controller
 * may have ~ deal 5 damage to them; if they don't, ~ deals 3 damage to target creature". Stored as that `may` (the target creature's controller chooses);
 * this is that exact shape and nothing else, or null: both damage steps by ~ with literal amounts, the first to the target creature, the other to its
 * controller.
 */
function unlessHas(s: StepOf<'may'>, st: RenderState): Clause | null {
  const [d] = s.do;
  const [o] = s.otherwise ?? [];
  if (s.do.length !== 1 || s.otherwise?.length !== 1 || s.as !== undefined || s.who.ref !== 'controllerOf' || d?.op !== 'damage' || o?.op !== 'damage') return null;
  const lit = (n: unknown): n is number => typeof n === 'number';
  const plainDamage = (x: StepOf<'damage'>): boolean => x.source.ref === 'self' && x.also === undefined && x.divided === undefined && x.as === undefined && x.unpreventable !== true && x.guard === undefined && lit(x.amount);
  if (!plainDamage(d) || !plainDamage(o) || JSON.stringify(d.to) !== JSON.stringify(s.who) || JSON.stringify(o.to) !== JSON.stringify(s.who.object) || o.to.ref !== 'target') return null;
  const spec = st.specs.get(o.to.id);
  if (spec === undefined || spec.kind !== 'object' || spec.min !== 1 || spec.max !== 1 || JSON.stringify(spec.filter) !== JSON.stringify({ types: ['Creature'] })) return null;
  const first = K.clause(o, st);
  return plain(`${first.sub} unless that creature's controller has ~ deal ${d.amount as number} damage to them`, { standalone: true, closesScope: true });
}

/**
 * FAST5 T65: "each player may shuffle their hand and graveyard into their library, then each player who does draws seven cards" (CR 701.24a, 121.1, 608.2d,
 * 608.2f): every player decides first (CR 101.4, 608.2e), then each who chose to puts their hand and graveyard cards into their library, shuffles it and draws
 * the fixed number, one player at a time (as T20's "each player may discard their hand and draw seven cards"). Only that exact shape: the group `may`, no
 * otherwise, and the four steps on the iterating player.
 */
function eachMayShuffleThenDraw(s: StepOf<'may'>, st: RenderState): Clause | null {
  if (JSON.stringify(s.who) !== JSON.stringify({ ref: 'each', who: 'player' }) || s.otherwise !== undefined || s.guard !== undefined || s.as !== undefined || s.do.length !== 4) return null;
  const [a, b, c, d] = s.do;
  const me = { ref: 'iterating' };
  if (a?.op !== 'move' || b?.op !== 'move' || c?.op !== 'shuffle' || d?.op !== 'draw') return null;
  const into = JSON.stringify({ zone: 'library', owner: me });
  const from = (zone: string): string => JSON.stringify({ ref: 'each', filter: { zone, owner: me } });
  if (JSON.stringify(a.what) !== from('hand') || JSON.stringify(b.what) !== from('graveyard') || JSON.stringify(a.to) !== into || JSON.stringify(b.to) !== into) return null;
  if ([a, b, c, d].some((x) => x.guard !== undefined || x.as !== undefined) || a.until !== undefined || b.until !== undefined) return null;
  if (JSON.stringify(c.who) !== JSON.stringify(me) || JSON.stringify(d.who) !== JSON.stringify(me) || typeof d.count !== 'number' || d.count < 1) return null;
  // r5-refs (family each-player-who-does-sentence; CR 608.2c): Oracle also writes the draw as a sentence of its own, "... into their library. Each player who does draws ..."
  const text = `each player may shuffle their hand and graveyard into their library${alt(', then', '.')} each player who does draws ${d.count === 1 ? 'a card' : `${numWord(d.count)} cards`}`;
  return acting('x', text, text, { standalone: true, closesScope: true });
}

/**
 * FAST5 T66 (CR 118.12a): "destroy target permanent unless its controller has ~ deal damage to them equal to ~'s power" is "that permanent's controller may
 * have ~ deal that damage to them; if they don't, destroy the permanent". Stored as that `may`; this is that exact shape and nothing else, or null: ~ deals
 * damage equal to its own power to the controller of the target the step destroys otherwise.
 */
function unlessHasPower(s: StepOf<'may'>, st: RenderState): Clause | null {
  const [d] = s.do;
  const [o] = s.otherwise ?? [];
  if (s.do.length !== 1 || s.otherwise?.length !== 1 || s.as !== undefined || s.guard !== undefined || s.who.ref !== 'controllerOf' || d?.op !== 'damage' || o?.op !== 'destroy') return null;
  if (d.source.ref !== 'self' || d.also !== undefined || d.divided !== undefined || d.perSource !== undefined || d.as !== undefined || d.unpreventable === true || d.guard !== undefined) return null;
  if (JSON.stringify(d.to) !== JSON.stringify(s.who) || JSON.stringify(o.what) !== JSON.stringify(s.who.object) || o.what.ref !== 'target') return null;
  if (o.regeneration !== undefined || o.as !== undefined || o.guard !== undefined) return null;
  const q = d.amount;
  if (typeof q !== 'object' || q.q !== 'stat' || q.stat !== 'power' || q.of.ref !== 'self' || q.sum !== undefined || q.agg !== undefined) return null;
  const first = K.clause(o, st);
  return plain(`${first.sub} unless its controller has ~ deal damage to them equal to ${K.qty(q, st)}`, { standalone: true, closesScope: true });
}

/**
 * FAST5 T70 (CR 611.2c, 608.2d): "You may exile the top card of your library. Until end of turn, you may play that card." is stored as ONE `may` whose
 * instructions are the exile (named) and the permission to play it: the card exists only if the controller chose to exile it (parser/lower/anaphora.ts#impulseFlagged
 * puts the permission there). Written as the two sentences Oracle prints; null for any other `may`.
 */
function mayImpulse(s: StepOf<'may'>, st: RenderState): Clause | null {
  const [move, permit] = s.do;
  if (s.do.length !== 2 || s.otherwise !== undefined || s.as !== undefined || s.who.ref !== 'you' || move?.op !== 'move' || typeof move.as !== 'string' || permit?.op !== 'effect') return null;
  if (permit.effects.length !== 1 || permit.effects[0]!.s !== 'permit') return null;
  const e = permit.effects[0]!;
  if (e.action !== 'play' || e.of?.is?.ref !== 'bound' || e.of.is.name !== move.as) return null;
  const key = playerKey(s.who);
  const saved = st.actor;
  st.actor = key;
  const first = within(K.clause(move, st), key);
  st.actor = saved;
  const second = K.steps([permit], st);
  return acting(key ?? 'x', `you may ${first}. ${second}`, `you may ${first}. ${second}`, { standalone: true, closesScope: true });
}

/**
 * std-copy-2 (CR 707.10, 707.10c, 608.2c, 611.2c; eff.stdcopy2.mayCopy.thoseSpellsGain): "you may copy it. If you do, those spells gain wither. You may choose new
 * targets for the copy." (Spinerock Tyrant): an optional copy of a spell, then one effect that grants abilities to the spell copied and its copy (a union of the copy's
 * `what` and its own binding). The new targets of the copy are chosen as it is made (CR 707.10c), but Oracle says them last. Null for any other `may`.
 */
function mayCopyThoseSpellsGain(s: StepOf<'may'>, st: RenderState): Clause | null {
  if (s.who.ref !== 'you' || s.otherwise !== undefined || s.anyOne === true || s.do.length !== 2) return null;
  const [c, e] = s.do as [EffectStep, EffectStep];
  if (c.op !== 'copy' || c.result !== 'spell' || c.as === undefined || c.count !== undefined || c.except !== undefined || c.guard !== undefined) return null;
  if (e.op !== 'effect' || e.guard !== undefined || e.as !== undefined || e.duration.d !== 'permanent' || e.effects.length !== 1) return null;
  const ce = e.effects[0]!;
  if (ce.s !== 'continuous' || JSON.stringify(ce.affects) !== JSON.stringify({ ref: 'union', of: [c.what, { ref: 'bound', name: c.as }] })) return null;
  const m = ce.mods;
  if (m.length !== 1 || m[0]!.layer !== 6 || m[0]!.add === undefined || Object.keys(m[0]!).some((k) => k !== 'layer' && k !== 'add') || Object.keys(ce).some((k) => k !== 's' && k !== 'affects' && k !== 'mods')) return null;
  const saved = st.actor;
  st.actor = 'you';
  const { newTargets, ...bare } = c;
  const copy = within(K.clause(bare as EffectStep, st), 'you');
  const those = `${c.as}:those`;
  bind(st, those, { nouns: ['spell'], plural: true });
  const gain = K.clause({ ...e, effects: [{ ...ce, affects: { ref: 'bound', name: those } }] } as EffectStep, st);
  st.actor = saved;
  const text = within(gain, 'you'); // "those spells gain wither" (the plural binding's words, render/refs.ts#anaphor)
  const tail = newTargets === true || newTargets === 'may' ? '. you may choose new targets for the copy' : '';
  bind(st, s.as, { nouns: [], plural: false, actor: 'you', optional: true });
  const sub = `you may ${copy}. if you do, ${text}${tail}`;
  return acting('you', sub, sub, { standalone: true, closesScope: true });
}

const mayClause = (s: StepOf<'may'>, st: RenderState): Clause => {
  const folded = tapOrUntap(s, st) ?? unlessHas(s, st) ?? eachMayShuffleThenDraw(s, st) ?? unlessHasPower(s, st) ?? mayImpulse(s, st) ?? mayCopyThoseSpellsGain(s, st);
  if (folded) return folded;
  const key = playerKey(s.who);
  // std-rq (CR 608.2d, 101.4): one player of a group at most does it, "any opponent may sacrifice a creature of their choice" (effects/handlers/control.ts#anyOneMay)
  const anyWho = s.anyOne === true && s.who.ref === 'each' && 'who' in s.who && (s.who.who === 'opponent' || s.who.who === 'player') && s.otherwise === undefined ? s.who.who : undefined;
  if (s.anyOne === true && anyWho === undefined) throw new NoRenderer('"any" of this group');
  const subj = anyWho !== undefined ? { text: `any ${anyWho}` } : K.player(s.who, st, 'subject');
  const saved = st.actor;
  // T20 (FAST4): "each player may discard their hand and draw seven cards": inside the `may` of a group, each player who chose to acts as the iterating
  // player (effects/handlers/control.ts#mayHandler, CR 101.4), so the steps that name that player are the subject's own imperative
  // M12 gaps: so does "you and each opponent who voted for a choice you voted for may scry 2" (`voters`, the same group `may`)
  const inner = (s.who.ref === 'each' || s.who.ref === 'voters') && JSON.stringify(s.do).includes('"ref":"iterating"') ? playerKey({ ref: 'iterating' }) : key;
  st.actor = inner;
  // a clause with its subject baked in ("~ deals 2 damage ...") reads "you may have ~ deal 2 damage ..."
  let body: string;
  const only = s.do.length === 1 ? K.clause(s.do[0]!, st) : null;
  if (only && only.have !== undefined && only.actor === null) body = `have ${only.have}`;
  // FAST4 T30 (CR 608.2d): the controller chooses, another player acts: "you may have target player mill two cards"
  // r3-choose (CR 608.2d): ... and another player chooses whether YOU act: "target opponent may have you create two Lander tokens" (Terrapact Intimidator)
  else if (only && only.have !== undefined && only.actor !== null && (key === 'you' || only.actor === 'you') && only.actor !== key) body = `have ${only.have}`;
  else body = only ? within(only, inner) : K.steps(s.do, st, { nested: true, actor: inner });
  st.actor = saved;
  const sentence = `may ${body}`;
  // p2-copy-spell-1 (CR 608.2c, 608.2d; family they-may): a player named before, whom the pronoun names uniquely (`they`, render/refs.ts), is also "they" as the
  // subject of an option, as of any other instruction (render/steps-util.ts#byPlayer): "If the player does, they may copy this spell ..." (Chain of Vapor)
  let sub = 'they' in subj && subj.they === true ? alt(`${subj.text} ${sentence}`, `they ${sentence}`) : `${subj.text} ${sentence}`;
  // r4-moved: an option of yours that begins with a search of your library is also "If you search your library this way" later (render/cond.ts)
  const first = s.do[0] as { op?: string; who?: { ref?: string }; zone?: string; owner?: unknown; alsoZones?: unknown } | undefined;
  const searched = key === 'you' && s.otherwise === undefined && first?.op === 'search' && first.who?.ref === 'you' && first.zone === 'library' && first.owner === undefined && first.alsoZones === undefined;
  bind(st, s.as, { nouns: [], plural: false, actor: key, optional: true, ...(searched ? { searched: true as const } : {}), ...(anyWho !== undefined ? { anyOne: true as const } : {}) });
  let standalone = false;
  if (s.otherwise && s.otherwise.length > 0) {
    const other = K.steps(s.otherwise, st, { actor: key });
    const each = eachWhoDoesnt(s, st);
    sub += each !== null ? alt(`. If ${didText(key, s.who, st, true)}, ${other}`, `. ${each}`) : `. If ${didText(key, s.who, st, true)}, ${other}`;
    standalone = true;
  }
  return acting(key ?? 'x', sub, sub, { standalone, closesScope: true });
};

/**
 * cloud std-spm (CR 101.4, 608.2d): what each player of a group who chose not to do it does, "Each player may discard a card. Each player who doesn't loses 3 life."
 * (The Death of Gwen Stacy): the `may` of every player, whose `otherwise` is one step on the iterating player (effects/handlers/control.ts#mayHandler runs it
 * for each player who chose no). Null for any other shape.
 */
function eachWhoDoesnt(s: StepOf<'may'>, st: RenderState): string | null {
  if (JSON.stringify(s.who) !== JSON.stringify({ ref: 'each', who: 'player' }) || s.otherwise?.length !== 1 || s.as !== undefined) return null;
  const o = s.otherwise[0]!;
  if (o.guard !== undefined || o.as !== undefined || !('who' in o) || JSON.stringify(o.who) !== JSON.stringify({ ref: 'iterating' })) return null;
  const saved = st.actor;
  st.actor = null;
  const c = K.clause(o, st);
  st.actor = saved;
  return c.pred !== undefined ? `each player who doesn't ${c.pred}` : null;
}

/**
 * std-mkm (CR 118.12a, 608.2f, 101.4): "Each opponent loses 3 life unless they discard a card or sacrifice a creature": for each player of the group, one at a
 * time, that player may pay a cost (or either of two, stored as `pay A else [pay B]`, the three outcomes of FAST4 T34), and if they don't, one instruction
 * happens to them. Written with the group as the subject of the instruction and "they" as the payer. Null for any other body; on a copy of the state.
 */
function eachUnlessThey(s: StepOf<'forEach'>, st0: RenderState): string | null {
  const over = s.over;
  if (over.ref !== 'each' || !('who' in over) || (over.who !== 'opponent' && over.who !== 'player') || s.do.length !== 1) return null;
  const self = JSON.stringify({ ref: 'bound', name: s.as });
  const plainPay = (x: EffectStep | undefined): x is StepOf<'pay'> => x?.op === 'pay' && JSON.stringify(x.who) === self && (x.then?.length ?? 0) === 0
    && x.mandatory === undefined && x.times === undefined && x.as === undefined && x.guard === undefined && x.else?.length === 1;
  const first = s.do[0];
  if (!plainPay(first)) return null;
  const costs = [first.cost];
  let last = first.else![0]!;
  if (last.op === 'pay') {
    if (!plainPay(last)) return null;
    costs.push(last.cost);
    last = last.else![0]!;
  }
  const r = last as { who?: unknown; to?: unknown; guard?: unknown; as?: unknown };
  if (last.op === 'pay' || r.guard !== undefined || r.as !== undefined || JSON.stringify(r.who ?? r.to) !== self || JSON.stringify(last).split(`"name":"${s.as}"`).length !== 2) return null;
  const each = { ref: 'each', who: over.who };
  const instead = (r.who !== undefined ? { ...last, who: each } : { ...last, to: each }) as EffectStep;
  const st = cloneState(st0);
  const instruction = K.steps([instead], st);
  // FAST4 T34 (CR 701.21a): another player's sacrifice is of a permanent they choose, which Oracle may say ("of their choice")
  const verbs = (person: 'pl' | 'sg' | 'you'): string[] => costs.map((c) => {
    const v = K.costVerbs(c, st, person);
    const sacrifice = c.mana === undefined && c.tap !== true && c.other?.length === 1 && c.other[0]!.kind === 'sacrifice' && c.other[0]!.self !== true;
    return sacrifice ? alt(v, `${v} of their choice`) : v;
  });
  // r4-fxz (CR 118.12a, 608.2c): the payer may be named again as "that player", with singular verbs ("each opponent loses 3 life unless that player sacrifices
  // a nonland permanent of their choice or discards a card"): the player of the group the instruction is happening to, never another one
  const unless = alt(`${instruction} unless they ${verbs('pl').join(' or ')}`, `${instruction} unless that player ${verbs('sg').join(' or ')}`);
  // std-rw6 (CR 118.12, 101.4, 608.2c): the choice said first and the instruction after it, "Each opponent may discard a card or sacrifice a permanent of their
  // choice. ~ deals 3 damage to each opponent who didn't." (family each-may-who-didnt): only damage dealt to the group, whose recipient ends the instruction
  const damage = last.op === 'damage' && r.to !== undefined && last.divided === undefined && last.also === undefined && costs.length === 2;
  if (!damage) return unless;
  // std-rx30 (CR 118.12, 608.2c): or the instruction said after "Then", naming again what they didn't do "this way", a sacrifice of any permanent ("Each opponent
  // may sacrifice a nonland permanent of their choice or discard a card. Then ~ deals damage equal to its power to each opponent who didn't sacrifice a permanent
  // or discard a card this way.", Osseous Sticktwister): the only sacrifice or discard of the step is the payment, so not paying is not doing it this way
  const again = costs.map((c) => K.costVerbs(c.other?.length === 1 && c.other[0]!.kind === 'sacrifice' && c.mana === undefined && c.tap !== true
    ? { ...c, other: [{ ...c.other[0]!, filter: {} }] } : c, st, 'you')).join(' or ');
  return alt(unless, `each ${over.who} may ${verbs('you').join(' or ')}. ${instruction} who ${alt("didn't", "doesn't")}`,
    `each ${over.who} may ${verbs('you').join(' or ')}. then ${instruction} who didn't ${again} this way`);
}

/**
 * FAST5 T44 (CR 118.12): "you may sacrifice an artifact or discard a card" is a payment of one of two costs, stored as `pay A else [pay B]` (the three
 * outcomes: A, B, neither; parser/lower/conditions.ts#eitherOrPay). Its "If you do," instructions follow BOTH payments (the same steps in each `then`).
 * The second payment, or null when the step is not that shape.
 */
function eitherOrSecond(s: StepOf<'pay'>): StepOf<'pay'> | null {
  if (s.then !== undefined && s.then.length === 0) return null;
  if (s.mandatory !== undefined || s.times !== undefined || s.else === undefined || s.else.length !== 1) return null;
  const inner = s.else[0]!;
  if (inner.op !== 'pay' || inner.else !== undefined || inner.as !== undefined || inner.mandatory !== undefined || inner.times !== undefined) return null;
  if (JSON.stringify(inner.who) !== JSON.stringify(s.who) || JSON.stringify(inner.then ?? null) !== JSON.stringify(s.then ?? null)) return null;
  return inner;
}

const payClause = (s: StepOf<'pay'>, st: RenderState): Clause => {
  const key = playerKey(s.who);
  // std-combat-2 (CR 118.12, 608.2d): "you may pay {1} up to three times" (`upTo`): the controller's payment of a chosen number of times, with no branches of its own
  if (s.upTo !== undefined) {
    if (key !== 'you' || s.mandatory === true || s.times !== undefined || s.then !== undefined || s.else !== undefined) throw new NoRenderer('a payment up to a number of times other than "you may pay ... up to N times"');
    bind(st, s.as, { nouns: [], plural: false, actor: key, optional: true, paidUpTo: true });
    const text = `you may ${K.costVerbs(s.cost, st, 'you')} up to ${typeof s.upTo === 'number' ? numWord(s.upTo) : K.qty(s.upTo, st)} times`;
    return acting('you', text, text);
  }
  // std-rw8 (CR 603.12): named, it is the payment a reflexive trigger waits for ("When you do, ..."), either payment (effects/handlers/pay.ts)
  const second = key === 'you' && (s.as === undefined || s.then === undefined) ? eitherOrSecond(s) : null;
  if (second !== null) {
    const choice = `you may ${K.costVerbs(s.cost, st, 'you')} or ${K.costVerbs(second.cost, st, 'you')}`;
    bind(st, s.as, { nouns: [], plural: false, actor: key, optional: true });
    if (s.then === undefined) return acting('you', choice, choice);
    const text = `${choice}. If ${didText(key, s.who, st, false)}, ${K.steps(s.then, st, { actor: undefined })}`;
    return acting('you', text, text, { standalone: true });
  }
  // CR 118.12a: "[do something] unless [a player] pays" lets the payer decide first. A pay by another player inside the controller's own `may` would make the
  // controller decide first, and no Oracle wording says that: the text cannot be written, so the ability is refused rather than printed as the other order.
  if (st.actor !== null && st.actor !== key) throw new NoRenderer('a pay by another player inside a may');
  const hasThen = s.then !== undefined && s.then.length > 0;
  const hasElse = s.else !== undefined && s.else.length > 0;
  const verbs = (v: RenderState, person: Person): string => K.costVerbs(s.cost, v, person, s.times);
  // FAST4 T34 (CR 701.21a): another player's sacrifice is of a permanent they choose, which Oracle may say ("unless they sacrifice a creature of their choice")
  const sacrificeOnly = key !== 'you' && s.times === undefined && s.cost.mana === undefined && s.cost.tap !== true && s.cost.untap !== true && s.cost.loyalty === undefined
    && s.cost.other?.length === 1 && s.cost.other[0]!.kind === 'sacrifice' && s.cost.other[0]!.self !== true && s.cost.other[0]!.count === 1;
  const theirChoice = (v: RenderState, person: Person): string => (sacrificeOnly ? alt(verbs(v, person), `${verbs(v, person)} of their choice`) : verbs(v, person));
  // a payment that cannot be declined has no "unless" and no "if you don't": a then or else beside `mandatory` would be dropped, so it is refused
  if (s.mandatory === true && (hasThen || hasElse)) throw new NoRenderer('a mandatory pay with a then or an else branch');
  if (s.mandatory === true || (!hasThen && !hasElse)) {
    const subj = K.player(s.who, st, 'subject');
    bind(st, s.as, { nouns: [], plural: false, actor: key, optional: s.mandatory !== true });
    if (s.mandatory === true) return acting(key ?? 'x', verbs(st, 'you'), `${subj.text} ${verbs(st, subj.person)}`);
    const text = `${subj.text} may ${verbs(st, 'you')}`;
    return acting(key ?? 'x', text, text);
  }
  const forms = withVariants(st, [
    // "[else] unless [who] pays [cost]"
    (v): string | null => {
      if (!hasElse || hasThen) return null;
      // FAST5 T56 (CR 118.12a, 701.6a): "Counter target spell unless its controller pays {3}. If that spell is countered this way, exile it instead ...": the
      // sentence about where it goes follows the payment, so the counter is worded bare before "unless" and the destination after it
      const rider = s.else!.length === 1 && s.else![0]!.op === 'counter' && s.else![0]!.to !== undefined ? (s.else![0] as StepOf<'counter'>) : null;
      const bare = rider === null ? null : [{ ...rider, to: undefined } as StepOf<'counter'>];
      const other = K.steps(bare ?? s.else!, v, { actor: undefined });
      const tail = rider === null ? '' : `. ${counterTail(rider, v)}`; // after the bare counter: that names what is countered
      const subj = K.player(s.who, v, 'subject');
      // FAST3 T14: a player named before may be "they" with a plural verb ("that player sacrifices a permanent of their choice unless they pay {1}"), offered
      // only when the pronoun names that player uniquely (render/refs.ts#anaphor sets `they`: the singular "they" of steps-util.ts#byPlayer, FAST2 T8) and the
      // payer is the very player the instruction before "unless" names: after "each opponent sacrifices a permanent", "they" is each of those players (CR
      // 608.2c), which one payer (an event's player) is not, so that reading is never offered (the ability stays manual)
      // FAST3 T14, the "unless" idiom (CR 118.12a; parser/lower/anaphora.ts#unlessIdiom): "counter that spell or ability unless its controller pays {2}": "its"
      // names the object of the one instruction the payment prevents, whatever else the sentence could call "it"
      const only = s.else!.length === 1 ? (s.else![0] as { what?: unknown }) : null;
      if (s.who.ref === 'controllerOf' && only !== null && only.what !== undefined && JSON.stringify(only.what) === JSON.stringify(s.who.object)) {
        return `${alt(`${other} unless ${subj.text} ${verbs(v, subj.person)}`, `${other} unless its controller ${verbs(v, 'sg')}`)}${tail}`;
      }
      if (subj.they === true && s.else!.length === 1 && JSON.stringify((s.else![0] as { who?: unknown }).who) === JSON.stringify(s.who)) return alt(`${other} unless ${subj.text} ${verbs(v, subj.person)}`, `${other} unless they ${theirChoice(v, 'pl')}`);
      // FAST4 T34 (CR 118.12a): "~ deals 2 damage to that player unless they sacrifice a creature of their choice": the payer is the player the damage is dealt to
      if (subj.they === true && s.else!.length === 1 && s.else![0]!.op === 'damage' && JSON.stringify(s.else![0]!.to) === JSON.stringify(s.who)) return alt(`${other} unless ${subj.text} ${verbs(v, subj.person)}`, `${other} unless they ${theirChoice(v, 'pl')}`);
      return `${other} unless ${subj.text} ${verbs(v, subj.person)}${tail}`;
    },
    // FAST4 T34 (CR 118.12a): "loses 3 life unless they sacrifice a nonland permanent of their choice or discard a card": the payer may pay either cost, stored
    // as the first payment whose only `else` is the second one by the same player (the same three outcomes: the first cost, the second, or the instruction)
    (v): string | null => {
      const inner = hasElse && !hasThen && s.else!.length === 1 && s.else![0]!.op === 'pay' ? s.else![0]! as StepOf<'pay'> : null;
      if (inner === null || s.as !== undefined || inner.as !== undefined || s.times !== undefined || inner.times !== undefined || inner.mandatory === true) return null;
      if ((inner.then?.length ?? 0) > 0 || (inner.else?.length ?? 0) !== 1 || JSON.stringify(inner.who) !== JSON.stringify(s.who) || key === 'you') return null;
      const other = K.steps(inner.else!, v, { actor: undefined });
      const subj = K.player(s.who, v, 'subject');
      const step = inner.else![0] as { who?: unknown; to?: unknown };
      if (subj.they !== true || JSON.stringify(step.who ?? step.to) !== JSON.stringify(s.who)) return null;
      return `${other} unless they ${theirChoice(v, 'pl')} or ${K.costVerbs(inner.cost, v, 'pl')}`;
    },
    // Cloud std-eoe (CR 118.12a, 608.2c; the "unless" idiom of FAST3 T14): "Counter target spell unless its controller pays {2}. If they do, you create a Lander
    // token.": the payment prevents the one instruction before "unless" (its controller is the controller of what that instruction names), and "If they do"
    // follows the payer's choice to pay; the instruction after it is the ability's controller's own, as after "If that player does"
    (v): string | null => {
      if (!hasElse || !hasThen || s.who.ref !== 'controllerOf' || s.as !== undefined || s.times !== undefined || s.else!.length !== 1) return null;
      const only = s.else![0] as { what?: unknown };
      if (only.what === undefined || JSON.stringify(only.what) !== JSON.stringify(s.who.object)) return null;
      const other = K.steps(s.else!, v, { actor: undefined });
      return `${other} unless its controller ${verbs(v, 'sg')}. If they do, ${K.steps(s.then!, v, { actor: undefined })}`;
    },
    // "[who] may pay [cost]. If [who] does, [then]. If [who] doesn't, [else]."
    (v): string | null => {
      const subj = K.player(s.who, v, 'subject');
      let out = `${subj.text} may ${verbs(v, 'you')}`;
      // FAST2 T8: after "If you do," the controller's instruction reads either way ("If you do, draw a card", "If you do, you gain 1 life")
      if (hasThen) {
        const then = K.steps(s.then!, v, { actor: key === 'you' ? undefined : key });
        // r4-fxb (family if-you-do-also, as FAST5X E1): "If you do, ~ also deals 2 damage to that creature's controller": "also" says only that the instruction
        // comes on top of the earlier ones (CR 608.2c)
        const also = withAlso(then);
        out += `. If ${didText(key, s.who, v, false)}, ${also === null ? then : alt(then, also)}`;
      }
      if (hasElse) out += `. If ${didText(key, s.who, v, true)}, ${K.steps(s.else!, v, { actor: undefined })}`;
      return out;
    },
    // std-rx31 (CR 608.2d, 117.3; family they-opponent-of-the-event): "Whenever a creature an opponent controls dies, they may pay 3 life. If they don't, ...": the one
    // opponent the trigger names (the controller of the creature that died) is "they" in its effect, the only player it mentions
    (v): string | null => {
      const eventPlayer = JSON.stringify(s.who) === JSON.stringify({ ref: 'event', role: 'player' })
        || JSON.stringify(s.who) === JSON.stringify({ ref: 'controllerOf', object: { ref: 'event', role: 'subject' } });
      if (hasThen || !hasElse || s.times !== undefined || !eventPlayer) return null;
      const evs = v.trigger ?? [];
      if (evs.length !== 1 || (evs[0] as { subject?: { controller?: unknown } }).subject?.controller !== 'opponent') return null;
      return `they may ${verbs(v, 'you')}. If they don't, ${K.steps(s.else!, v, { actor: undefined })}`;
    },
    // "[Pay cost]. If [who] doesn't, [else]." (the payer must decide: Pact of Negation)
    (v): string | null => {
      if (hasThen || !hasElse) return null;
      const subj = K.player(s.who, v, 'subject');
      const paid = `${subj.text} ${verbs(v, subj.person)}`;
      return `${paid}. If ${didText(key, s.who, v, true)}, ${K.steps(s.else!, v, { actor: undefined })}`;
    },
    // imperative form for the controller: "Pay {3}{U}{U}. If you don't, you lose the game."
    (v): string | null => {
      if (hasThen || !hasElse || key !== 'you') return null;
      return `${verbs(v, 'you')}. If ${didText(key, s.who, v, true)}, ${K.steps(s.else!, v, { actor: undefined })}`;
    },
  ]).filter((x): x is string => x !== null);
  bind(st, s.as, { nouns: [], plural: false, actor: key, optional: true });
  // for the controller the imperative reads first ("Pay {3}{U}{U}. If you don't, you lose the game."), for others the "unless" form
  const text = alt(...(key === 'you' ? [...forms].reverse() : forms));
  // FAST5X E10: after another instruction the payment may begin a sentence with "Then" ("Draw three cards. Then discard a card unless you waterbend {2}."):
  // "then" only orders the instructions (CR 608.2c), as for "Then if ..." (FAST2 T8);
  // FAST5X E15: "Then counter up to one target spell unless its controller pays ..." (the same leading "Then")
  // FAST5 T61: "..., then you may exile an Elf card from your graveyard. If you do, each opponent loses 2 life." (a payment by you, with an if-you-do follower, no else)
  // r5-dig (CR 608.2c, 118.12a): "Surveil 2, then counter the chosen spell unless its controller pays {1} for each card in your graveyard": another player's
  // payment that prevents only the instruction before "unless" also follows a plain instruction after ", then" (the payment is offered after that instruction)
  const unlessAfterThen = key !== 'you' && hasElse && !hasThen && s.mandatory === undefined;
  return acting(key ?? 'x', text, text, { standalone: true, leadThen: true, ...((key === 'you' && hasThen && !hasElse) || unlessAfterThen ? { commaThen: true } : {}) });
};

/**
 * FAST5X E2 (CR 207.2c, 603.4): a condition on this turn's history, or several joined by "or" ("a nonland permanent left the battlefield this turn or a spell
 * was warped this turn", the void ability word): "sacrifice ~ unless C" is "if not C, sacrifice ~", like "unless it escaped" (eff.m6.sacrifice.unless).
 */
/** CR 110.4a: the permanent card types, the filter of "a permanent card" (the object's types where it is now, CR 400.7). */
const PERMANENT_CARD = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'];

/**
 * FAST5X E25 (CR 708.3, 708.7, 708.8, 110.4a): "return it to the battlefield face down under its owner's control if it's a permanent card, then turn it face up"
 * (zz-fast5x/e25.json, eff.e25.return.faceDown.thenFaceUp): the move of the object face down under its owner's control, then the effect turning exactly that
 * permanent face up, both only if the object is a permanent card. Null for any other `if`.
 */
function returnFaceDownThenUp(s: StepOf<'if'>, st: RenderState): Clause | null {
  if (s.else !== undefined || s.cond.cond !== 'exists' || s.cond.atLeast !== undefined || s.cond.of.ref !== 'each' || s.then.length !== 2) return null;
  const f0 = s.cond.of.filter;
  if (JSON.stringify(f0) !== JSON.stringify({ is: f0.is, types: PERMANENT_CARD, isCard: true, zone: 'any' })) return null;
  const [m, f] = s.then;
  if (m?.op !== 'move' || f?.op !== 'changeFace' || m.guard !== undefined || f.guard !== undefined || m.as === undefined || f.as !== undefined) return null;
  if (JSON.stringify(m.what) !== JSON.stringify(f0.is) || JSON.stringify(m.to) !== JSON.stringify({ zone: 'battlefield', faceDown: true, controller: 'owner' })) return null;
  if (m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (f.to !== 'faceUp' || f.manifest !== undefined || f.what.ref !== 'bound' || f.what.name !== m.as) return null;
  const what = K.obj(m.what, st, 'object').text;
  bind(st, m.as, { nouns: ['creature', 'permanent'], plural: false });
  return plain(`return ${what} to the battlefield face down under its owner's control if it's a permanent card, then turn it face up`, { standalone: true });
}

/** std-ru (CR 608.2c, 110.2): one `may` of yours (no `otherwise`, no guard) around one move of one named object onto the battlefield (eff.stdru.may.put.bf.ifCond). */
function mayPutOntoBattlefield(then: readonly EffectStep[]): boolean {
  const m = then.length === 1 ? then[0] : undefined;
  if (m?.op !== 'may' || m.guard !== undefined || m.who.ref !== 'you' || m.otherwise !== undefined || m.do.length !== 1) return false;
  const mv = m.do[0];
  return mv?.op === 'move' && mv.guard === undefined && mv.to.zone === 'battlefield' && (mv.what.ref === 'bound' || mv.what.ref === 'target');
}

const turnHistory = (c: Condition): boolean => (c.cond === 'happened' && c.scope === 'turn') || (c.cond === 'any' && c.of.length > 0 && c.of.every(turnHistory));

/** std-rB: an instruction that opens with its verb, with no subject and no alternative group in front ("put ...", "draw ...", "create ..."). */
const IMPERATIVE_LEAD = /^(?:put|draw|create|return|exile|destroy|sacrifice|discard|mill|tap|untap|scry|surveil|investigate|gain|lose)\b/;
/** std-rB: "also" in front of the text when it starts with an imperative verb; of an alternative group it opens with, the readings that do (null when none). */
function alsoLead(text: string): string | null {
  if (text[0] !== ALT_OPEN) return IMPERATIVE_LEAD.test(text) ? `also ${text}` : null;
  const g = groupAt(text, 0);
  const kept = g.readings.map(alsoLead).filter((r): r is string => r !== null);
  return kept.length === 0 ? null : `${ALT_OPEN}${kept.join(ALT_SEP)}${ALT_CLOSE}${text.slice(g.end)}`;
}

/** FAST5X E1: the verbs after which "also" stands in "<subject> also <verb> ..." (the first one outside an alternative group). */
const ALSO_VERBS = /^(?:gains?|gets?|deals?|loses?|has|have|draws?|creates?|puts?|returns?|exiles?|destroys?|sacrifices?|discards?|mills?|can't|becomes?)$/;

/**
 * FAST5X E1: the rendered instruction with "also" before its first verb ("that creature also gains indestructible until end of turn"), or null when there is
 * none to find. Alternative groups are followed: a group whose readings all hold the verb gets "also" in each reading; a group with none of it is passed
 * over; a group where only some readings have it gives null (the variant is then not offered: the gate fails closed).
 */
export function withAlso(text: string, lead = false): string | null {
  return alsoIn(text, lead);
}

/** The end of the alternative group that opens at `at` and its readings (each still marked). */
function groupAt(text: string, at: number): { end: number; readings: string[] } {
  const readings: string[] = [];
  let depth = 0;
  let from = at + 1;
  for (let i = at; i < text.length; i++) {
    const ch = text[i];
    if (ch === ALT_OPEN) depth++;
    else if (ch === ALT_CLOSE) {
      depth--;
      if (depth === 0) { readings.push(text.slice(from, i)); return { end: i + 1, readings }; }
    } else if (ch === ALT_SEP && depth === 1) { readings.push(text.slice(from, i)); from = i + 1; }
  }
  return { end: text.length, readings: [text.slice(from)] };
}

/** `lead`: a word comes before `text` ("also" never starts the sentence). */
function alsoIn(text: string, lead: boolean): string | null {
  let i = 0;
  let words = lead;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === ALT_OPEN) {
      const g = groupAt(text, i);
      const done = g.readings.map((r) => alsoIn(r, words));
      if (done.every((d) => d !== null)) return `${text.slice(0, i)}${ALT_OPEN}${(done as string[]).join(ALT_SEP)}${ALT_CLOSE}${text.slice(g.end)}`;
      if (done.some((d) => d !== null)) return null;
      if (g.readings.some((r) => /[a-z]/i.test(r))) words = true;
      i = g.end;
      continue;
    }
    if (/[a-z]/i.test(ch) && (i === 0 || !/[a-z']/i.test(text[i - 1]!))) {
      const m = /^[a-z']+/i.exec(text.slice(i))!;
      if (words && ALSO_VERBS.test(m[0])) return `${text.slice(0, i)}also ${text.slice(i)}`;
      words = true;
      i += m[0].length;
      continue;
    }
    i++;
  }
  return null;
}

/** Cloud std-eoe: a `forEach` over several player targets whose one instruction is done by the iteration player (the forEach handler binds it), as that instruction. */
function perTargetPlayers(s: StepOf<'forEach'>, st: RenderState): Clause | null {
  const [only] = s.do;
  const over = s.over;
  if (over.ref !== 'target' || s.do.length !== 1 || only === undefined || only.guard !== undefined || only.as !== undefined) return null;
  const spec = st.specs.get(over.id);
  const who = (only as { who?: unknown }).who;
  if (spec === undefined || spec.kind !== 'player' || spec.max === 1 || JSON.stringify(who) !== JSON.stringify({ ref: 'bound', name: s.as })) return null;
  const said = JSON.parse(JSON.stringify(only).replaceAll(JSON.stringify({ ref: 'bound', name: s.as }), JSON.stringify({ ref: 'target', id: over.id }))) as EffectStep;
  return plain(K.steps([said], st));
}

/**
 * FAST5X-4 (CR 702.179e, 120.3): a forEach over each player whose one step is damage to that player, guarded by "that player doesn't have max speed", reads
 * "[source] deals N damage to each player who doesn't have max speed"; null for any other forEach.
 */
function withoutMaxSpeedDamage(s: StepOf<'forEach'>, st: RenderState): string | null {
  const over = s.over;
  const [only] = s.do;
  if (over.ref !== 'each' || !('who' in over) || over.who !== 'player' || s.do.length !== 1 || only?.op !== 'damage' || only.as !== undefined) return null;
  const self = JSON.stringify({ ref: 'bound', name: s.as });
  const g = only.guard;
  if (JSON.stringify(only.to) !== self || g?.cond !== 'not' || g.of.cond !== 'designation' || g.of.what !== 'maxSpeed' || JSON.stringify(g.of.who) !== self) return null;
  const { guard: _g, ...bare } = only;
  const text = K.steps([{ ...bare, to: { ref: 'each', who: 'player' } }], cloneState(st));
  return text.endsWith(' to each player') ? `${text} who doesn't have max speed` : null;
}

/**
 * r4-fxb (CR 120.3, 608.2f): a forEach over each player whose one step is damage to that player, of the number of objects of a description that player controls,
 * reads "[source] deals damage to each player equal to the number of [objects] that player controls" (std-rx23: also "each opponent" and "twice the number"); null
 * for any other forEach.
 */
function damageEqualToTheirCount(s: StepOf<'forEach'>, st: RenderState): string | null {
  const over = s.over;
  const [only] = s.do;
  if (over.ref !== 'each' || !('who' in over) || (over.who !== 'player' && over.who !== 'opponent') || s.do.length !== 1 || only?.op !== 'damage' || only.as !== undefined || only.guard !== undefined) return null;
  if (only.also !== undefined || only.divided !== undefined || only.perSource !== undefined || JSON.stringify(only.to) !== JSON.stringify({ ref: 'bound', name: s.as })) return null;
  // std-rx23 (CR 120.3, 608.2h): also "each opponent" and "twice the number of ..." (the count times 2)
  const src = K.obj(only.source, st, 'subject');
  const head = `${src.text} ${src.plural ? 'deal' : 'deals'} damage to each ${over.who} equal to`;
  // p2-damage-1 (CR 119.1, 107.1a; Heartless Hidetsugu): "equal to half that player's life total, rounded down"
  const a = only.amount;
  if (typeof a === 'object' && a.q === 'math' && a.op === 'floorDiv' && a.args.length === 2 && a.args[1] === 2 && JSON.stringify(a.args[0]) === JSON.stringify({ q: 'life', of: { ref: 'iterating' } })) {
    return `${head} half that player's life total, rounded down`;
  }
  const twice = typeof a === 'object' && a.q === 'math' && a.op === '*' && a.args.length === 2 && a.args[0] === 2;
  const n = twice && typeof a === 'object' && a.q === 'math' ? a.args[1] : a;
  if (typeof n !== 'object' || n.q !== 'count' || n.of.ref !== 'each' || !('filter' in n.of) || JSON.stringify(n.of.filter.controller) !== JSON.stringify({ ref: 'iterating' })) return null;
  const { controller: _c, ...rest } = n.of.filter;
  const count = `${twice ? 'twice ' : ''}the number of`;
  // p2-damage-1 (CR 608.2f, 109.4; family each-player-they-control): the iterated player is also "they" ("the number of lands they control", Acidic Soil), and one
  // keyword of the counted objects is also said after the controller ("creatures that player controls with flying", Wing Storm)
  const { keyword: kw, ...noKw } = rest;
  const trailing = typeof kw === 'string' ? [`${head} ${count} ${K.np(noKw, cloneState(st), { det: 'none', plural: true })} that player controls with ${kw}`] : [];
  const plural = K.np(rest, st, { det: 'none', plural: true });
  return alt(`${head} ${count} ${plural} that player controls`, `${head} ${count} ${plural} they control`, ...trailing);
}

/**
 * FAST5 T70 (CR 122.1, 701.27a, 111.4, 608.2c): "Then if there are three or more landmark counters on it, remove those counters, transform ~, and create three
 * Treasure tokens." is `if` the counters of a kind on the object reach N, then remove all of that kind from it, transform the object itself, create tokens (the
 * parser's template eff.t70.thenIf.counters.removeTransformTokens builds exactly this shape). The list of three instructions is written with the serial comma
 * and "those counters" (the counters the condition counted); null for any other shape.
 */
function removeTransformCreate(s: StepOf<'if'>, st: RenderState): Clause | null {
  const c = s.cond;
  if (s.else !== undefined || s.then.length !== 3 || c.cond !== 'compare' || c.op !== '>=' || typeof c.left !== 'object' || c.left.q !== 'counters' || typeof c.right !== 'number') return null;
  const [rm, tf, mk] = s.then;
  if (rm?.op !== 'removeCounters' || rm.count !== 'all' || rm.upTo !== undefined || rm.kind !== c.left.kind || JSON.stringify(rm.from) !== JSON.stringify(c.left.on) || rm.guard !== undefined || rm.as !== undefined) return null;
  if (tf?.op !== 'changeFace' || tf.what.ref !== 'self' || tf.to !== 'transform' || tf.guard !== undefined || tf.as !== undefined) return null;
  if (mk?.op !== 'createToken' || mk.guard !== undefined) return null;
  const cond = K.cond(c, st);
  const create = K.steps([mk], st);
  return plain(`if ${cond}, remove those counters, transform ~, and ${create}`, { standalone: true, leadThen: true });
}

/**
 * std-lci (CR 122.1, 701.27a, 712.9, 608.2c): "Then if there are three or more bore counters on it, remove those counters and transform it." (Brass's Tunnel-Grinder)
 * is `if` the counters of a kind on an object reach N, then remove all of that kind from it and transform that object (the parser's template
 * eff.stdlci.thenIf.counters.removeTransform builds exactly this shape); "those counters" are the counters the condition counted. Null for any other shape.
 */
function removeTransform(s: StepOf<'if'>, st: RenderState): Clause | null {
  const c = s.cond;
  if (s.else !== undefined || s.then.length !== 2 || c.cond !== 'compare' || c.op !== '>=' || typeof c.left !== 'object' || c.left.q !== 'counters' || typeof c.right !== 'number') return null;
  const [rm, tf] = s.then;
  if (rm?.op !== 'removeCounters' || rm.count !== 'all' || rm.upTo !== undefined || rm.kind !== c.left.kind || JSON.stringify(rm.from) !== JSON.stringify(c.left.on) || rm.guard !== undefined || rm.as !== undefined) return null;
  if (tf?.op !== 'changeFace' || JSON.stringify(tf.what) !== JSON.stringify(c.left.on) || tf.to !== 'transform' || tf.guard !== undefined || tf.as !== undefined) return null;
  const cond = K.cond(c, st);
  return plain(`if ${cond}, remove those counters and transform it`, { standalone: true, leadThen: true });
}

export const CLAUSES_FLOW = {
  if: (s: StepOf<'if'>, st: RenderState): Clause => {
    const faceUp = returnFaceDownThenUp(s, st); // FAST5X E25
    if (faceUp !== null) {
      st.leadingIf = false;
      return faceUp;
    }
    const afterTrigger = st.leadingIf;
    const trio = afterTrigger ? null : removeTransformCreate(s, st) ?? removeTransform(s, st);
    if (trio !== null) return trio;
    st.leadingIf = false;
    const hasElse = s.else !== undefined && s.else.length > 0;
    // FAST5X E19 (CR 601.2h; opus): "then discard a card unless five or more mana was spent to cast that spell" (eff.e19.then.unless)
    const manaSpentCond = s.cond.cond === 'not' && s.cond.of.cond === 'compare' && typeof s.cond.of.left === 'object' && s.cond.of.left.q === 'spellManaSpent';
    // cloud std-dsk (CR 608.2c): "then discard a card unless you control another creature with power 2 or less" (eff.e19.then.unless with a control condition)
    const existsCond = s.cond.cond === 'not' && s.cond.of.cond === 'exists';
    if (!hasElse && s.cond.cond === 'not' && (s.cond.of.cond === 'wasCast' || turnHistory(s.cond.of) || manaSpentCond || existsCond)) {
      // M6-5 (CR 608.2c, 702.138b): "sacrifice it unless it escaped" is "if it didn't escape, sacrifice it": the instruction, then "unless" and the condition
      // it does not happen under. Only for a cast-history condition, the one family the parser builds this way (eff.m6.sacrifice.unlessEscaped)
      const negated = s.cond.of;
      const [usual, unless] = withVariants(st, [
        (v): string => { const c = K.cond(s.cond, v); const then = K.steps(s.then, v); return afterTrigger ? `${then} if ${c}` : `if ${c}, ${then}`; },
        (v): string => { const then = K.steps(s.then, v); return `${then} unless ${K.cond(negated, v)}`; },
      ]);
      return plain(alt(usual!, unless!), { standalone: true, ...(afterTrigger ? {} : { leadThen: true }) });
    }
    if (!hasElse) {
      const c = K.cond(s.cond, st);
      const outerIf = st.stepIf;
      st.stepIf = s.cond; // Cloud std-fin: "the difference" inside the branch (render/qty.ts#isDifference)
      const outerFocus = st.focus;
      // r4-moved: "If you discard a land card this way, put it ..." (the parser's rule); std-rx10 (the parser's std-r8 rule, parser/lower/anaphora.ts#condSubject, CR 608.2c):
      // "If the creature you control entered this turn, put a +1/+1 counter on it.": in the branch a bare pronoun is the one target the condition tests
      const condFocus = movedCondFocus(s.cond, st) ?? testedTarget(s.cond) ?? revealedCondFocus(s.cond, st); // p2-dig-2: revealedCondFocus
      if (condFocus !== undefined) st.focus = condFocus;
      let then: string;
      try {
        then = K.steps(s.then, st);
      } finally {
        if (outerIf === undefined) delete st.stepIf;
        else st.stepIf = outerIf;
        if (condFocus !== undefined) { if (outerFocus === undefined) delete st.focus; else st.focus = outerFocus; }
      }
      // CR 603.4: right after a trigger condition "if C, ..." is an intervening if, which has no else; an `if` step is written "..., if C" there
      if (afterTrigger) return plain(`${then} if ${c}`, { standalone: true });
      // FAST5X E1: "If the gift was promised, ~ also deals 3 damage to that creature's controller": "also" after the subject says only that the instruction
      // comes on top of the earlier ones (CR 608.2c); the parser builds it from the templates eff.fast5x.if.also.* only
      const also = withAlso(then);
      // FAST5X E11 (CR 608.2c, 702.194b): "If this spell was cast using teamwork, it also deals 2 damage to that creature's controller": right after a condition
      // about the spell's own cast, "it" is the spell (~); only for a damage step from ~ (the parser's template eff.e11.if.it.also.damage builds exactly this)
      const itAlso = also !== null && isCastChoice(s.cond) && s.then.length === 1 && s.then[0]!.op === 'damage' && (s.then[0] as StepOf<'damage'>).source.ref === 'self' && also.startsWith('~ also deals ')
        ? `it ${also.slice(2)}` : null;
      // FAST5X E26 (CR 702.75a, 608.2c): hideaway's "you may play the exiled card without paying its mana cost if C" says the condition after the instruction
      // (the parser's template eff.e26.hideaway.play.free.if builds exactly this: one `cast` step with `play`)
      if (also === null && s.then.length === 1 && s.then[0]!.op === 'cast' && (s.then[0] as StepOf<'cast'>).play === true) {
        return plain(alt(`if ${c}, ${then}`, `${then} if ${c}`), { standalone: true, leadThen: true });
      }
      // cloud std-dsk (CR 104.2b, 104.3e, 608.2c): "you win the game if there are eight or more different names among ...": the condition after the instruction
      // (the parser's templates eff.stddsk.winGame.if / loseGame.if build exactly this: one `winGame` / `loseGame` step)
      // std-rj (CR 119.3, 608.2c): "You lose life equal to that card's mana value if this creature isn't saddled" (the template eff.stdrj.loselife.equal.if): one `loseLife` step
      if (also === null && s.then.length === 1 && (s.then[0]!.op === 'winGame' || s.then[0]!.op === 'loseGame' || s.then[0]!.op === 'loseLife')) {
        return plain(alt(`if ${c}, ${then}`, `${then} if ${c}`), { standalone: true, leadThen: true });
      }
      // std-rj (CR 118.9, 202.3, 601.2; Solstice Revelations): "You may cast that card without paying its mana cost if the spell's mana value is less than N": the condition
      // after the one optional free cast, on the mana value of the very card cast (the parser's template eff.stdrj.cast.free.ifSpellMvLess builds exactly this)
      if (also === null && castFreeIfMvLess(s)) {
        const right = (s.cond as Extract<typeof s.cond, { cond: 'compare' }>).right;
        return plain(alt(`if ${c}, ${then}`, `${then} if the spell's mana value is less than ${typeof right === 'number' ? String(right) : K.qty(right, st)}`), { standalone: true, leadThen: true });
      }
      // std-ru (CR 608.2c, 110.2): "You may put it onto the battlefield if it's your turn.": your option to put one object onto the battlefield, offered only while the
      // condition holds, with the condition after the instruction (the parser's template eff.stdru.may.put.bf.ifCond builds exactly this: one `may` of yours around one move)
      if (mayPutOntoBattlefield(s.then)) return plain(alt(`if ${c}, ${then}`, `${then} if ${c}`), { standalone: true, leadThen: true });
      // std-rx31 (CR 608.2c; family otherwise-after-cast): after "You may cast that card ...", "Otherwise, put it into your hand" says "If you don't, ...": the cast
      // offered right before was not made (the parser's fold of the rider fl.otherwise after an optional cast, parser/lower/riders.ts)
      const didCond = s.cond.cond === 'did' ? s.cond : null;
      const castInfo = didCond !== null ? st.info.get(`r:${didCond.step}`)?.castOption : undefined;
      const otherwise = also === null && didCond !== null && didCond.not === true && didCond.which === undefined && didCond.to === undefined && castInfo !== undefined;
      const inIf = otherwise && castInfo === 'inIf';
      const alsoOther = alsoLead(then);
      // ... and "Put the exiled card into your hand if it wasn't cast this way" (the parser's eff.stdrx31.put.hand.ifNotCastThisWay), the condition after the instruction
      if (otherwise) {
        return plain(alt(`if ${c}, ${then}`, ...(alsoOther !== null ? [`if ${c}, ${alsoOther}`] : []), ...(inIf ? [] : [`otherwise, ${then}`]), `${then} if it wasn't cast this way`, `${then} if it was not cast this way`),
          { standalone: true, leadThen: true });
      }
      // std-rB (CR 608.2c; family if-also-imperative): "If this spell was cast from a graveyard, also put a +1/+1 counter on each other creature you control":
      // "also" in front of an instruction with no subject, on top of the earlier ones (the parser's eff.stdrb.if.also); only a plain instruction that opens with its verb
      const alsoThen = alsoLead(then);
      const leadAlso = alsoThen !== null ? `if ${c}, ${alsoThen}` : null;
      if (also === null && leadAlso !== null) return plain(alt(`if ${c}, ${then}`, leadAlso), { standalone: true, leadThen: true });
      return plain(also === null ? `if ${c}, ${then}` : alt(`if ${c}, ${then}`, `if ${c}, ${also}`, ...(itAlso !== null ? [`if ${c}, ${itAlso}`] : [])), { standalone: true, leadThen: true });
    }
    // "If C, X. Otherwise, Y." or the self-replacement of CR 614.15, "Y. If C, X instead." (the else branch is the instruction "instead" replaces; WP23).
    // The "instead" reading is offered only when X replaces Y as a whole: one instruction each, the same op on the same things (WP23 review: "you may X
    // instead" keeps Y when declined, a subset of a group keeps the rest, CR 608.2d, 614.15)
    // FAST5X E1: with a condition decided as the spell is cast, one instruction may replace another as a whole (render/self-replacement.ts#isCastChoice), and
    // Oracle also writes "If the gift was promised, instead counter target spell" (the parser's rider rid.fast5x.instead.front)
    const castChoice = isCastChoice(s.cond);
    // the text says the replaced instruction happens only when the condition does not hold: its targets' `onlyIf` (parser/lower/riders.ts) is in the words
    // CLOUD C9 (CR 608.2c, 614.15): also another instruction on the same objects, a search by a search, several instructions on the same objects, and a whole
    // sentence of several instructions restated instruction for instruction (render/self-replacement.ts#notWideReplacement, the parser's fold in riders.ts)
    const wide = isWideReplacement(s.then, s.else!, s.cond);
    if (castChoice && wide) st.conds.add(JSON.stringify({ cond: 'not', of: s.cond }));
    // FAST5X E19: the mana spent to cast the triggering spell is fixed before the ability triggers (opus; render/self-replacement.ts#isFixedChoice)
    const anyOne = castChoice || (s.then.length === 1 && s.else!.length === 1 && isFixedChoice(s.cond, s.else![0], s.then[0]));
    // r4-repl (CR 614.15, 608.2c): "..., reveal it, and put it into your hand. If C, put that card onto the battlefield instead." (the parser's fold of an "instead"
    // that replaces the only move of a list of instructions, lower/riders.ts#movesTheOnlyMoved): the replaced move joined to the instruction before it, rendered
    // from the same state as the other readings (the last variant, taken out of them below)
    const joinedFn = wide && replacedLastMove(s) ? [(v: RenderState): string => `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, ${K.steps(s.then, v)} instead`] : [];
    const thatMuch = s.then.length === 1 ? sameAmountElse(s) : null;
    const forms = withVariants(st, [
      (v): string => `if ${K.cond(s.cond, v)}, ${K.steps(s.then, v)}. Otherwise, ${K.steps(s.else!, v)}`,
      // CLOUD std-msh (CR 608.2c): "Create a tapped 2/1 Villain token if there are two or more creature cards in your graveyard. Otherwise, mill two cards.": the
      // condition said after its one instruction (parser/lower/riders.ts builds this from a guarded instruction and the rider fl.otherwise)
      ...(s.then.length === 1 ? [(v: RenderState): string => `${K.steps(s.then, v)} if ${K.cond(s.cond, v)}. Otherwise, ${K.steps(s.else!, v)}`] : []),
      // std-rj (CR 119.3, 608.2h): "You lose life equal to that card's mana value if C. Otherwise, each opponent loses that much life.": the instruction of the other branch is
      // the same life amount, which Oracle says once and then calls "that much" (the parser's rule for "that much" in an `else`, lower/quantities.ts#elseSameLifeAmount)
      ...(thatMuch !== null ? [(v: RenderState): string => `${K.steps(s.then, v)} if ${K.cond(s.cond, v)}. Otherwise, ${K.steps([thatMuch], v)}`] : []),
      ...(wide ? [(v: RenderState): string => {
        const other = K.steps(s.else!, v);
        return `${other}. If ${K.cond(s.cond, v)}, ${K.steps(s.then, v)} instead`;
      }] : []),
      ...(wide ? [(v: RenderState): string => {
        const other = K.steps(s.else!, v);
        return `${other}. If ${K.cond(s.cond, v)}, instead ${K.steps(s.then, v)}`;
      }] : []),
      // M6-5 (CR 614.15): "~ deals 2 damage to any target. If ~ was kicked, it deals 4 damage instead": the same source and recipients, only another amount,
      // so Oracle names neither again (parser rider rid.m6.instead.damage builds exactly this shape)
      ...(isSelfReplacement(s.then, s.else!) && sameDamageButAmount(s.then[0], s.else![0]) ? ['it', '~'].map((who) => (v: RenderState): string => {
        const other = K.steps(s.else!, v);
        const amount = (s.then[0] as StepOf<'damage'>).amount;
        return `${other}. If ${K.cond(s.cond, v)}, ${who} deals ${typeof amount === 'number' ? String(amount) : K.qty(amount, v)} damage instead`;
      }) : []),
      // FAST5X E11 (CR 614.15, 702.194b): "~ deals 2 damage to target creature. If ~ was cast using teamwork, it deals 4 damage to that creature instead": the same
      // source and recipient named again (the parser's rider rid.e11.if.damage.that.instead builds exactly this shape)
      ...(isSelfReplacement(s.then, s.else!) && sameDamageButAmount(s.then[0], s.else![0]) ? ['it', '~'].map((who) => (v: RenderState): string => {
        const other = K.steps(s.else!, v);
        const c = K.cond(s.cond, v);
        const x = K.steps(s.then, v);
        return x.startsWith('~ deals ') ? `${other}. If ${c}, ${who} ${x.slice(2)} instead` : `${other}. If ${c}, ${x} instead`;
      }) : []),
      // r4-repl (CR 614.15, 111.1): "Create a token that's a copy of target creature. If C, create five of those tokens instead." / "If C, instead create X of those
      // tokens, where X is ..." (the parser's riders rid.r4repl.instead.copies.count, rid.r4repl.instead.tokens.count, rid.r4repl.insteadFirst.tokens.whereX)
      ...(wide && thoseTokensCount(s.then, s.else!, st) !== null ? [(v: RenderState): string => {
        const n = thoseTokensCount(s.then, s.else!, v)!;
        const head = n.startsWith('X of those tokens, ') ? n : `${n} of those tokens`;
        return n.startsWith('X of those tokens, ') ? `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, instead create ${head}` : `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, create ${head} instead`;
      }] : []),
      // FAST5X E7 (CR 614.15, 702.190b): "Create three tokens. If ~'s sneak cost was paid, they enter tapped and attacking."
      ...(isSelfReplacement(s.then, s.else!, anyOne) && tokensEnterAttacking(s.then, s.else!) !== null ? [(v: RenderState): string =>
        `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, ${tokensEnterAttacking(s.then, s.else!)!} tapped and attacking`] : []),
      // FAST5X E2 (CR 614.15): the same self-replacement with the condition after "instead": "Target creature gets -2/-2 until end of turn. That creature gets
      // -5/-5 until end of turn instead if C." and "~ deals 2 damage to any target. ~ deals 3 damage instead if C." (parser riders rid.e2.instead.if and
      // rid.e2.instead.damage.if build exactly these shapes)
      ...(isSelfReplacement(s.then, s.else!) || (wide && s.then.length === 1) ? [(v: RenderState): string => {
        const other = K.steps(s.else!, v);
        return `${other}. ${K.steps(s.then, v)} instead if ${K.cond(s.cond, v)}`;
      }] : []),
      ...(isSelfReplacement(s.then, s.else!) && sameDamageButAmount(s.then[0], s.else![0]) ? ['it', '~'].map((who) => (v: RenderState): string => {
        const other = K.steps(s.else!, v);
        const amount = (s.then[0] as StepOf<'damage'>).amount;
        return `${other}. ${who} deals ${typeof amount === 'number' ? String(amount) : K.qty(amount, v)} damage instead if ${K.cond(s.cond, v)}`;
      }) : []),
      // FAST5X E9 (CR 614.15): "~ deals 2 damage to target creature. It deals 4 damage to that creature instead if C.": the recipient named again with "that"
      // is the same recipient (parser rider rid.e9.instead.damage.that.if builds `to` from the previous step)
      // Cloud r3-repl (CR 614.15, 120.3): "Target creature deals damage to itself equal to its power. If that creature has flying, it deals twice that much damage to
      // itself instead." (Cut Propulsion): the same damage of an object to itself, twice the amount (the parser's rider rid.r3repl.instead.damageItself.twice)
      // r4-repl (CR 614.15, 701.20e): "Put one of them into your hand and the rest ... Put each of those cards into your hand instead if C." (the template
      // eff.r4repl.dig.putEach.hand; render/self-replacement.ts#everyCardInstead)
      ...(s.then.length === 1 && everyCardInstead(s.else! as unknown as Record<string, unknown>[], s.then[0] as unknown as Record<string, unknown>) && JSON.stringify((s.then[0] as StepOf<'move'>).to) === JSON.stringify({ zone: 'hand' })
        ? [(v: RenderState): string => {
          const other = K.steps(s.else!, v);
          const group = ((s.then[0] as StepOf<'move'>).what as { filter: { is: ObjRef } }).filter.is;
          return `${other}. Put each of ${K.obj(group, v, 'object').text} into your hand instead if ${K.cond(s.cond, v)}`;
        }] : []),
      // r4-repl (CR 614.15, 613.4b): "If C, it has base power and toughness 1/1 until end of turn instead." (rid.r4repl.instead.basePT.only)
      ...(wide && basePtOnly(s.then, s.else!) !== null ? [(v: RenderState): string => `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, it has base power and toughness ${basePtOnly(s.then, s.else!)!} until end of turn instead`] : []),
      // r4-repl (CR 614.15, 406.1): "If C, exile the top three cards instead." (rid.r4repl.instead.exileTop.count)
      ...(wide && typeof exileTopCount(s.then, s.else!) === 'number' ? [(v: RenderState): string => `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, exile the top ${String(exileTopCount(s.then, s.else!))} cards instead`] : []),
      // r4-repl (CR 614.15, 120.3): "If C, the creature you control deals twice that much damage instead." (rid.r4repl.instead.sourceYouControl.twice)
      ...(wide && doubledTargetCreatureDamage(s.then, s.else!, st) ? [(v: RenderState): string => `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, the creature you control deals twice that much damage instead`] : []),
      ...(doubledSelfDamage(s.then, s.else!) ? [(v: RenderState): string => `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, it deals twice that much damage to itself instead`] : []),
      ...(isSelfReplacement(s.then, s.else!) && sameDamageButAmount(s.then[0], s.else![0]) ? ['it', '~'].flatMap((who) => ['creature', 'permanent'].map((noun) => (v: RenderState): string => {
        const other = K.steps(s.else!, v);
        const amount = (s.then[0] as StepOf<'damage'>).amount;
        return `${other}. ${who} deals ${typeof amount === 'number' ? String(amount) : K.qty(amount, v)} damage to that ${noun} instead if ${K.cond(s.cond, v)}`;
      })) : []),
      ...joinedFn,
    ]);
    const joined = joinedFn.length > 0 ? forms.pop() : undefined;
    // CLOUD C9 (CR 608.2c, 701.23a): a name both branches bind names what either finds; "reveal those cards" when one of them finds several (Aang's Journey)
    for (const name of new Set(s.then.map((x) => x.as).filter((n): n is string => typeof n === 'string' && s.else!.some((y) => y.as === n)))) {
      const info = st.info.get(`b:${name}`);
      if (info !== undefined && !info.plural && [...s.then, ...s.else!].some((x) => x.as === name && x.op === 'search' && (x.max !== 1 || x.and !== undefined))) st.info.set(`b:${name}`, { ...info, plural: true });
    }
    return plain(alt(...forms), { standalone: true, ...(joined !== undefined ? { joined } : {}) });
  },

  may: mayClause,
  pay: payClause,

  forEach: (s: StepOf<'forEach'>, st: RenderState): Clause => {
    // Cloud std-eoe (CR 115.1, 608.2e; parser/lower/anaphora.ts#perPlayerAmounts): "Any number of target players each mill half their library, rounded down": several
    // player targets, one at a time, each doing the one instruction with an amount of their own: the instruction said with the targets as its subject
    const each = perTargetPlayers(s, st);
    if (each !== null) return each;
    // FAST5X-4 (CR 702.179e, 120.3): "~ deals N damage to each player who doesn't have max speed": the damage to each player, guarded by that player's speed;
    // written from the state before the iteration player is named (the damage step with "each player" as its recipient), only for that exact body
    const eachWithout = withoutMaxSpeedDamage(s, st);
    // r4-fxb (CR 120.3, 608.2f): "it deals damage to each player equal to the number of nonbasic lands that player controls": the damage to each player, of an
    // amount counted for that player (the objects they control), only for that exact body
    const perPlayerCount = damageEqualToTheirCount(s, st);
    if (perPlayerCount !== null) return plain(perPlayerCount);
    const aboveBase = countersForPowerAboveBase(s, st);
    if (aboveBase !== null) return plain(aboveBase);
    const over = s.over;
    let thing: string;
    let lead = 'for each'; // FAST5 T39: "for each of those creatures" (a group named before; "them" or "those creatures")
    if (over.ref === 'each' && 'filter' in over) {
      thing = K.np(over.filter, st, { det: 'none', forEach: true }); // FAST5 T39: also "for each creature your opponents control" (NpOpts.forEach)
      bind(st, s.as, { nouns: K.nounsOf(over.filter), plural: false });
    } else if (over.ref === 'each' && 'who' in over && (over.who === 'opponent' || over.who === 'player')) {
      // "For each opponent, that player ..." (CR 608.2f; WP23): the players one at a time, each named "that player" in the body
      thing = over.who;
      bind(st, s.as, { nouns: over.who === 'opponent' ? ['player', 'opponent'] : ['player'], plural: false, player: true, iterates: over.who });
    } else if (over.ref === 'bound' && st.info.get(`b:${over.name}`)?.cant !== undefined) {
      // C6 (CR 101.3, 608.2f): "For each opponent who can't, you draw a card": the players of a group who couldn't do what a step told them (render/steps-util.ts#bindCant)
      const cant = st.info.get(`b:${over.name}`)!.cant!;
      thing = `${cant} who can't`;
      bind(st, s.as, { nouns: cant === 'opponent' ? ['player', 'opponent'] : ['player'], plural: false, player: true });
    } else if (over.ref === 'bound' && st.info.get(`b:${over.name}`)?.thisWay === 'destroyed this way' && st.info.get(`b:${over.name}`)!.nouns.length > 0) {
      // std-rx30 (CR 608.2c, 608.2f): "For each land destroyed this way, its controller may search ...": each object an earlier destroy of the ability destroyed, as it
      // last existed (render/fold.ts#forEachPlayerDestroyUpToOne)
      const nouns = st.info.get(`b:${over.name}`)!.nouns;
      thing = `${nouns[0]} destroyed this way`;
      bind(st, s.as, { nouns, plural: false });
    } else {
      const named = K.obj(over as never, st, 'object');
      thing = named.text;
      if (named.plural) lead = 'for each of';
      // FAST5 T64 (CR 608.2f): each one of "X target permanents" is also "that permanent" in the body ("create X tokens that are copies of that permanent")
      const key = objKey(over as never);
      const known = key !== null ? st.info.get(key) : undefined;
      bind(st, s.as, { nouns: known !== undefined && known.nouns.length > 0 && known.plural ? [...new Set([...known.nouns, ...(known.nouns.some((n) => PERMANENT_NOUNS.has(n)) ? ['permanent'] : [])])] : ['object'], plural: false });
    }
    // r4-moved (CR 608.2c, 608.2f, 701.9a; parser/holes/moved.ts#notMoved): "For each opponent who didn't discard two nonland cards this way, you draw a card."
    const didnt = didntDiscardEach(s, st);
    if (didnt !== null) return didnt;
    // r5-moved (CR 608.2c, 608.2f, 608.2h; parser/holes/moved.ts#controlledMoved): "For each opponent who controlled a creature returned this way, you create ..."
    const controlled = controlledReturnedEach(s, st);
    if (controlled !== null) return controlled;
    const punisher = eachUnlessThey(s, st); // std-mkm: before the body binds "that player" in `st`
    const body = K.steps(s.do, st);
    // std-rx32 (CR 608.2f): what every iteration bound under `gather` is several objects after the loop ("those tokens")
    const gathered = s.gather !== undefined ? st.info.get(`b:${s.gather}`) : undefined;
    if (gathered !== undefined) bind(st, s.gather, { ...gathered, plural: true });
    if (punisher !== null) return plain(alt(punisher, `for each ${thing}, ${body}`), { standalone: true }); // the group as the subject first (the display)
    if (eachWithout !== null) return plain(alt(`for each ${thing}, ${body}`, eachWithout), { standalone: true });
    // FAST4 T34 (CR 119.3, 608.2f): "each opponent loses life equal to the life they lost this turn": each player loses the life they themselves lost (one
    // at a time, which changes no other player's amount); only that exact body
    const [only] = s.do;
    const self = { ref: 'bound', name: s.as };
    if (over.ref === 'each' && 'who' in over && (over.who === 'opponent' || over.who === 'player') && s.do.length === 1 && only?.op === 'loseLife' && only.guard === undefined && only.as === undefined
      && JSON.stringify(only.who) === JSON.stringify(self) && JSON.stringify(only.amount) === JSON.stringify({ q: 'lifeLostThisTurn', of: self })) {
      return plain(alt(`for each ${thing}, ${body}`, `each ${thing} loses life equal to the life ${alt('they', 'that player')} lost this turn`), { standalone: true });
    }
    // Standard round 4, r4-trig (CR 119.3, 107.1a, 608.2f; Betor, Kin to All): "each opponent loses half their life, rounded up": each player loses half of their own life
    // (one at a time, which changes no other player's amount); only that exact body, a reading of the group above (family half-of-own)
    if (over.ref === 'each' && 'who' in over && over.who === 'opponent' && s.do.length === 1 && only?.op === 'loseLife' && only.guard === undefined && only.as === undefined
      && JSON.stringify(only.who) === JSON.stringify(self) && JSON.stringify(only.amount) === JSON.stringify({ q: 'math', op: 'ceilDiv', args: [{ q: 'life', of: self }, 2] })) {
      return plain(`each ${thing} loses half their life, rounded up`, { standalone: true });
    }
    // CLOUD std-dft (CR 701.17a, 608.2f): "any number of target players each mill cards equal to the number of cards in their graveyard": each of the target players
    // mills as many cards as their own graveyard holds (one at a time, which changes no other player's number); only that exact body
    if (over.ref === 'target' && s.do.length === 1 && only?.op === 'mill' && only.guard === undefined && only.as === undefined
      && JSON.stringify(only.who) === JSON.stringify(self) && JSON.stringify(only.count) === JSON.stringify({ q: 'zoneSize', zone: 'graveyard', of: self })) {
      return plain(`${thing} each mill cards equal to the number of cards in their graveyard`, { standalone: true });
    }
    return plain(`${lead} ${thing}, ${body}`, { standalone: true, leadThen: true }); // FAST5 T39: "Then for each Rat you control, create ..."
  },

  repeat: (s: StepOf<'repeat'>, st: RenderState): Clause => {
    const countPartsOf = (q: Exclude<typeof s.times, number>, at: RenderState): { singular: string } | null => {
      try { return countParts(q, at); } catch (e) { if (e instanceof NoRenderer) return null; throw e; }
    };
    const n = typeof s.times === 'number' ? (s.times === 1 ? 'once' : s.times === 2 ? 'twice' : `${numWord(s.times)} times`) : `${K.qty(s.times, st)} times`;
    // r4-mech (CR 608.2c): "repeat this process once": the body is the instructions before it (model/lint-flow.ts checks that it is their copy); merge wave 6:
    // r3-refs's "repeat this process X more times" is the same process repeat, X times
    // std-cardcopy-1 (CR 608.2c): "If C, draw a card and repeat this process.": no count, said with the instructions of its condition (joined by "and")
    if (s.process === true && s.again === true) return plain('repeat this process');
    if (s.process === true) {
      const more = typeof s.times === 'number' ? (s.times === 1 ? 'once' : `${numWord(s.times)} more times`) : `${K.qty(s.times, st)} more times`;
      return plain(`repeat this process ${more}`, { standalone: true });
    }
    const body = K.steps(s.do, st);
    // r5-fxz (CR 608.2c): "for each card you put on top of your library, you draw a card and you lose 3 life": the steps once for each thing counted
    // r5-fxz (CR 701.9a, 608.2c): "for each of those opponents who didn't discard a card with mana value 4 or greater, draw a card" (a player count, `didNot`)
    const t = s.times;
    if (typeof t === 'object' && t.q === 'countPlayers' && t.didNot !== undefined && Object.keys(t).length === 3) {
      const said = K.player(t.of, st, 'object').text;
      // the target players of "any number of target opponents" are "those opponents" (CR 102.3, 115.1)
      const spec = t.of.ref === 'target' ? st.specs.get(t.of.id) : undefined;
      const who = spec?.players?.who === 'opponent' ? alt(said, 'those opponents') : said;
      const what = K.np({ ...t.didNot.which, zone: 'hand' }, st, { det: 'a', noZone: true }); // a discarded card: a card in a hand (the zone is not printed)
      return plain(`for each of ${who} who ${alt("didn't", 'did not')} discard ${what}, ${body}`, { standalone: true, leadThen: true });
    }
    const each = typeof s.times === 'object' ? countPartsOf(s.times, st) : null;
    if (each !== null) return plain(alt(`do the following ${n}: ${body}`, `repeat the following process ${n}: ${body}`, `for each ${each.singular}, ${body}`), { standalone: true, leadThen: true });
    return plain(alt(`do the following ${n}: ${body}`, `repeat the following process ${n}: ${body}`), { standalone: true });
  },

  let: (s: StepOf<'let'>, st: RenderState): Clause => {
    st.vars.set(s.name, { phrase: K.qty(s.value, st), used: false });
    return EMPTY_CLAUSE;
  },

  chooseObjects: (s: StepOf<'chooseObjects'>, st: RenderState): Clause => {
    const { min, max } = s;
    const from = s.from;
    // FAST5 T46 (CR 701.20a, 701.20e, 608.2d): "You choose a nonland card from it", out of a hand an earlier step revealed or looked at
    const inHand = handChoiceFromIt(s, st);
    if (inHand !== null) {
      bind(st, s.as, { nouns: ['card'], plural: false, optional: min === 0 });
      return min === 0 ? modal(s.who, st, `may choose ${inHand}`) : byPlayer(s.who, st, 'choose', inHand);
    }
    // C6 (CR 608.2c, 101.4): "for each player, choose a creature with power 2 or less that player controls": one choice for each player, the objects read with that
    // player as `{ref:'iterating'}` ("that player controls"); what was chosen is "chosen this way" or "those creatures" later
    if (s.perPlayer !== undefined) {
      const per = s.perPlayer;
      if (per.ref !== 'each' || (per.who !== 'player' && per.who !== 'opponent') || from.ref !== 'each' || min !== 1 || max !== 1 || s.random || s.groupLimit !== undefined || s.who.ref !== 'you') {
        throw new NoRenderer('a choice for each player other than "for each player / opponent, choose a <thing> that player controls"');
      }
      const what = K.np(from.filter, st, { det: 'a' });
      bind(st, s.as, { nouns: K.nounsOf(from.filter), plural: true, thisWay: 'chosen this way', alts: ['the chosen permanents'] });
      return plain(alt(`for each ${per.who}, choose ${what}`, `for each ${per.who}, you choose ${what}`)); // r3-refs: "For each player, you choose a creature that player controls" (Winnowing)
    }
    // std-rx30 (CR 101.4, 608.2d): "Starting with you, each player chooses up to one permanent with mana value 3 or greater from among permanents your opponents control":
    // each player in turn, every object chosen named later as a group ("those permanents")
    if (s.startingWith !== undefined) {
      const one = from.ref === 'each' && from.filter.anyOf?.length === 1 && Object.keys(from.filter).filter((k) => (from.filter as Record<string, unknown>)[k] !== undefined).sort().join() === 'anyOf,controller'
        && from.filter.controller === 'opponent' ? from.filter.anyOf[0]! : undefined;
      if (one === undefined || s.startingWith.ref !== 'you' || s.who.ref !== 'each' || s.who.who !== 'player' || min !== 0 || typeof max !== 'number' || s.random || s.groupLimit !== undefined) {
        throw new NoRenderer('a choice of each player in turn other than "starting with you, each player chooses up to N <things> from among permanents your opponents control"');
      }
      bind(st, s.as, { nouns: [...new Set([...K.nounsOf(one), 'permanent'])], plural: true, thisWay: 'chosen this way' });
      return plain(`starting with you, each player chooses up to ${numWord(max)} ${K.np(one, st, { det: 'none', plural: max !== 1 })} from among permanents your opponents control`);
    }
    // std-cardcopy-5 (CR 608.2c, 608.2d; eff.stdcardcopy5.mayChoose.fromAmong): "you may choose a creature card from among them": up to one object of a description
    // among a group a reference names (the objects of a "one or more" trigger event), in any zone; what was chosen is "it" later
    const amongKeys = from.ref === 'each' ? Object.keys(from.filter).filter((k) => (from.filter as Record<string, unknown>)[k] !== undefined).sort().join() : '';
    if (from.ref === 'each' && amongKeys === 'anyOf,is,zone' && from.filter.zone === 'any' && from.filter.anyOf?.length === 1 && from.filter.is !== undefined && from.filter.is.ref !== 'bound'
      && min === 0 && max === 1 && s.who.ref === 'you' && s.random !== true && s.groupLimit === undefined) {
      const desc = from.filter.anyOf[0]!;
      const among = K.obj(from.filter.is, st, 'object');
      if (among.plural) {
        const card = { ...desc, zone: 'exile' as const }; // a card, said without its zone ("a creature card")
        bind(st, s.as, { nouns: [...new Set([...K.nounsOf(card), 'card'])], plural: false, optional: true });
        return modal(s.who, st, `may choose ${K.np(card, st, { det: 'a', noZone: true })} from among ${among.text}`);
      }
    }
    let what: string;
    let nouns: string[] = ['object'];
    let plural = !(max === 1);
    // CLOUD std-msh (CR 608.2c): "You choose one of them" (Klaw, Sonic Subjugator): one of a group an earlier step named, nothing else said about it
    const seenGroup = from.ref === 'each' && Object.keys(from.filter).filter((k) => (from.filter as Record<string, unknown>)[k] !== undefined).sort().join() === 'is,zone'
      && from.filter.zone === 'any' && from.filter.is?.ref === 'bound' ? from.filter.is : undefined;
    if (seenGroup !== undefined && min === 1 && max === 1 && s.random !== true) {
      const f = K.obj(seenGroup, st, 'object');
      if (f.plural) {
        bind(st, s.as, { nouns: st.info.get(`b:${(seenGroup as { name: string }).name}`)?.nouns ?? ['card'], plural: false, optional: false });
        // r5-dig (CR 608.2c, 608.2d): your choice is also the elliptical "Choose one." right after the group ("Exile the top three cards of your library. Choose one. You
        // may play that card this turn.", Chandra, Flameshaper): one of the cards just named, the only group the sentence can mean
        return byPlayer(s.who, st, 'choose', s.who.ref === 'you' ? alt(`one of ${f.text}`, 'one') : `one of ${f.text}`);
      }
    }
    // CLOUD std-ecl: a choice among the objects of a named group, written as the group itself or as "each object that is one of them", is "one of them"
    const isRef = from.ref === 'each' && Object.keys(from.filter).length === 1 ? from.filter.is : undefined;
    const group = isRef !== undefined && isRef.ref === 'bound' ? isRef : null;
    if (group !== null) {
      what = `${typeof max === 'number' ? (max === 1 ? 'one' : numWord(max)) : 'any number'} of ${K.obj(group, st, 'object').text}`;
      plural = max !== 1;
      nouns = st.info.get(`b:${group.name}`)?.nouns ?? nouns;
    } else if (from.ref === 'each') {
      nouns = K.nounsOf(from.filter);
      const rw = rangeWords(min, max, st);
      plural = rw.plural;
      what = rw.count === undefined ? K.np(from.filter, st, { det: 'a' }) : K.np(from.filter, st, { det: 'none', plural: rw.plural, count: rw.count });
      // std-rx29 (CR 608.2c, 107.1; Spry and Mighty): a choice of a fixed number of two or more objects is also "choose exactly two creatures you control"; what was
      // chosen is also "the chosen creatures" later (the same choice: as many as there are, up to that number, CR 609.3)
      if (typeof min === 'number' && min === max && min >= 2 && s.random !== true && s.groupLimit === undefined) {
        what = alt(what, `exactly ${what}`);
        bind(st, s.as, { nouns, plural, optional: false, alts: nouns.map((n) => `the chosen ${pluralize(n)}`) });
        return byPlayer(s.who, st, 'choose', what);
      }
    } else {
      const f = K.obj(from, st, 'object').text;
      what = `${typeof max === 'number' ? (max === 1 ? 'one' : numWord(max)) : 'any number'} of ${f}`;
      plural = max !== 1;
      // CLOUD std-ecl (CR 608.2c): what is chosen out of a named group is of that group's kind: "Choose one of them. ... you may play that card"
      if (from.ref === 'bound') nouns = st.info.get(`b:${from.name}`)?.nouns ?? nouns;
    }
    // std-control-1 (CR 608.2c; the parser's participle "chosen", lower/mentions.ts): one object chosen out of a description is also "the chosen <noun>" later
    // ("Choose a creature an opponent controls. Until end of turn, creatures other than ~ and the chosen creature get -2/-2.")
    const chosenAlts = from.ref === 'each' && !plural && s.random !== true ? nouns.map((n) => `the chosen ${n}`) : [];
    // p2-modal-1 (CR 208.1, 608.2d): "choose any number of creatures with different powers": no two chosen objects share the value (std-library-1's `distinct`), said
    // after the description; only for a choice out of a description (a group or reference says it nowhere)
    if (s.distinct !== undefined) {
      const words = ({ power: 'powers', toughness: 'toughnesses', manaValue: 'mana values' } as const)[s.distinct];
      if (from.ref !== 'each' || group !== null || !plural || s.random === true || s.groupLimit !== undefined) throw new NoRenderer('a choice of objects with different values other than out of a description');
      what = `${what} with different ${words}`;
    }
    bind(st, s.as, { nouns, plural, optional: min === 0, ...(chosenAlts.length > 0 ? { alts: chosenAlts } : {}) });
    return byPlayer(s.who, st, 'choose', `${what}${s.random ? ' at random' : ''}`);
  },

  chooseValue: (s: StepOf<'chooseValue'>, st: RenderState): Clause => {
    let thing = CHOICE[s.what];
    if (s.what === 'option' && s.options) thing = `one of ${s.options.join(', ')}`;
    // std-rD (CR 608.2d, 205.2a): a card type out of the listed ones, said as Oracle lists them ("choose artifact or enchantment", "choose artifact, creature, or land")
    if (s.what === 'cardType' && s.options !== undefined && s.options.length >= 2) thing = joinList(s.options.map((o) => o.toLowerCase()), 'or');
    if (s.what === 'number' && s.min !== undefined && s.max !== undefined) thing = `a number between ${K.qty(s.min, st)} and ${K.qty(s.max, st)}`;
    if (s.cardKind !== undefined) thing = `a ${s.cardKind} card name`; // std-rx28 (CR 201.3): "choose a land card name" (Petrified Hamlet)
    // Cloud std-woe (CR 608.2d): "choose another player" (the controller is not offered, effects/handlers/choose.ts#excludedPlayers); the chosen player is "that player"
    const players = s.what === 'player' || s.what === 'opponent';
    if (players && s.exclude !== undefined) {
      if (s.what !== 'player' || JSON.stringify(s.exclude) !== '["you"]') throw new NoRenderer('a player choice that excludes other players');
      thing = 'another player';
    }
    bind(st, s.as, players ? { nouns: s.what === 'opponent' ? ['player', 'opponent'] : ['player'], plural: false, player: true } : { nouns: [s.what === 'creatureType' ? 'creature type' : s.what], plural: false });
    // std-combat-5 (CR 608.2d, 205.3m): "secretly choose Human, Merfolk, or Goblin": a creature type out of the listed ones, known to the chooser only until revealed
    if (s.secret === true) {
      if (s.what !== 'creatureType' || s.options === undefined || s.options.length < 2 || s.who.ref !== 'you') throw new NoRenderer('a secret choice other than "secretly choose <creature types>" by you');
      return byPlayer(s.who, st, 'secretly choose', joinList(s.options.map((o) => o.toLowerCase()), 'or'));
    }
    return byPlayer(s.who, st, 'choose', thing);
  },

  manual: (s: StepOf<'manual'>): Clause => {
    const text = s.text.replace(/\.\s*$/, '');
    // Cloud std-woe: "... Then shuffle." after it: the sentence after a manual step (standalone) may begin with "Then" (render/steps.ts#joined, std-mkm's rule, CR 608.2c)
    return plain(text, { standalone: true });
  },
};

/**
 * std-rx29 (CR 608.2f, 208.1, 613.4, 122.1; parser template eff.stdrx29.forEach.powerAboveBase.counters.difference, Sovereign Okinec Ahau): "for each creature you
 * control with power greater than that creature's base power, put a number of +1/+1 counters on that creature equal to the difference": the permanents whose power
 * is above their base power one at a time, each getting as many counters as its power exceeds its base power. Only that exact body; null otherwise.
 */
function countersForPowerAboveBase(s: StepOf<'forEach'>, st: RenderState): string | null {
  const over = s.over;
  if (over.ref !== 'each' || !('filter' in over) || over.filter.powerGreaterThanBase !== true || s.do.length !== 1) return null;
  const put = s.do[0]!;
  const me = JSON.stringify({ ref: 'bound', name: s.as });
  if (put.op !== 'putCounters' || put.guard !== undefined || put.as !== undefined || JSON.stringify(put.on) !== me) return null;
  const c = put.count;
  const want = { q: 'math', op: '-', args: [{ q: 'stat', stat: 'power', of: { ref: 'bound', name: s.as } }, { q: 'basePower', of: { ref: 'bound', name: s.as } }] };
  if (JSON.stringify(c) !== JSON.stringify(want)) return null;
  const { powerGreaterThanBase: _, ...rest } = over.filter;
  const f = Object.keys(rest).length === 1 && rest.anyOf?.length === 1 ? rest.anyOf[0]! : rest;
  const thing = K.np(f, st, { det: 'none', forEach: true });
  return `for each ${thing} with power greater than that creature's base power, put a number of ${pluralize(`${put.kind} counter`)} on that creature equal to the difference`;
}

/** std-rx10: the key of the one target a `matches` condition tests ("if the creature you control entered this turn"), or undefined. */
function testedTarget(cond: Condition): string | undefined {
  if (cond.cond !== 'matches') return undefined;
  const o = cond.object as { ref?: string; id?: string } | undefined;
  return o !== undefined && o.ref === 'target' && typeof o.id === 'string' ? `t:${o.id}` : undefined;
}
