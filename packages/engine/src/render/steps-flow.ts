/**
 * Control-flow steps (WP2): if, may, pay, forEach, repeat, let, chooseObjects, chooseValue, manual (design 2.3, CR 608.2, 118.12).
 */
import type { ChoiceKind, Condition, CostDef, EffectStep, ObjRef, Quantity } from '../types/ability';
import { acting, EMPTY_CLAUSE, plain, within, type Clause } from './clause';
import { K } from './kernel';
import { FRIEND_OR_FOE, rangeWords } from './refs';
import { everyCardInstead, isCastChoice, isFixedChoice, isSelfReplacement, isWideReplacement, keywordChoiceGrant, sameGrantTarget } from './self-replacement';
import { byPlayer, bind, handChoiceFromIt, markX, modal, movedCondFocus, revealedCondFocus, type StepOf } from './steps-util';
import { copyNewTargets, counterTail, noRegeneration, tokenText } from './steps-zones';
import { countParts } from './qty';
import { notSelfReplacement } from './self-replacement';
import { cloneState, objKey, playerKey, withVariants, type RenderState } from './state';
import { ALT_CLOSE, ALT_OPEN, ALT_SEP, alt, firstAlt, joinList, NoRenderer, numWord, parseMarked, pluralize, type MarkedNode, type Person } from './text';

/** "creature exiled this way", "permanent put into a graveyard this way": the group an earlier instruction moved, by each noun it recorded. */
function nounsThisWay(info: { nouns: readonly string[]; thisWay?: string }, also: readonly string[] = []): string {
  return alt(...info.nouns.filter((n) => n !== 'card' && n !== 'object').flatMap((n) => [info.thisWay!, ...also].map((w) => `${n} ${w}`)));
}

/** edh-zones-22: the name a "for each <thing> put into a graveyard this way" iterates over, when a destroy bound it and recorded a noun besides "card" (render/steps-zones.ts#destroyedOne); else undefined. */
function putBoundName(over: { ref: string }, st: RenderState): string | undefined {
  const o = over as { ref: string; name?: string; filter?: { is?: { ref: string; name?: string }; zone?: string } & Record<string, unknown> };
  const name = o.ref === 'bound' ? o.name : o.ref === 'each' && o.filter?.is?.ref === 'bound' && o.filter.zone === 'graveyard' && Object.keys(o.filter).filter((k) => o.filter![k] !== undefined && k !== 'is' && k !== 'zone').length === 0 ? o.filter.is.name : undefined;
  const info = name === undefined ? undefined : st.info.get(`b:${name}`);
  return info?.thisWay === 'put into a graveyard this way' && info.nouns.some((n) => n !== 'card' && n !== 'object') ? name : undefined;
}

/** edh-players-13: the link of a choice among words that mean nothing of their own ("Each opponent chooses fame or fortune."; parser/templates/zz-cloud/edh-players-13.json writes the same word). */
export const NAMED_OPTION_LINK = 'namedOption';

const CHOICE: Record<ChoiceKind, string> = {
  color: 'a color',
  creatureType: 'a creature type',
  cardType: 'a card type',
  landType: 'a basic land type',
  planeswalkerType: 'a planeswalker type', // edh-d-94 (CR 205.3j)
  cardName: 'a card name',
  number: 'a number',
  player: 'a player',
  opponent: 'an opponent',
  option: 'one',
  oddEven: 'odd or even',
  landOrNonland: 'land or nonland',
  lifeTotal: 'your life total', // edh-next-144: said by chooseValue below
  manaTypeSpent: 'the type of mana spent', // edh-mana-keywords-12: said by chooseValue below
};
/** edh-next-144: the link of "note your life total", read as "the last noted life total for ~" (render/qty.ts). */
const NOTED_LIFE_LINK = 'notedLife';

/** FAST5 T64: the nouns of a group of permanents that are also "permanent" ("for each of two target artifacts, ... that permanent"). */
const PERMANENT_NOUNS: ReadonlySet<string> = new Set(['artifact', 'creature', 'enchantment', 'land', 'planeswalker', 'battle']);

/** "you do" / "you don't" / "that player does" for the player `key` (the actor of a may or pay). */
function didText(key: string | null, who: Parameters<typeof K.player>[0], st: RenderState, negative: boolean): string {
  if (key === 'you' || key === null) return negative ? alt("you don't", 'you did not') : alt('you do', 'you did', 'you pay'); // edh-d-34: "If you pay," (Lightning Runner)
  const p = K.player(who, st, 'subject');
  // edh-players-23 (CR 608.2c): a player the text named before and the pronoun names uniquely (`they`, render/refs.ts) is also "they" ("Its controller may sacrifice it. If they don't, ...")
  // edh-c-98 (CR 608.2c; family that-player-defending): the defending player named one sentence before ("Defending player may pay {4}.") is also "that player" (the
  // only player the sentence mentions), as for a target player
  const thatPlayer = typeof who === 'object' && who.ref === 'defending' && !p.plural;
  if (negative && ('they' in p && p.they === true && !p.plural || thatPlayer)) return alt(`${p.text} doesn't`, ...('they' in p && p.they === true && !p.plural ? ["they don't"] : []), ...(thatPlayer ? ["that player doesn't"] : []));
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
  // edh-players-14 (CR 701.9a; Kroxa): one card is "a nonland card" (the singular), and a loss of life of that opponent alone is also said as the subject, "each opponent who didn't discard a nonland card this way loses 3 life"
  const one = c.right === 1;
  const np = K.np({ ...anyOf[0]!, zone: 'hand' }, st, { det: one ? 'a' : 'none', plural: !one, noZone: true });
  const count = one ? '' : `${numWord(c.right)} `;
  bind(st, s.as, { nouns: ['player', 'opponent'], plural: false, player: true, iterates: 'opponent' });
  const lose = only.then.length === 1 && only.then[0]!.op === 'loseLife' && JSON.stringify(only.then[0]!.who) === JSON.stringify({ ref: 'bound', name: s.as }) ? (only.then[0] as StepOf<'loseLife'>) : null;
  const form = `for each opponent who didn't discard ${count}${np} this way, ${K.steps(only.then, st)}`;
  return plain(lose !== null ? alt(form, `each opponent who didn't discard ${count}${np} this way loses ${K.qty(lose.amount, st)} life`) : form, { standalone: true, ...(lose !== null ? { commaThenWho: true } : {}) });
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

/**
 * edh-c-74 (CR 614.15, 120.3; Searing Blaze): one damage step of the ability's own object to a target and `also` to a second target, and the same step with other amounts (nothing else
 * different, both amounts numbers); the two new amounts, or null.
 */
function damageAlsoAmounts(then: readonly unknown[], els: readonly unknown[]): [number, number] | null {
  if (then.length !== 1 || els.length !== 1) return null;
  const a = then[0] as Record<string, unknown>;
  const b = els[0] as Record<string, unknown>;
  const [aa, ba] = [a['also'], b['also']];
  if (a['op'] !== 'damage' || b['op'] !== 'damage' || !Array.isArray(aa) || !Array.isArray(ba) || aa.length !== 1 || ba.length !== 1) return null;
  if ((a['source'] as { ref?: unknown } | undefined)?.ref !== 'self' || typeof a['amount'] !== 'number' || typeof b['amount'] !== 'number') return null;
  const [x, y] = [aa[0] as Record<string, unknown>, ba[0] as Record<string, unknown>];
  if (typeof x['amount'] !== 'number' || typeof y['amount'] !== 'number' || JSON.stringify(x['to']) !== JSON.stringify(y['to']) || Object.keys(x).length !== 2 || Object.keys(y).length !== 2) return null;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== 'amount' && k !== 'also' && k !== 'sentence'));
  if (![...keys].every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]))) return null;
  return [a['amount'], x['amount']];
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
 * edh-next-53 (CR 614.15, 701.17a; Increasing Confusion, parser rider rid.edhn53.instead.mill.twice): one mill step and the same step with twice its count
 * (`{q: 'math', op: '*', args: [2, <the count>]}`), nothing else different: "that player mills twice that many cards instead". The player of the step, or null.
 */
function doubledMill(then: readonly unknown[], els: readonly unknown[]): Record<string, unknown>['who'] | null {
  if (then.length !== 1 || els.length !== 1) return null;
  const a = then[0] as Record<string, unknown>;
  const b = els[0] as Record<string, unknown>;
  if (a['op'] !== 'mill' || b['op'] !== 'mill' || b['who'] === undefined || b['count'] === undefined) return null;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== 'count' && k !== 'sentence'));
  if (![...keys].every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]))) return null;
  return JSON.stringify(a['count']) === JSON.stringify({ q: 'math', op: '*', args: [2, b['count']] }) ? b['who'] : null;
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
 * edh-top-15 (CR 614.15, 508.4; Andúril, Flame of the West): "Create two tapped 1/1 ... tokens. If C, instead create two of those tokens that are tapped and attacking.": `if C then
 * [create, tapped and attacking] else [create, tapped]` (the parser's rider rid.edht15.instead.tokensTappedAttacking); the number as Oracle says it, or null.
 */
function tappedTokensAttackingInstead(then: readonly unknown[], els: readonly unknown[]): number | null {
  if (then.length !== 1 || els.length !== 1) return null;
  const a = then[0] as Record<string, unknown> | undefined;
  const b = els[0] as Record<string, unknown> | undefined;
  if (a?.['op'] !== 'createToken' || b?.['op'] !== 'createToken' || a['tapped'] !== true || a['attacking'] !== true || b['tapped'] !== true || b['attacking'] !== undefined || typeof b['count'] !== 'number') return null;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== 'attacking' && k !== 'sentence'));
  return [...keys].every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k])) ? b['count'] : null;
}

/**
 * r4-repl (CR 614.15, 400.7): `if C then [move X to Z2] else [move X to Z1]`, one move of the same object (bound by an earlier instruction, the same name bound
 * by both) to two zones and nothing else different: the fold lower/riders.ts#movesTheOnlyMoved builds of "..., and put it into your hand. If C, put that card
 * onto the battlefield instead.", whose earlier instructions stay before the `if`.
 */
/**
 * edh-cast-9 (CR 701.6a, 202.3): an `if` step with no `else` whose one instruction counters an object, under the condition that its mana value is the same as another
 * object's (the parser's template eff.edhc9.counter.ifSameManaValueAsRevealed); the countered object and the other one, else null.
 */
function sameManaValueCounter(s: StepOf<'if'>): { counters: ObjRef; other: ObjRef } | null {
  const c = s.cond;
  const only = s.then.length === 1 ? s.then[0] : undefined;
  if (c.cond !== 'compare' || c.op !== '==' || typeof c.left !== 'object' || typeof c.right !== 'object' || c.left.q !== 'stat' || c.left.stat !== 'manaValue' || c.right.q !== 'stat' || c.right.stat !== 'manaValue') return null;
  if (Object.keys(c.left).length !== 3 || Object.keys(c.right).length !== 3 || only?.op !== 'counter' || s.guard !== undefined || s.as !== undefined) return null;
  return JSON.stringify(c.left.of) === JSON.stringify(only.what) ? { counters: c.left.of, other: c.right.of } : null;
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
 * edh-mana-keywords-1 (CR 614.15, 106.7): `if C then [addMana couldProduce N oneType] else [addMana couldProduce 1]` with the same objects: the number N when the
 * `then` is "N mana of that type" in place of the one mana of any type those objects could produce (the parser's rider rid.edhmk1.instead.thatType), else null.
 */
function thatTypeInstead(s: StepOf<'if'>): number | null {
  if (s.then.length !== 1 || s.else === undefined || s.else.length !== 1) return null;
  const [x, y] = [s.then[0] as unknown as Record<string, unknown>, s.else[0] as unknown as Record<string, unknown>];
  const dx = x['dynamic'] as Record<string, unknown> | undefined;
  const dy = y['dynamic'] as Record<string, unknown> | undefined;
  if (x['op'] !== 'addMana' || y['op'] !== 'addMana' || dx === undefined || dy === undefined || dx['kind'] !== 'couldProduce' || dy['kind'] !== 'couldProduce') return null;
  if (dx['oneType'] !== true || dy['oneType'] !== undefined || dy['count'] !== 1 || typeof dx['count'] !== 'number' || dx['count'] < 2) return null;
  const same = (k: string): boolean => JSON.stringify(dx[k]) === JSON.stringify(dy[k]);
  const rest = (o: Record<string, unknown>): string => JSON.stringify({ ...o, dynamic: undefined });
  return same('among') && same('colorsOnly') && rest(x) === rest(y) ? dx['count'] : null;
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
 * edh-replace-4 (CR 614.15, 120.10): "Target creature you control deals damage equal to its power to target creature you don't control. If the creature you control has
 * trample, excess damage is dealt to that creature's controller instead." (Ram Through): the same damage step with `excessToController` and nothing else different (the
 * parser's rider rid.edhr4.instead.excessToController builds exactly this shape).
 */
function excessToControllerInstead(then: readonly unknown[], els: readonly unknown[], cond: unknown, st: RenderState): boolean {
  if (then.length !== 1 || els.length !== 1) return false;
  const a = then[0] as Record<string, unknown>;
  const b = els[0] as Record<string, unknown>;
  if (a['op'] !== 'damage' || b['op'] !== 'damage' || a['excessToController'] !== true || b['excessToController'] !== undefined) return false;
  // the source is the "target creature you control" and the condition says that same object has trample: "the creature you control has trample"
  const src = b['source'] as { ref?: unknown; id?: unknown } | undefined;
  if (src?.ref !== 'target' || typeof src.id !== 'string') return false;
  const spec = st.specs.get(src.id);
  if (spec === undefined || spec.kind !== 'object' || JSON.stringify(spec.filter) !== JSON.stringify({ types: ['Creature'], controller: 'you' })) return false;
  if (JSON.stringify(cond) !== JSON.stringify({ cond: 'matches', object: src, filter: { keyword: 'trample' } })) return false;
  // the recipient is exactly one target creature (a "creature or planeswalker" or "up to one" recipient is not what the rider's words say)
  const to = a['to'] as { ref?: unknown; id?: unknown } | undefined;
  const toSpec = to?.ref === 'target' && typeof to.id === 'string' ? st.specs.get(to.id) : undefined;
  if (toSpec === undefined || toSpec.kind !== 'object' || toSpec.min !== 1 || toSpec.max !== 1 || JSON.stringify(toSpec.filter?.types) !== '["Creature"]') return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== 'excessToController' && k !== 'sentence'));
  return [...keys].every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

/**
 * r4-repl (CR 614.15, 111.1, 707.2): "Create a token that's a copy of target creature. If C, create five of those tokens instead." and "Create two 2/2 tokens. If C,
 * instead create X of those tokens, where X is ...": the same token creation (or token copy) with another number of tokens and nothing else different (the
 * parser's riders rid.r4repl.instead.*.count build exactly this shape). The number as Oracle says it ("five", or "X" with its "where X is"), or null.
 */
/** edh-d-86: a sentence ended by a quoted ability already has its period inside the quotation marks (CR 113.2c: the quoted ability is a whole sentence); any other gets one. */
const sentenceDone = (x: string): string => (endsQuoted(parseMarked(x)) ? x : `${x}.`);
/** Every reading of the marked text ends with a period inside quotation marks. */
function endsQuoted(seq: readonly MarkedNode[]): boolean {
  const last = seq[seq.length - 1];
  if (last === undefined) return false;
  if (typeof last === 'string') return /\.["”]\s*$/.test(last);
  return last.alts.length > 0 && last.alts.every((a) => endsQuoted(a));
}

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
  // edh-d-86 (CR 608.2h; Craig Boone, Novac Guard): the same counted amount for both ("damage equal to X ... has ~ deal that much damage to them"), the quantity said once
  const same = !lit(d.amount) && typeof d.amount === 'object' && JSON.stringify(d.amount) === JSON.stringify(o.amount);
  const plainDamage = (x: StepOf<'damage'>): boolean => x.source.ref === 'self' && x.also === undefined && x.divided === undefined && x.as === undefined && x.unpreventable !== true && x.guard === undefined && (lit(x.amount) || same);
  if (!plainDamage(d) || !plainDamage(o) || JSON.stringify(d.to) !== JSON.stringify(s.who) || JSON.stringify(o.to) !== JSON.stringify(s.who.object) || o.to.ref !== 'target') return null;
  const spec = st.specs.get(o.to.id);
  // edh-d-86 (CR 115.1, 608.2b): "up to one target creature" too (no target chosen: nobody is asked and nothing is dealt)
  if (spec === undefined || spec.kind !== 'object' || (spec.min !== 1 && spec.min !== 0) || spec.max !== 1 || JSON.stringify(spec.filter) !== JSON.stringify({ types: ['Creature'] })) return null;
  const first = K.clause(o, st);
  return plain(`${first.sub} unless that creature's controller has ~ deal ${same ? 'that much' : String(d.amount as number)} damage to them`, { standalone: true, closesScope: true });
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
 * edh-c-5 (CR 118.12a, 120.3, 701.6a, 701.8a): "Destroy target land unless its controller has ~ deal 2 damage to them" / "Counter target instant or sorcery spell unless its controller
 * has ~ deal 4 damage to them" is "that object's controller may have ~ deal that damage to them; if they don't, destroy (counter) the object": the shape of unlessHasPower with a
 * literal amount and a destroy or a counter that follows. Null for any other `may`.
 */
function unlessHasDamage(s: StepOf<'may'>, st: RenderState): Clause | null {
  const [d] = s.do;
  const [o] = s.otherwise ?? [];
  if (s.do.length !== 1 || s.otherwise?.length !== 1 || s.as !== undefined || s.guard !== undefined || s.who.ref !== 'controllerOf' || d?.op !== 'damage' || (o?.op !== 'destroy' && o?.op !== 'counter')) return null;
  if (d.source.ref !== 'self' || d.also !== undefined || d.divided !== undefined || d.perSource !== undefined || d.as !== undefined || d.unpreventable === true || d.guard !== undefined) return null;
  if (JSON.stringify(d.to) !== JSON.stringify(s.who) || JSON.stringify(o.what) !== JSON.stringify(s.who.object) || o.what.ref !== 'target') return null;
  if (o.as !== undefined || o.guard !== undefined || (o.op === 'destroy' && o.regeneration !== undefined)) return null;
  if (typeof d.amount !== 'number' || d.amount < 1) return null;
  const first = K.clause(o, st);
  return plain(`${first.sub} unless its controller has ~ deal ${d.amount} damage to them`, { standalone: true, closesScope: true });
}

/**
 * edh-next-113 (CR 118.12a, 120.3, 400.3; Pia's Revolution): "Return that card to your hand unless target opponent has ~ deal 3 damage to them" is "that opponent may have ~ deal 3 damage
 * to them; if they don't, return the card to your hand": a `may` by a target player (the damage goes to that player), and a move of an object to its owner's hand otherwise. Null for any
 * other `may`.
 */
function unlessTargetHasDamage(s: StepOf<'may'>, st: RenderState): Clause | null {
  const [d] = s.do;
  const [o] = s.otherwise ?? [];
  if (s.do.length !== 1 || s.otherwise?.length !== 1 || s.as !== undefined || s.guard !== undefined || s.who.ref !== 'target' || d?.op !== 'damage' || o?.op !== 'move') return null;
  if (d.source.ref !== 'self' || d.also !== undefined || d.divided !== undefined || d.perSource !== undefined || d.as !== undefined || d.unpreventable === true || d.guard !== undefined) return null;
  if (JSON.stringify(d.to) !== JSON.stringify(s.who) || typeof d.amount !== 'number' || d.amount < 1) return null;
  if (o.as !== undefined || o.guard !== undefined || o.to.zone !== 'hand' || Object.keys(o.to).length !== 1 || o.what.ref === 'target') return null;
  const first = K.clause(o, st);
  const who = K.player(s.who, st, 'subject').text;
  return plain(`${first.sub} unless ${who} has ~ deal ${d.amount} damage to them`, { standalone: true, closesScope: true });
}

/**
 * edh-c-89 (CR 118.12a, 701.6a, 404.1, 406.2; Grip of Amnesia): "Counter target spell unless its controller exiles all cards from their graveyard" is "that spell's controller may exile all
 * cards from their graveyard; if they don't, counter it": a `may` by the controller of a target whose instruction moves every card of that player's graveyard to exile, and a counter of the
 * target otherwise. Null for any other `may`.
 */
function unlessExilesGraveyard(s: StepOf<'may'>, st: RenderState): Clause | null {
  const [d] = s.do;
  const [o] = s.otherwise ?? [];
  if (s.do.length !== 1 || s.otherwise?.length !== 1 || s.as !== undefined || s.guard !== undefined || s.who.ref !== 'controllerOf' || d?.op !== 'move' || o?.op !== 'counter') return null;
  if (s.who.object.ref !== 'target' || JSON.stringify(o.what) !== JSON.stringify(s.who.object) || o.as !== undefined || o.guard !== undefined) return null;
  const w = d.what;
  if (d.to.zone !== 'exile' || w.ref !== 'each' || !('filter' in w) || JSON.stringify(w.filter) !== JSON.stringify({ zone: 'graveyard', owner: s.who })) return null;
  if (Object.keys(d).some((k) => !['op', 'what', 'to'].includes(k)) || Object.keys(d.to).some((k) => k !== 'zone')) return null;
  const first = K.clause(o, st);
  return plain(`${first.sub} unless its controller exiles all cards from their graveyard`, { standalone: true, closesScope: true });
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

/**
 * pc-keywords-mana-3 (CR 701.55; parser/templates/zz-cloud/pc-keywords-mana-3.json): "Target opponent faces a villainous choice -- They lose 3 life, or you draw two cards.":
 * the `may` of `villainous`, a choice between its two lists of instructions (`do`, then `otherwise`) made by `who`. The options are said as instructions of their own.
 */
function villainousOptions(s: StepOf<'may'>, st: RenderState): string {
  if (s.otherwise === undefined || s.otherwise.length === 0 || s.as !== undefined || s.anyOne === true) throw new NoRenderer('a villainous choice needs two options and nothing else');
  return `${K.steps(s.do, st, { nested: true })}, or ${K.steps(s.otherwise, st, { nested: true })}`;
}

/**
 * trek-16 (CR 608.2d, 608.2g, 601.2, 118.9, 305.9; Cmdr. Troi, Outgoing Empath): "<another player> may cast a spell from their hand without paying its mana cost": the player
 * decides whether to (the `may`), then chooses exactly one nonland card of their hand and casts it free during the resolution (the template
 * eff.trek16.player.mayCast.fromTheirHand.free). The card is "that spell" afterwards. Said of a player other than you (your own hand is std-rw7's wording); null otherwise.
 */
function mayCastFromTheirHand(s: StepOf<'may'>, st: RenderState): string | null {
  const [a, b] = s.do;
  if (s.do.length !== 2 || a?.op !== 'chooseObjects' || b?.op !== 'cast' || a.as === undefined || s.otherwise !== undefined || s.anyOne !== undefined || s.villainous !== undefined) return null;
  const same = (x: unknown): boolean => JSON.stringify(x) === JSON.stringify(s.who);
  if (s.who.ref !== 'target' || !same(a.who) || !same(b.who) || a.min !== 1 || a.max !== 1 || a.random === true || a.guard !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  if (b.guard !== undefined || b.optional !== undefined || b.costChange !== undefined || b.transformed !== undefined || b.copyIn !== undefined || b.play !== undefined || b.anyManaType !== undefined
    || b.maxManaValue !== undefined || b.exactManaValue !== undefined || b.graveyardInstead !== undefined || b.select !== undefined || b.free !== true || b.what.ref !== 'bound' || b.what.name !== a.as) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from) || JSON.stringify(a.from.filter) !== JSON.stringify({ notTypes: ['Land'], zone: 'hand', owner: s.who, isCard: true })) return null;
  bind(st, a.as, { nouns: ['spell'], plural: false });
  return 'cast a spell from their hand without paying its mana cost';
}

const mayClause = (s: StepOf<'may'>, st: RenderState): Clause => {
  if (s.villainous === true) {
    const who = K.player(s.who, st, 'subject');
    const text = `${who.text} faces a villainous choice -- ${villainousOptions(s, st)}`;
    return acting(playerKey(s.who) ?? 'x', text, text, { standalone: true, closesScope: true });
  }
  const folded = tapOrUntap(s, st) ?? unlessHas(s, st) ?? eachMayShuffleThenDraw(s, st) ?? unlessHasPower(s, st) ?? unlessHasDamage(s, st) ?? unlessTargetHasDamage(s, st) ?? unlessExilesGraveyard(s, st) ?? mayImpulse(s, st) ?? mayCopyThoseSpellsGain(s, st);
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
  const inner = (s.who.ref === 'each' || s.who.ref === 'voters' || s.who.ref === 'otherOf') && JSON.stringify(s.do).includes('"ref":"iterating"') ? playerKey({ ref: 'iterating' }) : key;
  st.actor = inner;
  // a clause with its subject baked in ("~ deals 2 damage ...") reads "you may have ~ deal 2 damage ..."
  let body: string;
  const castFree = mayCastFromTheirHand(s, st); // trek-16
  const only = s.do.length === 1 ? K.clause(s.do[0]!, st) : null;
  if (castFree !== null) body = castFree;
  else if (only && only.have !== undefined && only.actor === null) body = `have ${only.have}`;
  // FAST4 T30 (CR 608.2d): the controller chooses, another player acts: "you may have target player mill two cards"
  // r3-choose (CR 608.2d): ... and another player chooses whether YOU act: "target opponent may have you create two Lander tokens" (Terrapact Intimidator)
  else if (only && only.have !== undefined && only.actor !== null && (key === 'you' || only.actor === 'you') && only.actor !== key) body = `have ${only.have}`;
  else body = only ? within(only, inner) : K.steps(s.do, st, { nested: true, actor: inner });
  // edh-d-97 (CR 608.2d, 101.4, 400.3; family any-opponent-have-you-put; Sin Prodder): the one opponent who chooses has YOU put the card into your graveyard, "any opponent may have you put
  // that card into your graveyard": the same move as "any opponent may put it into your graveyard" (the card goes to its owner's graveyard, yours)
  const putYours = s.do.length === 1 && s.do[0]!.op === 'move' ? s.do[0] : undefined;
  if (anyWho === 'opponent' && putYours?.op === 'move' && putYours.as === undefined && putYours.guard === undefined && JSON.stringify(putYours.to) === '{"zone":"graveyard","owner":{"ref":"you"}}' && Object.keys(putYours).every((k) => ['op', 'what', 'to'].includes(k))) {
    body = alt(body, `have you put ${K.obj(putYours.what, st, 'object').text} into your graveyard`);
  }
  st.actor = saved;
  // edh-c-39 (family may-then-have; Visions): "You may then have that player shuffle that library." after a look at it: the same option, said after "then" (CR 608.2c)
  const thenHave = (s.do[0] as { op?: string } | undefined)?.op === 'shuffle' && body.startsWith('have ') ? `may then ${body}` : null;
  const sentence = thenHave === null ? `may ${body}` : alt(`may ${body}`, thenHave);
  // p2-copy-spell-1 (CR 608.2c, 608.2d; family they-may): a player named before, whom the pronoun names uniquely (`they`, render/refs.ts), is also "they" as the
  // subject of an option, as of any other instruction (render/steps-util.ts#byPlayer): "If the player does, they may copy this spell ..." (Chain of Vapor)
  let sub = 'they' in subj && subj.they === true ? alt(`${subj.text} ${sentence}`, `they ${sentence}`) : `${subj.text} ${sentence}`;
  // r4-moved: an option of yours that begins with a search of your library is also "If you search your library this way" later (render/cond.ts)
  const first = s.do[0] as { op?: string; who?: { ref?: string }; zone?: string; owner?: unknown; alsoZones?: unknown } | undefined;
  const searched = key === 'you' && s.otherwise === undefined && first?.op === 'search' && first.who?.ref === 'you' && first.zone === 'library' && first.owner === undefined && first.alsoZones === undefined;
  // pc-tokens-1 (CR 608.2d, 101.4): the players of a group who did it are counted by "For each opponent who does, ..." (#repeat)
  const eachMay = s.who.ref === 'each' && 'who' in s.who && (s.who.who === 'opponent' || s.who.who === 'player') && s.anyOne !== true && s.otherwise === undefined ? s.who.who : undefined;
  // edh-zones-8 (CR 701.23a): the players of the group who did it are the ones who searched their library
  const eachMaySearches = eachMay !== undefined && first?.op === 'search' && first.who?.ref === 'iterating' && first.zone === 'library' && first.owner === undefined && first.alsoZones === undefined;
  // edh-players-11 (CR 608.2c): the option is one draw by that player, so "who drew a card this way" names the ones who did it
  const eachMayDraws = eachMay !== undefined && s.do.length === 1 && first?.op === 'draw' && first.who?.ref === 'iterating';
  // edh-players-14 (CR 701.9a, 608.2c): the option begins with discarding the whole hand, so "who discarded their hand this way" names the ones who did it
  const firstD = s.do[0] as { op?: string; who?: { ref?: string }; count?: unknown; filter?: unknown } | undefined;
  const eachMayDiscardsHand = eachMay !== undefined && firstD?.op === 'discard' && firstD.who?.ref === 'iterating' && firstD.count === 'hand' && firstD.filter === undefined;
  const eachMayDiscardsOne = eachMay !== undefined && s.do.length === 1 && firstD?.op === 'discard' && firstD.who?.ref === 'iterating' && firstD.count === 1 && firstD.filter === undefined && (firstD as { mode?: unknown }).mode === undefined; // edh-next-43
  bind(st, s.as, { nouns: [], plural: false, actor: key, optional: true, ...(searched ? { searched: true as const } : {}), ...(anyWho !== undefined ? { anyOne: true as const, player: true /* edh-d-97: the one who did it is a player (render/refs.ts) */ } : {}), ...(eachMay !== undefined ? { eachMay } : {}), ...(eachMaySearches ? { eachMaySearches: true as const } : {}), ...(eachMayDraws ? { eachMayDraws: true as const } : {}), ...(eachMayDiscardsHand ? { eachMayDiscardsHand: true as const } : {}), ...(eachMayDiscardsOne ? { eachMayDiscardsOne: true as const } : {}) });
  let standalone = false;
  if (s.otherwise && s.otherwise.length > 0) {
    const other = K.steps(s.otherwise, st, { actor: key });
    const each = eachWhoDoesnt(s, st);
    sub += each !== null ? alt(`. If ${didText(key, s.who, st, true)}, ${other}`, `. ${each}`) : `. If ${didText(key, s.who, st, true)}, ${other}`;
    standalone = true;
  }
  return acting(key ?? 'x', sub, sub, { standalone, closesScope: true, ...(eachMay !== undefined && s.as !== undefined ? { thenGroup: true } : {}) });
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
    // edh-next-83 (CR 118.12a, 118.3; Lim-Dul's Hex): a choice between two mana payments is said once, "unless they pay {B} or {3}" (as edh-c-103's "unless that spell's controller pays {B} or {3}")
    const oneOfMana = oneOfManaCosts(c);
    if (oneOfMana !== null) { const [f, ...r] = oneOfMana.map((o) => K.costVerbs(o, st, person)); return `${f} or ${r.map((x) => x.replace(/^pays? /, '')).join(' or ')}`; }
    const v = K.costVerbs(c, st, person);
    const sacrifice = c.mana === undefined && c.tap !== true && c.other?.length === 1 && c.other[0]!.kind === 'sacrifice' && c.other[0]!.self !== true;
    return sacrifice ? alt(v, `${v} of their choice`) : v;
  });
  // r4-fxz (CR 118.12a, 608.2c): the payer may be named again as "that player", with singular verbs ("each opponent loses 3 life unless that player sacrifices
  // a nonland permanent of their choice or discards a card"): the player of the group the instruction is happening to, never another one
  // edh-next-83 (CR 608.2c, 101.4; Lim-Dul's Hex): and the group said first, each player in turn, "for each player, ~ deals 1 damage to that player unless they pay {B} or {3}"
  const perPlayer = last.op === 'damage' && r.to !== undefined && over.who === 'player' && costs.length === 1 && last.divided === undefined && last.also === undefined
    ? `for each player, ${K.steps([last], cloneState(st0))} unless they ${verbs('pl').join(' or ')}` : null;
  const unless = perPlayer !== null ? alt(`${instruction} unless they ${verbs('pl').join(' or ')}`, `${instruction} unless that player ${verbs('sg').join(' or ')}`, perPlayer)
    : alt(`${instruction} unless they ${verbs('pl').join(' or ')}`, `${instruction} unless that player ${verbs('sg').join(' or ')}`);
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

/**
 * edh-players-6 (CR 107.3, 118.12, 608.2h): "you may pay X life, where X is <a number>. If you do, draw X cards." The controller's optional payment of life equal to a computed
 * number, then drawing that many cards; null for any other shape. The number is the same quantity in the payment and the draw (the parser's template eff.edhp6.payLife.whereX.draw).
 */
function payLifeWhereXThen(s: StepOf<'pay'>, amount: Quantity, st: RenderState): string | null {
  if (!s.then!.every((t) => t.op === 'createToken' || t.op === 'putCounters')) return null;
  const vs = cloneState(st);
  markX(amount, vs); // the number said as X once: later uses say "X" with no "where" clause (steps-util.ts#whereX)
  const head = `you may pay X life, where X is ${K.qty(amount, cloneState(st))}`;
  const then = K.steps(s.then!, vs, { actor: undefined });
  return /\bx\b/i.test(then) ? `${head}. If you do, ${then}` : null; // X must be said where the number is used (else the plain form)
}

function payLifeWhereX(s: StepOf<'pay'>, key: string | null, st: RenderState): string | null {
  if (key !== 'you' || s.mandatory === true || s.times !== undefined || s.else !== undefined || s.as !== undefined || s.upTo !== undefined || s.xMax !== undefined || s.then === undefined || s.then.length === 0) return null;
  // edh-d-95 (CR 107.3, 608.2h; G'raha Tia, Scion Reborn): several instructions only for the tokens and counters ("create a 1/1 ... token and put X +1/+1 counters on it", payLifeWhereXThen)
  if (s.then.length !== 1 && !s.then.every((t) => t.op === 'createToken' || t.op === 'putCounters')) return null;
  const c = s.cost;
  if (c.mana !== undefined || c.tap !== undefined || c.untap !== undefined || c.loyalty !== undefined || c.loyaltyX !== undefined || c.other?.length !== 1) return null;
  const part = c.other[0]!;
  if (part.kind !== 'payLife' || typeof part.amount !== 'object') return null;
  const [d] = s.then;
  // edh-next-109 (CR 107.3, 118.12, 608.2h; Tivash, Gloom Summoner): the same number said once as X for the tokens or counters that follow ("create an X/X ... token")
  if (d?.op === 'createToken' || d?.op === 'putCounters') return payLifeWhereXThen(s, part.amount, st);
  if (d?.op !== 'draw' || d.guard !== undefined || d.as !== undefined || JSON.stringify(d.who) !== JSON.stringify({ ref: 'you' }) || JSON.stringify(d.count) !== JSON.stringify(part.amount)) return null;
  return `you may pay X life, where X is ${K.qty(part.amount, st)}. If you do, draw X cards`;
}

/**
 * edh-perms-6 (CR 118.12, 608.2c; Springheart Nantuko): a payment of yours with a condition and an "If you do" branch (and no "If you don't" branch, which a skipped payment would not
 * run: the guard skips the whole step) says the condition itself, right after the cost (`payClause`); render/steps.ts#clause then adds no trailing "if C".
 */
/** edh-c-103 (CR 118.3, 118.12a): the mana-only options of a payment that is one choice between mana costs ("{B} or {3}"), else null. */
function oneOfManaCosts(c: CostDef): CostDef[] | null {
  if (c.mana !== undefined || c.tap === true || c.untap === true || c.loyalty !== undefined || c.other?.length !== 1) return null;
  const part = c.other[0]!;
  if (part.kind !== 'oneOf' || part.options.length < 2) return null;
  return part.options.every((o) => o.mana !== undefined && o.tap !== true && o.untap !== true && o.loyalty === undefined && (o.other?.length ?? 0) === 0) ? part.options : null;
}

export function payGuardInside(s: StepOf<'pay'>): boolean {
  return s.guard !== undefined && s.mandatory !== true && s.upTo === undefined && s.times === undefined && (s.then?.length ?? 0) > 0 && (s.else?.length ?? 0) === 0 && playerKey(s.who) === 'you' && eitherOrSecond(s) === null;
}

const payClause = (s: StepOf<'pay'>, st: RenderState): Clause => {
  const key = playerKey(s.who);
  // std-combat-2 (CR 118.12, 608.2d): "you may pay {1} up to three times" (`upTo`): the controller's payment of a chosen number of times, with no branches of its own
  // edh-top-6 (CR 101.4, 118.12, 608.2d; join forces, Minds Aglow): "Starting with you, each player may pay any amount of mana.": every player in turn order, any amount of generic mana; the total
  // paid is read afterwards (qty.ts#resultCount, `paidTotalMana`)
  if (s.startingWith !== undefined) {
    if (s.anyAmount !== true || JSON.stringify(s.who) !== '{"ref":"each","who":"player"}' || JSON.stringify(s.startingWith) !== '{"ref":"you"}' || JSON.stringify(s.cost) !== '{"mana":[{"kind":"generic","amount":1}]}'
      || s.mandatory === true || s.times !== undefined || s.upTo !== undefined || s.then !== undefined || s.else !== undefined || s.xMax !== undefined) {
      throw new NoRenderer('a payment by a group in turn that is not "Starting with you, each player may pay any amount of mana"');
    }
    bind(st, s.as, { nouns: [], plural: false, actor: key, optional: true, paidUpTo: true, paidTotalMana: true });
    const text = 'starting with you, each player may pay any amount of mana';
    return acting('you', text, text, { standalone: true });
  }
  if (s.anyAmount === true) {
    // edh-replace-5 (CR 118.12, 608.2d): "you may pay any amount of {R}"; only a mana cost, which the engine pays once for each
    // edh-players-16 (CR 118.12, 119.4; Necrodominance): ... or "you may pay any amount of life" (one life paid for each, nothing else in the cost)
    const lifeOnly = s.cost.mana === undefined && (s.cost.other ?? []).length === 1 && JSON.stringify(s.cost.other![0]) === '{"kind":"payLife","amount":1}' && Object.keys(s.cost).length === 1;
    // edh-next-32 (CR 107.14, 118.12; Rampaging Aetherhood): "you may pay one or more {E}" (one energy paid for each)
    const energyOnly = s.cost.mana === undefined && (s.cost.other ?? []).length === 1 && JSON.stringify(s.cost.other![0]) === '{"kind":"payEnergy","amount":1}' && Object.keys(s.cost).length === 1;
    // edhn81 (CR 118.12, 608.2d; the Adversary cycle): "you may pay {1}{W} any number of times": a cost of mana alone that is not one colored symbol is paid once for each (`anyAmount`), its count "that many"
    const timesWording = !lifeOnly && !energyOnly && (s.cost.other ?? []).length === 0 && Object.keys(s.cost).length === 1 && s.cost.mana !== undefined && s.cost.mana.length > 0 && !(s.cost.mana.length === 1 && s.cost.mana[0]!.kind === 'colored');
    if (key !== 'you' || s.mandatory === true || s.times !== undefined || s.upTo !== undefined || s.else !== undefined || (!lifeOnly && !energyOnly && !timesWording && ((s.cost.other ?? []).length > 0 || s.cost.mana === undefined || s.cost.mana.length !== 1 || s.cost.mana[0]!.kind !== 'colored'))) throw new NoRenderer('a payment of any amount other than "you may pay any amount of {R}" (one mana symbol: "that much" counts the payments)');
    bind(st, s.as, { nouns: [], plural: false, actor: key, optional: true, paidUpTo: true, paidAny: true, ...(energyOnly ? { paidEnergy: true as const } : {}), ...(timesWording ? { paidTimes: true as const } : {}) });
    // edh-next-136 (CR 118.12, 106.1, 608.2d; family pay-any-amount-of-mana; Karn, Living Legacy): {1} paid any number of times is also "pay any amount of mana" (paying none is allowed: no "may" needed)
    const anyMana = timesWording && JSON.stringify(s.cost) === '{"mana":[{"kind":"generic","amount":1}]}' && s.then === undefined;
    const text = anyMana ? alt(`you may pay ${K.costVerbs(s.cost, st, 'you').replace(/^pay /, '')} any number of times`, 'pay any amount of mana') : timesWording ? `you may pay ${K.costVerbs(s.cost, st, 'you').replace(/^pay /, '')} any number of times` : lifeOnly ? 'you may pay any amount of life' : energyOnly ? alt('you may pay one or more {E}', 'you may pay any amount of {E}') /* edh-next-48 (Galvanic Discharge, Aether Spike): energy is paid one for each, so "any amount of" and "one or more" are one payment */ : `you may pay any amount of ${K.costVerbs(s.cost, st, 'you').replace(/^pay /, '')}`;
    // edh-players-16 (CR 608.2c, 118.12; Necrodominance): "... If you do, draw that many cards": the branch that runs after a payment of one or more (`then`), which reads the count
    if (s.then !== undefined) {
      const both = `${text}. If ${didText(key, s.who, st, false)}, ${K.steps(s.then, st, { actor: undefined })}`;
      return acting('you', both, both, { standalone: true, ...(energyOnly ? { commaThen: true } : {}) }); // edh-next-32: "You get {E}, then you may pay one or more {E}. If you do, ..." (Localized Destruction; an existing Clause.commaThen form of the may-pay sentence)
    }
    return acting('you', text, text, energyOnly ? { commaThen: true } : undefined); // edh-next-48: "You get {E}{E}, then you may pay any amount of {E}." (Aether Spike, Galvanic Discharge): after a plain instruction the sentence may follow ", then"
  }
  // edh-c-57 (CR 118.12, 608.2c, 101.4; Carrion Rats, Argothian Wurm; templates eff.edhv57.anyPlayerMay*): "Any player may exile a card from their graveyard. If a player does, ..." is the payment offered to
  // each player in turn until one makes it, then the branch once; only those two payments, which Oracle words with "their"
  if (JSON.stringify(s.who) === '{"ref":"each","who":"player"}' && s.everyPlayer === true && hasThenOnly(s) && s.mandatory !== true && s.times === undefined && s.as === undefined && s.guard === undefined) {
    const c = JSON.stringify(s.cost);
    const lead = c === '{"other":[{"kind":"exileFrom","zone":"graveyard","count":1}]}' ? 'any player may exile a card from their graveyard'
      : c === '{"other":[{"kind":"sacrifice","filter":{"types":["Land"]},"count":1}]}' ? 'any player may sacrifice a land of their choice'
      // edh-d-66 (CR 118.12, 119.4; Dash Hopes): "Any player may pay 5 life. If a player does, ..." (a fixed amount of life)
      : /^\{"other":\[\{"kind":"payLife","amount":[1-9]\d*\}\]\}$/.test(c) ? `any player may pay ${(s.cost.other![0] as { amount: number }).amount} life`
      : c === '{"other":[{"kind":"payLife","amount":{"q":"math","op":"ceilDiv","args":[{"q":"life","of":{"ref":"iterating"}},2]}}]}' ? 'any player may pay half their life, rounded up' /* edh-d-71 (CR 119.4; Temporal Extortion) */ : null;
    if (lead === null) throw new NoRenderer('a payment by any player other than "exile a card from their graveyard", "sacrifice a land of their choice", "pay N life" or "pay half their life, rounded up"');
    const text = `${lead}. if a player does, ${K.steps(s.then!, st, { actor: undefined })}`;
    return acting('you', text, text, { standalone: true });
  }
  if (s.upTo !== undefined) {
    if (key !== 'you' || s.mandatory === true || s.times !== undefined || s.then !== undefined || s.else !== undefined) throw new NoRenderer('a payment up to a number of times other than "you may pay ... up to N times"');
    bind(st, s.as, { nouns: [], plural: false, actor: key, optional: true, paidUpTo: true, paidTimes: true }); // edh-d-99 (Tranquil Frillback): its reflexive trigger is also "when you pay this cost one or more times" (family when-you-pay-up-to-times)
    const text = `you may ${K.costVerbs(s.cost, st, 'you')} up to ${typeof s.upTo === 'number' ? numWord(s.upTo) : K.qty(s.upTo, st)} times`;
    return acting('you', text, text);
  }
  // edh-players-6 (CR 107.3, 118.12, 608.2h; Well of Lost Dreams): "you may pay {X}, where X is less than or equal to the amount of life you gained" (`xMax`, a lifegain trigger's amount)
  if (s.xMax !== undefined) {
    // edh-c-19 (CR 107.3, 118.12; Shanna, Purifying Blade): any other amount is the separate sentence "X can't be greater than <amount>" after the branch that runs on payment
    const capSentence = JSON.stringify(s.xMax) !== '{"q":"eventAmount"}' && s.then !== undefined;
    if (capSentence && key === 'you' && s.mandatory !== true && s.times === undefined && s.else === undefined && JSON.stringify(s.cost) === '{"mana":[{"kind":"variable","name":"X"}]}') {
      bind(st, s.as, { nouns: [], plural: false, actor: key, optional: true });
      const text = `you may pay {X}. If ${didText(key, s.who, st, false)}, ${K.steps(s.then!, st, { actor: undefined })}. X can't be greater than ${K.qty(s.xMax, st)}`;
      return acting('you', text, text, { standalone: true });
    }
    if (key !== 'you' || s.mandatory === true || s.times !== undefined || s.else !== undefined || JSON.stringify(s.xMax) !== '{"q":"eventAmount"}' || JSON.stringify(s.cost) !== '{"mana":[{"kind":"variable","name":"X"}]}'
      || !(st.trigger ?? []).some((e) => e.ev === 'life' && e.change === 'gain')) throw new NoRenderer('a payment of at most X other than "you may pay {X}, where X is less than or equal to the amount of life you gained"');
    const choice = 'you may pay {X}, where X is less than or equal to the amount of life you gained';
    bind(st, s.as, { nouns: [], plural: false, actor: key, optional: true });
    if (s.then === undefined) return acting('you', choice, choice);
    const text = `${choice}. If ${didText(key, s.who, st, false)}, ${K.steps(s.then, st, { actor: undefined })}`;
    return acting('you', text, text, { standalone: true });
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
  // edh-next-74 (CR 602.2b, 118.3; Verrak, Warped Sengir; template eff.edhn74.maypay.thatMuchLife.again): in the trigger of an activation whose cost paid life, paying "that much life" is paying it "again"
  const again = (v: RenderState): string => {
    const evs = v.trigger ?? [];
    return evs.length === 1 && evs[0]!.ev === 'activate' && evs[0]!.lifePaid === true && s.times === undefined && JSON.stringify(s.cost) === '{"other":[{"kind":"payLife","amount":{"q":"eventAmount"}}]}' ? ' again' : '';
  };
  const verbsAll = (v: RenderState, person: Person): string => `${K.costVerbs(s.cost, v, person, s.times)}${again(v)}`;
  const verbs = verbsAll;
  // FAST4 T34 (CR 701.21a): another player's sacrifice is of a permanent they choose, which Oracle may say ("unless they sacrifice a creature of their choice")
  const sacrificeOnly = key !== 'you' && s.times === undefined && s.cost.mana === undefined && s.cost.tap !== true && s.cost.untap !== true && s.cost.loyalty === undefined
    && s.cost.other?.length === 1 && s.cost.other[0]!.kind === 'sacrifice' && s.cost.other[0]!.self !== true && s.cost.other[0]!.count === 1;
  // edh-d-15 (CR 118.12a, 101.4; Rhystic Tutor): a group of every player as the payer, with no `everyPlayer`, is offered the payment until one pays (effects/handlers/pay.ts): "unless any
  // player pays {2}"
  const anyPlayerPays = s.everyPlayer !== true && JSON.stringify(s.who) === '{"ref":"each","who":"player"}';
  const payer = (v: RenderState): ReturnType<typeof K.player> => (anyPlayerPays ? { ...K.player(s.who, v, 'subject'), text: 'any player', plural: false, person: 'sg' } : K.player(s.who, v, 'subject'));
  const theirChoice = (v: RenderState, person: Person): string => (sacrificeOnly ? alt(verbs(v, person), `${verbs(v, person)} of their choice`) : verbs(v, person));
  // a payment that cannot be declined has no "unless" and no "if you don't": a then or else beside `mandatory` would be dropped, so it is refused
  // edh-next-98 (CR 118.3, 608.2d; Greenbelt Rampager): "Pay {E}{E}. If you can't, return ~ to its owner's hand and you get {E}." - the payment you must make when you can, and what happens when you can't
  if (s.mandatory === true && hasElse && !hasThen && key === 'you' && s.times === undefined && s.guard === undefined && s.as === undefined) {
    bind(st, s.as, { nouns: [], plural: false, actor: key, optional: false });
    const text = `${verbs(st, 'you')}. If you can't, ${K.steps(s.else!, st, { actor: undefined })}`;
    return acting('you', text, text, { standalone: true });
  }
  if (s.mandatory === true && (hasThen || hasElse)) throw new NoRenderer('a mandatory pay with a then or an else branch');
  if (s.mandatory === true || (!hasThen && !hasElse)) {
    const subj = K.player(s.who, st, 'subject');
    bind(st, s.as, { nouns: [], plural: false, actor: key, optional: s.mandatory !== true });
    if (s.mandatory === true) return acting(key ?? 'x', verbs(st, 'you'), `${subj.text} ${verbs(st, subj.person)}`);
    const text = `${subj.text} may ${verbs(st, 'you')}`;
    return acting(key ?? 'x', text, text);
  }
  // edh-perms-6 (CR 118.12, 608.2c; render/steps.ts#clause): a guarded payment of yours says its condition right after the cost, before the branches
  const guarded = s.guard !== undefined && payGuardInside(s);
  const forms = withVariants(st, [
    // edh-c-56 (CR 118.12a, 608.2c; family unless-pays; Rhystic Syphon): the payer, a target player, may come first: "Unless target player pays {3}, that player loses 5 life and you gain 5 life."
    // The instructions after the comma name the payer again as "that player" (the payer is rendered first); the same payment, the same outcomes as "[else] unless [who] pays [cost]"
    (v): string | null => {
      if (!hasElse || hasThen || s.who.ref !== 'target' || s.as !== undefined || s.times !== undefined || s.guard !== undefined) return null;
      const subj = K.player(s.who, v, 'subject');
      return `unless ${subj.text} ${verbs(v, subj.person)}, ${K.steps(s.else!, v, { actor: undefined })}`;
    },
    // "[else] unless [who] pays [cost]"
    (v): string | null => {
      if (!hasElse || hasThen) return null;
      // edh-c-103 (CR 118.12a, 118.3; Thrull Wizard): a choice between two mana payments is said once: "unless that spell's controller pays {B} or {3}", not "pays {B} or pay {3}"
      const oneOfMana = oneOfManaCosts(s.cost);
      const verbs = (vv: RenderState, person: Person): string => {
        if (oneOfMana === null) return verbsAll(vv, person);
        const [first, ...rest] = oneOfMana.map((o) => K.costVerbs(o, vv, person, s.times));
        return `${first} or ${rest.map((r) => r.replace(/^pays? /, '')).join(' or ')}`;
      };
      // FAST5 T56 (CR 118.12a, 701.6a): "Counter target spell unless its controller pays {3}. If that spell is countered this way, exile it instead ...": the
      // sentence about where it goes follows the payment, so the counter is worded bare before "unless" and the destination after it
      const rider = s.else!.length === 1 && s.else![0]!.op === 'counter' && s.else![0]!.to !== undefined ? (s.else![0] as StepOf<'counter'>) : null;
      // edh-c-94 (CR 701.19c, 118.12a; Essence Vortex): and a destroy that can't be regenerated says it after the payment, "Destroy target creature unless its controller pays life equal to its toughness. A creature destroyed this way can't be regenerated."
      const noRegen = s.else!.length === 1 && s.else![0]!.op === 'destroy' && s.else![0]!.regeneration === 'cant' ? (s.else![0] as StepOf<'destroy'>) : null;
      const bare = rider === null ? (noRegen === null ? null : [{ ...noRegen, regeneration: undefined } as StepOf<'destroy'>]) : [{ ...rider, to: undefined } as StepOf<'counter'>];
      const other = K.steps(bare ?? s.else!, v, { actor: undefined });
      const tail = rider === null ? (noRegen === null ? '' : `. ${noRegeneration(noRegen, v)}`) : `. ${counterTail(rider, v)}`; // after the bare counter: that names what is countered
      const subj = payer(v);
      // FAST3 T14: a player named before may be "they" with a plural verb ("that player sacrifices a permanent of their choice unless they pay {1}"), offered
      // only when the pronoun names that player uniquely (render/refs.ts#anaphor sets `they`: the singular "they" of steps-util.ts#byPlayer, FAST2 T8) and the
      // payer is the very player the instruction before "unless" names: after "each opponent sacrifices a permanent", "they" is each of those players (CR
      // 608.2c), which one payer (an event's player) is not, so that reading is never offered (the ability stays manual)
      // FAST3 T14, the "unless" idiom (CR 118.12a; parser/lower/anaphora.ts#unlessIdiom): "counter that spell or ability unless its controller pays {2}": "its"
      // names the object of the one instruction the payment prevents, whatever else the sentence could call "it"
      const only = s.else!.length === 1 ? (s.else![0] as { what?: unknown }) : null;
      if (s.who.ref === 'controllerOf' && only !== null && only.what !== undefined && JSON.stringify(only.what) === JSON.stringify(s.who.object)) {
        return `${alt(`${other} unless ${subj.text} ${verbs(v, subj.person)}`, `${other} unless its controller ${verbs(v, 'sg')}`, `${other} unless they ${verbs(v, 'pl')}`)}${tail}`; // edh-next-5 (Hope-Ender Coatl): the controller of what is countered is also "they" (Oracle, template eff.edhn5.counter.unlessTheyPay)
      }
      if (subj.they === true && s.else!.length === 1 && JSON.stringify((s.else![0] as { who?: unknown }).who) === JSON.stringify(s.who)) return alt(`${other} unless ${subj.text} ${verbs(v, subj.person)}`, `${other} unless they ${theirChoice(v, 'pl')}`);
      // FAST4 T34 (CR 118.12a): "~ deals 2 damage to that player unless they sacrifice a creature of their choice": the payer is the player the damage is dealt to
      // edh-next-48 (Demanding Dragon): and the payer named again as "that player" says the same "of their choice" ("deals 5 damage to target opponent unless that player sacrifices a creature of their choice")
      if (subj.they === true && s.else!.length === 1 && s.else![0]!.op === 'damage' && JSON.stringify(s.else![0]!.to) === JSON.stringify(s.who)) return alt(`${other} unless ${subj.text} ${theirChoice(v, subj.person)}`, `${other} unless they ${theirChoice(v, 'pl')}`);
      // edh-c-57 (CR 118.12a, 122.1; Magmatic Sprinter, family unless-remove-counters-from-it): "return ~ to its owner's hand unless you remove two oil counters from it": the object returned is "it" in the payment
      // edh-d-45 (CR 118.12, 118.7; Draco): "sacrifice ~ unless you pay {10}. This cost is reduced by {2} for each basic land type among lands you control."
      let reduced = '';
      if (s.reduceBy !== undefined) {
        const r = s.reduceBy;
        const parts = typeof r === 'object' && r.q === 'math' && r.op === '*' && r.args.length === 2 && typeof r.args[0] === 'number' ? countParts(r.args[1] as never, v) : null;
        if (parts === null || tail !== '') throw new NoRenderer('a reduction of a payment other than "{N} for each <count>"');
        reduced = `. this cost is reduced by {${(r as unknown as { args: [number, unknown] }).args[0]}} for each ${parts.singular}`;
      }
      // edh-d-69 (CR 118.12a, 701.21a; Acererak the Archlich, template eff.edhd69.forEachOpponent.unlessSacrifices.choice): any other payer's sacrifice may be said "of their choice" (an existing alt site, theirChoice)
      const base = `${other} unless ${subj.text} ${theirChoice(v, subj.person)}${tail}${reduced}`;
      const fromIt = key === 'you' && s.cost.mana === undefined && s.cost.other?.length === 1 && s.cost.other[0]!.kind === 'removeCounters' && s.cost.other[0]!.self === true && s.else!.length === 1
        && s.else![0]!.op === 'move' && JSON.stringify(s.else![0]!.what) === '{"ref":"self"}' && base.endsWith(' from ~');
      return fromIt ? alt(base, `${base.slice(0, -1)}it`) : base;
    },
    // edh-c-98 (CR 118.12a, 608.2c; family unless-pays-leading; Scarwood Bandits): the payment may lead the sentence, "Unless an opponent pays {2}, gain control of target artifact ...":
    // the same payment with the instruction it prevents (`else`) after the comma
    (v): string | null => {
      if (!hasElse || hasThen || guarded || s.as !== undefined || s.times !== undefined || s.who.ref === 'target') return null; // (a target payer leads in edh-c-56's form above)
      // edh-c-106 (Demonic Hordes, template eff.edhv106.unlessPay.prefix): several instructions after the comma, "unless you pay {B}{B}{B}, tap ~ and sacrifice a land", only for a payment of mana by you
      // edh-d-15 (Rhystic Tutor): and by any player, "Unless any player pays {2}, search your library for a card, put that card into your hand, then shuffle."
      if (s.else!.some((x) => x.op === 'counter' || x.op === 'pay') || (s.else!.length !== 1 && !(key === 'you' && s.cost.mana !== undefined) && !(anyPlayerPays && s.cost.mana !== undefined))) return null;
      const subj = payer(v);
      if (subj.they === true) return null;
      return `unless ${subj.text} ${verbs(v, subj.person)}, ${K.steps(s.else!, v, { actor: undefined })}`;
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
      // edh-c-106 (CR 118.12a, 608.2c; Forbidden Ritual; template eff.edhv106.loseLife.unlessThatPlayerSacrificeOrDiscard): the player named before is also "that player" (family unless-they-that-player)
      return alt(`${other} unless they ${theirChoice(v, 'pl')} or ${K.costVerbs(inner.cost, v, 'pl')}`, `${other} unless ${subj.text} ${theirChoice(v, subj.person)} or ${K.costVerbs(inner.cost, v, subj.person)}`);
    },
    // edh-c-75 (CR 118.12a, 119.4; Erosion): "destroy that land unless that player pays {1} or 1 life": the payer may pay either cost, stored as the first payment whose only `else` is the
    // payment of life by the same player (the same three outcomes: the mana, the life, or the instruction); a payment of mana, then of life, only
    (v): string | null => {
      const inner = hasElse && !hasThen && s.else!.length === 1 && s.else![0]!.op === 'pay' ? s.else![0]! as StepOf<'pay'> : null;
      if (inner === null || s.as !== undefined || inner.as !== undefined || s.times !== undefined || inner.times !== undefined || inner.mandatory === true || s.guard !== undefined || inner.guard !== undefined) return null;
      if ((inner.then?.length ?? 0) > 0 || (inner.else?.length ?? 0) === 0 || JSON.stringify(inner.who) !== JSON.stringify(s.who)) return null;
      if (JSON.stringify(Object.keys(s.cost)) !== '["mana"]' || inner.cost.other?.length !== 1 || inner.cost.other[0]!.kind !== 'payLife' || Object.keys(inner.cost).length !== 1) return null;
      const subj = K.player(s.who, v, 'subject');
      const other = K.steps(inner.else!, v, { actor: undefined });
      const life = K.costVerbs(inner.cost, v, subj.person).replace(/^pays? /, '');
      return `${other} unless ${subj.text} ${K.costVerbs(s.cost, v, subj.person)} or ${life}`;
    },
    // edh-players-14 (CR 118.12a, 701.21a, 119.4; family unless-player-either; Indulgent Tormentor): the same payment of either cost by a player named by their own words (a target
    // player), not a pronoun: "draw a card unless target opponent sacrifices a creature of their choice or pays 3 life"
    (v): string | null => {
      const inner = hasElse && !hasThen && s.else!.length === 1 && s.else![0]!.op === 'pay' ? s.else![0]! as StepOf<'pay'> : null;
      if (inner === null || s.as !== undefined || inner.as !== undefined || s.times !== undefined || inner.times !== undefined || inner.mandatory === true || s.guard !== undefined || inner.guard !== undefined) return null;
      if ((inner.then?.length ?? 0) > 0 || (inner.else?.length ?? 0) !== 1 || JSON.stringify(inner.who) !== JSON.stringify(s.who) || s.who.ref !== 'target') return null;
      const step = inner.else![0] as { op?: string; who?: unknown };
      if (step.op !== 'draw' || JSON.stringify(step.who) !== JSON.stringify({ ref: 'you' })) return null;
      const other = K.steps(inner.else!, v, { actor: undefined });
      const subj = K.player(s.who, v, 'subject');
      return `${other} unless ${subj.text} ${theirChoice(v, subj.person)} or ${K.costVerbs(inner.cost, v, subj.person)}`;
    },
    // Cloud std-eoe (CR 118.12a, 608.2c; the "unless" idiom of FAST3 T14): "Counter target spell unless its controller pays {2}. If they do, you create a Lander
    // token.": the payment prevents the one instruction before "unless" (its controller is the controller of what that instruction names), and "If they do"
    // follows the payer's choice to pay; the instruction after it is the ability's controller's own, as after "If that player does"
    (v): string | null => {
      if (guarded || !hasElse || !hasThen || s.who.ref !== 'controllerOf' || s.as !== undefined || s.times !== undefined || s.else!.length !== 1) return null;
      const only = s.else![0] as { what?: unknown };
      if (only.what === undefined || JSON.stringify(only.what) !== JSON.stringify(s.who.object)) return null;
      const other = K.steps(s.else!, v, { actor: undefined });
      return `${other} unless its controller ${verbs(v, 'sg')}. If they do, ${K.steps(s.then!, v, { actor: undefined })}`;
    },
    // edh-misc-4 (CR 118.12, 608.2c; family pay-and-instruction; Kinzu of the Bleak Coven): "you may pay 2 life and exile it. If you do, ..." is the payment with its first
    // instruction said in the same sentence: the instruction is done only if the payment was made, as in "you may pay 2 life. If you do, exile it. ..."
    (v): string | null => {
      const first = s.then?.[0];
      if (key !== 'you' || hasElse || s.mandatory === true || first === undefined || ['if', 'may', 'pay', 'forEach', 'repeat', 'let', 'delay', 'reflexive', 'manual'].includes(first.op)) return null;
      const subj = K.player(s.who, v, 'subject');
      const lead = `${subj.text} may ${verbs(v, 'you')} and ${K.steps([first], v, { actor: undefined })}`;
      if (s.then!.length === 1) return lead;
      return `${lead}. If ${didText(key, s.who, v, false)}, ${K.steps(s.then!.slice(1), v, { actor: undefined })}`;
    },
    // "[who] may pay [cost]. If [who] does, [then]. If [who] doesn't, [else]."
    (v): string | null => {
      const subj = K.player(s.who, v, 'subject');
      // edh-players-6 (CR 107.3, 118.12, 608.2h; family pay-x-life-where-x): "you may pay X life, where X is its power. If you do, draw X cards." (Mask of Griselbrand, Tymna the
      // Weaver): the life paid and the cards drawn are the same computed number, said once as X
      const whereX = payLifeWhereX(s, key, v);
      if (whereX !== null) return alt(whereX, `${subj.text} may ${verbs(v, 'you')}${hasThen ? `. If ${didText(key, s.who, v, false)}, ${K.steps(s.then!, v, { actor: undefined })}` : ''}`);
      let out = `${subj.text} may ${verbs(v, 'you')}`;
      if (guarded) out += ` if ${K.cond(s.guard!, v)}`; // edh-perms-6
      // FAST2 T8: after "If you do," the controller's instruction reads either way ("If you do, draw a card", "If you do, you gain 1 life")
      if (hasThen) {
        const thenImp = K.steps(s.then!, v, { actor: key === 'you' ? undefined : key });
        // edh-c-91 (CR 608.2c, 118.12; family if-player-does-they-do; Unifying Theory): a player named before who paid is also the subject of what follows ("If the player does, they draw a card.")
        const sameDoer = s.then!.every((x) => JSON.stringify((x as { who?: unknown }).who) === JSON.stringify(s.who)); // every instruction is the payer's own (review: a mixed list would put "they" before another player's verb)
        const then = key === 'you' || !sameDoer ? thenImp : alt(thenImp, K.steps(s.then!, v, { actor: undefined }));
        // r4-fxb (family if-you-do-also, as FAST5X E1): "If you do, ~ also deals 2 damage to that creature's controller": "also" says only that the instruction
        // comes on top of the earlier ones (CR 608.2c)
        const also = withAlso(then);
        out += `. If ${didText(key, s.who, v, false)}, ${also === null ? then : alt(then, also)}`;
      }
      // edh-c-15 (CR 608.2c, 608.2d; family payer-they-else; Umbilicus): as after "If you do", the instruction after "If they don't" is also said with the payer as the subject, "they return ..."
      if (hasElse) out += `. If ${didText(key, s.who, v, true)}, ${key === 'you' || key === null ? K.steps(s.else!, v, { actor: undefined }) : alt(K.steps(s.else!, v, { actor: undefined }), `they ${K.steps(s.else!, v, { actor: key })}`)}`;
      return out;
    },
    // edh-top-8 (CR 608.2c, 608.2d; family if-they-do-they; Gix, Yawgmoth Praetor): "Whenever a creature deals combat damage to one of your opponents, its controller may pay 1 life. If they
    // do, they draw a card.": the controller of the event's object pays, and that same player, "they", does the instruction that follows (the player the event is about is another one)
    (v): string | null => {
      if (guarded || hasElse || !hasThen || key === 'you' || s.times !== undefined || s.as !== undefined || s.who.ref !== 'controllerOf' || s.who.object.ref !== 'event' || s.then!.length !== 1) return null;
      const only = s.then![0] as { who?: unknown };
      if (JSON.stringify(only.who) !== JSON.stringify(s.who)) return null;
      const subj = K.player(s.who, v, 'subject');
      return `${subj.text} may ${verbs(v, 'you')}. If they do, they ${K.steps(s.then!, v, { actor: key })}`;
    },
    // edh-c-62 (CR 608.2c, 608.2d, 117.3; family they-may-pay-caster; Horn of Plenty): "Whenever a player casts a spell, they may pay {1}. If the player does, they draw a card at the beginning of the next end
    // step.": the one player the cast trigger names is "they" in the payment, and the instruction that follows is theirs
    (v): string | null => {
      if (guarded || hasElse || !hasThen || key === 'you' || s.times !== undefined || s.as !== undefined || JSON.stringify(s.who) !== '{"ref":"event","role":"player"}') return null;
      const evs = v.trigger ?? [];
      if (evs.length !== 1 || evs[0]!.ev !== 'cast') return null;
      return `they may ${verbs(v, 'you')}. If the player ${alt('does', 'did')}, ${K.steps(s.then!, v, { actor: key })}`;
    },
    // std-rx31 (CR 608.2d, 117.3; family they-opponent-of-the-event): "Whenever a creature an opponent controls dies, they may pay 3 life. If they don't, ...": the one
    // opponent the trigger names (the controller of the creature that died) is "they" in its effect, the only player it mentions
    (v): string | null => {
      if (guarded) return null;
      const eventPlayer = JSON.stringify(s.who) === JSON.stringify({ ref: 'event', role: 'player' })
        || JSON.stringify(s.who) === JSON.stringify({ ref: 'controllerOf', object: { ref: 'event', role: 'subject' } });
      if (hasThen || !hasElse || s.times !== undefined || !eventPlayer) return null;
      const evs = v.trigger ?? [];
      // edh-zones-14 (CR 601.2, 608.2d; Wandering Archaic): or the one opponent who cast the spell ("Whenever an opponent casts an instant or sorcery spell, they may pay {2}. If they don't, ...")
      const castBy = evs.length === 1 && evs[0]!.ev === 'cast' && (evs[0] as { player?: unknown }).player === 'opponent';
      // edh-next-136 (CR 608.2d, 117.3, 102.3; Jace, Multiverse Architect): or the opponent whose turn a step trigger "on each opponent's turn" begins on ("At the beginning of combat on each opponent's turn, they may pay {2}. If they don't, ...")
      const stepOfOpponent = evs.length === 1 && evs[0]!.ev === 'step' && (evs[0] as { whose?: unknown }).whose === 'opponent' && JSON.stringify(s.who) === '{"ref":"event","role":"player"}';
      if (evs.length !== 1 || ((evs[0] as { subject?: { controller?: unknown } }).subject?.controller !== 'opponent' && !castBy && !stepOfOpponent)) return null;
      return `they may ${verbs(v, 'you')}. If they don't, ${key === null ? K.steps(s.else!, v, { actor: undefined }) : alt(K.steps(s.else!, v, { actor: undefined }), `they ${K.steps(s.else!, v, { actor: key })}`)}`; // edh-c-15 (family payer-they-else): also "they return ..."
    },
    // "[Pay cost]. If [who] doesn't, [else]." (the payer must decide: Pact of Negation)
    (v): string | null => {
      if (guarded || hasThen || !hasElse) return null;
      const subj = K.player(s.who, v, 'subject');
      const paid = `${subj.text} ${verbs(v, subj.person)}`;
      return `${paid}. If ${didText(key, s.who, v, true)}, ${key === null || key === 'you' ? K.steps(s.else!, v, { actor: undefined }) : alt(K.steps(s.else!, v, { actor: undefined }), `they ${K.steps(s.else!, v, { actor: key })}`)}`; // edh-c-15 (family payer-they-else)
    },
    // imperative form for the controller: "Pay {3}{U}{U}. If you don't, you lose the game."
    (v): string | null => {
      if (guarded || hasThen || !hasElse || key !== 'you') return null;
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

/**
 * edh-next-142 (CR 701.20a, 608.2c, 608.2d; eff.edhn142.may.reveal.ifCond; Omnath, Locus of All): a branch that opens with one `may` of yours (named, no `otherwise`, no guard) around one
 * reveal by you of one named card, followed only by `if` steps on whether you did ("You may reveal that card if C. If you do, ..."): the parser put the "If you do" sentence in the branch.
 */
function mayRevealThenDid(then: readonly EffectStep[]): boolean {
  const m = then[0];
  if (m?.op !== 'may' || m.guard !== undefined || m.who.ref !== 'you' || m.otherwise !== undefined || m.as === undefined || m.do.length !== 1 || then.length < 2) return false;
  const rv = m.do[0];
  if (rv?.op !== 'reveal' || rv.guard !== undefined || rv.who.ref !== 'you' || rv.to !== undefined || (rv.what.ref !== 'bound' && rv.what.ref !== 'target')) return false;
  return then.slice(1).every((x) => x.op === 'if' && x.guard === undefined && x.cond.cond === 'did' && x.cond.step === m.as && x.cond.which === undefined);
}

const turnHistory = (c: Condition): boolean => (c.cond === 'happened' && c.scope === 'turn') || (c.cond === 'any' && c.of.length > 0 && c.of.every(turnHistory));

/** std-rB: an instruction that opens with its verb, with no subject and no alternative group in front ("put ...", "draw ...", "create ..."). */
const IMPERATIVE_LEAD = /^(?:put|draw|create|return|exile|destroy|sacrifice|discard|mill|tap|untap|scry|surveil|investigate|gain|lose|regenerate)\b/;
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
  // edh-zones-3 (lower/targets.ts#perGroupAmounts): or over a group of players, "Each opponent mills half their library, rounded up"
  const group = over.ref === 'each' && 'who' in over && (over.who === 'opponent' || over.who === 'player') && (only?.op === 'mill' || only?.op === 'draw');
  if ((over.ref !== 'target' && !group) || s.do.length !== 1 || only === undefined || only.guard !== undefined || only.as !== undefined) return null;
  const spec = over.ref === 'target' ? st.specs.get(over.id) : undefined;
  const who = (only as { who?: unknown }).who;
  if ((over.ref === 'target' && (spec === undefined || spec.kind !== 'player' || spec.max === 1)) || JSON.stringify(who) !== JSON.stringify({ ref: 'bound', name: s.as })) return null;
  const said = JSON.parse(JSON.stringify(only).replaceAll(JSON.stringify({ ref: 'bound', name: s.as }), JSON.stringify(over.ref === 'target' ? { ref: 'target', id: over.id } : { ref: 'each', who: (over as { who: string }).who }))) as EffectStep;
  return plain(K.steps([said], over.ref === 'target' ? st : cloneState(st)));
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
  // edh-players-6 (family each-opponent-that-opponent-controls): the opponents are also "that opponent" (Mjolnir, Storm Hammer)
  return alt(`${head} ${count} ${plural} that player controls`, `${head} ${count} ${plural} they control`, ...(over.who === 'opponent' ? [`${head} ${count} ${plural} that opponent controls`] : []), ...trailing);
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

/**
 * edhn102 (CR 122.1, 701.27a, 701.26b, 712.9, 608.2c; Hostile Hostel): "Then if there are three or more soul counters on it, remove those counters, transform it, then untap it." is the
 * same `if` with a third instruction, the untap of the same object (the parser's template eff.edhn102.thenIf.counters.removeTransformUntap builds exactly this shape). Null for any other shape.
 */
function removeTransformUntap(s: StepOf<'if'>, st: RenderState): Clause | null {
  const c = s.cond;
  if (s.else !== undefined || s.then.length !== 3 || c.cond !== 'compare' || c.op !== '>=' || typeof c.left !== 'object' || c.left.q !== 'counters' || typeof c.right !== 'number') return null;
  const [rm, tf, un] = s.then;
  if (un?.op !== 'untap' || JSON.stringify(un.what) !== JSON.stringify(c.left.on) || un.guard !== undefined || un.as !== undefined) return null;
  const two = removeTransform({ ...s, then: [rm!, tf!] }, st);
  if (two === null) return null;
  return plain(`${two.imp}, then untap it`.replace(/ and transform it, then untap it$/, ', transform it, then untap it'), { standalone: true, leadThen: true });
}

/**
 * edh-top-7 (CR 122.1, 701.27a, 712.9, 608.2c, 608.2d; Primal Amulet): "Then if there are four or more charge counters on it, you may remove those counters and transform it." is the same `if`
 * with one optional step of both instructions (the parser's template eff.edht7.thenIf.counters.mayRemoveTransform builds exactly this shape). Null for any other shape.
 */
function mayRemoveTransform(s: StepOf<'if'>, st: RenderState): Clause | null {
  const c = s.cond;
  const m = s.then[0];
  if (s.else !== undefined || s.then.length !== 1 || m?.op !== 'may' || m.who.ref !== 'you' || m.otherwise !== undefined || m.anyOne !== undefined || m.villainous !== undefined || m.gather !== undefined || m.guard !== undefined || m.as !== undefined) return null;
  const inner: StepOf<'if'> = { ...s, then: m.do };
  if (c.cond !== 'compare' || m.do.length !== 2) return null;
  const plainForm = removeTransform(inner, st);
  if (plainForm === null) return null;
  const text = plainForm.imp.replace(/^if (.*), remove those counters and transform it$/, 'if $1, you may remove those counters and transform it');
  if (text === plainForm.imp) return null;
  return plain(text, { standalone: true, leadThen: true });
}

/**
 * edh-misc-4 (CR 608.2c, 608.2d; Treasure Chest ruling 2021-07-23): "If C, you may X. Otherwise, Y." is `if C then [.. may X otherwise Y] else Y`: "Otherwise" is
 * whether X was done, so Y also happens when you decline X (the parser's fold of the rider fl.otherwise, lower/riders.ts). Said once, as always: the same `if` with the
 * `may` stripped of its copy of Y. Null for any other `if`.
 */
function otherwiseEcho(s: StepOf<'if'>): StepOf<'if'> | null {
  const last = s.then[s.then.length - 1];
  if (s.else === undefined || last?.op !== 'may' || last.otherwise === undefined || JSON.stringify(last.otherwise) !== JSON.stringify(s.else)) return null;
  const { otherwise: _echo, ...bare } = last;
  return { ...s, then: [...s.then.slice(0, -1), bare] };
}

/**
 * edh-cast-12 (CR 707.10c, 614.15; Increasing Vengeance): "Copy target instant or sorcery spell you control. If this spell was cast from a graveyard, copy that spell twice instead.
 * You may choose new targets for the copies." The parser (rider rid.t45.copy.newTargets.plural, `@eachBranch`) gives BOTH copies, the replaced one and the one that replaces it, the
 * option; Oracle says it once, after the "instead" sentence. The fold with the option taken off both copies and the copy that replaces (more than one) that carries it, or null.
 */
function bothBranchesNewTargets(s: StepOf<'if'>): { bare: StepOf<'if'>; copy: StepOf<'copy'> } | null {
  const a = s.then[s.then.length - 1];
  const b = s.else?.[s.else.length - 1];
  // edh-next-65 (CR 603.7b, 707.10c; Sea Gate Stormcaller): the copies are those of two delayed triggers, "copy the next ... spell ... when you cast it. If C, copy that spell twice instead. You may choose new targets for the copies."
  if (s.else !== undefined && s.else.length === 1 && s.then.length === 1 && a?.op === 'delay' && b?.op === 'delay' && a.do.length === 1 && b.do.length === 1 && a.do[0]!.op === 'copy' && b.do[0]!.op === 'copy') {
    const ca = a.do[0]!;
    const cb = b.do[0]!;
    if (ca.newTargets !== 'may' || cb.newTargets !== 'may' || typeof ca.count !== 'number' || ca.count < 2 || cb.count !== undefined) return null;
    const { newTargets: _a, ...bareA } = ca;
    const { newTargets: _b, ...bareB } = cb;
    return { bare: { ...s, then: [{ ...a, do: [bareA as EffectStep] }], else: [{ ...b, do: [bareB as EffectStep] }] }, copy: ca };
  }
  if (s.else === undefined || s.else.length !== 1 || s.then.length !== 1 || a?.op !== 'copy' || b?.op !== 'copy' || a.result !== 'spell' || b.result !== 'spell') return null;
  if (a.newTargets !== 'may' || b.newTargets !== 'may' || typeof a.count !== 'number' || a.count < 2 || b.count !== undefined) return null;
  const { newTargets: _a, ...bareA } = a;
  const { newTargets: _b, ...bareB } = b;
  return { bare: { ...s, then: [bareA as EffectStep], else: [bareB as EffectStep] }, copy: a };
}

/**
 * edh-cast-14 (CR 118.9, 608.2c, 601.2b): the two branches of an `if` are one `effect` step each, holding the same permission to play the same cards for the same duration; the
 * `then` branch holds that permission and, beside it, the same one for no mana cost (`costChange` {kind:'set', cost:{}}), so the cards may be played either way
 * (Scryfall ruling 2019-08-23 of Ignite the Future).
 */
function freePlayBranches(s: StepOf<'if'>): boolean {
  const one = (steps: readonly unknown[] | undefined): { effect: Record<string, unknown>; permits: Record<string, unknown>[] } | null => {
    if (steps === undefined || steps.length !== 1) return null;
    const e = steps[0] as { op?: string; effects?: Record<string, unknown>[] };
    if (e.op !== 'effect' || e.effects === undefined || e.effects.length < 1 || e.effects.length > 2 || e.effects.some((x) => x['s'] !== 'permit' || x['action'] !== 'play')) return null;
    return { effect: { ...e, effects: undefined }, permits: e.effects };
  };
  const t = one(s.then);
  const e = one(s.else);
  if (t === null || e === null || t.permits.length !== 2 || e.permits.length !== 1) return false;
  const plain = JSON.stringify(e.permits[0]);
  const { costChange, ...rest } = t.permits[1]!;
  return JSON.stringify(t.permits[0]) === plain && JSON.stringify(rest) === plain && JSON.stringify(costChange) === JSON.stringify({ kind: 'set', cost: {} }) && JSON.stringify(t.effect) === JSON.stringify(e.effect);
}

export const CLAUSES_FLOW = {
  if: (s0: StepOf<'if'>, st: RenderState): Clause => {
    // edh-next-133 (CR 707.10, 707.10c, 115.9b, 608.2c; Shiko and Narset, Unified): "copy that spell if it targets a permanent or player, and you may choose new targets for the copy. If you don't copy
    // a spell this way, <instructions>.": a copy that only happens when the spell has a permanent or a player among its targets, and the instructions done otherwise
    const targetsCopy = copyIfTargetsPermanentOrPlayer(s0, st);
    if (targetsCopy !== null) return plain(targetsCopy, { standalone: true });
    // edh-d-98 (CR 614.15, 702.29c; Yidaro, Wandering Monster; family cycled-shuffle-or-battlefield-instead): the cycled card shuffled into your library, or put onto the battlefield
    // instead when the condition holds, is also said in Oracle's order, "Shuffle it into your library from your graveyard. If C, put it onto the battlefield from your graveyard instead."
    const cycled = cycledShuffleOrBattlefield(s0, st);
    if (cycled !== null && !IN_CYCLED.has(s0)) {
      IN_CYCLED.add(s0);
      try {
        const c = CLAUSES_FLOW.if(s0, st);
        return { ...c, imp: alt(c.imp, cycled), sub: alt(c.sub, cycled), standalone: true };
      } finally {
        IN_CYCLED.delete(s0);
      }
    }
    const both = bothBranchesNewTargets(s0);
    if (both !== null) {
      const c = CLAUSES_FLOW.if(both.bare, st);
      const nt = copyNewTargets(both.copy);
      return { ...c, imp: c.imp + nt, sub: c.sub + nt, standalone: true };
    }
    const s = otherwiseEcho(s0) ?? s0; // edh-misc-4
    // edh-c-98 (CR 608.2c, 205.2; the parser's rule, parser/lower/mentions.ts#typeGuardOf; Killer Instinct): "If it's a creature card, put it onto the battlefield. That creature gains
    // haste ...": a card a condition says is of a permanent type is also called by that type afterwards
    if (s.cond.cond === 'matches' && s.cond.object.ref === 'bound' && s.else === undefined && Array.isArray(s.cond.filter.types) && Object.keys(s.cond.filter).every((k) => k === 'types' || k === 'isCard')) {
      const key = `b:${s.cond.object.name}`;
      const known = st.info.get(key);
      if (known !== undefined) st.info.set(key, { ...known, nouns: [...new Set([...known.nouns, ...s.cond.filter.types.map((t) => String(t).toLowerCase()).filter((t) => ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'].includes(t))])] });
    }
    const faceUp = returnFaceDownThenUp(s, st); // FAST5X E25
    if (faceUp !== null) {
      st.leadingIf = false;
      return faceUp;
    }
    const afterTrigger = st.leadingIf;
    const trio = afterTrigger ? null : removeTransformCreate(s, st) ?? removeTransform(s, st) ?? mayRemoveTransform(s, st) ?? removeTransformUntap(s, st); // edh-top-7: mayRemoveTransform
    if (trio !== null) return trio;
    st.leadingIf = false;
    const hasElse = s.else !== undefined && s.else.length > 0;
    // trek-5 (CR 608.2c, 201.2): "then discard a card unless you control five or more differently named lands": the names among a set, at least N (render/cond.ts)
    // edh-c-97 (CR 608.2c, 205.2a; Mindwrack Demon): and the card types among cards in a graveyard (delirium), "you lose 4 life unless there are four or more card types among cards in your graveyard"
    const namesCond = s.cond.cond === 'not' && s.cond.of.cond === 'compare' && typeof s.cond.of.left === 'object' && s.cond.of.left.q === 'distinct' && (s.cond.of.left.what === 'names' || s.cond.of.left.what === 'cardTypes' || s.cond.of.left.what === 'manaValues' /* edh-next-87 (CR 202.3, 608.2c; Tainted Indulgence) */);
    // FAST5X E19 (CR 601.2h; opus): "then discard a card unless five or more mana was spent to cast that spell" (eff.e19.then.unless)
    const manaSpentCond = s.cond.cond === 'not' && s.cond.of.cond === 'compare' && typeof s.cond.of.left === 'object' && s.cond.of.left.q === 'spellManaSpent';
    // cloud std-dsk (CR 608.2c): "then discard a card unless you control another creature with power 2 or less" (eff.e19.then.unless with a control condition)
    const existsCond = s.cond.cond === 'not' && s.cond.of.cond === 'exists';
    // trek-9 (CR 608.2c, 122.1; family unless-counters): "then discard a card unless there are three or more quest counters on ~": the negation of a count of counters on
    // one object reaching a number (the parser's eff.e19.then.unless over the condition "there are N or more <kind> counters on <object>")
    const countersCond = s.cond.cond === 'not' && s.cond.of.cond === 'compare' && typeof s.cond.of.left === 'object' && s.cond.of.left.q === 'counters';
    // trek-19 (CR 608.2c, 122.1; Anthropological Mission): the same count said as a property of the object, "unless ~ has three or more quest counters on it"
    // (the parser reads that wording as a match on the object's counters, not as a count)
    const selfCountersCond = s.cond.cond === 'not' && s.cond.of.cond === 'matches' && s.cond.of.object.ref === 'self' && s.cond.of.filter.counters !== undefined;
    // edh-c-28 (CR 608.2c, 119.1; Vampire Lacerator): "you lose 1 life unless an opponent has 10 or less life": the negation of a life total some opponent has
    const lifeCountCond = s.cond.cond === 'not' && s.cond.of.cond === 'compare' && typeof s.cond.of.left === 'object' && s.cond.of.left.q === 'countPlayers' && s.cond.of.left.lifeIs !== undefined;
    // edh-c-30 (CR 608.2c, 122.1f; Ravenous Necrotitan): "sacrifice a creature unless an opponent has three or more poison counters": the negation of "an opponent has N or more poison counters" (parser/holes/cond.ts#poisonCounters)
    const poisonCond = s.cond.cond === 'not' && s.cond.of.cond === 'compare' && typeof s.cond.of.left === 'object' && s.cond.of.left.q === 'countPlayers' && s.cond.of.left.poisonIs !== undefined;
    if (!hasElse && s.cond.cond === 'not' && (poisonCond || lifeCountCond || namesCond || s.cond.of.cond === 'wasCast' || turnHistory(s.cond.of) || manaSpentCond || existsCond || countersCond || selfCountersCond)) {
      // M6-5 (CR 608.2c, 702.138b): "sacrifice it unless it escaped" is "if it didn't escape, sacrifice it": the instruction, then "unless" and the condition
      // it does not happen under. Only for a cast-history condition, the one family the parser builds this way (eff.m6.sacrifice.unlessEscaped)
      const negated = s.cond.of;
      const [usual, unless] = withVariants(st, [
        (v): string => { const c = K.cond(s.cond, v); const then = K.steps(s.then, v); return afterTrigger ? `${then} if ${c}` : `if ${c}, ${then}`; },
        (v): string => { const then = K.steps(s.then, v); return `${then} unless ${K.cond(negated, v)}`; },
      ]);
      // edh-c-66 (CR 608.2c; Katara, Seeking Revenge): and after a plain instruction ", then discard a card unless ..." (Clause.commaThen), as the sentence after a break says it
      return plain(alt(usual!, unless!), { standalone: true, ...(afterTrigger ? {} : { leadThen: true, commaThen: true }) });
    }
    // edh-cast-9 (CR 701.6a, 202.3, 701.20a, 608.2c; Counterbalance, the parser's template eff.edhc9.counter.ifSameManaValueAsRevealed): "Counter that spell if it has the same
    // mana value as the revealed card.": the condition after the instruction, on the object the instruction counters, compared with the one card a reveal just showed
    const sameMv = !hasElse && !afterTrigger ? sameManaValueCounter(s) : null;
    if (sameMv !== null && sameMv.other.ref === 'bound' && st.info.get(`b:${sameMv.other.name}`)?.revealedTop === true && st.info.get(`b:${sameMv.other.name}`)?.plural === false) {
      const then = K.steps(s.then, st);
      return plain(`${then} if it has the same mana value as the revealed card`, { standalone: true, leadThen: true });
    }
    if (!hasElse) {
      const c = K.cond(s.cond, st);
      const outerIf = st.stepIf;
      st.stepIf = s.cond; // Cloud std-fin: "the difference" inside the branch (render/qty.ts#isDifference)
      const outerFocus = st.focus;
      // r4-moved: "If you discard a land card this way, put it ..." (the parser's rule); std-rx10 (the parser's std-r8 rule, parser/lower/anaphora.ts#condSubject, CR 608.2c):
      // "If the creature you control entered this turn, put a +1/+1 counter on it.": in the branch a bare pronoun is the one target the condition tests
      const condFocus = movedCondFocus(s.cond, st) ?? testedTarget(s.cond) ?? revealedCondFocus(s.cond, st) ?? (testsCostSacrificed(s.cond) ? 'costSacrificed' : undefined); // p2-dig-2: revealedCondFocus; edh-d-95: the sacrificed creature (parser/lower/anaphora.ts#sacrificedCondMention)
      if (condFocus !== undefined) st.focus = condFocus;
      let then: string;
      let revealSplit: [string, string] | null = null; // edh-next-142: "you may reveal it if C. If you do, ..." (mayRevealThenDid), said on a copy of the state
      try {
        const pre = mayRevealThenDid(s.then) ? cloneState(st) : null;
        then = K.steps(s.then, st);
        if (pre !== null) revealSplit = [K.steps(s.then.slice(0, 1), pre), K.steps(s.then.slice(1), pre)];
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
      if (also === null && s.then.length === 1 && (s.then[0]!.op === 'winGame' || s.then[0]!.op === 'loseGame' || s.then[0]!.op === 'loseLife' || s.then[0]!.op === 'extraTurn' /* edh-d-34: Seedtime */ || (s.then[0]!.op === 'damage' && (s.then[0] as StepOf<'damage'>).source.ref === 'self' /* edh-c-39: Swirling Sandstorm, family damage-trailing-if */))) {
        return plain(alt(`if ${c}, ${then}`, `${then} if ${c}`), { standalone: true, leadThen: true });
      }
      // std-ru (CR 608.2c, 110.2): "You may put it onto the battlefield if it's your turn.": your option to put one object onto the battlefield, offered only while the
      // condition holds, with the condition after the instruction (the parser's template eff.stdru.may.put.bf.ifCond builds exactly this: one `may` of yours around one move)
      // edh-next-142 (CR 701.20a, 608.2c, 608.2d; family may-reveal-if): "You may reveal that card if it has three or more colored mana symbols in its mana cost. If you do, ..." (Omnath,
      // Locus of All): the option to reveal one named card, offered only while the condition holds, with the condition after the option and its "If you do" sentence after both
      if (revealSplit !== null) return plain(alt(`if ${c}, ${then}`, `${revealSplit[0]} if ${c}. ${revealSplit[1]}`), { standalone: true, leadThen: true });
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
      // edh-c-66 (CR 608.2c; Kami's Flare): and the condition after a damage instruction, "~ also deals 2 damage to that permanent's controller if you control a modified creature"
      // (the parser's template eff.edhv66.also.damage.ifCond builds exactly this: one `damage` step)
      const alsoTrailing = also !== null && s.then.length === 1 && s.then[0]!.op === 'damage' ? [`${also} if ${c}`] : [];
      return plain(also === null ? `if ${c}, ${then}` : alt(`if ${c}, ${then}`, `if ${c}, ${also}`, ...(itAlso !== null ? [`if ${c}, ${itAlso}`] : []), ...alsoTrailing), { standalone: true, leadThen: true });
    }
    // "If C, X. Otherwise, Y." or the self-replacement of CR 614.15, "Y. If C, X instead." (the else branch is the instruction "instead" replaces; WP23).
    // The "instead" reading is offered only when X replaces Y as a whole: one instruction each, the same op on the same things (WP23 review: "you may X
    // instead" keeps Y when declined, a subset of a group keeps the rest, CR 608.2d, 614.15)
    // FAST5X E1: with a condition decided as the spell is cast, one instruction may replace another as a whole (render/self-replacement.ts#isCastChoice), and
    // Oracle also writes "If the gift was promised, instead counter target spell" (the parser's rider rid.fast5x.instead.front)
    // edh-mana-keywords-1 (CR 614.15, 106.1, 106.7): "Add one mana of any type that a land you control could produce. If ~ has a +1/+1 counter on it, add three mana of
    // that type instead." (Incubation Druid): the same production of one type for a count of mana; "that type" is the type chosen in the sentence it replaces
    const typeCount = thatTypeInstead(s);
    if (typeCount !== null) return plain(`${K.steps(s.else!, st)}. If ${K.cond(s.cond, st)}, add ${typeCount} mana of that type instead`, { standalone: true });
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
    // edh-d-15 (CR 608.2c, 111.1; Brood Birthing): "If C, create three 0/1 ... tokens. They have "...". Otherwise, create one of those tokens.": the other branch creates ONE of the very
    // tokens of the first (the same token, player and flags; the parser's rider rid.edhd15.otherwise.createOneOfThoseTokens)
    const oneOfThose = (() => {
      const a = s.then.length === 1 ? s.then[0] : undefined;
      const b = s.else!.length === 1 ? s.else![0] : undefined;
      if (a?.op !== 'createToken' || b?.op !== 'createToken' || typeof a.count !== 'number' || a.count < 2 || b.count !== 1) return false;
      const { count: _a, ...ra } = a;
      const { count: _b, ...rb } = b;
      return JSON.stringify(ra) === JSON.stringify(rb);
    })();
    // edh-next-65 (CR 614.15, 603.7b, 707.10; Sea Gate Stormcaller): two delayed copies of the next spell cast, the second twice: "Copy the next ... spell you cast this turn when you cast it. If C,
    // copy that spell twice instead." (the parser's rider rid.edhn65.instead.nextSpell.copy.twice)
    const delayedTwice = s.then.length === 1 && s.else!.length === 1 && s.then[0]!.op === 'delay' && s.else![0]!.op === 'delay'
      && notSelfReplacement(s.else![0], s.then[0]) === null;
    const forms = withVariants(st, [
      ...(delayedTwice ? [(v: RenderState): string => `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, copy that spell twice instead`] : []),
      (v): string => `if ${K.cond(s.cond, v)}, ${K.steps(s.then, v)}. Otherwise, ${K.steps(s.else!, v)}`,
      // edh-d-78 (CR 608.2c, 202.3; Transmute Artifact): after a comparison of two mana values "less than or equal to", the other outcome is "If it's greater, ..." ("the difference" inside it is the
      // comparison turned round)
      ...(s.cond.cond === 'compare' && s.cond.op === '<=' && typeof s.cond.left === 'object' && typeof s.cond.right === 'object' && s.cond.left.q === 'stat' && s.cond.right.q === 'stat' && s.cond.left.stat === 'manaValue' && s.cond.right.stat === 'manaValue'
        ? [(v: RenderState): string => {
          const outer = v.stepIf;
          const lt = s.cond as Extract<Condition, { cond: 'compare' }>;
          v.stepIf = { cond: 'compare', left: lt.left, op: '>', right: lt.right } as Condition;
          try { return `if ${K.cond(s.cond, v)}, ${K.steps(s.then, v)}. If it's greater, ${K.steps(s.else!, v)}`; } finally { if (outer === undefined) delete v.stepIf; else v.stepIf = outer; }
        }] : []),
      // CLOUD std-msh (CR 608.2c): "Create a tapped 2/1 Villain token if there are two or more creature cards in your graveyard. Otherwise, mill two cards.": the
      // condition said after its one instruction (parser/lower/riders.ts builds this from a guarded instruction and the rider fl.otherwise)
      ...(s.then.length === 1 ? [(v: RenderState): string => `${K.steps(s.then, v)} if ${K.cond(s.cond, v)}. Otherwise, ${K.steps(s.else!, v)}`] : []),
      // (a token with a quoted ability ends the first sentence with the quote, whose own period closes it: `They have "...." Otherwise, ...`)
      ...(oneOfThose ? [(v: RenderState): string => `if ${K.cond(s.cond, v)}, ${K.steps(s.then, v)}${(s.then[0] as StepOf<'createToken'>).token.abilities?.length ? ' ' : '. '}Otherwise, create 1 of those tokens`] : []),
      // edh-b-11 (CR 608.2c; family if-it-doesnt-after-guard; Marcus, Mutant Mayor): and the second sentence said "If it doesn't, ..." (the parser's rider rid.edhb11.ifItDoesnt): the instruction did not happen
      ...(s.then.length === 1 ? [(v: RenderState): string => `${K.steps(s.then, v)} if ${K.cond(s.cond, v)}. If it doesn't, ${K.steps(s.else!, v)}`] : []),
      // std-rj (CR 119.3, 608.2h): "You lose life equal to that card's mana value if C. Otherwise, each opponent loses that much life.": the instruction of the other branch is
      // the same life amount, which Oracle says once and then calls "that much" (the parser's rule for "that much" in an `else`, lower/quantities.ts#elseSameLifeAmount)
      ...(thatMuch !== null ? [(v: RenderState): string => `${K.steps(s.then, v)} if ${K.cond(s.cond, v)}. Otherwise, ${K.steps([thatMuch], v)}`] : []),
      // edh-c-28 (CR 608.2c, 119.3; Sheoldred's Restoration): the same with the condition first, "If this spell was kicked, you gain life equal to that card's mana value. Otherwise, you lose that much life."
      ...(thatMuch !== null ? [(v: RenderState): string => `if ${K.cond(s.cond, v)}, ${K.steps(s.then, v)}. Otherwise, ${K.steps([thatMuch], v)}`] : []),
      ...(wide ? [(v: RenderState): string => {
        const other = K.steps(s.else!, v);
        // edh-perms-6 (CR 608.2c, 301.5a, 303.4a; the parser's rule, anaphora.ts#attachedTested; Blade of the Bloodchief): in the branch of "If equipped creature is a Vampire, ..." a bare
        // pronoun is the enchanted or equipped object the condition tests
        // edh-d-95 (the parser's rule, parser/lower/anaphora.ts#sacrificedRiderMention; Shilgengar, Sire of Famine): ... and the creature the cost sacrificed, which "If you sacrificed an Angel this
        // way" tests ("create a number of Blood tokens equal to its toughness instead")
        const tested = testsAttachedObject(s.cond) ? 'attached' : testsCostSacrificed(s.cond) ? 'costSacrificed' : undefined;
        const saved = v.focus;
        if (tested !== undefined) v.focus = tested;
        try {
          return `${other}. If ${K.cond(s.cond, v)}, ${K.steps(s.then, v)} instead`;
        } finally {
          if (tested !== undefined) { if (saved === undefined) delete v.focus; else v.focus = saved; }
        }
      }] : []),
      ...(wide ? [(v: RenderState): string => {
        const other = K.steps(s.else!, v);
        return `${other}. If ${K.cond(s.cond, v)}, instead ${K.steps(s.then, v)}`;
      }] : []),
      // edh-d-5 (CR 614.15, 701.19c, 608.2c; Kirtar's Wrath): "Destroy all creatures. They can't be regenerated. If C, instead destroy all creatures, then create two 1/1 tokens. Creatures
      // destroyed this way can't be regenerated.": the destroy said again with the instructions that follow it, its no-regeneration rider in a sentence of its own after them
      ...(wide && destroyAgainThenMore(s.then, s.else!) ? [(v: RenderState): string => {
        const d = s.then[0] as StepOf<'destroy'>;
        const other = K.steps(s.else!, v);
        const first = K.steps([{ ...d, regeneration: undefined }], v);
        return `${other}. If ${K.cond(s.cond, v)}, instead ${first}, then ${K.steps(s.then.slice(1), v)}. ${noRegeneration(d, v)}`;
      }] : []),
      // edh-next-129 (CR 614.15, 111.1; Mr. House, President and CEO, rid.edhn129.instead.thatTokenAnd): "Create a 3/3 ... token. If C, instead create that token and a Treasure token.": the same
      // creation again, then one more creation of other tokens by the same player; "that token" says the first creation, never written twice
      ...(thatTokenAnd(s.then, s.else!) ? [(v: RenderState): string => {
        const b = s.then[1] as StepOf<'createToken'>;
        return `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, instead create that token and ${tokenText(b.token, 1, false, v)}`;
      }] : []),
      // edh-d-7 (CR 614.15, 121.1; Kumena's Awakening, rid.edhd7.draw.eachPlayer.insteadOnlyYou): "Each player draws a card. If C, instead only you draw a card.": you alone draw the same number of cards
      ...(onlyYouDrawInstead(s.then, s.else!) ? [(v: RenderState): string => `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, instead only ${K.steps(s.then, v)}`] : []),
      // edh-next-61 (CR 614.15, 611.2a; Golden Demise, rid.edhn61.instead.only.pump.each): "All creatures get -2/-2 until end of turn. If C, instead only creatures your opponents control get -2/-2
      // until end of turn.": the same continuous effect on a narrower description of the same objects (render/self-replacement.ts#notSelfReplacement)
      ...(wide && s.then.length === 1 && s.else!.length === 1 && s.then[0]!.op === 'effect' && s.else![0]!.op === 'effect' ? [(v: RenderState): string =>
        `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, instead only ${K.steps(s.then, v)}`] : []),
      // edh-next-53 (CR 614.15, 701.17a; Increasing Confusion): "Target player mills X cards. If C, that player mills twice that many cards instead." (rid.edhn53.instead.mill.twice)
      ...(isSelfReplacement(s.then, s.else!) && doubledMill(s.then, s.else!) !== null ? [(v: RenderState): string =>
        `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, ${K.player(doubledMill(s.then, s.else!) as never, v, 'subject').text} mills twice that many cards instead`] : []),
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
      // edh-c-74 (CR 614.15, 120.3; Searing Blaze, rid.edhv74.if.damage.playerOrWalker.andCreature.instead): "~ deals 1 damage to target player or planeswalker and 1 damage to target creature that player
      // ... controls. If C, ~ deals 3 damage to that player or planeswalker and 3 damage to that creature instead.": the same source and the same two recipients, only the amounts differ
      ...(damageAlsoAmounts(s.then, s.else!) !== null && isSelfReplacement(s.then, s.else!) ? [(v: RenderState): string => {
        const [n, m] = damageAlsoAmounts(s.then, s.else!)!;
        return `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, ~ deals ${n} damage to that player or planeswalker and ${m} damage to that creature instead`;
      }] : []),
      // r4-repl (CR 614.15, 111.1): "Create a token that's a copy of target creature. If C, create five of those tokens instead." / "If C, instead create X of those
      // tokens, where X is ..." (the parser's riders rid.r4repl.instead.copies.count, rid.r4repl.instead.tokens.count, rid.r4repl.insteadFirst.tokens.whereX)
      ...(wide && thoseTokensCount(s.then, s.else!, st) !== null ? [(v: RenderState): string => {
        const n = thoseTokensCount(s.then, s.else!, v)!;
        const head = n.startsWith('X of those tokens, ') ? n : `${n} of those tokens`;
        // edh-d-86 (CR 111.1, 113.2c; Anax, Hardened in the Forge): a token with a quoted ability ends its sentence inside the quotation marks ('... with "This token can't block." If C, ...')
        const before = sentenceDone(K.steps(s.else!, v));
        return n.startsWith('X of those tokens, ') ? `${before} If ${K.cond(s.cond, v)}, instead create ${head}` : `${before} If ${K.cond(s.cond, v)}, create ${head} instead`;
      }] : []),
      // edh-c-52 (CR 614.15, 111.1; Throne of Empires): the condition after "instead", "Create a 1/1 token. Create five of those tokens instead if C." (rider rid.edhv52.instead.tokens.count.ifTrail)
      ...(wide && thoseTokensCount(s.then, s.else!, st) !== null && !thoseTokensCount(s.then, s.else!, st)!.startsWith('X') ? [(v: RenderState): string =>
        `${K.steps(s.else!, v)}. create ${thoseTokensCount(s.then, s.else!, v)!} of those tokens instead if ${K.cond(s.cond, v)}`] : []),
      // edh-top-15 (CR 614.15, 508.4): "Create two tapped 1/1 tokens. If C, instead create two of those tokens that are tapped and attacking." (rid.edht15.instead.tokensTappedAttacking)
      ...(tappedTokensAttackingInstead(s.then, s.else!) !== null ? [(v: RenderState): string =>
        `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, instead create ${String(tappedTokensAttackingInstead(s.then, s.else!))} of those tokens that are tapped and attacking`] : []),
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
        }, (v: RenderState): string => {
          // edh-next-22 (CR 614.15, 701.20e; family if-first-instead-every-card; See the Truth): the condition first, "If C, put each of those cards into your hand instead."
          const other = K.steps(s.else!, v);
          const group = ((s.then[0] as StepOf<'move'>).what as { filter: { is: ObjRef } }).filter.is;
          return `${other}. If ${K.cond(s.cond, v)}, put each of ${K.obj(group, v, 'object').text} into your hand instead`;
        }] : []),
      // edh-c-28 (CR 614.15, 202.3, 702.33d; Overload, rid.edhv28.destroy.thatArtifact.ifMv.instead): "Destroy target artifact if its mana value is 2 or less. If this spell was kicked, destroy that
      // artifact if its mana value is 5 or less instead.": the same destroy of the same object under a larger limit
      ...(destroyLimitInstead(s.then, s.else!) !== null ? [(v: RenderState): string => {
        const other = K.steps(s.else!, v);
        const lim = destroyLimitInstead(s.then, s.else!)!;
        return `${other}. If ${K.cond(s.cond, v)}, destroy ${K.obj(lim.what, v, 'object').text} if its mana value is ${lim.then} or less instead`;
      }] : []),
      // r4-repl (CR 614.15, 613.4b): "If C, it has base power and toughness 1/1 until end of turn instead." (rid.r4repl.instead.basePT.only)
      ...(wide && basePtOnly(s.then, s.else!) !== null ? [(v: RenderState): string => `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, it has base power and toughness ${basePtOnly(s.then, s.else!)!} until end of turn instead`] : []),
      // r4-repl (CR 614.15, 406.1): "If C, exile the top three cards instead." (rid.r4repl.instead.exileTop.count)
      ...(wide && typeof exileTopCount(s.then, s.else!) === 'number' ? [(v: RenderState): string => `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, exile the top ${String(exileTopCount(s.then, s.else!))} cards instead`] : []),
      // r4-repl (CR 614.15, 120.3): "If C, the creature you control deals twice that much damage instead." (rid.r4repl.instead.sourceYouControl.twice)
      ...(wide && doubledTargetCreatureDamage(s.then, s.else!, st) ? [(v: RenderState): string => `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, the creature you control deals twice that much damage instead`] : []),
      // edh-replace-4 (CR 614.15, 120.10): "If C, excess damage is dealt to that creature's controller instead." (rid.edhr4.instead.excessToController)
      ...(wide && excessToControllerInstead(s.then, s.else!, s.cond, st) ? [(v: RenderState): string => `${K.steps(s.else!, v)}. If the creature you control has trample, excess damage is dealt to that creature's controller instead`] : []),
      ...(doubledSelfDamage(s.then, s.else!) ? [(v: RenderState): string => `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, it deals twice that much damage to itself instead`] : []),
      ...(isSelfReplacement(s.then, s.else!) && sameDamageButAmount(s.then[0], s.else![0]) ? ['it', '~'].flatMap((who) => ['creature', 'permanent'].map((noun) => (v: RenderState): string => {
        const other = K.steps(s.else!, v);
        const amount = (s.then[0] as StepOf<'damage'>).amount;
        return `${other}. ${who} deals ${typeof amount === 'number' ? String(amount) : K.qty(amount, v)} damage to that ${noun} instead if ${K.cond(s.cond, v)}`;
      })) : []),
      // edh-cast-14 (CR 118.9, 608.2c; family play-this-way-free-rider, Ignite the Future): "Until the end of your next turn, you may play those cards. If C, you may play cards this
      // way without paying their mana costs." is the `if` whose two branches are the same permission to play, the `then` one for no mana cost (the parser's rider rid.edhc14.if.playThisWay.free)
      ...(freePlayBranches(s) ? [(v: RenderState): string => `${K.steps(s.else!, v)}. if ${K.cond(s.cond, v)}, you may play cards this way without paying their mana costs`] : []),
      // edh-next-141 (CR 614.15, 608.2d, 613.1f; Éowyn, Lady of Rohan): "Target creature gains your choice of first strike or vigilance until end of turn. If that creature is equipped, it gains
      // first strike and vigilance until end of turn instead.": one grant of keywords to the object of a keyword choice replaces the choice and its grants (the parser's fold, riders.ts#applyRider)
      ...(s.then.length === 1 && keywordChoiceGrant(s.else!) !== null && sameGrantTarget(s.then[0], keywordChoiceGrant(s.else!)!)
        ? [(v: RenderState): string => `${K.steps(s.else!, v)}. If ${K.cond(s.cond, v)}, ${K.steps(s.then, v)} instead`] : []),
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
    if (each !== null && s.over.ref === 'target') return each;
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
    if (putBoundName(over, st) !== undefined) {
      // edh-zones-22 (CR 608.2c, 608.2f; Terastodon): what ONE destroy of identified objects put into graveyards, as each last existed (render/steps-zones.ts#destroyedOne): "For each permanent put into a graveyard this way, its controller creates ..."
      const info = st.info.get(`b:${putBoundName(over, st)!}`)!;
      thing = nounsThisWay(info, ['destroyed this way']); // (a destroy of identified objects: either wording says it)
      bind(st, s.as, { nouns: info.nouns, plural: false });
    } else if (over.ref === 'each' && 'filter' in over) {
      thing = K.np(over.filter, st, { det: 'none', forEach: true }); // FAST5 T39: also "for each creature your opponents control" (NpOpts.forEach)
      const loopNouns = K.nounsOf(over.filter);
      bind(st, s.as, { nouns: loopNouns, plural: false, iterates: loopNouns }); // trek-8: RefInfo.iterates
    } else if (over.ref === 'each' && 'who' in over && (over.who === 'opponent' || over.who === 'player')) {
      // "For each opponent, that player ..." (CR 608.2f; WP23): the players one at a time, each named "that player" in the body
      thing = over.who;
      bind(st, s.as, { nouns: over.who === 'opponent' ? ['player', 'opponent'] : ['player'], plural: false, player: true, iterates: over.who });
    } else if (over.ref === 'otherOpponents' && over.than !== undefined && over.than.ref === 'event' && over.than.role === 'defender' && Object.keys(over.than).length === 2) {
      // edh-next-130 (CR 608.2f, 506.2; Shredder, Shadow Master): "for each other opponent, ... that player": after "whenever ~ attacks a player", the opponents other than the attacked one, each "that player" in the body
      thing = 'other opponent';
      bind(st, s.as, { nouns: ['player', 'opponent'], plural: false, player: true, iterates: 'opponent' });
    } else if (over.ref === 'chose') {
      // edh-players-13 (CR 608.2d, 608.2f; Seize the Spotlight, Master of Ceremonies): "For each player who chose fame, ...": the players, one at a time, whose own choice was that word
      thing = `player who chose ${over.value}`;
      bind(st, s.as, { nouns: ['player'], plural: false, player: true, iterates: 'player' });
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
    } else if (over.ref === 'bound' && (st.info.get(`r:${over.name}`)?.moved === 'destroyed' || st.info.get(`r:${over.name}`)?.moved === 'exiled' || st.info.get(`r:${over.name}`)?.thisWay === 'put into a graveyard this way' /* edh-mana-keywords-7: a destroy's `boundTo` */) && (st.info.get(`r:${over.name}`)?.nouns ?? []).some((n) => n !== 'card' && n !== 'object')) {
      // edh-mana-keywords-5 (CR 608.2c, 608.2h; family for-each-this-way): "For each creature exiled this way, its controller creates ...": each object the ONE earlier destroy or exile of the
      // ability moved, as it last existed, said by the nouns that instruction recorded (render/steps-zones.ts#destroy, move)
      const info = st.info.get(`r:${over.name}`)!;
      thing = nounsThisWay(info);
      bind(st, s.as, { nouns: info.nouns, plural: false });
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
    // pc-keywords-mana-3 (CR 701.55): "Each opponent faces a villainous choice -- That player discards a card, or you draw a card."
    const only0 = s.do.length === 1 ? s.do[0] : undefined;
    if (only0?.op === 'may' && only0.villainous === true && JSON.stringify(only0.who) === JSON.stringify({ ref: 'bound', name: s.as }) && over.ref === 'each' && 'who' in over && (over.who === 'opponent' || over.who === 'player')) {
      return plain(`each ${thing} faces a villainous choice -- ${villainousOptions(only0, st)}`, { standalone: true });
    }
    // pc-keywords-mana-3 (CR 701.55, 119.3): "Each opponent who lost 3 or more life this turn faces a villainous choice -- ..." (a guard on the iteration player)
    const self0 = JSON.stringify({ ref: 'bound', name: s.as });
    if (only0?.op === 'if' && only0.else === undefined && only0.intervening === undefined && only0.then.length === 1 && over.ref === 'each' && 'who' in over && over.who === 'opponent'
      && only0.cond.cond === 'compare' && only0.cond.op === '>=' && typeof only0.cond.right === 'number' && JSON.stringify(only0.cond.left) === JSON.stringify({ q: 'lifeLostThisTurn', of: { ref: 'bound', name: s.as } })) {
      const inner = only0.then[0]!;
      if (inner.op === 'may' && inner.villainous === true && JSON.stringify(inner.who) === self0) {
        return plain(`each ${thing} who lost ${only0.cond.right} or more life this turn faces a villainous choice -- ${villainousOptions(inner, st)}`, { standalone: true });
      }
    }
    // edh-zones-12 (CR 608.2c, 608.2f; Mizzix's Mastery): inside "For each card exiled this way, copy it, ..." the card the loop is on is the one "it" names (the focus of the body's first instruction)
    const eachExiledCard = over.ref === 'each' && 'filter' in over && over.filter.zone === 'exile' && over.filter.is?.ref === 'bound' && st.info.get(`b:${over.filter.is.name}`)?.thisWay === 'exiled this way';
    const outerFocus = st.focus;
    if (eachExiledCard) st.focus = `b:${s.as}`;
    const body = K.steps(s.do, st);
    if (eachExiledCard) { if (outerFocus === undefined) delete st.focus; else st.focus = outerFocus; }
    // std-rx32 (CR 608.2f): what every iteration bound under `gather` is several objects after the loop ("those tokens")
    const gathered = s.gather !== undefined ? st.info.get(`b:${s.gather}`) : undefined;
    if (gathered !== undefined) bind(st, s.gather, { ...gathered, plural: true });
    // edh-d-15 (CR 101.3, 608.2c, 119.3; Skull Storm, family each-who-cant-loses-half): "Each opponent who can't loses half their life, rounded up." is the loop over the players who
    // couldn't (render/steps-util.ts#bindCant) with the half-life loss of the iterating player as its one instruction
    if (over.ref === 'bound' && st.info.get(`b:${over.name}`)?.cant !== undefined && s.do.length === 1 && s.do[0]!.op === 'loseLife' && s.guard === undefined && s.gather === undefined
      && JSON.stringify(s.do[0]!.who) === '{"ref":"iterating"}' && JSON.stringify(s.do[0]!.amount) === '{"q":"math","op":"ceilDiv","args":[{"q":"life","of":{"ref":"iterating"}},2]}') {
      return plain(alt(`for each ${thing}, ${body}`, `each ${thing} loses half their life, rounded up`), { standalone: true });
    }
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
    // (one at a time, which changes no other player's amount); only that exact body, a reading of the group above (family half-of-own); edh-next-14: each player too (Scourge of the Skyclaves)
    if (over.ref === 'each' && 'who' in over && (over.who === 'opponent' || over.who === 'player') && s.do.length === 1 && only?.op === 'loseLife' && only.guard === undefined && only.as === undefined
      && JSON.stringify(only.who) === JSON.stringify(self) && JSON.stringify(only.amount) === JSON.stringify({ q: 'math', op: 'ceilDiv', args: [{ q: 'life', of: self }, 2] })) {
      return plain(`each ${thing} loses half their life, rounded up`, { standalone: true });
    }
    // edh-b-9 (CR 119.5, 608.2f; Shaman of Forgotten Ways): "each player's life total becomes the number of creatures they control": each player's total is set to a number counted for that player
    // (one at a time, which changes no other player's amount); only that exact body, the count of a group that player controls
    if (over.ref === 'each' && 'who' in over && over.who === 'player' && s.do.length === 1 && only?.op === 'setLife' && only.guard === undefined && only.as === undefined
      && JSON.stringify(only.who) === JSON.stringify(self) && typeof only.value === 'object' && only.value.q === 'count' && only.value.of.ref === 'each' && 'filter' in only.value.of
      && JSON.stringify(only.value.of.filter.controller) === JSON.stringify({ ref: 'iterating' })) {
      return plain(`each ${thing}'s life total becomes ${K.qty(only.value, st)}`, { standalone: true });
    }
    // edh-b-7 (CR 119.3, 107.1a, 608.2f; Dire Fleet Ravager): "each player loses a third of their life, rounded up": the same shape with a third (of any group of players)
    if (over.ref === 'each' && 'who' in over && (over.who === 'opponent' || over.who === 'player') && s.do.length === 1 && only?.op === 'loseLife' && only.guard === undefined && only.as === undefined
      && JSON.stringify(only.who) === JSON.stringify(self) && JSON.stringify(only.amount) === JSON.stringify({ q: 'math', op: 'ceilDiv', args: [{ q: 'life', of: self }, 3] })) {
      return plain(`each ${thing} loses a third of their life, rounded up`, { standalone: true });
    }
    // CLOUD std-dft (CR 701.17a, 608.2f): "any number of target players each mill cards equal to the number of cards in their graveyard": each of the target players
    // mills as many cards as their own graveyard holds (one at a time, which changes no other player's number); only that exact body
    if (over.ref === 'target' && s.do.length === 1 && only?.op === 'mill' && only.guard === undefined && only.as === undefined
      && JSON.stringify(only.who) === JSON.stringify(self) && JSON.stringify(only.count) === JSON.stringify({ q: 'zoneSize', zone: 'graveyard', of: self })) {
      return plain(`${thing} each mill cards equal to the number of cards in their graveyard`, { standalone: true });
    }
    // edh-d-74 (CR 118.12, 608.2c, 608.2f, 701.21a; Killing Wave, template eff.edhd74.forEach.itsController.sacrificesIt.unlessPay): "For each creature, its controller sacrifices it unless they pay X
    // life.": for each object, its controller (one at a time) pays the cost or sacrifices the object;
    const upay = s.do.length === 1 ? s.do[0] : undefined;
    if (over.ref === 'each' && 'filter' in over && upay?.op === 'pay' && upay.guard === undefined && upay.as === undefined && upay.then === undefined && upay.times === undefined && upay.mandatory === undefined
      && upay.else?.length === 1 && upay.else[0]!.op === 'sacrificeChoice' && Object.keys(upay.else[0]!).sort().join(',') === 'count,filter,op,who' && upay.else[0]!.count === 1
      && JSON.stringify(upay.else[0]!.filter) === JSON.stringify({ is: self }) && JSON.stringify(upay.else[0]!.who) === JSON.stringify({ ref: 'controllerOf', object: self })
      && JSON.stringify(upay.who) === JSON.stringify({ ref: 'controllerOf', object: self })) {
      const theirs = `${lead} ${thing}, its controller sacrifices it unless they ${K.costVerbs(upay.cost, cloneState(st), 'pl')}`;
      return plain(theirs, { standalone: true, leadThen: true });
    }
    // edh-fix-3 (edh-zones-3 widened perTargetPlayers to a group): "For each opponent, that player draws a card." is still said the long way as well as "Each opponent draws a card."
    if (each !== null) return plain(alt(each.imp, `${lead} ${thing}, ${body}`), { leadThen: true }); // (no `standalone`: "Draw two cards, then each opponent mills ..." joins after ", then")
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
    if (s.process === true && s.optional === true) return plain('you may repeat this process any number of times', { standalone: true }); // edh-zones-5 (CR 608.2c)
    // edh-zones-26 (CR 608.2c, 608.2d; Dance with Calamity): "As many times as you choose, you may exile the top card of your library." (the player decides before each run, the first included)
    if (s.optional === true && s.until === undefined && s.again !== true && s.guard === undefined && s.as === undefined && s.do.length === 1) {
      const text = `as many times as you choose, you may ${K.steps(s.do, st)}`;
      if (s.gather !== undefined) bind(st, s.gather.as, { nouns: ['card'], plural: true, zone: 'exile', thisWay: 'exiled this way' });
      return plain(text, { standalone: true });
    }
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
    // pc-tokens-1 (CR 608.2c, 608.2d): the number of players of the group of the `may` right before who did it, "For each opponent who does, create a Treasure token."
    if (typeof t === 'object' && t.q === 'resultCount' && t.which === undefined && t.maxPerOwner === undefined) {
      const group = st.info.get(`b:${t.step}`)?.eachMay;
      // edh-zones-8 (CR 701.23a): "For each opponent who searches a library this way, search your library ..." (the option was a search)
      if (group !== undefined) return plain(`for each ${group} who ${st.info.get(`b:${t.step}`)?.eachMaySearches === true ? 'searches a library this way' : 'does'}, ${body}`, { standalone: true, leadThen: true });
    }
    // edh-next-91 (CR 608.2c, 608.2d; Tempt with Immortality): the cards the opponents chose and moved, one each, are the opponents who did it
    if (typeof t === 'object' && t.q === 'count' && t.of.ref === 'bound' && st.info.get(`b:${t.of.name}`)?.eachChoseMoved === 'opponent') return plain(`for each opponent who does, ${body}`, { standalone: true, leadThen: true });
    const each = typeof s.times === 'object' ? countPartsOf(s.times, st) : null;
    // edh-players-23 (CR 701.53a, 608.2c; The Argent Etchings): one incubate done a number of times is "Incubate 2 five times" (the number of counters, then the times)
    const incubated = s.do.length === 1 && s.do[0]!.op === 'action' && (s.do[0] as StepOf<'action'>).action === 'incubate' ? (s.do[0] as StepOf<'action'>) : null;
    if (incubated !== null && incubated.n !== undefined && incubated.who.ref === 'you' && incubated.guard === undefined && incubated.as === undefined && typeof s.times === 'number' && s.times >= 2) {
      // edh-c-48 (CR 107.3, 701.53a; Glistening Dawn): a computed number of counters is "Incubate X twice, where X is the number of lands you control"
      // (the number is fixed once by the `let` before the repeat, CR 608.2h: "where X is" is read once, whatever incubating changes)
      if (typeof incubated.n === 'object' && incubated.n.q === 'var') { const v = st.vars.get(incubated.n.name); if (v === undefined) throw new NoRenderer('a fixed incubate number with no `let`'); v.used = true; return plain(/^\d+$/.test(v.phrase) ? `incubate ${v.phrase} ${n}` : `incubate X ${n}, where X is ${v.phrase}`); }
      if (typeof incubated.n === 'object' && incubated.n.q !== 'X') return plain(`incubate X ${n}, where X is ${K.qty(incubated.n, st)}`);
      return plain(`incubate ${K.qty(incubated.n, st)} ${n}`);
    }
    // edh-d-61 (CR 701.53a, 107.3, 608.2c; Progenitor Exarch): one incubate of a fixed number done X times is "incubate 3 X times"
    if (incubated !== null && typeof incubated.n === 'number' && incubated.who.ref === 'you' && incubated.guard === undefined && incubated.as === undefined && typeof s.times === 'object' && s.times.q === 'X' && s.until === undefined && s.optional === undefined) {
      return plain(`incubate ${incubated.n} X times`);
    }
    // edh-b-1 (CR 701.56a, 608.2c; The Tenth Doctor): one time travel done a number of times is "Time travel three times"
    const travelled = s.do.length === 1 && s.do[0]!.op === 'action' && (s.do[0] as StepOf<'action'>).action === 'timeTravel' ? (s.do[0] as StepOf<'action'>) : null;
    if (travelled !== null && travelled.who.ref === 'you' && travelled.guard === undefined && travelled.as === undefined && typeof s.times === 'number' && s.times >= 2 && s.until === undefined && s.optional === undefined) {
      return plain(`time travel ${n}`);
    }
    // edh-next-101 (CR 701.38a, 608.2c; Selvala's Stampede; family repeat-put-per-vote): "you may put a permanent card from your hand onto the battlefield for each free vote" (one optional put for each vote a word got)
    if (typeof s.times === 'object' && s.times.q === 'votes' && typeof s.times.choice === 'string' && /^you may put .+ from your hand onto the battlefield( under your control)?$/.test(firstAlt(body))) {
      return plain(alt(`do the following ${n}: ${body}`, `${firstAlt(body).replace(/ under your control$/, '')} for each ${s.times.choice} vote`), { standalone: true, leadThen: true });
    }
    if (each !== null) return plain(alt(`do the following ${n}: ${body}`, `repeat the following process ${n}: ${body}`, `for each ${each.singular}, ${body}`), { standalone: true, leadThen: true });
    // edh-misc-2 (CR 608.2c; Torment of Hailfire): the process may be the next sentence, "Repeat the following process X times. Each opponent loses 3 life unless ..."
    return plain(alt(`do the following ${n}: ${body}`, `repeat the following process ${n}: ${body}`, `repeat the following process ${n}. ${body}`), { standalone: true });
  },

  let: (s: StepOf<'let'>, st: RenderState): Clause => {
    st.vars.set(s.name, { phrase: K.qty(s.value, st), used: false });
    return EMPTY_CLAUSE;
  },

  chooseObjects: (s: StepOf<'chooseObjects'>, st: RenderState): Clause => {
    if (s.eachColorPair === true) throw new NoRenderer('one card of each color pair outside its fold (render/fold.ts#putOfThemAndRest)'); // edh-next-142
    const { min, max } = s;
    const from = s.from;
    // FAST5 T46 (CR 701.20a, 701.20e, 608.2d): "You choose a nonland card from it", out of a hand an earlier step revealed or looked at
    // edh-c-104 (CR 701.20a, 701.20e, 608.2d; Agonizing Memories): "choose two cards from it", exactly two of a hand an earlier step looked at or revealed
    const two = from.ref === 'each' && s.min === 2 && s.max === 2 && s.random !== true && s.guard === undefined && from.filter.is?.ref === 'bound' && from.filter.zone === 'any'
      && st.info.get(`b:${from.filter.is.name}`)?.hand === true && Object.keys(from.filter).every((k) => k === 'is' || k === 'zone' || k === 'anyOf') && (from.filter.anyOf === undefined || from.filter.anyOf.length === 1);
    if (two && from.ref === 'each') {
      const handOwner = st.info.get(`b:${from.filter.is!.ref === 'bound' ? from.filter.is!.name : ''}`)?.handOwner;
      const desc = K.np({ ...(from.filter.anyOf?.[0] ?? {}), zone: 'hand' }, st, { det: 'none', plural: true, count: 'two', noZone: true });
      bind(st, s.as, { nouns: ['card'], plural: true, optional: false, ...(handOwner !== undefined ? { handOwner } : {}) });
      return byPlayer(s.who, st, 'choose', `${desc} from it`);
    }
    const inHand = handChoiceFromIt(s, st);
    if (inHand !== null) {
      // trek-3: and whose hand the card was chosen from (RefInfo.handOwner; render/fold-trek3.ts)
      const handOwner = from.ref === 'each' && from.filter.is?.ref === 'bound' ? st.info.get(`b:${from.filter.is.name}`)?.handOwner : undefined;
      bind(st, s.as, { nouns: ['card'], plural: false, optional: min === 0, ...(handOwner !== undefined ? { handOwner } : {}) });
      return min === 0 ? modal(s.who, st, `may choose ${inHand}`) : byPlayer(s.who, st, 'choose', inHand);
    }
    // C6 (CR 608.2c, 101.4): "for each player, choose a creature with power 2 or less that player controls": one choice for each player, the objects read with that
    // player as `{ref:'iterating'}` ("that player controls"); what was chosen is "chosen this way" or "those creatures" later
    if (s.perPlayer !== undefined) {
      const per = s.perPlayer;
      // edh-players-21 (CR 608.2d, 101.4): "Each opponent chooses a creature they control": every player of the group chooses for themselves (`who` is `iterating`)
      if (s.who.ref === 'iterating' && per.ref === 'each' && (per.who === 'player' || per.who === 'opponent') && from.ref === 'each' && min === 1 && max === 1 && !s.random && s.groupLimit === undefined) {
        const own = K.np(from.filter, st, { det: 'a' });
        // edh-d-64 (Fell Beast's Shriek, Sadistic Shell Game): and "the chosen creatures" (the group those choices made)
        bind(st, s.as, { nouns: K.nounsOf(from.filter), plural: true, thisWay: 'chosen this way', alts: [from.filter.isCard === true ? 'the chosen cards' : 'the chosen permanents', ...K.nounsOf(from.filter).map((n) => `the chosen ${pluralize(n)}`)] });
        return plain(`each ${per.who} chooses ${own}`);
      }
      if (per.ref !== 'each' || (per.who !== 'player' && per.who !== 'opponent') || from.ref !== 'each' || min !== 1 || max !== 1 || s.random || s.groupLimit !== undefined || s.who.ref !== 'you') {
        throw new NoRenderer('a choice for each player other than "for each player / opponent, choose a <thing> that player controls"');
      }
      const what = K.np(from.filter, st, { det: 'a' });
      // trek-5 (CR 608.2c; family chosen-cards-named): cards chosen out of a zone (not permanents) are "the chosen cards" later (Ensign Pavel Chekov: "You may play the chosen cards")
      bind(st, s.as, { nouns: K.nounsOf(from.filter), plural: true, thisWay: 'chosen this way', alts: [from.filter.isCard === true ? 'the chosen cards' : 'the chosen permanents'] });
      return plain(alt(`for each ${per.who}, choose ${what}`, `for each ${per.who}, you choose ${what}`)); // r3-refs: "For each player, you choose a creature that player controls" (Winnowing)
    }
    // std-rx30 (CR 101.4, 608.2d): "Starting with you, each player chooses up to one permanent with mana value 3 or greater from among permanents your opponents control":
    // each player in turn, every object chosen named later as a group ("those permanents")
    if (s.startingWith !== undefined) {
      const one = from.ref === 'each' && from.filter.anyOf?.length === 1 && Object.keys(from.filter).filter((k) => (from.filter as Record<string, unknown>)[k] !== undefined).sort().join() === 'anyOf,controller'
        && from.filter.controller === 'opponent' ? from.filter.anyOf[0]! : undefined;
      // edh-perms-12 (CR 101.4, 608.2d; Druid of Purification): "Starting with you, each player may choose an artifact or enchantment you don't control": up to one object of any
      // description, each player in turn, every object chosen named later as a group ("each permanent chosen this way")
      if (one === undefined && from.ref === 'each' && s.startingWith.ref === 'you' && s.who.ref === 'each' && s.who.who === 'player' && min === 0 && max === 1 && !s.random && s.groupLimit === undefined) {
        bind(st, s.as, { nouns: [...new Set([...K.nounsOf(from.filter), 'permanent'])], plural: true, thisWay: 'chosen this way', alts: ['each permanent chosen this way'] });
        return plain(`starting with you, each player may choose ${K.np(from.filter, st, { det: 'a' })}`);
      }
      // edh-next-134 (CR 101.4, 608.2d; The Horus Heresy): "Starting with you, each player chooses a creature": exactly one object of a description of any controller, each player in turn,
      // every object chosen named later as a group ("each creature chosen this way")
      if (one === undefined && from.ref === 'each' && s.startingWith.ref === 'you' && s.who.ref === 'each' && s.who.who === 'player' && min === 1 && max === 1 && !s.random && s.groupLimit === undefined
        && from.filter.anyOf?.length === 1 && Object.keys(from.filter).filter((k) => (from.filter as Record<string, unknown>)[k] !== undefined).join() === 'anyOf') {
        const kind = from.filter.anyOf[0]!;
        const nouns = [...new Set([...K.nounsOf(kind), 'permanent'])];
        bind(st, s.as, { nouns, plural: true, thisWay: 'chosen this way', alts: nouns.map((n) => `each ${n} chosen this way`) });
        return plain(`starting with you, each player chooses ${K.np(kind, st, { det: 'a' })}`);
      }
      // edh-next-147 (CR 101.4, 102.2, 608.2d; Sadistic Shell Game): "Starting with the next opponent in turn order, each player chooses a creature you don't control": exactly one
      // object (if able) of any description, each player in turn beginning with the next player in turn order (this engine has no teams: every other player is an opponent),
      // every object chosen named later as a group ("the chosen creatures")
      if (one === undefined && from.ref === 'each' && s.startingWith.ref === 'seat' && s.startingWith.side === 'left' && s.startingWith.of === undefined && s.startingWith.chosen === undefined
        && s.startingWith.inverse === undefined && s.who.ref === 'each' && s.who.who === 'player' && min === 1 && max === 1 && !s.random && s.groupLimit === undefined) {
        const nouns = K.nounsOf(from.filter);
        bind(st, s.as, { nouns: [...new Set([...nouns, 'permanent'])], plural: true, thisWay: 'chosen this way', alts: [...nouns.map((n) => `the chosen ${pluralize(n)}`), 'the chosen permanents'] });
        return plain(`starting with the next opponent in turn order, each player chooses ${K.np(from.filter, st, { det: 'a' })}`);
      }
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
    // edh-top-8 (CR 608.2c, 608.2d, 406.1; template eff.edht8.opponent.chooses.nonland.exiledThisWay; Plargg and Nassari): one nonland card among the group an earlier exile of the ability
    // exiled, "An opponent chooses a nonland card exiled this way." Only that group of a plural binding in exile, one card, chosen by a player's own choice
    if (from.ref === 'each' && from.filter.is?.ref === 'bound' && from.filter.zone === 'exile' && min === 1 && max === 1 && s.random !== true && s.groupLimit === undefined && s.perPlayer === undefined
      && Object.keys(from.filter).filter((k) => (from.filter as Record<string, unknown>)[k] !== undefined).sort().join() === 'is,notTypes,zone' && from.filter.notTypes?.length === 1 && from.filter.notTypes[0] === 'Land'
      && st.info.get(`b:${from.filter.is.name}`)?.plural === true) {
      bind(st, s.as, { nouns: ['card'], plural: false, optional: false });
      return byPlayer(s.who, st, 'choose', 'a nonland card exiled this way');
    }
    // edh-c-67 (CR 608.2d, 109.4; eff.edhv67.player.chooses.theyControl): "target opponent chooses a creature they control": the chosen player is named BEFORE the description
    // that names them again as its controller (the thunk renders the description while the player is the actor), so the player is "target opponent" and then "they"
    if (from.ref === 'each' && s.who.ref === 'target' && min === 1 && max === 1 && s.random !== true && s.groupLimit === undefined && s.distinct === undefined
      && JSON.stringify(from.filter.controller) === JSON.stringify(s.who) && from.filter.anyOf?.length === 1) {
      const kinds = K.nounsOf(from.filter);
      const clause = byPlayer(s.who, st, 'choose', () => K.np(from.filter, st, { det: 'a' }));
      bind(st, s.as, { nouns: kinds, plural: false, optional: false, alts: kinds.map((n) => `the chosen ${n}`) });
      return clause;
    }
    // edh-d-87 (CR 608.2c, 208.1, 506.4; Kamiz, Obscura Oculus; template eff.edhd87.choose.another.attacking.lesserPower): "choose another attacking creature with lesser power": one
    // attacking creature whose power is lower than that of the target an earlier sentence named (so never that target itself), chosen by you
    const lesserThanTarget = from.ref === 'each' && s.who.ref === 'you' && min === 1 && max === 1 && s.random !== true && s.groupLimit === undefined && s.distinct === undefined
      && Object.keys(from.filter).filter((k) => (from.filter as Record<string, unknown>)[k] !== undefined).sort().join() === 'attacking,power,types' && from.filter.attacking === true
      && from.filter.types?.length === 1 && from.filter.types[0] === 'Creature' && from.filter.power?.op === '<' && typeof from.filter.power.value === 'object' && 'q' in from.filter.power.value
      && from.filter.power.value.q === 'stat' && from.filter.power.value.stat === 'power' && from.filter.power.value.of.ref === 'target' && from.filter.power.value.sum === undefined && from.filter.power.value.agg === undefined;
    if (lesserThanTarget) {
      bind(st, s.as, { nouns: ['creature'], plural: false, optional: false, alts: ['that creature', 'the chosen creature'] });
      return byPlayer(s.who, st, 'choose', 'another attacking creature with lesser power');
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
      const words = ({ power: 'powers', toughness: 'toughnesses', manaValue: 'mana values', name: 'names' } as const)[s.distinct];
      if (from.ref !== 'each' || group !== null || !plural || s.random === true || s.groupLimit !== undefined) throw new NoRenderer('a choice of objects with different values other than out of a description');
      what = `${what} with different ${words}`;
    }
    bind(st, s.as, { nouns, plural, optional: min === 0, ...(chosenAlts.length > 0 ? { alts: chosenAlts } : {}) });
    // edh-d-1 (CR 608.2d, 404.1; Tariel, Reckoner of Souls, template eff.edhd1.choose.cardAtRandom.fromPlayersGraveyard): "at random" is said before the zone of the cards, "Choose a
    // creature card at random from target opponent's graveyard", as well as after it
    if (s.random === true && from.ref === 'each' && from.filter.zone === 'graveyard') {
      const at = what.indexOf(ALT_OPEN);
      if (at > 0 && what.slice(0, at).endsWith(' ')) return byPlayer(s.who, st, 'choose', alt(`${what} at random`, `${what.slice(0, at - 1)} at random ${what.slice(at)}`));
    }
    // edh-next-92 (CR 608.2d, 508.1; Metzali, Tower of Triumph, template eff.edhn92.choose.aFilter.atRandom.attackedThisTurn): "Choose a creature at random that attacked this turn" (family choose-at-random-attacked)
    if (s.random === true && from.ref === 'each' && from.filter.attackedThisTurn === true && what.endsWith(' that attacked this turn')) {
      return byPlayer(s.who, st, 'choose', alt(`${what} at random`, `${what.slice(0, -' that attacked this turn'.length)} at random that attacked this turn`));
    }
    return byPlayer(s.who, st, 'choose', `${what}${s.random ? ' at random' : ''}`);
  },

  chooseValue: (s: StepOf<'chooseValue'>, st: RenderState): Clause => {
    // edh-perms-15 (CR 122.1, 608.2d; Ichormoon Gauntlet, Animation Module): "choose a counter on target permanent or player"; the kind is read by a later putCounters (`kindOfChoice`)
    if (s.what === 'counterKind') {
      // edh-next-128 (CR 122.1, 608.2d; Crystalline Giant): "choose a kind of counter at random that ~ doesn't have on it from among flying, ..., and +1/+1" (the listed kinds, in the printed order)
      if (s.counterNotOn !== undefined) {
        const kinds = s.options ?? [];
        if (s.counterOn !== undefined || s.link === undefined || s.who.ref !== 'you' || s.random !== true || s.counterNotOn.ref !== 'self' || kinds.length < 2 || s.exclude !== undefined) throw new NoRenderer('a counter kind choice other than at random among listed kinds the source has none of');
        st.counterKindLink = s.link;
        st.counterKindFresh = s.link;
        return byPlayer(s.who, st, 'choose', `a kind of counter at random that ~ doesn't have on it from among ${kinds.slice(0, -1).join(', ')}, and ${kinds[kinds.length - 1]}`);
      }
      if (s.counterOn === undefined || s.link === undefined || s.who.ref !== 'you') throw new NoRenderer('a counter choice without a holder, a link or the controller as chooser');
      st.counterKindLink = s.link;
      // edh-d-89 (CR 122.1, 608.2d; Aven Courier): "choose a counter on a permanent you control": a kind any one of the group has
      const on = s.counterOn as ObjRef;
      if (on.ref === 'each' && 'filter' in on) return byPlayer(s.who, st, 'choose', `a counter on ${K.np(on.filter, st, { det: 'a' })}`);
      return byPlayer(s.who, st, 'choose', `a counter on ${K.obj(s.counterOn as ObjRef, st, 'object').text}`);
    }
    // edh-mana-keywords-12 (CR 106.1, 602.2b, 607.2d; Jeweled Amulet): "Note the type of mana spent to pay this activation cost." (the one player you, remembered by the source for its linked ability)
    if (s.what === 'manaTypeSpent') {
      if (s.who.ref !== 'you' || s.link === undefined || s.options !== undefined || s.exclude !== undefined) throw new NoRenderer('a note of the type of mana spent other than by you for a linked ability');
      return plain('note the type of mana spent to pay this activation cost', { standalone: true });
    }
    // edh-next-144 (CR 119.1, 607.2d; Sigarda's Splendor): "note your life total" (the one player you, kept by the source under the link "the last noted life total" reads)
    if (s.what === 'lifeTotal') {
      if (s.who.ref !== 'you' || s.link !== NOTED_LIFE_LINK || s.options !== undefined || s.exclude !== undefined || s.random === true || s.secret === true) throw new NoRenderer('a note of a life total other than yours for the linked "last noted life total"');
      return plain('note your life total', { standalone: true });
    }
    let thing = CHOICE[s.what];
    if (s.what === 'option' && s.options) thing = `one of ${s.options.join(', ')}`;
    // edh-players-13 (CR 608.2d): the words players choose between that mean nothing of their own, "chooses fame or fortune" (parser/holes/choicewords.ts)
    if (s.what === 'option' && s.options !== undefined && s.link === NAMED_OPTION_LINK) thing = joinList(s.options, 'or');
    // edhd63 (CR 608.2d, 101.4; eff.edhd63.choose.leftOrRight): "choose left or right", the direction later read as "the chosen direction" (the link `direction`)
    // edh-next-143 (CR 608.2d; Pir's Whim): "For each player, choose friend or foe.": you choose one of the two words for each player
    if (s.forEachPlayer !== undefined) {
      if (s.what !== 'option' || s.link !== FRIEND_OR_FOE || JSON.stringify(s.options) !== '["friend","foe"]' || s.who.ref !== 'you' || JSON.stringify(s.forEachPlayer) !== '{"ref":"each","who":"player"}' || s.secret !== undefined || s.random !== undefined || s.exclude !== undefined) throw new NoRenderer('a choice for each player other than "for each player, choose friend or foe"');
      return plain('for each player, choose friend or foe', { standalone: true });
    }
    if (s.what === 'option' && s.link === 'direction' && JSON.stringify(s.options) === '["left","right"]' && s.who.ref === 'you' && s.as === 'direction') thing = 'left or right';
    // std-rD (CR 608.2d, 205.2a): a card type out of the listed ones, said as Oracle lists them ("choose artifact or enchantment", "choose artifact, creature, or land")
    if (s.what === 'cardType' && s.options !== undefined && s.options.length >= 2) thing = joinList(s.options.map((o) => o.toLowerCase()), 'or');
    // edh-next-40 (CR 110.4, 205.2a, 608.2d; Creeping Renaissance): the six permanent types (artifact, battle, creature, enchantment, land, planeswalker) are "a permanent type"
    if (s.what === 'cardType' && JSON.stringify(s.options) === JSON.stringify(['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'])) thing = 'a permanent type';
    if (s.what === 'number' && s.min !== undefined && s.max !== undefined) thing = `a number between ${K.qty(s.min, st)} and ${K.qty(s.max, st)}`;
    // edh-zones-26 (CR 608.2d; Tibalt's Trickery): "Choose 1, 2, or 3 at random." (the game picks, nobody chooses): a short range of whole numbers, listed
    // edh-c-14 (CR 608.2d; Ruhan of the Fomori): "Choose an opponent at random." (you; the chosen opponent stays the antecedent of "that player")
    // edh-d-20 (CR 608.2d, 102.1; Wildfire Devils): also "Choose a player at random." (any player, you included)
    const randomOpponent = s.random === true && (s.what === 'opponent' || s.what === 'player') && s.who.ref === 'you' && s.exclude === undefined && s.mostLife !== true;
    if (randomOpponent) thing = s.what === 'player' ? 'a player at random' : 'an opponent at random';
    else if (s.random === true) {
      if (s.what !== 'number' || typeof s.min !== 'number' || typeof s.max !== 'number' || s.max <= s.min || s.max - s.min > 4 || s.who.ref !== 'you') throw new NoRenderer('a random choice other than of a few whole numbers by you');
      thing = `${joinList(Array.from({ length: s.max - s.min + 1 }, (_, i) => String(s.min! as number + i)), 'or')} at random`;
    }
    // edh-next-129 (CR 506.1, 608.2d; Territorial Hellkite): "choose an opponent at random that ~ didn't attack during your last combat"
    if (s.notAttackedLastCombat === true) {
      if (!randomOpponent || s.what !== 'opponent') throw new NoRenderer('an opponent not attacked last combat, other than one chosen at random by you');
      thing = `an opponent at random that ${K.obj({ ref: 'self' }, st, 'subject').text} didn't attack during your last combat`;
      st.info.set(`r:${s.as}`, { nouns: ['opponent'], plural: false, ...(st.info.get(`r:${s.as}`) ?? {}), thisWay: 'opponent chosen this way' }); // read by render/cond.ts: "if you can't choose an opponent this way"
    }
    if (s.cardKind !== undefined) thing = `a ${s.cardKind} card name`; // std-rx28 (CR 201.3): "choose a land card name" (Petrified Hamlet)
    // edh-next-9 (CR 205.3m, 608.2d; Unnatural Selection, Imagecrafter): "choose a creature type other than Wall" (a fixed creature type is never offered)
    if (s.what === 'creatureType' && s.exclude !== undefined) {
      if (s.exclude.length !== 1 || typeof s.exclude[0] !== 'string' || s.options !== undefined || s.secret === true) throw new NoRenderer('a creature type choice that excludes more than one fixed type, or lists options');
      thing = `a creature type other than ${s.exclude[0]}`;
      if (s.link !== undefined) (st.otherThanTypeLinks ??= new Set()).add(s.link);
    }
    // edh-d-46 (CR 608.2d, 305.6; Elsewhere Flask): "Choose a basic land type. Each land you control becomes that type until end of turn.": the later sentence says the chosen basic land type "that type" (as for a creature type other than Wall above)
    if (s.what === 'landType' && s.link !== undefined && s.exclude === undefined && s.options !== undefined && s.options.length === 5 && s.who.ref === 'you') (st.otherThanTypeLinks ??= new Set()).add(s.link);
    // Cloud std-woe (CR 608.2d): "choose another player" (the controller is not offered, effects/handlers/choose.ts#excludedPlayers); the chosen player is "that player"
    const players = s.what === 'player' || s.what === 'opponent';
    if (players && s.exclude !== undefined) {
      if (s.what !== 'player' || JSON.stringify(s.exclude) !== '["you"]') throw new NoRenderer('a player choice that excludes other players');
      thing = 'another player';
    }
    // edh-d-46 (CR 109.4, 608.2d; Boreas Charger): "choose an opponent who controls more lands than you"
    if (s.controlsMore !== undefined) {
      if (s.what !== 'opponent' || s.who.ref !== 'you' || s.exclude !== undefined || s.mostLife === true || s.random === true) throw new NoRenderer('a choice with a land-count condition other than of an opponent by you');
      thing = `an opponent who controls more ${K.np(s.controlsMore, cloneState(st), { det: 'none', plural: true })} than you`;
    }
    // edh-players-8 (CR 119.1, 608.2d; The Black Gate): "choose a player with the most life or tied for most life"
    if (s.mostLife === true) {
      if (s.what !== 'player' || s.exclude !== undefined) throw new NoRenderer('a choice with the most life other than of a player');
      thing = 'a player with the most life or tied for most life';
    }
    // edh-players-10 (CR 608.2c; Sylvan Offering): a second "Choose an opponent." names the player anew, so the earlier choice is no antecedent of "that player" any more
    if (players) for (const [k, i] of [...st.info]) if (i.rebinds === 'chosenPlayer') { st.info.delete(k); st.mentioned.delete(k); }
    // edh-zones-26: a number picked at random is no antecedent of "its" (it is read as "that many", render/qty.ts)
    if (s.random !== true || randomOpponent) bind(st, s.as, players ? { nouns: s.what === 'opponent' ? ['player', 'opponent'] : ['player'], plural: false, player: true, rebinds: 'chosenPlayer' } : { nouns: [s.what === 'creatureType' ? 'creature type' : s.what], plural: false });
    // std-combat-5 (CR 608.2d, 205.3m): "secretly choose Human, Merfolk, or Goblin": a creature type out of the listed ones, known to the chooser only until revealed
    if (s.secret === true) {
      // edh-next-135 (CR 608.2d; Stalking Leonin): "secretly choose an opponent", known to you only until revealed (a cost part revealChosen)
      if (s.what === 'opponent' && s.who.ref === 'you' && s.options === undefined && s.reveal === undefined && s.exclude === undefined && s.random === undefined) return byPlayer(s.who, st, 'secretly choose', 'an opponent');
      if (s.what !== 'creatureType' || s.options === undefined || s.options.length < 2 || s.who.ref !== 'you') throw new NoRenderer('a secret choice other than "secretly choose <creature types>" by you');
      return byPlayer(s.who, st, 'secretly choose', joinList(s.options.map((o) => o.toLowerCase()), 'or'));
    }
    // edh-players-13 (CR 608.2d): what several players chose for one link is said "chosen this way" later (render/np.ts)
    if (s.link !== undefined && s.what === 'creatureType' && s.who.ref === 'each') (st.groupChoices ??= new Set()).add(s.link);
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

/** edh-perms-6: does a condition test the enchanted or equipped object ("if equipped creature is a Vampire": `matches` on {ref:'attachedTo'})? */
/** edh-d-95: is the condition the `matches` of the one permanent the cost sacrificed ("If you sacrificed an Angel this way")? */
function testsCostSacrificed(cond: Condition): boolean {
  return cond.cond === 'matches' && JSON.stringify(cond.object) === '{"ref":"costSacrificed"}';
}

function testsAttachedObject(cond: Condition): boolean {
  return cond.cond === 'matches' && (cond.object as { ref?: string } | undefined)?.ref === 'attachedTo';
}

/** std-rx10: the key of the one target a `matches` condition tests ("if the creature you control entered this turn"), or undefined. */
function testedTarget(cond: Condition): string | undefined {
  if (cond.cond !== 'matches') return undefined;
  const o = cond.object as { ref?: string; id?: string; name?: string } | undefined;
  if (o !== undefined && o.ref === 'bound' && typeof o.name === 'string' && o.name !== '' && Object.keys(o).length === 2) return `b:${o.name}`; // edh-d-86 (the parser's std-r8 rule for any mention; Aspiring Champion): "If that creature is a Demon, it deals ..."
  return o !== undefined && o.ref === 'target' && typeof o.id === 'string' ? `t:${o.id}` : undefined;
}

/** edh-c-28: two lists of one destroy of one object each, guarded by "its mana value is N or less" with a bigger N in the first: the object and that N. */
function destroyLimitInstead(thenSteps: readonly EffectStep[], elseSteps: readonly EffectStep[]): { what: ObjRef; then: number } | null {
  const [a, b] = [thenSteps[0], elseSteps[0]];
  if (thenSteps.length !== 1 || elseSteps.length !== 1 || a?.op !== 'destroy' || b?.op !== 'destroy' || JSON.stringify(a.what) !== JSON.stringify(b.what) || a.regeneration !== undefined || b.regeneration !== undefined) return null;
  const limit = (g: unknown): number | null => {
    const c = g as { cond?: string; left?: { q?: string; stat?: string; of?: unknown }; op?: string; right?: unknown } | undefined;
    return c?.cond === 'compare' && c.left?.q === 'stat' && c.left.stat === 'manaValue' && JSON.stringify(c.left.of) === JSON.stringify(a.what) && c.op === '<=' && typeof c.right === 'number' ? c.right : null;
  };
  const [x, y] = [limit(a.guard), limit(b.guard)];
  return x !== null && y !== null && x > y ? { what: a.what as ObjRef, then: x } : null;
}
/** edh-c-57: a payment with a `then` and nothing else beside it (no `else`, no count, no "up to"). */
const hasThenOnly = (s: StepOf<'pay'>): boolean => (s.then?.length ?? 0) > 0 && s.else === undefined && s.upTo === undefined && s.anyAmount !== true && s.startingWith === undefined && s.xMax === undefined;

/** edh-d-5: `then` is a destroy that can't be regenerated followed by other instructions, `els` that very destroy alone (Kirtar's Wrath). */
function destroyAgainThenMore(then: readonly EffectStep[], els: readonly EffectStep[]): boolean {
  const d = then[0];
  const e = els[0];
  return then.length > 1 && els.length === 1 && d?.op === 'destroy' && e?.op === 'destroy' && d.regeneration === 'cant' && JSON.stringify(d) === JSON.stringify(e) && d.what.ref === 'each' && d.guard === undefined && d.as === undefined;
}

/** edh-d-7 (CR 614.15, 121.1): `then` is you drawing N cards, `else` each player drawing the same N (Oracle: "Each player draws a card. If C, instead only you draw a card."). */
function onlyYouDrawInstead(then: readonly EffectStep[], els: readonly EffectStep[]): boolean {
  if (then.length !== 1 || els.length !== 1) return false;
  const [x, y] = [then[0]!, els[0]!];
  if (x.op !== 'draw' || y.op !== 'draw' || x.guard !== undefined || y.guard !== undefined) return false;
  const you = x.who.ref === 'you' && Object.keys(x.who).length === 1;
  const each = y.who.ref === 'each' && 'who' in y.who && y.who.who === 'player';
  return you && each && JSON.stringify(x.count ?? 1) === JSON.stringify(y.count ?? 1);
}

/** edh-next-133 (Shiko and Narset, Unified): the sentence(s) of `{if: [the spell targets a permanent or a player], then: [copy it, new targets may], else?: [...]}`; null for any other `if`. */
function copyIfTargetsPermanentOrPlayer(s: StepOf<'if'>, st: RenderState): string | null {
  const c = s.cond;
  if (c.cond !== 'matches' || JSON.stringify(c.filter) !== '{"anyOf":[{"targets":{"ref":"each","filter":{}}},{"targets":{"ref":"each","who":"player"}}]}') return null;
  const cp = s.then.length === 1 && s.then[0]!.op === 'copy' ? s.then[0]! : undefined;
  if (cp === undefined || cp.result !== 'spell' || cp.newTargets !== 'may' || cp.who.ref !== 'you' || JSON.stringify(cp.what) !== JSON.stringify(c.object)
    || Object.keys(cp).sort().join() !== 'newTargets,op,result,what,who') throw new NoRenderer('a copy if the spell targets a permanent or player, other than "copy that spell ... and you may choose new targets for the copy"');
  const first = `copy ${K.obj(cp.what, st, 'object').text} if it targets a permanent or player, and you may choose new targets for the copy`;
  if (s.else === undefined) return first;
  return `${first}. if you don't copy a spell this way, ${K.steps(s.else, st, { nested: true, sentences: true })}`;
}

/** edh-d-98: the `if` steps being rendered by cycledShuffleOrBattlefield's wrapper (its generic reading is rendered by the same clause). */
const IN_CYCLED = new WeakSet<object>();

/**
 * edh-d-98 (CR 614.15, 702.29c, 701.24a; Yidaro, Wandering Monster; the parser's eff.edhd98.shuffleIt.ifCond.battlefieldInstead): in "When you cycle ~", `if` C then [the cycled card
 * onto the battlefield under its owner's control] else [it into your library, you shuffle]: Oracle's two sentences, or null for any other shape. The condition is said on a copy of the state.
 */
function cycledShuffleOrBattlefield(s: StepOf<'if'>, st: RenderState): string | null {
  const on = st.trigger ?? [];
  if (on.length !== 1 || on[0]!.ev !== 'action' || on[0]!.verb !== 'cycle' || on[0]!.object?.self !== true || s.guard !== undefined) return null;
  const card = '{"ref":"event","role":"subject"}';
  const [t] = s.then;
  const [m, sh] = s.else ?? [];
  if (s.then.length !== 1 || (s.else ?? []).length !== 2 || t?.op !== 'move' || m?.op !== 'move' || sh?.op !== 'shuffle') return null;
  if (JSON.stringify(t.what) !== card || JSON.stringify(t.to) !== '{"zone":"battlefield","controller":"owner"}' || Object.keys(t).length !== 3) return null;
  if (JSON.stringify(m.what) !== card || JSON.stringify(m.to) !== '{"zone":"library","owner":{"ref":"you"}}' || Object.keys(m).length !== 3) return null;
  if (JSON.stringify(sh) !== '{"op":"shuffle","who":{"ref":"you"}}') return null;
  return `shuffle it into your library from your graveyard. if ${firstAlt(K.cond(s.cond, cloneState(st)))}, put it onto the battlefield from your graveyard instead`;
}

/** edh-next-129: `then` is the one creation of `else` said again, followed by a second plain creation by the same player ("instead create that token and a Treasure token"). */
function thatTokenAnd(then: EffectStep[], els: EffectStep[]): boolean {
  if (then.length !== 2 || els.length !== 1 || JSON.stringify(then[0]) !== JSON.stringify(els[0])) return false;
  const [a, b] = [then[0]!, then[1]!];
  if (a.op !== 'createToken' || b.op !== 'createToken' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return false;
  return JSON.stringify(a.who) === JSON.stringify(b.who) && b.count === 1 && Object.keys(b).every((k) => ['op', 'who', 'count', 'token', 'span', 'sentence'].includes(k));
}
