/**
 * Helpers shared by the step renderers (WP2): clauses with an acting player, counted nouns, destinations, bindings.
 */
import type { Condition, Count, Destination, EffectStep, ObjectFilter, ObjRef, PlayerRef, Quantity, ZoneName } from '../types/ability';
import { acting, plain, type Clause } from './clause';
import { K } from './kernel';
import { cloneState, objKey, playerKey, type RefInfo, type RenderState } from './state';
import { countParts, sizeVsWords } from './qty';
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
  if (typeof n === 'object' && n.q === 'count' && n.of.ref === 'each' && st !== undefined) {
    const each = countParts(n, st);
    if (each !== null) return ` once for each ${each.singular}`;
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
  return acting(key ?? 'x', body, they === null ? `${subj.text} ${pred}` : alt(`${subj.text} ${pred}`, `they ${they}`), { pred, have: `${subj.text} ${body}`, ...extra });
}

/** `byPlayer` where the verb phrase is already complete in both persons (a modal like "may draw"). */
export function modal(who: PlayerRef, st: RenderState, phrase: string, extra: Partial<Clause> = {}): Clause {
  const subj = K.player(who, st, 'subject');
  const key = playerKey(who);
  // a modal verb phrase ("may draw a card") only reads with its subject: there is no imperative form
  return acting(key ?? 'x', `${subj.text} ${phrase}`, `${subj.text} ${phrase}`, extra);
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
export function halfOfControlled(q: Quantity, filter: ObjectFilter, who: PlayerRef): 'up' | 'down' | null {
  if (typeof q !== 'object' || q.q !== 'math' || (q.op !== 'ceilDiv' && q.op !== 'floorDiv') || q.args.length !== 2 || q.args[1] !== 2) return null;
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
  return `${pluralize(noun)} equal to ${v}`;
}

/** "3" or "damage equal to its power": an amount that is a number or a computed value, for "deals X damage" / "gain X life". */
export function amountOf(n: Quantity, unit: string, st: RenderState, o: { whereX?: boolean } = {}): string {
  if (typeof n === 'number') return `${n} ${unit}`;
  if (typeof n === 'object' && n.q === 'X' && st.costAllCountersX === undefined) return `X ${unit}`; // p2-counters-move-2: an X printed nowhere is said by its count
  // std-re (family draw-where-x): an amount said before as "X, where X is ..." is X again
  const again = saidX(n, st) ? [`X ${unit}`] : [];
  // std-r10 (CR 115.1, 608.2c): the "for each" readings are also said as from before "equal to ..." named a target: "you gain 2 life for each creature target
  // player controls" names the target there for the first time (perForms)
  const before = cloneState(st);
  const v = K.qty(n, st);
  // FAST4 T30 (CR 107.3, 608.2h; family draw-where-x): where the amount ends the clause, a computed amount is also "loses X life, where X is ..."
  const offered = o.whereX === true && typeof n === 'object' && isComputed(n) && n.q !== 'eventAmount';
  if (offered) markX(n, st);
  const where = [...again, ...(offered ? [`X ${unit}, where X is ${v}`] : [])];
  // PUSH1 T2: the amount of the trigger event too ("you gain that much life", "it deals that much damage"; design 3.5 `eventAmount`)
  // FAST5X E16: "you gain that much life" after "if <that creature> is dealt excess damage this way" (CR 120.4a, 608.2c); FAST5X E22: and after "if you sacrificed one or more permanents this turn" (render/qty.ts, the count of that condition)
  // cloud std-spm (CR 615.5): and in a prevention's own additional instruction ("prevent that damage and you gain that much life")
  // (std-ry10: a turn's history count is "that much" only when it is said so, never because its own words have "that" in them: "creatures that died this turn")
  // p2-c-dieroll-2 (family die-result-that-much): and the result of the roll before ("you lose that much life", "~ deals that much damage to you")
  if (typeof n === 'object' && (n.q === 'var' || n.q === 'eventAmount' || n.q === 'excessDamage' || n.q === 'preventedAmount' || n.q === 'dieResult' || (n.q === 'happenedCount' && v.startsWith('that'))) && v.includes('that')) return alt(`${v} ${unit}`, `${unit} equal to ${v}`);
  // FAST4 T34 (CR 107.3): "gains twice X life", two times the announced X
  // p2-counters-move-2 (family per-object-amount): an X that is the number of counters the cost removed is also counted per counter, "you gain 2 life for each elixir
  // counter removed this way" (render/qty.ts#countParts of X; nothing when X is any other number)
  if (typeof n === 'object' && n.q === 'math' && n.op === '*' && n.args.length === 2 && n.args[0] === 2 && typeof n.args[1] === 'object' && n.args[1].q === 'X') return alt(`${unit} equal to ${v}`, `twice X ${unit}`, ...perForms(n.args[1], st, before).map((x) => `2 ${unit} for each ${x}`));
  // FAST2 T8: a fixed amount per object, "gain 2 life for each creature you control" (math * [k, count])
  if (typeof n === 'object' && n.q === 'math' && n.op === '*' && n.args.length === 2 && typeof n.args[0] === 'number' && n.args[0] > 1) {
    const each = perForms(n.args[1]!, st, before);
    if (each.length > 0) return alt(`${unit} equal to ${v}`, ...each.map((x) => `${n.args[0]} ${unit} for each ${x}`), ...where);
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
export function ownersZone(zone: ZoneName, owner: PlayerRef | undefined, plural: boolean, st: RenderState, preferYour = false, self = false): string {
  const word = ZONE_WORDS[zone] ?? zone;
  if (owner !== undefined) return `${K.player(owner, st, 'possessive').text} ${word}`;
  // FAST5X E24 (CR 201.5): the object itself goes to its owner's zone, "~'s owner's library" (a character card's "his owner's library")
  if (self && !plural && !preferYour) return `${alt("its owner's", 'your', "their owner's", "~'s owner's")} ${word}`;
  if (preferYour) return alt(`your ${word}`, `its owner's ${word}`, `their owner's ${word}`, `their owners' ${PLURAL_ZONE[zone] ?? word}`);
  if (plural) return alt(`their owners' ${PLURAL_ZONE[zone] ?? word}`, `your ${word}`, `their owner's ${word}`, `its owner's ${word}`);
  return `${alt("its owner's", 'your', "their owner's")} ${word}`;
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
      if (d.statusIf !== undefined) throw new NoRenderer('a status of the moved card that depends on what it is, outside a choice of one card (render/fold.ts#chooseThenMove)');
      if (d.tapped && d.attacking) tail.push(typeof d.attacking === 'object' ? `tapped and attacking ${K.player(d.attacking.defender, st, 'object').text}` : 'tapped and attacking');
      else {
        if (d.tapped) tail.push('tapped');
        if (d.attacking === true) tail.push('attacking');
        else if (d.attacking && typeof d.attacking === 'object') tail.push(`attacking ${K.player(d.attacking.defender, st, 'object').text}`);
      }
      if (d.faceDown) tail.push('face down');
      // M6-4: "tapped and transformed" (CR 712.14a; Oracle joins the two with "and", as it does "tapped and attacking")
      if (d.transformed) tail.push(d.tapped && !d.attacking && tail[tail.length - 1] === 'tapped' ? (tail.pop(), 'tapped and transformed') : 'transformed');
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
      const attach = d.attachedTo ? ` attached to ${K.obj(d.attachedTo, st, 'object').text}` : '';
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
      const counters = kinds.length === 0 ? '' : ` with ${kinds.length > 1 ? alt(eachOn, `${joinList(kinds.map(counterNoun))} on ${onWhat}`) : eachOn}`;
      const mods = tail.length > 0 ? ` ${tail.join(' ')}` : '';
      // FAST4 T25 (CR 614.1c, 110.2): "under its owner's control with a +1/+1 counter on it" and "with a +1/+1 counter on it under its owner's control" are one
      // destination; Oracle prints the control first
      const rest = counters !== '' && control !== '' ? alt(`${counters}${control}`, `${control}${counters}`) : `${counters}${control}`;
      // Cloud std-eoe (CR 110.2, 508.4): "onto the battlefield under your control tapped and attacking" (Chorale of the Void) is the same destination as "... tapped and
      // attacking under your control": the control and the state of the object it enters with, said in either order (no counters, nothing attached)
      const where = mods !== '' && control !== '' && counters === '' && attach === '' ? alt(`${mods}${control}`, `${control}${mods}`) : `${mods}${attach}${rest}`;
      return `${returning ? alt('to', 'onto') : alt('onto', 'to')} the battlefield${where}`;
    }
    case 'hand': return `${preferYour ? alt('into', 'to') : alt('to', 'into')} ${ownersZone('hand', d.owner, plural, st, preferYour)}`;
    case 'graveyard': return `${alt('into', 'to')} ${ownersZone('graveyard', d.owner, plural, st, preferYour)}`;
    case 'library': {
      const lib = ownersZone('library', d.owner, plural, st, preferYour, self);
      const order = d.order === 'chosen' ? ' in any order' : d.order === 'random' ? ' in a random order' : '';
      if (d.position === 'top') return `${alt('on top of', 'on the top of')} ${lib}${order}`;
      if (d.position === 'bottom') return `${alt('on the bottom of', 'on bottom of')} ${lib}${order}`;
      if (d.position === 'random') return `into ${lib} at random`;
      if (d.position && typeof d.position === 'object') {
        const nth = d.position.nth;
        // pc-zones-1 (CR 401.3): "just beneath the top X cards of that library" is the place after those cards, the Nth from the top with N one more than the number said
        if (typeof nth === 'object' && nth.q === 'math' && nth.op === '+' && nth.args.length === 2 && nth.args[1] === 1) {
          return `into ${lib} just beneath the top ${K.qty(nth.args[0]!, st)} cards of that library`;
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
    case 'command': return 'into the command zone';
  }
}

/** r4-refs: the ordinal words of the places in a library Oracle names (CR 401.3). */
const ORDINAL_WORD: Readonly<Record<number, string>> = { 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth' };

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
  if (ref.ref === 'topCards') return { nouns: ['card'], plural: !(typeof ref.count === 'number' && ref.count === 1) };
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
