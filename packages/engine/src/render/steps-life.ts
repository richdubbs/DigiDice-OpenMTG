/**
 * Damage, life and counters (WP2): damage, gainLife, loseLife, setLife, fight, putCounters, removeCounters, moveCounters (CR 120, 119, 122, 701.14).
 */
import { namesOnePlayer } from '../model/focus';
import type { CounterKind, ObjRef, PlayerRef, Quantity, Ref } from '../types/ability';
import { plain, type Clause } from './clause';
import { K } from './kernel';
import { countParts } from './qty';
import { costCountParts } from './moved';
import { groupPart, identityOf, isPlayerRef } from './refs';
import { amountOf, bind, byPlayer, halfOfOwn, perForms, saidX, type StepOf } from './steps-util';
import { absorb, cloneState, objKey, type RenderState } from './state';
import { alt, NoRenderer, numWord, pluralize, withArticle } from './text';

const refText = (ref: Ref, st: RenderState, form: 'subject' | 'object' | 'possessive' = 'object', prefer?: 'all' | 'each'): string =>
  isPlayerRef(ref as ObjRef | PlayerRef, st) ? K.player(ref as PlayerRef, st, form).text : K.obj(ref as ObjRef, st, form, { prefer }).text;

/** std-rx1: `n` is the count of the "prime number of ..." condition of the intervening "if" being rendered (the whole condition or one part of its "and"). */
function statedByIf(n: Quantity, st: RenderState): boolean {
  const c = st.interveningIf;
  const primes = c === undefined ? [] : c.cond === 'prime' ? [c] : c.cond === 'all' ? c.of.filter((x) => x.cond === 'prime') : [];
  if (primes.length === 1 && primes[0]!.cond === 'prime' && JSON.stringify(primes[0]!.of) === JSON.stringify(n)) return true;
  // edhn63 (CR 122.1, 603.4, 603.10a; Reyhan): "if it had one or more +1/+1 counters on it, ... that many": the counters the event's object had, said by the condition
  if (c !== undefined && c.cond === 'matches' && typeof n === 'object' && n.q === 'counters' && n.on.ref === 'event' && n.on.role === 'subject' && c.object.ref === 'event' && c.object.role === 'subject'
    && c.filter.counters !== undefined && c.filter.counters.kind === n.kind && (c.filter.counters.cmp === undefined /* edh-next-84: "one or more counters" of any kind */ || (c.filter.counters.cmp.op === '>=' && c.filter.counters.cmp.value === 1))) return true;
  // edh-perms-22 (CR 119.3, 603.4; parser/lower/quantities.ts#gainedLifeCount): "if you gained life this turn, ... that many": the life gained this turn, the whole condition or one part of its "and"
  const gained = c === undefined ? [] : c.cond === 'all' ? c.of : [c];
  const one = gained.filter((x) => x.cond === 'happened' && x.scope === 'turn' && x.by === undefined && x.event.ev === 'life' && x.event.change === 'gain' && x.event.player === 'you');
  return typeof n === 'object' && n.q === 'lifeGainedThisTurn' && one.length === 1;
}

/** "a +1/+1 counter", "three +1/+1 counters", "X +1/+1 counters". */
export function countersText(n: Quantity | 'all', kind: CounterKind | 'any', st: RenderState): string {
  const noun = kind === 'any' ? 'counter' : `${kind} counter`;
  if (n === 'all') return kind === 'any' ? 'all counters' : `all ${kind} counters`;
  if (typeof n === 'number') return n === 1 ? withArticle(noun) : `${numWord(n)} ${pluralize(noun)}`;
  if (typeof n === 'object' && n.q === 'X' && st.costAllCountersX === undefined) return `X ${pluralize(noun)}`; // p2-counters-move-2: unless X is printed nowhere
  // FAST2 T8: the amount of the triggering event, "whenever you gain life, put that many +1/+1 counters on ~" (design 3.5 `eventAmount`)
  if (typeof n === 'object' && n.q === 'eventAmount') return alt(`a number of ${pluralize(noun)} equal to ${K.qty(n, st)}`, `that many ${pluralize(noun)}`, `that number of ${pluralize(noun)}`);
  // cloud std-spm (CR 615.5): the damage a prevention prevented, in its own additional instruction ("prevent that damage and put that many +1/+1 counters on ~")
  if (typeof n === 'object' && n.q === 'preventedAmount') return alt(`a number of ${pluralize(noun)} equal to ${K.qty(n, st)}`, `that many ${pluralize(noun)}`, `that number of ${pluralize(noun)}`);
  // FAST5 T78 (CR 608.2h): "that many" is a value an earlier step of the effect fixed and already said ("pay life equal to its power. If you do, put that many +1/+1 counters on it")
  if (typeof n === 'object' && n.q === 'var' && st.vars.get(n.name)?.used === true) return alt(`a number of ${pluralize(noun)} equal to ${K.qty(n, st)}`, `that many ${pluralize(noun)}`, `that number of ${pluralize(noun)}`);
  // std-rx1 (CR 603.4, 608.2h; parser/lower/quantities.ts#primeCount): "that many" is the number the intervening "if" states ("if ... you control a prime number of
  // lands, create Primo, ..., then put that many +1/+1 counters on it")
  if (typeof n === 'object' && statedByIf(n, st)) return alt(`a number of ${pluralize(noun)} equal to ${K.qty(n, st)}`, `that many ${pluralize(noun)}`, `that number of ${pluralize(noun)}`);
  // edh-next-91 (CR 608.2c; Nantuko Cultivator; family that-many-counters-result): the number of what an earlier step did ("discard any number of land cards. Put that many +1/+1 counters on ~")
  if (typeof n === 'object' && n.q === 'resultCount' && st.info.get(`r:${n.step}`)?.moved === 'discarded' && n.which === undefined && n.to === undefined && n.maxPerOwner === undefined && n.attempted === undefined) return alt(`a number of ${pluralize(noun)} equal to ${K.qty(n, st)}`, `that many ${pluralize(noun)}`, `that number of ${pluralize(noun)}`);
  // edh-d-93 (CR 603.4, 608.2h; Feast of the Victorious Dead): the count of the intervening "if one or more creatures died this turn", "distribute that many +1/+1 counters" (render/qty.ts says it "that much")
  if (typeof n === 'object' && n.q === 'happenedCount') { const v = K.qty(n, cloneState(st)); if (v === 'that much') return alt(`a number of ${pluralize(noun)} equal to ${K.qty(n, st)}`, `that many ${pluralize(noun)}`); }
  // edhn63 (CR 122.1, 608.2c; Galloping Lizrog): the counters an earlier removal took, "put that many +1/+1 counters", "put twice that many +1/+1 counters"
  if (typeof n === 'object' && n.q === 'countersRemoved') return alt(`a number of ${pluralize(noun)} equal to ${K.qty(n, st)}`, `that many ${pluralize(noun)}`, `that number of ${pluralize(noun)}`);
  if (typeof n === 'object' && n.q === 'math' && n.op === '*' && n.args.length === 2 && n.args[0] === 2 && typeof n.args[1] === 'object' && n.args[1].q === 'countersRemoved') {
    return alt(`a number of ${pluralize(noun)} equal to ${K.qty(n, st)}`, `twice that many ${pluralize(noun)}`);
  }
  // std-sos (CR 107.3, 107.1): a multiple of X says the multiple in front of the noun, "put twice X stun counters on it" (`math *` of a number and X)
  if (typeof n === 'object' && n.q === 'math' && n.op === '*' && n.args.length === 2 && typeof n.args[0] === 'number' && typeof n.args[1] === 'object' && n.args[1].q === 'X') {
    return alt(`a number of ${pluralize(noun)} equal to ${K.qty(n, st)}`, `${K.qty(n, st)} ${pluralize(noun)}`);
  }
  // pc-counters-3 (CR 107.1a): "you get half X rad counters, rounded up" (Contaminated Drink): half of X, the rounding said after the noun
  if (typeof n === 'object' && n.q === 'math' && (n.op === 'ceilDiv' || n.op === 'floorDiv') && n.args.length === 2 && n.args[1] === 2 && typeof n.args[0] === 'object' && n.args[0].q === 'X') {
    return alt(`a number of ${pluralize(noun)} equal to ${K.qty(n, st)}`, `half X ${pluralize(noun)}, rounded ${n.op === 'ceilDiv' ? 'up' : 'down'}`);
  }
  // edh-d-95 (CR 107.3, 608.2h; G'raha Tia, Scion Reborn; family pay-x-life-where-x): a computed number an earlier sentence said as "X, where X is ..." is "X +1/+1 counters"
  // again (render/steps-util.ts#saidX, marked by steps-flow.ts#payLifeWhereXThen)
  if (saidX(n, st)) return alt(`a number of ${pluralize(noun)} equal to ${K.qty(n, st)}`, `X ${pluralize(noun)}`);
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
  // edh-c-53 (CR 120.3, 115.3; Cone of Flame): two further recipients, each its own literal amount and each a target of its own: ", 2 damage to another target, and 3 damage to a third target"
  if (also.length === 2 && s.divided === undefined && also.every((a) => a.to.ref === 'target' && literalDamage(a.amount) !== null) && s.to.ref === 'target') {
    const [a, b] = also as [typeof also[number], typeof also[number]];
    return `, ${literalDamage(a.amount)} to ${refText(a.to, st, 'object', 'each')}, and ${literalDamage(b.amount)} to ${refText(b.to, st, 'object', 'each')}`;
  }
  // edh-c-41 (CR 120.2b, 120.3a, 120.3e; Hail Storm): "... and 1 damage to you and each creature you control": the same plain amount to you and to a group you control
  if (also.length === 2 && s.divided === undefined && also[0]!.to.ref === 'you' && Object.keys(also[0]!.to).length === 1 && also[1]!.to.ref === 'each' && 'filter' in also[1]!.to
    && also[1]!.to.filter.controller === 'you' && JSON.stringify(also[0]!.amount) === JSON.stringify(also[1]!.amount) && literalDamage(also[0]!.amount) !== null) {
    return ` and ${literalDamage(also[0]!.amount)} to you and ${refText(also[1]!.to, st, 'object', 'each')}`;
  }
  if (also.length > 1 || s.divided !== undefined) throw new NoRenderer('damage with several further recipients, or divided damage with a further recipient');
  const a = also[0]!;
  const lit = literalDamage(a.amount);
  // FAST5 T49 (CR 107.3, 608.2h): "~ deals 5 damage to target creature and X damage to that creature's controller, where X is the number of Equipment you
  // control": the further recipient's amount is the computed one (the first amount is a plain number)
  // p2-pt-1 (CR 120.2b, 608.2h): "deals damage equal to its power to each other creature and each opponent" (Chandra's Ignition): the same computed amount to the
  // further recipient is said once, before both
  if (lit === null && JSON.stringify(a.amount) === JSON.stringify(s.amount) && literalDamage(s.amount) === null) {
    // edh-b-9 (family opponents-they-control; Cavalier of Flame): after "each opponent", "they control" is the objects an opponent controls, as for a plain number below (1 new alt site)
    const fo = a.to.ref === 'each' && 'filter' in a.to ? a.to.filter : undefined;
    if (s.to.ref === 'each' && 'who' in s.to && s.to.who === 'opponent' && fo !== undefined && fo.controller === 'opponent') {
      const { controller: _c, ...rest } = fo;
      return alt(` and ${refText(a.to, st, 'object', 'each')}`, ` and ${K.np(rest, st, { det: 'each' })} they control`);
    }
    // edh-next-53 (CR 120.2b, 608.2h; Dragonspark Reactor, family damage-equal-and-that-much): or the same amount said as "that much damage" (rid eff.edhn53.damage.equalTo.andThatMuch; 1 new alt site)
    const further = refText(a.to, st, 'object', 'each'); // (said once: naming a target changes how the next mention reads)
    return alt(` and ${further}`, ` and that much damage to ${further}`);
  }
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
  // edh-c-79 (CR 120.2b, 120.3; Tropical Storm; family damage-recipients): "X damage to each creature with flying and 1 additional damage to each blue creature": two groups of the same
  // kind of permanent with different amounts, the second said as "additional" (a creature in both groups is dealt both amounts in the one event)
  const fs0 = s.to.ref === 'each' && 'filter' in s.to ? s.to.filter : undefined;
  const additional = !same && f !== undefined && fs0 !== undefined && f.types !== undefined && JSON.stringify(f.types) === JSON.stringify(fs0.types) && typeof a.amount === 'number'
    ? [` and ${lit.replace(' damage', ' additional damage')} to ${to}`] : [];
  return same ? alt(` and ${to}`, ` and ${lit} to ${to}`, ...eachOf) : alt(` and ${lit} to ${to}`, ...eachOf, ...additional);
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
  // edh-next-128 (CR 608.2d, 120.3; Vial Smasher the Fierce, Curse of the Pierced Heart): "that player or a planeswalker that player controls", chosen on resolution;
  // only after a phrase that names one player (effects/handlers/lifedamage.ts#damageToPlayerOrPlaneswalker)
  if (s.orPlaneswalker === true) {
    if (s.divided !== undefined || (s.also ?? []).length > 0 || s.perSource === true || s.excessToController === true) throw new NoRenderer('damage to a player or a planeswalker they control, with a division, a further recipient, several sources or excess damage');
    if (!isPlayerRef(s.to as ObjRef | PlayerRef, st) || s.to.ref === 'target' || !(namesOnePlayer(s.to) || s.to.ref === 'bound' || s.to.ref === 'enchantedPlayer')) throw new NoRenderer('damage to a group of players, or a target player, or a planeswalker they control (no printed card; fail closed)');
    const { orPlaneswalker: _flag, ...plainStep } = s;
    return `${recipientText(plainStep as StepOf<'damage'>, st)} or a planeswalker ${alt('that player controls', 'they control')}`;
  }
  // std-rx19 (CR 506.2, 508.1b): the defender of the trigger's lone attack, a player or the planeswalker (or battle) attacked: "the player or planeswalker it's
  // attacking" (parser/holes/object.ts#attacked; family attacked-defender)
  const to = s.to as { ref: string; role?: string };
  // edh-c-68 (CR 508.1b, 509.3c; Rakdos Roustabout): the blocked attacker's defender, in a trigger on that creature becoming blocked
  if (to.ref === 'event' && to.role === 'defender' && Object.keys(to).length === 2 && st.trigger?.length === 1 && st.trigger[0]!.ev === 'becomesBlocked') return "the player or planeswalker it's attacking";
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
  // edh-replace-4 (CR 120.10): excess damage to the controller is only said in the "If the creature you control has trample, ..." sentence (render/steps-flow.ts)
  // (said here with words no Oracle line has, so the exact render gate refuses it anywhere else)
  if (s.excessToController === true) {
    if (s.divided !== undefined || (s.also ?? []).length > 0 || s.perSource === true) throw new NoRenderer('damage whose excess goes to the controller, with a division, a further recipient or several sources');
    const { excessToController: _flag, ...plainStep } = s;
    const c = damageClause(plainStep as StepOf<'damage'>, st);
    // edh-c-61 (CR 120.4a, 614.1a; Pigment Storm): to exactly one target creature, the sentence Oracle prints after the damage (rid.edhv61.excessToController.always)
    const to = s.to as { ref?: unknown; id?: unknown };
    const toSpec = to.ref === 'target' && typeof to.id === 'string' ? st.specs.get(to.id) : undefined;
    const oneCreature = toSpec !== undefined && toSpec.kind === 'object' && (toSpec.min === 1 || toSpec.min === 0 /* edh-next-93: "up to one other target creature" (Ravenous Tyrannosaurus) */) && toSpec.max === 1 && JSON.stringify(toSpec.filter?.types) === '["Creature"]';
    const tail = oneCreature ? '. Excess damage is dealt to that creature\'s controller instead' : ', with the excess dealt to the creature\'s controller instead';
    return { ...c, imp: c.imp + tail, sub: c.sub + tail, ...(c.have !== undefined ? { have: c.have + tail } : {}), standalone: true };
  }
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
    // edh-next-15 (CR 120.3, 608.2h; Solar Blaze): "each creature deals damage to itself equal to its power": every object of the group is its own recipient
    if (own && s.to.ref === 'subject' && s.source.ref === 'each' && 'filter' in s.source && s.divided === undefined && (s.also ?? []).length === 0 && s.unpreventable !== true) {
      const each = `each ${K.np(s.source.filter, st, { det: 'none' })}`;
      return plain(`${each} deals damage to itself equal to its power`, { have: `${each} deal damage to themselves equal to their power` });
    }
    if (!own || s.divided !== undefined || (s.also ?? []).length > 0 || s.unpreventable === true) throw new NoRenderer('damage dealt by each source of a group, other than damage equal to its power');
    const to = recipientText(s, st);
    // Standard round I (family each-deals-own-power): the objects of a group on the battlefield are also "each <group> deals damage equal to its power" (Bartz and Boko)
    if (s.source.ref === 'each' && 'filter' in s.source) {
      const each = `each ${K.np(s.source.filter, st, { det: 'none' })}`;
      return plain(alt(`${src.text} each deal damage equal to their power to ${to}`, `${each} deals damage equal to its power to ${to}`), { have: `${each} deal damage equal to their power to ${to}` });
    }
    // edh-next-15 (CR 120.3, 608.2h; Polukranos, World Eater, family each-of-those-deal-own-power): the targets of an earlier step each deal damage equal to their own power to the source itself
    if (s.source.ref === 'target' && s.to.ref === 'self') {
      return plain(alt(`${src.text} each deal damage equal to their power to ${to}`, 'each of those creatures deals damage equal to its power to ~'), { have: `${src.text} each deal damage equal to their power to ${to}` });
    }
    return plain(`${src.text} each deal damage equal to their power to ${to}`, { have: `${src.text} each deal damage equal to their power to ${to}` });
  }
  // Cloud std-fin (CR 120.3, 120.2b, 107.3, 608.2h): "target creature you control deals X damage to any other target and X damage to itself, where X is its power"
  // (Self-Destruct): one computed amount, read once, dealt to the recipient and to the source itself in the same damage event; only that exact pair
  const selfToo = (s.also ?? []).length === 1 ? s.also![0]! : undefined;
  if (selfToo !== undefined && s.divided === undefined && s.unpreventable !== true && typeof s.amount === 'object' && !['X', 'var', 'eventAmount', 'resultCount', 'ask', 'live'].includes(s.amount.q)
    && JSON.stringify(selfToo.to) === JSON.stringify(s.source) && JSON.stringify(selfToo.amount) === JSON.stringify(s.amount)) { // edh-c-93 (Sunflare Shaman): also the source ~ itself, "~ deals X damage to any target and X damage to itself, where X is ..."
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
  // edh-replace-5 (CR 118.12, 608.2d, 608.2h; Leyline Tyrant): and the number of times "you may pay any amount of {R}" was paid
  const paidAny = typeof s.amount === 'object' && s.amount.q === 'resultCount' && s.amount.which === undefined && st.info.get(`b:${s.amount.step}`)?.paidAny === true;
  const lit = paidAny ? 'that much damage' : typeof s.amount === 'object' && s.amount.q === 'X' && st.anyNumberX === true ? 'that much damage' : typeof s.amount === 'object' && s.amount.q === 'X' && st.costAllCountersX !== undefined ? null : literalDamage(s.amount);
  // FAST2 T8: "target creature deals damage to itself equal to its power": the source is its own recipient
  const itself = s.source.ref !== 'self' && JSON.stringify(s.source) === JSON.stringify(s.to);
  // FAST2 T8: Oracle also puts the recipient before a computed amount ("deals damage to target player equal to the number of cards in that player's
  // hand"); that order names the recipient first, so it is rendered on a copy of the state as it is before either part (the usual order is unchanged)
  const reorder = lit === null && s.divided === undefined && typeof s.amount === 'object' && s.amount.q !== 'var' && s.amount.q !== 'eventAmount';
  let reordered: string | null = null;
  let selfPronounReordered: string[] = []; // edh-c-113
  let copy: RenderState | null = null;
  // FAST4 T30 (CR 107.3, 608.2h; family draw-where-x): "deals X damage to that player, where X is 3 minus the number of cards in their hand", rendered on a
  // copy of the state too (the recipient is named before the quantity)
  let whereX: string | null = null;
  let whereXBoth: string | null = null;
  let whereXPlus: string | null = null;
  let sparseBoth: string | null = null; // edh-c-24
  if (reorder) {
    copy = cloneState(st);
    const t = itself ? 'itself' : recipientText(s, copy);
    const reorderedAmount = ownAmount(s, copy, () => K.qty(s.amount, copy!));
    reordered = `damage to ${t} equal to ${reorderedAmount}`;
    // edh-c-113 (CR 120.3, 608.2h; Sarkhan the Mad; family damage-to-self-pronoun): the source ~ as its own recipient after a computed amount names itself with a pronoun,
    // "~ deals damage to himself equal to that card's mana value" (a gendered card says "himself" or "herself")
    if (!itself && s.source.ref === 'self' && JSON.stringify(s.source) === JSON.stringify(s.to)) selfPronounReordered = ['itself', 'himself', 'herself'].map((pn) => `damage to ${pn} equal to ${reorderedAmount}`);
    if (!itself && s.amount !== null && typeof s.amount === 'object' && (s.amount.q !== 'X' || st.costAllCountersX !== undefined)) {
      const w = cloneState(st);
      const wt = recipientText(s, w);
      whereX = `X damage to ${wt}, where X is ${ownAmount(s, w, () => K.qty(s.amount, w))}`;
      // edh-c-61 (CR 107.3, 120.3, 608.2h; Hellfire; family damage-x-plus-where-x): "deals X plus 3 damage to you, where X is the number of creatures destroyed this way" is the amount "damage equal to <that count> plus 3"
      const am = s.amount;
      if (am.q === 'math' && am.op === '+' && am.args.length === 2 && typeof am.args[0] === 'object' && am.args[0].q !== 'X' && typeof am.args[1] === 'number') {
        const countText = ownAmount(s, w, () => K.qty(am.args[0] as Quantity, w));
        whereXPlus = `X plus ${numWord(am.args[1])} damage to ${wt}, where X is ${countText}`;
      }
      // edh-b-9 (CR 120.2b, 107.3; Cavalier of Flame; family damage-where-x-both): one computed amount for both recipients, "X damage to each opponent and each planeswalker they control, where X is ..."
      // edh-c-24 (CR 107.3, 120.2b, 608.2h; family damage-same-where-x; Sparksmith): the amount said for each recipient, "X damage to T and X damage to you, where X is ..."
      if ((s.also ?? []).length === 1 && JSON.stringify(s.also![0]!.amount) === JSON.stringify(s.amount)) {
        const w2 = cloneState(st);
        sparseBoth = `X damage to ${recipientText(s, w2)} and X damage to ${refText(s.also![0]!.to, w2, 'object', 'each')}, where X is ${ownAmount(s, w2, () => K.qty(s.amount, w2))}`;
      }
      if ((s.also ?? []).length === 1 && JSON.stringify(s.also![0]!.amount) === JSON.stringify(s.amount)) whereXBoth = `X damage to ${wt}${alsoText(s, w)}, where X is ${ownAmount(s, w, () => K.qty(s.amount, w))}`;
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
  // edh-c-79 (CR 120.3, 107.1a, 107.3, 608.2h; Eternal Flame; family damage-half-rounded-up): "~ deals X damage to T and half X damage, rounded up, to you, where X is ...": the further
  // recipient takes half of the first, computed amount rounded up (`math ceilDiv` of the same amount and 2); only this pair, one further recipient
  const alsoAmt = (s.also ?? []).length === 1 ? s.also![0]!.amount : undefined;
  if (reorder && !itself && s.divided === undefined && alsoAmt !== undefined && typeof alsoAmt === 'object' && alsoAmt.q === 'math' && alsoAmt.op === 'ceilDiv' && alsoAmt.args.length === 2
    && alsoAmt.args[1] === 2 && JSON.stringify(alsoAmt.args[0]) === JSON.stringify(s.amount) && s.amount !== null && typeof s.amount === 'object' && s.amount.q !== 'X' && s.unpreventable !== true) {
    const wc = cloneState(st);
    const wt = recipientText(s, wc);
    const tx = `${src.text} ${src.plural ? 'deal' : 'deals'} X damage to ${wt} and half X damage, rounded up, to ${refText(s.also![0]!.to, wc, 'object', 'each')}, where X is ${ownAmount(s, wc, () => K.qty(s.amount, wc))}`;
    absorb(st, wc);
    return plain(tx, { have: `${src.text} deal X damage to ${wt} and half X damage, rounded up, to ${refText(s.also![0]!.to, wc, 'object', 'each')}, where X is ${ownAmount(s, wc, () => K.qty(s.amount, wc))}` });
  }
  // edh-replace-1 (CR 107.3, 120.3; Crackle with Power): a whole number of three or more times X is also said before "damage" ("deals five times X damage to ...")
  const a0 = s.amount;
  const timesX = typeof a0 === 'object' && a0.q === 'math' && a0.op === '*' && a0.args.length === 2 && typeof a0.args[0] === 'number' && a0.args[0] >= 3 && typeof a0.args[1] === 'object' && a0.args[1].q === 'X'
    ? `${a0.args[0]} times X damage` : null;
  // edh-b-4 (CR 107.3, 120.3; Let the Galaxy Burn): X plus a whole number is also said before "damage" ("deals X plus 2 damage to each creature ...")
  const xPlus = typeof a0 === 'object' && a0.q === 'math' && a0.op === '+' && a0.args.length === 2 && typeof a0.args[0] === 'object' && a0.args[0].q === 'X' && typeof a0.args[1] === 'number'
    ? `X plus ${numWord(a0.args[1])} damage` : null;
  const computed = ownAmount(s, st, () => amountOf(s.amount, 'damage', st));
  // edh-zones-14 (CR 608.2c, 608.2h; Valakut Exploration; family that-much-damage-moved): the cards an earlier move of the ability put somewhere are counted by "that much", "~ deals that much damage"
  const movedMuch = typeof s.amount === 'object' && s.amount.q === 'resultCount' && s.amount.which === undefined && st.info.get(`r:${s.amount.step}`)?.moved !== undefined ? 'that much damage' : null;
  // edh-c-62 (CR 601.2i, 608.2h; Imminent Doom; family that-much-damage-spell-mana-value): after a cast trigger that compares the spell's mana value, the spell's mana value is "that much damage"
  // edh-c-111 (CR 107.3a, 118.3, 608.2h; Relic Amulet; family cost-all-counters-that-much): the X of "Remove all <kind> counters from ~" is also "that much damage"
  const allMuch = typeof s.amount === 'object' && s.amount.q === 'X' && st.costAllCountersX !== undefined ? 'that much damage' : null;
  const spellMuch = typeof s.amount === 'object' && s.amount.q === 'stat' && s.amount.stat === 'manaValue' && JSON.stringify(s.amount.of) === '{"ref":"event","role":"spell"}'
    && st.trigger?.some((e) => e.ev === 'cast' && e.spell?.manaValue !== undefined) === true ? 'that much damage' : null;
  // edh-next-104 (CR 120.2b, 107.1, 608.2h; Borborygmos and Fblthp): twice the amount of the triggering event, or twice the number of cards an earlier instruction of the ability moved or discarded: "deals twice that much damage"
  const twiceArg = typeof s.amount === 'object' && s.amount.q === 'math' && s.amount.op === '*' && s.amount.args.length === 2 && s.amount.args[0] === 2 ? s.amount.args[1] : undefined;
  const twiceMuch = typeof twiceArg === 'object' && (twiceArg.q === 'eventAmount' || (twiceArg.q === 'resultCount' && twiceArg.which === undefined && twiceArg.maxPerOwner === undefined
    && (st.info.get(`r:${twiceArg.step}`)?.moved !== undefined || st.info.get(`r:${twiceArg.step}`)?.thisWay === 'discarded this way'))) ? 'twice that much damage' : null;
  const amount = lit ?? (twiceMuch !== null ? alt(computed, twiceMuch) : spellMuch !== null ? alt(computed, spellMuch) : timesX !== null ? alt(computed, timesX) : xPlus !== null ? alt(computed, xPlus) : movedMuch !== null ? alt(computed, movedMuch) : allMuch !== null ? alt(computed, allMuch) : computed);
  // edh-replace-3 (CR 120.3; Stuffy Doll): the source ~ as its own recipient, "~ deals 1 damage to itself" (the other wording stays: a pronoun for it, "deals damage to it")
  const selfItself = s.source.ref === 'self' && JSON.stringify(s.source) === JSON.stringify(s.to);
  const to = itself ? 'itself' : selfItself ? alt('itself', recipientText(s, st)) : recipientText(s, st);
  if (copy) absorb(st, copy);
  if (dividedCopy) absorb(st, dividedCopy);
  const more = alsoText(s, st);
  // p2-pt-1 (CR 120.2b): one computed amount for both recipients, "damage equal to its power to each other creature and each opponent" (alsoText)
  const sameComputed = more !== '' && lit === null && s.also?.length === 1 && JSON.stringify(s.also[0]!.amount) === JSON.stringify(s.amount) && s.divided === undefined;
  if (more !== '' && lit === null && !sameComputed) throw new NoRenderer('a computed amount of damage with a further recipient');
  let rest: string;
  // edh-next-9 (CR 601.2d, 208.1; family divided-as-you-cast): the greatest power among creatures you control, read as the division is announced, is also said "as you cast ~" / "as you activate this ability"
  const asCast = dividedX !== null && typeof s.amount === 'object' && (s.amount.q === 'stat' || s.amount.q === 'count') ? [`${dividedX} as you cast ~`, `${dividedX} as you activate this ability`] : [];
  if (s.divided === 'announced') rest = dividedX === null ? `${amount} divided as you choose among ${to}` : alt(`${amount} divided as you choose among ${to}`, dividedX, ...asCast);
  else if (s.divided === 'evenlyRoundDown') rest = `${amount} divided evenly, rounded down, among ${to}`;
  else if (s.divided === 'evenlyRoundUp') rest = `${amount} divided evenly, rounded up, among ${to}`;
  else if (sameComputed) {
    // edh-c-49 (family damage-both-equal; CR 120.2b, 608.2h; Incite Rebellion): "deals damage to that player and each creature that player controls equal to the number of creatures they control"
    const cut = reordered === null ? -1 : reordered.indexOf(' equal to ');
    const both = reordered !== null && cut > 0 ? [`${reordered.slice(0, cut)}${more}${reordered.slice(cut)}`] : [];
    rest = whereXBoth !== null ? alt(`${amount} to ${to}${more}`, whereXBoth, ...(sparseBoth !== null ? [sparseBoth] : []), ...both) : both.length > 0 ? alt(`${amount} to ${to}${more}`, ...both) : `${amount} to ${to}${more}`;
  }
  else if (reordered !== null) {
    // FAST4 T30 (family damage-each-of): "deals damage equal to its power to each of two other target creatures"
    const eachOf = s.to.ref === 'target' && (st.specs.get(s.to.id)?.max ?? 1) !== 1 && more === '' ? [`${amount} to each of ${to}`] : [];
    // r4-refs (CR 120.3, 608.2h): "target creature deals damage equal to its power to itself" says the source as its own recipient after the amount too
    rest = itself ? alt(reordered, `${amount} to ${to}`) : alt(`${amount} to ${to}`, reordered, ...selfPronounReordered, ...eachOf, ...(whereX !== null && more === '' ? [whereX] : []), ...(whereXPlus !== null && more === '' ? [whereXPlus] : []));
  }
  else if (s.to.ref === 'target' && (st.specs.get(s.to.id)?.max ?? 1) !== 1 && more === '') rest = alt(`${amount} to ${to}`, `${amount} to each of ${to}`); // FAST4 T25 (family damage-each-of)
  else {
    // edh-d-61 (CR 120.3, 115.1, 601.2c; Volatile Arsonist; family damage-each-of, parser template eff.edhd61.damage.eachOfUpToThree): the same plain amount to three targets of their own is also
    // "deals 1 damage to each of up to one target creature, up to one target player, and/or up to one target planeswalker" (the Cone of Flame form `alsoText` made, said once)
    const three = s.divided === undefined && (s.also ?? []).length === 2 && s.to.ref === 'target' && lit !== null && s.also!.every((x) => JSON.stringify(x.amount) === JSON.stringify(s.amount)) ? new RegExp(`^, ${lit} to (.+), and ${lit} to (.+)$`).exec(more) : null;
    rest = three !== null ? alt(`${amount} to ${to}${more}`, `${amount} to each of ${to}, ${three[1]}, and/or ${three[2]}`) : `${amount} to ${to}${more}`;
  }
  // FAST5 T51 (equivalence plural-name-verb): a card whose name is plural ("Tokka & Rahzar, Terrible Twos") is the subject of "deal"
  const verb = s.source.ref === 'self' && !src.plural ? alt('deals', 'deal') : src.plural ? 'deal' : 'deals';
  const base = `${src.text} ${verb} ${rest}`;
  const have = `${src.text} deal ${rest}`;
  if (s.unpreventable === true) {
    // edhv31 (CR 615.12; Arrow Storm; family damage-and-unpreventable): the rider also joined to the damage with "and": "~ deals 5 damage to that permanent or player and the damage can't be prevented"
    const text = alt(`${base}. ${alt("that damage can't be prevented", "the damage can't be prevented", "this damage can't be prevented")}`, `${base} and the damage can't be prevented`);
    return plain(text, { have, standalone: true });
  }
  const dynamic = typeof s.amount === 'object' ? countParts(s.amount, st) : null;
  if (dynamic && s.divided === undefined && !itself) {
    // "deals 1 damage to X for each creature you control"
    const per = `${src.text} ${src.plural ? 'deal' : 'deals'} 1 damage to ${to} for each ${dynamic.singular}`;
    // edh-c-44 (CR 120.3, 608.2c; family damage-n-for-each): the count first, "For each red card exiled this way, ~ deals 1 damage to each opponent" (Culmination of Studies; one damage event for the whole count)
    const lead = more === '' && s.source.ref === 'self' ? [`for each ${dynamic.singular}, ${src.text} ${src.plural ? 'deal' : 'deals'} 1 damage to ${to}`] : [];
    return plain(alt(base, per, ...lead), { have });
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

  gainLife: (s: StepOf<'gainLife'>, st: RenderState): Clause => byPlayer(s.who, st, 'gain', () => {
    const text = amountOf(s.amount, 'life', st, { whereX: true });
    // edh-d-31 (CR 107.1a, 119.3; Brass Infiniscope; family half-x-life-rounded): half of the X of the spell cast, rounded down, is also said "half X life, rounded down"
    const a = s.amount;
    const halfX = typeof a === 'object' && a.q === 'math' && a.op === 'floorDiv' && a.args.length === 2 && a.args[1] === 2 && typeof a.args[0] === 'object' && a.args[0].q === 'spellX';
    return halfX ? alt(text, 'half X life, rounded down') : text;
  }),
  loseLife: (s: StepOf<'loseLife'>, st: RenderState): Clause => s.who.ref === 'otherOf' && s.who.of.ref === 'linked' && s.who.of.link === 'chosenPlayers' && s.who.than.ref === 'event' && s.who.than.role === 'recipient' && typeof s.amount === 'object' && s.amount.q === 'eventAmount'
    // edhd63 (CR 119.3, 608.2h, 607.2d; Sower of Discord): "the other chosen player also loses that much life", the one of the two chosen players the damaged one is not
    ? plain(`${K.player(s.who, st, 'subject').text} also loses ${amountOf(s.amount, 'life', st)}`)
    : byPlayer(s.who, st, 'lose', () => {
    // FAST4 T30 (CR 107.1a, 119.3; family half-of-own): "that player loses half their life, rounded up": half of the losing player's own life total
    const half = halfOfOwn(s.amount, 'life', s.who);
    if (half !== null) return alt(amountOf(s.amount, 'life', st), `half ${K.player(s.who, st, 'possessive').text} life, rounded ${half}`);
    // edh-next-35 (CR 119.3, 601.2b, 608.2h; Devouring Greed; family life-plus-for-each-sacrificed): "loses 2 life plus 2 life for each Spirit sacrificed this way": a number plus a number
    // times the objects the spell's additional cost sacrificed (the same amount as "life equal to 2 plus twice the number of ..."); only numbers and `costSacrificed`
    const a = s.amount;
    if (typeof a === 'object' && a.q === 'math' && a.op === '+' && a.args.length === 2 && typeof a.args[0] === 'number') {
      const m = a.args[1];
      if (typeof m === 'object' && m.q === 'math' && m.op === '*' && m.args.length === 2 && typeof m.args[0] === 'number') {
        const c = m.args[1];
        if (typeof c === 'object' && c.q === 'count' && c.of.ref === 'costSacrificed') {
          const parts = costCountParts(c.of, cloneState(st));
          if (parts !== null) return alt(amountOf(s.amount, 'life', st), `${a.args[0]} life plus ${m.args[0]} life for each ${parts.singular}`);
        }
      }
    }
    return amountOf(s.amount, 'life', st, { whereX: true });
  }),

  setLife: (s: StepOf<'setLife'>, st: RenderState): Clause => {
    const whoPhrase = K.player(s.who, st, 'possessive');
    const who = whoPhrase.text;
    // edh-c-5 (CR 119.5, 103.4): the life total set to the starting life total is printed "becomes equal to your starting life total"
    const startingLife = typeof s.value === 'object' && s.value.q === 'startingLife';
    // edh-d-2 (CR 103.4, 107.1a, 119.5; Torgaar): another player's life total set to half THEIR starting life total, rounded down
    const v0 = s.value;
    const halfOthers = s.who.ref !== 'you' && typeof v0 === 'object' && v0.q === 'math' && v0.op === 'floorDiv' && v0.args.length === 2 && v0.args[1] === 2
      && typeof v0.args[0] === 'object' && v0.args[0].q === 'startingLife';
    if (halfOthers) return plain(`${who} life total becomes half their starting life total, rounded down`, { have: `${who} life total become half their starting life total, rounded down` });
    const base = `${who} life total becomes ${startingLife ? 'equal to ' : ''}${K.qty(s.value, st)}`;
    // trek-5 (CR 119.5, 701.10; family double-life-total): "double your life total" is the life total set to twice itself (the model has no doubling node, as
    // render/double.ts says of power and toughness); the player the life total is of is the player whose life total it becomes. ONE player only: the step reads its value
    // once (effects/handlers/lifedamage.ts#setLife), so "Double each opponent's life total" (each one's own total doubled) is not this step: the gate refuses it, manual
    const v = s.value;
    const life = typeof v === 'object' && v.q === 'math' && v.op === '*' && v.args.length === 2 ? v.args.find((a) => a !== 2) : undefined;
    const doubled = namesOnePlayer(s.who) && !whoPhrase.plural && typeof v === 'object' && v.q === 'math' && v.op === '*' && v.args.length === 2 && v.args.includes(2)
      && typeof life === 'object' && life.q === 'life' && life.agg === undefined && JSON.stringify(life.of) === JSON.stringify(s.who);
    // edh-c-12 (CR 119.5, 608.2d; Loxodon Lifechanter): "you may have your life total become the total toughness of creatures you control"
    // edh-b-6 (CR 103.4; Resolute Archangel): after an "if your life total is ..." clause the life total is "it", "it becomes equal to your starting life total"
    const baseAlt = startingLife && namesOnePlayer(s.who) && !whoPhrase.plural ? alt(base, `it becomes equal to ${K.qty(s.value, st)}`) : base;
    return plain(doubled ? alt(baseAlt, `double ${who} life total`) : baseAlt, doubled ? {} : { have: `${who} life total become ${startingLife ? 'equal to ' : ''}${K.qty(s.value, st)}` });
  },

  fight: (s: StepOf<'fight'>, st: RenderState): Clause => {
    if (s.pairs === true) throw new NoRenderer('a paired fight outside its fold (render/fold-p2damage2.ts)'); // p2-damage-2
    if (s.as !== undefined) st.info.set(`b:${s.as}`, { nouns: [], plural: true, thisWay: 'fought this way' }); // trek-22 (CR 701.14a, 608.2c): "a creature that fought this way"
    // edh-next-146 (family fight-each-other-group): both targets named together as one group by an earlier instruction (render/refs.ts marks the union)
    const namedBefore = s.a.ref === 'target' && s.b.ref === 'target' && st.info.has(`u:${s.a.id}|${s.b.id}`);
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
    if (s.by === 'toughness') {
      // edh-c-111 (CR 120.2b, 608.2b; Grim Contest; family chosen-pair-fight): not a fight: the two creatures each deal damage equal to their toughness to the other
      if (pair !== undefined && ids[0] === pair.a && ids[1] === pair.b) {
        const noun = pluralize(pair.noun);
        return plain(alt(`each of those ${noun} deals damage equal to its toughness to the other`, `each of the chosen ${noun} deals damage equal to its toughness to the other`));
      }
      return plain(`each of ${a.text} and ${b.text} deals damage equal to its toughness to the other`);
    }
    if (pair !== undefined && ids[0] === pair.a && ids[1] === pair.b) {
      const them = [`those ${pluralize(pair.noun)}`, `the chosen ${pluralize(pair.noun)}`];
      return plain(alt(`${a.text} ${a.plural ? 'fight' : 'fights'} ${b.text}`, ...them.map((t) => `${t} fight each other`)), { have: alt(`${a.text} fight ${b.text}`, ...them.map((t) => `${t} fight each other`)) });
    }
    // edh-next-146 (CR 701.14a, 608.2c; Arena; family fight-each-other-group): the two targets an earlier instruction named together ("Tap target creature you control and target creature
    // of an opponent's choice they control.") are "those creatures" as a group: "those creatures fight each other", the parser's eff.stdrx10.fight.eachOther over that group
    const ia = s.a.ref === 'target' ? st.info.get(`t:${s.a.id}`) : undefined;
    const ib = s.b.ref === 'target' ? st.info.get(`t:${s.b.id}`) : undefined;
    const shared = namedBefore && ia !== undefined && ib !== undefined && !ia.plural && !ib.plural && s.by === undefined ? ia.nouns.find((n) => ib.nouns.includes(n)) : undefined;
    if (shared !== undefined) return plain(alt(`${a.text} ${a.plural ? 'fight' : 'fights'} ${b.text}`, `those ${pluralize(shared)} fight each other`), { have: `${a.text} fight ${b.text}` });
    return plain(`${a.text} ${a.plural ? 'fight' : 'fights'} ${b.text}`, { have: `${a.text} fight ${b.text}` });
  },

  // r5-cost (CR 115.1, 601.2c): counters on a target for each opponent, "for each opponent, put X -1/-1 counters on up to one target creature that player controls,
  // where X is ...": merge wave 8, the lead "for each opponent," is r5-fxb's for every step (render/steps.ts#perPlayerLead), so this reading is folded into it
  putCounters: (s: StepOf<'putCounters'>, st: RenderState): Clause => putCountersClause(s, st),

  removeCounters: (s: StepOf<'removeCounters'>, st: RenderState): Clause => {
    const sym = loyaltySymbol(s); // edh-next-137 (CR 606.1; Comet, Stellar Pup): "[-1]"
    if (sym !== null) return plain(alt(`remove ${countersText(s.count, s.kind, st)} from ${refText(s.from, st)}`, sym));
    // edhn63 (CR 122.1, 608.2d): "remove any number of +1/+1 counters from among creatures you control": the total over a group (capability op:removeCounters.among)
    if (s.among === true) {
      if (s.from.ref !== 'each' || !('filter' in s.from) || s.kindOfChoice !== undefined) throw new NoRenderer('removeCounters from among other than a group');
      const bare = K.np(s.from.filter, st, { det: 'none', plural: true });
      // a group no control or other condition narrows may be said "all permanents" or "permanents on the battlefield" (Sensational Spider-Man, Eventide's Shadow)
      const group = /control|your|opponent|\bthat\b|\bwith\b|\bwithout\b/.test(bare) ? bare : alt(bare, `all ${bare}`, `${bare} on the battlefield`);
      const nouns = s.kind === 'any' ? 'counters' : `${s.kind} counters`;
      if (s.upTo === true && s.count === 'all') return plain(`remove any number of ${nouns} from among ${group}`);
      if (s.upTo === true) {
        if (typeof s.count !== 'number' || s.count < 2) throw new NoRenderer('removeCounters from among: up to a count other than a number above one');
        return plain(`remove up to ${numWord(s.count)} ${nouns} from among ${group}`);
      }
      if (s.count === 'all' || typeof s.count !== 'number') throw new NoRenderer('removeCounters from among: a count other than a number');
      return plain(`remove ${numWord(s.count)} ${s.count === 1 ? (s.kind === 'any' ? 'counter' : `${s.kind} counter`) : nouns} from among ${group}`);
    }
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
    // edh-perms-24 (CR 122.1, 608.2d; Clockspinning): the counter an earlier "choose a counter on ..." chose
    if (s.kindOfChoice !== undefined) {
      if (s.count !== 1 || s.upTo === true || s.as !== undefined || st.counterKindLink !== s.kindOfChoice) throw new NoRenderer('removing a counter of a chosen kind other than the one counter just chosen');
      return plain(`remove that counter from ${from}`);
    }
    // edh-players-10 (CR 122.1; Final Act): every counter of every kind a group of players has, "each opponent loses all counters" (player counters are lost, never "removed from")
    // edh-d-52 (Survivor's Med Kit): the same family with a kind, "target player loses all rad counters"
    if (s.count === 'all' && ((s.from.ref === 'each' && 'who' in s.from) || (s.from.ref === 'target' && st.specs.get(s.from.id)?.kind === 'player'))) { const ks = s.kind === 'any' ? 'counters' : `${s.kind} counters`; return plain(alt(`remove all ${ks} from ${from}`, `${from} loses all ${ks}`)); }
    // edh-c-79 (CR 122.1, 608.2h, 107.3; Descendant of Masumaro; family counter-count): "remove a +1/+1 counter from ~ for each card in target opponent's hand": a fixed one counter
    // for each thing a count counts (`count` of a description), said as the put form says it
    if (s.kind !== 'any' && typeof s.count === 'object' && s.count.q === 'count' && s.as === undefined) {
      const before = cloneState(st);
      const main = `remove ${countersText(s.count, s.kind, st)} from ${from}`;
      const each = perForms(s.count, st, before);
      return plain(alt(main, ...each.map((x) => `remove ${withArticle(`${s.kind} counter`)} from ${from} for each ${x}`)));
    }
    return plain(`remove ${countersText(s.count, s.kind, st)} from ${from}`);
  },

  moveCounters: (s: StepOf<'moveCounters'>, st: RenderState): Clause => {
    if (s.atLeastOne === true && (s.upTo !== true || s.count !== 'all' || s.kind !== 'any')) throw new NoRenderer('moveCounters at least one other than one or more counters of any kind'); // edh-misc-6
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
    // edh-misc-6 (CR 122.5, 608.2d): "move any number of counters from among creatures you control onto that creature": a group gives (Slippery Bogbonder)
    if (s.among === true) {
      if (s.upTo !== true || s.count !== 'all' || s.from.ref !== 'each' || !('filter' in s.from)) throw new NoRenderer('moveCounters from among other than any number of counters from a group');
      return plain(`move any number of ${s.kind === 'any' ? '' : `${s.kind} `}counters from ${s.kind === 'any' ? 'among ' : ''}${K.np(s.from.filter, st, { det: 'none', plural: true })} ${onto} ${K.obj(s.to, st, 'object').text}`);
    }
    // edh-misc-6 (CR 122.5): "move a counter of each kind not on ~ from another target permanent you control onto ~" (Goldberry): one of every kind the receiver lacks
    if (s.eachNewKind === true) {
      if (s.kind !== 'any' || s.count !== 1 || s.upTo === true) throw new NoRenderer('moveCounters of each new kind other than one counter of any kind');
      const notOn = K.obj(s.to, cloneState(st), 'object').text; // rendered on a copy: the receiver is named again after "onto"
      const from = K.obj(s.from, st, 'object').text;
      return plain(`move a counter of each kind not on ${notOn} from ${from} ${onto} ${K.obj(s.to, st, 'object').text}`);
    }
    // p2-counters-move-1 (CR 122.5, 608.2d): "move any number of [+1/+1] counters from A onto B" (`upTo`, how many of each kind chosen on resolution)
    if (s.upTo === true) {
      if (s.count !== 'all') throw new NoRenderer('moveCounters up to a number');
      const from = K.obj(s.from, st, 'object').text;
      // edh-misc-6 (CR 608.2d): "move one or more counters from A onto B" (`atLeastOne`: not none)
      if (s.atLeastOne === true) {
        if (s.kind !== 'any') throw new NoRenderer('moveCounters of one or more counters of one kind');
        return plain(`move one or more counters from ${from} ${onto} ${second(K.obj(s.to, st, 'object').text)}`);
      }
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

/**
 * pc-counters-1 (CR 107.14, 122.1, 608.2h): a computed number of energy counters is "an amount of {E} equal to Q" as well as "Q {E}" (the amount of the event, "that many
 * {E}", and X stay as they were: they have no "equal to" wording).
 */
function energyAmount(n: Quantity, st: RenderState): string {
  const q = K.qty(n, st);
  if (typeof n === 'object' && (n.q === 'eventAmount' || n.q === 'X' || n.q === 'var')) return `${q} {E}`;
  // pc-counters-3 (CR 107.14, 122.1): "you get {E} for each creature you control" (Aetherwind Basker): the same count said per object
  const per = countParts(n, cloneState(st));
  return alt(`an amount of {E} equal to ${q}`, `${q} {E}`, ...(per ? [`{E} for each ${per.singular}`] : []));
}

/** The text of a putCounters step (STEPS.putCounters adds a target for each opponent's "for each opponent,"). */
/**
 * edh-next-137 (CR 606.1, 122.1; Comet, Stellar Pup; family loyalty-symbol-in-effect): a fixed number of loyalty counters put on or removed from the source itself is also the
 * loyalty symbol Oracle prints inside an effect, "[+2]" / "[-1]" (the ruling: "Each + loyalty symbol in Comet's abilities means to put the indicated number of loyalty counters on
 * him"). Null for any other step.
 */
function loyaltySymbol(s: StepOf<'putCounters'> | StepOf<'removeCounters'>): string | null {
  const on = s.op === 'putCounters' ? s.on : s.from;
  const extra = Object.keys(s).filter((k) => !['op', 'on', 'from', 'kind', 'count'].includes(k) && (s as unknown as Record<string, unknown>)[k] !== undefined);
  if (extra.length > 0 || s.kind !== 'loyalty' || JSON.stringify(on) !== '{"ref":"self"}' || typeof s.count !== 'number' || !Number.isInteger(s.count) || s.count < 1) return null;
  return `[${s.op === 'putCounters' ? '+' : '-'}${s.count}]`;
}

function putCountersClause(s: StepOf<'putCounters'>, st: RenderState): Clause {
  const sym = loyaltySymbol(s); // edh-next-137
  if (sym !== null) return plain(alt(`put ${countersText(s.count, s.kind, st)} on ${K.obj({ ref: 'self' }, st, 'object').text}`, sym));
    // edhn63 (CR 122.1, 122.6; capability op:putCounters.copyFrom): "put the same number of each kind of counter on that creature"
    if (s.copyFrom !== undefined) {
      if (s.kind !== 'any' || s.count !== 1 || s.upTo === true || s.distribute === true || s.kindOfChoice !== undefined || s.as !== undefined || s.by !== undefined || s.ofEvent !== undefined || s.copyFrom.ref !== 'self') throw new NoRenderer('counters copied from an object other than the same number of each kind of counter on ~');
      return plain(`put the same number of each kind of counter on ${K.obj(s.on as ObjRef, st, 'object').text}`);
    }
    // edhn63 (CR 122.1, 122.6; capability op:putCounters.ofEvent): the counters the triggering event put, "put the same number and kind of counters on ~", "put one of each of those kinds of counters on it"
    if (s.ofEvent !== undefined) {
      if (s.kind !== 'any' || s.count !== 1 || s.upTo === true || s.distribute === true || s.kindOfChoice !== undefined || s.as !== undefined) throw new NoRenderer('counters of the event other than the same number and kind');
      const to = K.obj(s.on as ObjRef, st, 'object').text;
      const they = s.by === undefined ? '' : s.by.ref === 'event' && s.by.role === 'player' ? 'they ' : null;
      if (they === null) throw new NoRenderer('counters of the event put by a player other than the event\'s player');
      return plain(s.ofEvent === 'same' ? `${they}put the same number and kind of counters on ${to}` : `${they}put one of each of those kinds of counters on ${to}`);
    }
    // edh-players-19 (CR 122.1, 122.6, 608.2c; Shadrix Silverquill): "target player puts a +1/+1 counter on each creature they control": the player named puts the counters on every
    // object of a described group they control (`by`); no other shape of the instruction is said this way
    if (s.by !== undefined) {
      const f = s.on.ref === 'each' && 'filter' in s.on ? s.on.filter : undefined;
      if (f === undefined || f.anyOf?.length !== 1 || JSON.stringify(f.controller) !== JSON.stringify(s.by) || Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).length !== 2 || s.as !== undefined || s.upTo === true || s.distribute === true || s.kindOfChoice !== undefined || typeof s.count !== 'number') {
        throw new NoRenderer('counters put by a player other than the controller, other than on each object of a group that player controls');
      }
      return byPlayer(s.by, st, 'put', () => `${countersText(s.count, s.kind, st)} on each ${K.np(f.anyOf![0]!, st, { det: 'none' })} they control`);
    }
    // FAST5 T76 (CR 608.2c; effects/handlers/counters.ts#recordActed): the creatures the counters went on are "them" / "those creatures" for the next sentence
    if (s.as !== undefined && s.on.ref === 'each' && 'filter' in s.on) bind(st, s.as, { nouns: K.nounsOf(s.on.filter), plural: true });
    // edh-perms-15 (CR 122.1, 608.2d; Ichormoon Gauntlet, Animation Module): one more counter of the kind an earlier "choose a counter on ..." chose
    if (s.kindOfChoice !== undefined) {
      if (s.count !== 1 || s.upTo === true || s.distribute === true || s.as !== undefined || st.counterKindLink !== s.kindOfChoice) throw new NoRenderer('counters of a chosen kind other than one more counter of the kind just chosen');
      const to = K.obj(s.on as ObjRef | PlayerRef as ObjRef, st, 'object').text;
      // edh-next-128 (CR 122.1, 608.2d; Crystalline Giant): after a choice of a kind the object has none of, the counter is "a counter of that kind" (never "another")
      if (st.counterKindFresh === s.kindOfChoice) return plain(`put a counter of that kind on ${to}`);
      // edh-d-89 (CR 122.1, 608.2c; Aven Courier): one counter of the chosen kind on one target that doesn't have one yet
      if (s.ifNone === true) {
        if ((s.on as { ref?: string }).ref !== 'target') throw new NoRenderer('"if it doesn\'t have a counter of that kind" on anything but one target');
        return plain(`put a counter of that kind on ${to} if it doesn't have a counter of that kind on it`);
      }
      return plain(alt(`put an additional counter of that kind on ${to}`, `put another counter of that kind on ${to}`, `give ${to} another counter of that kind`, `put another of those counters on ${to}`));
    }
    if (isPlayerRef(s.on as ObjRef | PlayerRef, st)) {
      const who = s.on as PlayerRef;
      if (s.kind === 'energy') return byPlayer(who, st, 'get', () => (typeof s.count === 'number' ? (s.count >= 5 ? alt('{E}'.repeat(s.count), `${numWord(s.count)} {E}`) : '{E}'.repeat(s.count)) : energyAmount(s.count, st)));
      // edh-d-70 (CR 122.1, 107.1, 603.2c, 608.2h; Struggle for Project Purity): "that player gets twice that many rad counters": twice the amount of the triggering event (the attackers of a declaration)
      if (typeof s.count === 'object' && s.count.q === 'math' && s.count.op === '*' && s.count.args.length === 2 && s.count.args[0] === 2 && typeof s.count.args[1] === 'object'
        && s.count.args[1].q === 'eventAmount' && Object.keys(s.count.args[1]).length === 1 && s.kind !== 'any' && s.kind !== 'energy') {
        return byPlayer(who, st, 'get', () => `twice that many ${pluralize(`${s.kind} counter`)}`);
      }
      // edh-d-70 (CR 122.1, 608.2h; Azula, Ruthless Firebender; parser/templates/zz-cloud/edh-d-70.json): "you get an experience counter for each player who discarded a card this turn": a fixed number
      // of counters for each thing a count counts (`math *` of the number and the count), the same wording as the counters put on an object below
      if (typeof s.count === 'object' && s.count.q === 'math' && s.count.op === '*' && s.count.args.length === 2 && typeof s.count.args[0] === 'number' && s.count.args[0] >= 1
        && typeof s.count.args[1] === 'object' && s.kind !== 'any' && countParts(s.count.args[1], cloneState(st)) !== null) {
        const [mult, each] = s.count.args as [number, Quantity];
        return byPlayer(who, st, 'get', () => `${mult === 1 ? withArticle(`${s.kind} counter`) : `${numWord(mult)} ${pluralize(`${s.kind} counter`)}`} for each ${countParts(each, st)!.singular}`);
      }
      // edh-b-9 (CR 122.1, 702.164c; Necrogen Rotpriest; family player-additional-counter): one more counter on top of those the player already got is "an additional" one
      return byPlayer(who, st, 'get', () => (s.count === 1 && s.kind !== 'any' ? alt(countersText(s.count, s.kind, st), `an additional ${s.kind} counter`) : countersText(s.count, s.kind, st)));
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
      const group = K.np(s.on.filter, st, { det: 'none', plural: true });
      // edh-next-89 (CR 608.2d, 107.3, 608.2h; Blessing of Frost): a computed total is also "distribute X +1/+1 counters among any number of creatures you control, where X is ..." (the same split of the same count)
      return plain(typeof s.count === 'object' ? alt(`distribute ${n} among any number of ${group}`, `distribute X ${pluralize(`${s.kind} counter`)} among any number of ${group}, where X is ${K.qty(s.count, st)}`) : `distribute ${n} among any number of ${group}`);
    }
    // FAST4 T28 (CR 601.2d): counters divided among the targets as the spell or ability was put on the stack: "distribute two +1/+1 counters among one or
    // two target creatures" (the spec's `divide`, effects/handlers/counters.ts#putShares)
    const divided = s.on.ref === 'target' ? st.specs.get(s.on.id)?.divide : undefined;
    if (divided !== undefined) {
      if (divided.what !== 'counters' || JSON.stringify(divided.total) !== JSON.stringify(s.count)) throw new NoRenderer('a division that is not of these counters');
      const n = typeof s.count === 'number' ? `${numWord(s.count)} ${pluralize(`${s.kind} counter`)}` : countersText(s.count, s.kind, st);
      // edh-next-46 (CR 601.2d, 107.3, 608.2h; family distribute-counters-where-x; Quirion Beastcaller): a computed total is also "distribute X +1/+1 counters among ..., where X is ..."
      // (the targets are named before the quantity, on a copy of the state, as divided damage says it)
      let whereX: string | null = null;
      if (divided.upTo !== true && typeof s.count === 'object' && s.count.q !== 'X' && s.count.q !== 'var' && s.count.q !== 'eventAmount') {
        const copy = cloneState(st);
        const onX = K.obj(s.on as ObjRef, copy, 'object').text;
        whereX = `distribute X ${pluralize(`${s.kind} counter`)} among ${onX}, where X is ${K.qty(s.count, copy)}`;
      }
      const base = `distribute ${divided.upTo === true ? 'up to ' : ''}${n} among ${K.obj(s.on as ObjRef, st, 'object').text}`;
      return plain(whereX === null ? base : alt(base, whereX));
    }
    // FAST4 T28 (CR 122.8): "put its +1/+1 counters on target creature you control": as many counters of the kind as one object has, the object named first
    // (from the state before the recipient, as Oracle's word order has it)
    // edh-next-32 (CR 122.1, 118.12, 608.2c; Rampaging Aetherhood): "you may pay one or more {E}. If you do, put that many +1/+1 counters on ~": the count of the payment of any amount (steps-flow.ts, `paidAny`)
    if (typeof s.count === 'object' && s.count.q === 'resultCount' && s.count.which === undefined && s.count.to === undefined && st.info.get(`b:${s.count.step}`)?.paidAny === true && s.as === undefined) {
      return plain(`put that many ${s.kind} counters on ${K.obj(s.on as ObjRef, st, 'object').text}`);
    }
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
    // trek-14 (CR 122.1, 122.1a; Jett Reno, Problem Solver): the preview Oracle text prints the +1/+1 counter as "+1/1"
    const main = s.count === 1 && s.kind !== 'any' ? alt(`put ${counters} on ${on}`, `put an additional ${noun} on ${on}`, `put another ${noun} on ${on}`, ...(s.kind === '+1/+1' ? [`put ${counters.replace('+1/+1', '+1/1')} on ${on}`] : [])) : `put ${counters} on ${on}`;
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
    const timesWords = times === null ? '' : times[0] === 1 ? withArticle(noun) : `${numWord(times[0] as number)} ${pluralize(noun)}`;
    // edh-c-98 (CR 122.1, 608.2h; Mind Maggots, family counters-for-each-lead): the number may lead, "For each card discarded this way, put two +1/+1 counters on ~."
    const timesText = times !== null && perEach !== null ? [`put ${timesWords} on ${on} for each ${perEach.singular}`, `for each ${perEach.singular}, put ${timesWords} on ${on}`] : [];
    if (per) {
      // std-ra (CR 115.1, 122.1, 608.2c): "put a hone counter on ~ for each creature target opponent controls" names the target in the "for each" for the first
      // time, as std-r10 says it for a draw and a gain of life (steps-util.ts#perForms); the reading from the state now ("... that player controls") stays
      const each = beforeCount !== null ? perForms(s.count as Quantity, st, beforeCount) : [per.singular];
      // edh-top-16 (CR 706.2, 122.1; Clown Car): "For each even result, put a +1/+1 counter on ~." says the count in front
      const lead = typeof s.count === 'object' && s.count.q === 'diceResults' ? [`for each ${per.singular}, put ${withArticle(noun)} on ${on}`] : [];
      const text = alt(main, ...lead, ...each.map((x) => `put ${withArticle(noun)} on ${on} for each ${x}`), `put X ${pluralize(noun)} on ${on}, where X is ${K.qty(s.count, st)}`, ...equalTo);
      if (fork) absorb(st, fork);
      return plain(its !== null ? alt(its, text) : text);
    }
    // FAST4 T26 (CR 107.3, 608.2h): another computed amount the same way ("put X +1/+1 counters on it, where X is the number of cards you've drawn this turn")
    // CLOUD std-fra (CR 107.3, 608.2h): and the number of cards in a zone ("put X +1/+1 counters on each creature you control, where X is the number of cards in
    // your hand"), counted as the step runs (family counters-where-x-zone); Cloud std-woe (family counter-count): and a calculation, "put X +1/+1 counters on target
    // creature you control, where X is one plus the number of Foods you control" (a sum, lowered from "where X is", parser/lower/quantities.ts#substituteX)
    // p2-counters-move-2: and the X of "Remove all <kind> counters from ~", "put X +1/+1 counters on it, where X is the number of charge counters removed this way"
    // edh-perms-1 (CR 706.2, 107.3, 122.6): and the result of the die roll just made ("roll a d20. When you do, put X +1/+1 counters on each of up to two target creatures, where X is
    // the result", Ancient Bronze Dragon), the counters going on each of several targets as FAST2 T8 says below
    const dieTargets = typeof s.count === 'object' && s.count.q === 'dieResult' && s.on.ref === 'target' ? st.specs.get(s.on.id) : undefined;
    const dieEach = dieTargets !== undefined && (dieTargets.max !== 1 || dieTargets.perOpponent === true || dieTargets.perPlayer === true) ? [`put X ${pluralize(noun)} on each of ${on}, where X is ${K.qty(s.count, st)}`] : [];
    if (typeof s.count === 'object' && (s.count.q === 'cardsDrawnThisTurn' || s.count.q === 'lifeGainedThisTurn' || s.count.q === 'lifeLostThisTurn' /* edh-next-99 */ || s.count.q === 'life' /* edh-c-9: "where X is your life total" (Ajani, Valiant Protector) */ || s.count.q === 'zoneSize' || s.count.q === 'math' || s.count.q === 'dieResult' || (s.count.q === 'X' && st.costAllCountersX !== undefined))) return plain(alt(main, `put X ${pluralize(noun)} on ${on}, where X is ${K.qty(s.count, st)}`, ...dieEach, ...timesText, ...(s.count.q === 'dieResult' || s.count.q === 'lifeGainedThisTurn' /* edh-next-27: Betor, Ancestor's Voice */ || s.count.q === 'lifeLostThisTurn' || (s.count.q === 'math' && s.count.op === 'max') /* edh-next-99: Willowdusk, Essence Seer */ || (s.count.q === 'math' && amount === 'the difference') /* edh-perms-22 */ ? equalTo : []))); // edh-mana-keywords-9 (Vexing Puzzlebox): "put a number of charge counters on ~ equal to the result"
    // FAST4 T28 (CR 107.3, 608.2h): a statistic of an object ("where X is ~'s power", "where X is that spell's mana value") or another read value, with the
    // amount after the recipient ("put a number of +1/+1 counters on ~ equal to that creature's power")
    if (typeof s.count === 'object' && (s.count.q === 'stat' || s.count.q === 'counters' || s.count.q === 'distinct' || s.count.q === 'spellManaSpent' /* edh-next-89 (CR 601.2h, 608.2h; Smoldering Egg): "put a number of ember counters on ~ equal to the amount of mana spent to cast that spell" */ || s.count.q === 'manaProduced' /* edh-d-90 (CR 106.3, 608.2h; Tyvar the Bellicose): "... on it equal to the amount of mana ~ produced" */)) { // std-sos: or the names / colors among a group ("where X is the number of differently named lands you control")
      const where = `put X ${pluralize(noun)} on ${on}, where X is ${K.qty(s.count, st)}`;
      if (fork) absorb(st, fork);
      return plain(its !== null ? alt(its, main, ...equalTo, where) : alt(main, ...equalTo, where));
    }
    // FAST2 T8: "put a +1/+1 counter on each of up to two target creatures": the same counters on every one of several targets (CR 122.6)
    const spec = s.on.ref === 'target' ? st.specs.get(s.on.id) : undefined;
    if (spec && (spec.max !== 1 || spec.perOpponent === true || spec.perPlayer === true)) return plain(alt(main, `put ${counters} on each of ${on}`)); // STD-FRA: one target for each opponent is a set too
    // edh-d-30 (CR 122.6, 601.2c; Omo, Queen of Vesuva): the same counters on each of two targets named together, "on each of up to one target land and up to one target creature"
    if (s.on.ref === 'union' && s.on.of.length === 2 && s.on.of.every((x) => x.ref === 'target')) return plain(alt(main, `put ${counters} on each of ${on}`));
    // FAST3 T18: the same for a group named earlier ("put a +1/+1 counter on each of them", "... on each of those creatures")
    if (onPhrase.plural && (s.on.ref === 'bound' || s.on.ref === 'event' || (s.on.ref === 'each' && 'filter' in s.on && groupPart(s.on.filter) !== null))) return plain(alt(main, `put ${counters} on each of ${on}`));
    // edh-perms-12 (CR 608.2c; family and-you-plain-clause): also "... and you put a -1/-1 counter on up to one target creature they control" after another player's clause (Persistent Constrictor)
    // edh-d-3 (CR 119.3, 122.1, 603.2; Cradle of Vitality, family that-many-event): the amount of a life-gain trigger's event is also "for each 1 life you gained"
    const lifeGained = typeof s.count === 'object' && s.count.q === 'eventAmount' && Object.keys(s.count).length === 1 && (st.trigger ?? []).length === 1
      && st.trigger![0]!.ev === 'life' && st.trigger![0]!.change === 'gain' && st.trigger![0]!.player === 'you'
      ? [`put ${withArticle(noun)} on ${on} for each 1 life you gained`] : [];
    // edh-next-87 (CR 120.3, 122.1, 608.2h; Primo, the Unbounded; family counters-equal-to-event-amount): the amount of a trigger's event is also "put a number of +1/+1 counters on it equal to the damage dealt"
    const eventEq = typeof s.count === 'object' && s.count.q === 'eventAmount' && Object.keys(s.count).length === 1 ? [`put a number of ${pluralize(noun)} on ${on} equal to ${K.qty(s.count, afterOn)}`] : [];
    return plain(lifeGained.length + eventEq.length > 0 ? alt(`put ${counters} on ${on}`, ...lifeGained, ...eventEq) : main, { andYou: main });
}
