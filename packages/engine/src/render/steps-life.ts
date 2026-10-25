/**
 * Damage, life and counters (WP2): damage, gainLife, loseLife, setLife, fight, putCounters, removeCounters, moveCounters (CR 120, 119, 122, 701.14).
 */
import { namesOnePlayer } from '../model/focus';
import type { CounterKind, ObjRef, PlayerRef, Quantity, Ref } from '../types/ability';
import { plain, type Clause } from './clause';
import { K } from './kernel';
import { countParts } from './qty';
import { groupPart, identityOf, isPlayerRef } from './refs';
import { amountOf, bind, byPlayer, halfOfOwn, perForms, type StepOf } from './steps-util';
import { absorb, cloneState, objKey, type RenderState } from './state';
import { alt, NoRenderer, numWord, pluralize, withArticle } from './text';

const refText = (ref: Ref, st: RenderState, form: 'subject' | 'object' | 'possessive' = 'object', prefer?: 'all' | 'each'): string =>
  isPlayerRef(ref as ObjRef | PlayerRef, st) ? K.player(ref as PlayerRef, st, form).text : K.obj(ref as ObjRef, st, form, { prefer }).text;

/** std-rx1: `n` is the count of the "prime number of ..." condition of the intervening "if" being rendered (the whole condition or one part of its "and"). */
function statedByIf(n: Quantity, st: RenderState): boolean {
  const c = st.interveningIf;
  const primes = c === undefined ? [] : c.cond === 'prime' ? [c] : c.cond === 'all' ? c.of.filter((x) => x.cond === 'prime') : [];
  return primes.length === 1 && primes[0]!.cond === 'prime' && JSON.stringify(primes[0]!.of) === JSON.stringify(n);
}

/** "a +1/+1 counter", "three +1/+1 counters", "X +1/+1 counters". */
export function countersText(n: Quantity | 'all', kind: CounterKind | 'any', st: RenderState): string {
  const noun = kind === 'any' ? 'counter' : `${kind} counter`;
  if (n === 'all') return kind === 'any' ? 'all counters' : `all ${kind} counters`;
  if (typeof n === 'number') return n === 1 ? withArticle(noun) : `${numWord(n)} ${pluralize(noun)}`;
  if (typeof n === 'object' && n.q === 'X' && st.costAllCountersX === undefined) return `X ${pluralize(noun)}`; // p2-counters-move-2: unless X is printed nowhere
  // FAST2 T8: the amount of the triggering event, "whenever you gain life, put that many +1/+1 counters on ~" (design 3.5 `eventAmount`)
  if (typeof n === 'object' && n.q === 'eventAmount') return alt(`a number of ${pluralize(noun)} equal to ${K.qty(n, st)}`, `that many ${pluralize(noun)}`);
  // cloud std-spm (CR 615.5): the damage a prevention prevented, in its own additional instruction ("prevent that damage and put that many +1/+1 counters on ~")
  if (typeof n === 'object' && n.q === 'preventedAmount') return alt(`a number of ${pluralize(noun)} equal to ${K.qty(n, st)}`, `that many ${pluralize(noun)}`);
  // FAST5 T78 (CR 608.2h): "that many" is a value an earlier step of the effect fixed and already said ("pay life equal to its power. If you do, put that many +1/+1 counters on it")
  if (typeof n === 'object' && n.q === 'var' && st.vars.get(n.name)?.used === true) return alt(`a number of ${pluralize(noun)} equal to ${K.qty(n, st)}`, `that many ${pluralize(noun)}`);
  // std-rx1 (CR 603.4, 608.2h; parser/lower/quantities.ts#primeCount): "that many" is the number the intervening "if" states ("if ... you control a prime number of
  // lands, create Primo, ..., then put that many +1/+1 counters on it")
  if (typeof n === 'object' && statedByIf(n, st)) return alt(`a number of ${pluralize(noun)} equal to ${K.qty(n, st)}`, `that many ${pluralize(noun)}`);
  // std-sos (CR 107.3, 107.1): a multiple of X says the multiple in front of the noun, "put twice X stun counters on it" (`math *` of a number and X)
  if (typeof n === 'object' && n.q === 'math' && n.op === '*' && n.args.length === 2 && typeof n.args[0] === 'number' && typeof n.args[1] === 'object' && n.args[1].q === 'X') {
    return alt(`a number of ${pluralize(noun)} equal to ${K.qty(n, st)}`, `${K.qty(n, st)} ${pluralize(noun)}`);
  }
  return `a number of ${pluralize(noun)} equal to ${K.qty(n, st)}`;
}

/** A literal amount of damage ("3 damage", "X damage"), or null for a computed one. */
const literalDamage = (n: Quantity): string | null =>
  typeof n === 'number' || (typeof n === 'object' && n.q === 'X') ? `${typeof n === 'number' ? n : 'X'} damage` : null;

/**
 * FAST2 T8: the recipients of `also` (more recipients of the same damage event, CR 120.2b, 120.3f): " and 2 damage to you", or, when every amount is the
 * same, " and each player" ("~ deals 1 damage to each creature and each player"). Only one more recipient, and never with a division.
 */
function alsoText(s: StepOf<'damage'>, st: RenderState): string {
  const also = s.also ?? [];
  if (also.length === 0) return '';
  if (also.length > 1 || s.divided !== undefined) throw new NoRenderer('damage with several further recipients, or divided damage with a further recipient');
  const a = also[0]!;
  const lit = literalDamage(a.amount);
  // FAST5 T49 (CR 107.3, 608.2h): "~ deals 5 damage to target creature and X damage to that creature's controller, where X is the number of Equipment you
  // control": the further recipient's amount is the computed one (the first amount is a plain number)
  // p2-pt-1 (CR 120.2b, 608.2h): "deals damage equal to its power to each other creature and each opponent" (Chandra's Ignition): the same computed amount to the
  // further recipient is said once, before both
  if (lit === null && JSON.stringify(a.amount) === JSON.stringify(s.amount) && literalDamage(s.amount) === null) return ` and ${refText(a.to, st, 'object', 'each')}`;
  if (lit === null) {
    if (typeof a.amount !== 'object' || ['X', 'var', 'eventAmount', 'resultCount', 'ask', 'live'].includes(a.amount.q) || typeof s.amount !== 'number') throw new NoRenderer('a further damage recipient with a computed amount');
    const who = refText(a.to, st, 'object', 'each');
    return ` and X damage to ${who}, where X is ${K.qty(a.amount, st)}`;
  }
  // FAST4 T30 (CR 120.3): "~ deals 2 damage to any target and 3 damage to itself": the further recipient is the source of the same damage event
  const to = JSON.stringify(a.to) === JSON.stringify(s.source) ? 'itself' : refText(a.to, st, 'object', 'each');
  const same = JSON.stringify(a.amount) === JSON.stringify(s.amount);
  // FAST4 T25 (CR 109.4, 102.3): "each opponent and each creature they control": after "each opponent", "they control" is the objects an opponent controls,
  // the same set as "each creature your opponents control"; only that pair, with the same amount
  const f = a.to.ref === 'each' && 'filter' in a.to ? a.to.filter : undefined;
  if (same && s.to.ref === 'each' && 'who' in s.to && s.to.who === 'opponent' && f !== undefined && f.controller === 'opponent') {
    const { controller: _c, ...rest } = f;
    // p2-damage-3: the amount said again, "1 damage to each opponent and 1 damage to each creature your opponents control" (Dagger Caster), as for any other pair below
    return alt(` and ${to}`, ` and ${K.np(rest, st, { det: 'each' })} they control`, ` and ${lit} to ${to}`);
  }
  // FAST4 T34 (CR 601.2c; family damage-each-of): "and 3 damage to each of up to two other targets", the same amount to every one of several targets
  const eachOf = a.to.ref === 'target' && (st.specs.get(a.to.id)?.max ?? 1) !== 1 ? [` and ${lit} to each of ${to}`] : [];
  return same ? alt(` and ${to}`, ` and ${lit} to ${to}`, ...eachOf) : alt(` and ${lit} to ${to}`, ...eachOf);
}

/** Object references that name one thing already known (a pronoun or "that creature" when written again). */
const NAMED_OBJECT: ReadonlySet<string> = new Set(['self', 'target', 'bound', 'event', 'attachedTo', 'linked']);

/**
 * FAST3 T18: the recipient written as the OBJECT of "deals damage to" is never the source that is the subject of the same clause: that would be "itself"
 * (FAST2 T8 writes it so). So in "Whenever a creature attacks, ~ deals 1 damage to it" the source ~ is no other antecedent of "it" (CR 120.3; the parser never
 * offers the step's own source for an object it acts on, parser/lower/mentions.ts). Only a recipient that IS a named object, not one read through a
 * possessive ("its controller", where ~ stays a candidate).
 */
function recipientText(s: StepOf<'damage'>, st: RenderState): string {
  // std-rx19 (CR 506.2, 508.1b): the defender of the trigger's lone attack, a player or the planeswalker (or battle) attacked: "the player or planeswalker it's
  // attacking" (parser/holes/object.ts#attacked; family attacked-defender)
  const to = s.to as { ref: string; role?: string };
  if (to.ref === 'event' && to.role === 'defender' && Object.keys(to).length === 2 && st.trigger?.length === 1 && st.trigger[0]!.ev === 'attacks') {
    // p2-combat-flow-1 (family attacked-that-creature): the attacker named by its noun, "the player or planeswalker that creature is attacking"
    return alt("the player or planeswalker it's attacking", 'the player or planeswalker that creature is attacking');
  }
  const key = objKey(s.source);
  if (key === null || !NAMED_OBJECT.has((s.to as { ref: string }).ref) || isPlayerRef(s.to as ObjRef | PlayerRef, st)) return refText(s.to, st, 'object', 'each');
  const saved = st.notAntecedent;
  st.notAntecedent = identityOf(st, key);
  try {
    return refText(s.to, st, 'object', 'each');
  } finally {
    if (saved === undefined) delete st.notAntecedent;
    else st.notAntecedent = saved;
  }
}

/** r5-fxb: write the amount of damage a target deals with that target as its own subject (RenderState.ownSubject). */
function ownAmount<T>(s: StepOf<'damage'>, st: RenderState, f: () => T): T {
  if (s.source.ref !== 'target') return f();
  const saved = st.ownSubject;
  st.ownSubject = `t:${s.source.id}`;
  try {
    return f();
  } finally {
    if (saved === undefined) delete st.ownSubject;
    else st.ownSubject = saved;
  }
}

const damageClause = (s: StepOf<'damage'>, st: RenderState): Clause => {
  // FAST4 T19: what the step dealt damage to (effects/handlers/lifedamage.ts binds exactly those, CR 120.3): "a creature dealt damage this way"; known to the
  // later sentence only (not an antecedent of a pronoun: the parser names the step only for that phrase, parser/lower/mentions.ts)
  if (s.as !== undefined) st.info.set(`b:${s.as}`, { nouns: [], plural: true, thisWay: 'dealt damage this way' });
  const src = K.obj(s.source, st, 'subject');
  // FAST5 T49 (CR 120.3, 608.2h): "up to two target creatures you control each deal damage equal to their power to target creature an opponent controls": a
  // group of sources, each dealing its own power (the amount reads {ref:'subject'}); only that shape (no division, no further recipient, no unpreventable rider)
  if (s.perSource === true) {
    // r4-refs (CR 120.1, 120.3): "each creature you control deals 1 damage to that creature": every object of a group deals the same fixed amount, one damage event
    if (typeof s.amount === 'number' && s.source.ref === 'each' && 'filter' in s.source && s.divided === undefined && (s.also ?? []).length === 0 && s.unpreventable !== true) {
      const to = recipientText(s, st);
      const each = `each ${K.np(s.source.filter, st, { det: 'none' })}`;
      return plain(`${each} deals ${s.amount} damage to ${to}`, { have: `${each} deal ${s.amount} damage to ${to}` });
    }
    const own = typeof s.amount === 'object' && s.amount.q === 'stat' && s.amount.stat === 'power' && s.amount.of.ref === 'subject';
    if (!own || s.divided !== undefined || (s.also ?? []).length > 0 || s.unpreventable === true) throw new NoRenderer('damage dealt by each source of a group, other than damage equal to its power');
    const to = recipientText(s, st);
    // Standard round I (family each-deals-own-power): the objects of a group on the battlefield are also "each <group> deals damage equal to its power" (Bartz and Boko)
    if (s.source.ref === 'each' && 'filter' in s.source) {
      const each = `each ${K.np(s.source.filter, st, { det: 'none' })}`;
      return plain(alt(`${src.text} each deal damage equal to their power to ${to}`, `${each} deals damage equal to its power to ${to}`), { have: `${each} deal damage equal to their power to ${to}` });
    }
    return plain(`${src.text} each deal damage equal to their power to ${to}`, { have: `${src.text} each deal damage equal to their power to ${to}` });
  }
  // Cloud std-fin (CR 120.3, 120.2b, 107.3, 608.2h): "target creature you control deals X damage to any other target and X damage to itself, where X is its power"
  // (Self-Destruct): one computed amount, read once, dealt to the recipient and to the source itself in the same damage event; only that exact pair
  const selfToo = (s.also ?? []).length === 1 ? s.also![0]! : undefined;
  if (selfToo !== undefined && s.divided === undefined && s.unpreventable !== true && typeof s.amount === 'object' && !['X', 'var', 'eventAmount', 'resultCount', 'ask', 'live'].includes(s.amount.q)
    && JSON.stringify(selfToo.to) === JSON.stringify(s.source) && JSON.stringify(selfToo.amount) === JSON.stringify(s.amount) && s.source.ref !== 'self') {
    const to = recipientText(s, st);
    // the quantity is the subject's ("its power"): the recipient named in between is no antecedent of the possessive (the parser reads it the same way,
    // parser/templates/zz-cloud/std-fin.json#eff.stdfin.damage.andItself.whereXItsPower)
    const toKey = objKey(s.to as ObjRef);
    const saved = st.notAntecedent;
    if (toKey !== null) st.notAntecedent = identityOf(st, toKey);
    let x: string;
    try {
      x = K.qty(s.amount, st);
    } finally {
      if (saved === undefined) delete st.notAntecedent;
      else st.notAntecedent = saved;
    }
    const rest = `X damage to ${to} and X damage to itself, where X is ${x}`;
    return plain(`${src.text} ${src.plural ? 'deal' : 'deals'} ${rest}`, { have: `${src.text} deal ${rest}` });
  }
  // std-rx5 (family any-number-that-many): the X of a "Remove any number of ... counters" cost is "that much damage"
  // p2-counters-move-2: the X of "Remove all <kind> counters from ~" is no literal ("damage to any target equal to the number of +1/+1 counters removed this way")
  const lit = typeof s.amount === 'object' && s.amount.q === 'X' && st.anyNumberX === true ? 'that much damage' : typeof s.amount === 'object' && s.amount.q === 'X' && st.costAllCountersX !== undefined ? null : literalDamage(s.amount);
  // FAST2 T8: "target creature deals damage to itself equal to its power": the source is its own recipient
  const itself = s.source.ref !== 'self' && JSON.stringify(s.source) === JSON.stringify(s.to);
  // FAST2 T8: Oracle also puts the recipient before a computed amount ("deals damage to target player equal to the number of cards in that player's
  // hand"); that order names the recipient first, so it is rendered on a copy of the state as it is before either part (the usual order is unchanged)
  const reorder = lit === null && s.divided === undefined && typeof s.amount === 'object' && s.amount.q !== 'var' && s.amount.q !== 'eventAmount';
  let reordered: string | null = null;
  let copy: RenderState | null = null;
  // FAST4 T30 (CR 107.3, 608.2h; family draw-where-x): "deals X damage to that player, where X is 3 minus the number of cards in their hand", rendered on a
  // copy of the state too (the recipient is named before the quantity)
  let whereX: string | null = null;
  if (reorder) {
    copy = cloneState(st);
    const t = itself ? 'itself' : recipientText(s, copy);
    reordered = `damage to ${t} equal to ${ownAmount(s, copy, () => K.qty(s.amount, copy!))}`;
    if (!itself && s.amount !== null && typeof s.amount === 'object' && s.amount.q !== 'X') {
      const w = cloneState(st);
      const wt = recipientText(s, w);
      whereX = `X damage to ${wt}, where X is ${ownAmount(s, w, () => K.qty(s.amount, w))}`;
    }
  }
  // std-tdm (CR 601.2d, 107.3, 608.2h; family divided-where-x): a computed amount divided among the targets as the ability is put on the stack is also "X damage
  // divided as you choose among ..., where X is ...", rendered on a copy of the state (the recipients are named before the quantity)
  let dividedX: string | null = null;
  let dividedCopy: RenderState | null = null;
  if (s.divided === 'announced' && lit === null && typeof s.amount === 'object' && s.amount.q !== 'X' && s.amount.q !== 'var' && s.amount.q !== 'eventAmount' && !itself) {
    dividedCopy = cloneState(st);
    const dt = recipientText(s, dividedCopy);
    dividedX = `X damage divided as you choose among ${dt}, where X is ${K.qty(s.amount, dividedCopy)}`;
  }
  const amount = lit ?? ownAmount(s, st, () => amountOf(s.amount, 'damage', st));
  const to = itself ? 'itself' : recipientText(s, st);
  if (copy) absorb(st, copy);
  if (dividedCopy) absorb(st, dividedCopy);
  const more = alsoText(s, st);
  // p2-pt-1 (CR 120.2b): one computed amount for both recipients, "damage equal to its power to each other creature and each opponent" (alsoText)
  const sameComputed = more !== '' && lit === null && s.also?.length === 1 && JSON.stringify(s.also[0]!.amount) === JSON.stringify(s.amount) && s.divided === undefined;
  if (more !== '' && lit === null && !sameComputed) throw new NoRenderer('a computed amount of damage with a further recipient');
  let rest: string;
  if (s.divided === 'announced') rest = dividedX === null ? `${amount} divided as you choose among ${to}` : alt(`${amount} divided as you choose among ${to}`, dividedX);
  else if (s.divided === 'evenlyRoundDown') rest = `${amount} divided evenly, rounded down, among ${to}`;
  else if (s.divided === 'evenlyRoundUp') rest = `${amount} divided evenly, rounded up, among ${to}`;
  else if (sameComputed) rest = `${amount} to ${to}${more}`;
  else if (reordered !== null) {
    // FAST4 T30 (family damage-each-of): "deals damage equal to its power to each of two other target creatures"
    const eachOf = s.to.ref === 'target' && (st.specs.get(s.to.id)?.max ?? 1) !== 1 && more === '' ? [`${amount} to each of ${to}`] : [];
    // r4-refs (CR 120.3, 608.2h): "target creature deals damage equal to its power to itself" says the source as its own recipient after the amount too
    rest = itself ? alt(reordered, `${amount} to ${to}`) : alt(`${amount} to ${to}`, reordered, ...eachOf, ...(whereX !== null && more === '' ? [whereX] : []));
  }
  else if (s.to.ref === 'target' && (st.specs.get(s.to.id)?.max ?? 1) !== 1 && more === '') rest = alt(`${amount} to ${to}`, `${amount} to each of ${to}`); // FAST4 T25 (family damage-each-of)
  else rest = `${amount} to ${to}${more}`;
  // FAST5 T51 (equivalence plural-name-verb): a card whose name is plural ("Tokka & Rahzar, Terrible Twos") is the subject of "deal"
  const verb = s.source.ref === 'self' && !src.plural ? alt('deals', 'deal') : src.plural ? 'deal' : 'deals';
  const base = `${src.text} ${verb} ${rest}`;
  const have = `${src.text} deal ${rest}`;
  if (s.unpreventable === true) {
    const text = `${base}. ${alt("that damage can't be prevented", "the damage can't be prevented", "this damage can't be prevented")}`;
    return plain(text, { have, standalone: true });
  }
  const dynamic = typeof s.amount === 'object' ? countParts(s.amount, st) : null;
  if (dynamic && s.divided === undefined && !itself) {
    // "deals 1 damage to X for each creature you control"
    const per = `${src.text} ${src.plural ? 'deal' : 'deals'} 1 damage to ${to} for each ${dynamic.singular}`;
    return plain(alt(base, per), { have });
  }
  // std-rq (CR 120.3, 608.2h; family damage-n-for-each): a fixed amount for each thing a count counts, "deals 2 damage to each opponent for each artifact you control"
  // (`math *` of the number and the count)
  const a = s.amount;
  const scaled = typeof a === 'object' && a.q === 'math' && a.op === '*' && a.args.length === 2 && typeof a.args[0] === 'number' && typeof a.args[1] === 'object' ? countParts(a.args[1], st) : null;
  if (scaled && s.divided === undefined && !itself && more === '') {
    const per = `${src.text} ${src.plural ? 'deal' : 'deals'} ${(a as { args: number[] }).args[0]} damage to ${to} for each ${scaled.singular}`;
    return plain(alt(base, per), { have });
  }
  return plain(base, { have });
};

export const CLAUSES_LIFE = {
  damage: damageClause,

  gainLife: (s: StepOf<'gainLife'>, st: RenderState): Clause => byPlayer(s.who, st, 'gain', () => amountOf(s.amount, 'life', st, { whereX: true })),
  loseLife: (s: StepOf<'loseLife'>, st: RenderState): Clause => byPlayer(s.who, st, 'lose', () => {
    // FAST4 T30 (CR 107.1a, 119.3; family half-of-own): "that player loses half their life, rounded up": half of the losing player's own life total
    const half = halfOfOwn(s.amount, 'life', s.who);
    if (half !== null) return alt(amountOf(s.amount, 'life', st), `half ${K.player(s.who, st, 'possessive').text} life, rounded ${half}`);
    return amountOf(s.amount, 'life', st, { whereX: true });
  }),

  setLife: (s: StepOf<'setLife'>, st: RenderState): Clause => {
    const whoPhrase = K.player(s.who, st, 'possessive');
    const who = whoPhrase.text;
    const base = `${who} life total becomes ${K.qty(s.value, st)}`;
    // trek-5 (CR 119.5, 701.10; family double-life-total): "double your life total" is the life total set to twice itself (the model has no doubling node, as
    // render/double.ts says of power and toughness); the player the life total is of is the player whose life total it becomes. ONE player only: the step reads its value
    // once (effects/handlers/lifedamage.ts#setLife), so "Double each opponent's life total" (each one's own total doubled) is not this step: the gate refuses it, manual
    const v = s.value;
    const life = typeof v === 'object' && v.q === 'math' && v.op === '*' && v.args.length === 2 ? v.args.find((a) => a !== 2) : undefined;
    const doubled = namesOnePlayer(s.who) && !whoPhrase.plural && typeof v === 'object' && v.q === 'math' && v.op === '*' && v.args.length === 2 && v.args.includes(2)
      && typeof life === 'object' && life.q === 'life' && life.agg === undefined && JSON.stringify(life.of) === JSON.stringify(s.who);
    return plain(doubled ? alt(base, `double ${who} life total`) : base);
  },

  fight: (s: StepOf<'fight'>, st: RenderState): Clause => {
    if (s.pairs === true) throw new NoRenderer('a paired fight outside its fold (render/fold-p2damage2.ts)'); // p2-damage-2
    const a = K.obj(s.a, st, 'subject');
    // p2-damage-2 (the parser's rule, parser/lower/anaphora.ts#fightSubject; CR 701.14c): the target that fights is no antecedent of the creature it fights
    const aKey = s.a.ref === 'target' ? objKey(s.a) : null;
    const saved = st.notAntecedent;
    if (aKey !== null) st.notAntecedent = identityOf(st, aKey);
    let b: ReturnType<typeof K.obj>;
    try { b = K.obj(s.b, st, 'object'); } finally { if (saved === undefined) delete st.notAntecedent; else st.notAntecedent = saved; }
    // std-rx10 (CR 701.14a, 608.2c; family chosen-pair-fight): the two targets announced together fight each other, "those creatures fight each other"
    const pair = st.chosenPair;
    const ids = [s.a, s.b].map((r) => (r as { ref?: string; id?: string }).ref === 'target' ? (r as { id?: string }).id : undefined);
    if (pair !== undefined && ids[0] === pair.a && ids[1] === pair.b) {
      const them = [`those ${pluralize(pair.noun)}`, `the chosen ${pluralize(pair.noun)}`];
      return plain(alt(`${a.text} ${a.plural ? 'fight' : 'fights'} ${b.text}`, ...them.map((t) => `${t} fight each other`)), { have: alt(`${a.text} fight ${b.text}`, ...them.map((t) => `${t} fight each other`)) });
    }
    return plain(`${a.text} ${a.plural ? 'fight' : 'fights'} ${b.text}`, { have: `${a.text} fight ${b.text}` });
  },

  // r5-cost (CR 115.1, 601.2c): counters on a target for each opponent, "for each opponent, put X -1/-1 counters on up to one target creature that player controls,
  // where X is ...": merge wave 8, the lead "for each opponent," is r5-fxb's for every step (render/steps.ts#perPlayerLead), so this reading is folded into it
  putCounters: (s: StepOf<'putCounters'>, st: RenderState): Clause => putCountersClause(s, st),

  removeCounters: (s: StepOf<'removeCounters'>, st: RenderState): Clause => {
    const from = refText(s.from, st);
    // FAST4 T31 (CR 122.1, 608.2d): "remove up to three counters from target permanent"
    if (s.upTo === true) {
      // CLOUD std-ecl (CR 122.1, 608.2d): up to every counter there, "remove any number of counters from target creature you control"
      if (s.count === 'all') return plain(`remove any number of ${s.kind === 'any' ? 'counters' : `${s.kind} counters`} from ${from}`);
      const n = typeof s.count === 'number' ? numWord(s.count) : K.qty(s.count, st);
      const one = typeof s.count === 'number' && s.count === 1;
      return plain(`remove up to ${n} ${s.kind === 'any' ? (one ? 'counter' : 'counters') : `${s.kind} ${one ? 'counter' : 'counters'}`} from ${from}`);
    }
    if (s.kind === 'any' && typeof s.count === 'number') return plain(`remove ${numWord(s.count) === 'one' ? 'a counter' : `${numWord(s.count)} counters`} from ${from}`);
    return plain(`remove ${countersText(s.count, s.kind, st)} from ${from}`);
  },

  moveCounters: (s: StepOf<'moveCounters'>, st: RenderState): Clause => {
    // FAST5X E21 (CR 122.5, 122.8): every counter of every kind, "put its counters on target creature you control", "put ~'s counters on that token", and,
    // after "if it had counters on it", "put those counters on up to one target creature" (the counters that object had)
    const onto = alt('onto', 'to');
    // p2-counters-move-1 (CR 115.3, 122.5; cites unverified): the object the counters go onto, a target after a target they come from, is also "a second
    // target ..." (each "target" is its own choice, as render/refs.ts#againPhrase; moving counters from an object onto itself does nothing)
    const second = (to: string): string => (s.from.ref === 'target' && s.to.ref === 'target' && to.startsWith('target ') ? alt(to, `a second ${to}`) : to);
    // p2-counters-move-4 (CR 122.5, 608.2d): "move any number of +1/+1 counters from ~ onto other creatures": a group receives them, divided as the controller chooses
    if (s.distribute === true) {
      if (s.upTo !== true || s.count !== 'all' || s.kind === 'any' || s.to.ref !== 'each' || !('filter' in s.to)) throw new NoRenderer('moveCounters divided other than any number of one kind onto a group');
      const from = K.obj(s.from, st, 'object').text;
      return plain(`move any number of ${s.kind} counters from ${from} ${onto} ${K.np(s.to.filter, st, { det: 'none', plural: true })}`);
    }
    // p2-counters-move-1 (CR 122.5, 608.2d): "move any number of [+1/+1] counters from A onto B" (`upTo`, how many of each kind chosen on resolution)
    if (s.upTo === true) {
      if (s.count !== 'all') throw new NoRenderer('moveCounters up to a number');
      const from = K.obj(s.from, st, 'object').text;
      return plain(`move any number of ${s.kind === 'any' ? 'counters' : `${s.kind} counters`} from ${from} ${onto} ${second(K.obj(s.to, st, 'object').text)}`);
    }
    if (s.kind === 'any') {
      // p2-counters-move-1 (CR 122.5): "move a counter from A onto B", the kind of each counter chosen on resolution
      if (s.count !== 'all') {
        const from = K.obj(s.from, st, 'object').text;
        return plain(`move ${countersText(s.count, 'any', st)} from ${from} ${onto} ${second(K.obj(s.to, st, 'object').text)}`);
      }
      // p2-counters-move-1 (CR 122.5): the same instruction is also "move all counters from A onto B" (family put-its-counters)
      // (rendered on a copy of the state: naming the objects again in the same state would make the second mention a reference)
      const fork = cloneState(st);
      const moveAll = `move all counters from ${K.obj(s.from, fork, 'object').text} ${onto} ${second(K.obj(s.to, fork, 'object').text)}`;
      const whose = K.obj(s.from, st, 'possessive').text;
      const to = K.obj(s.to, st, 'object').text;
      return plain(alt(`put ${whose} counters on ${to}`, `put those counters on ${to}`, moveAll));
    }
    const from = K.obj(s.from, st, 'object').text;
    const to = K.obj(s.to, st, 'object').text;
    return plain(`move ${countersText(s.count, s.kind, st)} from ${from} ${onto} ${to}`);
  },
};

/** The text of a putCounters step (STEPS.putCounters adds a target for each opponent's "for each opponent,"). */
function putCountersClause(s: StepOf<'putCounters'>, st: RenderState): Clause {
    // FAST5 T76 (CR 608.2c; effects/handlers/counters.ts#recordActed): the creatures the counters went on are "them" / "those creatures" for the next sentence
    if (s.as !== undefined && s.on.ref === 'each' && 'filter' in s.on) bind(st, s.as, { nouns: K.nounsOf(s.on.filter), plural: true });
    if (isPlayerRef(s.on as ObjRef | PlayerRef, st)) {
      const who = s.on as PlayerRef;
      if (s.kind === 'energy') return byPlayer(who, st, 'get', () => (typeof s.count === 'number' ? '{E}'.repeat(s.count) : `${K.qty(s.count, st)} {E}`));
      return byPlayer(who, st, 'get', () => countersText(s.count, s.kind, st));
    }
    // std-rx26 (CR 608.2d): counters divided among objects chosen as the step resolves, "distribute three stun counters among any number of tapped creatures your
    // opponents control" (effects/handlers/counters.ts#distributedShares)
    // std-mana-2 (CR 608.2d): "put up to three lore counters on it"
    if (s.upTo === true) {
      if (s.distribute === true || typeof s.count !== 'number') throw new NoRenderer('put up to a computed number of counters, or divided');
      return plain(`put up to ${numWord(s.count)} ${s.kind} ${s.count === 1 ? 'counter' : 'counters'} on ${K.obj(s.on as ObjRef, st, 'object').text}`);
    }
    if (s.distribute === true) {
      if (s.on.ref !== 'each' || !('filter' in s.on) || s.as !== undefined) throw new NoRenderer('a distribution among something other than a described group');
      const n = typeof s.count === 'number' ? `${numWord(s.count)} ${pluralize(`${s.kind} counter`)}` : countersText(s.count, s.kind, st);
      return plain(`distribute ${n} among any number of ${K.np(s.on.filter, st, { det: 'none', plural: true })}`);
    }
    // FAST4 T28 (CR 601.2d): counters divided among the targets as the spell or ability was put on the stack: "distribute two +1/+1 counters among one or
    // two target creatures" (the spec's `divide`, effects/handlers/counters.ts#putShares)
    const divided = s.on.ref === 'target' ? st.specs.get(s.on.id)?.divide : undefined;
    if (divided !== undefined) {
      if (divided.what !== 'counters' || JSON.stringify(divided.total) !== JSON.stringify(s.count)) throw new NoRenderer('a division that is not of these counters');
      const n = typeof s.count === 'number' ? `${numWord(s.count)} ${pluralize(`${s.kind} counter`)}` : countersText(s.count, s.kind, st);
      return plain(`distribute ${n} among ${K.obj(s.on as ObjRef, st, 'object').text}`);
    }
    // FAST4 T28 (CR 122.8): "put its +1/+1 counters on target creature you control": as many counters of the kind as one object has, the object named first
    // (from the state before the recipient, as Oracle's word order has it)
    const c = s.count;
    const fork = typeof c === 'object' && c.q === 'counters' && c.kind === s.kind && !isPlayerRef(c.on as ObjRef | PlayerRef, st) ? cloneState(st) : null;
    const its = fork && typeof c === 'object' && c.q === 'counters'
      ? `put ${K.obj(c.on as ObjRef, fork, 'possessive').text} ${pluralize(`${s.kind} counter`)} on ${K.obj(s.on as ObjRef, fork, 'object').text}` : null;
    const onPhrase = K.obj(s.on as ObjRef, st, 'object');
    const on = onPhrase.text;
    const noun = `${s.kind} counter`;
    // FAST5 T70 (CR 107.1a, 122.1): "put a +1/+1 counter on each of them for every three cards in your graveyard": one counter for each full group of N cards,
    // the count rounded down (`floorDiv` of the size of the controller's graveyard by N)
    if (typeof s.count === 'object' && s.count.q === 'math' && s.count.op === 'floorDiv' && s.count.args.length === 2) {
      const [size, by] = s.count.args;
      if (typeof size === 'object' && size.q === 'zoneSize' && size.zone === 'graveyard' && size.of.ref === 'you' && typeof by === 'number' && by >= 2) {
        const per = `for every ${numWord(by)} cards in your graveyard`;
        const base = `put ${withArticle(noun)} on ${on} ${per}`;
        return plain(onPhrase.plural && (s.on.ref === 'bound' || s.on.ref === 'event') ? alt(base, `put ${withArticle(noun)} on each of ${on} ${per}`) : base);
      }
    }
    const afterOn = cloneState(st); // FAST4 T28: the readings that name the amount after the recipient start from here
    const beforeCount = typeof s.count === 'object' ? cloneState(st) : null; // std-ra: the "for each" readings as from before `counters` named a target (perForms)
    const counters = countersText(s.count, s.kind, st);
    // r4-refs (CR 122.1, 608.2c): one more counter on an object an earlier instruction already put counters on is "an additional" one ("earthbend 1. If that spell is a
    // Lesson, put an additional +1/+1 counter on that land."): the same one counter, the word only says it adds to those
    const main = s.count === 1 && s.kind !== 'any' ? alt(`put ${counters} on ${on}`, `put an additional ${noun} on ${on}`) : `put ${counters} on ${on}`;
    const per = typeof s.count === 'object' ? countParts(s.count, st) : null;
    // FAST4 T22 (CR 107.3, 608.2h; family counter-count): a counted amount is also "put X +1/+1 counters on each creature you control, where X is the number
    // of Elves you control" (lowered from "where X is", parser/lower/quantities.ts#substituteX)
    // FAST4 T28 (CR 608.2h): "put a number of +1/+1 counters on ~ equal to <amount>" says the amount after the recipient
    // std-rl (family counters-equal-without-number): Oracle also leaves out "a number of" ("put +1/+1 counters on that creature equal to its power", Experiment Twelve)
    const amount = typeof s.count === 'object' && s.count.q !== 'X' && s.count.q !== 'eventAmount' ? K.qty(s.count, afterOn) : null;
    const equalTo = amount !== null ? [`put a number of ${pluralize(noun)} on ${on} equal to ${amount}`, `put ${pluralize(noun)} on ${on} equal to ${amount}`] : [];
    absorb(st, afterOn);
    // r4-refs (CR 122.1, 608.2h): "put two +1/+1 counters on that token for each spell you've cast this turn other than the first": a fixed number of counters
    // for each object or event a count counts (`math *` of the number and the count)
    const times = typeof s.count === 'object' && s.count.q === 'math' && s.count.op === '*' && s.count.args.length === 2 && typeof s.count.args[0] === 'number'
      && s.count.args[0] >= 1 && typeof s.count.args[1] === 'object' ? s.count.args : null;
    const perEach = times !== null ? countParts(times[1]!, cloneState(st)) : null; // one more reading of the math branch below (the state is left as it was)
    const timesText = times !== null && perEach !== null ? [`put ${times[0] === 1 ? withArticle(noun) : `${numWord(times[0] as number)} ${pluralize(noun)}`} on ${on} for each ${perEach.singular}`] : [];
    if (per) {
      // std-ra (CR 115.1, 122.1, 608.2c): "put a hone counter on ~ for each creature target opponent controls" names the target in the "for each" for the first
      // time, as std-r10 says it for a draw and a gain of life (steps-util.ts#perForms); the reading from the state now ("... that player controls") stays
      const each = beforeCount !== null ? perForms(s.count as Quantity, st, beforeCount) : [per.singular];
      const text = alt(main, ...each.map((x) => `put ${withArticle(noun)} on ${on} for each ${x}`), `put X ${pluralize(noun)} on ${on}, where X is ${K.qty(s.count, st)}`, ...equalTo);
      if (fork) absorb(st, fork);
      return plain(its !== null ? alt(its, text) : text);
    }
    // FAST4 T26 (CR 107.3, 608.2h): another computed amount the same way ("put X +1/+1 counters on it, where X is the number of cards you've drawn this turn")
    // CLOUD std-fra (CR 107.3, 608.2h): and the number of cards in a zone ("put X +1/+1 counters on each creature you control, where X is the number of cards in
    // your hand"), counted as the step runs (family counters-where-x-zone); Cloud std-woe (family counter-count): and a calculation, "put X +1/+1 counters on target
    // creature you control, where X is one plus the number of Foods you control" (a sum, lowered from "where X is", parser/lower/quantities.ts#substituteX)
    // p2-counters-move-2: and the X of "Remove all <kind> counters from ~", "put X +1/+1 counters on it, where X is the number of charge counters removed this way"
    if (typeof s.count === 'object' && (s.count.q === 'cardsDrawnThisTurn' || s.count.q === 'lifeGainedThisTurn' || s.count.q === 'zoneSize' || s.count.q === 'math' || (s.count.q === 'X' && st.costAllCountersX !== undefined))) return plain(alt(main, `put X ${pluralize(noun)} on ${on}, where X is ${K.qty(s.count, st)}`, ...timesText));
    // FAST4 T28 (CR 107.3, 608.2h): a statistic of an object ("where X is ~'s power", "where X is that spell's mana value") or another read value, with the
    // amount after the recipient ("put a number of +1/+1 counters on ~ equal to that creature's power")
    if (typeof s.count === 'object' && (s.count.q === 'stat' || s.count.q === 'counters' || s.count.q === 'distinct')) { // std-sos: or the names / colors among a group ("where X is the number of differently named lands you control")
      const where = `put X ${pluralize(noun)} on ${on}, where X is ${K.qty(s.count, st)}`;
      if (fork) absorb(st, fork);
      return plain(its !== null ? alt(its, main, ...equalTo, where) : alt(main, ...equalTo, where));
    }
    // FAST2 T8: "put a +1/+1 counter on each of up to two target creatures": the same counters on every one of several targets (CR 122.6)
    const spec = s.on.ref === 'target' ? st.specs.get(s.on.id) : undefined;
    if (spec && (spec.max !== 1 || spec.perOpponent === true || spec.perPlayer === true)) return plain(alt(main, `put ${counters} on each of ${on}`)); // STD-FRA: one target for each opponent is a set too
    // FAST3 T18: the same for a group named earlier ("put a +1/+1 counter on each of them", "... on each of those creatures")
    if (onPhrase.plural && (s.on.ref === 'bound' || s.on.ref === 'event' || (s.on.ref === 'each' && 'filter' in s.on && groupPart(s.on.filter) !== null))) return plain(alt(main, `put ${counters} on each of ${on}`));
    return plain(main);
}
