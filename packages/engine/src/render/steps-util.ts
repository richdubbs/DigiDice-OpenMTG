/**
 * Helpers shared by the step renderers (WP2): clauses with an acting player, counted nouns, destinations, bindings.
 */
import type { Condition, Count, Destination, EffectStep, ObjectFilter, ObjRef, PlayerRef, Quantity, ZoneName } from '../types/ability';
import { acting, plain, type Clause } from './clause';
import { K } from './kernel';
import { cloneState, objKey, playerKey, type RefInfo, type RenderState } from './state';
import { countersNamedByTrigger, countParts, sizeVsWords } from './qty';
import { alt, conjAny, joinList, NoRenderer, numWord, pluralize, withArticle } from './text';

/**
 * How many times something is done: nothing for once, " twice", " three times", " X times". The suffix of "investigate", "copy it" and the like (CR 701, 707.10).
 * A computed count has no such wording, so it is refused (never dropped).
 */
export function timesWords(n: Quantity | undefined, st?: RenderState): string {
  if (n === undefined || n === 1) return '';
  if (n === 2) return ' twice';
  if (typeof n === 'number') return ` ${numWord(n)} times`;
  if (typeof n === 'object' && n.q === 'X') return ' X times';
  // FAST3 T17: the amount of the triggering event, "whenever ~ deals combat damage to a player, investigate that many times" (design 3.5 `eventAmount`,
  // CR 603.2, 608.2h)
  if (typeof n === 'object' && n.q === 'eventAmount') return ' that many times';
  // FAST5 T53 (CR 402.1, 102.3): "investigate once for each opponent who has more cards in hand than you"
  if (typeof n === 'object' && n.q === 'countPlayers' && n.sizeVs !== undefined && n.lostLifeThisTurn === undefined && n.lostLifeIs === undefined && n.controlsIs === undefined && n.of.ref === 'each' && n.of.who === 'opponent') return ` once for each opponent who has ${sizeVsWords(n.sizeVs)}`;
  // std-mkm (CR 119.3, 120.3a): "investigate for each opponent who lost life this turn"
  if (typeof n === 'object' && n.q === 'countPlayers' && n.sizeVs === undefined && n.lostLifeThisTurn === true && n.lostLifeIs === undefined && n.controlsIs === undefined && n.of.ref === 'each' && (n.of.who === 'opponent' || n.of.who === 'player')) return ` for each ${n.of.who} who lost life this turn`;
  // cmd1 (CR 701.16a, 608.2h): "investigate once for each nontoken attacking creature": the number of objects of a filter, counted as the instruction resolves
  if (typeof n === 'object' && ((n.q === 'count' && n.of.ref === 'each') || n.q === 'resultCount') && st !== undefined) { // edh-next-34: and what an earlier step did, "investigate for each nontoken creature exiled this way" (Declaration in Stone)
    const each = countParts(n, st);
    if (each !== null) return ` once for each ${each.singular}`;
  }
  // edh-c-47 (CR 701.16a, 608.2h; Tamiyo Meets the Story Circle): a whole number of times each of a counted thing, "investigate twice for each card discarded this way"
  if (typeof n === 'object' && n.q === 'math' && n.op === '*' && n.args.length === 2 && typeof n.args[0] === 'number' && n.args[0] >= 2 && n.args[1] !== undefined && typeof n.args[1] === 'object' && st !== undefined) {
    const each = countParts(n.args[1], st);
    if (each !== null) return `${timesWords(n.args[0])} for each ${each.singular}`;
  }
  throw new NoRenderer('a computed number of times');
}

/** A quantity that is calculated (not a number, not X, not an earlier value): Oracle says it as "X, where X is ...". */
export const isComputed = (q: Quantity): boolean => typeof q === 'object' && q.q !== 'X' && q.q !== 'var';

/**
 * std-re (CR 107.3, 608.2h): a computed amount offered as "X, where X is ..." is X for the rest of the ability ("Draw X cards, where X is the number of cards
 * discarded this way. ... ~ deals X damage to each opponent."): `markX` records it when that reading is offered, `saidX` asks for a later amount.
 */
export function markX(q: Quantity, st: RenderState): void {
  if (isComputed(q)) st.mentioned.add(`x=${JSON.stringify(q)}`);
}
export const saidX = (q: Quantity, st: RenderState): boolean => isComputed(q) && st.mentioned.has(`x=${JSON.stringify(q)}`);

/** "2", "X", or "X, where X is the number of creatures you control". */
export function whereX(q: Quantity, st: RenderState): string {
  if (!isComputed(q)) return K.qty(q, st);
  markX(q, st);
  return `X, where X is ${K.qty(q, st)}`;
}

export type StepOf<Op extends EffectStep['op']> = Extract<EffectStep, { op: Op }>;

/**
 * A clause whose subject is a player: `verb` is the base form ("draw"), `rest` the words after it. The subject is printed first (so a target is
 * named before what it acts on), and while `rest` is written the player is the subject of the clause ("their library").
 */
export function byPlayer(who: PlayerRef, st: RenderState, verb: string, rest: (() => string) | string, extra: Partial<Clause> = {}): Clause {
  const key = playerKey(who);
  // the "each" goes with the first mention only: several player targets named before are "they" (std-otj, render/refs.ts#playerInner)
  const fresh = key === null || !st.mentioned.has(key);
  const subj = K.player(who, st, 'subject');
  const saved = st.actor;
  st.actor = key;
  const tail = typeof rest === 'function' ? rest() : rest;
  st.actor = saved;
  const body = tail === '' ? verb : `${verb} ${tail}`;
  const own = tail === '' ? conjAny(verb, subj.person) : `${conjAny(verb, subj.person)} ${tail}`;
  // std-hob (CR 115.1, 608.2e): several target players named by one phrase each do it, "two target players each draw a card", "any number of target players each
  // mill two cards" (templates eff.stdhob.players.each.*)
  // r3-choose (CR 608.2e): ... and named again as a group, "Choose any number of target players. Those players each draw a card." (or without the "each")
  const pred = who.ref === 'target' && subj.person === 'pl' ? (fresh ? `each ${own}` : alt(own, `each ${own}`)) : own;
  // FAST2 T8: "they lose 2 life" for a player named earlier (singular "they" takes a plural verb)
  const they = subj.they === true ? (tail === '' ? conjAny(verb, 'pl') : `${conjAny(verb, 'pl')} ${tail}`) : null;
  // FAST4 T30: the "have ... do" form inside the controller's "may" ("you may have target player mill two cards", CR 608.2d; steps-flow.ts#mayClause)
  // edh-zones-14 (CR 115.1, 608.2c; family each-of-those-players): the group of targets named again is also "each of those players mills ten cards" (singular verb)
  const eachOf = !fresh && who.ref === 'target' && subj.person === 'pl' && subj.text.includes('those players') ? `each of those players ${tail === '' ? conjAny(verb, 'sg') : `${conjAny(verb, 'sg')} ${tail}`}` : null;
  const said = they === null ? `${subj.text} ${pred}` : alt(`${subj.text} ${pred}`, `they ${they}`);
  return acting(key ?? 'x', body, eachOf === null ? said : alt(said, eachOf), { pred, have: `${subj.text} ${body}`, ...(they !== null ? { predThey: they } : {}), ...extra });
}

/** `byPlayer` where the verb phrase is already complete in both persons (a modal like "may draw"). */
export function modal(who: PlayerRef, st: RenderState, phrase: string, extra: Partial<Clause> = {}): Clause {
  const subj = K.player(who, st, 'subject');
  const key = playerKey(who);
  // a modal verb phrase ("may draw a card") only reads with its subject: there is no imperative form
  // edh-zones-26 (CR 608.2c; Tibalt's Trickery): a player named before is also "they": "They may cast that card without paying its mana cost."
  const said = subj.they === true ? alt(`${subj.text} ${phrase}`, `they ${phrase}`) : `${subj.text} ${phrase}`;
  return acting(key ?? 'x', said, said, extra);
}

/**
 * FAST4 T30: the rounding ("up" / "down") when `q` is half of a quantity of the player `who` itself (`math` ceilDiv / floorDiv by 2 of their life total or the
 * number of cards in their library), else null (CR 107.1a: the rounding is always stated).
 * CLOUD std-otj (additive): `of: 'hand'`, the number of cards in their hand ("target opponent discards half the cards in their hand, rounded up").
 */
export function halfOfOwn(q: Quantity, of: 'life' | 'library' | 'hand', who: PlayerRef): 'up' | 'down' | null {
  if (typeof q !== 'object' || q.q !== 'math' || (q.op !== 'ceilDiv' && q.op !== 'floorDiv') || q.args.length !== 2 || q.args[1] !== 2) return null;
  const a = q.args[0];
  if (typeof a !== 'object') return null;
  const whose = of === 'life' ? (a.q === 'life' ? a.of : null) : a.q === 'zoneSize' && a.zone === of ? a.of : null;
  if (whose === null || JSON.stringify(whose) !== JSON.stringify(who)) return null;
  return q.op === 'ceilDiv' ? 'up' : 'down';
}

/**
 * CLOUD std-otj (family half-of-controlled): the rounding when `q` is half of the number of permanents of `filter` that the player `who` controls (`math` ceilDiv /
 * floorDiv by 2 of a count of `filter`, whose controller is `who` itself): "target opponent sacrifices half the creatures they control of their choice, rounded up"
 * (CR 701.21a, 107.1a). Null for any other quantity.
 */
export function halfOfControlled(q: Quantity, filter: ObjectFilter, who: PlayerRef, divisor: 2 | 10 = 2 /* edh-next-108: 10 = "a tenth of the ..." (Legate Lanius) */): 'up' | 'down' | null {
  if (typeof q !== 'object' || q.q !== 'math' || (q.op !== 'ceilDiv' && q.op !== 'floorDiv') || q.args.length !== 2 || q.args[1] !== divisor) return null;
  const a = q.args[0];
  if (typeof a !== 'object' || a.q !== 'count' || a.of.ref !== 'each' || !('filter' in a.of)) return null;
  if (JSON.stringify(a.of.filter) !== JSON.stringify(filter) || JSON.stringify(filter.controller) !== JSON.stringify(who)) return null;
  return q.op === 'ceilDiv' ? 'up' : 'down';
}

/**
 * FAST5 T46: the description of the one card a `chooseObjects` step picks from a revealed or looked-at hand (`{anyOf:[description], is: <the hand>, zone:'any'}`), as
 * a noun phrase with its article ("a nonland card"), or null for any other choice.
 */
export function handChoice(s: StepOf<'chooseObjects'>, st: RenderState): string | null {
  const from = s.from;
  if (from.ref !== 'each' || s.random === true || s.max !== 1 || (s.min !== 0 && s.min !== 1) || s.guard !== undefined) return null;
  const f = from.filter;
  const is = f.is;
  if (is === undefined || is.ref !== 'bound' || f.zone !== 'any' || st.info.get(`b:${is.name}`)?.hand !== true) return null;
  if (Object.keys(f).some((k) => k !== 'is' && k !== 'zone' && k !== 'anyOf') || (f.anyOf !== undefined && f.anyOf.length !== 1)) return null;
  return K.np({ ...(f.anyOf?.[0] ?? {}), zone: 'hand' }, st, { det: 'a', noZone: true });
}

/**
 * T46 with std-ry10 (CR 202.3, 701.20a): the words of the choice of `handChoice` with "from it": "a nonland card from it", and when the description has a mana
 * value, also with the comparison after the zone, "a nonland card from it with mana value 3 or less" (family mana-value-after-hand, Inquisition of Kozilek).
 */
export function handChoiceFromIt(s: StepOf<'chooseObjects'>, st: RenderState): string | null {
  const full = handChoice(s, st);
  if (full === null) return null;
  const desc = (s.from as { filter: ObjectFilter }).filter.anyOf?.[0];
  if (desc?.manaValue === undefined) return `${full} from it`;
  const { manaValue: _mv, ...rest } = desc;
  const base = K.np({ ...rest, zone: 'hand' }, cloneState(st), { det: 'a', noZone: true });
  const tail = full.startsWith(`${base} with `) ? full.slice(base.length) : null;
  return tail === null ? `${full} from it` : alt(`${full} from it`, `${base} from it${tail}`);
}

/** "a creature", "two creatures", "any number of creatures", "X creatures", for a set of objects that are chosen or counted. */
export function countedNp(f: ObjectFilter, count: Count, st: RenderState, extra: Partial<Parameters<typeof K.np>[2]> = {}): string {
  if (count === 'any') return K.np(f, st, { det: 'none', plural: true, count: 'any number of', ...extra });
  if (typeof count === 'number') {
    if (count === 1) return K.np(f, st, { det: 'a', ...extra });
    return K.np(f, st, { det: 'none', plural: true, count: numWord(count), ...extra });
  }
  // edh-next-145 (CR 603.12, 608.2c; Ravenous Rotbelly): in a reflexive trigger that waits for what an instruction moved, the count of those objects is "that many" ("When you sacrifice
  // one or more Zombies this way, each opponent sacrifices that many creatures of their choice"), as render/refs.ts#countWord says it for a target count
  if (count.q === 'resultCount' && count.which !== undefined && st.movedThatMany === JSON.stringify({ step: count.step, which: count.which })) return K.np(f, st, { det: 'none', plural: true, count: 'that many', ...extra });
  return K.np(f, st, { det: 'none', plural: true, count: K.qty(count, st), ...extra });
}

/** "a card", "three cards", "X cards", "cards equal to its power": the counted noun of a draw, mill, discard ... */
export function countedNoun(n: Quantity, noun: string, st: RenderState): string {
  if (typeof n === 'number') return n === 1 ? withArticle(noun) : `${numWord(n)} ${pluralize(noun)}`;
  const v = K.qty(n, st);
  if (typeof n === 'object' && n.q === 'X') return `X ${pluralize(noun)}`;
  if (typeof n === 'object' && (n.q === 'var' && v.startsWith('that'))) return alt(`${v} ${pluralize(noun)}`, `${v} ${noun}`);
  // cloud std-spm (CR 119.3, 608.2c): "draw that many cards" after "if you lost life this way" (the amount the condition named), and in a prevention's own
  // additional instruction (CR 615.5: "prevent that damage and draw that many cards")
  // r4-fxz (CR 603.2, 608.2h): and the amount of the triggering event ("Whenever you lose life, discard that many cards.", as a draw says it, steps-cards.ts)
  if (typeof n === 'object' && ((n.q === 'lifeLost' && n.who !== undefined) || n.q === 'preventedAmount' || n.q === 'eventAmount')) return alt(`that many ${pluralize(noun)}`, `${pluralize(noun)} equal to ${v}`);
  // edh-next-134 (CR 603.4, 603.10a; family that-many-counters-it-had; Oft-Nabbed Goat): the counters the trigger or its intervening "if" named, "its owner draws that many cards"
  if (typeof n === 'object' && n.q === 'counters' && countersNamedByTrigger(n, cloneState(st))) return alt(`that many ${pluralize(noun)}`, `${pluralize(noun)} equal to ${v}`);
  return `${pluralize(noun)} equal to ${v}`;
}

/** "3" or "damage equal to its power": an amount that is a number or a computed value, for "deals X damage" / "gain X life". */
export function amountOf(n: Quantity, unit: string, st: RenderState, o: { whereX?: boolean; noThatMuch?: true } = {}): string {
  if (typeof n === 'number') return `${n} ${unit}`;
  // edh-d-98 (CR 608.2c, 608.2h, 119.3; Asmodeus the Archfiend; family result-count-that-much): the number of objects an instruction of the sentence moved is also "that much <unit>"
  // ("... and you lose that much life"), beside every other reading of the amount (render/qty.ts offers "that much" for the count itself)
  if (typeof n === 'object' && n.q === 'resultCount' && n.which === undefined && n.to === undefined && o.noThatMuch !== true && st.mentioned.has(`movedAs:${n.step}`)) return alt(amountOf(n, unit, st, { ...o, noThatMuch: true }), `that much ${unit}`);
  if (typeof n === 'object' && n.q === 'X' && st.costAllCountersX === undefined) return `X ${unit}`; // p2-counters-move-2: an X printed nowhere is said by its count
  // std-re (family draw-where-x): an amount said before as "X, where X is ..." is X again
  const again = saidX(n, st) ? [`X ${unit}`] : [];
  // std-r10 (CR 115.1, 608.2c): the "for each" readings are also said as from before "equal to ..." named a target: "you gain 2 life for each creature target
  // player controls" names the target there for the first time (perForms)
  const before = cloneState(st);
  const v = K.qty(n, st);
  // FAST4 T30 (CR 107.3, 608.2h; family draw-where-x): where the amount ends the clause, a computed amount is also "loses X life, where X is ..."
  const offered = o.whereX === true && typeof n === 'object' && ((isComputed(n) && n.q !== 'eventAmount') || (n.q === 'X' && st.costAllCountersX !== undefined /* edh-next-45 (CR 107.3, 122.1, 608.2h): the X of "Remove all <kind> counters from ~" is "X cards, where X is the number of <kind> counters removed this way" */));
  if (offered) markX(n, st);
  const where = [...again, ...(offered ? [`X ${unit}, where X is ${v}`] : [])];
  // edh-c-68 (CR 107.3, 608.2h; family gain-x-plus-where; An-Havva Inn): a computed amount plus a whole number is also "X plus 1 life, where X is ..." (the sum is one amount)
  if (o.whereX === true && typeof n === 'object' && n.q === 'math' && n.op === '+' && n.args.length === 2 && typeof n.args[1] === 'number' && typeof n.args[0] === 'object' && isComputed(n.args[0]) && n.args[0].q !== 'eventAmount') {
    const w = cloneState(st);
    const inner = K.qty(n.args[0], w);
    where.push(`X plus ${n.args[1]} ${unit}, where X is ${inner}`);
  }
  // PUSH1 T2: the amount of the trigger event too ("you gain that much life", "it deals that much damage"; design 3.5 `eventAmount`)
  // FAST5X E16: "you gain that much life" after "if <that creature> is dealt excess damage this way" (CR 120.4a, 608.2c); FAST5X E22: and after "if you sacrificed one or more permanents this turn" (render/qty.ts, the count of that condition)
  // cloud std-spm (CR 615.5): and in a prevention's own additional instruction ("prevent that damage and you gain that much life")
  // (std-ry10: a turn's history count is "that much" only when it is said so, never because its own words have "that" in them: "creatures that died this turn")
  // p2-c-dieroll-2 (family die-result-that-much): and the result of the roll before ("you lose that much life", "~ deals that much damage to you")
  if (typeof n === 'object' && (n.q === 'var' || n.q === 'eventAmount' || n.q === 'excessDamage' || n.q === 'preventedAmount' || n.q === 'dieResult' || (n.q === 'damageDealt' && n.stated === true) /* edh-next-109 */ || (n.q === 'happenedCount' && v.startsWith('that'))) && v.includes('that')) return alt(`${v} ${unit}`, `${unit} equal to ${v}`);
  // edh-next-15 (CR 119.3, 608.2c; Foul-Tongue Shriek, family life-lost-by-player): "you gain that much life" after the loss of life of one player
  // edh-next-134 (family that-many-counters-it-had; Oft-Nabbed Goat): "each other player loses that much life" after the counters the trigger's intervening "if" named
  if (typeof n === 'object' && n.q === 'counters' && countersNamedByTrigger(n, cloneState(st))) return alt(`that much ${unit}`, `${unit} equal to ${K.qty(n, cloneState(st))}`);
  if (typeof n === 'object' && n.q === 'lifeLost' && n.who !== undefined) return alt(`that much ${unit}`, `${unit} equal to the life ${K.player(n.who, st, 'subject').text} lost this way`);
  // FAST4 T34 (CR 107.3): "gains twice X life", two times the announced X
  // p2-counters-move-2 (family per-object-amount): an X that is the number of counters the cost removed is also counted per counter, "you gain 2 life for each elixir
  // counter removed this way" (render/qty.ts#countParts of X; nothing when X is any other number)
  if (typeof n === 'object' && n.q === 'math' && n.op === '*' && n.args.length === 2 && typeof n.args[0] === 'number' && n.args[0] >= 2 && n.args[0] <= 5 && typeof n.args[1] === 'object' && n.args[1].q === 'X') {
    // edh-c-19 (Martyr of Sands): "three times X life" is the same shape, N times the announced X
    const k = n.args[0];
    return alt(`${unit} equal to ${v}`, ...(k === 2 ? [`twice X ${unit}`] : []), `${k} times X ${unit}`, ...perForms(n.args[1], st, before).map((x) => `${k} ${unit} for each ${x}`));
  }
  // edh-next-126 (CR 107.3, 608.2h; Lifestream's Blessing; family twice-x): N times an amount said before as "X, where X is ..." is "twice X life" ("Draw X cards, where X is the greatest
  // power among ... . If ~ was cast from exile, you gain twice X life.")
  if (typeof n === 'object' && n.q === 'math' && n.op === '*' && n.args.length === 2 && typeof n.args[0] === 'number' && n.args[0] >= 2 && n.args[0] <= 5 && n.args[1] !== undefined && saidX(n.args[1], st)) {
    const k = n.args[0];
    return alt(`${unit} equal to ${v}`, ...(k === 2 ? [`twice X ${unit}`] : []), `${k} times X ${unit}`);
  }
  // edh-c-39 (family life-x-plus-n; CR 107.3, 119.1; Vitalizing Cascade): an announced X plus a number is also said as the amount, "you gain X plus 3 life"
  if (typeof n === 'object' && n.q === 'math' && n.op === '+' && n.args.length === 2 && typeof n.args[0] === 'object' && n.args[0].q === 'X' && typeof n.args[1] === 'number') return alt(`${unit} equal to ${v}`, `${v} ${unit}`);
  // FAST2 T8: a fixed amount per object, "gain 2 life for each creature you control" (math * [k, count])
  if (typeof n === 'object' && n.q === 'math' && n.op === '*' && n.args.length === 2 && typeof n.args[0] === 'number' && n.args[0] > 1) {
    const each = perForms(n.args[1]!, st, before);
    if (each.length > 0) return alt(`${unit} equal to ${v}`, ...each.map((x) => `${n.args[0]} ${unit} for each ${x}`), ...where);
  }
  // edh-c-49 (family twice-per-life-gained; CR 119.3, 603.2, 608.2h; False Cure): "loses 2 life for each 1 life they gained" is twice the life of the triggering gain
  if (unit === 'life' && st.trigger?.length === 1 && st.trigger[0]!.ev === 'life' && (st.trigger[0] as { change?: string }).change === 'gain' && typeof n === 'object' && n.q === 'math' && n.op === '*' && n.args.length === 2 && n.args[0] === 2 && typeof n.args[1] === 'object' && n.args[1].q === 'eventAmount') {
    return alt(`${unit} equal to ${v}`, `2 ${unit} for each 1 ${unit} they gained`, ...where);
  }
  // edh-d-13 (family twice-per-life-gained; CR 119.3, 603.2, 608.2h; Transcendence): in a trigger on your own life LOSS, "you gain 2 life for each 1 life you lost" is twice that loss
  if (unit === 'life' && st.trigger?.length === 1 && st.trigger[0]!.ev === 'life' && (st.trigger[0] as { change?: string }).change === 'loss' && (st.trigger[0] as { player?: string }).player === 'you' && typeof n === 'object' && n.q === 'math' && n.op === '*' && n.args.length === 2 && n.args[0] === 2 && typeof n.args[1] === 'object' && n.args[1].q === 'eventAmount') {
    return alt(`${unit} equal to ${v}`, `2 ${unit} for each 1 ${unit} you lost`, ...where);
  }
  // edh-c-49 (family for-each-fewer-than; CR 107.1, 119.3, 608.2h; Nezumi Shortfang): "1 life for each card fewer than three in their hand" is the greater of 0 and 3 minus the cards in that hand
  if (typeof n === 'object' && n.q === 'math' && n.op === 'max' && n.args.length === 2 && n.args[0] === 0) {
    const d = n.args[1];
    if (typeof d === 'object' && d.q === 'math' && d.op === '-' && d.args.length === 2 && typeof d.args[0] === 'number' && typeof d.args[1] === 'object' && d.args[1].q === 'count') {
      const of = d.args[1].of;
      const f = of.ref === 'each' ? of.filter : undefined;
      if (f !== undefined && f.zone === 'hand' && f.isCard === true && Object.keys(f).length === 3 && f.owner !== undefined && typeof f.owner === 'object' && (f.owner as { ref?: string }).ref !== 'each') { // one player's hand, never a group's (the count is not per player)
        const poss = (f.owner as { ref?: string }).ref === 'you' ? 'your' : 'their';
        return alt(`${unit} equal to ${v}`, `1 ${unit} for each card fewer than ${d.args[0]} in ${poss} hand`, ...where);
      }
    }
  }
  // r4-fxb (family for-each-of-group): the number of a group named before, "you gain 1 life for each of those creatures" (CR 608.2c, 107.1)
  if (typeof n === 'object' && n.q === 'count' && n.of.ref !== 'each') {
    // a reference with no object phrase of its own (the cards a cost exiled: "the number of cards exiled this way") keeps its other readings
    let g: { text: string; plural?: boolean } | undefined;
    try {
      g = K.obj(n.of, st, 'object');
    } catch (e) {
      if (!(e instanceof NoRenderer)) throw e;
    }
    if (g?.plural) return alt(`${unit} equal to ${v}`, `1 ${unit} for each of ${g.text}`, ...where);
  }
  // "gain life equal to the number of creatures you control" / "gain 1 life for each creature you control"
  const per = perForms(n, st, before);
  return per.length > 0 ? alt(`${unit} equal to ${v}`, ...per.map((x) => `1 ${unit} for each ${x}`), ...where) : alt(`${unit} equal to ${v}`, ...where);
}

/**
 * The singular "for each" nouns of a count (render/qty.ts#countParts): as the state now is, and as it was `before` the clause said the amount another way. Std-r10
 * (CR 115.1, 608.2c): "draw cards equal to the number of creatures target player controls" names the target, so the same state says "for each creature that player
 * controls"; Oracle's "draw a card for each creature target player controls" names it there for the first time. Both readings are kept (none was ever lost).
 */
export function perForms(n: Quantity, st: RenderState, before: RenderState): string[] {
  const now = countParts(n, st);
  const first = countParts(n, before);
  return [...new Set([...(now ? [now.singular] : []), ...(first ? [first.singular] : [])])];
}

/** Record what a name stands for, so later steps can say "it" or "that creature". */
export function bind(st: RenderState, name: string | undefined, info: RefInfo): void {
  if (name === undefined) return;
  st.info.set(`b:${name}`, info);
  st.mentioned.add(`b:${name}`);
}

/**
 * C6 (CR 101.3, 608.2c): `cantAs` of a discard or a sacrifice, the players of the group who can't ("Each opponent who can't loses 3 life."; parser/lower/mentions.ts#cantOf
 * reads it only for "each opponent" and "each player" doing one thing). Any other group has no wording here.
 */
export function bindCant(st: RenderState, name: string | undefined, who: PlayerRef): void {
  if (name === undefined) return;
  if (who.ref !== 'each' || (who.who !== 'opponent' && who.who !== 'player')) throw new NoRenderer("the players who can't of a step that is not for each opponent or each player");
  st.info.set(`b:${name}`, { nouns: ['player'], plural: true, player: true, cant: who.who });
}

export function filterOf(ref: ObjRef, st: RenderState): ObjectFilter | null {
  if (ref.ref === 'each') return ref.filter;
  if (ref.ref === 'target') return st.specs.get(ref.id)?.filter ?? null;
  return null;
}

const ZONE_WORDS: Record<string, string> = { graveyard: 'graveyard', hand: 'hand', library: 'library' };
const PLURAL_ZONE: Record<string, string> = { graveyard: 'graveyards', hand: 'hands', library: 'libraries' };

/** "its owner's hand" / "your graveyard": the owner of the destination zone. Default owner: alternatives that mean the same by CR 400.3. */
export function ownersZone(zone: ZoneName, owner: PlayerRef | undefined, plural: boolean, st: RenderState, preferYour = false, self = false, thatPlayer = false): string {
  const word = ZONE_WORDS[zone] ?? zone;
  if (owner !== undefined) return `${K.player(owner, st, 'possessive').text} ${word}`;
  // FAST5X E24 (CR 201.5): the object itself goes to its owner's zone, "~'s owner's library" (a character card's "his owner's library")
  if (self && !plural && !preferYour) return `${alt("its owner's", 'your', "their owner's", "~'s owner's")} ${word}`;
  if (preferYour) return alt(`your ${word}`, `its owner's ${word}`, `their owner's ${word}`, `their owners' ${PLURAL_ZONE[zone] ?? word}`);
  if (plural) return alt(`their owners' ${PLURAL_ZONE[zone] ?? word}`, `your ${word}`, `their owner's ${word}`, `its owner's ${word}`);
  // edh-c-53 (CR 400.3, 404.1; Draugr Thought-Thief): a card put into a graveyard goes to its owner's, which Oracle also says "their graveyard" for the player whose library it was in
  // edh-c-67 (CR 400.3; family that-players-zone): the one player the sentences before named by a target ("Look at target player's library. You may put that card into that player's graveyard.")
  const named = [...st.mentioned].filter((k) => k.startsWith('t:') && st.specs.get(k.slice(2))?.kind === 'player');
  return `${alt("its owner's", 'your', "their owner's", ...(zone === 'graveyard' ? ['their'] : []), ...(thatPlayer && named.length === 1 ? ["that player's"] : []))} ${word}`;
}

/**
 * std-rx27 (CR 122.1, 406.1): the counters of fixed numbers a move puts on the card in exile, " with a stash counter on it" ("exile it from their graveyard with a
 * stash counter on it"); empty with none. A varying number has no wording here.
 */
export function exileCounters(d: Destination, plural: boolean, it = 'it'): string {
  const kinds = d.counters ?? [];
  if (kinds.length === 0) return '';
  if (kinds.some((c) => typeof c.count !== 'number' || c.count < 1)) throw new NoRenderer('counters of a varying number on a card put into exile');
  const noun = (c: { kind: string; count: Quantity }): string => (c.count === 1 ? withArticle(`${c.kind} counter`) : `${numWord(c.count as number)} ${c.kind} counters`);
  return ` with ${joinList(kinds.map(noun))} on ${plural ? 'each of them' : it}`;
}

/**
 * Where an object goes ("onto the battlefield tapped", "to its owner's hand", "on top of your library", "into your graveyard"). Returns the preposition
 * phrase; the verb is chosen by the caller from `destVerb`.
 */
export function destPhrase(d: Destination, st: RenderState, plural: boolean, preferYour = false, returning = false, self = false): string {
  // FAST5X E24 (CR 201.5): `self`, the moved object is the object itself: its owner and the object the counters go on may also be said "~" ("return ~ to the
  // battlefield under ~'s owner's control with a +1/+1 counter on ~", a character card's "her"); the same object, so the same destination
  const itSelf = self ? alt('it', '~') : 'it';
  const its = self ? alt('its', "~'s") : 'its';
  switch (d.zone) {
    case 'battlefield': {
      const tail: string[] = [];
      // CLOUD std-tmt (CR 508.4): the named defender is said after both words too ("tapped and attacking that player")
      // std-typechange-1 (CR 702.49c): ninjutsu's "attacking the same player, planeswalker or battle as the returned creature" has no Oracle wording of its own (the
      // keyword's reminder text says "tapped and attacking"); refused anywhere else
      if (d.attacking && typeof d.attacking === 'object' && 'asReturned' in d.attacking) throw new NoRenderer('attacking as the creature returned for the cost');
      if (d.countersIf !== undefined) throw new NoRenderer('counters the moved card enters with that depend on what it is, outside the sentence after the move (render/edhpm10.ts)');
      if (d.enchantOnly !== undefined) throw new NoRenderer('a restriction on what the moved Auras enchant, outside the sentence after the move (render/steps-zones.ts)');
      if (d.becomes !== undefined) throw new NoRenderer('the types and size the moved permanents enter as, outside the sentence after the move (render/steps-zones.ts)'); // edh-next-125
      if (d.statusIf !== undefined) throw new NoRenderer('a status of the moved card that depends on what it is, outside a choice of one card (render/fold.ts#chooseThenMove)');
      if (d.tapped && d.attacking) tail.push(typeof d.attacking === 'object' ? `tapped and attacking ${K.player(d.attacking.defender, st, 'object').text}` : 'tapped and attacking');
      else {
        if (d.tapped) tail.push('tapped');
        if (d.attacking === true) tail.push('attacking');
        else if (d.attacking && typeof d.attacking === 'object') tail.push(`attacking ${K.player(d.attacking.defender, st, 'object').text}`);
      }
      if (d.faceDown) tail.push('face down');
      if (d.faceUpOrDown === true && d.zone === 'battlefield' && !d.faceDown) tail.push('face up or face down'); // edh-next-80 (CR 708.3; Deathmist Raptor)
      // M6-4: "tapped and transformed" (CR 712.14a; Oracle joins the two with "and", as it does "tapped and attacking")
      // edh-d-89 (CR 712.14a, 701.28a; Optimus Prime, Hero; family transformed-or-converted): "converted" puts the card onto the battlefield back face up just as "transformed" does
      if (d.transformed) tail.push(d.tapped && !d.attacking && tail[tail.length - 1] === 'tapped' ? (tail.pop(), 'tapped and transformed') : alt('transformed', 'converted'));
      let control = '';
      // FAST4 T31 (CR 110.2, 610.3c): several cards each return under their own owner's control: "under their owner's control" (Oracle's wording) or "their
      // owners'"; the singular wording stays a reading of the plural, as before
      if (d.controller === 'owner') control = plural ? alt(" under its owner's control", " under their owner's control", " under their owners' control") : ` under ${its} owner's control`;
      else if (typeof d.controller === 'object') {
        const key = playerKey(d.controller);
        // CR 110.2a: what a player puts onto the battlefield is under that player's control, so the words are optional; the model says it, so they come first
        if (key === 'you' && st.actor === null) control = alt(' under your control', '');
        // FAST4 T31: inside "you may ..." the actor is you, whose control is "your control" ("you may exile ..., then return that card to the battlefield
        // under your control"); the reading of before stays
        else if (key === 'you' && st.actor === 'you') control = alt(' under your control', ' under their control', '');
        else if (key !== null && key === st.actor) control = alt(' under their control', '');
        else control = ` under ${K.player(d.controller, st, 'possessive').text} control`;
      }
      // edh-next-144 (CR 303.4f, 608.2c; family enchanted-player-that-player; Curse of Misfortunes): the enchanted player the sentence named already is "that player" again
      const toPlayer = d.attachedToPlayer ? K.player(d.attachedToPlayer, st, 'object').text : '';
      const attachP = d.attachedToPlayer && (d.attachedToPlayer as { ref?: string }).ref === 'enchantedPlayer' ? alt(` attached to ${toPlayer}`, ' attached to that player') : ` attached to ${toPlayer}`;
      const attach = d.attachedTo ? ` attached to ${K.obj(d.attachedTo, st, 'object').text}` : d.attachedToPlayer ? attachP : ''; // edh-d-29: an Aura that enchants a player
      // FAST4 T30 (CR 614.1c, 122.6; family additional-counters): an object entering "with two additional +1/+1 counters on it" enters with those counters
      // besides any its own replacement effects give it, which is what "with two +1/+1 counters on it" does too (the replacement effects all apply)
      const counterWords = (c: { kind: string; count: Quantity }): string => {
        const n = typeof c.count === 'number' ? (c.count === 1 ? 'a' : numWord(c.count)) : K.qty(c.count, st);
        return alt(`${n} ${c.kind}`, `${c.count === 1 ? 'an' : n} additional ${c.kind}`);
      };
      // cloud r3-mech (CR 122.1, 608.2h): "with one fewer revival counter on it": the counters of that kind it had, less one (none below 0), the math the template
      // eff.r3mech.return.bf.oneFewerCounter writes and nothing else
      const oneFewer = (c: { kind: string; count: Quantity }): boolean => {
        const m = c.count as { q?: string; op?: string; args?: unknown[] };
        const inner = m.args?.[1] as { q?: string; op?: string; args?: unknown[] } | undefined;
        const cnt = inner?.args?.[0] as { q?: string; kind?: string } | undefined;
        return m.q === 'math' && m.op === 'max' && m.args?.length === 2 && m.args[0] === 0 && inner?.q === 'math' && inner.op === '-' && inner.args?.length === 2
          && inner.args[1] === 1 && cnt?.q === 'counters' && cnt.kind === c.kind;
      };
      const counterNoun = (c: { kind: string; count: Quantity }): string => (oneFewer(c) ? `one fewer ${c.kind} counter` : `${counterWords(c)} counter${c.count === 1 ? '' : 's'}`);
      const onWhat = plural ? 'each of them' : itSelf;
      const kinds = d.counters ?? [];
      // std-tdm (CR 614.1c, 122.6; family counters-on-it-once): two kinds of counters or more are also said with one "on it", "with a hexproof counter and an
      // indestructible counter on it"; the wording with an "on it" after each kind stays a reading
      const eachOn = kinds.map((c) => `${counterNoun(c)} on ${onWhat}`).join(' and ');
      // edh-next-55 (CR 614.1c, 122.6; Grave Endeavor): a computed number of counters is also "with a number of +1/+1 counters on it equal to that result"
      const numberOf = kinds.length === 1 && typeof kinds[0]!.count === 'object' && !oneFewer(kinds[0]!) ? `a number of ${kinds[0]!.kind} counters on ${onWhat} equal to ${K.qty(kinds[0]!.count, st)}` : null;
      const counters = kinds.length === 0 ? '' : ` with ${kinds.length > 1 || numberOf !== null ? alt(eachOn, kinds.length > 1 ? `${joinList(kinds.map(counterNoun))} on ${onWhat}` : numberOf!) : eachOn}`;
      const mods = tail.length > 0 ? ` ${tail.join(' ')}` : '';
      // FAST4 T25 (CR 614.1c, 110.2): "under its owner's control with a +1/+1 counter on it" and "with a +1/+1 counter on it under its owner's control" are one
      // destination; Oracle prints the control first
      const rest = counters !== '' && control !== '' ? alt(`${counters}${control}`, `${control}${counters}`) : `${counters}${control}`;
      // Cloud std-eoe (CR 110.2, 508.4): "onto the battlefield under your control tapped and attacking" (Chorale of the Void) is the same destination as "... tapped and
      // attacking under your control": the control and the state of the object it enters with, said in either order (no counters, nothing attached)
      // edh-c-68 (CR 303.4f, 110.2; family attached-after-control; Iridescent Drake): the control first, then what it is attached to, "onto the battlefield under your control attached to ~"
      const where = mods !== '' && control !== '' && counters === '' && attach === '' ? alt(`${mods}${control}`, `${control}${mods}`) : attach !== '' && counters === '' && control !== '' ? alt(`${mods}${attach}${rest}`, `${mods}${rest}${attach}`) : `${mods}${attach}${rest}`;
      return `${returning ? alt('to', 'onto') : alt('onto', 'to')} the battlefield${where}`;
    }
    case 'hand': return `${preferYour ? alt('into', 'to') : alt('to', 'into')} ${ownersZone('hand', d.owner, plural, st, preferYour, self)}`; // edh-c-110: the object itself goes to "~'s owner's hand" (family self-by-name)
    case 'graveyard': return `${alt('into', 'to')} ${ownersZone('graveyard', d.owner, plural, st, preferYour, false, true)}`;
    case 'library': {
      const lib = ownersZone('library', d.owner, plural, st, preferYour, self, d.position === 'top'); // (edh-c-67: "that player's" only for the top and the graveyard)
      const order = d.order === 'chosen' ? ' in any order' : d.order === 'random' ? ' in a random order' : '';
      if (d.position === 'top') return `${alt('on top of', 'on the top of')} ${lib}${order}`;
      if (d.position === 'bottom') return `${alt('on the bottom of', 'on bottom of')} ${lib}${order}`;
      if (d.position === 'random') return `into ${lib} at random`;
      if (d.position && typeof d.position === 'object') {
        const nth = d.position.nth;
        // pc-zones-1 (CR 401.3): "just beneath the top X cards of that library" is the place after those cards, the Nth from the top with N one more than the number said
        if (typeof nth === 'object' && nth.q === 'math' && nth.op === '+' && nth.args.length === 2 && nth.args[1] === 1) {
          const topN = nth.args[0]!;
          // edh-c-36 (CR 107.3, 401.3; Quarry Colossus; family beneath-top-where-x): a counted number is also said "the top X cards of that library, where X is <the count>"
          return typeof topN === 'number' ? `into ${lib} just beneath the top ${K.qty(topN, st)} cards of that library`
            : alt(`into ${lib} just beneath the top ${K.qty(topN, st)} cards of that library`, `into ${lib} just beneath the top x cards of that library, where x is ${K.qty(topN, cloneState(st))}`);
        }
        const digits = `${K.qty(nth, st)}${typeof nth === 'number' ? ordinalSuffix(nth) : ''}`;
        // r4-refs (CR 401.3): Oracle spells the place out, "into its owner's library third from the top"
        const word = typeof nth === 'number' ? ORDINAL_WORD[nth] : undefined;
        return `into ${lib} ${word === undefined ? digits : alt(digits, word)} from the top`;
      }
      return `into ${lib}${order}`;
    }
    case 'exile': return `${d.faceDown ? 'face down' : ''}${exileCounters(d, plural, itSelf)}`;
    case 'stack': return 'onto the stack';
    case 'command': return `${alt('into', 'to')} the command zone`;
  }
}

/** r4-refs: the ordinal words of the places in a library Oracle names (CR 401.3). */
const ORDINAL_WORD: Readonly<Record<number, string>> = { 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth', 7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth' }; // edh-cast-2: through tenth (CR 401.7)

function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  return n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
}

/** What an anaphor for this reference can say (nouns, plurality): after the reference has been printed. */
export function infoOfRef(ref: ObjRef, st: RenderState): RefInfo {
  if (ref.ref === 'each') return { nouns: K.nounsOf(ref.filter), plural: true };
  const key = objKey(ref);
  const known = key === null ? undefined : st.info.get(key);
  if (known) return known;
  if (ref.ref === 'union') return { nouns: ['permanent'], plural: true };
  if (ref.ref === 'topCards') return { nouns: ['card'], plural: !(typeof ref.count === 'number' && ref.count === 1) || (ref.player.ref === 'event' && ref.player.role === 'recipient' && st.triggerWholeBatch === true) /* edh-top-6 */ };
  return { nouns: ['permanent'], plural: false };
}

/** A clause with no actor (an effect on objects). */
export const effectClause = (text: string, extra: Partial<Clause> = {}): Clause => plain(text, extra);

/**
 * r4-moved (the parser's rule, parser/lower/anaphora.ts#resolveIn with lower/mentions.ts#movedCondMention; CR 608.2c, 603.12): the key of the card a "this way" condition
 * on a discard of one card names ("If you discard a land card this way, put it ..."), the focus of the first instruction of the condition's branch. Only a `did` with a
 * description, of a step bound as one card (render/steps-cards.ts#discard: "the discarded card").
 */
/**
 * p2-dig-2 (the parser's rule, parser/lower/anaphora.ts#revealedCondMention; CR 701.20a, 608.2c): the key of the one card an "if" on a reveal names ("If a land card is
 * revealed this way, put it onto the battlefield tapped."), the focus of the condition's branch. Only a `matches` of a binding of a reveal of one top card
 * (render/steps-cards.ts#reveal: `revealedTop`, one card).
 */
export function revealedCondFocus(cond: Condition | undefined, st: RenderState): string | undefined {
  if (cond === undefined || cond.cond !== 'matches') return undefined;
  const is = cond.object;
  if (is.ref !== 'bound') return undefined;
  const info = st.info.get(`b:${is.name}`);
  return info !== undefined && info.revealedTop === true && info.plural === false ? `b:${is.name}` : undefined;
}

export function movedCondFocus(cond: Condition | undefined, st: RenderState): string | undefined {
  if (cond === undefined || cond.cond !== 'did' || cond.which === undefined || cond.not === true) return undefined;
  const info = st.info.get(`b:${cond.step}`);
  return info !== undefined && info.plural === false && info.player !== true && (info.alts ?? []).includes('the discarded card') ? `b:${cond.step}` : undefined;
}

/**
 * edh-next-138 (CR 603.4, 608.2h; parser/lower/quantities.ts#atLeastCount; Desert Warfare): is `n` the count the intervening "if" being rendered states with "N or more" ("if you control five or
 * more Deserts, create that many ... tokens"): the whole condition or the one such part of its "and"?
 */
export function countStatedByIf(n: Quantity, st: RenderState): boolean {
  const c = st.interveningIf;
  const parts = c === undefined ? [] : c.cond === 'all' ? c.of.filter((x) => x.cond === 'exists' && typeof x.atLeast === 'number' && x.atLeast >= 2) : c.cond === 'exists' && typeof c.atLeast === 'number' && c.atLeast >= 2 ? [c] : [];
  return parts.length === 1 && parts[0]!.cond === 'exists' && typeof n === 'object' && n.q === 'count' && Object.keys(parts[0]!).length === 3 && JSON.stringify(n.of) === JSON.stringify(parts[0]!.of);
}

/**
 * edh-next-133 (CR 707.2, 122.6, 107.1a; Ochre Jelly): the counter kind of a single token copy (nothing else changed) that enters with half the counters of that kind the copied object has,
 * rounded down (`counters: [{kind, count: floorDiv(counters of that kind on the copied object, 2)}]`, rider rid.edhn133.token.entersWith.halfThatMany); null for any other copy.
 */
export function halfThatManyCounters(s: StepOf<'copy'>): string | null {
  if (s.result !== 'token' || !(s.count === undefined || s.count === 1) || (s.except !== undefined && s.except.length > 0) || s.tapped === true || s.attacking !== undefined || s.counters?.length !== 1) return null;
  const k = s.counters[0]!;
  const c = k.count as { q?: string; op?: string; args?: unknown[] };
  if (c.q !== 'math' || c.op !== 'floorDiv' || c.args?.length !== 2 || c.args[1] !== 2) return null;
  const n = c.args[0] as { q?: string; on?: unknown; kind?: string };
  if (n.q !== 'counters' || n.kind !== k.kind || JSON.stringify(n.on) !== JSON.stringify(s.what) || Object.keys(n).length !== 3) return null;
  return k.kind;
}
