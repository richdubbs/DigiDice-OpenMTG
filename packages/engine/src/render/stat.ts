/**
 * Static effects as sentences (WP2): costMod, restrict, replace, permit, rule, triggerMod, additionalCost, alternativeCost, pregame, and (through
 * render/mods.ts) continuous. With a duration they are the effect of a step ("... this turn"); without one they are the text of a static ability.
 */
import { isTurnEnergySpent } from '../model/forms';
import { ownerShufflesItPrevented, removeThenGivePrevented } from './edhn60'; // edh-next-60
import { insteadClosesFirstSentence } from './edhn71'; // edh-next-71
import { rollOptionText } from './edhd49'; // edh-d-49
import { mustAttackOwnerBans } from './fold-edht5'; // edh-top-5
import { mustAttackCantAttackYou } from './fold-edhd10'; // edh-d-10
import type { CopyExcept, TokenDef, AmountChange, AbilityDef, Condition, ContinuousEffectDef, CostModDef, Destination, EffectStep, Duration, EventPattern, ObjectFilter, ObjRef, PlayerPred, PlayerRef, Quantity, ReplacementDef, RestrictionDef, RuleAction, RuleModDef, StaticEffect, TriggerModDef, ZoneName } from '../types/ability';
import { isAnyDrawCause, isEnterLeaveCause, isLifeGainCause, isTurnedFaceUpCause } from '../types/ability'; // trek-2 (CR 603.2d); edh-d-93
import { formatManaCost, type ManaCost } from '../types/mana';
import { K } from './kernel';
import { copyExceptText } from './copy-except';
import { quotedAbility } from './quote';
import { abilityList, continuous, ptPredicate } from './mods';
import { countParts, distinctParts } from './qty';
import { isPlayerRef, markTriggerRoles, spellsYouCast, withSubjects } from './refs';
import { countedNoun, destPhrase } from './steps-util';
import { MOVE_VERB, tokenText } from './steps-zones';
import { absorb, cloneState, nestedState, withVariants, type RenderState } from './state';
import { possessiveStep, STEP_NAME } from './turn';
import { alt, ALT_CLOSE, ALT_OPEN, COLOR_WORD, firstAlt, hoistFinalPeriod, joinList, lowerFirst, NoRenderer, numWord, pluralize, withArticle } from './text';

/**
 * std-ry3: a reference to a role of the triggering event that is a player for sure: the `player` role, or the recipient of a damage trigger whose recipient
 * can only be a player ("Whenever ~ deals combat damage to a player, that player ..."). An attack's defender may be a planeswalker, so it is not one (fail closed).
 */
const isEventPlayerRef = (x: unknown, events: readonly EventPattern[] | undefined): boolean => {
  if (typeof x !== 'object' || x === null || (x as { ref?: unknown }).ref !== 'event' || events === undefined || events.length === 0) return false;
  const role = (x as { role?: unknown }).role;
  if (role === 'player') return true;
  return role === 'recipient' && events.every((ev) => ev.ev === 'damage' && ev.recipient?.player !== undefined && ev.recipient.object === undefined);
};

/** std-ry3: `f` written with `trigger` as the events being rendered, then the state's own events again. */
function withTrigger<T>(st: RenderState, trigger: EventPattern[], f: () => T): T {
  const saved = st.trigger;
  st.trigger = trigger;
  try {
    return f();
  } finally {
    st.trigger = saved;
  }
}

const refText = (ref: ObjRef | PlayerRef, st: RenderState, form: 'subject' | 'object' | 'possessive' = 'subject'): { text: string; plural: boolean } => {
  const p = isPlayerRef(ref, st) ? K.player(ref as PlayerRef, st, form) : K.obj(ref as ObjRef, st, form);
  return { text: p.text, plural: p.plural };
};

const durationSuffix = (d: Duration | undefined, st: RenderState): string => {
  if (!d) return '';
  const t = K.dur(d, st);
  return t === '' ? '' : ` ${t}`;
};

/** True when the duration limits the effect (CR 611.2a: no stated duration means "until the end of the game"). */
const isLimited = (d: Duration | undefined): d is Duration => d !== undefined && d.d !== 'permanent';

/** CR 611.2a: a stated duration of a sentence, trailing ("... this turn") or leading ("Until end of turn, ..."). */
export function lasting(base: string, d: Duration | undefined, st: RenderState): string {
  const suffix = durationSuffix(d, st);
  return suffix === '' ? base : alt(`${base}${suffix}`, `${suffix.trim()}, ${base}`);
}

/** "this turn" / "this combat": the duration as it sits inside a sentence ("spells you cast this turn cost ..."), or null when it has no such wording. */
function inlineDuration(d: Duration | undefined): string | null {
  if (!isLimited(d)) return null;
  return d.d === 'endOfTurn' ? 'this turn' : d.d === 'endOfCombat' ? 'this combat' : null;
}

/** A static effect that has no wording for a duration (costs of casting, pregame actions) refuses one instead of dropping it. */
function noDuration(kind: string, d: Duration | undefined): void {
  if (isLimited(d)) throw new NoRenderer(`duration ${d.d} on ${kind}`);
}

// ---------------------------------------------------------------------------
// Cost modifications (CR 601.2f, 118.7-118.8)
// ---------------------------------------------------------------------------

const isMath = (q: Quantity | undefined): q is Extract<Quantity, { q: 'math' }> => typeof q === 'object' && q.q === 'math';

/** FAST4 T32: JSON with its keys sorted and undefined members dropped, so two values compare whatever the order of their fields. */
const sortedJson = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.map(sortedJson);
  if (x === null || typeof x !== 'object') return x;
  const o = x as Record<string, unknown>;
  return Object.fromEntries(Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => [k, sortedJson(o[k])]));
};
const sameShape = (a: unknown, b: unknown): boolean => JSON.stringify(sortedJson(a)) === JSON.stringify(sortedJson(b));

/** The amount of a cost change and, when it scales, the "for each ..." tail. */
export function costAmount(change: { generic?: Quantity; mana?: StaticMana; times?: Quantity }, st: RenderState): { amount: string; per: string } {
  const mana = change.mana && change.mana.length > 0 ? formatManaCost(change.mana) : '';
  if (change.times !== undefined) return repeatedCost(change.times, mana, change.generic, st);
  const g = change.generic;
  if (g === undefined) return { amount: mana, per: '' };
  if (typeof g === 'number') return { amount: `${g > 0 ? `{${g}}` : ''}${mana}`, per: '' };
  // max(0, targets - 1): "for each target beyond the first"
  if (isMath(g) && g.op === 'max' && g.args.length === 2 && g.args[0] === 0) {
    const inner = g.args[1];
    if (isMath(inner) && inner.op === '-' && inner.args.length === 2 && typeof inner.args[0] === 'object' && inner.args[0].q === 'spellTargetCount' && inner.args[1] === 1) {
      return { amount: `{1}${mana}`, per: ' for each target beyond the first' };
    }
  }
  // FAST3 T11: n * (the number of basic land types among a set of lands): "{n} less to cast for each basic land type among lands you control" (domain)
  if (isMath(g) && g.op === '*' && g.args.length === 2 && typeof g.args[0] === 'number') {
    const among = basicLandTypesAmong(g.args[1]!);
    if (among !== null) return { amount: `{${g.args[0]}}${mana}`, per: ` for each basic land type among ${K.np(among, st, { det: 'none', plural: true })}` };
  }
  // edh-next-8 (CR 601.2f, 118.7; Valiant Changeling): "~ costs {1} less to cast for each X. This effect can't reduce the amount of mana this spell costs by more than {5}."
  // The reduction is min(n * count, cap): the second sentence is part of the same static
  if (isMath(g) && g.op === 'min' && g.args.length === 2 && typeof g.args[1] === 'number' && isMath(g.args[0]) && g.args[0].op === '*') {
    const inner = costAmount({ ...change, generic: g.args[0] }, st);
    if (inner.per !== '' && !inner.per.startsWith(', where')) return { amount: inner.amount, per: `${inner.per}. This effect can't reduce the amount of mana this spell costs by more than {${g.args[1]}}` };
    throw new NoRenderer('a capped cost reduction of a count with no "for each" wording');
  }
  // n * (count): "{n} less ... for each X"
  if (isMath(g) && g.op === '*' && g.args.length === 2 && typeof g.args[0] === 'number') {
    const per = perText(g.args[1]!, st); // r4-cost: before any other wording ("the creature it targets" has no quantity words of its own)
    if (per) return { amount: `{${g.args[0]}}${mana}`, per };
    const parts = K.qty(g.args[1]!, st);
    return { amount: `{X}${mana}`, per: `, where X is ${K.qty(g, st)}`.replace(/^, where X is/, `, where X is`) + (parts ? '' : '') };
  }
  // edh-next-49 (CR 208.1, 601.2c, 602.2b; Belt of Giant Strength): "Equip {10}. This ability costs {X} less to activate, where X is the power of the creature it targets." (the activated ability's target, statics/costmods.ts#targetValue)
  if (typeof g === 'object' && g.q === 'stat' && g.stat === 'power' && g.of.ref === 'target' && Object.keys(g).length === 3) return { amount: `{X}${mana}`, per: ', where X is the power of the creature it targets' };
  const per = perText(g, st);
  if (per) return { amount: `{1}${mana}`, per };
  return { amount: `{X}${mana}`, per: `, where X is ${K.qty(g, st)}` };
}

/** edh-c-45: two own cost reductions of the spell, each "if <you control ...>" (costAmount reads `times` min(1, count) as that condition); null for any other effects. */
function twoSelfReductionsText(effects: StaticEffect[], st: RenderState): string | null {
  if (effects.length !== 2) return null;
  const parts: { amount: string; per: string }[] = [];
  for (const e of effects) {
    if (e.s !== 'costMod' || e.applies.self !== true || e.change.kind !== 'reduce' || e.change.mana === undefined || e.change.times === undefined || e.change.generic !== undefined || e.change.life !== undefined || e.change.coloredOnly !== undefined) return null;
    let part: { amount: string; per: string };
    try { part = costAmount(e.change, st); } catch (x) { if (x instanceof NoRenderer) return null; throw x; }
    if (!part.per.startsWith(' if you control ')) return null;
    parts.push(part);
  }
  const self = K.obj({ ref: 'self' }, st, 'subject').text;
  return `${self} costs ${parts[0]!.amount} less to cast${parts[0]!.per} and ${parts[1]!.amount} less to cast${parts[1]!.per}`;
}

/**
 * edh-d-45 (CR 601.2b, 601.2f, 118.7, 701.21a; Dargo, the Shipwrecker): "As an additional cost to cast ~, you may sacrifice any number of artifacts and/or creatures. ~ costs {2} less to
 * cast for each permanent sacrificed this way and {2} less to cast for each other artifact or creature you've sacrificed this turn": the announced sacrifices of the optional cost and
 * the sacrifices of the turn before it, two reductions of the spell itself said as one sentence. Null for any other effects.
 */
function additionalSacrificeAndOtherText(effects: StaticEffect[], st: RenderState): string | null {
  if (effects.length !== 3) return null;
  const [a, b, c] = effects as [StaticEffect, StaticEffect, StaticEffect];
  if (a.s !== 'additionalCost' || b.s !== 'costMod' || c.s !== 'costMod') return null;
  const amountOf = (e: Extract<StaticEffect, { s: 'costMod' }>, kind: 'costCount' | 'happenedCount'): { n: number; q: Quantity } | null => {
    const g = e.change.generic;
    if (e.applies.self !== true || e.applies.caster !== 'you' || e.change.kind !== 'reduce' || e.change.floor !== 'zero' || e.change.mana !== undefined || e.change.times !== undefined || e.change.life !== undefined) return null;
    if (!isMath(g) || g.op !== '*' || g.args.length !== 2 || typeof g.args[0] !== 'number' || typeof g.args[1] !== 'object' || isMath(g.args[1]) || g.args[1].q !== kind) return null;
    return { n: g.args[0], q: g.args[1] };
  };
  const first = amountOf(b, 'costCount');
  const second = amountOf(c, 'happenedCount');
  const hc = second?.q;
  if (first === null || second === null || hc === undefined || typeof hc !== 'object' || hc.q !== 'happenedCount') return null;
  const ev = hc.event;
  if (hc.scope !== 'turn' || hc.by !== undefined || hc.per !== undefined || ev.ev !== 'action' || ev.verb !== 'sacrifice' || ev.actor !== 'you' || ev.object === undefined || Object.keys(ev).length !== 4) return null;
  return `${staticEffects([a, b], st)} and {${second.n}} less to cast for each other ${K.np(ev.object, st, { det: 'none', noZone: true })} you've sacrificed this turn`;
}

/** edh-cast-7: the quantity "your starting life total minus your life total" (CR 103.4, 119.1), which Oracle calls "the difference" under the condition that your life total is below it. */
function isLifeDifference(g: Quantity | undefined): boolean {
  return isMath(g) && g.op === '-' && g.args.length === 2 && sameShape(g.args[0], { q: 'startingLife' }) && sameShape(g.args[1], { q: 'life', of: { ref: 'you' } });
}

/**
 * std-r8 (CR 601.2f, 107.3; family cost-where-x): a spell's own generic cost change of one per counted object is also "~ costs {X} less to cast, where X is the
 * number of cards in your graveyard that are instant cards ..." (the count's own words); null when the change has any other amount or mana symbols of its own.
 * std-rc (family ability-cost-where-x): an activated ability's own cost change reads it too (render/abil.ts#withRestrictions).
 */
export function countWhereX(change: { generic?: Quantity; mana?: StaticMana; times?: Quantity }, st: RenderState): string | null {
  const g = change.generic;
  if (change.times !== undefined || (change.mana?.length ?? 0) > 0 || typeof g !== 'object' || g.q !== 'count' || perText(g, st) === null) return null;
  const text = K.qty(g, st);
  return /^the number of /.test(text) ? text : null;
}

type StaticMana = NonNullable<Extract<StaticEffect, { s: 'costMod' }>['change']['mana']>;

/**
 * FAST4 T21: a cost change whose `mana` is applied `times` times (types/ability.ts#CostModDef.change): the two wordings Oracle has for it, else refused.
 *   max(0, spellTargetCount - 1)          "{2}{R} more to cast for each target beyond the first" (strive, CR 601.2c, 601.2f)
 *   min(1, spellTargetCount of filter)    "{3} less to cast if it targets a tapped creature"
 */
function repeatedCost(times: Quantity, mana: string, generic: Quantity | undefined, st: RenderState): { amount: string; per: string } {
  if (mana === '' || generic !== undefined) throw new NoRenderer('a repeated cost change without mana, or with a generic amount too');
  // FAST5X E12 (CR 601.2f, 701.59c): applied once if the optional collect evidence cost was paid for it: "costs {2} less to cast if evidence was collected"
  if (typeof times === 'object' && !isMath(times) && times.q === 'kickCount' && times.name === 'collectEvidence') return { amount: mana, per: ' if evidence was collected' };
  if (isMath(times) && times.op === 'max' && times.args.length === 2 && times.args[0] === 0) {
    const inner = times.args[1];
    if (isMath(inner) && inner.op === '-' && inner.args.length === 2 && inner.args[1] === 1 && typeof inner.args[0] === 'object' && inner.args[0].q === 'spellTargetCount' && inner.args[0].filter === undefined) {
      return { amount: mana, per: ' for each target beyond the first' };
    }
  }
  if (isMath(times) && times.op === 'min' && times.args.length === 2 && times.args[0] === 1) {
    const c = times.args[1];
    // T38 (CR 702.166): "{2} less to cast if it's bargained" (the bargain cost was paid for this spell, CR 601.2b, 601.2f)
    if (typeof c === 'object' && c.q === 'kickCount' && c.name === 'bargain') return { amount: mana, per: " if it's bargained" };
    // edh-c-8 (CR 601.2c, 601.2f; Revoke Demise): a card with no zone of its own ("if it targets a creature card with mana value 3 or less") is said as a card, not as a nontoken permanent
    if (typeof c === 'object' && c.q === 'spellTargetCount' && c.filter !== undefined) {
      const card = c.filter.isCard === true && c.filter.zone === undefined ? { ...c.filter, zone: 'exile' as const } : undefined;
      return { amount: mana, per: ` if it targets ${card !== undefined ? K.np(card, st, { det: 'a', noZone: true }) : K.np(c.filter, st, { det: 'a' })}` };
    }
    // edh-c-59 (CR 205.3m, 601.2f; Synchronized Eviction): "costs {2} less to cast if you control at least two creatures that share a creature type": floorDiv(the most creatures you control sharing
    // one creature type, N), at most once
    if (isMath(c) && c.op === 'floorDiv' && c.args.length === 2 && typeof c.args[1] === 'number' && c.args[1] >= 1 && typeof c.args[0] === 'object' && !isMath(c.args[0]) && c.args[0].q === 'mostSharingCreatureType'
      && sameShape(c.args[0].among, { ref: 'each', filter: { controller: 'you', types: ['Creature'] } })) {
      return { amount: mana, per: ` if you control at least ${numWord(c.args[1])} creatures that share a creature type` };
    }
    // FAST4 T32: min(1, floor(n / N)) of the cards that left your graveyard this turn: "if N or more cards left your graveyard this turn" (CR 400.3: a card in
    // a graveyard is in its owner's; every zone change from it, CR 603.10a)
    const n = leftOwnGraveyard(c);
    if (n !== null) return { amount: mana, per: ` if ${numWord(n)} or more cards left your graveyard this turn` };
    // edh-d-45 (CR 601.2c, 601.2f, 602.2b; Wayta, Trainer Prodigy): "This ability costs {2} less to activate if it targets two creatures you control" (floorDiv of the targets that match, N), at most once
    if (isMath(c) && c.op === 'floorDiv' && c.args.length === 2 && typeof c.args[1] === 'number' && c.args[1] >= 2 && typeof c.args[0] === 'object' && !isMath(c.args[0]) && c.args[0].q === 'spellTargetCount' && c.args[0].filter !== undefined) {
      return { amount: mana, per: ` if it targets ${numWord(c.args[1])} ${K.np(c.args[0].filter, st, { det: 'none', plural: true, noZone: true })}` };
    }
    // edh-c-59 (CR 601.2f, 121.2; Kami of Jealous Thirst): "This ability costs {4}{B} less to activate if you've drawn three or more cards this turn" (floorDiv of the cards you drew this turn by N, at most once)
    if (isMath(c) && c.op === 'floorDiv' && c.args.length === 2 && typeof c.args[1] === 'number' && c.args[1] >= 1 && typeof c.args[0] === 'object' && !isMath(c.args[0]) && c.args[0].q === 'cardsDrawnThisTurn') {
      return { amount: mana, per: ` if you've drawn ${numWord(c.args[1])} or more cards this turn` };
    }
    // FAST5 T63 (CR 601.2f, 602.2b): "This ability costs {2} less to activate if you control a creature with a +1/+1 counter on it" (the count of the objects you
    // control, at most once) and "... if you attacked with a Spacecraft this turn" (the attacks of this turn, at most once): the ability's own cost change has no
    // condition field, so each is written as the cost change applied min(1, n) times
    if (typeof c === 'object' && c.q === 'count' && c.of.ref === 'each' && 'filter' in c.of && c.of.filter.controller === 'you') return { amount: mana, per: ` if ${K.cond({ cond: 'exists', of: c.of }, st)}` };
    if (typeof c === 'object' && c.q === 'happenedCount' && c.scope === 'turn' && c.by === undefined && c.per === undefined && c.beforeEvent === undefined && c.event.ev === 'attacks') {
      return { amount: mana, per: ` if ${K.cond({ cond: 'happened', event: c.event, scope: 'turn' }, st)}` };
    }
  }
  // edh-next-58 (CR 601.2c, 601.2f; Hinata, Dawn-Crowned; Battlefield Thaumaturge): the mana applied once for each target of the spell, or for each target that matches a description
  if (typeof times === 'object' && !isMath(times) && times.q === 'spellTargetCount') {
    if (times.filter === undefined) return { amount: mana, per: ' for each target' };
    if (Object.keys(times.filter).filter((k) => (times.filter as Record<string, unknown>)[k] !== undefined).join() === 'types') return { amount: mana, per: ` for each ${K.np(times.filter, st, { det: 'none', noZone: true })} it targets` };
  }
  // edh-next-9 (CR 601.2f, 107.3): "{G} less to cast for each green creature you control", the mana applied once for each object counted
  const each = perText(times, st);
  if (each !== null && (typeof times !== 'object' || times.q !== 'math')) return { amount: mana, per: each };
  throw new NoRenderer('a repeated cost change');
}

/** FAST4 T32: floorDiv(the number of your cards that left your graveyard this turn, N) -> N; null for anything else. */
function leftOwnGraveyard(q: Quantity | undefined): number | null {
  if (!isMath(q) || q.op !== 'floorDiv' || q.args.length !== 2 || typeof q.args[1] !== 'number' || q.args[1] < 1) return null;
  const h = q.args[0];
  if (typeof h !== 'object' || h.q !== 'happenedCount' || h.scope !== 'turn' || h.by !== undefined || h.per !== undefined) return null;
  return sameShape(h.event, { ev: 'zoneChange', subject: { isCard: true, owner: 'you' }, from: 'graveyard' }) ? q.args[1] : null;
}

const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const;

/**
 * FAST3 T11: the number of basic land types among a set of lands (domain, CR 305.6: Plains, Island, Swamp, Mountain and Forest) is written in the model as
 * the sum over the five basic land types of min(1, the number of those lands with that type), the one form the statics evaluate exactly (`distinct`
 * `landTypes` counts every land type, Gates and Deserts too). Returns the set of lands (the filter without the subtype), or null for any other quantity.
 */
function basicLandTypesAmong(q: Quantity): ObjectFilter | null {
  if (!isMath(q) || q.op !== '+' || q.args.length !== BASIC_LAND_TYPES.length) return null;
  let base: string | null = null;
  let among: ObjectFilter | null = null;
  for (let i = 0; i < BASIC_LAND_TYPES.length; i++) {
    const term = q.args[i]!;
    if (!isMath(term) || term.op !== 'min' || term.args.length !== 2 || term.args[0] !== 1) return null;
    const c = term.args[1]!;
    if (typeof c !== 'object' || c.q !== 'count' || c.of.ref !== 'each' || !('filter' in c.of)) return null;
    const { subtypes, ...rest } = c.of.filter;
    if (subtypes?.length !== 1 || subtypes[0] !== BASIC_LAND_TYPES[i] || !(rest.types ?? []).includes('Land')) return null;
    const key = JSON.stringify(rest);
    if (base !== null && key !== base) return null;
    base = key;
    among = rest;
  }
  return among;
}

function perText(q: Quantity, st: RenderState): string | null {
  const live = typeof q === 'object' && q.q === 'live' ? q.value : q;
  if (typeof live === 'object') {
    switch (live.q) {
      case 'count':
      case 'countPlayers':
      case 'happenedCount': {
        // edh-next-67 (CR 201.2, 404.1, 601.2f; Locket of Yesterdays): the cards of your graveyard that share the name of the spell the cost change is applied to
        if (live.q === 'count' && live.of.ref === 'each' && 'filter' in live.of && sameShape(live.of.filter, { zone: 'graveyard', owner: 'you', isCard: true, sharesWith: { with: { ref: 'subject' }, quality: 'name' } })) return ' for each card with the same name as that spell in your graveyard';
        // r5-mech (CR 404.1, 406.1): a count over two zones, "for each creature card you own in exile and in your graveyard" (its quantity also reads "the total number of")
        if (live.q === 'count' && live.of.ref === 'each' && 'filter' in live.of && Array.isArray(live.of.filter.zone) && live.of.filter.zone.length > 1) {
          const cp = countParts(live, st);
          if (cp) return ` for each ${cp.singular}`;
        }
        // edh-next-8 (CR 102.2, 601.2f; Avatar of Growth): the opponents are counted "for each opponent you have" (family for-each-opponent-you-have)
        if (live.q === 'countPlayers' && Object.keys(live).length === 2 && live.of.ref === 'each' && live.of.who === 'opponent') return alt(' for each opponent', ' for each opponent you have');
        // edh-d-70 (CR 107.14, 601.2f; Blaster Hulk): "for each {E} you've paid or lost this turn" (render/qty.ts: the energy counters removed from you this turn)
        if (isTurnEnergySpent(live)) return " for each {e} you've paid or lost this turn";
        // edh-d-90 (CR 601.2f, 601.2i; Thrasta, Tempest's Roar; family other-spell-cast-this-turn): the spells any player cast this turn other than this one are also "for each other spell cast this turn"
        if (live.q === 'happenedCount' && JSON.stringify(live) === '{"q":"happenedCount","event":{"ev":"cast","spell":{"not":{"self":true}}},"scope":"turn"}') {
          const m = /^the number of (.*)$/.exec(firstAlt(K.qty(live, cloneState(st))));
          return alt(...(m ? [` for each ${singularOf(m[1]!, live, st)}`] : []), ' for each other spell cast this turn');
        }
        // edh-c-1 (CR 701.9a, 702.29a, 601.2f; Hollow One): "for each card you've cycled or discarded this turn" (render/qty.ts#historyParts: the discards of the turn by you)
        if (live.q === 'happenedCount' && live.event.ev === 'action' && live.event.verb === 'discard' && live.event.actor === 'you') { const cp = countParts(live, st); if (cp) return ` for each ${cp.singular}`; }
        const text = K.qty(live, st);
        const m = /^the number of (.*)$/.exec(text);
        if (m) return ` for each ${singularOf(m[1]!, live, st)}`;
        return null;
      }
      // edh-cast-3 (CR 119.3, 601.2f): "for each 1 life your opponents have lost this turn" (render/qty.ts: the life all the opponents lost, added up)
      case 'lifeLostTotal': return live.of.ref === 'each' && live.of.who === 'opponent' ? ' for each 1 life your opponents have lost this turn' : null;
      // std-costs-1 (CR 601.2b, 601.2f): "for each permanent sacrificed this way", the number announced for the spell's optional cost (render/qty.ts#countParts)
      case 'costCount': return ` for each ${countParts(live, st)!.singular}`;
      // trek-15 (CR 506.3, 601.2f; Own the Day): "costs {1} less to cast for each opponent you attacked this turn" (family for-each-opponent-you-attacked)
      case 'opponentsAttacked': return live.scope === 'turn' ? ' for each opponent you attacked this turn' : null;
      // T38 (CR 700.8): "for each creature in your party"
      case 'partySize': return live.of.ref === 'you' ? ' for each creature in your party' : null;
      // FAST4 T21: "for each color among permanents you control" (CR 105.1, 105.2: the colors are white, blue, black, red and green; colorless is not one)
      // r4-cost (CR 105.2, 601.2c): "for each color of the creature it targets" (an activated ability's target, statics/costmods.ts#targetValue)
      case 'distinct': {
        if (live.what === 'colors') return live.among.ref === 'target' ? ' for each color of the creature it targets' : ` for each color among ${distinctParts(live, st).among}`;
        // edh-next-8 (CR 202.3, 205.3m, 601.2f; Oskar, Valiant Changeling): "for each different mana value among cards in your graveyard", "for each creature type among creatures you control"
        const cp = countParts(live, st);
        return cp === null ? null : ` for each ${cp.singular}`;
      }
      // edh-d-90 (CR 205.2a, 601.2f, 607.2a; Cemetery Prowler): "for each card type they share with cards exiled with ~" (the spells the cost change applies to are "they")
      case 'sharedCardTypes': return live.among.ref === 'linked' && live.among.link === 'exiled' && live.among.last === undefined ? ` for each card type they share with cards exiled with ${K.obj({ ref: 'self' }, st, 'object').text}` : null;
      // edh-next-58 (CR 205.2a, 601.2f; Korvold, Gleeful Glutton): "for each card type among permanents you've sacrificed this turn" (render/qty.ts#countParts)
      case 'happenedDistinct': { const cp = live.what === 'cardTypes' ? countParts(live, st) : null; return cp === null ? null : ` for each ${cp.singular}`; }
      // CMDF (CR 903.8): "{1} less to cast for each time you've cast a commander from the command zone this game" (Font of Magic)
      case 'commanderCasts': return ` for each ${countParts(live, st)!.singular}`;
      // std-sos (CR 122.1, 602.2b): "This ability costs {1} less to activate for each page counter on ~" (the counters of one kind on one object)
      // r4-cost (CR 122.1, 601.2c): "for each +1/+1 counter on the creature it targets"
      // std-rm (CR 122.1): "for each rad counter you have" (the counters of one kind a player has, render/qty.ts#countParts)
      case 'counters': {
        if (live.kind !== 'any' && isPlayerRef(live.on as ObjRef | PlayerRef, st)) return ` for each ${countParts(live, st)!.singular}`;
        // edh-d-6 (CR 122.1, 602.2b; Deepwood Denizen, family counters-on-group): "for each +1/+1 counter on creatures you control" (a described group, render/qty.ts#countParts says it with or without "all")
        if (live.kind !== 'any' && (live.on as ObjRef).ref === 'each' && 'filter' in (live.on as object) && !isPlayerRef(live.on as ObjRef | PlayerRef, st)) return ` for each ${countParts(live, st)!.singular}`;
        return live.kind !== 'any' && (live.on as ObjRef).ref === 'target' ? ` for each ${live.kind} counter on the creature it targets` : live.kind !== 'any' && !isPlayerRef(live.on as ObjRef | PlayerRef, st) ? ` for each ${live.kind} counter on ${K.obj(live.on as ObjRef, st, 'object').text}` : null;
      }
      // std-rm (CR 121.1, 601.2i): "for each card you've drawn this turn", "for each spell you've cast this turn"
      case 'cardsDrawnThisTurn': case 'spellsCastThisTurn': return ` for each ${countParts(live, st)!.singular}`;
      // edh-next-9 (CR 601.2f, 119.3): "costs {1} less to cast for each opponent who was dealt damage this turn" (render/qty.ts#happenedPlayersParts)
      case 'happenedPlayers': return ` for each ${countParts(live, st)!.singular}`;
      // r4-cost (CR 601.2f): "for each Cave you control and each Cave card in your graveyard", the sum of two counts (each object counted once in its own set)
      case 'math': {
        // edh-next-8 (CR 122.1, 122.1f; Lumbering Megasloth): the counters on every permanent plus those every player has
        if (isCountersAmongPlayersAndPermanents(live)) return ' for each counter among players and permanents';
        if (live.op !== '+' || live.args.length !== 2 || !live.args.every((a) => typeof a === 'object' && a.q === 'count')) return null;
        const [a, b] = live.args.map((x) => perText(x, st));
        return a && b ? `${a} and ${b.replace(/^ for /, '')}` : null;
      }
      default: return null;
    }
  }
  return null;
}

/** edh-next-8 (CR 122.1, 122.1f): every counter on every permanent plus every counter every player has (edhn8QtyAt, parser/holes/edhn8.ts). */
function isCountersAmongPlayersAndPermanents(q: Extract<Quantity, { q: 'math' }>): boolean {
  return q.op === '+' && sameShape(q.args, [{ q: 'counters', on: { ref: 'each', filter: {} }, kind: 'any' }, { q: 'counters', on: { ref: 'each', who: 'player' }, kind: 'any' }]);
}

/** "creatures you control" -> "creature you control": rebuilt from the quantity rather than by string surgery. */
function singularOf(_plural: string, q: Quantity, st: RenderState): string {
  if (typeof q === 'object') {
    if (q.q === 'count' && q.of.ref === 'each') {
      // CMD4: a "for each" noun phrase, as render/qty.ts#countParts writes it ("for each creature your opponents control", NpOpts.forEach)
      // (std-r8: through countParts, so "~ costs {1} less to cast for each creature on the battlefield" reads as the count does, family on-the-battlefield)
      const base = countParts(q, st)!.singular;
      // FAST3 T11: "for each instant and sorcery card in your graveyard" counts each card that is an instant or a sorcery (CR 205.2; family
      // each-type-list): the types of a counted set of cards outside the battlefield also join with "and". Only a filter of card types and where they are.
      const f = q.of.filter;
      const types = f.types ?? [];
      const plain = Object.entries(f).every(([k, v]) => v === undefined || ['types', 'zone', 'owner', 'controller', 'isCard'].includes(k));
      if (!plain || types.length < 2 || f.zone === undefined || f.zone === 'battlefield' || f.zone === 'any' || Array.isArray(f.zone)) return base;
      const rest = K.np({ ...f, types: undefined }, st, { det: 'none' });
      // CLOUD std-dft (family each-type-list-and-or): ... and "for each artifact and/or creature card in your graveyard", the same cards counted once each
      return alt(base, `${joinList(types.map((t) => t.toLowerCase()), 'and')} ${rest}`, `${joinList(types.map((t) => t.toLowerCase()), 'and/or')} ${rest}`);
    }
    // edh-next-56 (CR 607.2a; The Kenriths' Royal Funeral): "for each card exiled with ~", the cards the object's linked ability exiled (render/qty.ts#countParts)
    if (q.q === 'count' && q.of.ref === 'linked') { if (q.of.link !== 'exiled') throw new NoRenderer('a count of the objects of a link other than exiled'); return countParts(q, st)!.singular; }
    if (q.q === 'countPlayers') {
      if (q.lostLifeIs !== undefined) throw new NoRenderer('a count of players by the life they lost this turn (Standard round P: rendered as a condition only)');
      if (q.controlsIs !== undefined) throw new NoRenderer('a count of players who control a number of permanents (std-rx12: render/qty.ts only)');
      const word = q.of.ref === 'each' && q.of.who === 'opponent' ? 'opponent' : 'player';
      return q.lostLifeThisTurn === true ? `${word} who lost life this turn` : word; // std-mkm (CR 119.3)
    }
    if (q.q === 'happenedCount') {
      const ev = q.event;
      const scope = q.scope === 'turn' ? 'this turn' : q.scope === 'combat' ? 'this combat' : 'this game';
      if (ev.ev === 'zoneChange' && ev.from === 'battlefield' && ev.to === 'graveyard') return `${K.np({ ...ev.subject }, st, { det: 'none' })} that died ${scope}`;
      // p2-cost-statics-1 (CR 601.2i, 508.1): "for each spell your opponents have cast this turn", "for each creature you attacked with this turn" (render/qty.ts#countParts)
      if ((ev.ev === 'cast' && ev.player === 'opponent') || (ev.ev === 'draw' && ev.player === 'opponent' /* edh-cast-8 */) || ev.ev === 'attacks') { const cp = countParts(q, st); if (cp !== null) return cp.singular; }
      if (ev.ev === 'action' && ev.verb === 'sacrifice') { const cp = countParts(q, st); if (cp !== null) return cp.singular; } // edh-b-7 (render/qty.ts#happened): "for each permanent sacrificed this turn"
      return `time ${K.event(ev, st, 'past')} ${scope}`;
    }
  }
  return _plural;
}

/**
 * r3-cost (CR 601.2a, 400.3): a cost modification's spells with where they are cast from around them, as parser/templates/zz-cloud/r3-cost.json builds them:
 * `{anyOf: [{anyOf: [<spells>], castFrom: <zone>[, owner: you]}, <the same with another zone>]}` ("from graveyards or from exile", "from your graveyard or
 * from exile") or `{anyOf: [<spells>], not: {castFrom: 'hand', owner: you}}` ("from anywhere other than your hand"). A graveyard or a hand is "your" when
 * the card is owned by you (a card is only ever in its owner's graveyard or hand, CR 400.3). Null for any other shape.
 */
function castFromZones(f: ObjectFilter | undefined): { spells: ObjectFilter; from: string } | null {
  if (f === undefined) return null;
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort();
  if (keys.join() === 'anyOf,not' && f.anyOf!.length === 1 && sameShape(f.not, { castFrom: 'hand', owner: 'you' })) return { spells: f.anyOf![0]!, from: 'from anywhere other than your hand' };
  if (keys.join() !== 'anyOf' || f.anyOf!.length !== 2) return null;
  const zone = (b: ObjectFilter): string | null => {
    const bk = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
    if (bk.some((k) => k !== 'anyOf' && k !== 'castFrom' && k !== 'owner') || b.anyOf?.length !== 1) return null;
    if (b.owner === undefined) return b.castFrom === 'graveyard' ? 'graveyards' : b.castFrom === 'exile' ? 'exile' : null;
    return sameShape(b.owner, 'you') && (b.castFrom === 'graveyard' || b.castFrom === 'hand') ? `your ${b.castFrom}` : null;
  };
  // Oracle names exile last ("from graveyards or from exile"), whatever the order of the two (canonical JSON sorts them)
  const [a, b] = f.anyOf![0]!.castFrom === 'exile' ? [f.anyOf![1]!, f.anyOf![0]!] : [f.anyOf![0]!, f.anyOf![1]!];
  const za = zone(a), zb = zone(b);
  if (za === null || zb === null || za === zb || !sameShape(a.anyOf![0], b.anyOf![0])) return null;
  return { spells: a.anyOf![0]!, from: `from ${za} or from ${zb}` };
}

/**
 * The spells a cost modification applies to. FAST2 T7: a filter that is only `anyOf` two kinds of spell also reads "red spells and white spells" (a spell
 * that is both is one spell: the reduction applies once, CR 601.2f, 118.7).
 */
function spellsPhrase(f: ObjectFilter, st: RenderState): string {
  const np = (x: ObjectFilter): string => K.np({ ...x, zone: 'stack', stackKind: 'spell' }, st, { det: 'none', plural: true });
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  // std-r8 (family subtype-list-spells, as type-list for card types): spells of several subtypes and nothing else are also "Aura and Equipment spells"
  if ((f.subtypes?.length ?? 0) > 1 && keys.every((k) => k === 'subtypes' || k === 'stackKind' || (k === 'zone' && f.zone === 'stack'))) {
    const text = np(f);
    const at = text.lastIndexOf(' or ');
    return at < 0 || text.includes(ALT_OPEN) ? text : alt(text, `${text.slice(0, at)} and ${text.slice(at + 4)}`);
  }
  if (keys.length !== 1 || keys[0] !== 'anyOf' || f.anyOf!.length !== 2) return np(f);
  const pair = `${np(f.anyOf![0]!)} and ${np(f.anyOf![1]!)}`;
  try {
    return alt(np(f), pair);
  } catch (e) {
    if (e instanceof NoRenderer) return pair;
    throw e;
  }
}

function costMod(e: Extract<StaticEffect, { s: 'costMod' }>, st: RenderState, inside = ''): string {
  const { applies, change } = e;
  // a cost modification applies to the spell itself, to a kind of spells, or to a kind of abilities: a second target of it would be dropped
  if ([applies.self === true, applies.spells !== undefined, applies.abilities !== undefined, applies.unlock === true, applies.plot === true].filter(Boolean).length > 1) throw new NoRenderer('a cost modification of more than one kind of thing');
  // std-rx26 (CR 702.170a, 601.2f): "Plotting cards from your hand costs {2} less": a generic reduction of the plot action's cost only
  if (applies.plot === true) {
    const plain = change.kind === 'reduce' && change.mana === undefined && change.times === undefined && change.life === undefined && change.floor !== 'one' && inside === '' && applies.caster === 'you';
    if (!plain || change.generic === undefined || typeof change.generic !== 'number') throw new NoRenderer('a plot cost change other than a fixed generic reduction');
    return `plotting cards from your hand costs {${change.generic}} less`;
  }
  // r3-cost (CR 601.2f, 118.7): the one-mana floor is said of a reduction of activation costs only (Training Grounds); any other place has no wording yet
  if (change.floor === 'one' && (applies.abilities === undefined || change.kind !== 'reduce')) throw new NoRenderer('a one-mana floor of a cost change that is not a reduction of activation costs');
  // edh-next-12 (CR 601.2f, 118.7; Trinisphere): "each spell that would cost less than three mana to cast costs three mana to cast": a floor on the total mana of every spell
  if (change.kind === 'floor') {
    const words: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five' };
    const w = typeof change.generic === 'number' ? words[change.generic] : undefined;
    if (w === undefined || applies.spells === undefined || Object.keys(applies.spells).length > 0 || applies.caster !== 'any' || inside !== '' || change.mana !== undefined || change.times !== undefined || change.life !== undefined || change.floor !== undefined) {
      throw new NoRenderer('a floor of the total cost other than "each spell that would cost less than N mana to cast costs N mana to cast"');
    }
    return `each spell that would cost less than ${w} mana to cast costs ${w} mana to cast`;
  }
  // edh-next-75 (CR 903.3, 903.8, 601.2f; Myth Unbound): "Your commander costs {1} less to cast for each time it's been cast from the command zone this game."
  if (change.kind === 'reduce' && applies.caster === 'any' && inside === '' && applies.spells !== undefined && sameShape(applies.spells, { commander: true, owner: 'you', stackKind: 'spell', zone: 'stack' })
    && change.mana === undefined && change.times === undefined && change.life === undefined && change.floor === 'zero' && isMath(change.generic) && change.generic.op === '*' && change.generic.args.length === 2
    && typeof change.generic.args[0] === 'number' && sameShape(change.generic.args[1], { q: 'commanderCasts', costSpell: true })) {
    return `your commander costs {${change.generic.args[0]}} less to cast for each time it's been cast from the command zone this game`;
  }
  // edh-next-12 (CR 601.2f, 601.2i; Damping Sphere): "Each spell a player casts costs {1} more to cast for each other spell that player has cast this turn."
  if (change.kind === 'increase' && change.times !== undefined && sameShape(change.times, { q: 'casterSpellsCastThisTurn' })) {
    if (applies.spells === undefined || Object.keys(applies.spells).length > 0 || applies.caster !== 'any' || inside !== '' || change.generic !== undefined || change.life !== undefined || change.floor !== undefined || change.coloredOnly !== undefined) {
      throw new NoRenderer('a per-spell-cast increase other than "each spell a player casts costs <mana> more to cast for each other spell that player has cast this turn"');
    }
    return `each spell a player casts costs ${formatManaCost(change.mana ?? [])} more to cast for each other spell that player has cast this turn`;
  }
  // edh-c-73 (CR 601.2f, 109.4; Hum of the Radix): "Each artifact spell costs {1} more to cast for each artifact its controller controls."
  if (change.kind === 'increase' && change.times !== undefined && typeof change.times === 'object' && change.times.q === 'casterControlledCount') {
    if (applies.spells === undefined || applies.caster !== 'any' || inside !== '' || change.generic !== undefined || change.life !== undefined || change.floor !== undefined || change.coloredOnly !== undefined) {
      throw new NoRenderer('a per-permanent increase other than "each <spells> costs <mana> more to cast for each <permanent> its controller controls"');
    }
    const spells = K.np({ ...applies.spells, zone: undefined }, st, { det: 'none', plural: false, noZone: true });
    return `each ${spells.replace(/ spells?$/, '')} spell costs ${formatManaCost(change.mana ?? [])} more to cast for each ${K.np(change.times.filter, st, { det: 'none', plural: false })} its controller controls`;
  }
  const first = firstSpellEachTurn(e, st, inside); // FAST4 T32
  if (first !== null) return first;
  const firstAbility = firstTargetingAbility(e, st, inside); // edh-next-67
  if (firstAbility !== null) return firstAbility;
  // edh-next-106 (CR 601.2f, 602.2b, 605.1a, 119.4; Thran Portal): "Mana abilities of this land cost an additional 1 life to activate." (the mana abilities of the object itself, a life increase alone)
  if (change.life !== undefined && applies.abilities?.kind === 'mana' && JSON.stringify(applies.abilities) === '{"source":{"self":true},"kind":"mana"}' && change.kind === 'increase' && Object.keys(change).length === 2
    && applies.caster === 'any' && Object.keys(applies).length === 2 && inside === '') {
    return `mana abilities of ${K.obj({ ref: 'self' }, st, 'object').text} cost an additional ${change.life} life to activate`;
  }
  // edh-next-142 (CR 606.4, 601.2f; Carth the Lion): "Planeswalkers' loyalty abilities you activate cost an additional [+1] to activate.": a loyalty increase alone, of the loyalty abilities of planeswalkers
  if (change.loyalty !== undefined) {
    const only = change.kind === 'increase' && Object.keys(change).every((k) => k === 'kind' || k === 'loyalty') && JSON.stringify(applies.abilities) === '{"kind":"loyalty","source":{"types":["Planeswalker"]}}'
      && applies.caster === 'you' && Object.keys(applies).length === 2 && inside === '' && change.loyalty > 0;
    if (!only) throw new NoRenderer('a loyalty increase other than of the loyalty abilities of planeswalkers you activate');
    return `planeswalkers' loyalty abilities you activate cost an additional [+${change.loyalty}] to activate`;
  }
  // r5-cost (CR 601.2f, 119.4): "Spells your opponents cast that target ~ cost an additional 3 life to cast": a life increase alone, no mana
  if (change.life !== undefined) {
    const { targets: lt, ...lrest } = applies.spells ?? {};
    const only = change.kind === 'increase' && change.mana === undefined && change.generic === undefined && change.times === undefined && applies.abilities === undefined && applies.self !== true;
    if (!only || inside !== '' || applies.caster !== 'opponent' || lt === undefined || !('ref' in lt) || lt.ref !== 'self' || Object.keys(lrest).length > 0) throw new NoRenderer('a life increase other than of spells your opponents cast that target ~');
    return `spells your opponents cast that target ${K.obj({ ref: 'self' }, st, 'object').text} cost an additional ${change.life} life to cast`;
  }
  const { amount, per } = costAmount(change, st);
  // FAST4 T32: "Each spell costs {3} more to cast except during its controller's turn" (CR 601.2f, 102.1): every spell whose controller (its caster, CR
  // 601.2a) is not the active player
  if (applies.spells !== undefined && applies.caster === 'any' && change.kind === 'increase' && per === '' && inside === '' && sameShape(applies.spells, { not: { controller: { ref: 'active' } } })) {
    return `each spell costs ${amount} more to cast except during its controller's turn`;
  }
  const word = change.kind === 'increase' ? 'more' : change.kind === 'reduce' ? 'less' : '';
  if (applies.self === true) {
    const self = K.obj({ ref: 'self' }, st, 'subject').text;
    if (change.kind === 'set') return `${self} costs ${amount} to cast`;
    const whereX = countWhereX(change, st);
    // edh-cast-7 (CR 601.2f, 119.1, 103.4; family cost-less-life-difference): the reduction by how far your life total is below your starting life total is "the difference"
    // after the condition that says so ("If your life total is less than your starting life total, ~ costs {X} less to cast, where X is the difference.", Shadow of Mortality)
    const diff = isLifeDifference(change.generic) ? `${self} costs {X} ${word} to cast, where X is the difference` : null;
    // edh-next-9 (CR 119.3, 601.2f; Licia, Sanguine Tribune): "This spell costs {1} less to cast for each 1 life you gained this turn." (a spell's own reduction only)
    const gained = isMath(change.generic) && change.generic.op === '*' && change.generic.args.length === 2 && typeof change.generic.args[0] === 'number' && sameShape(change.generic.args[1], { q: 'lifeGainedThisTurn' }) && change.mana === undefined && change.times === undefined
      ? `${self} costs {${change.generic.args[0]}} ${word} to cast for each 1 life you gained this turn` : null;
    if (gained !== null) return alt(`${self} costs ${amount} ${word} to cast${per}`, gained);
    return whereX === null ? (diff === null ? `${self} costs ${amount} ${word} to cast${per}` : alt(`${self} costs ${amount} ${word} to cast${per}`, diff)) : alt(`${self} costs ${amount} ${word} to cast${per}`, `${self} costs {X} ${word} to cast, where X is ${whereX}`);
  }
  // std-rh (CR 116.2m, 709.5e): "Unlock costs you pay cost {1} less", the special action that unlocks a door of a Room
  if (applies.unlock === true) {
    if (applies.caster !== 'you' || change.kind !== 'reduce' || per !== '' || inside !== '' || change.floor === 'one') throw new NoRenderer('an unlock cost change other than a plain reduction for you');
    return `unlock costs you pay cost ${amount} less`;
  }
  // edh-next-124 (CR 602.2, 601.2f, 605.1a; Tezzeret, Betrayer of Flesh): "The first activated ability of an artifact you activate each turn costs {2} less to activate." (statics/costmods.ts#firstOfTypeKind)
  const firstType = applies.firstEachTurn === true && applies.abilities?.keyword === undefined ? firstOfTypeSource(applies) : null;
  if (firstType !== null) {
    if (applies.caster !== 'you' || change.kind !== 'reduce' || per !== '' || inside !== '' || change.floor !== undefined || change.times !== undefined) throw new NoRenderer('a first-of-a-type cost change other than a plain reduction for you');
    const noun = firstType.toLowerCase();
    return `the first activated ability of ${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun} you activate each turn costs ${amount} less to activate`;
  }
  // std-rx27 (CR 602.2b, 118.9): "you may pay {0} rather than pay the equip cost of the first equip ability you activate each turn" (statics/costmods.ts)
  if (applies.firstEachTurn !== undefined) {
    const kw = applies.abilities?.keyword;
    const free = change.kind === 'set' && (change.mana ?? []).length === 0 && change.generic === undefined && change.times === undefined && Object.keys(change).length <= 2;
    if (kw === undefined || applies.abilities?.kind !== 'activated' || applies.abilities.source !== undefined || applies.caster !== 'you' || !free || inside !== '') {
      throw new NoRenderer('a first-each-turn cost change other than "pay {0} rather than pay the <keyword> cost of the first <keyword> ability you activate each turn"');
    }
    // edh-next-117 (CR 702.29a; Gavi, Nest Warden): cycling a card is activating its cycling ability; Oracle says "the cycling cost of the first card you cycle each turn"
    const cycle = kw === 'cycling' && applies.firstEachTurn === true;
    return `you may pay ${alt('{0}', 'nothing')} rather than pay the ${kw} cost of the first ${cycle ? 'card you cycle' : `${kw} ability you activate`} ${applies.firstEachTurn === 'yourTurns' ? 'during each of your turns' : 'each turn'}`; // family pay-zero-nothing
  }
  if (applies.abilities) {
    // FAST5 T60: "exhaust abilities", the activated abilities with a wrapper keyword (CR 702.177a)
    const kind = applies.abilities.keyword !== undefined ? applies.abilities.keyword : applies.abilities.kind === 'loyalty' ? 'loyalty' : applies.abilities.kind === 'mana' ? 'mana' : 'activated';
    // std-rx28 (CR 201.3, 607.2d): "of sources with the chosen name" (Skyseer's Chariot), the objects of that name in every zone (as std-rx6's restriction says them)
    const sf = applies.abilities.source;
    const named = sf !== undefined && sf.zone === 'any' && sf.chosen?.quality === 'cardName' && Object.keys(sf).every((k) => k === 'zone' || k === 'chosen');
    if (sf?.zone === 'any' && !named) throw new NoRenderer('activated abilities of objects in every zone other than the sources with the chosen name');
    const src = named ? ` of ${alt('sources with the chosen name', 'sources with that name')}` : sf ? ` of ${K.np(sf, st, { det: 'none', plural: JSON.stringify(sf) !== '{"attachedToSource":true}' /* edh-next-34: the one creature an Aura enchants is singular */ })}` : ''; // family chosen-name-or-that-name
    const floor = change.floor === 'one' ? `. this effect can't reduce the mana in that ${alt('cost', "ability's activation cost")} to less than one mana` : ''; // r3-cost; edh-next-58 (family activation-cost-floor-ability-words; Convergence of Dominion)
    // r4-cost (CR 601.2c, 602.2b, 702.6a): "Equip abilities you activate that target ~ cost {2} less to activate": applied once if the ability targets this object
    const t = change.times;
    const targetsSelf = t !== undefined && isMath(t) && t.op === 'min' && t.args[0] === 1 && typeof t.args[1] === 'object' && t.args[1].q === 'spellTargetCount' && JSON.stringify(t.args[1].filter) === JSON.stringify({ self: true });
    // p2-cost-statics-2 (CR 115.9b, 602.2b, 601.2f): "Abilities your opponents activate that target a Merfolk you control cost {2} more to activate": applied once if one of
    // the ability's targets is an object of the description (every activated ability, of any object)
    const targetsF = t !== undefined && isMath(t) && t.op === 'min' && t.args[0] === 1 && typeof t.args[1] === 'object' && t.args[1].q === 'spellTargetCount' && t.args[1].filter !== undefined && !targetsSelf ? t.args[1].filter : undefined;
    if (targetsF !== undefined && applies.caster === 'opponent' && Object.keys(applies.abilities).length === 0 && floor === '' && change.generic === undefined && (change.mana?.length ?? 0) > 0) {
      return `abilities your opponents activate that target ${K.np(targetsF, st, { det: 'a' })} cost ${amount} ${word} to activate`;
    }
    // p2-cost-statics-2 (CR 303.4, 702.6a, 602.2b): "Equip abilities you activate that target enchanted creature cost {3} less to activate" (Strong Back): applied once
    // if the ability targets the permanent the source is attached to
    const targetsHost = t !== undefined && isMath(t) && t.op === 'min' && t.args[0] === 1 && typeof t.args[1] === 'object' && t.args[1].q === 'spellTargetCount' && JSON.stringify(t.args[1].filter) === JSON.stringify({ attachedToSource: true });
    if (targetsHost && applies.caster === 'you' && applies.abilities.keyword !== undefined && src === '' && floor === '' && change.generic === undefined && (change.mana?.length ?? 0) > 0) {
      return `${kind} abilities you activate that target enchanted creature cost ${amount} ${word} to activate`;
    }
    if (targetsSelf && applies.caster === 'you' && applies.abilities.keyword !== undefined && src === '' && floor === '' && change.generic === undefined && (change.mana?.length ?? 0) > 0) {
      return `${kind} abilities you activate that target ${K.obj({ ref: 'self' }, st, 'object').text} cost ${amount} ${word} to activate`;
    }
    // edh-mana-keywords-3 (CR 601.2f, 602.2b, 702.6a): "Equip abilities you activate cost {2} less to activate" (Fighter Class, Bureau Headmaster): the abilities of that
    // keyword that their caster, "you", activates; every one of them, with no target to name
    if (applies.caster === 'you' && applies.abilities.keyword !== undefined && src === '' && floor === '' && (t === undefined ? per === '' : per !== '' /* edh-next-58: "... cost {1} less to activate for each Dragon you control" */) && change.generic === undefined && (change.mana?.length ?? 0) > 0) {
      // edh-c-1 (family equip-costs-you-pay; Auriok Steelshaper): the equip abilities you activate are also said "equip costs you pay"
      const text = `${kind} abilities you activate cost ${amount} ${word} to activate${per}`;
      return kind === 'equip' && word === 'less' ? alt(text, `equip costs you pay cost ${amount} less`) : text;
    }
    // edh-next-58 (CR 601.2f, 602.2b, 702.6a; Bladehold War-Whip): "Equip abilities you activate of other Equipment cost {1} less to activate": the abilities of that keyword their caster,
    // "you", activates, of the other permanents of a description (no controller named)
    if (applies.caster === 'you' && applies.abilities.keyword !== undefined && sf?.other === true && sf.controller === undefined && !named && floor === '' && per === '' && t === undefined && change.kind === 'reduce') {
      return `${kind} abilities you activate${src} cost ${amount} less to activate`;
    }
    // edh-cast-6 (CR 602.2, 605.1a, 601.2f; Zirda, the Dawnwaker): "Abilities you activate that aren't mana abilities cost {2} less to activate. This effect can't reduce the mana in that
    // cost to less than one mana.": every ability its player activates but a mana ability
    // edh-c-84 (CR 601.2f, 602.2b, 605.1a, 201.3, 607.2d; Anointed Peacekeeper): "Activated abilities of sources with the chosen name cost {2} more to activate unless they're mana abilities":
    // an increase for every player's activations of the sources of that name, but not their mana abilities
    // edh-d-15 (Suppression Field): with no source description, every activated ability of every object (loyalty abilities too, CR 606.1)
    if (applies.abilities.exceptMana === true && (named || sf === undefined) && applies.caster === 'any' && change.kind === 'increase' && kind === 'activated' && applies.abilities.keyword === undefined && per === '' && t === undefined && floor === '' && change.generic === undefined && (change.mana?.length ?? 0) > 0) {
      return `activated abilities${src} cost ${amount} more to activate unless they're mana abilities`;
    }
    if (applies.abilities.exceptMana === true) {
      if (applies.caster !== 'you' || applies.abilities.kind !== undefined || applies.abilities.keyword !== undefined || src !== '' || per !== '' || t !== undefined || change.kind !== 'reduce' || change.generic !== undefined || (change.mana?.length ?? 0) === 0) {
        throw new NoRenderer('a cost change of the abilities that are not mana abilities other than a plain reduction for you');
      }
      return `abilities you activate that aren't mana abilities cost ${amount} less to activate${floor}`;
    }
    const plain = `${kind} abilities${src} cost ${amount} ${word} to activate${per}${floor}`.replace('  ', ' ');
    // edh-next-58 (CR 303.4, 602.1, 601.2f; family enchanted-object-possessive; Power Artifact): the abilities of the permanent an Aura enchants are also said "enchanted artifact's activated
    // abilities cost {2} less to activate" (what the Aura enchants is its own "enchant" keyword's business, so the noun is the Aura's)
    if (applies.abilities.keyword === undefined && kind === 'activated' && JSON.stringify(sf) === '{"attachedToSource":true}' && floor !== '' && per === '' && change.kind === 'reduce' && applies.caster === 'any') {
      return alt(plain, `enchanted artifact's activated abilities cost ${amount} less to activate${floor}`);
    }
    // std-rx15 (CR 702.6a, 602.2b; family self-keyword-abilities-possessive): "~'s equip abilities cost {2} less to activate", the abilities of the object itself said
    // with its possessive
    if (applies.abilities.keyword !== undefined && floor === '' && per === '' && JSON.stringify(applies.abilities.source) === JSON.stringify({ self: true })) {
      return alt(plain, `${K.obj({ ref: 'self' }, st, 'possessive').text} ${kind} abilities cost ${amount} ${word} to activate`);
    }
    // edh-c-59 (CR 702.6a, 601.2f, 602.2b; Ghostfire Blade): "~'s equip ability costs {2} less to activate if it targets a colorless creature": the one equip ability of the object itself, singular
    if (applies.abilities.keyword !== undefined && floor === '' && per !== '' && change.generic === undefined && JSON.stringify(applies.abilities.source) === JSON.stringify({ self: true })) {
      return `${K.obj({ ref: 'self' }, st, 'possessive').text} ${kind} ability costs ${amount} ${word} to activate${per}`;
    }
    return plain;
  }
  const caster = applies.caster;
  // FAST3 T11: "spells you cast from your graveyard": cast from a graveyard (CR 601.2a) and owned by you, so from your own graveyard (CR 400.3: a card in a
  // graveyard is in its owner's graveyard). Only these two words together, with "you cast"; anything else keeps the general wording below.
  const { castFrom, owner, ...others } = applies.spells ?? {};
  if (caster === 'you' && castFrom === 'graveyard' && owner === 'you') {
    const mid = inside === '' ? '' : ` ${inside}`;
    const spells = `${spellsPhrase(others, st)} you cast from your graveyard`;
    return change.kind === 'set' ? `${spells}${mid} cost ${amount} to cast` : `${spells}${mid} cost ${amount} ${word} to cast${per}`;
  }
  const who = caster === 'you' ? ' you cast' : caster === 'opponent' ? alt(' your opponents cast', ' an opponent casts') : caster === 'any' ? '' : ` ${K.player(caster as PlayerRef, st, 'subject').text} casts`;
  const mid = inside === '' ? '' : ` ${inside}`;
  // r3-cost (CR 601.2a, 400.3): "Spells your opponents cast from graveyards or from exile", "spells you cast from anywhere other than your hand": where the
  // spells are cast from follows the caster, as Oracle words it
  const zoned = castFromZones(applies.spells);
  if (zoned !== null && (caster === 'you' || caster === 'opponent')) {
    const spells = `${spellsPhrase(zoned.spells, st)}${who} ${zoned.from}`;
    return change.kind === 'set' ? `${spells}${mid} cost ${amount} to cast` : `${spells}${mid} cost ${amount} ${word} to cast${per}`;
  }
  // FAST4 T21: "spells your opponents cast that target ~ cost {2} more to cast" (CR 115.9b): the relative clause follows the caster, as Oracle words it
  const { targets: targeted, ...untargeted } = applies.spells ?? {};
  if (targeted !== undefined && (caster === 'you' || caster === 'opponent') && 'ref' in targeted && targeted.ref === 'self' && Object.keys(untargeted).length === 0) {
    const spells = `${spellsPhrase({}, st)}${who} that target ${K.obj({ ref: 'self' }, st, 'object').text}`;
    return change.kind === 'set' ? `${spells}${mid} cost ${amount} to cast` : `${spells}${mid} cost ${amount} ${word} to cast${per}`;
  }
  // p2-cost-statics-2 (CR 115.9b, 601.2f; family target-a-or-one-or-more): "spells your opponents cast that target a creature or planeswalker you control": one of the
  // spell's targets is an object of the description, which is also "that target one or more <objects>"; of "you", the spells you cast are the spells you control
  // as they are cast (CR 601.2a, family spells-you-cast-control)
  if (targeted !== undefined && (caster === 'you' || caster === 'opponent') && 'ref' in targeted && targeted.ref === 'each' && 'filter' in targeted && change.kind !== 'set') {
    const f = targeted.filter;
    // Strong Back (CR 303.4): "Aura spells you cast that target enchanted creature": the permanent the source is attached to
    const host = JSON.stringify(f) === JSON.stringify({ attachedToSource: true });
    // edh-next-58 (CR 115.1, 601.2c; Monastery Siege): or the modifier's controller: "that target you or a permanent you control"
    const whom = applies.orTargetsYou === true ? `you or ${K.np(f, st, { det: 'a' })}` : host ? 'enchanted creature' : alt(K.np(f, st, { det: 'a' }), `one or more ${K.np(f, st, { det: 'none', plural: true })}`);
    const by = caster === 'you' && !host ? alt(' you cast', ' you control') : who;
    return `${spellsPhrase(untargeted, st)}${by} that target ${whom}${mid} cost ${amount} ${word} to cast${per}`;
  }
  // r4-cost (CR 715.1, 601.2f): "Permanent spells you cast that have an Adventure cost {1} less to cast": the relative clause follows the caster, as Oracle words it
  const { adventure, ...plainSpells } = applies.spells ?? {};
  if (adventure === true && caster === 'you' && inside === '' && change.kind !== 'set') return `${spellsPhrase(plainSpells, st)} you cast that have an adventure cost ${amount} ${word} to cast${per}`;
  // p2-exile-play-1 (CR 601.2f, 205.2a, 607.2a; Semblance Anvil): "Spells you cast that share a card type with the exiled card cost {2} less to cast": the relative
  // clause follows the caster, as Oracle words it
  const { sharesWith: sw, ...unshared } = applies.spells ?? {};
  if (sw !== undefined && sw.other === undefined && caster === 'you' && inside === '' && change.kind !== 'set') {
    if (sw.quality === 'manaValue') throw new NoRenderer('a cost change for spells that share a mana value');
    if (sw.quality === 'permanentType') throw new NoRenderer('a cost change for spells that share a permanent type (edh-zones-10 words it for a filter of permanents only)');
    if (sw.quality === 'otherSpellType') throw new NoRenderer('a cost change for spells of the other type (edh-d-96 words it for a target card only)');
    const quality = { cardType: 'a card type', color: 'a color', creatureType: 'a creature type', landType: 'a land type', name: 'a name' }[sw.quality];
    return `${spellsPhrase(unshared, st)} you cast that share ${quality} with ${K.obj(sw.with, st, 'object').text} cost ${amount} ${word} to cast${per}`;
  }
  // edh-b-12 (CR 108.3, 601.2f; Gonti, Canny Acquisitor): "Spells you cast but don't own cost {1} less to cast": the spells of the caster that another player owns
  if (caster === 'you' && inside === '' && change.kind !== 'set' && sameShape(applies.spells ?? {}, { stackKind: 'spell', zone: 'stack', not: { owner: 'you' } })) {
    return `spells you cast but don't own cost ${amount} ${word} to cast${per}`;
  }
  const spells = spellsPhrase(applies.spells ?? {}, st);
  const text = change.kind === 'set' ? `${spells}${who}${mid} cost ${amount} to cast` : `${spells}${who}${mid} cost ${amount} ${word} to cast${per}`;
  // FAST4 T32: "Colorless spells you cast with mana value 7 or greater cost {1} less to cast": Oracle puts "you cast" before the mana value (CR 202.3)
  const { manaValue: mv, ...withoutMv } = applies.spells ?? {};
  // edh-cast-6 (Thryx, the Sudden Storm): also of spells of any kind, "Spells you cast with mana value 5 or greater cost {1} less to cast"
  // edh-next-141 (CR 601.2f, 202.3; Reidane, God of the Worthy): and of the spells your opponents cast, "Noncreature spells your opponents cast with mana value 4 or greater cost {2} more to cast"
  const mvReading = mv !== undefined && (caster === 'you' || caster === 'opponent') && inside === '' && change.kind !== 'set' && (mv.op === '>=' || mv.op === '<=')
    ? [`${spellsPhrase(withoutMv, st)}${who} with mana value ${K.qty(mv.value, st)} ${mv.op === '>=' ? 'or greater' : 'or less'} cost ${amount} ${word} to cast${per}`] : [];
  // Cloud std-woe (CR 105.2, 601.2f; family that-are-colors): spells of either of two colors said after the caster and the duration, "Spells you cast this turn that
  // are black and/or red cost {X} less to cast, where X is ..." (a spell of both colors is one of them too)
  const { colors: cs, ...withoutColors } = applies.spells ?? {};
  const colorReading = cs !== undefined && cs.length === 2 && caster === 'you' && change.kind !== 'set'
    ? [`${spellsPhrase(withoutColors, st)}${who}${mid} that are ${COLOR_WORD[cs[0]!]} and/or ${COLOR_WORD[cs[1]!]} cost ${amount} ${word} to cast${per}`] : [];
  // std-rx16 (CR 208.1, 601.2f; family each-spell-toughness-greater): "Each creature spell you cast with toughness greater than its power costs {1} less to cast"
  // (Doran, Besieged by Time): Oracle puts "you cast" before the comparison, and says it of each spell (singular)
  const { toughnessGreaterThanPower: tgp, ...withoutTgp } = applies.spells ?? {};
  const tgpReading = tgp === true && caster === 'you' && inside === '' && change.kind !== 'set'
    ? [`each ${K.np({ ...withoutTgp, zone: 'stack', stackKind: 'spell' }, st, { det: 'none' })} you cast with toughness greater than its power costs ${amount} ${word} to cast${per}`] : [];
  // edh-cast-1 (CR 208.1, 601.2f; Goreclaw, Terror of Qal Sisma; family spells-you-cast-with-power): "Creature spells you cast with power 4 or greater cost {2} less to
  // cast": Oracle puts "you cast" before the power comparison, as for a mana value
  const { power: pw, ...withoutPower } = applies.spells ?? {};
  const powerReading = pw !== undefined && caster === 'you' && inside === '' && change.kind !== 'set' && pw.op === '>=' && Object.keys(withoutPower).some((k) => k !== 'zone' && k !== 'stackKind')
    ? [`${spellsPhrase(withoutPower, st)} you cast with power ${K.qty(pw.value, st)} or greater cost ${amount} ${word} to cast${per}`] : [];
  // edh-cast-1 (CR 105.2, 601.2f; Goblin Anarchomancer; family each-spell-that-is): "Each spell you cast that's red or green costs {1} less to cast": the colors said after "each
  // spell you cast", singular
  const eachReading = caster === 'you' && inside === '' && change.kind !== 'set' && cs !== undefined && cs.length === 2 && Object.keys(withoutColors).every((k) => k === 'zone' || k === 'stackKind')
    ? [`each spell you cast that is ${COLOR_WORD[cs[0]!]} or ${COLOR_WORD[cs[1]!]} costs ${amount} ${word} to cast${per}`] : [];
  // edh-cast-9 (CR 205.3m, 601.2f; Ancient Cellarspawn; family each-spell-that-is-subtypes): "Each spell you cast that's a Demon, Horror, or Nightmare costs {1} less to cast":
  // the spells that have any of three (or more) subtypes, said of each spell with the subtypes after "you cast"
  const { subtypes: sts, ...withoutSubtypes } = applies.spells ?? {};
  const eachSubtypesReading = caster === 'you' && inside === '' && change.kind !== 'set' && sts !== undefined && sts.length >= 3 && sts.length <= 5 && Object.keys(withoutSubtypes).every((k) => k === 'zone' || k === 'stackKind')
    ? [`each spell you cast that's ${/^[aeiou]/i.test(sts[0]!) ? 'an' : 'a'} ${sts.slice(0, -1).join(', ')}, or ${sts.at(-1)!} costs ${amount} ${word} to cast${per}`] : [];
  // edh-b-6 (CR 601.2f, 702.19b; Pollywog Symbiote): "Each creature spell you cast costs {1} less to cast if it has mutate": the spells that have the keyword, said of each spell with the
  // keyword after the cost change
  const { keyword: kwd, ...withoutKeyword } = applies.spells ?? {};
  const eachKeywordReading = kwd !== undefined && typeof kwd === 'string' && caster === 'you' && inside === '' && change.kind !== 'set'
    ? [`each ${K.np({ ...withoutKeyword, zone: 'stack', stackKind: 'spell' }, st, { det: 'none' })} you cast costs ${amount} ${word} to cast${per} if it has ${kwd}`] : [];
  // edh-next-58 (CR 601.2c, 601.2f; Battlefield Thaumaturge; family each-spell-types-and): "Each instant and sorcery spell you cast costs {1} less to cast for each creature it targets":
  // the card types of the spells joined by "and", said of each spell (singular)
  const eachTypesReading = caster === 'you' && inside === '' && change.kind === 'reduce' && per.endsWith(' it targets') && applies.spells?.types !== undefined && applies.spells.types.length === 2
    && Object.keys(applies.spells).filter((k) => (applies.spells as Record<string, unknown>)[k] !== undefined).every((k) => k === 'types' || k === 'zone' || k === 'stackKind')
    ? [`each ${applies.spells.types.map((t) => t.toLowerCase()).join(' and ')} spell you cast costs ${amount} ${word} to cast${per}`] : [];
  if (mvReading.length + colorReading.length + tgpReading.length + powerReading.length + eachReading.length + eachSubtypesReading.length + eachKeywordReading.length + eachTypesReading.length > 0) return alt(text, ...mvReading, ...colorReading, ...tgpReading, ...powerReading, ...eachReading, ...eachSubtypesReading, ...eachKeywordReading, ...eachTypesReading);
  // CLOUD C5 (CR 607.2d): "Creature spells you cast of the chosen type cost {1} less to cast": Oracle puts "you cast" before the chosen quality (Herald's Horn, Umori)
  const { chosen, ...withoutChosen } = applies.spells ?? {};
  // edh-c-84 (CR 601.2f, 201.3, 607.2d; Anointed Peacekeeper): "Spells your opponents cast with the chosen name cost {2} more to cast": Oracle puts the name after "your opponents cast"
  if (chosen !== undefined && chosen.quality === 'cardName' && caster === 'opponent' && inside === '' && change.kind === 'increase') {
    return `${spellsPhrase(withoutChosen, st)} your opponents cast with the chosen name cost ${amount} ${word} to cast${per}`;
  }
  if (chosen !== undefined && caster === 'you' && inside === '' && change.kind !== 'set') {
    const after = chosen.quality === 'color' ? 'of the chosen color' : 'of the chosen type';
    return alt(text, `${spellsPhrase(withoutChosen, st)} you cast ${after} cost ${amount} ${word} to cast${per}`);
  }
  return text;
}

/**
 * FAST4 T32: "The first instant or sorcery spell you cast each turn costs {3} less to cast" (CR 601.2f, 601.2i): the change applies `mana` max(0, 1 - n) times,
 * where n is the number of spells of that kind you cast before this one this turn (the spell being cast is not cast yet when its cost is determined, so it
 * is not counted). The history's spell filter must be the modifier's own filter (without the stack words), so the two describe the same spells.
 */
function firstSpellEachTurn(e: Extract<StaticEffect, { s: 'costMod' }>, st: RenderState, inside: string): string | null {
  const { applies, change } = e;
  let t = change.times;
  if (inside !== '' || applies.spells === undefined || applies.caster !== 'you' || change.kind === 'set' || change.generic !== undefined || !change.mana || change.mana.length === 0) return null;
  // std-rx32 (CR 601.2f, 118.7): "... costs {U} less to cast for each land you control with a flood counter on it" (Eluge, the Shoreless Sea): the first-spell
  // factor times a count, said with "for each"
  let per = '';
  if (isMath(t) && t.op === '*' && t.args.length === 2 && typeof t.args[1] === 'object' && (t.args[1].q === 'count' || t.args[1].q === 'counters')) { // edh-next-67: or the counters on an object (Zimone)
    per = perText(t.args[1], st) ?? '';
    if (per === '') return null;
    t = t.args[0];
  }
  if (!isMath(t) || t.op !== 'max' || t.args.length !== 2 || t.args[0] !== 0) return null;
  const d = t.args[1];
  if (!isMath(d) || d.op !== '-' || d.args.length !== 2 || d.args[0] !== 1) return null;
  const h = d.args[1];
  if (typeof h !== 'object' || h.q !== 'happenedCount' || h.scope !== 'turn' || h.by !== undefined || h.per !== undefined) return null;
  const ev = h.event;
  if (ev.ev !== 'cast' || ev.player !== 'you' || Object.keys(ev).some((k) => k !== 'ev' && k !== 'player' && k !== 'spell')) return null;
  const { stackKind, zone, ...kind } = applies.spells;
  if ((stackKind !== undefined && stackKind !== 'spell') || (zone !== undefined && zone !== 'stack') || !sameShape(ev.spell ?? {}, kind) || Object.keys(sortedJson(kind) as object).length === 0) return null;
  // edh-next-67 (CR 107.3, 601.2f; Zimone, Infinite Analyst): "the first spell you cast with {X} in its mana cost each turn" (the quality after "you cast")
  const onlyX = Object.keys(kind).length === 1 && kind.manaCostHasX === true;
  const spell = onlyX ? 'spell' : K.np({ ...kind, zone: 'stack', stackKind: 'spell' }, st, { det: 'none' });
  if (onlyX) return `the first spell you cast with {x} in its mana cost each turn costs ${formatManaCost(change.mana)} ${change.kind === 'increase' ? 'more' : 'less'} to cast${per}`;
  return `the first ${spell} you cast each turn costs ${formatManaCost(change.mana)} ${change.kind === 'increase' ? 'more' : 'less'} to cast${per}`;
}

/**
 * edh-next-67 (CR 601.2f, 602.2b, 115.1; Professor Hojo): "The first activated ability you activate [during your turn] that targets a creature you control costs {2} less to activate": the
 * change applies `mana` min(1, the targets that are creatures you control) times max(0, 1 - n), n the abilities you activated this turn that targeted such a creature
 * (`activate.targetsYourCreature`, triggers/history.ts). The "during your turn" is the static ability's own condition (render/abil.ts says it in Oracle's place).
 */
function firstTargetingAbility(e: Extract<StaticEffect, { s: 'costMod' }>, st: RenderState, inside: string): string | null {
  const { applies, change } = e;
  const a = applies.abilities;
  if (inside !== '' || a === undefined || a.kind !== 'activated' || a.source !== undefined || a.keyword !== undefined || a.exceptMana !== undefined || applies.caster !== 'you' || applies.spells !== undefined) return null;
  if (change.kind !== 'reduce' || change.generic !== undefined || !change.mana || change.mana.length === 0 || change.floor !== 'zero' || change.times === undefined) return null;
  const t = change.times;
  if (!isMath(t) || t.op !== '*' || t.args.length !== 2) return null;
  const [tg, first] = t.args;
  if (!isMath(tg) || tg.op !== 'min' || tg.args.length !== 2 || tg.args[0] !== 1) return null;
  const sc = tg.args[1];
  if (typeof sc !== 'object' || sc.q !== 'spellTargetCount' || sc.filter === undefined || !sameShape(sc.filter, { types: ['Creature'], controller: 'you' })) return null;
  if (!isMath(first) || first.op !== 'max' || first.args.length !== 2 || first.args[0] !== 0) return null;
  const d = first.args[1];
  if (!isMath(d) || d.op !== '-' || d.args.length !== 2 || d.args[0] !== 1) return null;
  const h = d.args[1];
  if (typeof h !== 'object' || h.q !== 'happenedCount' || h.scope !== 'turn' || h.by !== undefined || h.per !== undefined) return null;
  const ev = h.event;
  if (ev.ev !== 'activate' || ev.player !== 'you' || ev.targetsYourCreature !== true || Object.keys(ev).some((k) => k !== 'ev' && k !== 'player' && k !== 'targetsYourCreature')) return null;
  return `the first activated ability you activate that targets a creature you control costs ${formatManaCost(change.mana)} less to activate`;
}

/**
 * FAST5 T63 (CR 601.2f, 601.2i, 601.3b, 611.3a): "The first creature spell you cast each turn costs {2} less to cast and can be cast as though it had flash",
 * "The first non-Lemur creature spell with flying you cast during each of your turns costs {1} less to cast". The static ability holds while you have not cast a
 * spell of that kind this turn (the spell being cast is not cast yet when its cost and its timing are determined, so it is the first exactly then), and, for the
 * second wording, only on your turn. Its effects are the cost reduction of those spells (a fixed mana amount) and, for the first wording, the permission to cast
 * them as though they had flash. The spell filter of the history, of the reduction and of the permission must be one and the same. Null for any other shape.
 */
export function firstSpellStatic(def: { condition?: Condition; effects: readonly StaticEffect[] }, st: RenderState): string | null {
  const c = def.condition;
  if (c === undefined || def.effects.length < 1 || def.effects.length > 2) return null;
  let notCast: Condition | undefined = c;
  let yourTurns = false;
  if (c.cond === 'all') {
    const t = c.of[0];
    if (c.of.length !== 2 || t?.cond !== 'turnOf' || t.whose !== 'you' || t.step !== undefined) return null;
    yourTurns = true;
    notCast = c.of[1];
  }
  if (notCast?.cond !== 'not' || notCast.of.cond !== 'happened') return null;
  const h = notCast.of;
  const ev = h.event;
  if (h.scope !== 'turn' || h.times !== undefined || h.by !== undefined || ev.ev !== 'cast' || ev.player !== 'you' || ev.spell === undefined || Object.keys(ev).some((k) => k !== 'ev' && k !== 'player' && k !== 'spell')) return null;
  const [cost, flash] = def.effects;
  if (cost?.s !== 'costMod' || cost.applies.spells === undefined || cost.applies.caster !== 'you' || cost.applies.self !== undefined || cost.applies.abilities !== undefined) return null;
  const change = cost.change;
  if (change.kind !== 'reduce' || change.generic !== undefined || change.times !== undefined || !change.mana || change.mana.length === 0) return null;
  const { stackKind, zone, ...kind } = cost.applies.spells;
  if ((stackKind !== undefined && stackKind !== 'spell') || (zone !== undefined && zone !== 'stack') || !sameShape(ev.spell, kind) || Object.keys(sortedJson(kind) as object).length === 0) return null;
  if (flash !== undefined && (flash.s !== 'permit' || flash.action !== 'haveFlash' || flash.who.ref !== 'you' || flash.asThough !== undefined || flash.of === undefined || !sameShape(flash.of, cost.applies.spells)
    || Object.keys(flash).filter((k) => (flash as unknown as Record<string, unknown>)[k] !== undefined).sort().join() !== 'action,of,s,who')) return null;
  if (flash !== undefined && yourTurns) return null; // the wording with flash is the "each turn" one
  const spell = K.np({ ...kind, zone: 'stack', stackKind: 'spell' }, st, { det: 'none' });
  const when = yourTurns ? 'during each of your turns' : 'each turn';
  return `the first ${spell} you cast ${when} costs ${formatManaCost(change.mana)} less to cast${flash !== undefined ? ' and can be cast as though it had flash' : ''}`;
}

// ---------------------------------------------------------------------------
// Restrictions (CR 614.17, 508.1d)
// ---------------------------------------------------------------------------

const ACTION_CANT: Partial<Record<RuleAction, string>> = {
  attack: 'attack', block: 'block', cast: 'cast spells', activate: 'activate abilities', playLand: 'play lands', draw: 'draw cards', gainLife: 'gain life', loseLife: 'lose life',
  lose: 'lose the game', win: 'win the game', untap: 'untap', tap: 'tap', transform: 'transform', search: 'search libraries', sacrifice: 'sacrifice', discard: 'discard cards',
  beTapped: 'be tapped', beTargeted: 'be the target of spells or abilities', beCountered: 'be countered', beDestroyed: 'be destroyed', beRegenerated: 'be regenerated',
  beSacrificed: 'be sacrificed', beExiled: 'be exiled', beAttached: 'be attached', beEnchanted: 'be enchanted', beEquipped: 'be equipped', dealDamage: 'deal damage',
  receiveDamage: 'be dealt damage', preventDamage: 'be prevented', leave: 'leave the battlefield', enter: 'enter the battlefield', gainAbility: 'gain abilities', haveCountersPut: 'have counters put on them',
  payLife: 'pay life', castFromZone: 'cast spells from graveyards', spendMana: 'spend mana', beBlocked: 'be blocked', beBlockedBy: 'be blocked', attackPlayer: 'attack',
  untapDuringUntapStep: 'untap during your untap step',
  beTurnedFaceUp: 'be turned face up', // FAST5X E25 (CR 708.7)
  beSuspected: 'become suspected', // std-mkm (CR 701.60a)
  becomeMonarch: 'become the monarch', // edh-next-82 (CR 725.1)
  beCopied: 'be copied', // std-copy-1 (CR 707.10)
  phaseIn: 'phase in', // trek-4 (CR 702.26c)
  crew: 'crew Vehicles', // edh-c-72 (CR 702.122a)
  beBeamedUp: 'be beamed up', // trek-1 (Star Trek beam me up; CR 702 rule number unverified)
  haveStunCountersRemoved: 'have stun counters removed', // edh-players-22 (CR 122.1d)
};

/**
 * FAST4 T33: the words after "can't" for one action, said of one object or of several: "have counters put on it" / "on them" (CR 122.6), and "untap" or
 * "become untapped" (CR 502.3, 701.26b: one restriction on every way it untaps; family restriction).
 */
function cantWords(action: RuleAction, pl: boolean): string {
  if (action === 'haveCountersPut') return `have counters put on ${pl ? 'them' : 'it'}`;
  if (action === 'untap') return alt('untap', 'become untapped');
  return ACTION_CANT[action] ?? action;
}

/** FAST3 T16: "creatures with greater power" (than the source, CR 208.1): the blocker filter `{types:[Creature], power > ~'s power}`. */
const greaterPowerThanSelf = (f: ObjectFilter | undefined): boolean =>
  f !== undefined && JSON.stringify(f) === '{"types":["Creature"],"power":{"op":">","value":{"q":"stat","stat":"power","of":{"ref":"self"}}}}';

/** FAST3 T16: the one color of "white spells or abilities from white sources" (CR 115.1, 113.7a: an ability's color is its source's), or null. */
const onlyColor = (f: ObjectFilter | undefined): string | null =>
  f !== undefined && Object.keys(f).length === 1 && f.colors !== undefined && f.colors.length === 1 ? COLOR_WORD[f.colors[0]!] ?? null : null;

/** FAST2 T9: "can't block ~" (one attacker, the source; no limit, no condition). */
const blocksSelfOnly = (e: RestrictionDef): boolean =>
  e.mode === 'cant' && e.action === 'block' && e.max === undefined && e.when === undefined && e.other !== undefined && JSON.stringify(e.other) === '{"self":true}';

/**
 * M6-7 (design m6 3.9): the requirements that name the other creature (CR 509.1c) and the ones with a duration inside the sentence (CR 611.2a):
 *   "All creatures able to block enchanted creature do so." / "All creatures able to block target creature this turn do so." (each creature, `other` = is X)
 *   "Target creature blocks target creature this turn if able." / "Target creature blocks ~ this turn if able." (`other` = is X)
 *   "Target creature attacks this turn if able." / "Creatures your opponents control block this turn if able." (no `other`, `inside` set)
 * Null when the effect is none of these (the caller renders it as before); a filter that is not one object is refused (NoRenderer).
 */
function requirementWithOther(e: RestrictionDef, st: RenderState, inside: string | null): string | null {
  if (e.mode !== 'mustIfAble' || e.max !== undefined || e.goad === true || e.atLeastOne === true || e.allIfAny === true) return null; // Cloud C3: a static goad is said as the designation (restrictFor); edh-d-75: the at-least-one requirement too
  if (e.other === undefined) {
    if (inside === null || e.when !== undefined || (e.action !== 'attack' && e.action !== 'block')) return null;
    return withSubjects(e.subject, st, (sj, pl) => `${sj} ${e.action}${pl ? '' : 's'} ${inside} if able`);
  }
  const keys = Object.keys(e.other);
  // edh-c-45 (CR 509.1c; Noble Quarry): "All creatures able to block ~ or enchanted creature do so." (the other creature is either of two objects)
  const either = e.other.anyOf;
  if (e.action === 'block' && e.when === undefined && keys.length === 1 && keys[0] === 'anyOf' && either !== undefined && either.length === 2 && either.every((f) => Object.keys(f).length === 1 && f.is !== undefined)
    && !isPlayerRef(e.subject, st) && e.subject.ref === 'each' && 'filter' in e.subject && JSON.stringify(e.subject.filter) === '{"types":["Creature"]}') {
    return `all creatures able to block ${either.map((f) => K.obj(f.is!, st, 'object').text).join(' or ')}${inside ? ` ${inside}` : ''} do so`;
  }
  if (e.action === 'beBlocked' && e.when === undefined) return null; // edh-c-71 (CR 509.1c): "must be blocked by an Eldrazi if able" is said by restrictFor
  if (e.action !== 'block' || e.when !== undefined || keys.length !== 1 || keys[0] !== 'is' || e.other.is === undefined) throw new NoRenderer(`a filter on ${e.mode} ${e.action}`);
  const x = K.obj(e.other.is, st, 'object').text;
  const s = e.subject;
  if (!isPlayerRef(s, st) && s.ref === 'each' && 'filter' in s && JSON.stringify(s.filter) === '{"types":["Creature"]}') return `all creatures able to block ${x}${inside ? ` ${inside}` : ''} do so`;
  // edhd67 (CR 509.1c, 611.2a; You Look Upon the Tarrasque): "All creatures your opponents control able to block that creature this turn do so."
  if (!isPlayerRef(s, st) && s.ref === 'each' && 'filter' in s && JSON.stringify(s.filter) === '{"types":["Creature"],"controller":"opponent"}') return `all creatures your opponents control able to block ${x}${inside ? ` ${inside}` : ''} do so`;
  return withSubjects(s, st, (sj, pl) => `${sj} block${pl ? '' : 's'} ${x} ${inside ?? 'each combat'} if able`);
}

/**
 * MX5 (CR 502.3, 611.2a): "<it> doesn't untap during its controller's next untap step" (no player: each object's own controller), "... during your next
 * untap step", "... during that player's next untap step" (`whose`).
 */
function nextUntapRestriction(e: RestrictionDef, d: Extract<Duration, { d: 'throughNextUntap' }>, st: RenderState): string {
  return withSubjects(e.subject, st, (sj, pl) => {
    const doesnt = pl ? "don't" : "doesn't";
    if (d.whose !== undefined) {
      const step = possessiveStep('untap', d.whose, st, true);
      // edh-c-94 (CR 502.3, 611.2a; Blinding Beam): every creature, of every player, is "creatures" and also "all creatures" (family untap-lock-all-bare)
      const who = sj.startsWith('all ') ? alt(sj, sj.slice(4)) : sj;
      // edh-c-51 (CR 502.3, 611.2a; Imaginary Threats): "During that player's next untap step, creatures they control don't untap." (family untap-step-first)
      return alt(`${who} ${doesnt} untap during ${step}`, `during ${step}, ${who} ${doesnt} untap`);
    }
    const step = pl ? alt("their controller's next untap step", "their controllers' next untap steps") : "its controller's next untap step";
    const said = `${sj} ${doesnt} untap during ${step}`;
    // edh-c-46 (CR 502.3, 611.2c; Spore Cloud): the attacking and the blocking creatures, each said singular ("Each attacking creature and each blocking creature doesn't untap ...")
    const sf: Record<string, unknown> | undefined = e.subject.ref === 'each' && 'filter' in e.subject ? (e.subject.filter as unknown as Record<string, unknown>) : undefined;
    const ab = sf !== undefined && Object.keys(sf).filter((k) => sf[k] !== undefined).sort().join() === 'anyOf,types' && JSON.stringify(sf['types']) === '["Creature"]' && JSON.stringify(sf['anyOf']) === '[{"attacking":true},{"blocking":true}]';
    if (ab) return alt(said, "each attacking creature and each blocking creature doesn't untap during its controller's next untap step");
    // edh-c-15 (CR 502.3, 611.2a; family each-of-those-untap; Juvenile Mist Dragon): the several creatures an earlier instruction chose are also "each of those creatures doesn't untap during its controller's next untap step"
    if (pl && (e.subject.ref === 'target' || e.subject.ref === 'bound')) return alt(said, `each of ${sj} doesn't untap during its controller's next untap step`);
    return said;
  });
}

function restrict(e: RestrictionDef, st: RenderState): string {
  if (e.forCosts === true) throw new NoRenderer('a cost-only ban outside the pair "can\'t pay life or sacrifice ... to cast spells or activate abilities"'); // edh-next-18 (payLifeSacrificeForCosts)
  const req = requirementWithOther(e, st, null);
  if (req !== null) return req;
  const s = e.subject;
  // edh-cast-11 (CR 601.3, 101.2; Lavinia, Azorius Renegade): "Each opponent can't cast noncreature spells with mana value greater than the number of lands that player controls":
  // the description read with the casting player as `you` (`relativeToSubject`), said with "that player" where it says "you control"
  if (e.relativeToSubject === true) {
    // edh-next-12 (CR 601.3, 101.2; Dosan the Falling Leaf): "Players can cast spells only during their own turns": each player may cast only on a turn of their own
    if (e.mode === 'onlyIf' && e.action === 'cast' && JSON.stringify(s) === '{"ref":"each","who":"player"}' && e.other === undefined && JSON.stringify(e.when) === '{"cond":"turnOf","whose":"you"}'
      && Object.keys(e).filter((k) => (e as unknown as Record<string, unknown>)[k] !== undefined).length === 6) return 'players can cast spells only during their own turns';
    const keys = Object.keys(e).filter((k) => (e as unknown as Record<string, unknown>)[k] !== undefined);
    if (e.mode !== 'cant' || e.action !== 'cast' || JSON.stringify(s) !== '{"ref":"each","who":"opponent"}' || e.other === undefined || keys.length !== 6) {
      throw new NoRenderer('a restriction read for the player asked about, other than "each opponent can\'t cast [spells] ... that player controls"');
    }
    const { relativeToSubject: _rel, ...plain } = e;
    const said = restrictFor(plain as RestrictionDef, st, 'each opponent', false);
    // (the description may be said in more than one way, as an alternative group: every way says "you control" the same)
    if (!said.includes(' you control') || /\byou(?! control)\b/.test(said)) throw new NoRenderer('a casting restriction read for the casting player that says "you" other than in "you control"');
    return said.replaceAll(' you control', ' that player controls');
  }
  // std-control-1 (CR 602.5, 702.193a): "power-up abilities can't be activated": the abilities of that wrapper keyword of every object, and nothing else in it
  if (e.abilityKeyword !== undefined) {
    if (e.mode !== 'cant' || e.action !== 'activate' || e.other !== undefined || e.otherPlayer !== undefined || e.max !== undefined || e.min !== undefined || e.when !== undefined
      || e.exceptMana !== undefined || e.alone !== undefined || e.goad !== undefined || JSON.stringify(s) !== '{"ref":"each","filter":{}}') throw new NoRenderer('a keyword ability ban with more than the ban');
    // edh-players-6 (CR 606.1, 602.5; family loyalty-abilities-cant-activate): Oracle's "Players can't activate planeswalkers' loyalty abilities"
    return e.abilityKeyword === 'loyalty' ? alt("loyalty abilities can't be activated", "players can't activate planeswalkers' loyalty abilities", "players can't activate loyalty abilities") : `${e.abilityKeyword} abilities can't be activated`;
  }
  // edh-next-69 (CR 701.21a, 109.5; Sigarda, Host of Herons; sta.edhn69.cantCauseSacrifice): the sacrifice an opponent's spell or ability would make the restriction's controller do
  if (e.causedByOpponents === true) {
    if (e.mode !== 'cant' || e.action !== 'sacrifice' || JSON.stringify(s) !== '{"ref":"you"}' || Object.keys(e).length !== 5) throw new NoRenderer('a sacrifice ban caused by opponents with more than the ban');
    return alt("spells and abilities your opponents control can't cause you to sacrifice permanents", "spells and abilities each opponent controls can't cause you to sacrifice permanents"); // (family each-opponent-controls-sources-sacrifice)
  }
  // edh-zones-14 (CR 701.23a, 101.2, 109.5; Ashiok, Dream Render; the parser's sta.edhz14.cantCauseSearch.theirController): the search a player's own spell or ability (an opponent's, to the
  // restriction's controller) would make them do, nothing else in the restriction
  if (e.causedByOwn === true) {
    if (e.mode !== 'cant' || e.action !== 'search' || JSON.stringify(s) !== '{"ref":"each","who":"player"}' || JSON.stringify(e.other) !== '{"controller":"opponent"}' || Object.keys(e).length !== 6) throw new NoRenderer('a search ban caused by the searcher\'s own sources other than Ashiok\'s');
    // (family each-opponent-controls: Oracle's "your opponents control", and "each opponent controls" of the template's other wording)
    return alt("spells and abilities your opponents control can't cause their controller to search their library", "spells and abilities each opponent controls can't cause their controller to search their library");
  }
  // FAST3 T15: "Your opponents can't gain life", "Players can't gain life": each opponent / each player said as the plural group (CR 102.3, 101.2;
  // family players-plural). The restriction applies to each of them, which is what the plural group means.
  if (s.ref === 'each' && 'who' in s && (s.who === 'opponent' || s.who === 'player')) {
    const group = s.who === 'opponent' ? 'your opponents' : 'players';
    const [each, plural] = withVariants(st, [(v) => withSubjects(s, v, (sj, pl) => restrictFor(e, v, sj, pl)), (v) => restrictFor(e, v, group, true)]);
    return alt(each!, plural!);
  }
  // edh-b-12 (CR 602.5, 605.1a, 606.1; Overwhelming Splendor): "Enchanted player can't activate abilities that aren't mana abilities or loyalty abilities": a player as the subject
  if (e.mode === 'cant' && e.action === 'activate' && e.exceptMana === true && e.exceptLoyalty === true && e.other === undefined && e.max === undefined && e.when === undefined && s.ref === 'enchantedPlayer') {
    return withSubjects(e.subject, st, (sj) => `${sj} can't activate abilities that aren't mana abilities or loyalty abilities`);
  }
  // FAST4 T33: "Enchanted creature's activated abilities can't be activated" (CR 602.5, 605.1a: mana abilities too), and "... unless they're mana abilities"
  // (`exceptMana`): the ban on one object's own abilities, which statics/hooks.ts#canActivate asks with the ability's source as the subject (the words of
  // `isOwnActivateBan`; "enchanted creature can't activate abilities" is no Oracle wording)
  if (e.mode === 'cant' && e.action === 'activate' && e.other === undefined && e.max === undefined && e.when === undefined && isOneObject(s, st)) {
    const unless = e.exceptMana === true ? " unless they're mana abilities" : '';
    return `${K.obj(s as ObjRef, st, 'possessive').text} activated abilities can't be activated${unless}`;
  }
  // cloud std-spm (CR 101.2, 701.6a, 113.3b-c): "Spells and abilities can't be countered" (Spider-Punk): every object on the stack, each spell and each ability
  if (e.mode === 'cant' && e.action === 'beCountered' && e.other === undefined && e.max === undefined && e.when === undefined && s.ref === 'each' && 'filter' in s
    && Object.entries(s.filter).every(([k, v]) => v === undefined || (k === 'zone' && v === 'stack')) && s.filter.zone === 'stack') {
    return "spells and abilities can't be countered";
  }
  // std-ru (CR 508.1b, 506.3; family cant-be-attacked): "~ can't be attacked" (The Aetherspark): no creature can attack the source; only creatures attack (CR 508.1a),
  // so it is also "creatures can't attack ~". Only that ban: every creature, the source as what is attacked, nothing else
  if (isCantBeAttackedSelf(e)) {
    const self = K.obj({ ref: 'self' }, st, 'subject').text;
    return alt(`${self} can't be attacked`, `creatures can't attack ${self}`);
  }
  // std-rx6 (CR 602.5, 605.1a, 605.3): "Activated abilities of artifacts can't be activated unless they're mana abilities"; and "of sources with the chosen name"
  // (Pithing Needle, Sorcerous Spyglass: the objects of that name in every zone, CR 201.3, 113.7), a filter of nothing but the zone `any` and the chosen name
  // p2-refs-3 (CR 602.5, 605.1a, 113.7): ... and without the exception, "Activated abilities of sources with the chosen name can't be activated" (Voidstone Gargoyle:
  // mana abilities too), the same filter of nothing but the zone `any` and the chosen name
  if (e.mode === 'cant' && e.action === 'activate' && e.exceptMana === undefined && e.other === undefined && e.max === undefined && e.when === undefined && s.ref === 'each'
    && 'filter' in s && s.filter.zone === 'any' && s.filter.chosen?.quality === 'cardName' && Object.keys(s.filter).every((k) => k === 'zone' || k === 'chosen')) {
    return `activated abilities of ${alt('sources with the chosen name', 'sources with that name')} can't be activated`;
  }
  if (e.mode === 'cant' && e.action === 'activate' && e.exceptMana === true && e.other === undefined && e.max === undefined && e.when === undefined && s.ref === 'each'
    && 'filter' in s) {
    const f = s.filter;
    const sources = f.zone === 'any' && f.chosen?.quality === 'cardName' && Object.keys(f).every((k) => k === 'zone' || k === 'chosen');
    if (f.zone === 'any' && !sources) throw new NoRenderer('activated abilities of objects in every zone other than the sources with the chosen name');
    const of = sources ? alt('sources with the chosen name', 'sources with that name') : K.np(f, st, { det: 'none', plural: true }); // family chosen-name-or-that-name
    return `activated abilities of ${of} can't be activated unless they're mana abilities`;
  }
  // edh-cast-4 (CR 509.1b, 101.2; family opponents-cant-block-with): "Your opponents can't block with creatures with even mana values": the creatures an opponent controls that the
  // description fits can't block (statics/hooks.ts asks `block` of each blocker); the subject is the opponents' creatures matching the description, nothing else on the ban
  if (e.mode === 'cant' && e.action === 'block' && e.other === undefined && e.max === undefined && e.when === undefined && e.min === undefined && s.ref === 'each' && 'filter' in s) {
    const sf = s.filter;
    if (Object.keys(sf).length === 2 && sf.controller === 'opponent' && sf.anyOf?.length === 1) return `your opponents can't block with ${K.np(sf.anyOf[0]!, st, { det: 'none', plural: true })}`;
  }
  // edh-next-147 (CR 601.1, 120.3, 608.2c; Aurelia's Fury): a cast restriction whose subject is what a damage step dealt damage to names the players of it ("Players dealt
  // damage this way can't cast noncreature spells this turn"): only a player casts a spell
  const dealtPlayers = e.action === 'cast' && s.ref === 'bound' && st.info.get(`b:${s.name}`)?.thisWay === 'dealt damage this way' ? K.player(s, st, 'subject') : null;
  const base = dealtPlayers !== null ? restrictFor(e, st, dealtPlayers.text, dealtPlayers.plural) : withSubjects(e.subject, st, (sj, pl) => restrictFor(e, st, sj, pl));
  // FAST3 T15: "You have hexproof" is "You can't be the target of spells or abilities your opponents control" (CR 702.11c); "You have shroud" is "You
  // can't be the target of spells or abilities" (CR 702.18a). Only the player "you", with no limit and no condition (family player-hexproof).
  if (e.mode === 'cant' && e.action === 'beTargeted' && s.ref === 'you' && e.max === undefined && e.when === undefined) {
    const kw = e.other === undefined ? 'shroud' : JSON.stringify(e.other) === '{"controller":"opponent"}' ? 'hexproof' : null;
    if (kw !== null) return alt(base, `you have ${kw}`);
  }
  // FAST2 T7: "Activated abilities of artifacts can't be activated" (CR 602.5, 605.1a: mana abilities too): a ban on activating the abilities of each object
  // of a group, which statics/hooks.ts#canActivate asks with the ability's source as the subject
  if (e.mode === 'cant' && e.action === 'activate' && e.other === undefined && e.max === undefined && e.when === undefined && s.ref === 'each' && 'filter' in s) {
    return alt(base, `activated abilities of ${K.np(s.filter, st, { det: 'none', plural: true })} can't be activated`);
  }
  return base;
}

/** std-ru (CR 508.1b): the ban on every creature attacking the source, "~ can't be attacked" (restrict), and nothing else in it. */
function isCantBeAttackedSelf(e: StaticEffect): boolean {
  return e.s === 'restrict' && e.mode === 'cant' && e.action === 'attack' && JSON.stringify(e.subject) === '{"ref":"each","filter":{"types":["Creature"]}}'
    && JSON.stringify(e.other) === '{"self":true}' && e.max === undefined && e.min === undefined && e.when === undefined && e.otherPlayer === undefined
    && e.alone === undefined && e.goad === undefined && e.exceptMana === undefined;
}

/**
 * FAST4 T21: the timing restriction of a spell on itself ("Cast ~ only during combat before blockers are declared.", CR 601.3, 101.2; the form
 * rules/cast-restriction.ts#parseCastRestriction makes): `onlyIf` cast, subject the spell, `when` a turnOf of anyone's turn with exactly these steps.
 * Keyed by the step list joined with commas; each entry is the Oracle phrase after "only".
 */
const CAST_SELF_ONLY_STEPS: Readonly<Record<string, string>> = {
  'beginCombat,declareAttackers': 'during combat before blockers are declared', // CR 506.1, 507, 508: before the declare blockers step (CR 509)
  'beginCombat,declareAttackers,declareBlockers,combatDamage,endCombat': 'during combat', // FAST4 T32: every step of the combat phase (CR 506.1)
  // p2-combat-flow-1 (CR 509.1, 510.1, 511.1): the declare blockers step only; every step of the combat phase from it on; every step before it
  'declareBlockers': 'during the declare blockers step',
  'declareAttackers': 'during the declare attackers step', // edh-c-8 (CR 508.1; Tears of Rage)
  'declareBlockers,combatDamage,endCombat': 'during combat after blockers are declared',
  'untap,upkeep,draw,main1,beginCombat,declareAttackers': 'before combat or during combat before blockers are declared',
  // edh-cast-7 (CR 510.4, 506.1; Berserk): every step before the combat damage step (the first strike damage step is a combat damage step too, CR 510.4)
  'untap,upkeep,draw,main1,beginCombat,declareAttackers,declareBlockers': 'before the combat damage step',
};

/** p2-combat-flow-1 (CR 102.1, 102.3, 506.1): the same restrictions in a turn of the spell's caster or of an opponent ("during combat on your turn"). */
const CAST_SELF_ONLY_TURN: Readonly<Record<string, string>> = {
  'you:beginCombat,declareAttackers,declareBlockers,combatDamage,endCombat': 'during combat on your turn',
  'opponent:beginCombat,declareAttackers,declareBlockers,combatDamage,endCombat': "during combat on an opponent's turn",
  'opponent:declareBlockers': "during the declare blockers step on an opponent's turn", // edh-combat-7 (CR 509.1, 500.1; Illusionist's Gambit)
  'opponent:upkeep': "during an opponent's upkeep", // edh-c-32 (CR 503.1, 500.1; Festival)
  'you:end': 'during your end step', // edh-b-6 (CR 513.1, 601.3; Necrologia)
  // edh-d-3 (CR 500.1, 503.1, 601.3; Reset): every step of an opponent's turn after the upkeep step (the untap step has no priority, CR 502.4; the cleanup step only when triggers or state-based actions appear, CR 514.3a)
  'opponent:draw,main1,beginCombat,declareAttackers,declareBlockers,combatDamage,endCombat,main2,end,cleanup': "during an opponent's turn after their upkeep step",
};

/**
 * FAST4 T32: "You can't cast ~ unless there are seven or more cards in your graveyard" (CR 601.3, 101.2): an `onlyIf` cast restriction of the spell on itself
 * whose condition is not a turn and step (those are `castSelfOnly`). "You" is whoever casts it (the spell's controller, CR 601.2a).
 */
function castSelfUnless(e: RestrictionDef, sj: string, st: RenderState): string | null {
  if (sj === '' || e.mode !== 'onlyIf' || e.action !== 'cast' || e.subject.ref !== 'self' || e.other !== undefined || e.otherPlayer !== undefined || e.max !== undefined) return null;
  if (e.when === undefined || e.when.cond === 'turnOf') return null;
  const c = K.cond(e.when, st);
  // std-rl (CR 601.3; family cast-only-if): Oracle also says it "Cast ~ only if <condition>." (Twice Upon a Time, Talara's Battalion)
  return alt(`you can't cast ${sj} unless ${c}`, `cast ${sj} only if ${c}`);
}

/**
 * std-r9: "You can't cast ~ during your first, second, or third turns of the game." (CR 601.3, 101.2, 500.7): a `cant` cast restriction of the spell on itself
 * while it is your turn and no more than three of your turns have begun (`turnsBegun`, extra turns included). Only the three-turn wording is printed in Standard;
 * any other count has no renderer (manual).
 */
function castSelfFirstTurns(e: RestrictionDef, sj: string): string | null {
  if (sj === '' || e.mode !== 'cant' || e.action !== 'cast' || e.subject.ref !== 'self' || e.other !== undefined || e.otherPlayer !== undefined || e.max !== undefined) return null;
  if (!sameShape(e.when, { cond: 'all', of: [{ cond: 'turnOf', whose: 'you' }, { cond: 'compare', left: { q: 'turnsBegun' }, op: '<=', right: 3 }] })) return null;
  return `you can't cast ${sj} during your first, second, or third turns of the game`;
}

/** FAST4 T32: "can't cast spells from anywhere other than their hands" (CR 601.2a, 601.3): a "can't cast" of every spell not cast from a hand. */
const castOnlyFromHand = (e: RestrictionDef): boolean =>
  e.mode === 'cant' && e.action === 'cast' && e.max === undefined && e.when === undefined && e.other !== undefined && sameShape(e.other, { not: { castFrom: 'hand' } });

function castSelfOnly(e: RestrictionDef, sj: string): string | null {
  if (sj === '' || e.mode !== 'onlyIf' || e.action !== 'cast' || e.subject.ref !== 'self' || e.other !== undefined || e.otherPlayer !== undefined || e.max !== undefined) return null;
  const w = e.when;
  if (w?.cond === 'turnOf' && w.step === undefined && w.whose === 'you') return `cast ${sj} only during your turn`; // edh-d-34 (CR 601.3, 102.1; Seedtime): any step of your own turn
  if (w?.cond !== 'turnOf' || w.step === undefined) return null;
  const steps = [w.step].flat().join(',');
  const phrase = w.whose === 'any' ? CAST_SELF_ONLY_STEPS[steps] : typeof w.whose === 'string' ? CAST_SELF_ONLY_TURN[`${w.whose}:${steps}`] : undefined;
  return phrase === undefined ? null : `cast ${sj} only ${phrase}`;
}

/** FAST5 T36: the two halves of "Cast ~ only during the declare attackers step and only if you've been attacked this step" (CR 601.3, 506.3): the step, and an attack on you in this combat. */
const ATTACKED_STEP_WHEN = [
  { cond: 'turnOf', whose: 'any', step: ['declareAttackers'] },
  { cond: 'happened', event: { ev: 'attacks', defender: 'you' }, scope: 'combat' },
];

function castSelfAttackedStep(e: RestrictionDef, sj: string): string | null {
  if (sj === '' || e.mode !== 'onlyIf' || e.action !== 'cast' || e.subject.ref !== 'self' || e.other !== undefined || e.otherPlayer !== undefined || e.max !== undefined) return null;
  if (e.when?.cond !== 'all' || !sameShape(e.when.of, ATTACKED_STEP_WHEN)) return null;
  return `cast ${sj} only during the declare attackers step and only if you have been attacked this step`;
}

/**
 * edh-d-89 (CR 601.3, 508.1, 500.8; Master Warcraft, ruling 2013-09-20): "Cast ~ only before attackers are declared": a step before the declare attackers step of anyone's turn AND no declare
 * attackers step has begun this turn yet (with additional combat phases, only before the first one's).
 */
const BEFORE_FIRST_ATTACKERS_WHEN = [
  { cond: 'turnOf', whose: 'any', step: ['untap', 'upkeep', 'draw', 'main1', 'beginCombat'] },
  { cond: 'not', of: { cond: 'happened', event: { ev: 'step', step: 'declareAttackers' }, scope: 'turn' } },
];

function castSelfBeforeAttackers(e: RestrictionDef, sj: string): string | null {
  if (sj === '' || e.mode !== 'onlyIf' || e.action !== 'cast' || e.subject.ref !== 'self' || e.other !== undefined || e.otherPlayer !== undefined || e.max !== undefined) return null;
  if (e.when?.cond !== 'all' || !sameShape(e.when.of, BEFORE_FIRST_ATTACKERS_WHEN)) return null;
  return `cast ${sj} only before attackers are declared`;
}

/** r5-static: as statics/hooks.ts#isDeclarationLimit (render/ may not import statics/). */
const isDeclarationLimit = (r: RestrictionDef): boolean =>
  r.mode === 'cant' && typeof r.max === 'number' && (r.action === 'attack' || r.action === 'attackPlayer' || r.action === 'block')
  && r.alone === undefined && r.onlyAlone === undefined && r.min === undefined && r.goad === undefined && r.exceptMana === undefined;

function declarationLimitText(e: RestrictionDef): string {
  const n = e.max!;
  if (JSON.stringify(e.subject) !== '{"ref":"each","filter":{"types":["Creature"]}}' || e.when !== undefined || !Number.isInteger(n) || n < 1) throw new NoRenderer('a declaration limit on other creatures');
  const who = `no more than ${numWord(n)} ${n === 1 ? 'creature' : 'creatures'} can`;
  if (e.action === 'block') {
    if (e.other !== undefined || e.otherPlayer !== undefined) throw new NoRenderer('a block limit that names what is blocked');
    return `${who} block each combat`;
  }
  if (e.action === 'attackPlayer') {
    if (e.other !== undefined || JSON.stringify(e.otherPlayer) !== '{"ref":"you"}') throw new NoRenderer('an attack limit on another player');
    return `${who} attack you each combat`;
  }
  if (e.otherPlayer !== undefined) throw new NoRenderer('an attack limit that names a player');
  if (e.other === undefined) return `${who} attack each combat`;
  if (JSON.stringify(e.other) !== '{"self":true}') throw new NoRenderer('an attack limit on another object');
  return `${who} attack ~ each combat`;
}

function restrictFor(e: RestrictionDef, st: RenderState, sj: string, pl: boolean): string {
  // Cloud C3 (batch 3): a static goad is the designation, said as Oracle says it ("enchanted creature is goaded", CR 701.15a-c); its one form only
  if (e.goad === true) {
    if (e.mode !== 'mustIfAble' || e.action !== 'attack' || e.other !== undefined || e.otherPlayer !== undefined || e.max !== undefined || e.min !== undefined
      || e.alone !== undefined || e.exceptMana !== undefined || e.when !== undefined) throw new NoRenderer('a static goad with more than the designation');
    return `${sj} ${pl ? 'are' : 'is'} goaded`;
  }
  // edh-d-88 (CR 508.1d; War's Toll): the requirement of each creature of an opponent once one of that opponent's creatures attacks (`allIfAny`); its one form only
  if (e.allIfAny === true) {
    const own = e.mode === 'mustIfAble' && e.action === 'attack' && e.max === undefined && e.min === undefined && e.alone === undefined && e.goad === undefined && e.exceptMana === undefined && e.when === undefined
      && e.other === undefined && e.otherPlayer === undefined && e.atLeastOne === undefined && e.exactly === undefined && JSON.stringify(e.subject) === '{"ref":"each","filter":{"types":["Creature"],"controller":"opponent"}}';
    if (!own) throw new NoRenderer('an if-one-attacks-all-attack requirement of another form');
    return 'if a creature an opponent controls attacks, all creatures that opponent controls attack if able';
  }
  // edh-d-75 (CR 508.1d; Seeker of Slaanesh, Trove of Temptation): the requirement of each opponent's whole group of creatures (`atLeastOne`): "Each opponent must attack with at least one creature
  // each combat if able", and with a defender named, "... must attack you or a planeswalker you control with at least one creature each combat if able"; those two forms only
  if (e.atLeastOne === true) {
    const own = e.mode === 'mustIfAble' && e.action === 'attack' && e.max === undefined && e.min === undefined && e.alone === undefined && e.goad === undefined && e.exceptMana === undefined && e.when === undefined
      && JSON.stringify(e.subject) === '{"ref":"each","filter":{"types":["Creature"],"controller":"opponent"}}';
    if (!own) throw new NoRenderer('an at-least-one attack requirement of another form');
    if (e.other === undefined && e.otherPlayer === undefined) return 'each opponent must attack with at least one creature each combat if able';
    if (JSON.stringify(e.other) === '{"types":["Planeswalker"],"controller":"you"}' && JSON.stringify(e.otherPlayer) === '{"ref":"you"}') {
      return 'each opponent must attack you or a planeswalker you control with at least one creature each combat if able';
    }
    throw new NoRenderer('an at-least-one attack requirement that names another defender');
  }
  // r5-static (CR 508.1c, 509.1b): "No more than one creature can attack each combat", "... can attack you each combat", "... can attack ~ each combat" (the
  // planeswalker of a granted ability), "No more than two creatures can block each combat": a limit on the whole declaration (statics/hooks.ts#declarationLimits)
  if (isDeclarationLimit(e)) return declarationLimitText(e);
  // edhd63 (CR 508.1b-c, 506.2, 101.4; Pramikon, Mystic Barrier, Teyo; statics/hooks.ts#verdict): every creature may attack only the nearest opponent on the chosen side and that opponent's planeswalkers
  if (e.onlyNearest !== undefined) {
    if (!('chosen' in e.onlyNearest) || e.onlyNearest.chosen !== 'direction' || e.mode !== 'cant' || e.action !== 'attack' || JSON.stringify(e.subject) !== '{"ref":"each","filter":{"types":["Creature"]}}'
      || e.other !== undefined || e.otherPlayer !== undefined || e.max !== undefined || e.min !== undefined || e.alone !== undefined || e.goad !== undefined || e.exceptMana !== undefined || e.when !== undefined || e.alreadyAttacked !== undefined) {
      throw new NoRenderer('an attack restriction to the nearest opponent other than the one of the chosen direction');
    }
    return `each player may attack only the nearest opponent in the ${e.onlyNearest.last === true ? 'last ' : ''}chosen direction and planeswalkers controlled by that opponent`;
  }
  // edh-combat-1 (CR 508.1b-c): "~ can't attack a player it has already attacked this turn" (statics/hooks.ts#verdict): the creature itself, nothing else
  if (e.alreadyAttacked === true) {
    if (e.mode !== 'cant' || e.action !== 'attackPlayer' || e.subject.ref !== 'self' || e.other !== undefined || e.otherPlayer !== undefined || e.max !== undefined || e.min !== undefined
      || e.alone !== undefined || e.goad !== undefined || e.exceptMana !== undefined || e.when !== undefined) throw new NoRenderer('an already-attacked ban with more than the ban');
    return `${sj} can't attack a player it has already attacked this turn`;
  }
  // edh-b-6 (CR 101.2, 701.6a; Taigam, Ojutai Master): "Instant, sorcery, and Dragon spells you control can't be countered": the spells you control of any of a list of card types and
  // subtypes (one option per `anyOf` entry, each only types or only subtypes), the list said with "and"
  if (e.mode === 'cant' && e.action === 'beCountered' && e.other === undefined && e.max === undefined && e.when === undefined && e.subject.ref === 'each' && 'filter' in e.subject) {
    const f = e.subject.filter;
    const opts = f.anyOf ?? [];
    const words = opts.flatMap((o) => (Object.keys(o).length === 1 && o.types !== undefined ? o.types.map((t) => t.toLowerCase()) : Object.keys(o).length === 1 && o.subtypes !== undefined ? o.subtypes : []));
    if (Object.keys(f).sort().join() === 'anyOf,controller,stackKind,zone' && f.controller === 'you' && f.stackKind === 'spell' && f.zone === 'stack' && opts.length >= 2 && words.length >= 3
      && words.length === opts.reduce((n, o) => n + (o.types?.length ?? o.subtypes?.length ?? 0), 0)) {
      return alt(`${sj} can't be countered`, `${words.slice(0, -1).join(', ')}, and ${words[words.length - 1]} spells you control can't be countered`);
    }
  }
  // FAST4 T33: "can't attack you" (attackPlayer) is written only with its planeswalker half (staticEffects#attackYouPair), and "unless they're mana
  // abilities" only for one object's own abilities (restrict): anything else has no words here
  // std-rx6 (CR 508.1c, 506.2): "Creatures can't attack you." alone: the player "you" only (planeswalkers you control stay attackable, as Oracle words it)
  if (isPlainAttackYou(e)) return `${sj} can't attack you`;
  // edh-next-66 (CR 508.1, 611.3a; Angelic Arbiter): "Each opponent who cast a spell this turn can't attack with creatures": the creatures of the players the subject names, any of them
  if (e.mode === 'cant' && e.action === 'attack' && e.other === undefined && e.otherPlayer === undefined && e.max === undefined && e.min === undefined && e.alone === undefined && e.exceptMana === undefined
    && e.when === undefined && e.goad === undefined && e.subject.ref === 'each' && 'filter' in e.subject && Object.keys(e.subject.filter).sort().join() === 'controller,types' && JSON.stringify(e.subject.filter.types) === '["Creature"]'
    && typeof e.subject.filter.controller === 'object' && e.subject.filter.controller.ref === 'eachWho') {
    return alt(`${sj} can't attack`, `${K.player(e.subject.filter.controller, st, 'subject').text} can't attack with creatures`);
  }
  // edh-next-54 (CR 508.1b, 506.2, 611.2a; Call for Aid, template eff.edhn54.you.cantAttack.player): "You can't attack that player this turn": the creatures you control, one other player
  if (e.mode === 'cant' && e.action === 'attackPlayer' && e.other === undefined && e.max === undefined && e.min === undefined && e.alone === undefined && e.exceptMana === undefined && e.when === undefined
    && e.goad === undefined && e.subject.ref === 'each' && 'filter' in e.subject && JSON.stringify(e.subject.filter) === '{"types":["Creature"],"controller":"you"}' && e.otherPlayer !== undefined && JSON.stringify(e.otherPlayer) !== '{"ref":"you"}') {
    return `you can't attack ${K.player(e.otherPlayer, st, 'object').text}`;
  }
  // edh-next-134 (CR 508.1b-c, 108.3; Elrond of the White Council): "This creature can't attack its owner.": the object itself, the one player who owns it (its planeswalkers stay attackable)
  if (e.mode === 'cant' && e.action === 'attackPlayer' && e.other === undefined && e.max === undefined && e.min === undefined && e.alone === undefined && e.exceptMana === undefined && e.when === undefined
    && e.goad === undefined && e.subject.ref === 'self' && JSON.stringify(e.otherPlayer) === '{"ref":"ownerOf","object":{"ref":"self"}}') {
    return `${sj} can't attack its owner`;
  }
  // edh-d-85 (CR 508.1d, 119.1; Galactus, Devourer of Worlds): "~ attacks an opponent with the most life among your opponents each combat if able": the requirement is obeyed only by attacking one of them
  if (e.mode === 'mustIfAble' && e.action === 'attack' && e.subject.ref === 'self' && JSON.stringify(e.otherPlayer) === '{"ref":"mostLife","who":"opponent"}'
    && ['other', 'max', 'min', 'alone', 'when', 'goad', 'exceptMana', 'alreadyAttacked', 'onlyAlone'].every((k) => (e as unknown as Record<string, unknown>)[k] === undefined)) {
    return `${sj} attacks an opponent with the most life among your opponents each combat if able`;
  }
  if (e.action === 'attackPlayer' || e.otherPlayer !== undefined && e.mode !== 'mustIfAble') throw new NoRenderer(`${e.action} with a player it concerns`);
  if (e.exceptMana === true) throw new NoRenderer('exceptMana outside one object\'s own abilities');
  if (e.abilityKeyword !== undefined) throw new NoRenderer('a keyword ability ban outside its own words'); // std-control-1
  // edh-combat-6 (CR 506.5, 508.1c; Master of Cruelties): "~ can only attack alone", the whole declaration (statics/hooks.ts#onlyAttacksAlone)
  if (e.onlyAlone === true) {
    if (e.mode !== 'cant' || e.action !== 'attack' || e.other !== undefined || e.otherPlayer !== undefined || e.max !== undefined || e.min !== undefined || e.alone !== undefined || e.goad !== undefined
      || e.exceptMana !== undefined || e.alreadyAttacked !== undefined || e.when !== undefined) throw new NoRenderer('a restriction to attack alone with more than the ban');
    return `${sj} can only attack alone`;
  }
  // edh-d-24 (CR 301.5, 301.5c, 704.5n, 604.1; Konda's Banner, O-Naginata): "~ can be attached only to a legendary creature": every permanent that is NOT of the kind can't have the source attached
  if (e.mode === 'cant' && e.action === 'beAttached' && e.subject.ref === 'each' && 'filter' in e.subject && Object.keys(e.subject.filter).join() === 'not' && e.other !== undefined && Object.keys(e.other).join() === 'self' && e.other.self === true
    && e.max === undefined && e.min === undefined && e.when === undefined && e.alone === undefined) {
    return `${K.obj({ ref: 'self' }, st, 'subject').text} can be attached only to ${K.np(e.subject.filter.not!, st, { det: 'a' })}`;
  }
  if (e.alone === true) {
    // edh-c-94 (CR 506.5, 508.1c, 122.1; family alone-unless-self-counter; Pipsqueak): "~ can't attack alone unless ~ has a +1/+1 counter on ~": the whole declaration is forbidden while the
    // condition fails (`when` is the negation of what Oracle asks for); the creature itself named twice (its pronoun is read as ~)
    if (e.when?.cond === 'not' && e.when.of.cond === 'matches' && JSON.stringify(e.when.of.object) === '{"ref":"self"}' && JSON.stringify(e.when.of.filter) === '{"counters":{"kind":"+1/+1"}}'
      && e.action === 'attack' && isAloneBan({ ...e, when: undefined } as RestrictionDef)) {
      return alt(`${sj} can't attack alone unless ${sj} has a +1/+1 counter on ${sj}`, `${sj} can't attack alone unless ${sj} has a +1/+1 counter on it`);
    }
    if (!isAloneBan(e)) throw new NoRenderer('a restriction on acting alone with more than the ban');
    return `${sj} can't ${e.action} alone`;
  }
  const selfOnly = castSelfOnly(e, sj) ?? castSelfAttackedStep(e, sj) /* FAST5 T36 */ ?? castSelfBeforeAttackers(e, sj); // edh-d-89
  if (selfOnly !== null) return selfOnly;
  const firstTurns = castSelfFirstTurns(e, sj); // std-r9
  if (firstTurns !== null) return firstTurns;
  const selfUnless = castSelfUnless(e, sj, st); // FAST4 T32
  if (selfUnless !== null) return selfUnless;
  // edh-cast-3 (CR 117.1a, 101.2): "Each opponent can cast spells only any time they could cast a sorcery"
  if (e.mode === 'cant' && e.action === 'castAtInstantSpeed' && e.other === undefined && e.max === undefined && e.when === undefined) return `${sj} can cast spells only any time ${sj === 'you' ? 'you' : 'they'} could cast a sorcery`;
  if (castOnlyFromHand(e)) return `${sj} can't cast spells from anywhere other than ${pl ? 'their hands' : 'their hand'}`; // FAST4 T32
  // design 3.3: a limit (`max`) and a filter (`other`) are printed where Oracle has words for them, and refused everywhere else
  // MX5: "~ can't be blocked by more than one creature" is a limit on the blockers of one attacker (CR 509.1b; statics/hooks.ts#blockSetValid)
  const limited = e.mode === 'cant' && (e.action === 'cast' || e.action === 'draw' || e.action === 'playLand' || e.action === 'activate' || e.action === 'beBlocked');
  // p2-player-rules-1 (CR 601.2i): a limit on casting spells of a kind, "can't cast more than one noncreature spell each turn" (statics/hooks.ts#castCountOfKind)
  if (e.max !== undefined && (!limited || (e.other !== undefined && e.action !== 'cast'))) throw new NoRenderer(`a limit on ${e.mode} ${e.action}`);
  // edh-next-18 (CR 509.1b; Tromokratis): the whole set of the defending player's creatures must block it, nothing else in the restriction
  if (e.unlessAllBlock === true) {
    if (e.mode !== 'cant' || e.action !== 'beBlocked' || ['other', 'max', 'min', 'alone', 'when', 'otherPlayer', 'exceptMana'].some((k) => (e as unknown as Record<string, unknown>)[k] !== undefined)) throw new NoRenderer('an all-must-block exception with more than the exception');
    return `${sj} can't be blocked unless all creatures defending player controls block it`;
  }
  // FAST5 T57: "~ can't be blocked except by three or more creatures" (CR 509.1b): a minimum on the blockers of one attacker, nothing else
  // edh-d-38 (CR 509.1c; Gorm the Great): also "must be blocked by two or more creatures if able" (a `mustIfAble` beBlocked with the same minimum)
  if (e.min !== undefined && ((e.mode !== 'cant' && e.mode !== 'mustIfAble') || e.action !== 'beBlocked' || e.other !== undefined || e.max !== undefined || typeof e.min !== 'number' || e.min < 2)) {
    throw new NoRenderer(`a minimum on ${e.mode} ${e.action}`);
  }
  // T3 (push wave): "can block only creatures with flying" is an onlyIf block whose filter is the attacker (CR 509.1b; statics/hooks.ts passes it as `other`)
  const blockOnly = e.mode === 'onlyIf' && e.action === 'block' && e.other !== undefined && e.when === undefined && e.max === undefined;
  // FAST3 T12: "~ can't block creatures with power 2 or greater" (CR 509.1b; statics/hooks.ts passes the attacker as `other`)
  const blockFiltered = e.mode === 'cant' && e.action === 'block' && e.other !== undefined && !blocksSelfOnly(e) && e.max === undefined;
  // p2-graveyard-2 (CR 601.3): "Players can't cast spells from graveyards or libraries" (Grafdigger's Cage), "Players can't cast noncreature spells from graveyards or
  // exile" (Soulless Jailer): the zones in Oracle's order (graveyards, libraries, exile), the spells described by `other`
  if (e.action === 'castFromZone' && (e.other !== undefined || e.fromZones !== undefined)) {
    if (e.mode !== 'cant' || e.max !== undefined || e.when !== undefined) throw new NoRenderer('a castFromZone restriction with more than its zones and spells');
    const zs = e.fromZones ?? ['graveyard'];
    const ZONE_WORDS: Readonly<Record<string, string>> = { graveyard: 'graveyards', library: 'libraries', exile: 'exile' };
    if (zs.length === 0 || new Set(zs).size !== zs.length || zs.some((z) => ZONE_WORDS[z] === undefined)) throw new NoRenderer('castFromZone of other zones');
    const words = ['graveyard', 'library', 'exile'].filter((z) => zs.includes(z as ZoneName)).map((z) => ZONE_WORDS[z]!);
    const spells = e.other !== undefined ? K.np({ ...e.other, stackKind: 'spell' }, st, { det: 'none', plural: true }) : 'spells';
    return `${sj} can't cast ${spells} from ${words.join(' or ')}`;
  }
  // edh-next-136 (CR 508.1b, 506.3; Jace, Multiverse Architect): "creatures they control can't attack Jaces you control": a ban on attacking the permanents of a description you control (the defenders,
  // planeswalkers or battles: statics/hooks.ts passes the defender as `other`), nothing else in the restriction
  if (e.mode === 'cant' && e.action === 'attack' && e.other !== undefined && e.other.controller === 'you' && ['max', 'min', 'alone', 'when', 'otherPlayer', 'exceptMana'].every((k) => (e as unknown as Record<string, unknown>)[k] === undefined)) {
    return `${sj} can't attack ${K.np(e.other, st, { det: 'none', plural: true })}`;
  }
  if (e.other !== undefined && !blockOnly && !blocksSelfOnly(e) && !blockFiltered && !(e.mode === 'cant' && (e.action === 'beBlockedBy' || e.action === 'beTargeted' || (e.action === 'beEnchanted' && JSON.stringify(e.other) === '{"subtypes":["Aura"],"other":true}') || e.action === 'cast' || e.action === 'activate' || e.action === 'sacrifice')) && !(e.mode === 'mustIfAble' && e.action === 'beBlocked' && e.when === undefined && e.max === undefined)) { // edh-c-71: "must be blocked by an Eldrazi if able"
    throw new NoRenderer(`a filter on ${e.mode} ${e.action}`);
  }
  if (blockOnly) return `${sj} can block only ${K.np(e.other!, st, { det: 'none', plural: true })}`;
  // FAST2 T9: "Target creature can't block ~ this turn": a ban on blocking one attacker, the source (CR 509.1b; statics/hooks.ts passes the attacker as `other`)
  if (blocksSelfOnly(e)) return `${sj} ${"can't"} block ${K.obj({ ref: 'self' }, st, 'object').text}`;
  const cant = `can't`;
  const doesnt = pl ? "don't" : "doesn't";
  const other = e.other;
  const tail = (): string => {
    switch (e.action) {
      case 'beBlockedBy': {
        if (!other) return '';
        const by = ` by ${K.np(other, st, { det: 'none', plural: true })}`;
        // FAST1 T5: "can't be blocked except by Walls" is "can't be blocked by non-Wall creatures" (CR 509.1b; family except-by)
        const keys = Object.keys(other);
        return keys.length === 1 && keys[0] === 'not' ? alt(by, ` except by ${K.np(other.not!, st, { det: 'none', plural: true })}`) : by;
      }
      case 'beTargeted': return other ? ` of ${K.np(other, st, { det: 'none', plural: true })}` : ' of spells or abilities';
      case 'cast': return other ? ` ${K.np({ ...other, stackKind: 'spell' }, st, { det: 'none', plural: true })}` : '';
      case 'activate': return other ? ` of ${K.np(other, st, { det: 'none', plural: true })}` : '';
      default: return '';
    }
  };
  let text: string;
  if (e.mode === 'cant') {
    if (e.action === 'preventDamage' || e.action === 'preventCombatDamage') throw new NoRenderer("damage can't be prevented is one restriction on every permanent and one on every player (damageUnpreventable)");
    else if (e.action === 'beBlocked' && e.min !== undefined) text = `${sj} ${cant} be blocked except by ${numWord(e.min)} or more creatures`; // FAST5 T57 (CR 509.1b)
    else if (e.action === 'beBlocked' && e.max !== undefined) text = `${sj} ${cant} be blocked by more than ${numWord(e.max)} ${e.max === 1 ? 'creature' : 'creatures'}`; // MX5 (CR 509.1b)
    // Cloud C3 (batch 3): a group's own untap steps are also "their controllers' untap steps" (CR 502.3: each permanent untaps in its controller's untap step)
    else if (e.action === 'untapDuringUntapStep') text = `${sj} ${doesnt} untap during ${alt('your untap step', "its controller's untap step", "their controller's untap step", ...(pl ? ["their controllers' untap steps"] : []))}`;
    else if (e.action === 'untap' && !other) text = `${sj} ${alt(`${cant} untap`, `${doesnt} untap`, `${cant} become untapped`)}`; // FAST4 T33: "can't become untapped"
    // edh-perms-14 (CR 122.1, 122.6, 614.17; Solemnity): "Players can't get counters." is the ban on counters put on every player, and "Counters can't be put on artifacts, creatures,
    // enchantments, or lands." the one on counters put on every permanent of a description
    // edh-b-2 (CR 122.6, 614.17; Blightbeetle, Darksteel Angel): "Creatures your opponents control can't have +1/+1 counters put on them."
    // edh-next-19 (CR 122.1f, 614.17; Melira, Sylvok Outcast): "You can't get poison counters." is the ban on counters of one kind put on you
    else if (e.action === 'haveCountersPut' && e.counter !== undefined && e.subject.ref === 'you' && other === undefined && e.max === undefined) text = `you can't get ${e.counter} counters`;
    else if (e.action === 'haveCountersPut' && e.counter !== undefined) {
      if (other !== undefined || e.max !== undefined || e.subject.ref !== 'each' || !('filter' in e.subject)) throw new NoRenderer('a counter-kind ban outside its own words');
      text = `${sj} ${cant} have ${e.counter} counters put on ${pl ? 'them' : 'it'}`;
    }
    else if (e.action === 'haveCountersPut' && other === undefined && e.max === undefined && e.subject.ref === 'each' && 'who' in e.subject && e.subject.who === 'player' && !('filter' in e.subject)) {
      text = alt(`${sj} ${cant} have counters put on ${pl ? 'them' : 'it'}`, 'players can\'t get counters', 'each player can\'t get counters');
    } else if (e.action === 'haveCountersPut' && other === undefined && e.max === undefined && e.subject.ref === 'each' && 'filter' in e.subject) {
      text = alt(`${sj} ${cant} have counters put on ${pl ? 'them' : 'it'}`, `counters can't be put on ${K.np(e.subject.filter, st, { det: 'none', plural: true })}`);
    }
    // edh-players-22 (CR 122.1d, 614.17; Fear of Sleep Paralysis): "Stun counters can't be removed from permanents your opponents control."
    else if (e.action === 'haveStunCountersRemoved' && other === undefined && e.max === undefined && e.subject.ref === 'each' && 'filter' in e.subject) {
      text = `stun counters can't be removed from ${K.np(e.subject.filter, st, { det: 'none', plural: true })}`;
    }
    else if (e.action === 'haveStunCountersRemoved') throw new NoRenderer('a stun counter ban outside its own words');
    else if (e.action === 'beBlockedBy' && other !== undefined && e.subject.ref === 'self') {
      // FAST3 T12: "Creatures with power less than ~'s power can't block it" is "~ can't be blocked by creatures with power less than ~'s power" (CR 509.1b:
      // statics/hooks.ts asks both `block` of the blocker and `beBlockedBy` of the attacker)
      text = alt(`${sj} ${cant} be blocked${tail()}`, `${K.np(other, st, { det: 'none', plural: true })} ${cant} block ${alt(sj, 'it')}`);
      // FAST3 T16: "~ can't be blocked by creatures with greater power" says "greater than ~'s power" in two words (CR 208.1, 509.1b)
      if (greaterPowerThanSelf(other)) text = alt(text, `${sj} ${cant} be blocked by creatures with greater power`);
    } else if (e.action === 'beBlockedBy') {
      text = `${sj} ${cant} be blocked${tail()}`;
      // edh-d-12 (CR 208.1, 509.1b; Tadeas, Juniper Ascendant; family cant-be-blocked-greater-power-subject): "it can't be blocked by creatures with greater power" says "greater than its power" in two words when the power compared with is the subject's own
      if (other !== undefined && Object.keys(other).length === 2 && JSON.stringify(other.types) === '["Creature"]' && other.power?.op === '>' && typeof other.power.value === 'object' && other.power.value.q === 'stat' && other.power.value.stat === 'power'
        && other.power.value.agg === undefined && JSON.stringify(other.power.value.of) === JSON.stringify(e.subject)) text = alt(text, `${sj} ${cant} be blocked by creatures with greater power`);
    } else if (blockFiltered) text = `${sj} ${cant} block ${K.np(other!, st, { det: 'none', plural: true })}`;
    // std-rx21 (CR 115.1, 702.11b): "can't be the target of spells or abilities your opponents control": `other` is the spell, or the source of the ability, and its
    // controller is an opponent of the controller of this effect (statics/hooks.ts canBeTargeted); hexproof's own words, never the keyword itself
    // edh-c-35 (CR 303.4, 101.2; Consecrate Land): "can't be enchanted by other Auras", the attachment described by `other` (statics/hooks.ts, OTHER_ACTIONS: the Aura that would attach)
    else if (e.action === 'beEnchanted' && other !== undefined && JSON.stringify(other) === '{"subtypes":["Aura"],"other":true}') text = `${sj} ${cant} be enchanted by other Auras`;
    else if (e.action === 'beTargeted' && other !== undefined && JSON.stringify(other) === '{"controller":"opponent"}') text = pl ? alt(`${sj} ${cant} be the target of spells or abilities your opponents control`, `${sj} ${cant} be the targets of spells or abilities your opponents control`) : `${sj} ${cant} be the target of spells or abilities your opponents control`;
    else if (e.action === 'beTargeted') {
      text = `${sj} ${cant} be the target${tail() === ' of spells or abilities' ? ' of spells or abilities' : ` of ${other ? K.np(other, st, { det: 'none', plural: true }) : 'spells or abilities'}`}`;
      // FAST3 T16: "can't be the target of white spells or abilities from white sources": `other` is the spell, or the source of the ability (statics/hooks.ts
      // canBeTargeted, CR 115.1, 113.7a), so one color filter says both halves
      const c = onlyColor(other);
      if (c !== null) text = alt(text, `${sj} ${cant} be the target of ${c} spells or abilities from ${c} sources`);
      // edh-c-60 (Gaea's Revenge): the same for one color a source may NOT have, "nongreen spells or abilities from nongreen sources"
      if (other !== undefined && Object.keys(other).length === 1 && other.notColors?.length === 1) text = alt(text, `${sj} ${cant} be the target of non${COLOR_WORD[other.notColors[0]!]} spells or abilities from non${COLOR_WORD[other.notColors[0]!]} sources`);
      // edh-d-43 (CR 115.1, 113.7a; family cant-target-nongreen-by-opponents; Thrun, Breaker of Silence): the same, only spells and sources an opponent controls
      if (other !== undefined && Object.keys(other).length === 2 && other.controller === 'opponent' && other.notColors?.length === 1) text = alt(text, `${sj} ${cant} be the target of non${COLOR_WORD[other.notColors[0]!]} spells your opponents control or abilities from non${COLOR_WORD[other.notColors[0]!]} sources your opponents control`);
      // trek-22 (CR 115.1, 113.7a; family cant-target-abilities-from-sources; Species 8472): abilities only, from the sources of one card type an opponent controls
      if (other !== undefined && Object.keys(other).length === 3 && other.stackKind === 'ability' && other.controller === 'opponent' && other.types?.length === 1) text = alt(text, `${sj} ${cant} be the target of abilities from ${other.types[0]!.toLowerCase()} sources your opponents control`);
      // std-ry5 (CR 115.1; family targets-plural): a group "can't be the targets of spells or abilities" (Ground Seal: "Cards in graveyards ..."), the noun in
      // the number of its subject
      if (pl && other === undefined) text = alt(text, `${sj} ${cant} be the targets of spells or abilities`);
      // edh-c-26 (CR 115.1; family group-cant-be-targeted-by-spells): "Creatures can't be the targets of spells." says the group without "all" (Dense Foliage)
      if (pl && other !== undefined && JSON.stringify(other) === '{"stackKind":"spell"}' && sj.startsWith('all ')) text = alt(text, `${sj.slice(4)} ${cant} be the targets of spells`);
      // edh-c-51 (CR 115.1; family targets-plural-colored; Display of Dominance): the same noun in the number of its subject for the spells of a described kind
      else if (pl && other !== undefined) text = alt(text, text.replace(' be the target of ', ' be the targets of '));
    }
    else if (e.max !== undefined && (e.action === 'cast' || e.action === 'draw' || e.action === 'playLand' || e.action === 'activate')) {
      const unit = e.action === 'cast' ? 'spell' : e.action === 'draw' ? 'card' : e.action === 'playLand' ? 'land' : 'ability';
      const n = e.max;
      const what = e.action === 'cast' && other ? K.np({ ...other, stackKind: 'spell' }, st, { det: 'none', plural: n !== 1 }) : n === 1 ? unit : pluralize(unit); // p2-player-rules-1
      text = `${sj} ${cant} ${ACTION_CANT[e.action]!.split(' ')[0]} more than ${numWord(n)} ${what} each turn`;
      // edh-cast-3 (CR 601.2i, 101.2; family cant-cast-additional-kind): "Each player can't cast more than one nonartifact spell each turn" is "Each player who has cast a nonartifact spell
      // this turn can't cast additional nonartifact spells": the second one is the casts after the first (statics/hooks.ts#castCountOfKind counts them as they are cast)
      if (e.action === 'cast' && n === 1 && other !== undefined && sj === 'each player') {
        text = alt(text, `${sj} who has cast ${K.np({ ...other, stackKind: 'spell' }, st, { det: 'a' })} this turn can't cast additional ${K.np({ ...other, stackKind: 'spell' }, st, { det: 'none', plural: true })}`);
      }
    } else if (e.action === 'cast' && other) {
      // p2-refs-3 (CR 601.3, 101.2; family spells-cant-be-cast): a ban for every player is also said of the spells alone, "Spells with the chosen name can't be cast."
      const every = e.subject.ref === 'each' && 'who' in e.subject && e.subject.who === 'player' && !('filter' in e.subject);
      const passive = every ? `${K.np({ ...other, stackKind: 'spell' }, cloneState(st), { det: 'none', plural: true })} ${cant} be cast` : null;
      const active = `${sj} ${cant} cast ${K.np({ ...other, stackKind: 'spell' }, st, { det: 'none', plural: true })}`;
      text = passive === null ? active : alt(active, passive);
    }
    else if (e.action === 'activate' && other) text = `${sj} ${cant} activate abilities of ${K.np(other, st, { det: 'none', plural: true })}`;
    // trek-5 (CR 701.21a, 101.2): "You can't sacrifice Treasure tokens." bans the sacrifice of the permanents `other` describes (rules/cant.ts#costUseDenial asks it of every sacrifice)
    else if (e.action === 'sacrifice' && other) text = `${sj} ${cant} sacrifice ${K.np(other, st, { det: 'none', plural: true })}`;
    // edh-cast-2 (CR 601.3, 101.2; family cant-cast-additional-spells): "You can't cast additional spells this turn." bans the casts that follow (the one just made is cast already)
    else if (e.action === 'cast') text = `${sj} ${cant} ${alt('cast spells', 'cast additional spells')}`;
    else text = `${sj} ${cant} ${cantWords(e.action, pl)}`;
  } else if (e.mode === 'mustIfAble') {
    switch (e.action) {
      case 'attack': text = `${sj} ${pl ? 'attack' : 'attacks'} each combat if able`; break;
      case 'block': text = `${sj} ${pl ? 'block' : 'blocks'} each combat if able`; break;
      // edh-c-71 (CR 509.1c; Slayer's Cleaver): "must be blocked by an Eldrazi if able": one blocker of that description obeys it
      case 'beBlocked': text = e.exactly !== undefined ? `${sj} must be blocked by exactly ${numWord(e.exactly)} creature${e.exactly === 1 ? '' : 's'} if able` /* edh-d-75 (CR 509.1c; Nacatl War-Pride) */ : e.min !== undefined ? `${sj} must be blocked by ${numWord(e.min)} or more creatures if able` : other ? `${sj} must be blocked by ${K.np(other, st, { det: 'a' })} if able` : `${sj} must be blocked if able`; break;
      default: text = `${sj} ${pl ? 'must' : 'must'} ${ACTION_CANT[e.action] ?? e.action} if able`;
    }
  } else {
    // CR 508.1d / 509.1c: "can't attack unless C" and "can attack only if C" are one restriction
    const verb = ACTION_CANT[e.action] ?? e.action;
    const c = e.when ? ` ${K.cond(e.when, st)}` : '';
    text = alt(`${sj} ${cant} ${verb} unless${c}`, `${sj} can ${verb} only if${c}`);
    return text;
  }
  if (e.when) {
    const c = K.cond(e.when, st);
    // FAST3 T15: "Your opponents can't cast spells during your turn" is the restriction as long as it's your turn (CR 500.1, 611.3a; family during-turn)
    const w = e.when;
    const during = e.mode === 'cant' && w.cond === 'turnOf' && w.whose === 'you' && w.step === undefined ? [`${text} during your turn`] : [];
    // edh-next-31 (CR 500.7; family restriction-during-your-turn, a reading of its group; Medomai the Ageless): "~ can't attack during extra turns"
    if (e.mode === 'cant' && w.cond === 'turnOf' && w.extra === true && w.whose === 'any' && w.step === undefined) during.push(`${text} during extra turns`);
    // CMD5 (family restriction-during-combat): "Players can't cast spells during combat" is the restriction in every step of the combat phase (CR 506.1, 604.1)
    if (e.mode === 'cant' && w.cond === 'turnOf' && w.whose === 'any' && Array.isArray(w.step) && CAST_SELF_ONLY_STEPS[w.step.join(',')] === 'during combat') during.push(`${text} during combat`);
    return alt(`as long as ${c}, ${text}`, `${text} as long as ${c}`, ...during);
  }
  return text;
}

// ---------------------------------------------------------------------------
// Replacement effects (CR 614-616)
// ---------------------------------------------------------------------------

/** edhd63: the shape of Bitter Feud's replacement (rep.edhd63.damage.doubleBetweenChosenPlayers), key order as the template writes it. */
const BITTER_FEUD_REPLACEMENT = { s: 'replace', replaces: { ev: 'damage', source: { controller: { ref: 'linked', link: 'chosenPlayers' } }, recipient: { player: { ref: 'linked', link: 'chosenPlayers' }, object: { controller: { ref: 'linked', link: 'chosenPlayers' } } }, toOtherThanSourceController: true }, body: { b: 'modify', amount: { mul: 2 } } };

/** "twice that many tokens", "twice that much damage", "N more counters": the new amount of a replaced event, in the words of what is counted. */
function amountChange(a: AmountChange, st: RenderState, noun: string, much = false): string {
  const that = much ? 'that much' : 'that many';
  if (a.mul !== undefined) {
    const text = a.mul === 2 ? `twice ${that} ${noun}` : a.mul === 0.5 ? `half ${that} ${noun}, rounded ${a.round ?? 'down'}` : `${numWord(a.mul)} times ${that} ${noun}`;
    // p2-replace-damage-2 (CR 614.1a): three times that much damage is also "triple that damage" (City on Fire; family double-triple-that-damage)
    const word = a.mul === 2 ? 'double' : a.mul === 3 ? 'triple' : null;
    return word !== null && much && noun === 'damage' ? alt(text, `${word} that damage`) : text;
  }
  // edh-c-36 (CR 614.1a, 120.3; Lashknife Barrier): one less, "that much damage minus 1" (`add` 0 minus N, as the counters of Vizier of Remedies)
  const lessBy = a.mul === undefined && a.set === undefined && much ? minusOf(a) : undefined;
  if (lessBy !== undefined) return `that much ${noun} minus ${K.qty(lessBy, st)}`;
  // M6-1: "that much life plus 1" (CR 614.1a: the changed amount said from the original one) is the same change as "1 more life"
  if (a.add !== undefined) return alt(`${K.qty(a.add, st)} more ${noun}`, `${that} ${noun} plus ${K.qty(a.add, st)}`);
  if (a.set !== undefined) return `${K.qty(a.set, st)} ${noun}`;
  return `${that} ${noun}`;
}

/** M6-5: the number of counters per kick when `count` is `kickCount` or a whole multiple of it (k * kickCount), else null. */
/**
 * "N counters for each time it was kicked" (M6-5) and, CMDF, "N counters for each time you've cast your commander from the command zone this game" (CR
 * 903.8, The Swarmlord): the N and the counted quantity, or null.
 */
function perKick(count: Quantity): { n: number; per: Quantity } | null {
  if (typeof count !== 'object') return null;
  const counted = (q: Quantity): boolean => typeof q === 'object' && ((q.q === 'kickCount' && q.name === undefined) || q.q === 'commanderCasts'); // M6-12: a named cost's payments are not kicks
  if (counted(count)) return { n: 1, per: count };
  if (count.q === 'math' && count.op === '*' && count.args.length === 2 && typeof count.args[0] === 'number' && count.args[0] > 1) {
    const b = count.args[1];
    if (b !== undefined && counted(b)) return { n: count.args[0], per: b };
  }
  return null;
}

/**
 * M6-10 (CR 707.9b, 707.9e): the exceptions of "enter as a copy" in Oracle's order, ", except it enters with an additional +1/+1 counter on it if it's a
 * creature, ..., and it isn't legendary": the additional effects first (`additional`, CR 707.9e), then the copiable-value exceptions (`except`, CR 707.9b,
 * render/copy-except.ts). Before M6-10 the exceptions were not rendered at all, so no card with them passed the render gate (G6); nothing that rendered before
 * renders differently. A conditional exception other than "if it's a <card type>" has no renderer.
 */
function enterCopyExceptions(copy: NonNullable<Extract<ReplacementDef['body'], { b: 'enters' }>['copy']>, st: RenderState): string {
  const phrases: string[] = [];
  // edh-next-65 (CR 707.9b, 707.9e, 707.9f, 205.4a, 702.73a; Moritte of the Frost): "except it's legendary and snow in addition to its other types and, if it's a creature, it enters with two additional +1/+1
  // counters on it and has changeling." (the supertypes added; for a creature copy the counters as it enters and the changeling ability; nothing else)
  const moritte = copy.except?.length === 2 && copy.additional?.length === 1 && JSON.stringify(copy.except[0]) === '{"layer":4,"supertypes":{"add":["Legendary","Snow"]}}'
    && JSON.stringify(copy.except[1]) === '{"if":{"types":["Creature"]},"then":[{"layer":6,"add":[{"kind":"keyword","keyword":"changeling","text":"changeling"}]}]}'
    && JSON.stringify(copy.additional[0]!.if) === '{"types":["Creature"]}' && copy.additional[0]!.counters.length === 1 && typeof copy.additional[0]!.counters[0]!.count === 'number' && copy.additional[0]!.counters[0]!.count > 1;
  if (moritte) {
    const c = copy.additional![0]!.counters[0]!;
    return `, except it's legendary and snow in addition to its other types and, if it's a creature, it enters with ${numWord(c.count as number)} additional ${c.kind} counters on it and has changeling`;
  }
  for (const a of copy.additional ?? []) {
    if (a.counters.length !== 1) throw new NoRenderer('an additional copy effect with several counter kinds');
    const c = a.counters[0]!;
    const n = c.count === 1 ? 'an' : typeof c.count === 'number' ? numWord(c.count) : K.qty(c.count, st);
    let cond = '';
    // edh-next-114 (CR 707.9e; Undercover Operative): "it enters with a shield counter on it if you control that creature" (no "additional", the Oracle wording of the card)
    if (a.ifCopiedControlled === true) {
      if (a.if !== undefined || c.count !== 1 || copy.of.types?.length !== 1 || copy.of.types[0] !== 'Creature') throw new NoRenderer('an additional copy effect conditioned on controlling the copied object, other than one counter of a creature copy');
      phrases.push(`it enters with a ${c.kind} counter on it if you control that creature`);
      continue;
    }
    if (a.if) {
      if (Object.keys(a.if).length !== 1 || a.if.types?.length !== 1) throw new NoRenderer('an additional copy effect with a condition other than a card type');
      const type = a.if.types[0]!.toLowerCase();
      cond = ` if it's ${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type}`;
    }
    phrases.push(`it enters with ${n} additional ${c.kind} counter${c.count === 1 ? '' : 's'} on it${cond}`);
  }
  if (copy.except && copy.except.length > 0) {
    phrases.push(copyExceptText(copy.except, (mods) => K.staticEffect({ s: 'continuous', affects: { ref: 'subject' }, mods }, st), (a) => quotedAbility(a, st, 'creature'), K.nounsOf(copy.of)[0], false, false, true)); // trek-16: the card itself becomes the copy, Oracle's "~" (Voq, Ezri Dax). MX2: the copied object's noun ("that creature's color")
  }
  return phrases.length > 0 ? `, except ${joinList(phrases)}` : '';
}

/**
 * FAST5 T63 (CR 614.1c, 614.12, 500.1): the condition "it's your turn" of "enters tapped unless it's your turn" is also Oracle's "enters tapped if it's not
 * your turn" (the same replacement: tapped on any turn but yours).
 */
function tappedUnlessWords(c: Condition, subject: string, verb: string, st: RenderState): string {
  const plain = `${subject} ${verb} tapped unless ${K.cond(c, st)}`;
  if (c.cond === 'turnOf' && c.whose === 'you' && c.step === undefined) return alt(plain, `${subject} ${verb} tapped if it's not your turn`);
  // std-rx20 (CR 614.1c, family if-cond-enters-tapped): "If you control two or more other lands, this land enters tapped." is the replacement that enters it tapped
  // unless the condition is false, the condition said first (Cave of the Frost Dragon)
  if (c.cond === 'not') return alt(plain, `if ${K.cond(c.of, st)}, ${subject} ${verb} tapped`);
  return plain;
}

/**
 * FAST5 T64 (CR 110.1): "any creature on the battlefield with mana value less than or equal to the amount of mana spent to cast ~" (Mockingbird): the zone words
 * come before a "with ..." clause of the noun phrase as well as after it.
 */
function onBattlefield(np: string, onBf: string): string {
  if (onBf === '') return np;
  let depth = 0;
  for (let i = 0; i < np.length; i++) {
    const ch = np[i];
    if (ch === ALT_OPEN) depth++;
    else if (ch === ALT_CLOSE) depth--;
    else if (depth === 0 && np.startsWith(' with ', i)) return alt(`${np}${onBf}`, `${np.slice(0, i)}${onBf}${np.slice(i)}`);
  }
  return `${np}${onBf}`;
}

function enters(body: Extract<ReplacementDef['body'], { b: 'enters' }>, subject: string, st: RenderState): string {
  const parts: string[] = [];
  const sentences: string[] = [];
  // M6-1: a plural noun phrase that does not end in "s" ("creatures your opponents control") takes "enter" too
  const verb = subject === '~' ? 'enters' : /s$/.test(subject) ? 'enter' : alt('enters', 'enter');
  // trek-8 (CR 508.4): entering attacking has its own sentence (#tappedAndAttackingWhile); in any other reading it would be dropped, never silently
  if (body.attacking === true) throw new NoRenderer('an entering body that makes the permanent attack, outside "instead it enters tapped and attacking"');
  // CMD3: counters that depend on the permanent as it would exist on the battlefield (sunburst, CR 702.44a) have no template wording yet
  if (body.countersIf !== undefined) throw new NoRenderer('enters with counters that depend on what the permanent is as it enters');
  if (body.lookAtHand !== undefined && !(body.choose && body.choose.length > 0)) throw new NoRenderer('a look at a hand with no choice after it');
  // edh-next-137 (CR 614.12, 114.2, 607.2a; Tibalt, Cosmic Impostor): "As ~ enters, you get an emblem with "..."": one quoted ability and nothing else in the body
  if (body.emblem !== undefined) {
    if (Object.keys(body).some((k) => k !== 'b' && k !== 'emblem') || subject !== '~' || body.emblem.length !== 1 || st.depth > 0) throw new NoRenderer('an emblem given as a permanent enters, with other entering facts or abilities');
    // the permanent named inside the emblem's ability is the outer card, '¤' in the quoted text (parser/tokenize.ts GRANTOR): "cards exiled with ¤" (the emblem reads its links)
    return `as ${subject} ${verb}, you get an emblem with "${hoistFinalPeriod(K.ability(body.emblem[0]!, nestedState(st))).replace(/~/g, '¤')}"`;
  }
  // edh-c-84 (CR 614.12a, 701.20a, 201.3; Alhammarret, High Arbiter): "As ~ enters, each opponent reveals their hand. You choose the name of a nonland card revealed this way."
  if (body.revealHands !== undefined || (body.choose ?? []).some((c) => c.fromRevealed === true)) {
    const c = body.choose;
    if (body.revealHands !== 'eachOpponent' || c === undefined || c.length !== 1 || c[0]!.what !== 'cardName' || c[0]!.cardKind !== 'nonland' || c[0]!.fromRevealed !== true || Object.keys(body).some((k) => k !== 'b' && k !== 'revealHands' && k !== 'choose')) {
      throw new NoRenderer('a reveal of the opponents\' hands other than "each opponent reveals their hand. You choose the name of a nonland card revealed this way"');
    }
    return `as ${subject} ${verb}, each opponent reveals their hand. you choose the name of a nonland card revealed this way`;
  }
  // std-cardcopy-3 (CR 614.12a, 607.2a): "As ~ enters, exile up to X creature cards from your graveyard. It enters with three +1/+1 counters on it for each creature
  // card exiled this way." (Mimeoplasm, Revered One): cards of your graveyard only, and nothing else in the body
  // p2-misc-1 (CR 731.1, 614.12): "If it's neither day nor night, it becomes day as ~ enters." (Firmament Sage): nothing else in the body
  // edh-next-128 (CR 614.12a, 706.2; Neverwinter Hydra): "As ~ enters, roll X d6. It enters with a number of +1/+1 counters on it equal to the total of those results.": only that shape
  if (body.roll !== undefined) {
    const c = body.counters ?? [];
    if (Object.keys(body).some((k) => k !== 'b' && k !== 'roll' && k !== 'counters') || c.length !== 1 || JSON.stringify(c[0]!.count) !== '{"q":"dieResult"}' || subject !== '~') {
      throw new NoRenderer('dice rolled as a permanent enters, other than "It enters with a number of counters on it equal to the total of those results"');
    }
    const n = typeof body.roll.count === 'number' ? numWord(body.roll.count) : K.qty(body.roll.count, st);
    return `as ${subject} ${verb}, roll ${n} d${body.roll.sides}. ${alt('it', subject)} ${verb} with a number of ${c[0]!.kind} counters on it equal to the total of those results`;
  }
  if (body.dayIfNeither !== undefined) {
    if (Object.keys(body).some((k) => k !== 'b' && k !== 'dayIfNeither') || subject !== '~') throw new NoRenderer('becoming day as a permanent enters, with other entering facts');
    return `if it's neither day nor night, it becomes day as ${subject} ${verb}`;
  }
  if (body.exileCards !== undefined) {
    const x = body.exileCards;
    const f = x.filter;
    if (Object.keys(body).some((k) => k !== 'b' && k !== 'exileCards') || f.zone !== 'graveyard' || f.owner !== 'you' || x.counters === undefined) throw new NoRenderer('an exile as it enters other than "up to N cards from your graveyard", with counters for each');
    const { zone: _z, owner: _o, ...desc } = f;
    const cards = K.np({ ...desc, zone: 'graveyard' }, st, { det: 'none', plural: true, noZone: true });
    const one = K.np({ ...desc, zone: 'graveyard' }, st, { det: 'none', noZone: true });
    const per = typeof x.counters.per === 'number' ? (x.counters.per === 1 ? 'a' : numWord(x.counters.per)) : K.qty(x.counters.per, st);
    const counters = `${per} ${x.counters.kind} counter${x.counters.per === 1 ? '' : 's'}`;
    return `as ${subject} ${verb}, exile up to ${K.qty(x.max, st)} ${cards} from your graveyard. ${alt('it', subject)} ${verb} with ${counters} on it for each ${one} exiled this way`;
  }
  // edh-d-73 (CR 614.12a, 708.2; Ixidron): "As ~ enters, turn all other nontoken creatures face down."
  if (body.turnFaceDown !== undefined) {
    if (Object.keys(body).some((k) => k !== 'b' && k !== 'turnFaceDown')) throw new NoRenderer('turning permanents face down as it enters, with other entering facts');
    return `as ${subject} ${verb}, turn ${K.obj({ ref: 'each', filter: body.turnFaceDown.filter }, st, 'object').text} face down`;
  }
  // edh-d-78 (CR 614.12a, 122.1; Sin, Unending Cataclysm): "As ~ enters, remove all counters from any number of artifacts, creatures, and enchantments. ~ enters with X +1/+1 counters on it, where X is
  // twice the number of counters removed this way."; nothing else in the body
  if (body.removeCounters !== undefined) {
    const x = body.removeCounters;
    if (Object.keys(body).some((k) => k !== 'b' && k !== 'removeCounters') || x.times !== 2) throw new NoRenderer('counters removed as it enters, other than "twice the number of counters removed this way", with other entering facts');
    return `as ${subject} ${verb}, remove all counters from any number of ${K.np(x.filter, st, { det: 'none', plural: true })}. ${alt('it', subject)} ${verb} with x ${x.kind} counters on it, where x is twice the number of counters removed this way`;
  }
  // edh-d-54 (CR 614.12a, 400.3; Ulamog's Despoiler): "As ~ enters, you may put two cards your opponents own from exile into their owners' graveyards. If you do, ~ enters with four +1/+1 counters on it."
  if (body.putToGraveyard !== undefined) {
    const x = body.putToGraveyard;
    const f = x.filter;
    if (Object.keys(body).some((k) => k !== 'b' && k !== 'putToGraveyard') || f.zone !== 'exile' || f.owner !== 'opponent') throw new NoRenderer('a put into graveyards as it enters other than cards your opponents own from exile');
    const { zone: _z, owner: _o, ...desc } = f;
    const cards = K.np({ ...desc, zone: 'exile', owner: 'opponent' }, st, { det: 'none', plural: x.count !== 1 });
    const counters = `${x.counters.count === 1 ? 'a' : numWord(x.counters.count)} ${x.counters.kind} counter${x.counters.count === 1 ? '' : 's'}`;
    return `as ${subject} ${verb}, you may put ${x.count === 1 ? 'a' : numWord(x.count)} ${cards} into ${x.count === 1 ? "that player's" : 'their owners\''} graveyard${x.count === 1 ? '' : 's'}. if you do, ${alt('it', subject)} ${verb} with ${counters} on it`;
  }
  // edh-c-42 (CR 702.38a, 614.12a): "As ~ enters, you may reveal any number of other artifact cards from your hand. ~ enters with a +1/+1 counter on it for each card revealed this way."
  if (body.revealHand !== undefined) {
    const x = body.revealHand;
    if (Object.keys(body).some((k) => k !== 'b' && k !== 'revealHand')) throw new NoRenderer('a reveal from the hand as it enters, with other entering facts');
    const cards = K.np({ ...x.filter, zone: 'hand' }, st, { det: 'none', plural: true, noZone: true });
    const per = typeof x.times === 'number' ? (x.times === 1 ? 'a' : numWord(x.times)) : K.qty(x.times, st);
    const counters = `${per} ${x.kind ?? '+1/+1'} counter${x.times === 1 ? '' : 's'}`;
    return `as ${subject} ${verb}, you may reveal any number of ${cards} from your hand. ${alt('it', subject)} ${verb} with ${counters} on it for each card revealed this way`;
  }
  // std-rx24 (CR 614.1c, 614.12a, 122.1b): "~ enters with your choice of a trample counter or a menace counter on it" (Ferocious Tigorilla): a choice of two
  // options of one counter each and nothing else in the body; riot's choice of a counter or haste is keyword data (never card text)
  if (body.choice !== undefined) {
    const kinds = body.choice.map((o) => (o.withAbilities === undefined && o.counters?.length === 1 && o.counters[0]!.count === 1 ? o.counters[0]!.kind : null));
    // edhn63 (CR 614.12a, 122.1b; Denry Klin, Editor in Chief): three single counters, "your choice of a +1/+1, first strike, or vigilance counter on it"
    if (kinds.length === 3 && kinds.every((k): k is string => k !== null) && new Set(kinds).size === 3 && Object.keys(body).every((k) => k === 'b' || k === 'choice')) {
      return `${subject} ${verb} with your choice of ${withArticle(`${kinds[0]!} counter`).replace(/ counter$/, '')}, ${kinds[1]!}, or ${kinds[2]!} counter on it`;
    }
    // edhn63 (CR 614.12a, 122.1b; Grimdancer): every pair of three kinds, "your choice of two different counters on it from among menace, deathtouch, and lifelink"
    const pairs = body.choice.map((o) => (o.withAbilities === undefined && o.counters?.length === 2 && o.counters.every((c) => c.count === 1) ? [o.counters[0]!.kind, o.counters[1]!.kind] : null));
    if (pairs.length === 3 && pairs.every((q): q is string[] => q !== null) && Object.keys(body).every((k) => k === 'b' || k === 'choice')) {
      const all = [...new Set(pairs.flat())];
      const want = new Set(all.length === 3 ? [`${all[0]}|${all[1]}`, `${all[0]}|${all[2]}`, `${all[1]}|${all[2]}`] : []);
      const got = new Set(pairs.map((q) => `${q[0]}|${q[1]}`));
      if (all.length === 3 && got.size === 3 && [...got].every((x) => want.has(x))) return `${subject} ${verb} with your choice of two different counters on it from among ${all[0]}, ${all[1]}, and ${all[2]}`;
    }
    if (kinds.length !== 2 || kinds.some((k) => k === null) || kinds[0] === kinds[1] || Object.keys(body).some((k) => k !== 'b' && k !== 'choice')) throw new NoRenderer('an entering choice other than two kinds of one counter');
    return `${subject} ${verb} with your choice of ${withArticle(`${kinds[0]!} counter`)} or ${withArticle(`${kinds[1]!} counter`)} on it`;
  }
  if (body.choose && body.choose.length > 0) {
    const what = body.choose.map((c) => {
      switch (c.what) {
        case 'color': return c.min === 2 && c.max === 2 && c.exclude === undefined && c.options === undefined ? 'two colors' /* edh-d-45 (CR 614.12a; Seal of the Guildpact) */ : c.exclude && c.exclude.length > 0 ? `a color other than ${joinList(c.exclude.map((x) => COLOR_WORD[x] ?? x), 'and')}` : 'a color'; // CMD3: the Thriving lands
        case 'creatureType': return c.options !== undefined && c.options.length >= 2 ? joinList(c.options, 'or') : 'a creature type'; // r4-cost (CR 205.3m): "choose Elemental, Elf, ..., or Treefolk"
        // std-rx28 (CR 205.2a): "a card type other than creature" (Arachne, Psionic Weaver)
        case 'cardType': return c.options !== undefined && c.options.length >= 2 ? joinList(c.options.map((o) => o.toLowerCase()), 'or') : c.exclude && c.exclude.length > 0 ? `a card type other than ${joinList(c.exclude.map((o) => o.toLowerCase()), 'or')}` : 'a card type'; // std-rD (CR 205.2a): "choose artifact, creature, ..., or sorcery"
        case 'landType': return c.options === undefined ? 'a land type' /* edh-d-72: Traveler's Cloak */ : 'a basic land type';
        case 'planeswalkerType': return 'a planeswalker type'; // edh-d-94 (CR 205.3j; Deification)
        // std-rx28 (CR 201.3): "choose a nonland card name" (Skyseer's Chariot)
        case 'cardName': return c.cardKind !== undefined ? alt(`a ${c.cardKind} card name`, `any ${c.cardKind} card name`) : alt('a card name', 'any card name'); // std-rx6 (CR 201.3): family a-or-any-card-name
        case 'number': return c.min !== undefined && c.max !== undefined ? `a number between ${c.min} and ${c.max}` : 'a number'; // std-rx5
        case 'player': return c.min === 2 && c.max === 2 ? 'two players' /* edhd63 (CR 614.12a; Sower of Discord) */ : 'a player';
        case 'opponent': return 'an opponent';
        // cloud r3-mech (CR 614.12a): a Siege's choice names its two words alone ("choose Abzan or Mardu"), parser/segment.ts#siegeMode
        case 'option': if (c.link === 'abilities' && c.options?.some((o) => !['flying', 'first strike', 'double strike', 'deathtouch', 'haste', 'hexproof', 'indestructible', 'lifelink', 'menace', 'reach', 'trample', 'vigilance'].includes(o))) throw new NoRenderer('a chosen ability the layers do not grant (statics/mods.ts#CHOSEN_KEYWORDS)'); return c.link === 'direction' && JSON.stringify(c.options) === '["left","right"]' ? 'left or right' /* edhd63 (CR 614.12a; Pramikon) */ : c.link === 'abilities' && c.min === 2 && c.max === 2 && c.options?.length === 3 ? `two abilities from among ${joinList(c.options, 'and')}` /* edhd63 (CR 614.12a, 702.2; Greymond) */ : c.link === 'siege' && c.options?.length === 2 ? joinList(c.options, 'or') : c.options ? `one of ${joinList(c.options, 'or')}` : 'an option';
        case 'oddEven': return 'odd or even';
        case 'landOrNonland': return 'land or nonland';
        case 'lifeTotal': if (body.choose!.length !== 1 || c.link !== 'notedLife') throw new NoRenderer('a note of a life total beside another choice'); return 'your life total'; // edh-next-144
        case 'manaTypeSpent': throw new NoRenderer('a note of the type of mana spent as a permanent enters'); // edh-mana-keywords-12
      }
    });
    // std-rx6 (CR 614.12a, 402.3): "As ~ enters, look at an opponent's hand, then choose any card name." (Sorcerous Spyglass)
    if (body.lookAtHand === 'opponent') {
      // std-rx28 (CR 614.12a, 402.3, 205.2a): "..., then choose a card type other than creature." (Arachne, Psionic Weaver)
      if (body.choose.length !== 1 || (body.choose[0]!.what !== 'cardName' && body.choose[0]!.what !== 'cardType')) throw new NoRenderer('a look at a hand before a choice other than a card name or type');
      sentences.push(`as ${subject} ${verb}, look at an opponent's hand, then choose ${body.choose[0]!.what === 'cardName' ? alt('any card name', 'a card name') : what[0]!}`); // family a-or-any-card-name
    } else if (body.choose[0]!.what === 'lifeTotal') { // edh-next-144 (CR 614.12a, 119.1; Sigarda's Splendor): "As ~ enters, note your life total." (no choice, nothing else as it enters)
      if (Object.keys(body).some((k) => k !== 'b' && k !== 'choose')) throw new NoRenderer('a note of a life total beside another way a permanent enters');
      sentences.push(`as ${subject} ${verb}, note your life total`);
    } else if (body.choose.some((c) => c.chooser !== undefined)) {
      // edh-d-72 (CR 614.12a, 608.2d; Callous Oppressor): "As ~ enters, an opponent chooses a creature type." (one choice, made by an opponent)
      if (body.choose.length !== 1 || body.choose[0]!.chooser !== 'opponent' || body.choose[0]!.what !== 'creatureType' || body.choose[0]!.options !== undefined) throw new NoRenderer('an entering choice made by another player, other than "an opponent chooses a creature type"');
      sentences.push(`as ${subject} ${verb}, an opponent chooses ${what[0]!}`);
    } else sentences.push(`as ${subject} ${verb}, choose ${joinList(what)}`);
    // FAST5 T57 (CR 614.1c, 614.12a): "~ enters tapped. As it enters, choose a color." says the tapped sentence first, and "it" for the permanent
    if (body.tapped === true && !body.tappedUnless && !body.tappedUnlessPay && !body.copy && !body.counters && !body.faceDown && !body.transformed && !body.prepared
      && !body.attachTo && !body.under && !body.withAbilities) {
      return alt(`${subject} ${verb} tapped. as ${alt('it', subject)} ${verb}, choose ${joinList(what)}`, `as ${subject} ${verb}, choose ${joinList(what)}. ${subject} ${verb} tapped`);
    }
  }
  if (body.copy) {
    // edh-next-133 (CR 614.12a, 707.5, 707.9e; The Mimeoplasm): "As ~ enters, you may exile two creature cards from graveyards. If you do, it enters as a copy of one of those cards with a number of
    // additional +1/+1 counters on it equal to the power of the other card." Only that whole shape: optional, cards from graveyards, nothing else on the copy or the entering
    if (body.copy.exilePair !== undefined) {
      const cp = body.copy;
      const f = cp.of;
      if (!cp.optional || Object.keys(cp).sort().join() !== 'exilePair,of,optional' || Object.keys(body).sort().join() !== 'b,copy' || sentences.length > 0
        || f.zone !== 'graveyard' || f.isCard !== true || f.anyOf?.length !== 1 || Object.keys(f).sort().join() !== 'anyOf,isCard,zone') throw new NoRenderer('two cards exiled as it enters, other than "you may exile two <cards> from graveyards"');
      const kinds = f.anyOf[0]!;
      if (Object.keys(kinds).some((k) => k !== 'types' && k !== 'isCard') || (kinds.types ?? []).length === 0) throw new NoRenderer('two cards exiled as it enters, of a description other than card types');
      const cards = `${kinds.types!.map((x) => x.toLowerCase()).join(' ')} cards`;
      return `as ${subject} ${verb}, you may exile two ${cards} from graveyards. if you do, it ${verb} as a copy of one of those cards with a number of additional ${cp.exilePair!.counters} counters on it equal to the power of the other card`;
    }
    // edh-next-22 (CR 400.7, 110.1; Sakashima's Protege): "any permanent that entered this turn" is on the battlefield by definition: no zone words after it
    const onBf = (body.copy.of.zone === undefined || body.copy.of.zone === 'battlefield') && !body.copy.of.self && body.copy.of.enteredThisTurn !== true ? ' on the battlefield' : ''; // T64: the zone may be stated in the filter (Mockingbird)
    // M6-10: a permanent "you control" needs no "on the battlefield": "a creature or planeswalker you control" (CR 110.1, 707.5)
    const of = body.copy.of.self ? K.np({ ...body.copy.of }, st)
      : body.copy.of.zone === undefined && (body.copy.of.controller !== undefined || (body.copy.of.anyOf?.length === 1 && body.copy.of.anyOf[0]!.controller !== undefined && body.copy.of.other === true)) // edh-perms-3: "another creature you control" (Sakashima)
        ? alt(`${K.np({ ...body.copy.of }, st, { det: 'any' })}${onBf}`, K.np({ ...body.copy.of }, st, { det: 'a' }))
        : onBf === '' && ((body.copy.of.zone !== undefined && body.copy.of.zone !== 'battlefield') || body.copy.of.enteredThisTurn === true) && body.copy.of.controller === undefined // trek-16 (Voq): "a creature card in a graveyard" is "any creature card in a graveyard"; edh-next-22: "a permanent that entered this turn" likewise
          ? alt(K.np({ ...body.copy.of }, st, { det: 'any' }), K.np({ ...body.copy.of }, st, { det: 'a' }))
          : onBattlefield(K.np({ ...body.copy.of }, st, { det: 'any' }), onBf);
    const exc = enterCopyExceptions(body.copy, st);
    // FAST5 T64 (CR 614.1c, 614.12): "You may have this land enter tapped as a copy of any land card in a graveyard" (Echoing Deeps)
    const tapped = body.copy.tapped === true ? ' tapped' : '';
    // r4-copy (CR 603.12, 614.12): "When you do, exile that card." after the choice of a card to copy (Superior Spider-Man): exactly one reflexive exile of that card
    const then = body.copy.then;
    let after = '';
    if (then !== undefined) {
      const expect = { as: then.as, do: [{ op: 'reflexive', when: { did: then.as }, targets: [], do: [{ op: 'move', what: { ref: 'bound', name: then.as }, to: { zone: 'exile' } }] }] };
      // edh-next-65 (CR 603.12, 701.26a, 502.3, 611.2b; Wall of Stolen Identity): "When you do, tap the copied creature and it doesn't untap during its controller's untap step for as long as you control ~."
      const copied = { ref: 'bound', name: then.as };
      const expectTap = { as: then.as, do: [{ op: 'reflexive', when: { did: then.as }, targets: [], do: [{ op: 'tap', what: copied }, { op: 'effect', duration: { d: 'whileSource', as: 'controlled' }, effects: [{ s: 'restrict', subject: copied, mode: 'cant', action: 'untapDuringUntapStep' }] }] }] };
      if (body.copy.optional && JSON.stringify(then) === JSON.stringify(expectTap) && body.copy.of.isCard !== true && JSON.stringify(body.copy.of.types) === '["Creature"]') {
        after = ". when you do, tap the copied creature and it doesn't untap during its controller's untap step for as long as you control ~";
      } else {
        if (!body.copy.optional || JSON.stringify(then) !== JSON.stringify(expect) || body.copy.of.isCard !== true) throw new NoRenderer('steps after an enters-as-a-copy choice other than exiling the copied card');
        after = '. when you do, exile that card';
      }
    }
    // trek-4 (CR 614.1c, 707.9): "If you do, it enters with additional counters on it equal to the same number and kinds of counters the copied permanent has
    // on it." (Dominion Saboteur): only after an optional choice ("if you do"), and not together with a reflexive step
    if (body.copy.copiedCounters === true) {
      if (!body.copy.optional || then !== undefined) throw new NoRenderer('copied counters after a copy that is not optional, or with steps after the choice');
      after = '. if you do, it enters with additional counters on it equal to the same number and kinds of counters the copied permanent has on it';
    }
    // pc-tokens-2 (CR 614.12, 611.2; Cursed Mirror): "As ~ enters, you may have it become a copy of any creature on the battlefield until end of turn, except it has haste."
    if (body.copy.duration !== undefined) {
      if (!body.copy.optional || tapped !== '' || after !== '') throw new NoRenderer('a timed enters-as-a-copy that is not optional, tapped or followed by steps');
      return `as ${subject} ${verb}, you may have it become a copy of ${of} ${K.dur(body.copy.duration, st)}${exc}`;
    }
    return body.copy.optional ? `you may have ${subject} enter${tapped} as a copy of ${of}${exc}${after}` : `${subject} ${verb}${tapped} as a copy of ${of}${exc}`;
  }
  if (body.exchangeText !== undefined) {
    // edh-next-120 (CR 614.12, 612.5, 701.12h; Deadpool, Trading Card): "As ~ enters, you may exchange his text box and another creature's."
    if (Object.keys(body).some((k) => k !== 'b' && k !== 'exchangeText') || sentences.length > 0 || JSON.stringify(body.exchangeText) !== '{"with":{"other":true,"types":["Creature"]}}') throw new NoRenderer('a text box exchange with something other than another creature');
    return `as ${subject} ${verb}, you may exchange ${alt(`${subject}'s`, 'his', 'her', 'its')} text box and another creature's`;
  }
  if (body.tappedMay !== undefined) {
    // edh-next-106 (CR 614.1c, 614.12a; Mariposa Military Base): "You may have this land enter tapped. If you do, you get two rad counters."
    const m = body.tappedMay;
    const only = m.then.length === 1 ? (m.then[0] as unknown as Record<string, unknown>) : null;
    if (Object.keys(body).some((k) => k !== 'b' && k !== 'tappedMay') || sentences.length > 0 || only === null || only['op'] !== 'putCounters' || JSON.stringify(only['on']) !== '{"ref":"you"}' || typeof only['count'] !== 'number' || only['kind'] !== 'rad' || Object.keys(only).sort().join() !== 'count,kind,on,op') throw new NoRenderer('an optional tapped entry with steps other than getting rad counters');
    return `you may have ${subject} enter tapped. if you do, you get ${only['count'] as number} rad counter${only['count'] === 1 ? '' : 's'}`;
  }
  if (body.payLifeAny !== undefined) {
    // edh-next-138 (CR 614.12a, 119.4; Phyrexian Processor): "As this artifact enters, pay any amount of life."
    if (Object.keys(body).some((k) => k !== 'b' && k !== 'payLifeAny') || sentences.length > 0 || body.payLifeAny.link !== 'lifePaid') throw new NoRenderer('a payment of any amount of life as it enters in another form');
    return `as ${subject} ${verb}, pay any amount of life`;
  }
  if (body.countersIfPay !== undefined) {
    // edh-d-54 (CR 614.12a, 701.20a; Dragon's Disciple): "As ~ enters, you may reveal a Dragon card from your hand. If you do or if you control a Dragon, ~ enters with a +1/+1 counter on it."
    const x = body.countersIfPay;
    if (Object.keys(body).some((k) => k !== 'b' && k !== 'countersIfPay') || x.or === undefined || x.counters.length !== 1 || typeof x.counters[0]!.count !== 'number' || sentences.length > 0) throw new NoRenderer('counters for a payment as it enters in another form');
    const pay = K.cost(x.cost, st).replace(/^Pay /, 'pay ');
    if (!/^reveal (.+) from your hand$/i.test(firstAlt(pay))) throw new NoRenderer('a payment other than revealing a card from your hand');
    const c = x.counters[0]! as { kind: string; count: number }; // (a number: checked above)
    return `as ${subject} ${verb}, you may ${lowerFirst(pay)}. if you do or if ${K.cond(x.or, st)}, ${alt('it', subject)} ${verb} with ${c.count === 1 ? 'a' : numWord(c.count)} ${c.kind} counter${c.count === 1 ? '' : 's'} on it`;
  }
  if (body.tappedUnlessPay) {
    const pay = K.cost(body.tappedUnlessPay, st).replace(/^Pay /, 'pay ');
    // std-rx9 (family enters-choose-then-pay): after the choice sentence of the same replacement, the payment also reads "then you may pay 2 life" (Multiversal Passage)
    const asEnters = `as ${subject} ${verb}, you may ${lowerFirst(pay)}`;
    const lead = sentences.length > 0 ? alt(asEnters, `then you may ${lowerFirst(pay)}`) : asEnters;
    // edh-perms-12 (CR 614.1c, 614.12, 701.20a; Temple of the Dragon Queen): "... enters tapped unless you revealed a Dragon card this way or you control a Dragon": the one condition
    // beside the reveal (a payment other than revealing a card from your hand has no "this way" wording here)
    const revealed = body.tappedUnless !== undefined ? /^reveal (.+) from your hand$/.exec(firstAlt(lowerFirst(pay))) : null;
    if (body.tappedUnless !== undefined && revealed === null) throw new NoRenderer('a condition beside a payment other than revealing a card from your hand');
    if (body.tappedUnless !== undefined && sentences.length > 0) throw new NoRenderer('a condition beside a payment after another choice');
    if (revealed !== null) sentences.push(`${asEnters}. ${subject} ${verb} tapped unless you revealed ${revealed[1]} this way or ${K.cond(body.tappedUnless!, st)}`);
    else sentences.push(`${lead}. if you don't, ${alt('it', subject)} ${verb} tapped`);
  } else if (body.tappedUnless) {
    sentences.push(tappedUnlessWords(body.tappedUnless, subject, verb, st));
  } else if (body.tapped) parts.push('tapped');
  if (body.untapped === true) parts.push('untapped'); // r5-fxb: "Lands you control enter untapped." (CR 614.1d)
  if (body.counters && body.counters.length > 0) {
    // M6-5 (CR 702.33d-e): "with a +1/+1 counter on it for each time it was kicked", "two ... counters ... for each time it was kicked"
    const kicked = body.counters.length === 1 ? perKick(body.counters[0]!.count) : null;
    const per = kicked !== null ? ` for each ${countParts(kicked.per, st)!.singular}` : '';
    // FAST4 T28 (CR 107.3, 608.2h, 614.1c): one kind with a computed number is "with a +1/+1 counter on it for each creature card in your graveyard" or "with X
    // +1/+1 counters on it, where X is the number of other creatures on the battlefield"; each reading starts from the same state
    const one = kicked === null && body.counters.length === 1 && typeof body.counters[0]!.count === 'object' && body.counters[0]!.count.q !== 'X' ? body.counters[0]! : null;
    const fork = one ? cloneState(st) : null;
    // FAST5X E24 (CR 201.5): the object's own entering may also put the counters "on ~" (a character card's "enters with a shield counter on him")
    const onIt = subject === '~' ? alt('it', 'them', '~') : alt('it', 'them');
    const list = kicked !== null
      ? `${kicked.n === 1 ? 'a' : numWord(kicked.n)} ${body.counters[0]!.kind} counter${kicked.n === 1 ? '' : 's'}`
      : joinList(body.counters.map((c) => `${typeof c.count === 'number' ? (c.count === 1 ? 'a' : numWord(c.count)) : K.qty(c.count, st)} ${c.kind} counter${c.count === 1 ? '' : 's'}`));
    if (one && fork) {
      const each = countParts(one.count, cloneState(fork));
      // every player's permanents: "the number of other creatures" is "the number of other creatures on the battlefield" (family on-the-battlefield, CR 110.1)
      const c = one.count as Quantity;
      const f = typeof c === 'object' && c.q === 'count' && c.of.ref === 'each' ? c.of.filter : undefined;
      const bf = f !== undefined && f.controller === undefined && f.owner === undefined && (f.zone === undefined || f.zone === 'battlefield') ? alt('', ' on the battlefield') : '';
      const variants = [
        `with ${list} on ${onIt}`,
        `with X ${one.kind} counters on ${onIt}, where X is ${K.qty(one.count, cloneState(fork))}${bf}`,
        // FAST5 T51 (equivalence enters-number-of-counters): "with a number of +1/+1 counters on it equal to the amount of mana spent to cast it"
        `with a number of ${one.kind} counters on ${onIt} equal to ${K.qty(one.count, cloneState(fork))}${bf}`,
        ...(each ? [`with ${alt('a', 'an additional')} ${one.kind} counter on ${onIt} for each ${each.singular}${bf}`] : []),
        ...plusEach(one, onIt, fork),
        ...sumEach(one, onIt, fork),
        ...timesEach(one, onIt, fork),
      ];
      parts.push(alt(...variants));
    } else if (kicked === null && body.counters.length === 2 && body.counters.every((c) => typeof c.count === 'object' && c.count.q === 'count')) {
      // edh-next-16 (CR 614.1c, 122.6, 107.3; Ulasht, the Hate Seed): two counts, each with its own counters: "with a +1/+1 counter on it for each other red creature you control and a +1/+1 counter on it for each other green creature you control"
      const [c0, c1] = body.counters as [typeof body.counters[0], typeof body.counters[0]];
      const e0 = countParts(c0.count, st);
      const e1 = countParts(c1.count, st);
      if (!e0 || !e1) throw new NoRenderer('counters for each of two counts that the renderer cannot name');
      parts.push(`with a ${c0.kind} counter on ${onIt} for each ${e0.singular} and a ${c1.kind} counter on ${onIt} for each ${e1.singular}`);
    } else if (kicked === null && body.counters.every((c) => typeof c.count === 'number' && c.count >= 1)) {
      // cmd1 (CR 614.1c, 616.1, 122.6; family additional-counters): "enters with an additional +1/+1 counter on it" gives the counters on top of any other
      // replacement effect's, which is what "enters with a +1/+1 counter on it" does too (Master Chef's granted "This creature enters with an additional ...")
      const more = joinList(body.counters.map((c) => (c.count === 1 ? `an additional ${c.kind} counter` : `${numWord(c.count as number)} additional ${c.kind} counters`)));
      parts.push(`with ${alt(list, more)} on ${onIt}`);
    } else parts.push(`with ${list} on ${onIt}${per}`);
  }
  if (body.faceDown) parts.push('face down');
  if (body.transformed) parts.push('transformed');
  if (body.prepared) parts.push('prepared'); // M6-0: "This creature enters prepared." (CR 722.3a)
  if (body.attachTo) parts.push(`attached to ${K.obj(body.attachTo, st, 'object').text}`);
  if (body.under) parts.push(body.under.ref === 'anOpponent' ? 'under the control of an opponent of your choice' /* edh-top-5 (Xantcha; CR 614.12, 110.2): the controller of the object picks the opponent */ : `under ${K.player(body.under, st, 'possessive').text} control`);
  if (body.withAbilities && body.withAbilities.length > 0) parts.push(`with ${joinList(body.withAbilities.map((a) => abilityWords(a, st)))}`);
  if (parts.length > 0) sentences.push(`${subject} ${verb} ${joinList(parts)}`.replace(' tapped and with', alt(' tapped with', ' tapped and with'))); // FAST1 T5: joinList writes "tapped and with"; Oracle says "enters tapped with"
  return sentences.join('. ');
}

/**
 * r4-repl (CR 614.1c, 122.6, 107.3): "~ enters with a +1/+1 counter on it plus an additional +1/+1 counter on it for each other creature you control" (Sheriff of
 * Safe Passage): one kind, N plus a count of objects (`{q: 'math', op: '+', args: [N, count]}`, the template rep.r4repl.enters.counter.plusAdditional.forEach).
 */
/**
 * edh-b-8 (CR 614.1c, 608.2h; Unbreathing Horde): the sum of two counts is "with a +1/+1 counter on it for each other Zombie you control and each Zombie card in
 * your graveyard": one counter for each of the things the first count counts and each of the things the second counts (nothing else).
 */
function sumEach(one: { kind: string; count: Quantity }, onIt: string, st: RenderState): string[] {
  const c = one.count;
  if (typeof c !== 'object' || c.q !== 'math' || c.op !== '+' || c.args.length !== 2 || c.args.some((a) => typeof a !== 'object' || a.q !== 'count')) return [];
  const [a, b] = c.args.map((x) => countParts(x, cloneState(st)));
  if (!a || !b) return [];
  return [`with a ${one.kind} counter on ${onIt} for each ${a.singular} and each ${b.singular}`];
}

function plusEach(one: { kind: string; count: Quantity }, onIt: string, st: RenderState): string[] {
  const c = one.count;
  if (typeof c !== 'object' || c.q !== 'math' || c.op !== '+' || c.args.length !== 2 || typeof c.args[0] !== 'number' || c.args[0] < 1) return [];
  const n = c.args[0];
  const each = countParts(c.args[1]!, cloneState(st));
  if (each === null) return [];
  return [`with ${n === 1 ? 'a' : numWord(n)} ${one.kind} counter${n === 1 ? '' : 's'} on ${onIt} plus an additional ${one.kind} counter on ${onIt} for each ${each.singular}`];
}

/**
 * edh-c-12 (CR 614.1c, 122.6, 107.3; Hamlet Vanguard): "~ enters with two +1/+1 counters on it for each other nontoken Human you control": one kind, N (two or more) times a
 * count of objects (`{q: 'math', op: '*', args: [N, count]}`, the template rep.edhv12.enters.nCounters.forEach).
 */
function timesEach(one: { kind: string; count: Quantity }, onIt: string, st: RenderState): string[] {
  const c = one.count;
  if (typeof c !== 'object' || c.q !== 'math' || c.op !== '*' || c.args.length !== 2 || typeof c.args[0] !== 'number' || c.args[0] < 2 || typeof c.args[1] !== 'object') return [];
  const each = countParts(c.args[1], cloneState(st));
  return each === null ? [] : [`with ${numWord(c.args[0])} ${one.kind} counters on ${onIt} for each ${each.singular}`];
}

/**
 * FAST4 T28: "each <one of them> enters with an additional +1/+1 counter on it" for an entering body that only gives counters of fixed numbers to objects of a
 * filter (CR 614.1c, 122.6); null for any other body.
 */
function additionalEach(body: Extract<ReplacementDef['body'], { b: 'enters' }>, subject: ObjectFilter, st: RenderState): string | null {
  const keys = Object.keys(body).filter((k) => (body as Record<string, unknown>)[k] !== undefined);
  if (keys.some((k) => k !== 'b' && k !== 'counters') || !body.counters || body.counters.length === 0) return null;
  // FAST5 T65 (CR 614.1c, 122.6, 603.6a): "each creature you control enters with an additional +1/+1 counter on it for each land that entered the battlefield under your
  // control this turn": one kind, a number counted from the turn's history of entries (nothing else is read this way)
  const only = body.counters.length === 1 ? body.counters[0]! : null;
  if (only !== null && typeof only.count === 'object' && only.count.q === 'happenedCount') {
    const each = countParts(only.count, st);
    return each === null ? null : `${K.np(subject, st, { det: 'each' })} enters with an additional ${only.kind} counter on it for each ${each.singular}`;
  }
  // r4-repl (CR 614.1c, 614.12, 122.6): "Each other Angel you control enters with an additional +1/+1 counter on it for each Angel you already control" (Giada, Font
  // of Hope): a count of what you control as the permanent enters, the permanent itself not yet among them (`{anyOf: [G], controller: 'you'}`, nothing else)
  if (only !== null && typeof only.count === 'object' && only.count.q === 'count' && only.count.of.ref === 'each' && 'filter' in only.count.of) {
    const f = only.count.of.filter;
    // pc-counters-1: any other count of objects falls through to the computed-number wordings below
    if (Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join() === 'anyOf,controller' && f.controller === 'you' && f.anyOf?.length === 1) {
      return `${K.np(subject, st, { det: 'each' })} enters with an additional ${only.kind} counter on it for each ${K.np(f.anyOf[0]!, st, { det: 'none', forEach: true })} you already control`;
    }
  }
  // trek-14 (CR 614.1c, 614.12, 122.6, 205.3m; Jean-Luc, Mon Capitaine): "Faeries you control enter with an additional +1/+1 counter on them for each creature type among non-Borg creatures
  // you already control": the number of creature types among what you control as the permanent enters, the permanent itself not yet among them
  if (only !== null && typeof only.count === 'object' && only.count.q === 'distinct' && only.count.what === 'creatureTypes' && only.count.among.ref === 'each' && 'filter' in only.count.among) {
    const f = only.count.among.filter;
    if (Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join() === 'anyOf,controller' && f.controller === 'you' && f.anyOf?.length === 1) {
      return alt(
        `${K.np(subject, st, { det: 'none', plural: true })} enter with an additional ${only.kind} counter on them for each creature type among ${K.np(f.anyOf[0]!, st, { det: 'none', plural: true })} you already control`,
        `${K.np(subject, st, { det: 'each' })} enters with an additional ${only.kind} counter on it for each creature type among ${K.np(f.anyOf[0]!, st, { det: 'none', plural: true })} you already control`,
      );
    }
  }
  // edh-perms-14 (CR 614.1c, 614.12, 122.6, 106.3; Kalain, Coin of Mastery): "Other creatures you control enter with an additional +1/+1 counter on them for each mana from a
  // Treasure spent to cast them", "Each creature you control enters with an additional +1/+1 counter on it for each mana from an artifact source spent to cast it": a
  // source of one subtype is said "a Treasure", one of a card type "an artifact source"
  if (only !== null && typeof only.count === 'object' && only.count.q === 'spellManaSpent' && only.count.of?.ref === 'subject' && only.count.from !== undefined) {
    const from = only.count.from;
    const source = from.types !== undefined ? `${K.np(from, st, { det: 'a' })} source` : K.np(from, st, { det: 'a' });
    return alt(
      `${K.np(subject, st, { det: 'each' })} enters with an additional ${only.kind} counter on it for each mana from ${source} spent to cast it`,
      `${K.np(subject, st, { det: 'none', plural: true })} enter with an additional ${only.kind} counter on them for each mana from ${source} spent to cast them`,
    );
  }
  // pc-counters-1 (CR 614.1c, 614.12, 122.6, 107.3): "Each other creature you control enters with an additional X +1/+1 counters on it, where X is the number of +1/+1
  // counters on ~" (Bloodspore Thrinax) and "... with a number of additional +1/+1 counters on it equal to ~'s toughness" (Arwen, Weaver of Hope): one kind, a computed
  // number, on top of any other replacement effect's; the two wordings are the same JSON (the count is read as the object enters)
  if (only !== null && typeof only.count === 'object' && only.count.q !== 'X') {
    const subjectText = K.np(subject, st, { det: 'each' });
    const asX = K.qty(only.count, cloneState(st));
    const asEqual = K.qty(only.count, cloneState(st));
    return alt(`${subjectText} enters with an additional X ${only.kind} counters on it, where X is ${asX}`, `${subjectText} enters with a number of additional ${only.kind} counters on it equal to ${asEqual}`);
  }
  if (body.counters.some((c) => typeof c.count !== 'number' || c.count < 1)) return null;
  const list = joinList(body.counters.map((c) => (c.count === 1 ? `an additional ${c.kind} counter` : `${numWord(c.count as number)} additional ${c.kind} counters`)));
  return `${K.np(subject, st, { det: 'each' })} enters with ${list} on it`;
}

/**
 * Cloud r3-repl (CR 614.1c, 614.12, 202.3): two entering replacements of the same filter F that only give counters of fixed numbers, the first for F with mana
 * value N or less, the second for F with mana value greater than N (each `{anyOf: [F], manaValue}`, zz-cloud/r3-repl.json): "each F enters with an additional
 * +1/+1 counter on it if its mana value is N or less. otherwise, it enters with three additional +1/+1 counters on it". null for anything else.
 */
function manaValueSplit(a: StaticEffect, b: StaticEffect, st: RenderState): string | null {
  type Split = { f: ObjectFilter; cmp: { op: string; value: unknown }; body: Extract<ReplacementDef['body'], { b: 'enters' }> };
  const part = (x: StaticEffect): Split | null => {
    if (x.s !== 'replace' || x.condition !== undefined || x.optional === true || x.shield !== undefined || x.selfReplacement === true) return null;
    const r = x.replaces;
    if (r.ev !== 'zoneChange' || r.to !== 'battlefield' || r.from !== undefined || r.cause !== undefined || x.body.b !== 'enters') return null;
    const keys = Object.keys(r.subject).filter((k) => (r.subject as Record<string, unknown>)[k] !== undefined);
    if (keys.length !== 2 || r.subject.anyOf?.length !== 1 || r.subject.manaValue === undefined) return null;
    return { f: r.subject.anyOf[0]!, cmp: r.subject.manaValue as Split['cmp'], body: x.body };
  };
  const lo = part(a);
  const hi = part(b);
  if (!lo || !hi || lo.cmp.op !== '<=' || hi.cmp.op !== '>' || typeof lo.cmp.value !== 'number' || lo.cmp.value !== hi.cmp.value) return null;
  if (JSON.stringify(lo.f) !== JSON.stringify(hi.f)) return null;
  if ([lo.body, hi.body].some((b) => b.counters?.some((c) => typeof c.count !== 'number'))) return null; // pc-counters-1: only fixed numbers are split by mana value
  const first = additionalEach(lo.body, lo.f, st);
  const second = additionalEach(hi.body, { types: ['Creature'] }, cloneState(st));
  if (first === null || second === null) return null;
  const rest = second.replace(/^.*? enters with /, '');
  return `${first} if its mana value is ${K.qty(lo.cmp.value, st)} or less. otherwise, it enters with ${rest}`;
}

/**
 * Cloud r3-repl (CR 614.1a, 122.6): two `modify.count` replacements of the counters you put, one on any permanent (`on: {}`), one on any player (`on: {player:
 * 'any'}`), the same change, no kind and no condition: "if you would put one or more counters on a permanent or player, put twice that many of each of those
 * kinds of counters on that permanent or player instead". null for anything else.
 */
function permanentOrPlayerCounters(a: StaticEffect, b: StaticEffect, st: RenderState): string | null {
  const plain = (x: StaticEffect): x is ReplacementDef => x.s === 'replace' && x.condition === undefined && x.optional !== true && x.shield === undefined && x.selfReplacement !== true
    && x.replaces.ev === 'counters' && x.replaces.change === 'put' && (x.replaces.by === 'you' || x.replaces.by === 'opponent') && x.replaces.kind === undefined && x.replaces.atLeast === undefined
    && x.replaces.byEffect === undefined && x.body.b === 'modify' && x.body.count !== undefined && x.body.amount === undefined && x.body.destination === undefined && x.body.to === undefined;
  if (!plain(a) || !plain(b)) return null;
  const ra = a.replaces as Extract<EventPattern, { ev: 'counters' }>;
  const rb = b.replaces as Extract<EventPattern, { ev: 'counters' }>;
  const ca = (a.body as Extract<ReplacementDef['body'], { b: 'modify' }>).count!;
  if (JSON.stringify(ca) !== JSON.stringify((b.body as Extract<ReplacementDef['body'], { b: 'modify' }>).count)) return null;
  if (ra.by !== rb.by) return null;
  // edh-replace-1 (CR 614.1a, 122.6, 107.1a): the counters an OPPONENT would put, half as many, rounded down (Vorinclex, Monstrous Raider): "If an opponent would put one
  // or more counters on a permanent or player, they put half that many of each of those kinds of counters on that permanent or player instead, rounded down."
  if (ra.by === 'opponent') {
    if (JSON.stringify(ra.on) !== '{}' || JSON.stringify(rb.on) !== '{"player":"any"}' || JSON.stringify(ca) !== '{"mul":0.5}') return null;
    return 'if an opponent would put one or more counters on a permanent or player, they put half that many of each of those kinds of counters on that permanent or player instead, rounded down';
  }
  // p2-replace-events-1 (CR 614.1a, 122.6): the counters you put on permanents of a filter and on yourself, one more of each kind: "If you would put one or more
  // counters on a creature or planeswalker you control or on yourself, put that many plus one of each of those kinds of counters on that permanent or player
  // instead." (Lae'zel, Vlaakith's Champion)
  if (!('player' in ra.on) && JSON.stringify(ra.on) !== '{}' && JSON.stringify(rb.on) === '{"player":"you"}' && ca.add !== undefined && ca.mul === undefined && ca.set === undefined) {
    return `if you would put one or more counters on ${K.np(ra.on, st, { det: 'a' })} or on yourself, put that many plus ${K.qty(ca.add, st)} of each of those kinds of counters on that permanent or player instead`;
  }
  if (JSON.stringify(ra.on) !== '{}' || JSON.stringify(rb.on) !== '{"player":"any"}') return null;
  return `if you would put one or more counters on a permanent or player, put ${amountChange(ca, st, 'of each of those kinds of counters')} on that permanent or player instead`;
}

/**
 * Cloud r3-repl (CR 614.1a, 120.2b): a static replacement of noncombat damage to an opponent by a source of a filter whose new amount is the greater of that
 * damage and N (`{set: {q: 'math', op: 'max', args: [{q: 'eventAmount'}, N]}}`): "if <source> would deal an amount of noncombat damage less than N to an
 * opponent, that source deals damage equal to N instead". null for anything else.
 */
function raisedDamage(e: ReplacementDef, duration: Duration | undefined, st: RenderState): string | null {
  const ev = e.replaces;
  const b = e.body;
  if (ev.ev !== 'damage' || b.b !== 'modify' || duration !== undefined || e.condition !== undefined || e.optional === true || e.shield !== undefined || e.selfReplacement === true) return null;
  if (ev.combat !== false || ev.amount !== undefined || ev.excess !== undefined || ev.source === undefined || JSON.stringify(ev.recipient) !== '{"player":"opponent"}') return null;
  const set = b.amount?.set;
  if (b.destination !== undefined || b.count !== undefined || b.to !== undefined || b.amount?.mul !== undefined || b.amount?.add !== undefined || b.amount?.round !== undefined) return null;
  if (typeof set !== 'object' || set.q !== 'math' || set.op !== 'max' || set.args.length !== 2 || JSON.stringify(set.args[0]) !== '{"q":"eventAmount"}') return null;
  const n = K.qty(set.args[1]!, st);
  return `if ${K.np(ev.source, st, { det: 'a', head: 'source' })} would deal an amount of noncombat damage less than ${n} to an opponent, that source deals damage equal to ${n} instead`;
}

/** edh-players-3: the amount `min(the damage, your life total - 1)` of the life floor (the loss that would leave you with less than 1 life is only as large as your life total less 1), which applies while your life total is 1 or more (a resolved effect keeps the quantities unevaluated, they are read at the replacement's own time). edh-next-5: the floor `n` (Elderscale Wurm: 7). */
export const lifeFloorSet = (n: number) => ({ q: 'math', op: 'min', args: [{ q: 'eventAmount' }, { q: 'math', op: '-', args: [{ q: 'life', of: { ref: 'you' } }, n] }] }) as const;
export const LIFE_FLOOR_SET = lifeFloorSet(1);
/** edh-players-3: the condition of the life floor, your life total is the floor or more (with less than that, damage lowers it further as normal, ruling of 2021-03-19). */
export const lifeFloorWhen = (n: number) => ({ cond: 'compare', left: { q: 'life', of: { ref: 'you' } }, op: '>=', right: n }) as const;
export const LIFE_FLOOR_WHEN = lifeFloorWhen(1);

/**
 * edh-players-3 (CR 120.3a, 614.1a, 104.3b): a replacement of the life you would lose because damage is dealt to you, whose amount is set to the damage or
 * your life total less the floor if that is less (lifeFloorSet), while your life total is the floor or more (lifeFloorWhen), for a duration: "Until end of turn,
 * damage that would reduce your life total to less than 1 reduces it to 1 instead." Infect damage and any other loss of life are not that event (`fromDamage`).
 * edh-next-5 (Fortune Thief, Elderscale Wurm; ruling 2018-03-16, 2012-07-01): the same of a static ability, without a duration: "Damage that would reduce your life total to
 * less than 1 reduces it to 1 instead." (the condition of a floor of 1 is the rule's own, not said) and, for a floor above 1, "As long as you have 7 or more life, damage that
 * would reduce your life total to less than 7 reduces it to 7 instead." null for anything else.
 */
function lifeFloorFromDamage(e: ReplacementDef, duration: Duration | undefined, st: RenderState): string | null {
  const ev = e.replaces;
  const b = e.body;
  if (ev.ev !== 'life' || ev.change !== 'loss' || ev.fromDamage !== true || ev.amount !== undefined || ev.player !== 'you' || Object.keys(ev).length !== 4) return null;
  if (b.b !== 'modify' || e.optional === true || e.shield !== undefined || e.selfReplacement === true) return null;
  // edh-next-61 (CR 120.3a, 614.1a; Worship): "If you control a creature, damage that would reduce your life total to less than 1 reduces it to 1 instead." The floor's own
  // condition first, then the one the card says (lifeFloorWhen(1) is the rule's own, not said); only for a floor of 1 and no duration
  const allOf = e.condition as { cond?: string; of?: Condition[] } | undefined;
  if (allOf?.cond === 'all' && allOf.of?.length === 2 && JSON.stringify(allOf.of[0]) === JSON.stringify(LIFE_FLOOR_WHEN) && duration === undefined
    && JSON.stringify(b) === JSON.stringify({ b: 'modify', amount: { set: LIFE_FLOOR_SET } })) {
    return `if ${K.cond(allOf.of[1]!, st)}, damage that would reduce your life total to less than 1 reduces it to 1 instead`;
  }
  const cond = e.condition as { right?: unknown } | undefined;
  const n = typeof cond?.right === 'number' && Number.isInteger(cond.right) && cond.right >= 1 ? cond.right : null;
  if (n === null || JSON.stringify(e.condition) !== JSON.stringify(lifeFloorWhen(n)) || JSON.stringify(b) !== JSON.stringify({ b: 'modify', amount: { set: lifeFloorSet(n) } })) return null;
  const core = `damage that would reduce your life total to less than ${n} reduces it to ${n} instead`;
  if (duration !== undefined) return n === 1 ? `${K.dur(duration, st)}, ${core}` : null;
  return n === 1 ? core : `as long as you have ${n} or more life, ${core}`;
}

/**
 * edh-next-49 (CR 120.3a, 614.1a; Archon of Coronation): the static replacement of the life you would lose because damage is dealt to you, set to nothing (`set: 0`):
 * "damage doesn't cause you to lose life" (the condition, "As long as you're the monarch", is the static ability's own). Infect damage and any other loss of life are not
 * that event (`fromDamage`). null for anything else.
 */
function noLifeLossFromDamage(e: ReplacementDef, duration: Duration | undefined): string | null {
  const ev = e.replaces;
  if (ev.ev !== 'life' || ev.change !== 'loss' || ev.fromDamage !== true || ev.amount !== undefined || ev.player !== 'you' || Object.keys(ev).length !== 4) return null;
  if (duration !== undefined || e.condition !== undefined || e.optional === true || e.shield !== undefined || e.selfReplacement === true) return null;
  if (JSON.stringify(e.body) !== JSON.stringify({ b: 'modify', amount: { set: 0 } })) return null;
  return "damage doesn't cause you to lose life";
}

/**
 * Cloud r3-repl (CR 614.9): two static redirections to the source itself, one of all damage that would be dealt to you, one of all damage that would be dealt
 * to the other permanents you control (`{object: {other: true, controller: 'you'}}`), nothing else in either.
 */
function youAndOthersToSelf(a: StaticEffect, b: StaticEffect): boolean {
  const bare = (x: StaticEffect, recipient: string): boolean => x.s === 'replace' && x.condition === undefined && x.optional !== true && x.shield === undefined && x.selfReplacement !== true
    && JSON.stringify(x.replaces) === JSON.stringify({ ev: 'damage', recipient: JSON.parse(recipient) }) && JSON.stringify(x.body) === JSON.stringify({ b: 'redirect', to: { ref: 'self' } });
  return bare(a, '{"player":"you"}') && bare(b, '{"object":{"other":true,"controller":"you"}}');
}

/**
 * Cloud r3-repl (CR 614.1a, 614.5, 111.1): a static `modify` of the tokens you would create whose only change is one more token created right after them
 * (`then.do` = one `createToken` of one token by you): "if you would create one or more artifact tokens, instead create those tokens plus an additional Map
 * token". With no token filter the build is r4-repl's and is said by `tokensPlusOnePassive` (both readings). null for anything else.
 */
function tokensPlusOne(e: ReplacementDef, duration: Duration | undefined, st: RenderState): string | null {
  const ev = e.replaces;
  const b = e.body;
  if (ev.ev !== 'createToken' || b.b !== 'modify' || b.then === undefined || duration !== undefined || e.condition !== undefined || e.optional === true || e.shield !== undefined) return null;
  if (b.destination !== undefined || b.amount !== undefined || b.count !== undefined || b.to !== undefined || ev.player !== 'you' || ev.byEffect !== undefined || ev.token === undefined) return null;
  const one = b.then.do.length === 1 ? b.then.do[0]! : undefined;
  if (one === undefined || one.op !== 'createToken' || one.count !== 1 || JSON.stringify(one.who) !== '{"ref":"you"}') return null;
  const predefined = typeof one.token === 'object' && one.token !== null ? (one.token as { predefined?: string }).predefined : undefined;
  // p2-replace-events-1 (CR 614.1a, 111.1): of a token description that is not a predefined token, the passive "If one or more artifact tokens would be created
  // under your control, those tokens plus an additional 1/1 colorless Thopter artifact creature token with flying are created instead." (Stridehangar Automaton)
  if (predefined === undefined && ev.token.types?.length === 1 && Object.keys(ev.token).join() === 'types') {
    // edh-perms-11 (Queen Allenal of Ruadach): Oracle also says it without "additional", "those tokens plus a 1/1 white Soldier creature token are created instead"
    const added = tokenText(one.token, 1, false, st);
    return `if one or more ${ev.token.types[0]!.toLowerCase()} tokens would be created under your control, those tokens plus ${alt(additionalToken(added), added)} are created instead`;
  }
  if (predefined === undefined || Object.keys(one.token as object).length !== 1) return null; // a predefined token only ("a Map token", CR 111.10)
  const tokens = K.np({ ...ev.token, token: true }, st, { det: 'none', plural: true, count: 'one or more' });
  return `if you would create ${tokens}, instead create those tokens plus an additional ${predefined} token`;
}

/**
 * pc-tokens-2 (CR 614.1a, 614.5, 111.10; Academy Manufactor): "If you would create a Clue, Food, or Treasure token, instead create one of each.": a modify of the
 * creation of one of those three predefined tokens whose `then` makes the three of the same number, each skipping the token being replaced (`exceptReplaced`). null otherwise.
 */
function oneOfEachToken(e: ReplacementDef, duration: Duration | undefined): string | null {
  const ev = e.replaces;
  const b = e.body;
  if (ev.ev !== 'createToken' || b.b !== 'modify' || b.then === undefined || duration !== undefined || e.condition !== undefined || e.optional === true || e.shield !== undefined) return null;
  if (b.destination !== undefined || b.amount !== undefined || b.count !== undefined || b.to !== undefined || ev.player !== 'you' || ev.byEffect !== undefined) return null;
  const kinds = ['Clue', 'Food', 'Treasure'];
  if (JSON.stringify(ev.token) !== JSON.stringify({ anyOf: kinds.map((k) => ({ subtypes: [k] })) })) return null;
  const expect = kinds.map((k) => ({ op: 'createToken', who: { ref: 'you' }, count: { q: 'resultCount', step: b.then!.as }, token: { predefined: k }, exceptReplaced: true }));
  if (JSON.stringify(b.then.do) !== JSON.stringify(expect)) return null;
  return 'if you would create a clue, food, or treasure token, instead create one of each';
}

/**
 * edh-next-46 (CR 614.1a, 614.5, 111.10; Bilbo, Fellow Conspirator): "If you would create a Food token, instead create a Food token and a Treasure token.": a modify of the
 * creation of a Food token whose `then` makes the Food token again (skipping the one being replaced, `exceptReplaced`) and a Treasure token, of the same number. null otherwise.
 */
function foodAndTreasureToken(e: ReplacementDef, duration: Duration | undefined): string | null {
  const ev = e.replaces;
  const b = e.body;
  if (ev.ev !== 'createToken' || b.b !== 'modify' || b.then === undefined || duration !== undefined || e.condition !== undefined || e.optional === true || e.shield !== undefined) return null;
  if (b.destination !== undefined || b.amount !== undefined || b.count !== undefined || b.to !== undefined || ev.player !== 'you' || ev.byEffect !== undefined) return null;
  if (JSON.stringify(ev.token) !== JSON.stringify({ subtypes: ['Food'] })) return null;
  const count = { q: 'resultCount', step: b.then.as };
  const expect = [
    { op: 'createToken', who: { ref: 'you' }, count, token: { predefined: 'Food' }, exceptReplaced: true },
    { op: 'createToken', who: { ref: 'you' }, count, token: { predefined: 'Treasure' } },
  ];
  if (JSON.stringify(b.then.do) !== JSON.stringify(expect)) return null;
  return 'if you would create a food token, instead create a food token and a treasure token';
}

/** p2-replace-events-1: "a Food token" / "1 Food token" said "an additional Food token" (the token a replacement adds to the ones being created, CR 614.1a). */
const additionalToken = (one: string): string => one.replace(/^(1|a|an) /, '$1 additional ');

/**
 * p2-replace-events-1 (CR 614.1a, 122.1, 122.6): a replacement of the counters you would get, any kind, one more of each: "If you would get one or more counters,
 * you get that many plus one of each of those kinds of counters instead." (Winding Constrictor). null for anything else.
 */
function youGetCounters(e: ReplacementDef, duration: Duration | undefined, st: RenderState): string | null {
  const ev = e.replaces;
  const b = e.body;
  if (ev.ev !== 'counters' || ev.change !== 'put' || JSON.stringify(ev.on) !== '{"player":"you"}' || ev.kind !== undefined || ev.by !== undefined || ev.byEffect !== undefined || ev.atLeast !== undefined) return null;
  if (b.b !== 'modify' || b.count === undefined || b.count.add === undefined || b.count.mul !== undefined || b.count.set !== undefined || b.amount !== undefined || b.destination !== undefined || b.to !== undefined || b.then !== undefined) return null;
  if (duration !== undefined || e.condition !== undefined || e.optional === true || e.shield !== undefined) return null;
  return `if you would get one or more counters, you get that many plus ${K.qty(b.count.add, st)} of each of those kinds of counters instead`;
}

/**
 * p2-replace-events-3 (CR 614.1a, 614.10, 500.7; family extra-turn-skip-they): "If a player would begin an extra turn, that player skips that turn instead." (Ugin's
 * Nexus; "an opponent", Stranglehold): the extra turn of any player or of an opponent skipped, said "that player skips" or "they skip". null for anything else.
 */
function extraTurnSkipped(e: ReplacementDef, duration: Duration | undefined): string | null {
  const ev = e.replaces;
  if (ev.ev !== 'beginTurn' || ev.extra !== true || e.body.b !== 'skip' || duration !== undefined || e.condition !== undefined || e.optional === true || e.shield !== undefined) return null;
  const who = ev.whose === 'any' ? 'a player' : ev.whose === 'opponent' ? 'an opponent' : null;
  if (who === null) return null;
  return `if ${who} would begin an extra turn, ${alt('that player skips', 'they skip')} that turn instead`;
}

/**
 * r4-repl (CR 614.1a, 121.2): a replacement of your draw of one or more cards (the `drawMany` proposal, effects/proposal-kinds/draw-many.ts) that adds to its number:
 * "if you would draw one or more cards, you draw that many cards plus one instead", with its condition said first ("As long as you have one or fewer cards in
 * hand, ..."). null for anything else.
 */
function drawManyPlus(e: ReplacementDef, duration: Duration | undefined, st: RenderState): string | null {
  const ev = e.replaces;
  const b = e.body;
  if (ev.ev !== 'action' || ev.verb !== 'draw' || ev.actor !== 'you' || ev.object !== undefined || b.b !== 'modify' || b.count === undefined || duration !== undefined || e.optional === true || e.shield !== undefined) return null;
  if (b.amount !== undefined || b.destination !== undefined || b.to !== undefined || b.then !== undefined || b.count.add === undefined || b.count.mul !== undefined || b.count.set !== undefined) return null;
  const text = `if you would draw one or more cards, you draw that many cards plus ${K.qty(b.count.add, st)} instead`;
  return e.condition === undefined ? text : `as long as ${K.cond(e.condition, st)}, ${text}`;
}

/**
 * edh-zones-16 (CR 614.1a, 614.6, 701.20a, 205.2a; Abundance): "If you would draw a card, you may instead choose land or nonland and reveal cards from the top of your library
 * until you reveal a card of the chosen kind. Put that card into your hand and put all other cards revealed this way on the bottom of your library in any order." (the
 * template rep.edhz16.draw.mayInstead.chooseKind.revealUntil): exactly the four steps it builds, in that shape. null for anything else.
 */
function drawInsteadRevealKind(e: ReplacementDef, duration: Duration | undefined, st: RenderState): string | null {
  const ev = e.replaces;
  const b = e.body;
  if (ev.ev !== 'draw' || ev.player !== 'you' || b.b !== 'instead' || e.optional !== true || duration !== undefined || e.condition !== undefined || e.shield !== undefined || e.selfReplacement === true) return null;
  const [pick, reveal, hit, rest] = b.do;
  if (b.do.length !== 4 || pick?.op !== 'chooseValue' || pick.what !== 'landOrNonland' || pick.link === undefined || reveal?.op !== 'revealUntil' || reveal.count !== undefined || hit?.op !== 'move' || rest?.op !== 'move') return null;
  if (JSON.stringify(pick.who) !== JSON.stringify({ ref: 'you' }) || JSON.stringify(reveal.who) !== JSON.stringify({ ref: 'you' })) return null;
  if (JSON.stringify(hit.what) !== JSON.stringify({ ref: 'bound', name: reveal.as }) || JSON.stringify(hit.to) !== JSON.stringify({ zone: 'hand' })) return null;
  const others = { ref: 'each', filter: { is: { ref: 'bound', name: reveal.revealed }, not: { is: { ref: 'bound', name: reveal.as } }, zone: 'library' } };
  // trek-21 (Pavel Chekov, First Posting; template rep.trek21.draw.chooseKind.random): the same four steps with the rest put on the bottom in a random order (CR 401.4)
  const order = JSON.stringify(rest.to) === JSON.stringify({ zone: 'library', position: 'bottom', order: 'chosen' }) ? 'any' : JSON.stringify(rest.to) === JSON.stringify({ zone: 'library', position: 'bottom', order: 'random' }) ? 'a random' : null;
  if (JSON.stringify(rest.what) !== JSON.stringify(others) || order === null) return null;
  const what = K.np({ ...reveal.filter, zone: 'library' }, st, { det: 'a', noZone: true });
  return `if you would draw a card, you may instead choose land or nonland and reveal cards from the top of your library until you reveal ${what}. put that card into your hand and put all other cards revealed this way on the bottom of your library in ${order} order`;
}

/**
 * r4-repl (CR 614.1a, 614.5, 111.1): "If one or more tokens would be created under your control, those tokens plus a Clue token are created instead." (Case of the
 * Pilfered Proof; "a 1/1 green Frog creature token", Quina, Qu Gourmet): every token you would create, then one more of that description (`modify.then`, the
 * template rep.r4repl.tokens.plusOne.passive). E3XP (Tippy-Toe, Terrific Partner; merge wave 8 fold): the same build said actively, "if you would create one or
 * more tokens, instead create those tokens plus an additional Food token" (rep.e3xp.tokens.any.plusOne, a predefined token only, as r3-repl's
 * `tokensPlusOne`). null for anything else.
 */
function tokensPlusOnePassive(e: ReplacementDef, duration: Duration | undefined, st: RenderState): string | null {
  const ev = e.replaces;
  const b = e.body;
  if (ev.ev !== 'createToken' || b.b !== 'modify' || b.then === undefined || duration !== undefined || e.condition !== undefined || e.optional === true || e.shield !== undefined) return null;
  if (b.destination !== undefined || b.amount !== undefined || b.count !== undefined || b.to !== undefined || ev.player !== 'you' || ev.byEffect !== undefined || ev.token !== undefined) return null;
  const one = b.then.do.length === 1 ? b.then.do[0]! : undefined;
  if (one === undefined || one.op !== 'createToken' || one.count !== 1 || JSON.stringify(one.who) !== '{"ref":"you"}' || Object.keys(one).some((k) => !['op', 'who', 'count', 'token'].includes(k))) return null;
  // p2-replace-events-1 (family tokens-plus-additional): the one more token is also "an additional Food token" (Peregrin Took)
  const one1 = tokenText(one.token, 1, false, st);
  const passive = `if one or more tokens would be created under your control, those tokens plus ${alt(one1, additionalToken(one1))} are created instead`;
  const predefined = typeof one.token === 'object' && one.token !== null ? (one.token as { predefined?: string }).predefined : undefined;
  if (predefined === undefined || Object.keys(one.token as object).length !== 1) return passive;
  return alt(passive, `if you would create one or more tokens, instead create those tokens plus an additional ${predefined} token`);
}

/**
 * edh-perms-1 (CR 614.1a, 614.5, 111.1): "If one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are
 * created instead." (Chatterfang, Squirrel General): every token you would create, then as many more of one description (`modify.then` = one `createToken` by you whose
 * count is the event's number, the template rep.edhpm1.tokens.plusThatMany.passive). null for anything else.
 */
function tokensPlusThatMany(e: ReplacementDef, duration: Duration | undefined, st: RenderState): string | null {
  const ev = e.replaces;
  const b = e.body;
  if (ev.ev !== 'createToken' || b.b !== 'modify' || b.then === undefined || duration !== undefined || e.condition !== undefined || e.optional === true || e.shield !== undefined) return null;
  if (b.destination !== undefined || b.amount !== undefined || b.count !== undefined || b.to !== undefined || ev.player !== 'you' || ev.byEffect !== undefined || ev.token !== undefined) return null;
  const one = b.then.do.length === 1 ? b.then.do[0]! : undefined;
  if (one === undefined || one.op !== 'createToken' || JSON.stringify(one.count) !== '{"q":"eventAmount"}' || JSON.stringify(one.who) !== '{"ref":"you"}' || Object.keys(one).some((k) => !['op', 'who', 'count', 'token'].includes(k))) return null;
  return `if one or more tokens would be created under your control, those tokens plus ${tokenText(one.token, 'that many', true, st)} are created instead`;
}

/**
 * r4-repl (CR 614.1a, 614.6, 111.1): "If one or more artifact tokens would be created under your control, that many 5/5 red Dragon creature tokens with flying are
 * created instead." (Draconic Visitor): the tokens of a card type you would create replaced by as many tokens of another description (`instead`, `count` the
 * event's number; the template rep.r4repl.tokens.typed.thatMany.other). null for anything else.
 */
function thatManyOtherTokens(e: ReplacementDef, duration: Duration | undefined, st: RenderState): string | null {
  const ev = e.replaces;
  const b = e.body;
  if (ev.ev !== 'createToken' || b.b !== 'instead' || duration !== undefined || e.condition !== undefined || e.optional === true || e.shield !== undefined || ev.player !== 'you' || ev.byEffect !== undefined) return null;
  // trek-16 (Holo-Engineer): no card type at all, every token you would create
  if (ev.token !== undefined && (Object.keys(ev.token).join() !== 'types' || ev.token.types?.length !== 1)) return null;
  const one = b.do.length === 1 ? b.do[0]! : undefined;
  if (one === undefined || one.op !== 'createToken' || JSON.stringify(one.count) !== '{"q":"eventAmount"}' || JSON.stringify(one.who) !== '{"ref":"you"}' || Object.keys(one).some((k) => !['op', 'who', 'count', 'token'].includes(k))) return null;
  const kind = ev.token?.types?.[0]?.toLowerCase();
  return `if one or more ${kind === undefined ? '' : `${kind} `}tokens would be created under your control, that many ${tokenText(one.token, 'that many', true, st).replace(/^that many /, '')} are created instead`;
}

/**
 * edh-next-138 (CR 614.1a, 614.5, 111.1; Fisher's Talent, rep.edhn138.createSubtypeToken.createOtherInstead): "If you would create a Fish token, create a 3/3 blue Shark creature token
 * instead.": the tokens of one subtype you would create replaced by as many tokens of another description (`instead`, `count` the event's number). null for anything else.
 */
function subtypeTokenOtherInstead(e: ReplacementDef, duration: Duration | undefined, st: RenderState): string | null {
  const ev = e.replaces;
  const b = e.body;
  if (ev.ev !== 'createToken' || b.b !== 'instead' || duration !== undefined || e.condition !== undefined || e.optional === true || e.shield !== undefined || ev.player !== 'you' || ev.byEffect !== undefined) return null;
  if (ev.token === undefined || Object.keys(ev.token).join() !== 'subtypes' || ev.token.subtypes?.length !== 1) return null;
  const one = b.do.length === 1 ? b.do[0]! : undefined;
  if (one === undefined || one.op !== 'createToken' || JSON.stringify(one.count) !== '{"q":"eventAmount"}' || JSON.stringify(one.who) !== '{"ref":"you"}' || Object.keys(one).some((k) => !['op', 'who', 'count', 'token'].includes(k))) return null;
  const sub = ev.token.subtypes[0]!;
  return `if you would create ${withArticle(sub)} token, create ${tokenText(one.token, 1, false, st)} instead`;
}

/**
 * edh-perms-24 (CR 614.1a, 614.5, 608.2d, 111.1; Jinnie Fay): "If you would create one or more tokens, you may instead create that many 2/2 green Cat creature tokens with haste
 * or that many 3/1 green Dog creature tokens with vigilance.": an optional replacement of every token creation of yours whose body chooses one of two descriptions (the choice
 * of two instructions, `instructionChoice`) and creates that many of it. null for anything else.
 */
function tokensMayInsteadChoice(e: ReplacementDef, duration: Duration | undefined, st: RenderState): string | null {
  const ev = e.replaces;
  const b = e.body;
  if (ev.ev !== 'createToken' || b.b !== 'instead' || duration !== undefined || e.optional !== true || e.condition !== undefined || e.shield !== undefined || e.selfReplacement === true) return null;
  if (ev.player !== 'you' || ev.token !== undefined || ev.byEffect !== undefined || Object.keys(ev).filter((k) => (ev as Record<string, unknown>)[k] !== undefined).length !== 2 || b.do.length !== 3) return null;
  const [pick, first, second] = b.do as [EffectStep, EffectStep, EffectStep];
  if (pick.op !== 'chooseValue' || pick.link !== 'instructionChoice' || pick.what !== 'option' || JSON.stringify(pick.options) !== '["first","second"]' || JSON.stringify(pick.who) !== '{"ref":"you"}' || pick.guard !== undefined) return null;
  const creates = (s: EffectStep, word: string): TokenDef | null => {
    if (s.op !== 'if' || s.else !== undefined || s.guard !== undefined || s.as !== undefined || s.then.length !== 1) return null;
    if (JSON.stringify(s.cond) !== JSON.stringify({ cond: 'chosen', link: 'instructionChoice', equals: word })) return null;
    const c = s.then[0]!;
    if (c.op !== 'createToken' || JSON.stringify(c.count) !== '{"q":"eventAmount"}' || JSON.stringify(c.who) !== '{"ref":"you"}' || Object.keys(c).some((k) => !['op', 'who', 'count', 'token'].includes(k))) return null;
    return c.token;
  };
  const a = creates(first, 'first');
  const c = creates(second, 'second');
  if (a === null || c === null) return null;
  return `if you would create one or more tokens, you may instead create ${tokenText(a, 'that many', true, st)} or ${tokenText(c, 'that many', true, st)}`;
}

/**
 * r4-copy (CR 614.1a, 614.6, 616.1, 707.2): an optional static replacement of the tokens you would create, for the first such event of the turn only (`not happened
 * createToken by you this turn`, the turn's history before this event), whose body creates that many token copies of one object instead; optionally also only while
 * the source is attached to a creature (`matches attachedTo Creature`, said "as long as ~ is attached to a creature"). null for anything else.
 */
function firstTokensAsCopies(e: ReplacementDef, duration: Duration | undefined, st: RenderState): string | null {
  const ev = e.replaces;
  const b = e.body;
  if (ev.ev !== 'createToken' || b.b !== 'instead' || duration !== undefined || e.optional !== true || e.shield !== undefined || e.selfReplacement === true) return null;
  if (ev.player !== 'you' || ev.token !== undefined || ev.byEffect !== undefined || b.do.length !== 1) return null;
  const c = b.do[0]!;
  if (c.op !== 'copy' || c.result !== 'token' || JSON.stringify(c.who) !== '{"ref":"you"}' || JSON.stringify(c.count) !== '{"q":"eventAmount"}') return null;
  if (Object.keys(c).some((k) => !['op', 'what', 'result', 'who', 'count'].includes(k))) return null;
  const first = JSON.stringify({ cond: 'not', of: { cond: 'happened', event: { ev: 'createToken', player: 'you' }, scope: 'turn' } });
  const attached = JSON.stringify({ cond: 'matches', object: { ref: 'attachedTo' }, filter: { types: ['Creature'] } });
  const cond = e.condition;
  let lead: string;
  if (JSON.stringify(cond) === first) lead = '';
  else if (cond?.cond === 'all' && cond.of.length === 2 && JSON.stringify(cond.of[0]) === attached && JSON.stringify(cond.of[1]) === first) lead = `${alt('as long as', 'while')} ${K.obj({ ref: 'self' }, st, 'subject').text} is attached to a creature, `; // family replace-leading-while
  else return null;
  return `${lead}the first time you would create one or more tokens each turn, you may instead create that many tokens that are copies of ${K.obj(c.what, st, 'object').text}`;
}

/**
 * edh-d-57 (CR 614.1a, 614.6, 616.1, 707.2, 111.1; Esix, Fractal Bloom): "The first time you would create one or more tokens during each of your turns, you may instead choose a
 * creature other than ~ and create that many tokens that are copies of that creature." (template rep.edhd57.firstTokensYourTurn.chooseCopies): the optional replacement of
 * the first token creation of your turn, whose body chooses one other creature and creates that many token copies of it. null for anything else.
 */
function firstTokensYourTurnChooseCopies(e: ReplacementDef, duration: Duration | undefined, st: RenderState): string | null {
  const ev = e.replaces;
  const b = e.body;
  if (ev.ev !== 'createToken' || b.b !== 'instead' || duration !== undefined || e.optional !== true || e.shield !== undefined || e.selfReplacement === true) return null;
  if (ev.player !== 'you' || ev.token !== undefined || ev.byEffect !== undefined || Object.keys(ev).filter((k) => (ev as Record<string, unknown>)[k] !== undefined).length !== 2 || b.do.length !== 2) return null;
  const want = JSON.stringify({ cond: 'all', of: [{ cond: 'turnOf', whose: 'you' }, { cond: 'not', of: { cond: 'happened', event: { ev: 'createToken', player: 'you' }, scope: 'turn' } }] });
  if (JSON.stringify(e.condition) !== want) return null;
  const [pick, copy] = b.do as [EffectStep, EffectStep];
  if (pick.op !== 'chooseObjects' || typeof pick.as !== 'string' || pick.guard !== undefined || JSON.stringify(pick.who) !== '{"ref":"you"}' || pick.min !== 1 || pick.max !== 1) return null;
  if (JSON.stringify(pick.from) !== '{"ref":"each","filter":{"types":["Creature"],"other":true,"zone":"battlefield"}}' || Object.keys(pick).some((k) => !['op', 'who', 'from', 'min', 'max', 'as'].includes(k))) return null;
  if (copy.op !== 'copy' || copy.result !== 'token' || JSON.stringify(copy.who) !== '{"ref":"you"}' || JSON.stringify(copy.count) !== '{"q":"eventAmount"}' || JSON.stringify(copy.what) !== JSON.stringify({ ref: 'bound', name: pick.as })) return null;
  if (Object.keys(copy).some((k) => !['op', 'what', 'result', 'who', 'count'].includes(k))) return null;
  return `the first time you would create one or more tokens during each of your turns, you may instead choose a creature other than ${K.obj({ ref: 'self' }, st, 'object').text} and create that many tokens that are copies of that creature`;
}

function abilityWords(a: AbilityDef, st: RenderState): string {
  const q = st.depth > 0 ? "'" : '"'; // r3-fx: single quotes inside quotes, as Oracle prints a quoted ability within a quoted ability
  return a.kind === 'keyword' ? K.ability(a, { ...st, depth: st.depth + 1 }).toLowerCase() : `${q}${K.ability(a, { ...st, depth: st.depth + 1, mentioned: new Set(), info: new Map() })}${q}`;
}

/** CR 614.1, 616.1: "If X would happen, you may Y instead." The choice is part of the replacement (not of the body: an enters body has its own). */
function bodyText(r: ReplacementDef, subjectIt: string, st: RenderState): string {
  const text = bodyWords(r, subjectIt, st);
  if (r.optional !== true) return text;
  if (r.body.b === 'enters') throw new NoRenderer('an optional enters replacement');
  return `you may ${text}`;
}

/** p2-replace-events-1: N of an `add` that is 0 minus N (one fewer of the event's number, "that many ... minus one"), undefined for any other change. */
function minusOf(a: AmountChange): Quantity | undefined {
  if (a.add === undefined || a.mul !== undefined || a.set !== undefined || typeof a.add !== 'object' || a.add === null) return undefined;
  const m = a.add as { q?: string; op?: string; args?: Quantity[] };
  return m.q === 'math' && m.op === '-' && m.args?.length === 2 && m.args[0] === 0 ? m.args[1] : undefined;
}

/** edh-next-34 (Forbidden Crypt): the steps of the draw replacement "return a card from your graveyard to your hand instead. If you can't, you lose the game". */
const RETURN_GRAVEYARD_CARD_OR_LOSE: unknown = [
  { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { zone: 'graveyard', owner: 'you', isCard: true } }, min: 1, max: 1, as: 'returned' },
  { op: 'move', what: { ref: 'bound', name: 'returned' }, to: { zone: 'hand' }, as: 'did' },
  { op: 'if', cond: { cond: 'did', step: 'did', not: true }, then: [{ op: 'loseGame', who: { ref: 'you' } }] },
];

/** edh-next-34 (Wheel of Sun and Moon): the steps of "instead that card is revealed and put on the bottom of that player's library" (the enchanted player's card going to the graveyard). */
const REVEAL_BOTTOM_OF_LIBRARY: unknown = [
  { op: 'reveal', who: { ref: 'you' }, what: { ref: 'event', role: 'subject' } },
  { op: 'move', what: { ref: 'event', role: 'subject' }, to: { zone: 'library', position: 'bottom' } },
];

function bodyWords(r: ReplacementDef, subjectIt: string, st: RenderState): string {
  const b = r.body;
  switch (b.b) {
    // Cloud r5-repl (CR 614.1a): "If damage would be dealt to ~, instead that damage is dealt, but all other damage already dealt to him is healed."
    case 'healFirst': {
      const ev = r.replaces;
      if (ev.ev !== 'damage') throw new NoRenderer('a heal replacement of something other than damage');
      return 'instead that damage is dealt, but all other damage already dealt to ~ is healed'; // the parser reads "him" as ~ (parser/front/selfref.ts)
    }
    case 'instead': {
      // Cloud r5-repl (CR 614.1a, 504.1): "If an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips
      // that draw and you draw a card." (the replaced draw does not happen: CR 614.6)
      const rv = r.replaces;
      // edh-zones-15 (CR 614.1a, 614.6): an optional step first ("instead you may ...") would lose the draw when declined, which the body does not say; no wording
      if (rv.ev === 'draw' && b.do[0]?.op === 'may') throw new NoRenderer('a draw replaced by an optional step: declining must leave the draw');
      if (rv.ev === 'draw' && rv.player === 'opponent' && rv.exceptFirstInDrawStep === true) return `instead that player skips that draw and ${K.steps(b.do, st)}`;
      // edh-c-28 (CR 614.1a, 120.3, 406.2; Crumbling Sanctuary): the damage a player would be dealt is exiled from the top of that player's library instead, one card for each damage
      if (rv.ev === 'damage' && b.do.length === 1 && b.do[0]!.op === 'move' && JSON.stringify(b.do[0]!.what) === '{"ref":"topCards","player":{"ref":"event","role":"recipient"},"count":{"q":"eventAmount"}}'
        && JSON.stringify(b.do[0]!.to) === '{"zone":"exile"}') return alt('that player exiles that many cards from the top of their library instead', "that player exiles that many cards from the top of that player's library instead");
      // edh-next-34 (CR 614.1a, 614.6, 104.3e, 608.2d; Forbidden Crypt): "If you would draw a card, return a card from your graveyard to your hand instead. If you can't, you lose the game."
      // (the pick of a card of your own graveyard, its move to your hand, and the loss when nothing could be moved): "instead" closes the first sentence
      if (rv.ev === 'draw' && rv.player === 'you' && JSON.stringify(b.do) === JSON.stringify(RETURN_GRAVEYARD_CARD_OR_LOSE)) return "return a card from your graveyard to your hand instead. if you can't, you lose the game";
      // edh-next-34 (CR 614.1a, 614.6, 701.20a, 303.4; Wheel of Sun and Moon): the cards that would go to the enchanted player's graveyard are revealed and go to the bottom of their owner's library
      if (rv.ev === 'zoneChange' && rv.to === 'graveyard' && typeof rv.subject.owner === 'object' && rv.subject.owner.ref === 'enchantedPlayer' && JSON.stringify(b.do) === JSON.stringify(REVEAL_BOTTOM_OF_LIBRARY)) return "instead that card is revealed and put on the bottom of that player's library";
      // edh-next-61 (CR 614.1a, 614.6, 104.3, 701.24a, 119.5; Lich's Mirror): "If you would lose the game, instead shuffle your hand, your graveyard, and all permanents you own into your library,
      // then draw seven cards and your life total becomes 20." (the cards of those three zones owned by you, one shuffle, the draw, the life total)
      if (rv.ev === 'loseGame' && rv.player === 'you' && b.do.length === 4 && JSON.stringify(b.do[0]) === '{"op":"move","what":{"ref":"each","filter":{"zone":["hand","graveyard","battlefield"],"owner":"you"}},"to":{"zone":"library","owner":{"ref":"you"}}}'
        && JSON.stringify(b.do[1]) === '{"op":"shuffle","who":{"ref":"you"}}' && b.do[2]!.op === 'draw' && JSON.stringify(b.do[2]!.who) === '{"ref":"you"}' && b.do[3]!.op === 'setLife' && JSON.stringify(b.do[3]!.who) === '{"ref":"you"}') {
        return `instead shuffle your hand, your graveyard, and all permanents you own into your library, then draw ${countedNoun(b.do[2]!.count as never, 'card', st)} and your life total becomes ${K.qty(b.do[3]!.value as never, st)}`;
      }
      // edh-d-86 (CR 614.1a, 614.6, 701.27a, 119.5, 104.3a; Enduring Angel): "instead transform ~ and your life total becomes 3. Then if ~ didn't transform this way, you lose the game."
      if (rv.ev === 'life' && rv.toAtMost !== undefined) {
        const [t, l, i] = b.do;
        const fine = b.do.length === 3 && t?.op === 'changeFace' && t.to === 'transform' && JSON.stringify(t.what) === '{"ref":"self"}' && typeof t.as === 'string' && l?.op === 'setLife' && JSON.stringify(l.who) === '{"ref":"you"}'
          && i?.op === 'if' && i.else === undefined && JSON.stringify(i.cond) === JSON.stringify({ cond: 'did', step: t.as, not: true }) && JSON.stringify(i.then) === '[{"op":"loseGame","who":{"ref":"you"}}]';
        if (!fine) throw new NoRenderer('a life total reduced to N or less replaced by anything but its one transform form');
        return `instead transform ~ and your life total becomes ${K.qty(l.value, st)}. then if ~ didn't transform this way, you lose the game`;
      }
      // Cloud r3-repl (CR 614.1a, 614.6): "instead" may also come first, "instead exile it and you gain 2 life" (The Darkness Crystal): the same replacement
      const closes = insteadClosesFirstSentence(b.do, st); // edh-next-71: "... instead. <the other sentences>"
      const words = K.steps(b.do, st);
      const text = alt(`${words} instead`, `instead ${words}`, ...(closes === null ? [] : [closes]));
      // M6-10 (CR 104.2b): "you win the game instead" names its subject (Laboratory Maniac)
      const win = b.do.length === 1 && b.do[0]!.op === 'winGame' && JSON.stringify(b.do[0]!.who) === JSON.stringify({ ref: 'you' });
      return win ? alt(text, 'you win the game instead') : text;
    }
    case 'insteadThen': {
      // Merge wave 8 (audit D4; CR 614.1a, 614.6): "instead you draw a card, then that creature connives": the steps, then the replaced event in the words of the same
      // keyword action on the event's object (only an action event can be said so)
      const ev = r.replaces;
      // p2-replace-events-1 (CR 614.1a, 614.6): "If this land would enter, sacrifice a Swamp instead. If you do, put this land onto the battlefield. If you don't, put
      // it into its owner's graveyard." (Lake of the Dead; "you may discard a land card instead", Mox Diamond): one payment, then the event or the graveyard
      if (b.if !== undefined || b.otherwise !== undefined) return payOrGraveyard(r, b, st);
      if (ev.ev !== 'action') throw new NoRenderer('an "instead ..., then [the event]" body on an event other than a keyword action');
      const again = { op: 'action', action: ev.verb, subject: { ref: 'event', role: 'subject' }, who: { ref: 'you' } } as unknown as EffectStep;
      // edh-next-61 (CR 614.1a, 614.5, 701.44a; Topography Tracker): the replacing steps are the keyword action itself once, and the event the second time: "instead it explores, then it explores again"
      if (b.do.length === 1 && b.do[0]!.op === 'action' && b.do[0]!.action === 'explore' && ev.verb === 'explore' && JSON.stringify((b.do[0] as { subject?: unknown }).subject) === '{"ref":"event","role":"subject"}') {
        const first = K.steps(b.do, st);
        return `instead ${first}, then ${first} again`;
      }
      return `instead ${K.steps([...b.do, again], st)}`;
    }
    case 'modify': {
      const ev = r.replaces;
      const bits: string[] = [];
      // p2-replace-events-2 (CR 614.1a; family exile-instead-anywhere-else): a move from the battlefield to any zone sent to exile is also "exile it instead of putting
      // it anywhere else" (Gruesome Encore; quoted, Geth, Thane of Contracts): the event names no destination, so every one of them is replaced
      if (b.destination) {
        const words = destinationText(b.destination, subjectIt, st);
        const anywhere = ev.ev === 'zoneChange' && ev.to === undefined && b.destination.zone === 'exile' && Object.keys(b.destination).length === 1;
        // edh-next-34 (CR 614.1a; Forbidden Crypt, family graveyard-exile-that-card): your graveyard's cards are also said as "that card" ("exile that card instead", as the C10 effect form)
        const thatCard = ev.ev === 'zoneChange' && ev.to === 'graveyard' && ev.from === undefined && words === 'exile it instead' && JSON.stringify(ev.subject) === '{"isCard":true,"owner":"you"}' && Object.keys(ev).length === 3;
        bits.push(anywhere ? alt(words, `exile ${subjectIt} instead of putting ${subjectIt} anywhere else`) : thatCard ? alt(words, 'exile that card instead') : words);
      }
      if (b.count) {
        // M6-1: the passive readings ("twice that many of those tokens are created instead", "that many plus one +1/+1 counters are put on it instead")
        if (ev.ev === 'createToken') {
          const n = amountChange(b.count, st, 'of those tokens');
          bits.push(alt(`${alt('it creates', 'you create')} ${n} instead`.replace(/ instead instead/, ' instead'), `${n} are created instead`));
        } else if (ev.ev === 'counters' && ev.change === 'put' && ev.kind === 'energy' && 'player' in ev.on && ev.on.player === 'you' && ev.by === undefined && b.count.add !== undefined && b.count.mul === undefined && b.count.set === undefined) {
          // edh-replace-5 (CR 107.14, 614.1a; Izzet Generatorium): "you get that many plus one {E} instead"
          bits.push(`you get that many plus ${K.qty(b.count.add, st)} {e} instead`);
        } else if (ev.ev === 'counters' && ev.change === 'put' && ev.kind === 'energy' && 'player' in ev.on && ev.on.player === 'you' && ev.by === undefined && b.count.mul === 2 && b.count.add === undefined && b.count.set === undefined) {
          // edh-next-39 (CR 107.14, 614.1a; Aether Refinery): "you get twice that many {E} instead"
          bits.push('you get twice that many {e} instead');
        } else if (ev.ev === 'counters') {
          const active = `it ${ev.change === 'put' ? 'puts' : 'removes'} ${amountChange(b.count, st, ev.change === 'put' ? 'of those counters on that permanent' : 'of those counters from that permanent')} instead`;
          // FAST5 T40 (CR 122.6, 614.1a): counters of every kind are "of each of those kinds of counters" (Loading Zone)
          const noun = ev.kind ? `${ev.kind} counters` : alt('of those counters', 'of each of those kinds of counters');
          // p2-replace-events-1 (CR 614.1a, 122.6): one fewer, "that many -1/-1 counters minus one are put on it instead" (Vizier of Remedies), `add` 0 minus N
          const less = minusOf(b.count);
          const many = less !== undefined && ev.kind ? `that many ${ev.kind} counters minus ${K.qty(less, st)}` : b.count.mul === 2 && b.count.add === undefined ? `twice that many ${noun}` : b.count.add !== undefined && b.count.mul === undefined && b.count.set === undefined ? `that many plus ${K.qty(b.count.add, st)} ${noun}` : null;
          // r4-repl (CR 614.1a, 122.6): the counters YOU put, "put that many plus one of each of those kinds of counters on that permanent instead" (Doc Samson),
          // "put that many plus one +1/+1 counters on it instead" (Prairie Dog)
          // TREK-6 (CR 614.1a, 122.6): the counters YOU put, twice as many, "put twice that many charge counters on that artifact instead" (Lt. Cmdr. Geordi La Forge), "put twice that
          // many of each of those kinds of counters on that creature instead" (Dr. Joseph M'Benga): Oracle repeats the object as "that <its one card type>" (the filter's) as well
          const onTypes = ev.by === 'you' && ev.change === 'put' && !('player' in ev.on) ? (ev.on as ObjectFilter).types : undefined;
          const that = onTypes !== undefined && onTypes.length === 1 ? `that ${onTypes[0]!.toLowerCase()}` : undefined;
          const yours = ev.by === 'you' && ev.change === 'put' && !('player' in ev.on) && b.count.add !== undefined && b.count.mul === undefined && b.count.set === undefined
            ? [`put that many plus ${K.qty(b.count.add, st)} ${ev.kind ? `${ev.kind} counters on it` : 'of each of those kinds of counters on that permanent'} instead`]
            : ev.by === 'you' && ev.change === 'put' && !('player' in ev.on) && b.count.mul === 2 && b.count.add === undefined && b.count.set === undefined
              ? (ev.kind ? ['it', 'that permanent', ...(that !== undefined ? [that] : [])].map((to) => `put twice that many ${ev.kind} counters on ${to} instead`)
                : ['that permanent', ...(that !== undefined ? [that] : [])].map((to) => `put twice that many of each of those kinds of counters on ${to} instead`)) : [];
          bits.push(many && ev.change === 'put' && !('player' in ev.on) ? alt(active, `${many} are put on ${alt('it', 'that creature', 'that permanent')} instead`, ...yours) : yours.length > 0 ? yours[0]! : active);
        } else if (ev.ev === 'action' && ev.verb === 'mill' && (ev.actor === 'opponent' || ev.actor === 'you')) {
          // Cloud r3-repl (CR 701.17a, 614.1a): "they mill that many cards plus four instead" (The Water Crystal)
          const who = ev.actor === 'you' ? 'you mill' : alt('they mill', 'that player mills');
          bits.push(`${who} ${amountChange(b.count, st, 'cards')} instead`);
        } else if (ev.ev === 'action' && ev.verb === 'scry' && ev.actor === 'you') {
          // edh-b-6 (CR 701.22a, 614.1a; Kenessos, Priest of Thassa): "scry that many cards plus one instead"
          bits.push(`scry ${amountChange(b.count, st, 'cards')} instead`);
        } else if (ev.ev === 'action' && ev.verb === 'search' && ev.actor === 'opponent' && b.count.set !== undefined && b.count.mul === undefined && b.count.add === undefined) {
          // edh-zones-14 (CR 701.23a, 614.1a): "that player searches the top four cards of that library instead" (Aven Mindcensor)
          bits.push(`that player searches the top ${K.qty(b.count.set, st)} cards of that library instead`);
        } else bits.push(`${amountChange(b.count, st, 'of them')} instead`);
      }
      if (b.amount) {
        if (ev.ev === 'damage') {
          const deals = `${alt('it deals', 'that source deals')} ${amountChange(b.amount, st, 'damage', true)}`;
          // M6-10 (CR 614.1a): Oracle repeats the recipient, "it deals double that damage to that permanent or player instead", "... plus 1 to that player instead"
          const r = ev.recipient;
          // p2-replace-damage-2 (CR 614.1a): damage to you is also said "to you" again (Forethought Amulet; family replaced-damage-to-you)
          const to = r === undefined ? 'that permanent or player' : r.object === undefined && r.player !== undefined ? (r.player === 'you' ? alt('that player', 'you') : 'that player') : r.player === undefined ? alt('that creature', 'that permanent', ...(JSON.stringify(r.object) === '{"attachedToSource":true}' ? [K.np(r.object!, cloneState(st), { det: 'none' })] : []), ...(JSON.stringify(r.object) === '{"self":true}' ? [K.obj({ ref: 'self' }, cloneState(st), 'object').text] : [])) /* edh-replace-1: "to equipped creature"; edh-d-8 (CR 614.1a; Goldnight Castigator): "to ~" */ : r.player === 'opponent' ? 'that player or permanent' /* edh-replace-1 (CR 614.1a; Solphim, Mayhem Dominus): an opponent or a permanent an opponent controls */ : null;
          // CLOUD std-msh (CR 614.1a, 107.3): "instead it deals that much damage plus X, where X is ~'s power" (Hawkeye, Young Avenger): "instead" first, a computed
          // amount added said with its "where X is" clause
          const add = b.amount.add !== undefined && b.amount.mul === undefined && b.amount.set === undefined ? b.amount.add : undefined;
          const first = add !== undefined && typeof add === 'object' ? [`instead ${alt('it deals', 'that source deals')} that much damage plus x, where x is ${K.qty(add, cloneState(st))}`] : [];
          // r4-repl (CR 614.1a, 107.3): "it deals that much damage plus an amount of damage equal to the number of fire counters on ~ instead" (Fated Firepower)
          if (add !== undefined && typeof add === 'object') first.push(`it deals that much damage plus an amount of damage equal to ${K.qty(add, cloneState(st))} instead`);
          // edh-c-42 (CR 614.1a, 107.1a; Ghosts of the Innocent): half of the damage rounded down, the rounding said before the recipient ("half that damage, rounded down, to that permanent or player instead")
          const half = b.amount.mul === 0.5 && b.amount.add === undefined && b.amount.set === undefined ? [`${alt('it deals', 'that source deals')} half that damage, rounded ${b.amount.round ?? 'down'}${to ? `, to ${to}` : ''} instead`] : [];
          bits.push(to ? alt(`${deals} instead`, `${deals} to ${to} instead`, ...first, ...half) : alt(`${deals} instead`, ...first, ...half));
        }
        else if (ev.ev === 'life') {
          // FAST5 T40 (CR 119.3, 119.10): one opponent's life is "they lose twice that much life" (Bloodletter of Aclazotz); every other player is "you" as before
          const base = ev.change === 'gain' ? 'gain' : 'lose';
          const amt = amountChange(b.amount, st, 'life', true);
          // p2-replace-events-1 (CR 614.1a, 119.3): any player's life gain set to nothing, "that player gains no life instead" (Sulfuric Vortex)
          if (ev.player === 'any' && ev.change === 'gain' && JSON.stringify(b.amount) === '{"set":0}') bits.push(alt('that player gains no life instead', 'they gain no life instead')); // family gain-no-life-they
          else bits.push(ev.player === 'opponent' ? alt(`they ${base} ${amt} instead`, `that player ${base}s ${amt} instead`) : `you ${base} ${amt} instead`);
        }
        else bits.push(`${amountChange(b.amount, st, 'of it', true)} instead`);
      }
      if (b.to) bits.push(`${K.player(b.to, st, 'subject').text} instead`);
      // Cloud r3-repl (CR 603.12, 614.1a): "exile it instead. When you do, X." (Head of the Hunt): the modified move's reflexive trigger, said as its own sentence
      if (b.then) {
        const r = b.then.do.length === 1 ? b.then.do[0]! : undefined;
        // edh-zones-7 (CR 614.1a, 122.1): "instead exile it with a void counter on it" (Dauthi Voidwalker): the exiled card gets one counter
        if (b.destination?.zone === 'exile' && Object.keys(b.destination).length === 1 && r?.op === 'putCounters' && r.count === 1 && r.on.ref === 'bound' && r.on.name === b.then.as && bits.length === 1) {
          const art = /^[aeiou]/.test(r.kind) ? 'an' : 'a';
          return alt(`instead exile ${subjectIt} with ${art} ${r.kind} counter on ${subjectIt}`, `instead exile ${subjectIt} and put ${art} ${r.kind} counter on ${subjectIt}`); // edh-d-85 (family exile-it-and-put-counter; Ravenloft Adventurer)
        }
        // edh-zones-27 (CR 614.1a, 603.7, 400.7; Cosmic Intervention): "exile it instead. Return it to the battlefield under its owner's control at the beginning of the next end step."
        if (b.destination?.zone === 'exile' && Object.keys(b.destination).length === 1 && bits.length === 1 && r?.op === 'delay' && JSON.stringify(r.when) === '{"at":"step","step":"end","next":true}' && r.do.length === 1) {
          const back = r.do[0]!;
          if (back.op === 'move' && back.what.ref === 'bound' && back.what.name === b.then.as && JSON.stringify(back.to) === '{"zone":"battlefield","controller":"owner"}') {
            return `${bits.join(', ')}. return ${subjectIt} to the battlefield under its owner's control at the beginning of the next end step`;
          }
        }
        if (!b.destination || r === undefined || r.op !== 'reflexive' || r.when.did !== b.then.as || r.when.if !== undefined || r.targets.length > 0) throw new NoRenderer('the steps after a modified event other than "When you do, X"');
        return `${bits.join(', ')}. when you do, ${K.steps(r.do, st)}`;
      }
      return bits.join(', ');
    }
    case 'prevent': {
      const what = b.amount === 'all' ? 'all' : K.qty(b.amount, st);
      // cloud std-spm (CR 615.5): the additional instruction may also follow in the same sentence ("prevent that damage and put that many +1/+1 counters on ~")
      const wp = whenPreventedThen(b, st) ?? counterPerPrevented(b) ?? exilePerPrevented(b, st);
      const own = wp === null ? (ownCounterPerPrevented(b) ?? sourceControllerDraws(b) ?? ownerAndRecipientDrawHalf(b)) : null; // edh-next-10; edh-next-42; edhd67
      const steps = wp ?? (b.then && b.then.length > 0 ? K.steps(b.then, st) : '');
      // edh-next-60 (CR 615.5; Sekki, Seasons' Guide): several additional instructions are also one list after the comma, "prevent that damage, remove that many +1/+1 counters from ~, and create that many tokens"
      const listed = wp === null && b.then !== undefined && b.then.length > 1 ? [`, ${K.steps(b.then, cloneState(st), { nested: true })}`] : [];
      const shuffles = ownerShufflesItPrevented(b.then); // edh-next-60 (Weeping Angel)
      const giveRad = removeThenGivePrevented(b.then, cloneState(st)); // edh-next-60 (Bloatfly Swarm)
      const then = steps !== '' ? (wp !== null ? `. ${steps}` : alt(`. ${steps}`, ` and ${steps}`, ...listed, ...(shuffles !== null ? [` and ${shuffles}`] : []), ...(giveRad !== null ? [giveRad] : []), ...(own !== null ? [`. ${own}`] : []))) : '';
      const words = `prevent ${what === 'all' ? 'that damage' : `${what} of that damage`}${then}`;
      // p2-replace-damage-1 (CR 615.7, 107.3, 611.3a): a computed amount is also "prevent X of that damage, where X is the number of creatures you control" (Shield of the
      // Avatar; family prevent-x-where): the same live number, said after the sentence
      if (typeof b.amount === 'object' && b.amount.q !== 'X' && then === '') return alt(words, `prevent x of that damage, where x is ${K.qty(b.amount, cloneState(st))}`);
      return words;
    }
    case 'redirect': {
      // M6-0: "the next N damage ... is dealt to X instead" (CR 614.9 with a budget): the amount is the shield's words; a bare redirect has none
      if (b.amount !== undefined) throw new NoRenderer('a redirect with an amount (its words come with the shield, M6-1)');
      return `${refText(b.to, st).text} is dealt that damage instead`;
    }
    case 'skip': return r.replaces.ev === 'draw' ? alt(`skip ${subjectIt} instead`, 'skip that draw instead', ...(r.replaces.player === 'any' ? ['that player skips that draw instead'] : [])) : `skip ${subjectIt} instead`; // r4-repl (CR 614.10): "skip that draw instead"
    // edh-c-45 (CR 614.1a, 701.19b; Mossbridge Troll; family static-regenerate): a permanent's own static regeneration is "If ~ would be destroyed, regenerate it." (no shield, no "instead")
    case 'regeneration': return r.shield === undefined ? alt(`regenerate ${subjectIt} instead`, `regenerate ${subjectIt}`) : `regenerate ${subjectIt} instead`;
    case 'shieldCounter': throw new NoRenderer('a shield counter effect of the rules (CR 122.1c), never card text');
    case 'umbraArmor': throw new NoRenderer('umbra armor (CR 702.89a), written by its keyword data only');
    case 'enters': return enters(b, subjectIt, st);
    // M6-0: "As ~ is turned face up / transforms, <steps>" (CR 614.1e, 708.11, 712.20): the frame is written by `replace` for a `during` body
    case 'during': return K.steps(b.do, st);
  }
}

/**
 * p2-replace-events-1 (CR 614.1a, 614.6, 118.12): the body of "If ~ would enter, [you may] <cost> instead. If you do, put ~ onto the battlefield. If you don't, put it
 * into its owner's graveyard.": one payment by you named by the condition, the object itself entering, its owner's graveyard otherwise. Refused for anything else.
 */
function payOrGraveyard(r: ReplacementDef, b: Extract<ReplacementDef['body'], { b: 'insteadThen' }>, st: RenderState): string {
  const ev = r.replaces;
  const pay = b.do.length === 1 ? b.do[0]! : undefined;
  if (ev.ev !== 'zoneChange' || ev.subject.self !== true || [ev.to].flat().join() !== 'battlefield' || ev.from !== undefined || r.condition !== undefined || r.optional === true) {
    throw new NoRenderer('an "instead ..., then" body with a condition on anything but this object entering');
  }
  if (pay === undefined || pay.op !== 'pay' || typeof pay.as !== 'string' || JSON.stringify(pay.who) !== '{"ref":"you"}' || pay.then !== undefined || pay.else !== undefined || pay.times !== undefined || pay.upTo !== undefined || pay.anyAmount === true
    || JSON.stringify(b.if) !== JSON.stringify({ cond: 'did', step: pay.as }) || JSON.stringify(b.otherwise) !== '{"zone":"graveyard"}') {
    throw new NoRenderer('an "instead ..., then" body other than one payment, then the event or the graveyard');
  }
  const self = K.obj({ ref: 'self' }, st, 'object').text;
  const cost = K.cost(pay.cost, st);
  return `${pay.mandatory === true ? '' : 'you may '}${cost} instead. if you do, put ${self} onto the battlefield. if you don't, put it into its owner's graveyard`;
}

function destinationText(d: Destination, it: string, st: RenderState): string {
  if (d.zone === 'exile') return `exile ${it} instead`;
  return `${MOVE_VERB[d.zone]} ${it} ${destPhrase(d, st, false)} instead`;
}

/**
 * trek-8 (CR 614.1c, 614.12, 508.4, 506.3; Kira Nerys, Firebrand): "If a creature you control would enter while you control an attacking creature, instead it enters
 * tapped and attacking." One replacement effect of the entering of the objects its description names, applying only while its condition holds (checked as the
 * object would enter), whose body makes them enter tapped and attacking (and nothing else). Null for any other replacement.
 */
function tappedAndAttackingWhile(e: ReplacementDef, st: RenderState): string | null {
  const ev = e.replaces;
  const b = e.body;
  if (b.b !== 'enters' || b.attacking !== true || b.tapped !== true || Object.keys(b).length !== 3 || e.condition === undefined || e.optional === true || e.shield !== undefined || e.selfReplacement === true) return null;
  if (ev.ev !== 'zoneChange' || [ev.to].flat().join() !== 'battlefield' || ev.from !== undefined || ev.subject.self === true) return null;
  const what = K.events([ev], st, 'would');
  return `if ${what} while ${K.cond(e.condition, st)}, instead it enters tapped and attacking`;
}

function replace(e: ReplacementDef, st: RenderState, duration: Duration | undefined): string {
  const ev = e.replaces;
  const b = e.body;
  if (b.b === 'enters' && b.attacking === true) {
    // (a duration has no words here: refused, never dropped)
    const text = isLimited(duration) ? null : tappedAndAttackingWhile(e, st);
    if (text === null) throw new NoRenderer('an entering body that makes the permanent attack, outside "instead it enters tapped and attacking"');
    return text;
  }
  if (b.b === 'during') {
    // M6-0 (m6 design 2.1): "As this creature is turned face up, ..." / "As this permanent transforms into ..., ..." (CR 708.11, 712.20)
    if (ev.ev !== 'becomes' || (ev.what !== 'turnedFaceUp' && ev.what !== 'transformed') || ev.object.self !== true || duration !== undefined) {
      throw new NoRenderer('a during body on anything but this permanent being turned face up or transforming');
    }
    const self = K.obj({ ref: 'self' }, st, 'subject').text;
    if (ev.what === 'transformed') {
      // FAST5X E27 (CR 712.20): Oracle names the face it transforms into, "As this creature transforms into ~, you get an emblem with ...", with the subject
      const steps = K.steps(b.do, st);
      return alt(`as ${self} transforms, ${steps}`, `as ${self} transforms into ${self}, ${steps}`, `as ${self} transforms into ${self}, ${K.steps(b.do, st, { actor: null })}`);
    }
    return `as ${self} ${ev.what === 'turnedFaceUp' ? 'is turned face up' : 'transforms'}, ${K.steps(b.do, st)}`;
  }
  if (b.b === 'enters') {
    // the body is about the object entering the battlefield: the replaced event has to be exactly that
    if (ev.ev !== 'zoneChange' || ev.to === undefined || [ev.to].flat().join() !== 'battlefield') throw new NoRenderer('enters body on an event that is not entering the battlefield');
    const selfSubject = ev.subject.self === true && !ev.from;
    // edh-next-146 (CR 614.1c, 613.2a; Corrupted Shapeshifter): "As this creature enters, it becomes your choice of a 3/3 creature with flying, a 2/5 creature with vigilance, or a 0/12 creature
    // with defender.": the object itself, nothing else in the body and no duration; each option a creature of base power and toughness with abilities (its card types become Creature)
    if (b.becomesOneOf !== undefined) {
      if (!selfSubject || duration !== undefined || e.condition !== undefined || Object.keys(b).some((k) => k !== 'b' && k !== 'becomesOneOf') || b.becomesOneOf.length < 2) throw new NoRenderer('a choice of what this permanent becomes with anything else');
      const opts = b.becomesOneOf.map((o) => {
        if (o.typesAdded === true || (o.subtypes ?? []).length > 0 || o.types.join() !== 'Creature' || (o.add ?? []).length === 0) throw new NoRenderer('an option other than a creature with abilities');
        return `a ${o.power}/${o.toughness} creature with ${abilityList(o.add!, st, 'creature')}`;
      });
      return `as ${K.obj({ ref: 'self' }, st, 'subject').text} enters, it becomes your choice of ${opts.slice(0, -1).join(', ')}, or ${opts[opts.length - 1]!}`;
    }
    // edh-next-146 (CR 614.12a, 607.2d; Dauntless Bodyguard): "As this creature enters, choose another creature you control.": the object itself, nothing else in the body, no duration
    if (b.chooseObject !== undefined) {
      if (!selfSubject || duration !== undefined || e.condition !== undefined || Object.keys(b).some((k) => k !== 'b' && k !== 'chooseObject')) throw new NoRenderer('an object chosen as this permanent enters with anything else');
      const f = b.chooseObject.filter;
      if (f.other !== true || f.controller !== 'you' || f.anyOf?.length !== 1 || Object.keys(f).some((k) => k !== 'other' && k !== 'controller' && k !== 'anyOf')) throw new NoRenderer('an object chosen as it enters other than "another <kind> you control"');
      return `as ${K.obj({ ref: 'self' }, st, 'subject').text} enters, choose another ${K.np(f.anyOf[0]!, st, { det: 'none' })} you control`;
    }
    // edh-perms-21 (CR 614.1c, 205.1b; Displaced Dinosaurs): "As a historic permanent you control enters, it becomes a 7/7 Dinosaur creature in addition to its other types."
    // another permanent as it enters, nothing else in the body and no duration
    if (b.becomes !== undefined) {
      const bc = b.becomes;
      if (selfSubject || duration !== undefined || Object.keys(b).some((k) => k !== 'b' && k !== 'becomes') || bc.power === undefined || (bc.types ?? []).length === 0) throw new NoRenderer('an entering permanent that becomes other than another permanent\'s "as it enters" with a base power and toughness and a type');
      const what = [`${bc.power}/${bc.toughness}`, ...(bc.subtypes ?? []), ...(bc.types ?? []).map((t) => t.toLowerCase())].join(' ');
      return `as ${K.np(ev.subject, st, { det: 'a' })} enters, it becomes ${withArticle(what)} in addition to its other types`;
    }
    // edh-perms-24 (CR 614.1c, 614.12, 122.6, 205.1b; Master Biomancer): "Each other creature you control enters with a number of additional +1/+1 counters on it equal to ~'s power and
    // as a Mutant in addition to its other types": another object entering with one computed number of counters and subtypes, nothing else in the body and no duration
    if (!selfSubject && duration === undefined && b.subtypes !== undefined && b.subtypes.length > 0 && b.counters?.length === 1 && Object.keys(b).every((k) => k === 'b' || k === 'counters' || k === 'subtypes')
      && typeof b.counters[0]!.count === 'object' && b.counters[0]!.count.q !== 'X') {
      return `${K.np(ev.subject, st, { det: 'each' })} enters with a number of additional ${b.counters[0]!.kind} counters on it equal to ${K.qty(b.counters[0]!.count, st)} and as ${withArticle(b.subtypes.join(' '))} in addition to its other types`;
    }
    // FAST4 T28 (CR 611.2a, 514.2): a resolved replacement effect that lasts this turn is "This turn, each creature you control enters with ..."; any other
    // duration has no words here (refused, never dropped)
    const lead = isLimited(duration) ? (inlineDuration(duration) === 'this turn' ? 'this turn, ' : duration.d === 'untilNextTurn' ? `${durationSuffix(duration, st).trim()}, ` /* edh-next-55 (Cone of Cold): "Until your next turn, creatures your opponents control enter tapped." */ : null) : '';
    if (lead === null) throw new NoRenderer(`an enters body with the duration ${duration?.d}`);
    if (selfSubject) {
      if (lead !== '') throw new NoRenderer('an enters body of the object itself with a duration');
      // std-sos (CR 614.1c, 614.12, 107.3): "If X is 2 or less, it enters tapped" (Slumbering Trudge): the condition of this one replacement effect leads the sentence
      if (e.condition !== undefined && b.tapped === true && Object.keys(b).length === 2) {
        return `if ${K.cond(e.condition, st)}, it enters tapped`;
      }
      const self = K.obj({ ref: 'self' }, st, 'subject').text;
      // std-rx28 (CR 201.5; family self-again-enters): named a second time (after a condition that names it, "If ~ was cast using web-slinging, ~ enters with X +1/+1
      // counters on ~"), the object is called by its name in the whole sentence too, the counters' "on ~" included (Scarlet Spider, Ben Reilly)
      if (self !== '~') {
        const fork = cloneState(st);
        const byName = enters(b, '~', fork);
        return alt(enters(b, self, st), byName);
      }
      return enters(b, self, st);
    }
    // edh-d-14 (CR 614.1c, 614.12, 601.2i, 305.1; Uphill Battle): "Creatures played by your opponents enter tapped.": a creature is only ever played by casting it, so the
    // nontoken creatures your opponents cast (the stack to the battlefield, controlled by the caster; a copy of a spell is a token and was not cast), entering tapped and nothing else
    if (ev.from === 'stack' && ev.subject.controller === 'opponent' && b.b === 'enters' && b.tapped === true && Object.keys(b).length === 2 && duration === undefined && e.condition === undefined
      && ev.subject.token === false && ev.subject.isCopy === false && Object.keys(ev.subject).every((k) => k === 'types' || k === 'controller' || k === 'token' || k === 'isCopy') && ev.subject.types?.length === 1 && ev.subject.types[0] === 'Creature') {
      return `${K.np({ types: ['Creature'] }, st, { det: 'none', plural: true })} played by your opponents enter tapped`;
    }
    // FAST4 T28 (CR 614.1c, 122.6): counters given to other objects as they enter also read "each other Beast creature you control enters with an additional
    // +1/+1 counter on it" (on top of any counters it would enter with); each reading starts from the same state
    const fork = cloneState(st);
    const plural = enters(b, K.np(ev.subject, st, { det: 'none', plural: true }), st);
    const each = additionalEach(b, ev.subject, fork);
    // edh-c-78 (CR 614.1c, 614.12; Ashling's Prerogative; family each-enters-tapped): "Each creature without mana value of the chosen quality enters tapped." says the group's
    // entering tapped, one object at a time
    const eachTapped = Object.keys(b).length === 2 && b.tapped === true ? `each ${K.np(ev.subject, fork, { det: 'none', plural: false })} enters tapped` : null;
    absorb(st, fork);
    return `${lead}${eachTapped !== null ? alt(each === null ? plural : alt(plural, each), eachTapped) : each === null ? plural : alt(plural, each)}`;
  }
  // Cloud r3-repl (CR 614.1a, 120.2b): "If a red source you control would deal an amount of noncombat damage less than ~'s power to an opponent, that source
  // deals damage equal to ~'s power instead" (Ojer Axonil): the damage raised to a number, `set: max(that damage, N)`, said with the comparison it implies
  const raised = raisedDamage(e, duration, st);
  if (raised !== null) return raised;
  // edh-next-61 (CR 614.1a, 111.2, 611.2a; Crafty Cutpurse): "Each token that would be created under an opponent's control this turn is created under your control instead." (the creator
  // of every token an opponent would create becomes you, until end of turn; nothing else in the replacement)
  if (ev.ev === 'createToken' && ev.player === 'opponent' && Object.keys(ev).length === 2 && e.body.b === 'modify' && JSON.stringify(e.body) === '{"b":"modify","to":{"ref":"you"}}'
    && duration?.d === 'endOfTurn' && e.condition === undefined && e.optional !== true && e.shield === undefined && e.selfReplacement !== true) {
    return "each token that would be created under an opponent's control this turn is created under your control instead";
  }
  // edh-next-61 (CR 614.1a, 614.12, 110.2, 611.2a; Gather Specimens): "If a creature would enter the battlefield under an opponent's control this turn, it enters under your control
  // instead." (a creature that an opponent would control as it enters is put onto the battlefield under your control, until end of turn; nothing else in the replacement)
  if (ev.ev === 'zoneChange' && ev.to === 'battlefield' && Object.keys(ev).length === 3 && JSON.stringify(ev.subject) === '{"types":["Creature"],"controller":"opponent"}'
    && JSON.stringify(e.body) === '{"b":"modify","destination":{"zone":"battlefield","controller":{"ref":"you"}}}'
    && duration?.d === 'endOfTurn' && e.condition === undefined && e.optional !== true && e.shield === undefined && e.selfReplacement !== true) {
    return "if a creature would enter the battlefield under an opponent's control this turn, it enters under your control instead";
  }
  // edh-players-3 (CR 120.3a, 614.1a; Angel's Grace): "Until end of turn, damage that would reduce your life total to less than 1 reduces it to 1 instead."
  const floored = lifeFloorFromDamage(e, duration, st);
  if (floored !== null) return floored;
  // edh-next-49 (CR 120.3a, 614.1a; Archon of Coronation): "As long as you're the monarch, damage doesn't cause you to lose life."
  const noLoss = noLifeLossFromDamage(e, duration);
  if (noLoss !== null) return noLoss;
  // Cloud r3-repl (CR 614.1a, 111.1): "If you would create one or more artifact tokens, instead create those tokens plus an additional Map token." (Worldwalker Helm)
  const plusOne = tokensPlusOne(e, duration, st) ?? tokensPlusOnePassive(e, duration, st) ?? tokensPlusThatMany(e, duration, st) ?? thatManyOtherTokens(e, duration, st) ?? subtypeTokenOtherInstead(e, duration, st) /* edh-next-138 */ ?? oneOfEachToken(e, duration) ?? foodAndTreasureToken(e, duration) ?? tokensMayInsteadChoice(e, duration, st);
  if (plusOne !== null) return plusOne;
  // r4-repl (CR 614.1a, 121.2): "As long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that many cards plus one instead."
  const moreDraws = drawManyPlus(e, duration, st) ?? youGetCounters(e, duration, st) ?? extraTurnSkipped(e, duration) ?? drawInsteadRevealKind(e, duration, st);
  if (moreDraws !== null) return moreDraws;
  // r4-copy (CR 614.1a, 616.1, 707.2): "The first time you would create one or more tokens each turn, you may instead create that many tokens that are copies of
  // enchanted permanent." (Moonlit Meditation; Mirrormind Crown with "As long as this Equipment is attached to a creature, ...")
  const firstCopies = firstTokensAsCopies(e, duration, st) ?? firstTokensYourTurnChooseCopies(e, duration, st);
  if (firstCopies !== null) return firstCopies;
  // C10 (CR 614.1a, 611.2a, 514.2): a resolved replacement effect that lasts this turn, "If a card would be put into your graveyard from anywhere this turn,
  // exile that card instead" (Yawgmoth's Will): the cards its controller owns, exiled instead of going there
  if (b.b === 'modify' && ev.ev === 'zoneChange' && ev.to === 'graveyard' && ev.from === undefined && isLimited(duration) && inlineDuration(duration) === 'this turn'
    && JSON.stringify(ev.subject) === JSON.stringify({ isCard: true, owner: 'you' }) && Object.keys(ev).length === 3 && JSON.stringify(b) === JSON.stringify({ b: 'modify', destination: { zone: 'exile' } })
    && e.optional === undefined && e.condition === undefined && e.shield === undefined) {
    return `if a card would be put into your graveyard from anywhere this turn, exile ${alt('that card', 'it')} instead`;
  }
  if (e.optional === true && b.b === 'skip' && ev.ev === 'step') return `you may skip ${possessiveStep(ev.step, ev.whose, st)}`;
  if (b.b === 'skip' && ev.ev === 'step' && e.shield?.uses === 1 && typeof ev.whose === 'object' && ev.step !== 'beginCombat' && ev.step !== 'endCombat') {
    // M6-10 (CR 614.10a): a one-use skip shield of a resolved effect is "<player> skips their next draw step" (Fatigue); without the shield the static wording
    // std-ry3: a player of the triggering event ("Whenever ~ deals combat damage to a player, that player skips their next untap step") is read in the events of
    // the ability that creates the shield: the engine fixes it then (effects/handlers/lasting-fix.ts, COND mode)
    const who = isEventPlayerRef(ev.whose, st.outerTrigger) ? withTrigger(st, st.outerTrigger!, () => K.player(ev.whose as PlayerRef, st, 'subject')) : K.player(ev.whose, st, 'subject');
    return `${who.text} ${who.person === 'you' ? 'skip your' : 'skips their'} next ${STEP_NAME[ev.step]}`;
  }
  // edh-c-18 (CR 614.10, 500.11; Elfhame Sanctuary): a skip that lasts this turn and has no shield, "you skip your draw step this turn" (the player's step about to begin, as the turn goes on)
  if (b.b === 'skip' && ev.ev === 'step' && e.shield === undefined && isLimited(duration) && inlineDuration(duration) === 'this turn' && ev.whose === 'you'
    && ev.nth === undefined && e.optional !== true && e.condition === undefined && STEP_NAME[ev.step].endsWith(' step')) {
    return `you skip your ${STEP_NAME[ev.step]} this turn`;
  }
  if (b.b === 'skip' && ev.ev === 'phase' && ev.phase === 'combat' && e.shield?.uses === 1 && typeof ev.whose === 'object' && e.optional !== true && e.condition === undefined) {
    // std-ry3 (CR 614.10a, 500.11): "<player> skips their next combat phase" (Blinding Angel), the phase sibling of the step form above
    const who = isEventPlayerRef(ev.whose, st.outerTrigger) ? withTrigger(st, st.outerTrigger!, () => K.player(ev.whose as PlayerRef, st, 'subject')) : K.player(ev.whose, st, 'subject');
    return `${who.text} ${who.person === 'you' ? 'skip your' : 'skips their'} next combat phase${isLimited(duration) ? durationSuffix(duration, st) : ''}`; // edh-c-60 (Moment of Silence): "... this turn"
  }
  // edh-next-92 (CR 614.10, 500.11, 611.2a; Empty City Ruse): a skip with no shield that lasts through the player's next turn, "<player> skips all combat phases of their next turn"
  if (b.b === 'skip' && ev.ev === 'phase' && ev.phase === 'combat' && e.shield === undefined && duration?.d === 'endOfNextTurn' && typeof ev.whose === 'object'
    && JSON.stringify(duration.whose) === JSON.stringify(ev.whose) && e.optional !== true && e.condition === undefined && !isEventPlayerRef(ev.whose, st.outerTrigger)) {
    const who = K.player(ev.whose, st, 'subject');
    return `${who.text} ${who.person === 'you' ? 'skip all combat phases of your' : 'skips all combat phases of their'} next turn`;
  }
  // edh-b-2 (CR 614.10, 502.1; Stasis): the step of every player is "players skip their untap steps" (no alt: no template made the other wording for 'any' before)
  if (b.b === 'skip' && ev.ev === 'step' && ev.whose === 'any' && ev.nth === undefined && e.shield === undefined && e.optional !== true && e.condition === undefined && (STEP_NAME[ev.step].endsWith(' step') || ev.step === 'upkeep')) { const nm = ev.step === 'upkeep' ? 'upkeep step' : STEP_NAME[ev.step]; return alt(`players skip their ${nm}s`, `all players skip their ${nm}s`); } // edh-c-28 (CR 503.1; Eon Hub): "players skip their upkeep steps"
  if (b.b === 'skip' && ev.ev === 'step') return `skip ${possessiveStep(ev.step, ev.whose, st)}${ev.step === 'upkeep' ? ' step' : ''}${e.condition !== undefined ? ` if ${K.cond(e.condition, st)}` : ''}`; // edh-c-17 (CR 614.10): "Skip your upkeep step if you have no cards in hand" (Gibbering Descent)
  if (b.b === 'skip' && ev.ev === 'beginTurn' && ev.extra === undefined && typeof ev.whose === 'object' && (e.shield?.uses === 1 || e.shield?.uses === 2)
    && e.shield.amount === undefined && e.optional === undefined && e.condition === undefined) {
    // std-ry5 (CR 614.10, 500.7, 500.11): a one- or two-use shield that skips a player's turns is "you skip your next turn" (Chronatog), "you skip your next two
    // turns" (Eater of Days); an extra turn is one of those turns too (the pattern does not name `extra`)
    const who = K.player(ev.whose, st, 'subject');
    const next = e.shield.uses === 1 ? 'next turn' : 'next two turns';
    // edh-d-9 (CR 614.10; Magosi, the Waterveil): your own skip is also the imperative "Skip your next turn." (the sentence has no subject)
    return who.person === 'you' ? alt(`${who.text} skip your ${next}`, `skip your ${next}`) : `${who.text} skips their ${next}`;
  }
  if (b.b === 'redirect' && ev.ev === 'damage' && b.amount === undefined && ev.source === undefined && ev.combat === undefined && ev.amount === undefined && ev.recipient?.player !== undefined
    && ev.recipient.object === undefined && !e.shield && !e.condition && e.optional !== true && duration === undefined) {
    // M6-10 (CR 614.9): a static redirection of all damage to a player is "All damage that would be dealt to you is dealt to enchanted creature instead" (Pariah)
    const fork = cloneState(st);
    const generic = genericReplace(e, fork, duration);
    const text = `all damage that would be dealt to ${K.player(ev.recipient.player, st, 'object').text} is dealt to ${refText(b.to, st, 'object').text} instead`;
    absorb(st, fork);
    return alt(text, generic);
  }
  // p2-replace-damage-3 (CR 614.9, 611.2a): a resolved redirection of all the damage ONE recipient (an object by its reference, or you) would be dealt, "All damage that
  // would be dealt to target creature this turn is dealt to you instead." (Sivvi's Valor), "All combat damage that would be dealt to you this turn is dealt to target
  // attacking creature instead." (Turn the Tables; family redirect-all-for-duration)
  // edh-c-26 (CR 614.9; Treacherous Link): the same words for a static redirection of all the damage one attached object would be dealt (no duration; family redirect-all-for-duration)
  // edh-c-60 (CR 614.9, 506.4; Mirror Strike): "All combat damage that would be dealt to you this turn by target unblocked creature is dealt to its controller instead." is the
  // same redirection with the source named by its reference (`source: {is: X}`) and the damage going to that source's controller (`{ref:'controllerOf', object: X}`)
  const srcIs = ev.ev === 'damage' && ev.source !== undefined && Object.keys(ev.source).length === 1 ? ev.source.is : undefined;
  const toItsController = srcIs !== undefined && JSON.stringify(b.b === 'redirect' ? b.to : null) === JSON.stringify({ ref: 'controllerOf', object: srcIs });
  if (b.b === 'redirect' && b.amount === undefined && ev.ev === 'damage' && (ev.source === undefined || toItsController) && ev.amount === undefined && (isLimited(duration) || (duration === undefined && ev.recipient?.object?.is?.ref === 'attachedTo')) && !e.shield && !e.condition && e.optional !== true) {
    const r = ev.recipient;
    const objOnly = r?.object !== undefined && r.player === undefined && r.object.is !== undefined && Object.keys(r.object).filter((k) => (r.object as Record<string, unknown>)[k] !== undefined).length === 1;
    const youOnly = r?.object === undefined && JSON.stringify(r?.player) === '"you"';
    if ((objOnly || youOnly) && (!toItsController || youOnly)) {
      const fork = cloneState(st);
      const generic = genericReplace(e, fork, duration);
      const who = objOnly ? K.obj(r!.object!.is!, st, 'object').text : 'you';
      const combat = ev.combat === true ? 'combat ' : ev.combat === false ? 'noncombat ' : '';
      const text = toItsController && youOnly
        ? `all ${combat}damage that would be dealt to you${durationSuffix(duration, st)} by ${K.obj(srcIs!, st, 'object').text} is dealt to its controller instead`
        : `all ${combat}damage that would be dealt to ${who}${durationSuffix(duration, st)} is dealt to ${refText(b.to, st, 'object').text} instead`;
      absorb(st, fork);
      return alt(text, generic);
    }
  }
  // edh-c-78 (CR 614.9, 614.1a, 616.1, 611.2a; Blood of the Martyr; family redirect-may-damage-creatures): "Until end of turn, if damage would be dealt to any creature, you may have that
  // damage dealt to you instead": an optional redirection of the damage any creature would be dealt to you, for a duration
  if (b.b === 'redirect' && b.amount === undefined && ev.ev === 'damage' && ev.source === undefined && ev.combat === undefined && ev.amount === undefined && isLimited(duration) && e.optional === true && !e.shield
    && !e.condition && e.selfReplacement !== true && ev.recipient?.player === undefined && JSON.stringify(ev.recipient?.object) === '{"types":["Creature"]}' && JSON.stringify(b.to) === '{"ref":"you"}') {
    const fork = cloneState(st);
    const generic = genericReplace(e, fork, duration);
    const dur = durationSuffix(duration, st);
    absorb(st, fork);
    return alt(generic, `if damage would be dealt to any creature${dur}, you may have that damage dealt to you instead`, `${dur.trim()}, if damage would be dealt to any creature, you may have that damage dealt to you instead`);
  }
  if (b.b === 'redirect' && b.amount !== undefined) return redirectBudget(e, b, st, duration);
  // FAST5 T36 (CR 701.9a, 614.1a): "If a spell or ability an opponent controls causes you to discard ~, put it onto the battlefield instead of putting it into your graveyard"
  if (b.b === 'modify' && ev.ev === 'zoneChange' && ev.byOpponent === true && ev.cause === 'discard' && ev.subject.self === true && ev.from === 'hand' && ev.to === 'graveyard'
    && Object.keys(ev.subject).length === 1 && b.destination?.zone === 'battlefield' && b.destination.controller === 'owner' && Object.keys(b).length === 2 && Object.keys(b.destination).length === 2
    && e.optional !== true && e.condition === undefined && e.shield === undefined && duration === undefined) {
    return `if a spell or ability an opponent controls causes you to discard ${K.obj({ ref: 'self' }, st, 'subject').text}, put it onto the battlefield instead of putting it into your graveyard`;
  }
  // edh-next-106 (CR 701.9a, 614.1a, 701.20a, 400.7; Nephalia Academy): "If a spell or ability an opponent controls causes you to discard a card, you may reveal that card and put it on top
  // of your library instead of putting it anywhere else." (the reveal gives a new object nothing to remember, CR 400.7: it has no state of its own)
  if (b.b === 'modify' && ev.ev === 'zoneChange' && ev.byOpponent === true && ev.cause === 'discard' && ev.from === 'hand' && ev.to === undefined && Object.keys(ev).length === 5
    && JSON.stringify(ev.subject) === '{"owner":"you"}' && JSON.stringify(b.destination) === '{"zone":"library","position":"top"}' && Object.keys(b).length === 2
    && e.optional === true && e.condition === undefined && e.shield === undefined && e.selfReplacement !== true && duration === undefined) {
    return 'if a spell or ability an opponent controls causes you to discard a card, you may reveal that card and put it on top of your library instead of putting it anywhere else';
  }
  // edh-zones-20 (CR 701.9a, 614.1a, 401.4; Library of Leng): "If an effect causes you to discard a card, discard it, but you may put it on top of your library instead of into your
  // graveyard": the discard of one of your cards by the effect of a spell or ability, which you may send to the top of your library instead (the whole replacement, nothing more)
  if (b.b === 'modify' && ev.ev === 'zoneChange' && ev.byEffect === true && ev.cause === 'discard' && ev.from === 'hand' && ev.to === 'graveyard' && Object.keys(ev).length === 6
    && JSON.stringify(ev.subject) === '{"owner":"you"}' && JSON.stringify(b.destination) === '{"zone":"library","position":"top"}' && Object.keys(b).length === 2
    && e.optional === true && e.condition === undefined && e.shield === undefined && e.selfReplacement !== true && duration === undefined) {
    return 'if an effect causes you to discard a card, discard it, but you may put it on top of your library instead of into your graveyard';
  }
  // FAST5 T40 (CR 614.1a, 614.5): "Double all damage that sources you control of the chosen type would deal" (Collective Inferno): the doubling of all damage a kind of
  // source would deal, worded without "instead"
  if (b.b === 'modify' && ev.ev === 'damage' && ev.source !== undefined && ev.recipient === undefined && ev.combat === undefined && ev.amount === undefined && b.amount?.mul === 2
    && Object.keys(b.amount).length === 1 && Object.keys(b).length === 2 && e.condition === undefined && e.optional !== true && e.shield === undefined && duration === undefined) {
    const fork = cloneState(st);
    const generic = genericReplace(e, fork, duration);
    // CLOUD std-msh (CR 614.1a, 301.5): "Double all damage equipped creature would deal" (Mjolnir, Hammer of Thor): the one creature the source is attached to
    const attached = JSON.stringify(ev.source) === JSON.stringify({ attachedToSource: true });
    // edh-next-104 (CR 614.1a, 120.3; Wolverine, Best There Is): the source itself, "Double all damage ~ would deal"
    const selfSource = JSON.stringify(ev.source) === '{"self":true}';
    const text = selfSource ? `double all damage ${K.obj({ ref: 'self' }, st, 'object').text} would deal` : attached ? `double all damage ${K.np(ev.source, st, { det: 'none' })} would deal` : `double all damage that ${K.np(ev.source, st, { det: 'none', plural: true, head: 'source' })} would deal`;
    // edh-next-2 (CR 614.1a, 614.5; Raphael, the Muscle): a source of a kind of permanent is said by its own noun, "Double all damage that creatures you control with counters on them would deal"
    const typed = attached || selfSource ? [] : [`double all damage that ${K.np(ev.source, cloneState(st), { det: 'none', plural: true })} would deal`];
    absorb(st, fork);
    return alt(generic, text, ...typed); // the "if ... instead" reading is the display; Oracle also words the doubling alone so
  }
  // edh-replace-1 (CR 615.1, 615.6, 107.1a; Gisela, Blade of Goldnight): a static prevention of half of ALL the damage any source would deal to you or a permanent you control,
  // "If a source would deal damage to you or a permanent you control, prevent half that damage, rounded up." Only the exact shape (no source, combat or amount restriction,
  // no duration, shield, condition or additional instruction)
  if (b.b === 'prevent' && ev.ev === 'damage' && e.optional !== true && e.shield === undefined && e.condition === undefined && duration === undefined && b.then === undefined && b.as === undefined
    && ev.source === undefined && ev.combat === undefined && ev.amount === undefined && ev.excess === undefined && JSON.stringify(ev.recipient) === '{"player":"you","object":{"controller":"you"}}'
    && typeof b.amount === 'object' && b.amount.q === 'math' && b.amount.op === 'ceilDiv' && JSON.stringify(b.amount.args) === '[{"q":"eventAmount"},2]') {
    return `if ${K.np({}, st, { det: 'a', head: 'source' })} would deal damage to you or ${K.np({ controller: 'you' }, st, { det: 'a' })}, prevent half that damage, rounded up`;
  }
  // edh-replace-1 (CR 615.1, 615.6; Temple Altisaur): "If a source would deal damage to another Dinosaur you control, prevent all but 1 of that damage." (the amount is the damage
  // less N, `{q:'math', op:'-', args:[{q:'eventAmount'}, N]}`, N a number); damage to objects only, from any source, no duration, shield or condition
  if (b.b === 'prevent' && ev.ev === 'damage' && e.optional !== true && e.shield === undefined && e.condition === undefined && duration === undefined && b.then === undefined && b.as === undefined
    && ev.source === undefined && ev.combat === undefined && ev.amount === undefined && ev.excess === undefined && ev.recipient?.object !== undefined && ev.recipient.player === undefined && Object.keys(ev.recipient).length === 1
    && typeof b.amount === 'object' && b.amount.q === 'math' && b.amount.op === '-' && b.amount.args.length === 2 && JSON.stringify(b.amount.args[0]) === '{"q":"eventAmount"}' && typeof b.amount.args[1] === 'number') {
    return `if ${K.np({}, st, { det: 'a', head: 'source' })} would deal damage to ${K.np(ev.recipient.object, st, { det: 'a' })}, prevent all but ${b.amount.args[1]} of that damage`;
  }
  // edh-replace-4 (CR 615.1, 615.6; Ajani Steadfast's emblem): "If a source would deal damage to you or a planeswalker you control, prevent all but 1 of that damage." The same
  // prevention as above for damage to you or to objects of a description (template sta.edhr4.damage.preventAllButN.toYouOrFilter)
  if (b.b === 'prevent' && ev.ev === 'damage' && e.optional !== true && e.shield === undefined && e.condition === undefined && duration === undefined && b.then === undefined && b.as === undefined
    && ev.source === undefined && ev.combat === undefined && ev.amount === undefined && ev.excess === undefined && ev.recipient?.object !== undefined && ev.recipient.player === 'you' && Object.keys(ev.recipient).length === 2
    && typeof b.amount === 'object' && b.amount.q === 'math' && b.amount.op === '-' && b.amount.args.length === 2 && JSON.stringify(b.amount.args[0]) === '{"q":"eventAmount"}' && typeof b.amount.args[1] === 'number') {
    return `if ${K.np({}, st, { det: 'a', head: 'source' })} would deal damage to you or ${K.np(ev.recipient.object, st, { det: 'a' })}, prevent all but ${b.amount.args[1]} of that damage`;
  }
  if (b.b === 'prevent' && ev.ev === 'damage' && e.optional !== true) {
    // PUSH1 T2: each reading starts from the same state (the generic one must not make "target creature" of the other an anaphor); both are known after
    const fork = cloneState(st);
    const generic = genericReplace(e, fork, duration);
    const text = preventDamage(e, ev, b, st, duration);
    absorb(st, fork);
    // edh-c-83 (CR 615.1a, 615.7, 112.1; Plated Pegasus; family prevent-n-spell-damage): "If a spell would deal damage to a permanent or player, prevent 1 damage that spell would
    // deal to that permanent or player." is the generic "prevent 1 of that damage" with the damage named by its spell (only a spell as the source, any recipient, a number)
    if (ev.source?.stackKind === 'spell' && typeof b.amount === 'number' && (b.then === undefined || b.then.length === 0) && duration === undefined && e.condition === undefined && !e.shield) {
      const fork2 = cloneState(st);
      const present = K.event(ev, fork2, 'would');
      return alt(text, generic, `if ${present}, prevent ${b.amount} damage that spell would deal to that permanent or player`);
    }
    return alt(text, generic);
  }
  return genericReplace(e, st, duration);
}

/**
 * FAST4 T19 (CR 614.9, 615.7 by analogy): a redirection shield with a budget, "The next N damage that would be dealt to ~ this turn is dealt to target creature
 * you control instead" (Warrior en-Kor). Only the exact shape the engine reads (effects/prevent.ts): a damage pattern with one object recipient named by its
 * reference and nothing else, a shield of every use whose amount is the body's amount; anything else is refused, never dropped.
 */
function redirectBudget(e: ReplacementDef, b: Extract<ReplacementDef['body'], { b: 'redirect' }>, st: RenderState, duration: Duration | undefined): string {
  const ev = e.replaces;
  if (ev.ev !== 'damage' || ev.source !== undefined || ev.combat !== undefined || ev.amount !== undefined || e.condition !== undefined || e.optional === true || e.selfReplacement === true) {
    throw new NoRenderer('a redirect with an amount on anything but damage to one object');
  }
  const r = ev.recipient;
  const isOnly = r !== undefined && r.player === undefined && r.object?.is !== undefined && Object.keys(r.object).filter((k) => (r.object as Record<string, unknown>)[k] !== undefined).length === 1;
  if (!isOnly || e.shield === undefined || e.shield.uses !== 'all' || JSON.stringify(e.shield.amount) !== JSON.stringify(b.amount)) {
    throw new NoRenderer('a redirect with an amount that is not a shield on one object (its words come with the shield)');
  }
  const amount = b.amount!;
  const recipient = K.obj(r!.object!.is!, st, 'object').text;
  const to = refText(b.to, st, 'object').text;
  return `the next ${K.qty(amount, st)} damage that would be dealt to ${recipient}${durationSuffix(duration, st)} is dealt to ${to} instead`;
}

/**
 * edh-replace-3 (CR 615.5, 122.1; Vigor): the additional instruction of a prevention may put a counter on the creature the damage would have been dealt to for each 1 damage
 * prevented, "Put a +1/+1 counter on that creature for each 1 damage prevented this way." (the step is `putCounters` on the event's `object` with the damage prevented as its
 * count). Null for any other additional instruction.
 */
function counterPerPrevented(b: Extract<ReplacementDef['body'], { b: 'prevent' }>): string | null {
  const c = b.then?.length === 1 ? b.then[0] : undefined;
  if (c?.op !== 'putCounters' || typeof c.kind !== 'string' || JSON.stringify(c.count) !== '{"q":"preventedAmount"}' || JSON.stringify(c.on) !== '{"ref":"event","role":"object"}') return null;
  if (Object.keys(c).some((k) => c[k as keyof typeof c] !== undefined && !['op', 'on', 'kind', 'count'].includes(k))) return null;
  // edh-c-36 (Brace for Impact): the instruction may also come first, "For each 1 damage prevented this way, put a +1/+1 counter on that creature."
  return alt(`put a ${c.kind} counter on that creature for each 1 damage prevented this way`, `for each 1 damage prevented this way, put a ${c.kind} counter on that creature`);
}

/**
 * edh-next-10 (CR 615.5, 122.1; Phyrexian Hydra): the counter goes on the permanent itself when the prevention is its own, "Put a -1/-1 counter on ~ for each 1 damage prevented
 * this way." (one more reading beside std-spm's "prevent that damage and put that many +1/+1 counters on ~", said by the step). Null for any other additional instruction.
 */
function ownCounterPerPrevented(b: Extract<ReplacementDef['body'], { b: 'prevent' }>): string | null {
  const c = b.then?.length === 1 ? b.then[0] : undefined;
  if (c?.op !== 'putCounters' || typeof c.kind !== 'string' || JSON.stringify(c.count) !== '{"q":"preventedAmount"}' || JSON.stringify(c.on) !== '{"ref":"self"}') return null;
  if (Object.keys(c).some((k) => c[k as keyof typeof c] !== undefined && !['op', 'on', 'kind', 'count'].includes(k))) return null;
  return `put a ${c.kind} counter on ~ for each 1 damage prevented this way`;
}

/**
 * edh-next-42 (CR 615.5, 121.1; Swans of Bryn Argoll): the additional instruction of a prevention may be the controller of the damage's source drawing cards for the damage
 * prevented, "The source's controller draws cards equal to the damage prevented this way." (a `draw` by the controller of the event's damage source, the amount prevented).
 * Null for any other additional instruction.
 */
function sourceControllerDraws(b: Extract<ReplacementDef['body'], { b: 'prevent' }>): string | null {
  const d = b.then?.length === 1 ? b.then[0] : undefined;
  if (d?.op !== 'draw' || JSON.stringify(d.count) !== '{"q":"preventedAmount"}' || JSON.stringify(d.who) !== '{"ref":"controllerOf","object":{"ref":"event","role":"source"}}') return null;
  if (Object.keys(d).some((k) => d[k as keyof typeof d] !== undefined && !['op', 'who', 'count'].includes(k))) return null;
  return "the source's controller draws cards equal to the damage prevented this way";
}

/**
 * edhd67 (CR 615.5, 121.1, 107.1a; Sokrates, Athenian Teacher): the additional instruction of a prevention of the damage a permanent would deal to a player may be that permanent's
 * controller and the player each drawing half the damage prevented, rounded down: "~'s controller and that player each draw half that many cards, rounded down." (two `draw` steps,
 * the first by the controller of the source itself, the second by the player damaged, both of half the damage prevented). Null for any other additional instruction.
 */
function ownerAndRecipientDrawHalf(b: Extract<ReplacementDef['body'], { b: 'prevent' }>): string | null {
  const [a, c] = b.then ?? [];
  if (b.then?.length !== 2 || a?.op !== 'draw' || c?.op !== 'draw') return null;
  const half = '{"q":"math","op":"floorDiv","args":[{"q":"preventedAmount"},2]}';
  if (JSON.stringify(a.count) !== half || JSON.stringify(c.count) !== half) return null;
  if (JSON.stringify(a.who) !== '{"ref":"controllerOf","object":{"ref":"self"}}' || JSON.stringify(c.who) !== '{"ref":"event","role":"recipient"}') return null;
  if ([a, c].some((d) => Object.keys(d).some((k) => d[k as keyof typeof d] !== undefined && !['op', 'who', 'count'].includes(k)))) return null;
  return "~'s controller and that player each draw half that many cards, rounded down";
}

/**
 * edh-next-10 (CR 615.5, 406.1; Immortal Coil): the additional instruction of a prevention may be you exiling a card of your graveyard for each 1 damage prevented, "Exile a card
 * from your graveyard for each 1 damage prevented this way." (a choice of that many cards, the damage prevented as both bounds, then their move to exile). Null for any other
 * additional instruction.
 */
function exilePerPrevented(b: Extract<ReplacementDef['body'], { b: 'prevent' }>, st: RenderState): string | null {
  if (b.then?.length !== 2) return null;
  const [pick, mv] = b.then as [EffectStep, EffectStep];
  const n = '{"q":"preventedAmount"}';
  if (pick.op !== 'chooseObjects' || mv.op !== 'move' || JSON.stringify(pick.min) !== n || JSON.stringify(pick.max) !== n || JSON.stringify(pick.who) !== '{"ref":"you"}'
    || pick.from.ref !== 'each' || !('filter' in pick.from) || pick.from.filter.owner !== 'you' || pick.from.filter.zone !== 'graveyard'
    || JSON.stringify(mv.what) !== JSON.stringify({ ref: 'bound', name: pick.as }) || JSON.stringify(mv.to) !== '{"zone":"exile"}') return null;
  if (Object.keys(pick).some((k) => pick[k as keyof typeof pick] !== undefined && !['op', 'who', 'from', 'min', 'max', 'as'].includes(k))) return null;
  if (Object.keys(mv).some((k) => mv[k as keyof typeof mv] !== undefined && !['op', 'what', 'to'].includes(k))) return null;
  return `exile ${K.np(pick.from.filter, st, { det: 'a' })} for each 1 damage prevented this way`;
}

/**
 * edh-replace-7 (CR 615.5, 120.3, 109.4, 608.2h; Comeuppance, ruling 2014-11-07): the additional instruction of a prevention may be damage back at the source of the prevented damage, by its kind:
 * "If damage from a creature source is prevented this way, ~ deals that much damage to that creature. If damage from a noncreature source is prevented this way, ~ deals that much damage to
 * the source's controller." (an `if` on the replaced damage's source being a creature: the damage prevented to that source, else to the source's controller). Null for any other additional instruction.
 */
function backToSource(b: Extract<ReplacementDef['body'], { b: 'prevent' }>, st: RenderState): string | null {
  const c = b.then?.length === 1 ? b.then[0] : undefined;
  if (c?.op !== 'if' || c.cond.cond !== 'matches' || JSON.stringify(c.cond.object) !== '{"ref":"event","role":"source"}' || JSON.stringify(c.cond.filter) !== '{"types":["Creature"]}' || c.then.length !== 1 || (c.else ?? []).length !== 1) return null;
  const dmg = (x: EffectStep | undefined, to: string): boolean => x?.op === 'damage' && JSON.stringify(x.source) === '{"ref":"self"}' && JSON.stringify(x.amount) === '{"q":"preventedAmount"}' && JSON.stringify(x.to) === to
    && Object.keys(x).every((k) => ['op', 'source', 'to', 'amount'].includes(k) || x[k as keyof typeof x] === undefined);
  if (!dmg(c.then[0], '{"ref":"event","role":"source"}') || !dmg(c.else![0], '{"ref":"controllerOf","object":{"ref":"event","role":"source"}}')) return null;
  const self = K.obj({ ref: 'self' }, st, 'subject').text;
  return `if damage from a creature source is prevented this way, ${self} deals that much damage to that creature. if damage from a noncreature source is prevented this way, ${self} deals that much damage to the source's controller`;
}

/**
 * edh-next-37 (CR 615.5, 615.1a, 120.3, 608.2h; Acolyte's Reward, Divine Deflection): the additional instruction of a prevention SHIELD may be damage dealt by the spell to a target for
 * the damage prevented, "If damage is prevented this way, ~ deals that much damage to any target." (a `damage` step from the source itself of the amount prevented, to a target the
 * spell names). Null for any other additional instruction.
 */
function damageBackToTarget(b: Extract<ReplacementDef['body'], { b: 'prevent' }>, e: ReplacementDef, st: RenderState): string | null {
  const c = b.then?.length === 1 ? b.then[0] : undefined;
  if (!e.shield || c?.op !== 'damage' || JSON.stringify(c.source) !== '{"ref":"self"}' || JSON.stringify(c.amount) !== '{"q":"preventedAmount"}' || c.to.ref !== 'target') return null;
  if (Object.keys(c).some((k) => c[k as keyof typeof c] !== undefined && !['op', 'source', 'to', 'amount'].includes(k))) return null;
  const self = K.obj({ ref: 'self' }, st, 'subject').text;
  return `if damage is prevented this way, ${self} deals that much damage to ${refText(c.to, st, 'object').text}`;
}

/**
 * edh-replace-3 (CR 603.12, 615.5; Phyrexian Vindicator): the additional instruction of a named prevention may be a reflexive trigger with targets, "When damage is
 * prevented this way, ~ deals that much damage to any other target." (the targets are announced as it is put on the stack, so they are its own). Null for any other
 * additional instruction.
 */
function whenPreventedThen(b: Extract<ReplacementDef['body'], { b: 'prevent' }>, st: RenderState): string | null {
  const rf = b.then?.length === 1 ? b.then[0] : undefined;
  if (rf?.op !== 'reflexive' || b.as === undefined || rf.when.did !== b.as || rf.when.if !== undefined || rf.modes !== undefined || rf.guard !== undefined || rf.as !== undefined || rf.targets.length === 0) return null;
  return `when damage is prevented this way, ${K.program({ targets: rf.targets, steps: rf.do }, st)}`;
}

/** "Prevent all combat damage that would be dealt this turn." / "Prevent the next 3 damage that would be dealt to target creature this turn." */
function preventDamage(e: ReplacementDef, ev: Extract<EventPattern, { ev: 'damage' }>, b: Extract<ReplacementDef['body'], { b: 'prevent' }>, st: RenderState, duration: Duration | undefined): string {
  const amount = b.amount === 'all' ? 'all' : e.shield ? `the next ${K.qty(b.amount, st)}` : `${K.qty(b.amount, st)} of`;
  // p2-replace-damage-1 (CR 615.1a, 120.1, 611.2a): the damage ONE object would deal is also "prevent all combat damage target creature would deal this turn" (Resistance
  // Fighter; family prevent-object-would-deal): the same damage, said with its source as the subject; only all of it, to anything, with nothing after it. Its own
  // state, forked before the other reading names the object
  const src = ev.source;
  const oneSource = src !== undefined && src.is !== undefined && Object.keys(src).filter((k) => (src as Record<string, unknown>)[k] !== undefined).length === 1;
  // edh-c-46 (CR 615.5, 119.3; Hallow): the additional instruction may be "You gain life equal to the damage prevented this way."
  const gainPrevented = b.then?.length === 1 && b.then[0]!.op === 'gainLife' && JSON.stringify(b.then[0]!.who) === '{"ref":"you"}' && JSON.stringify((b.then[0] as { amount?: unknown }).amount) === '{"q":"preventedAmount"}';
  const wouldDeal = oneSource && ev.recipient === undefined && ev.amount === undefined && b.amount === 'all' && (b.then === undefined || b.then.length === 0 || gainPrevented) && !e.shield ? (() => {
    const fork = cloneState(st);
    const combatWord = ev.combat === true ? 'combat ' : ev.combat === false ? 'noncombat ' : '';
    // edh-next-99 (CR 611.2a; Gideon of the Trials): without the extra instruction the duration may also lead the sentence, "Until your next turn, prevent all damage target permanent would deal."
    const said = `prevent all ${combatWord}damage ${K.obj(src!.is!, fork, 'subject').text} would deal`;
    return { fork, text: gainPrevented ? `${said}${durationSuffix(duration, fork)}. ${K.steps(b.then!, fork)}` : lasting(said, duration, fork) };
  })() : null;
  // p2-replace-damage-4 (CR 615.7, 615.1a): a one-use shield on the damage ONE object would deal (to anything, or to you) is "The next time target creature would deal
  // damage this turn, prevent that damage." (Mercenaries; family prevent-next-time-object), its own state forked as above
  const youOnly = JSON.stringify(ev.recipient) === '{"player":"you"}';
  // edhd67 (CR 615.7, 510.2; Impulsive Maneuvers): also combat damage to anything, "the next time that creature would deal combat damage this turn, prevent that damage", and
  // a source that is a role of the event of the trigger around the effect (read through st.outerTrigger, as a replacement's own event has no such role)
  const nextTime = oneSource && (ev.recipient === undefined || youOnly) && ev.amount === undefined && (ev.combat === undefined || (ev.combat === true && !youOnly)) && b.amount === 'all' && (b.then === undefined || b.then.length === 0)
    && e.shield?.uses === 1 && e.shield.amount === undefined ? (() => {
      const fork = cloneState(st);
      const srcText = st.outerTrigger !== undefined ? withTrigger(fork, st.outerTrigger, () => K.obj(src!.is!, fork, 'subject').text) : K.obj(src!.is!, fork, 'subject').text;
      return { fork, text: `the next time ${srcText} would deal ${ev.combat === true ? 'combat ' : ''}damage${youOnly ? ' to you' : ''}${durationSuffix(duration, fork)}, prevent that damage` };
    })() : null;
  const combat = ev.combat === true ? 'combat ' : ev.combat === false ? 'noncombat ' : ''; // FAST5 T40 (CR 120.2a-b): Crystal Barricade
  const r = ev.recipient;
  // PUSH1 T2: a shield on one object ("to target creature", "to it", "to ~") names it by its reference, as the instruction that created it did (CR 615.7)
  const isOnly = r?.object !== undefined && r.object.is !== undefined && Object.keys(r.object).filter((k) => (r.object as Record<string, unknown>)[k] !== undefined).length === 1;
  // ... and a shield on ONE target that may be an object or a player ("to any target", CR 115.4) is the object part `is` it and the player part that same ref
  const either = isOnly && r!.player !== undefined && JSON.stringify(r!.player) === JSON.stringify(r!.object!.is);
  // p2-replace-damage-1 (CR 102.1, 615.1a): damage to any player is also "to players" (Commencement of Festivities; family prevent-to-players)
  const playerTo = (p: PlayerPred): string => (p === 'any' ? alt(K.player(p, st, 'object').text, 'players') : K.player(p, st, 'object').text);
  const recipient = r ? (isOnly && (r.player === undefined || either) ? ` to ${K.obj(r.object!.is!, st, 'object').text}` : r.object !== undefined && r.player === undefined ? ` to ${alt(K.np(r.object, st, { det: 'a' }), K.np(r.object, st, { det: 'none', plural: true }))}` : r.player !== undefined && r.object === undefined ? ` to ${playerTo(r.player)}` : null) : '';
  // r4-repl (CR 615.1a, 120.3): "to you and creatures you control" (Eerie Interference): the player and the described permanents, neither one target
  const both = recipient === null && r?.player !== undefined && r.object !== undefined && r.object.is === undefined
    ? (() => {
      const pl = K.player(r.player, st, 'object').text;
      const objs = K.np(r.object, st, { det: 'none', plural: true });
      // edh-next-37 (CR 615.1a, 120.3; Divine Deflection; family prevent-you-and-or-permanents): "you and/or permanents you control" is the same recipients as "you and permanents you control"
      return alt(` to ${pl} and ${objs}`, ` to ${pl} and/or ${objs}`);
    })() : null;
  if (recipient === null && both === null) throw new NoRenderer('a prevention shield on an object or a player that are not one target');
  const to = recipient ?? both!;
  // p2-replace-damage-1 (CR 120.3, 109.4): a source described by who controls it and its color only is also "sources": "by sources you don't control" (Energy Field;
  // family prevent-by-sources), any object, a spell as well as a permanent
  const srcKeys = ev.source ? Object.keys(ev.source).filter((k) => (ev.source as Record<string, unknown>)[k] !== undefined) : [];
  const sources = ev.source && srcKeys.length > 0 && srcKeys.every((k) => k === 'controller' || k === 'not' || k === 'colors' || k === 'notSubtypes' /* edh-next-10: Repel the Abominable, "non-Human sources" */)
    && (ev.source.not === undefined || Object.keys(ev.source.not).join() === 'controller') ? [K.np(ev.source, st, { det: 'none', plural: true, head: 'source' }), K.np(ev.source, st, { det: 'a', head: 'source' })] : [];
  // edh-next-4 (CR 608.2c; Terrifying Presence): each reading names a target of the sentence on its own copy of the state ("creatures other than target creature")
  // edhd67: a source named by a role of the trigger around the effect is read through that trigger's roles (Impulsive Maneuvers)
  const srcVariants = (): string[] => withVariants(st, [(v) => K.np(ev.source!, v, { det: 'a' }), (v) => K.np(ev.source!, v, { det: 'none', plural: true })]);
  const [srcOne, srcMany] = ev.source ? (st.outerTrigger !== undefined && ev.source.is?.ref === 'event' ? withTrigger(st, st.outerTrigger, srcVariants) : srcVariants()) : [];
  const source = ev.source ? ` by ${alt(srcOne!, srcMany!, ...sources)}` : '';
  // edh-replace-1 (CR 615.5, 111.1; Inkshield): a token for each 1 damage prevented, "For each 1 damage prevented this way, create a 2/1 ... token ...": the one token step
  // whose count is the damage prevented, said for one token
  const perDamage = b.then?.length === 1 && b.then[0]!.op === 'createToken' && JSON.stringify((b.then[0] as { count?: unknown }).count) === '{"q":"preventedAmount"}' && JSON.stringify((b.then[0] as { who?: unknown }).who) === '{"ref":"you"}'
    ? `. for each 1 damage prevented this way, ${K.steps([{ ...(b.then[0] as object), count: 1 } as unknown as EffectStep], st)}` : null;
  // edh-c-39 (CR 615.5, 122.1; Test of Faith): a prevention SHIELD (the sentence before it names the creature) puts its counters "For each 1 damage prevented this way, put a +1/+1 counter on that creature."
  // (coordinator A, 2026-10-31: the kind is read here, not from counterPerPrevented's text, which edh-c-36 made an alt group of two orders)
  const shieldCounters = e.shield && perDamage === null && counterPerPrevented(b) !== null ? (b.then![0] as { kind: string }).kind : null;
  const perDamageCounter = shieldCounters === null ? null : `. for each 1 damage prevented this way, put a ${shieldCounters} counter on that creature`;
  const wp = perDamage === null && perDamageCounter === null ? whenPreventedThen(b, st) ?? counterPerPrevented(b) ?? backToSource(b, st) ?? damageBackToTarget(b, e, st) : null;
  const then = perDamage ?? perDamageCounter ?? (wp !== null ? `. ${wp}` : b.then && b.then.length > 0 ? `. ${K.steps(b.then, st)}` : '');
  const dur = durationSuffix(duration, st);
  const main = `prevent ${amount} ${combat}damage that would be dealt${to}${source}${dur}${then}`;
  // r4-repl (CR 611.2a, 615.1a): a resolved prevention effect may also say its duration before the sources ("... to you and creatures you control this turn by
  // creatures", Eerie Interference) or first ("Until your next turn, prevent all damage that would be dealt to you.", Morningtide's Light); not a shield, whose
  // duration is part of its own words (family prevent-duration-placed)
  const placed = dur === '' || e.shield ? [] : [...(source !== '' ? [`prevent ${amount} ${combat}damage that would be dealt${to}${dur}${source}${then}`] : []), `${dur.trim()}, prevent ${amount} ${combat}damage that would be dealt${to}${source}${then}`];
  if (wouldDeal !== null) { placed.push(wouldDeal.text); absorb(st, wouldDeal.fork); }
  // edh-next-4 (CR 120.1, 615.1a, 611.2a; Haze Frog): the damage a described group of sources would deal, said with the group as the subject, "Prevent all combat damage that
  // other creatures would deal this turn."; only all of it, to anything, not a shield
  // edh-c-36 (CR 120.3, 615.1a; Chameleon Blur; family prevent-group-would-deal): the same, to any player: "Prevent all damage that creatures would deal to players this turn."
  const toPlayers = r?.player === 'any' && r.object === undefined;
  if (ev.source !== undefined && !oneSource && (r === undefined || toPlayers) && ev.amount === undefined && b.amount === 'all' && then === '' && !e.shield) {
    // edh-c-83 (Frontline Strategist; family prevent-group-would-deal): "that" may be left out, "Prevent all combat damage non-Soldier creatures would deal this turn."
    // (coordinator A, 2026-10-31: the "that" wording keeps edh-c-36's "to players", which edh-c-83's merge had dropped: Chameleon Blur)
    placed.push(withVariants(st, [(v) => `prevent all ${combat}damage that ${K.np(ev.source!, v, { det: 'none', plural: true })} would deal${toPlayers ? ' to players' : ''}${dur}`])[0]!);
    placed.push(withVariants(st, [(v) => `prevent all ${combat}damage ${K.np(ev.source!, v, { det: 'none', plural: true })} would deal${toPlayers ? ' to players' : ''}${dur}`])[0]!);
  }
  // edh-c-71 (CR 120.1, 615.1a, 611.2a; Radiant Kavu, template eff.edhv71.prevent.combat.twoGroupsWould.dur): two described groups of sources, said as two subjects, "Prevent all
  // combat damage blue creatures and black creatures would deal this turn."; only all of it, to anything, not a shield (family prevent-group-would-deal)
  const twoGroups = ev.source?.anyOf;
  if (twoGroups !== undefined && twoGroups.length === 2 && srcKeys.length === 1 && r === undefined && ev.amount === undefined && b.amount === 'all' && then === '' && !e.shield) {
    placed.push(withVariants(st, [(v) => `prevent all ${combat}damage ${twoGroups.map((g) => K.np(g, v, { det: 'none', plural: true })).join(' and ')} would deal${dur}`])[0]!);
  }
  // p2-replace-damage-1 (CR 611.2a, 615.1a): the duration of a resolved prevention may also come before its recipients, "Prevent all damage that would be dealt this turn
  // to creatures you control." (Sivvi's Ruse; family prevent-duration-placed)
  if (dur !== '' && !e.shield && to !== '') placed.push(`prevent ${amount} ${combat}damage that would be dealt${dur}${to}${source}${then}`);
  // p2-replace-damage-1 (CR 615.7, 107.3): a shield of a computed amount is also "prevent the next X damage ... this turn, where X is ..." (Samite Pilgrim; family
  // prevent-x-where), the amount fixed as the shield is created
  if (e.shield && b.amount !== 'all' && typeof b.amount === 'object' && b.amount.q !== 'X' && then === '') {
    placed.push(`prevent the next x ${combat}damage that would be dealt${to}${source}${dur}, where x is ${K.qty(b.amount, cloneState(st))}`);
  }
  // edh-next-37 (CR 615.7, 107.3; Acolyte's Reward): ... and with the damage it then deals for the damage prevented (family prevent-x-where, the same wording with its additional instruction)
  if (e.shield && b.amount !== 'all' && typeof b.amount === 'object' && b.amount.q !== 'X' && wp !== null && damageBackToTarget(b, e, cloneState(st)) !== null) {
    placed.push(`prevent the next x ${combat}damage that would be dealt${to}${source}${dur}, where x is ${K.qty(b.amount, cloneState(st))}${then}`);
  }
  if (nextTime !== null) { placed.push(nextTime.text); absorb(st, nextTime.fork); }
  // edh-replace-2 (CR 615.1a, 120.3, 611.2a; family prevent-by-sources-would-deal): the damage a described group of sources would deal to permanents of a description, said with the
  // sources as the subject: "Prevent all damage that black and/or red sources would deal to creatures you control this turn." (Surge of Salvation); only all of it, not a shield
  if (sources.length > 0 && r?.object !== undefined && r.player === undefined && !isOnly && b.amount === 'all' && then === '' && !e.shield && ev.amount === undefined) {
    placed.push(`prevent all ${combat}damage that ${K.np(ev.source!, st, { det: 'none', plural: true, head: 'source' })} would deal${to}${dur}`);
  }
  const words = placed.length > 0 ? alt(main, ...placed) : main;
  // p2-replace-damage-4 (CR 615.1a, 500.1): a static prevention that applies during your turn only says so first, "During your turn, prevent all damage that would be
  // dealt to you." (Personal Sanctuary; family prevent-during-your-turn); the generic "if ... and it's your turn" reading is the caller's
  if (e.condition !== undefined && JSON.stringify(e.condition) === '{"cond":"turnOf","whose":"you"}' && duration === undefined && !e.shield) return alt(`during your turn, ${main}`, `${main} during your turn`);
  return words;
}

/** M6-10 (CR 121.4): "while your library has no cards in it" is the condition "the number of cards in your library is 0" (Laboratory Maniac). */
function emptyOwnLibrary(c: NonNullable<ReplacementDef['condition']>): boolean {
  return JSON.stringify(c) === JSON.stringify({ cond: 'compare', left: { q: 'zoneSize', zone: 'library', of: { ref: 'you' } }, op: '==', right: 0 });
}

/**
 * std-library-4 (CR 614.1a, 401.1): "while your library has at least that many cards in it" (Ashiok, Wicked Manipulator) is the condition "the number of cards in your
 * library is <n> or greater", said in the words of the replacement's own condition; "that many" is the amount of the replaced event. null for any other condition.
 */
function ownLibraryAtLeast(c: NonNullable<ReplacementDef['condition']>, st: RenderState): string | null {
  if (c.cond !== 'compare' || c.op !== '>=' || JSON.stringify(c.left) !== JSON.stringify({ q: 'zoneSize', zone: 'library', of: { ref: 'you' } })) return null;
  const n = c.right;
  const words = typeof n === 'number' ? String(n) : JSON.stringify(n) === '{"q":"eventAmount"}' ? 'that many' : null;
  return words === null ? null : `your library has at least ${words} cards in it`;
}

function genericReplace(e: ReplacementDef, st: RenderState, duration: Duration | undefined): string {
  const ev = e.replaces;
  const it = 'it';
  // FAST5 T40 (CR 614.1a): the condition of a replacement effect is "and <it>", or "while <it>" (Rollercrusher Ride), and a turn condition on nobody's step is
  // "during your turn" (Bloodletter of Aclazotz)
  const yourTurn = e.condition?.cond === 'turnOf' && e.condition.whose === 'you' && e.condition.step === undefined;
  const condition = e.condition
    ? (emptyOwnLibrary(e.condition) ? alt(` and ${K.cond(e.condition, st)}`, ' while your library has no cards in it')
      : yourTurn ? alt(` and ${K.cond(e.condition, st)}`, ' during your turn') : alt(` and ${ownLibraryAtLeast(e.condition, st) ?? K.cond(e.condition, st)}`, ` while ${ownLibraryAtLeast(e.condition, st) ?? K.cond(e.condition, st)}`))
    : '';
  const dur = durationSuffix(duration, st);
  // edhd67 (CR 614.1a, 615.8; Impulsive Maneuvers): a replacement of the damage of a creature the trigger around the effect names by an event role ("Whenever a creature attacks, ... the next time that
  // creature would deal combat damage this turn, ...") says its source through the roles of that outer trigger (a replaced event has no 'attacker')
  const outerRoles = st.outerTrigger !== undefined && ev.ev === 'damage' && ev.source?.is?.ref === 'event';
  const eventText = (tense: 'would' | 'present'): string => (outerRoles ? withTrigger(st, st.outerTrigger!, () => K.event(ev, st, tense)) : K.event(ev, st, tense));
  const present = eventText('would');
  // p2-replace-events-2 (family next-time-would): the one-use shield is also "the next time you would draw a card this turn" (Words of Wilding)
  const lead = e.shield && e.shield.uses === 1 ? alt(`the next time ${eventText('present')}${dur}`, `if ${present}${dur}`, `the next time ${present}${dur}`) : `if ${present}${dur}`;
  const sentence = `${lead}${condition}, ${bodyText(e, it, st)}`.replace(', instead,', ' instead,');
  // FAST5 T69 (CR 611.2a): "Until your next turn, if a source would deal damage to that player ..., it deals double that damage instead": the duration may also lead
  // the replacement of a resolved effect (not a shield, whose duration is part of its own words)
  // edh-d-57 (CR 614.1a, 611.2a, 120.3; Quest for Pure Flame): "If any source you control would deal damage to a permanent or player this turn, it deals double that damage to that permanent or player instead."
  // (template eff.edhd57.damage.double.anySources.toPermanentOrPlayer.dur): a source of yours, damage to anything, doubled, for a duration; said with "any source" and the recipient repeated
  if (ev.ev === 'damage' && dur !== '' && !e.shield && e.condition === undefined && JSON.stringify(ev.source) === '{"controller":"you"}' && Object.keys(ev).filter((k) => (ev as Record<string, unknown>)[k] !== undefined).length === 2
    && JSON.stringify(e.body) === '{"b":"modify","amount":{"mul":2}}' && inlineDuration(duration) !== null) {
    const anySource = `if any source you control would deal damage to a permanent or player${dur}, it deals double that damage to that permanent or player instead`;
    return alt(sentence, anySource);
  }
  if (dur === '' || e.shield) return sentence;
  // edh-next-12 (CR 614.1a, 611.2a; Isengard Unleashed; family replace-damage-inline-duration): the duration of a damage replacement also sits inside the event,
  // "if a source you control would deal damage this turn to an opponent or ..., it deals triple that damage instead"
  const inl = inlineDuration(duration);
  const mid = inl !== null && ev.ev === 'damage' && present.includes(' damage to ') ? [`if ${present.replace(' damage to ', ` damage ${inl} to `)}${condition}, ${bodyText(e, it, st)}`.replace(', instead,', ' instead,')] : [];
  return alt(sentence, `${dur.trim()}, if ${present}${condition}, ${bodyText(e, it, st)}`.replace(', instead,', ' instead,'), ...mid);
}

// ---------------------------------------------------------------------------
// Permissions, rule modifications, trigger modifiers, cost options
// ---------------------------------------------------------------------------

/** The optional fields of a permission that its sentence has words for (design 3.3: any other that is set is refused, never dropped). */
const PERMIT_FIELDS: Record<Extract<StaticEffect, { s: 'permit' }>['action'], string[]> = {
  cast: ['of', 'from', 'asThough', 'fromTop', 'oncePerTurn', 'anyManaType', 'anyManaColor', 'while', 'asAdventure', 'onCast' /* edh-next-127 */, 'colorlessAnyColor' /* edh-d-97 */], play: ['of', 'from', 'fromTop', 'anyManaType', 'anyManaColor', 'while', 'onCast' /* edh-next-127 */], playLand: ['count'], activate: ['of', 'asThough'], spendMana: ['asThough', 'of'] /* CLOUD std-fdn */, haveFlash: ['of', 'asThough', 'costChange'],
  attackAsThoughHaste: ['of', 'opponentsOnly'] /* edh-b-14 */,
  attackAsThoughNoDefender: ['of', 'attackedYouLastTurn'] /* r3-static; edh-combat-6 */, blockAsThough: ['asThough', 'attacker', 'of'] /* p2-attack-block-1; edhv31 (`of`: the blocker, Aetherflame Wall) */, lookAt: ['of'] /* FAST5X E25 */, revealTop: [], revealHand: [] /* edh-next-12 */, assignAsUnblocked: ['of', 'mandatory'] /* edh-combat-3; edh-d-25 */,
  activateLoyaltyAsInstant: ['of'], // r4-mech (CR 606.3)
  plot: ['of', 'fromTop'], // std-freecast-5 (CR 702.170f): said by permit() itself, before this table is read
  activateEquipAsInstant: [], // edh-mana-keywords-8 (CR 702.6a, 602.5d)
};

/**
 * FAST5X E14 (CR 401.5, 601.3, 305.1): the permissions for the card on top of a library, as Oracle words them: "you may cast creature spells from the top of
 * your library", "you may play lands from the top of your library", "you may play cards from the top of your library" / "you may play the top card of your
 * library", "once each turn, you may cast an instant or sorcery spell from the top of your library". Null when `e` is not such a permission.
 */
function topPermitWhat(e: Extract<StaticEffect, { s: 'permit' }>, st: RenderState): string | null {
  if (e.fromTop !== true || (e.action !== 'cast' && e.action !== 'play') || e.from !== undefined || e.asThough !== undefined) return null;
  if (e.oncePerTurn === true && e.action !== 'cast') throw new NoRenderer('once each turn on a play permission');
  if (e.action === 'play') {
    if (e.of === undefined) return 'play cards';
    return `play ${K.np(e.of, st, { det: 'none', plural: true })}`;
  }
  if (e.of === undefined) return e.oncePerTurn === true ? 'cast a spell' : 'cast spells';
  if (e.oncePerTurn === true) return `cast ${K.np(e.of, st, { det: 'a' })}`;
  return `cast ${isSpellFilter(e.of) ? spellsPhrase(e.of, st) : K.np(e.of, st, { det: 'none', plural: true, head: 'spell' })}`;
}

const topLibrary = (who: { person: string }): string => `${who.person === 'you' ? 'your' : 'their'} library`;

/**
 * std-rx27 (CR 614.1c, 601.3e): the "enters with" rider of the last top-card cast permission of a sentence, ". if you cast a creature spell this way, that creature
 * enters with an additional +1/+1 counter on it" (statics/play-permits.ts#topPermitFor), or '' when none has one. Only for spells of one card type
 * (`entersWithIf` exactly that type) and fixed numbers of counters.
 */
function topEntersRider(perms: readonly Extract<StaticEffect, { s: 'permit' }>[]): string {
  const riders = perms.filter((p) => p.entersWith !== undefined || p.entersWithIf !== undefined);
  if (riders.length === 0) return '';
  const p = riders[0]!;
  const types = p.entersWithIf?.types;
  if (riders.length > 1 || p !== perms[perms.length - 1] || p.action !== 'cast' || p.entersWith === undefined || p.entersWithIf === undefined
    || Object.keys(p.entersWithIf).length !== 1 || types?.length !== 1) throw new NoRenderer('an "enters with" rider other than for the spells of one card type of the last cast permission');
  const noun = types[0]!.toLowerCase();
  const counters = joinList(p.entersWith.map((c) => {
    if (typeof c.count !== 'number' || c.count < 1) throw new NoRenderer('an "enters with" rider with a computed number of counters');
    const s = c.count === 1 ? '' : 's';
    return alt(`${c.count} additional ${c.kind} counter${s}`, `${c.count} ${c.kind} counter${s}`);
  }));
  return `. if you cast a ${noun} spell this way, that ${noun} enters with ${counters} on it`;
}

/**
 * edh-cast-12 (CR 611.2c, 702.10a; statics/play-permits.ts#topPermitFor): the keyword rider of the last top-card cast permission of a sentence, ". if you cast a creature
 * spell this way, it gains haste until end of turn", or '' when none has one. Only haste, only for creature spells (the permission's `of` has the Creature type), and not
 * together with an "enters with" rider.
 */
function topGainsRider(perms: readonly Extract<StaticEffect, { s: 'permit' }>[]): string {
  const riders = perms.filter((p) => p.gainsThisTurn !== undefined);
  if (riders.length === 0) return '';
  const p = riders[0]!;
  if (riders.length > 1 || p !== perms[perms.length - 1] || p.action !== 'cast' || p.gainsThisTurn!.keyword !== 'haste' || p.entersWith !== undefined || !(p.of?.types?.length === 1 && p.of.types[0] === 'Creature')) {
    throw new NoRenderer('a keyword rider other than haste for creature spells on the last cast permission, or one next to an "enters with" rider');
  }
  return `. if you cast a creature spell this way, it gains ${p.gainsThisTurn!.keyword} until end of turn`;
}

/**
 * edh-d-44 (CR 601.2f, 118.8; Into the Pit, Falco Spara): the additional cost of the last top-card cast permission of a sentence, " by sacrificing a nonland permanent in addition to
 * paying their other costs", or '' when none has one (only for the last permission, the way the riders are said).
 */
function topCostTail(perms: readonly Extract<StaticEffect, { s: 'permit' }>[], st: RenderState): string {
  const costed = perms.filter((p) => p.addCost !== undefined);
  if (costed.length === 0) return '';
  const p = costed[0]!;
  if (costed.length > 1 || p !== perms[perms.length - 1] || p.action !== 'cast' || p.oncePerTurn !== undefined) throw new NoRenderer('an additional cost other than on the last (cast) top-card permission alone');
  return ` by ${graveyardCostGerund(p.addCost!, st)} in addition to paying their other costs`;
}

/**
 * edh-d-44 (CR 601.3b, 702.8a; Elsha of the Infinite): the flash rider of the last top-card cast permission of a sentence, ". if you cast a spell this way, you may cast it as though it had
 * flash", or '' when none has one.
 */
function topFlashRider(perms: readonly Extract<StaticEffect, { s: 'permit' }>[]): string {
  const riders = perms.filter((p) => p.flashThisWay !== undefined);
  if (riders.length === 0) return '';
  const p = riders[0]!;
  if (riders.length > 1 || p !== perms[perms.length - 1] || p.action !== 'cast' || p.gainsThisTurn !== undefined || p.entersWith !== undefined) {
    throw new NoRenderer('a flash rider other than on the last cast permission alone');
  }
  return '. if you cast a spell this way, you may cast it as though it had flash';
}

/**
 * std-exile-play-1-1 (CR 118.9, 202.3; family pay-life-rather-than): the life cost of the last top-card permission of a sentence, ". if you cast a spell this way, pay
 * life equal to its mana value rather than pay its mana cost" (statics/play-permits.ts#topPermitFor), or '' when none has a cost. Only exactly that cost, on the
 * last permission.
 */
function topLifeRider(perms: readonly Extract<StaticEffect, { s: 'permit' }>[]): string {
  const costed = perms.filter((p) => p.costChange !== undefined);
  if (costed.length === 0) return '';
  if (costed.length > 1 || costed[0] !== perms[perms.length - 1] || JSON.stringify(costed[0]!.costChange) !== '{"kind":"set","life":"manaValue"}') {
    throw new NoRenderer('a top-card permission with a cost other than "pay life equal to its mana value rather than pay its mana cost" on the last permission');
  }
  return `. if you cast a spell this way, pay life equal to its mana value rather than ${alt('pay', 'paying')} its mana cost`;
}

function topPermit(e: Extract<StaticEffect, { s: 'permit' }>, st: RenderState): string | null {
  const what = topPermitWhat(e, st);
  if (what === null) return null;
  const who = K.player(e.who, st, 'subject');
  const base = `${who.text} may ${what} from the top of ${topLibrary(who)}${topEntersRider([e])}${topGainsRider([e])}${topFlashRider([e])}${topCostTail([e], st)}`;
  if (e.oncePerTurn === true) return `once each turn, ${base}`;
  return e.action === 'play' && e.of === undefined ? alt(base, `${who.text} may play the top card of ${topLibrary(who)}`) : base;
}

/**
 * edh-next-62 (CR 607.2a, 406.3, 601.3, 305.1; statics/play-permits.ts#isLinkedLook): a static `lookAt` permission for the cards a linked ability exiled, alone ("You may look
 * at the cards exiled with ~") or followed by the plain play permission for the same cards, said in one sentence ("..., and you may play lands and cast spells from among
 * those cards"). Null when `effects` are not exactly that.
 */
function linkedLookText(effects: readonly StaticEffect[], st: RenderState): string | null {
  const [a, b] = [effects[0], effects[1]];
  const linkedOnly = '{"is":{"ref":"linked","link":"exiled"}}';
  if (a?.s !== 'permit' || a.action !== 'lookAt' || effects.length > 2 || JSON.stringify(a) !== `{"s":"permit","who":{"ref":"you"},"action":"lookAt","of":${linkedOnly}}`) return null;
  const self = K.obj({ ref: 'self' }, st, 'object').text;
  const look = `you may look at ${alt('the cards', 'cards')} exiled with ${self}`;
  if (b === undefined) return look;
  if (JSON.stringify(b) !== `{"s":"permit","who":{"ref":"you"},"action":"play","of":${linkedOnly}}`) return null;
  return `${look}, and you may play lands and cast spells from among those cards`;
}

/** A `lookAt` permission with no other field: "you may look at the top card of your library any time" (CR 401.5). */
const isPlainLookAt = (e: StaticEffect): e is Extract<StaticEffect, { s: 'permit' }> =>
  e.s === 'permit' && e.action === 'lookAt' && e.of === undefined && e.from === undefined && e.asThough === undefined && e.count === undefined && e.fromTop === undefined;

const isTopPermitEffect = (e: StaticEffect | undefined): e is Extract<StaticEffect, { s: 'permit' }> =>
  e !== undefined && e.s === 'permit' && e.fromTop === true && e.oncePerTurn === undefined && (e.action === 'cast' || e.action === 'play');

/**
 * FAST5X E14: one sentence for "you may look at the top card of your library any time" followed by top-card permissions of the same player, or for two
 * top-card permissions ("you may play lands and cast Bird spells from the top of your library", "Until end of turn, you may look at the top card of your
 * library any time, and you may play lands and cast spells from the top of your library"). Null when `effects` (from `i`) do not start that way; else the text
 * and how many effects it says.
 */
export function topPermitsSentence(effects: readonly StaticEffect[], i: number, st: RenderState, duration?: Duration): { text: string; n: number } | null {
  const first = effects[i];
  if (first === undefined) return null;
  const look = isPlainLookAt(first) ? first : null;
  let j = look ? i + 1 : i;
  const perms: Extract<StaticEffect, { s: 'permit' }>[] = [];
  while (j < effects.length && perms.length < 2 && isTopPermitEffect(effects[j])) perms.push(effects[j++] as Extract<StaticEffect, { s: 'permit' }>);
  if (perms.length === 0 || (look === null && perms.length < 2)) return null;
  const whoKey = JSON.stringify(perms[0]!.who);
  if (perms.some((p) => JSON.stringify(p.who) !== whoKey) || (look !== null && JSON.stringify(look.who) !== whoKey)) return null;
  if (perms.length === 2 && !(perms[0]!.action === 'play' && perms[1]!.action === 'cast')) return null; // "play lands and cast X"
  const [text] = withVariants(st, [(v) => {
    const who = K.player(perms[0]!.who, v, 'subject');
    const whats = perms.map((p) => topPermitWhat(p, v)!);
    const permits = perms.length === 1 && perms[0]!.action === 'play' && perms[0]!.of === undefined
      ? alt(`${who.text} may play cards from the top of ${topLibrary(who)}`, `${who.text} may play the top card of ${topLibrary(who)}`)
      : `${who.text} may ${whats.join(' and ')} from the top of ${topLibrary(who)}${topEntersRider(perms)}${topGainsRider(perms)}${topFlashRider(perms)}${topCostTail(perms, v)}`;
    const body = look === null ? permits : `${who.text} may look at the top card of ${topLibrary(who)} any time${alt(', and ', ' and ')}${permits}`;
    // std-exile-play-1-1: the life cost of the spells cast this way is a sentence of its own, after the duration (topLifeRider)
    return `${lasting(body, isLimited(duration) ? duration : undefined, v)}${topLifeRider(perms)}`;
  }]);
  return { text: text!, n: j - i };
}

/**
 * C10 (CR 305.1, 601.3, 611.2a): "you may play lands and cast permanent spells from your graveyard", "until end of turn, you may play lands and cast spells
 * from your graveyard": GY1's land permission followed by a graveyard cast permission without riders, said in one sentence. Null when `effects` (from `i`)
 * do not start that way; else the text and how many effects it says.
 */
export function graveyardPermitsSentence(effects: readonly StaticEffect[], i: number, st: RenderState, duration?: Duration): { text: string; n: number } | null {
  const [a, b] = [effects[i], effects[i + 1]];
  if (a?.s !== 'permit' || b?.s !== 'permit' || a.action !== 'play' || b.action !== 'cast' || a.from !== 'graveyard' || b.from !== 'graveyard') return null;
  if (JSON.stringify(a.of) !== JSON.stringify({ types: ['Land'] }) || b.addCost !== undefined || b.entersWith !== undefined || b.oncePerTurn !== undefined) return null;
  const play = graveyardPermit(a, st);
  const cast = graveyardPermit(b, st);
  if (!play.endsWith(' from your graveyard') || !cast.startsWith('you may cast ')) return null;
  const body = `${play.slice(0, -' from your graveyard'.length)} and ${cast.slice('you may '.length)}`;
  return { text: lasting(body, isLimited(duration) ? duration : undefined, st), n: 2 };
}

/** FAST3 T15: a filter of spells (`stackKind: 'spell'`), or exactly two of them joined (`anyOf`). */
function isSpellFilter(f: ObjectFilter): boolean {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  if (keys.length === 1 && keys[0] === 'anyOf') return f.anyOf!.length === 2 && f.anyOf!.every((x) => x.stackKind === 'spell');
  return f.stackKind === 'spell';
}

/**
 * FAST5X E29 (CR 609.4b): a play or cast permission whose spells may be paid for with mana of any type, "..., and mana of any type can be spent to cast it".
 * std-rs (family cast-this-way-any-type): also the rider sentence "If you cast a spell this way, you may spend mana as though it were mana of any type to cast it."
 * (rider rid.stdrs.castThisWay.spendAnyType). `plural`: the permission names several cards (undefined: either).
 */
export function anyTypeRider(base: string, plural?: boolean, color = false, who = 'you'): string {
  const them = plural === undefined ? alt('it', 'that spell', 'them', 'those spells') : plural ? alt('them', 'those spells') : alt('it', 'that spell');
  // std-exile-play-1-1 (family cast-this-way-any-type): or the sentence "Mana of any type can be spent to cast spells this way." (rider rid.stdexile1.castThisWay.anyManaType)
  // std-exile-play-1-1 (family any-type-rider-and): Oracle also joins the rider without the comma, "... until end of turn and mana of any type can be spent to cast that spell"
  // pc-exile-play-1 (CR 609.4b, 107.4c): or, for a permission with `anyManaColor`, "..., and you may spend mana as though it were mana of any color to cast that spell"
  // edh-d-90 (CR 609.4b, 107.4c; Curse of Hospitality): a permission of another player is "... and they may spend mana as though it were mana of any color to cast that spell" (`who`)
  return alt(`${base}${alt(', and', ' and')} ${color ? `${who} may spend mana as though it were mana of any color to cast` : 'mana of any type can be spent to cast'} ${them}`,
    // edh-cast-7 (CR 609.4b; family cast-this-way-any-type): or "If you cast a spell this way, mana of any type can be spent to cast it." (rider rid.edhc7.castThisWay.anyManaType.passive)
    // edh-players-15 (CR 609.4b, 107.4c; family cast-this-way-any-color): or, for `anyManaColor`, "... If you cast a spell this way, you may spend mana as though it were mana of any color to cast it." (rider rid.edhp15.castThisWay.spendAnyColor)
    ...(color ? [`${base}. if you cast a spell this way, you may spend mana as though it were mana of any color to cast it`] : [`${base}. if you cast a spell this way, you may spend mana as though it were mana of any type to cast it`, `${base}. if you cast a spell this way, mana of any type can be spent to cast it`, `${base}. mana of any type can be spent to cast ${alt('spells', 'a spell')} this way`]));
}

/**
 * FAST5X E29: a permission for named objects with "if <condition>" after it ("you may play it if you control a Kavu") and the rider of CR 609.4b after its
 * duration ("you may cast that card for as long as it remains exiled, and mana of any type can be spent to cast it").
 */
function permitRiders(e: Extract<StaticEffect, { s: 'permit' }>, st: RenderState, d: Duration | undefined): string {
  if (e.action !== 'play' && e.action !== 'cast') throw new NoRenderer(`permit ${e.action} with a rider`);
  const { anyManaType, anyManaColor, colorlessAnyColor, while: cond, graveyardInstead: gi, laterTurn, freeSubtypes, onCast, ...bare } = e;
  // edh-next-127 (CR 603.7a; The Ruinous Powers): "When you cast a spell this way, its owner loses life equal to its mana value." (the one delayed trigger a permission carries, exactly that step)
  const onCastText = onCast === undefined ? '' : JSON.stringify(onCast) === JSON.stringify([{ op: 'loseLife', who: { ref: 'ownerOf', object: { ref: 'event', role: 'spell' } }, amount: { q: 'stat', stat: 'manaValue', of: { ref: 'event', role: 'spell' } } }])
    ? '. when you cast a spell this way, its owner loses life equal to its mana value' : (() => { throw new NoRenderer('a permission\'s "when you cast a spell this way" other than "its owner loses life equal to its mana value"'); })();
  if (onCast !== undefined && (laterTurn !== undefined || freeSubtypes !== undefined || gi !== undefined)) throw new NoRenderer('a permission with "when you cast a spell this way" and another rider');
  if ([anyManaType, anyManaColor, colorlessAnyColor].filter((r) => r !== undefined).length > 1) throw new NoRenderer('a permission with two riders for how its spells are paid');
  // edh-d-97 (CR 609.4b, 107.4c; Abstruse Appropriation): "..., and you may spend colorless mana as though it were mana of any color to cast that spell": one cast permission for named objects,
  // with its duration and no other rider
  if (colorlessAnyColor !== undefined) {
    if (colorlessAnyColor !== true || e.action !== 'cast' || cond !== undefined || gi !== undefined || laterTurn !== undefined || freeSubtypes !== undefined || e.of?.is === undefined) throw new NoRenderer('a colorless-as-any-color rider beside other riders');
    return `${lasting(permit(bare, st, isLimited(d)), d, st)}${alt(', and', ' and')} you may spend colorless mana as though it were mana of any color to cast ${alt('it', 'that spell')}`;
  }
  const plain = permit(bare, st, isLimited(d));
  const during = duringTurnCounter(cond, d, st); // r5-dig
  // edh-d-58 (CR 611.2a, 514.2; Galvanic Relay): "During your next turn, you may play that card.": only on a turn of yours that begins after the effect did (`laterTurn`,
  // judged with the condition "it's your turn"), and no longer than the end of your next turn
  if (laterTurn !== undefined) {
    if (laterTurn !== true || cond === undefined || JSON.stringify(cond) !== '{"cond":"turnOf","whose":{"ref":"you"}}' || d?.d !== 'endOfNextTurn' || JSON.stringify(d.whose) !== '{"ref":"you"}') throw new NoRenderer('a permission after the current turn other than "during your next turn"');
    if (anyManaType !== undefined || anyManaColor !== undefined || gi !== undefined) throw new NoRenderer('a "during your next turn" permission with a rider');
    return `during your next turn, ${plain}`;
  }
  const base0 = during !== null ? `${during}, ${plain}` : lasting(cond === undefined ? plain : `${plain} if ${K.cond(cond, st)}`, d, st);
  // edh-next-138 (CR 611.2a, 118.9, 614.1a; Quintorius, Loremaster; family permit-free-this-turn-mid-rider): with a rider too, "You may cast that card this turn without paying its mana cost. If
  // that spell would be put into a graveyard, put it on the bottom of its owner's library instead.": the duration between the permission and its cost, as without a rider (permit-free-this-turn-mid)
  const mid = during === null && cond === undefined && e.of?.is !== undefined && e.costChange !== undefined && inlineDuration(d) === 'this turn' ? plain.replace(/ without paying /, ' this turn without paying ') : '';
  const base = mid.includes(' this turn without paying ') ? alt(base0, mid) : base0;
  // edh-d-58 (CR 118.9, 205.3; Nahiri, Forged in Fury): "You may play that card this turn. You may cast Equipment spells this way without paying their mana costs."
  if (freeSubtypes !== undefined) {
    if (freeSubtypes.length !== 1 || anyManaType !== undefined || anyManaColor !== undefined || gi !== undefined || e.action !== 'play') throw new NoRenderer('a free cast of one subtype beside other riders');
    return `${base}. you may cast ${freeSubtypes[0]!.toLowerCase()} spells this way without paying their mana costs`;
  }
  const any = anyManaType !== undefined ? anyTypeRider(base) : anyManaColor !== undefined ? anyTypeRider(base, undefined, true, e.who.ref === 'you' ? 'you' : 'they') : base;
  if (gi === undefined) return `${any}${onCastText}`;
  // r5-repl (CR 614.1a): "... If that spell would be put into a graveyard, exile it instead." (the words of the cast step's rider, render/steps-zones.ts)
  if (e.action !== 'cast') throw new NoRenderer('a play permission with a graveyard rider');
  const to = gi.to.zone === 'exile' && Object.keys(gi.to).length === 1 ? 'exile it'
    : gi.to.zone === 'library' && gi.to.position === 'bottom' && Object.keys(gi.to).length === 2 ? "put it on the bottom of its owner's library" : null;
  if (to === null) throw new NoRenderer('a spell cast this way sent elsewhere than exile or the bottom of its library instead of a graveyard');
  // p2-graveyard-2 (CR 614.1a, 400.7; family cast-this-way-spell): a graveyard permission's spell is also "a spell cast this way" ("Once during each of your turns, you
  // may cast an instant or sorcery spell from your graveyard. If a spell cast this way would be put into your graveyard, exile it instead", Kess, Dissident Mage)
  // edh-d-28 (family cast-this-way-spell; Radiant Scrollwielder): and the spell cast by a permission for a card an earlier instruction chose ("Exile an instant or sorcery card at random from your
  // graveyard. You may cast it this turn. If a spell cast this way would be put into your graveyard, exile it instead"): the permission names that card, and "a spell cast this way" is the one spell it lets you cast
  const spell = (e.from === 'graveyard' && e.of?.is === undefined) || (e.of?.is !== undefined && gi.yours === true) ? alt('that spell', 'a spell cast this way') : 'that spell';
  return `${any}. if ${spell} would be put into ${gi.yours === true ? 'your' : 'a'} graveyard, ${to} instead`;
}

/**
 * std-exile-play-2-3 (CR 118.9, 701.67a, 202.3, 611.2b): a cast permission for a named object, during your turn, for as long as you control the source, whose spell is
 * cast for "waterbend {X}, where X is its mana value" instead of its mana cost (the waterbend part's number is the card's mana value, fixed as the effect began,
 * effects/handlers/lasting-fix.ts): "for as long as you control ~, you may cast the exiled card during your turn by waterbending {x} rather than paying its mana cost,
 * where x is its mana value". Null for any other permission.
 */
function waterbendPermit(e: Extract<StaticEffect, { s: 'permit' }>, st: RenderState, d: Duration | undefined): string | null {
  const cost = e.costChange?.cost?.other;
  const part = cost?.length === 1 ? cost[0] : undefined;
  if (part?.kind !== 'action' || part.action !== 'waterbend') return null;
  const arg = part.arg as unknown as Record<string, unknown> | undefined;
  const ok = e.action === 'cast' && JSON.stringify(e.who) === '{"ref":"you"}' && e.of?.is !== undefined && Object.keys(e.of).length === 1
    && JSON.stringify(e.while) === '{"cond":"turnOf","whose":"you"}' && d?.d === 'whileSource' && d.as === 'controlled'
    && Object.keys(e).every((k) => ['s', 'who', 'action', 'of', 'while', 'costChange'].includes(k)) && JSON.stringify(Object.keys(e.costChange!).sort()) === '["cost","kind"]'
    && e.costChange!.kind === 'set' && Object.keys(e.costChange!.cost!).length === 1
    && arg !== undefined && arg['q'] === 'stat' && arg['stat'] === 'manaValue' && JSON.stringify(arg['of']) === JSON.stringify(e.of.is) && Object.keys(arg).length === 3;
  if (!ok) throw new NoRenderer('a waterbend cost on a permission other than "for as long as you control ~, you may cast <it> during your turn by waterbending {X} ..."');
  const self = K.obj({ ref: 'self' }, st, 'subject').text;
  const named = K.obj(e.of!.is!, st, 'object').text;
  // (family cast-the-exiled-card: the one card an earlier instruction of the ability exiled is also "the exiled card", the parser's reading of those words)
  const is = e.of!.is!;
  const exiled = is.ref === 'bound' && st.info.get(`b:${is.name}`)?.zone === 'exile' && st.info.get(`b:${is.name}`)?.plural === false;
  const it = exiled ? alt(named, 'the exiled card') : named;
  return `for as long as you control ${self}, you may cast ${it} during your turn by waterbending {x} rather than paying its mana cost, where x is its mana value`;
}

/**
 * std-exile-play-2-4 (CR 611.2a, 611.2c, 202.3, 118.9; Triple Triad): a free play permission for the cards of a group of exiled cards that a comparison picks as the
 * effect begins: the one you own, and each other one with lesser mana value than it (`of.is` an `each` filter over the group, locked by effects/handlers/lasting.ts).
 * Only exactly that filter, the group's cards being "exiled this way"; null when `of.is` is not an `each` filter, a refusal for any other one.
 */
function yoursAndLesserPermit(e: Extract<StaticEffect, { s: 'permit' }>, st: RenderState, d: Duration | undefined): string | null {
  const is = e.of?.is as unknown as Record<string, unknown> | undefined;
  if (is?.['ref'] !== 'each') return null;
  const f = is['filter'] as Record<string, unknown> | undefined;
  const group = f?.['is'] as { ref?: string; name?: string } | undefined;
  const mine = { zone: 'exile', is: group, owner: 'you' };
  const want = { zone: 'exile', is: group, anyOf: [{ owner: 'you' }, { manaValue: { op: '<', value: { q: 'stat', stat: 'manaValue', of: { ref: 'each', filter: mine } } } }] };
  const ok = group?.ref === 'bound' && typeof group.name === 'string' && st.info.get(`b:${group.name}`)?.thisWay === 'exiled this way'
    && JSON.stringify(f) === JSON.stringify(want) && e.action === 'play' && JSON.stringify(e.who) === '{"ref":"you"}' && Object.keys(e.of!).length === 1
    && JSON.stringify(e.costChange) === '{"kind":"set","cost":{}}' && Object.keys(e).every((k) => ['s', 'who', 'action', 'of', 'costChange'].includes(k)) && d?.d === 'endOfTurn';
  if (!ok) throw new NoRenderer('a permission for the cards an "each" filter picks, other than "the card you own exiled this way and each other card ... with lesser mana value than it"');
  return 'until end of turn, you may play the card you own exiled this way and each other card exiled this way with lesser mana value than it without paying their mana costs';
}

/**
 * r5-dig (CR 611.2c, 122.6, 714.3c, 400.7): a permission with no end that holds in a turn in which you put a counter of one kind on this object (named by `is`, so
 * the reference is fixed as the effect begins and still names it after it left) is "during any turn you put a lore counter on this Saga, you may play that card"
 * (Summon: Brynhildr): the turn's history of counters you put on it (rules/history.ts). Null for any other condition or duration.
 */
function duringTurnCounter(cond: Condition | undefined, d: Duration | undefined, st: RenderState): string | null {
  if (cond === undefined || cond.cond !== 'happened' || cond.scope !== 'turn' || cond.times !== undefined || cond.by !== undefined || (d !== undefined && d.d !== 'permanent')) return null;
  const e = cond.event;
  // edh-cast-11 (CR 508.1a, 611.2c; Neyali, Suns' Vanguard): "during any turn you attacked with a token, you may play that card": a creature you control that matches was declared
  // as an attacker this turn (the history of the turn's attacks, rules/history.ts)
  if (e.ev === 'attacks') {
    const att = e.attacker as ObjectFilter | undefined;
    const rec = e as unknown as Record<string, unknown>;
    if (att === undefined || att.controller !== 'you' || att.anyOf?.length !== 1 || Object.keys(att).filter((k) => (att as Record<string, unknown>)[k] !== undefined).length !== 2
      || Object.keys(rec).filter((k) => rec[k] !== undefined).length !== 2) return null;
    return `during any turn you attacked with ${K.np(att.anyOf[0]!, st, { det: 'a' })}`;
  }
  if (e.ev !== 'counters' || e.change !== 'put' || typeof e.kind !== 'string' || e.by !== 'you' || e.atLeast !== undefined || e.byEffect !== undefined) return null;
  if ('player' in e.on || JSON.stringify(e.on) !== '{"is":{"ref":"self"}}') return null;
  const article = /^[aeiou]/i.test(e.kind) ? 'an' : 'a';
  return `during any turn you put ${article} ${e.kind} counter on ${K.obj({ ref: 'self' }, st, 'object').text}`;
}

/**
 * C10 (CR 601.3, 601.2f, 614.1c, 305.1): a graveyard permission (statics/play-permits.ts#isGraveyardPermit): "you may cast artifact spells from your
 * graveyard by paying 3 life in addition to paying their other costs. if you cast a spell this way, that artifact enters with a finality counter on it",
 * "once each turn, you may cast a creature spell from your graveyard" (render/abil.ts says "once during each of your turns" with its condition), "you may
 * cast ~ from your graveyard. if you do, it enters with ...", "you may play cards from your graveyard". Only the forms the engine honors have words here.
 */
function graveyardPermit(e: Extract<StaticEffect, { s: 'permit' }>, st: RenderState): string {
  // trek-11 (CR 400.11, 305.1, 601.3): "Once during each of your turns, you may play a permanent card you own from outside the game or from your graveyard" (The Holodeck):
  // the one form statics/play-permits.ts#isPermanentPlayPermit honors (the once-each-turn words are render/abil.ts's, with the static's "your turn" condition)
  if (e.alsoOutside !== undefined) {
    const fine = e.alsoOutside === true && e.action === 'play' && e.from === 'graveyard' && e.oncePerTurn === true && JSON.stringify(e.who) === '{"ref":"you"}'
      && JSON.stringify(e.of) === '{"types":["Artifact","Battle","Creature","Enchantment","Land","Planeswalker"]}' && Object.keys(e).every((k) => ['s', 'who', 'action', 'of', 'from', 'alsoOutside', 'oncePerTurn'].includes(k));
    if (!fine) throw new NoRenderer('a permission that covers cards outside the game, outside its one form');
    return `once each turn, you may play a permanent card you own ${alt('from outside the game or from your graveyard', 'from your graveyard or from outside the game')}`; // trek-11: the two places in either order (family play-outside-or-graveyard)
  }
  // edh-zones-22 (CR 305.1, 601.3, 614.1c; Serra Paragon): "you may play a land from your graveyard or cast a permanent spell with mana value 3 or less from your graveyard. If you do, it
  // gains <quoted abilities>": the one form statics/play-permits.ts#isCappedPermanentPlayPermit honors (the once-each-turn words are render/abil.ts's)
  if (e.entersAbilities !== undefined) {
    const cap = e.of?.manaValue;
    const fine = e.action === 'play' && e.from === 'graveyard' && e.oncePerTurn === true && JSON.stringify(e.who) === '{"ref":"you"}' && e.of !== undefined && Object.keys(e.of).sort().join() === 'manaValue,types'
      && JSON.stringify(e.of.types) === '["Artifact","Battle","Creature","Enchantment","Land","Planeswalker"]' && cap?.op === '<=' && typeof cap.value === 'number' && e.entersAbilities.length > 0
      && Object.keys(e).every((k) => ['s', 'who', 'action', 'of', 'from', 'oncePerTurn', 'entersAbilities'].includes(k));
    if (!fine || typeof cap?.value !== 'number') throw new NoRenderer('a permission that gives the abilities a permanent enters with, outside its one form');
    return `once each turn, you may play a land from your graveyard or cast a permanent spell with mana value ${cap.value} or less from your graveyard. if you do, it gains ${abilityList(e.entersAbilities, st, 'permanent')}`;
  }
  // edh-d-86 (CR 305.1, 601.3, 400.7; Kagha, Shadow Archdruid): "you may play a land or cast a permanent spell from among cards in your graveyard that were put there from your library this turn":
  // the one form statics/play-permits.ts#fromLibraryPermitForm ('ownPermanent') honors (the once-each-turn words are render/abil.ts's)
  if (e.action === 'play' && e.of?.putThereThisTurn !== undefined) {
    const fine = e.from === 'graveyard' && e.oncePerTurn === true && JSON.stringify(e.who) === '{"ref":"you"}' && Object.keys(e.of).sort().join() === 'putThereFrom,putThereThisTurn,types'
      && JSON.stringify(e.of.types) === '["Artifact","Battle","Creature","Enchantment","Land","Planeswalker"]' && e.of.putThereThisTurn === true && e.of.putThereFrom === 'library'
      && Object.keys(e).every((k) => ['s', 'who', 'action', 'of', 'from', 'oncePerTurn'].includes(k));
    if (!fine) throw new NoRenderer('a graveyard play permission with a history part, outside its one form');
    return `once each turn, you may ${alt('play a land or cast a permanent spell', 'cast a permanent spell or play a land')} from among cards in your graveyard that were put there from your library this turn`; // family play-land-or-cast-permanent-order
  }
  for (const k of ['asThough', 'count', 'costChange', 'grants', 'laterTurn', 'fromTop', 'anyManaType', 'while', 'graveyardInstead'] as const) if (e[k] !== undefined) throw new NoRenderer(`a graveyard permission with ${k}`);
  if (e.who.ref !== 'you' || Object.keys(e.who).length !== 1) throw new NoRenderer('a graveyard permission of another player');
  if (e.action === 'play') {
    if (e.addCost !== undefined || e.entersWith !== undefined || e.oncePerTurn !== undefined) throw new NoRenderer('a graveyard play permission with a rider');
    const playOf = e.of === undefined ? 'cards' : K.np(e.of, st, { det: 'none', plural: true });
    const landKind = /^(desert|forest|island|swamp|mountain|gate|cave|town|tower|mine|sphere|lair)s$/i.exec(playOf); // edh-b-5 (CR 205.3i, 305.1; family land-subtype-lands): "Desert lands" are the lands of that subtype
    return `you may play ${landKind === null ? playOf : alt(playOf, `${landKind[1]!} lands`)} from your graveyard`;
  }
  if (e.entersSubtypes !== undefined) throw new NoRenderer('a graveyard permission with subtypes it enters as, outside its one-spell form (staticEffect)');
  // edh-next-59 (CR 601.3, 400.7, 701.17a; Raul, Banon): "Once during each of your turns, you may cast a spell from among cards in your graveyard that were milled this turn"
  const among = e.action === 'cast' && e.oncePerTurn === true && e.of?.putThereThisTurn === true && e.of.putThereFrom !== undefined && (e.of.zone === undefined || e.of.zone === 'stack') && Object.keys(e).every((k) => ['s', 'who', 'action', 'of', 'from', 'oncePerTurn'].includes(k))
    ? { mill: 'milled this turn', notBattlefield: 'put there from anywhere other than the battlefield this turn' }[e.of.putThereFrom as string] : undefined;
  if (among !== undefined) {
    const { putThereThisTurn: _a, putThereFrom: _b, ...bare } = e.of!;
    return `once each turn, you may cast ${K.np(bare, st, { det: 'a' })} from among cards in your graveyard that were ${among}`;
  }
  const self = e.of !== undefined && Object.keys(e.of).length === 1 && e.of.self === true;
  const one = self || e.oncePerTurn === true || e.single === true; // "a creature spell", "~": "its other costs"
  const what = self ? K.obj({ ref: 'self' }, st, 'object').text
    : e.of === undefined ? (one ? 'a spell' : 'spells')
    : one ? K.np(e.of, st, { det: 'a' })
    : isSpellFilter(e.of) ? spellsPhrase(e.of, st) : K.np(e.of, st, { det: 'none', plural: true, head: 'spell' });
  // edh-zones-27 (CR 601.3, 400.3; The Great Work): "from any graveyard", the cards of every player's graveyard (`anyGraveyard`, a cast permission of a resolved effect)
  if (e.anyGraveyard === true && (e.addCost !== undefined || e.oncePerTurn === true || e.entersWith !== undefined || e.single === true)) throw new NoRenderer('a permission from any graveyard with a rider');
  let text = `you may cast ${what} from ${e.anyGraveyard === true ? 'any' : 'your'} graveyard`;
  // edh-next-59 (CR 202.3, 601.3e; family cast-gy-mana-value-after-zone; Arcade Gannon): "you may cast an artifact or Human spell from your graveyard with mana value less than or equal to ...":
  // the mana value limit follows the zone as it follows the spell
  const mvAt = what.indexOf(' with mana value ');
  if (mvAt > 0 && !self && e.anyGraveyard !== true && e.addCost === undefined && e.addGeneric === undefined && e.entersWith === undefined && what.indexOf(' with mana value ', mvAt + 1) < 0) {
    text = alt(text, `you may cast ${what.slice(0, mvAt)} from your graveyard${what.slice(mvAt)}`);
  }
  if (e.addCost !== undefined) text += ` by ${graveyardCostGerund(e.addCost, st)} in addition to ${alt(`paying ${one ? 'its' : 'their'} other costs`, `${one ? 'its' : 'their'} other costs`)}`;
  // edh-next-50 (CR 601.2f, 118.8; Risen Executioner): "if you pay {1} more to cast it for each other creature card in your graveyard", only for ~ and with no other rider
  if (e.addGeneric !== undefined) {
    const per = typeof e.addGeneric === 'object' && e.addGeneric.q === 'count' ? countParts(e.addGeneric, st) : null;
    if (!self || per === null || e.addCost !== undefined || e.oncePerTurn === true || e.entersWith !== undefined || e.single === true || e.anyGraveyard === true) throw new NoRenderer('a graveyard permission with an additional cost of generic mana, outside \"if you pay {1} more to cast it for each ...\"');
    text += ` if you pay {1} more to cast it for each ${per.singular}`;
  }
  if (e.oncePerTurn === true) text = `once each turn, ${text}`;
  if (e.entersWith !== undefined) {
    if (e.single === true) throw new NoRenderer('a one-spell graveyard permission with its rider, outside staticEffect');
    const counters = entersCounters(e.entersWith);
    // "that artifact" names the spell by the card type its permission is for (CR 614.1c); the card itself is "it" ("If you do, it enters with ...")
    const noun = self ? null : riderNoun(e.of);
    text += self ? `. if you do, ${alt('it', '~')} enters with ${counters} on it` : `. if you cast a spell this way, ${alt(`that ${noun}`, 'it')} enters with ${counters} on it`;
  }
  // edh-next-68 (CR 614.1c; Edgar, Master Machinist): "If you cast a spell this way, that artifact enters tapped."
  if (e.entersTapped === true) {
    if (self || e.entersWith !== undefined || e.single === true) throw new NoRenderer('a graveyard permission that enters tapped beside another rider, or for the card itself');
    text += `. if you cast a spell this way, that ${riderNoun(e.of)} enters tapped`;
  }
  return text;
}

/** C10: the counters of an "enters with" rider ("1 finality counter"); a computed number has no wording here. */
function entersCounters(list: NonNullable<Extract<StaticEffect, { s: 'permit' }>['entersWith']>): string {
  return joinList(list.map((c) => {
    if (typeof c.count !== 'number' || c.count < 1) throw new NoRenderer('an "enters with" rider with a computed number of counters');
    return `${c.count} ${c.kind} counter${c.count === 1 ? '' : 's'}`;
  }));
}

/**
 * std-freecast-2 (CR 601.3, 611.2a, 614.1c, 205.1b): a resolved effect's permission for one spell from your graveyard (`single`), "you may cast a creature spell from
 * your graveyard this turn", and its rider after the duration: "If you do, it enters with a finality counter on it and is a Vampire in addition to its other
 * types" (`entersWith`, `entersSubtypes`).
 */
function oneGraveyardSpell(e: Extract<StaticEffect, { s: 'permit' }>, st: RenderState, d: Duration | undefined): string {
  const { entersWith, entersSubtypes, ...bare } = e;
  if (d?.d !== 'endOfTurn' || e.action !== 'cast') throw new NoRenderer('a one-spell graveyard permission that does not last this turn');
  const head = lasting(graveyardPermit(bare, st), d, st);
  if (entersWith === undefined) {
    if (entersSubtypes !== undefined) throw new NoRenderer('subtypes it enters as without its counters');
    return head;
  }
  const types = entersSubtypes === undefined ? '' : ` and is ${withArticle(joinList(entersSubtypes))} in addition to its other types`;
  return `${head}. if you do, it enters with ${entersCounters(entersWith)} on it${types}`;
}

/** std-rx27 (CR 110.4a): the permanent types a spell can have (a land is never cast, CR 305.9), in the order the template builds their permissions. */
const CAST_PERMANENT_TYPES = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Planeswalker'];

/**
 * std-rx27: the permissions of "you may play a land and cast a permanent spell of each permanent type from your graveyard" (Muldrotha, the Gravetide): a land
 * play from your graveyard once each turn, then one cast permission for each permanent type a spell can have, once each turn each, all of you and nothing else.
 */
function eachPermanentTypeFromGraveyard(effects: readonly StaticEffect[]): boolean {
  if (effects.length !== 1 + CAST_PERMANENT_TYPES.length) return false;
  const want = [
    { s: 'permit', who: { ref: 'you' }, action: 'play', of: { types: ['Land'] }, from: 'graveyard', oncePerTurn: true },
    ...CAST_PERMANENT_TYPES.map((t) => ({ s: 'permit', who: { ref: 'you' }, action: 'cast', of: { types: [t], stackKind: 'spell', zone: 'stack' }, from: 'graveyard', oncePerTurn: true })),
  ];
  return effects.every((e, i) => JSON.stringify(e) === JSON.stringify(want[i]));
}

/** std-rx27: is this filter exactly the cards the linked ability `link` exiled, `{is: {ref:'linked', link}}`? */
const isLinkedOnly = (of: ObjectFilter | undefined): of is ObjectFilter =>
  of !== undefined && Object.keys(of).length === 1 && of.is?.ref === 'linked' && Object.keys(of.is).length === 2;

/**
 * std-rx27: the static linked cast permissions as Oracle words them (statics/play-permits.ts#isLinkedRiderPermit, statics/hooks.ts#castsAsInstant). Null when
 * `effects` is no such form (the plain r5-refs form is permit()'s):
 *  - "you may cast cards exiled with ~ and you may cast them as though they had flash. mana of any type can be spent to cast those spells" (Azula, Cunning
 *    Usurper): a cast permission for the linked cards and a flash permission for the same cards, the any-type rider on the first;
 *  - "you may cast Dinosaur creature spells from among cards you own exiled with ~. if you cast a spell this way, that creature enters with a finality counter
 *    on it" (the qualities, the owner, the "enters with" rider);
 *  - "once each turn, you may cast a spell with mana value 3 or less from among cards exiled with ~ this turn without paying its mana cost".
 */
function linkedPermitsText(effects: readonly StaticEffect[], st: RenderState): string | null {
  const self = (): string => K.obj({ ref: 'self' }, st, 'object').text;
  if (effects.length === 2) {
    const [a, b] = effects;
    if (a?.s !== 'permit' || b?.s !== 'permit' || a.action !== 'cast' || b.action !== 'haveFlash' || !isLinkedOnly(a.of) || JSON.stringify(a.of) !== JSON.stringify(b.of)) return null;
    if (!Object.keys(a).every((k) => ['s', 'who', 'action', 'of', 'anyManaType'].includes(k)) || !Object.keys(b).every((k) => ['s', 'who', 'action', 'of'].includes(k))) return null;
    if (JSON.stringify(a.who) !== '{"ref":"you"}' || JSON.stringify(b.who) !== '{"ref":"you"}') throw new NoRenderer('a linked flash permission of another player');
    const base = `you may cast cards exiled with ${self()} and you may cast them as though they had flash`;
    return a.anyManaType === true ? `${base}. mana of any type can be spent to cast those spells` : base;
  }
  const e = effects.length === 1 ? effects[0] : undefined;
  // edh-d-66 (CR 601.3, 108.3, 609.4b; Ian Malcolm): "During each player's turn, that player may cast a spell from among the cards they don't own exiled with ~, and mana of any type
  // can be spent to cast it." (statics/play-permits.ts#isLinkedRiderPermit with `who` active): exactly this shape, the cards' owner not the caster, any type of mana
  if (e?.s === 'permit' && e.action === 'cast' && e.of?.is?.ref === 'linked' && JSON.stringify(e.who) === '{"ref":"active"}') {
    if (e.notOwn !== true || e.anyManaType !== true || !isLinkedOnly(e.of) || Object.keys(e).filter((k) => (e as unknown as Record<string, unknown>)[k] !== undefined).length !== 6) throw new NoRenderer('a linked cast permission of the active player with something else');
    return `during each player's turn, that player may cast a spell from among the cards they don't own exiled with ${self()}, and mana of any type can be spent to cast it`;
  }
  // edh-d-100 (CR 305.1, 601.3, 609.4b, 603.2, 607.2a; Share the Spoils): "During each player's turn, that player may play a land or cast a spell from among cards exiled with ~, and they may
  // spend mana as though it were mana of any color to cast that spell. When they do, <steps>." (statics/play-permits.ts#isLinkedRiderPermit with `action` play): exactly this shape, one
  // land or spell each turn, the steps of its "When they do" (PermissionDef.onUse) said with "they" the player who played it
  if (e?.s === 'permit' && e.action === 'play' && e.of?.is?.ref === 'linked' && JSON.stringify(e.who) === '{"ref":"active"}') {
    const keys = Object.keys(e).filter((k) => (e as unknown as Record<string, unknown>)[k] !== undefined);
    if (e.anyManaColor !== true || e.oncePerTurn !== true || !isLinkedOnly(e.of) || keys.some((k) => !['s', 'who', 'action', 'of', 'anyManaColor', 'oncePerTurn', 'onUse'].includes(k))) throw new NoRenderer('a linked play permission of the active player with something else');
    const base = `during each player's turn, that player may play a land or cast a spell from among cards exiled with ${self()}, and they may spend mana as though it were mana of any color to cast that spell`;
    if (e.onUse === undefined) return base;
    const steps = K.steps(e.onUse.steps, st);
    return `${base}. when they do, ${alt(steps, steps.replace(/\bthat player's\b/g, 'their'))}`;
  }
  if (e?.s !== 'permit' || e.action !== 'cast' || e.of?.is?.ref !== 'linked' || isLinkedOnly(e.of) && e.costChange === undefined && e.oncePerTurn === undefined && e.entersWith === undefined) return null;
  if (!Object.keys(e).every((k) => ['s', 'who', 'action', 'of', 'oncePerTurn', 'entersWith', 'costChange', 'addCost'].includes(k))) return null; // the any-type rider alone: permitRiders
  if (JSON.stringify(e.who) !== '{"ref":"you"}' || e.of.zone !== undefined || e.of.putThereFrom !== undefined) throw new NoRenderer('a linked cast permission of another player or with a zone');
  const { is: _is, putThereThisTurn: thisTurn, owner, ...quality } = e.of;
  const one = e.oncePerTurn === true;
  const keys = Object.keys(quality).filter((k) => (quality as Record<string, unknown>)[k] !== undefined);
  const inner: ObjectFilter | null = keys.length === 0 ? null : keys.length === 1 && quality.anyOf?.length === 1 ? quality.anyOf[0]! : quality;
  const spells = inner === null ? (one ? 'a spell' : 'spells') : one ? K.np({ ...inner, zone: 'stack', stackKind: 'spell' }, st, { det: 'a' }) : isSpellFilter(inner) ? spellsPhrase(inner, st) : K.np(inner, st, { det: 'none', plural: true, head: 'spell' });
  if (owner !== undefined && owner !== 'you') throw new NoRenderer('linked cards an owner other than you owns');
  let text = `${one ? 'once each turn, ' : ''}you may cast ${spells} from among cards${owner === 'you' ? ' you own' : ''} exiled with ${self()}${thisTurn === true ? ' this turn' : ''}`;
  if (e.costChange !== undefined) {
    const c = e.costChange as unknown as Record<string, unknown>;
    const free = c['kind'] === 'set' && Object.keys(c).every((k) => c[k] === undefined || k === 'kind' || k === 'cost') && Object.values(c['cost'] as Record<string, unknown>).every((v) => v === undefined);
    if (!free) throw new NoRenderer('a linked cast permission with a cost other than none');
    text += one ? ' without paying its mana cost' : ' without paying their mana costs';
  }
  // std-exile-play-2-1 (CR 601.2f, 118.8): "... by removing three counters from among creatures you control in addition to paying their other costs" (the words of
  // a graveyard permission's additional cost, graveyardCostGerund)
  if (e.addCost !== undefined) {
    if (e.costChange !== undefined) throw new NoRenderer('a free linked cast permission with an additional cost');
    text += ` by ${graveyardCostGerund(e.addCost, st)} in addition to paying ${one ? 'its' : 'their'} other costs`;
  }
  if (e.entersWith !== undefined) {
    if (e.single === true) throw new NoRenderer('a one-spell graveyard permission with its rider, outside staticEffect');
    const counters = entersCounters(e.entersWith);
    text += `. if you cast a spell this way, ${alt(`that ${riderNoun(inner ?? undefined)}`, 'it')} enters with ${counters} on it`;
  }
  return text;
}

/** C10: "paying 3 life", "exiling two other cards from your graveyard": the additional cost of a graveyard permission after "by" (CR 601.2f, 118.8). */
function graveyardCostGerund(c: NonNullable<Extract<StaticEffect, { s: 'permit' }>['addCost']>, st: RenderState): string {
  const parts = c.other ?? [];
  if (c.mana !== undefined || c.tap !== undefined || c.untap !== undefined || c.loyalty !== undefined || parts.length === 0 || parts.length > 2) throw new NoRenderer('a graveyard permission cost of no part or more than two');
  // "paying 3 life and discarding a card" (Demonic Embrace)
  if (parts.length === 2) return `${graveyardCostGerund({ other: [parts[0]!] }, st)} and ${graveyardCostGerund({ other: [parts[1]!] }, st)}`;
  const p = parts[0]!;
  if (p.kind === 'payLife' && typeof p.amount === 'number') return `paying ${p.amount} life`;
  if (p.kind === 'discard' && p.count === 1 && p.filter === undefined && p.random === undefined && p.self === undefined && p.hand === undefined) return 'discarding a card';
  // r4-cost (CR 701.9a, 118.8): "discarding three cards"
  if (p.kind === 'discard' && typeof p.count === 'number' && p.count > 1 && p.filter === undefined && p.random === undefined && p.self === undefined && p.hand === undefined) return `discarding ${numWord(p.count)} cards`;
  if (p.kind === 'sacrifice' && p.count === 1 && p.self === undefined) return `sacrificing ${K.np(p.filter, st, { det: 'a' })}`;
  if (p.kind === 'exileFrom' && p.zone === 'graveyard' && typeof p.count === 'number' && p.filter !== undefined && Object.keys(p.filter).length === 1 && p.filter.other === true && p.self === undefined) {
    return `exiling ${p.count} other card${p.count === 1 ? '' : 's'} from your graveyard`;
  }
  // edh-next-68 (CR 601.2b, 118.8; Demilich, Helbrute): "exiling four instant and/or sorcery cards from your graveyard", "exiling another creature card from your graveyard"
  if (p.kind === 'exileFrom' && p.zone === 'graveyard' && typeof p.count === 'number' && p.filter !== undefined && p.self === undefined && p.orGraveyard === undefined && p.atLeast === undefined && p.link === undefined && p.totalManaValue === undefined && p.symbolTotal === undefined) {
    const { other, ...rest } = p.filter as Record<string, unknown>;
    if (Object.keys(rest).length > 0 && ((other === true && p.count === 1) || (other === undefined && p.count > 1))) {
      const said = K.costVerbs({ other: [p] }, st, 'you');
      return said.replace(/^exile /, 'exiling ').replace(' other ', ' another ');
    }
  }
  if (p.kind === 'action' && p.action === 'forage' && p.arg === undefined) return 'foraging';
  // edh-d-44 (CR 118.8, 122.1; Falco Spara, Pactweaver): "removing a counter from a creature you control"
  if (p.kind === 'removeCounters' && p.among === undefined && p.filter !== undefined && p.count === 1 && p.counter === 'any' && p.self === undefined && p.all === undefined && p.anyNumber === undefined) return `removing a counter from ${K.np(p.filter, st, { det: 'a' })}`;
  // r3-cost (CR 118.3, 122.1): "removing six counters from among creatures you control" (Quilled Greatwurm)
  if (p.kind === 'removeCounters' && p.among === true && p.filter !== undefined && typeof p.count === 'number' && p.self === undefined) {
    return `removing ${numWord(p.count)} ${p.counter === 'any' ? '' : `${p.counter} `}counter${p.count === 1 ? '' : 's'} from among ${K.np(p.filter, st, { det: 'none', plural: true })}`;
  }
  throw new NoRenderer(`a graveyard permission cost ${p.kind}`);
}

/** C10: the noun of "that artifact enters with ...": the one card type of the permission's spells. */
function riderNoun(of: ObjectFilter | undefined): string {
  const types = of?.types ?? [];
  if (types.length === 1) return types[0]!.toLowerCase();
  // trek-18 (CR 205.2a, 601.3e; Overflow Submatrix): "that artifact creature enters with ...": a spell that is all of two card types, said as the types in a row
  const all = of?.allTypes ?? [];
  if (types.length === 0 && all.length === 2) return all.map((t) => t.toLowerCase()).join(' ');
  throw new NoRenderer('an "enters with" rider for spells of no single card type');
}

/**
 * r3-cost (CR 118.9, 601.2b): an alternative cost a static ability gives other spells (statics/play-permits.ts#isAltCostPermit), as Oracle words it:
 *   "you may pay {W}{U}{B}{R}{G} rather than pay the mana cost for spells you cast"
 *   "once each turn, you may pay {0} rather than pay the mana cost for a spell you cast from exile"
 *   "you may cast spells from your hand without paying their mana costs", "you may cast dragon spells without paying their mana costs"
 * `of` is the spells, with where they are cast from (`castFrom`) around them (`{anyOf: [<spells>], castFrom}`). Only a cost of mana, or none; anything else is
 * refused (design 3.3).
 */
function alternativePermit(e: Extract<StaticEffect, { s: 'permit' }>, st: RenderState): string {
  const cc = e.costChange!;
  // edh-d-44 (CR 118.9, 601.3b, 107.14, 702.8a; Primal Prayers): "You may cast creature spells with mana value 3 or less by paying {E} rather than paying their mana costs. If you cast a spell this
  // way, you may cast it as though it had flash.": a payment of energy for the spells of a kind, with flash for the spells cast that way
  if (e.flashThisWay === true && e.who.ref === 'each' && e.who.who === 'player') {
    const cost = (cc.cost ?? {}) as Record<string, unknown>;
    if (cc.kind !== 'set' || Object.keys(cost).some((k) => cost[k] !== undefined) || cc.life !== undefined || cc.manaValue !== undefined || e.oncePerTurn !== undefined || e.firstSpellThisTurn !== undefined || e.of === undefined || e.of.castFrom !== undefined) {
      throw new NoRenderer('a flash rider for any player other than "without paying their mana costs and as though they had flash"');
    }
    return `any player may cast ${spellsPhrase(e.of, st)} without paying their mana costs and as though they had flash`;
  }
  if (e.flashThisWay === true) {
    const cost = (cc.cost ?? {}) as { other?: { kind?: string; amount?: unknown }[]; mana?: unknown };
    const part = cost.other?.length === 1 && cost.mana === undefined ? cost.other[0]! : undefined;
    if (e.who.ref !== 'you' || cc.kind !== 'set' || e.oncePerTurn !== undefined || e.firstSpellThisTurn !== undefined || e.of === undefined || e.of.castFrom !== undefined || part?.kind !== 'payEnergy' || typeof part.amount !== 'number' || part.amount < 1) {
      throw new NoRenderer('a flash rider on an alternative cost other than a payment of energy for the spells of a kind');
    }
    return `you may cast ${spellsPhrase(e.of, st)} by paying ${part.amount === 1 ? '{e}' : '{e}'.repeat(part.amount)} rather than paying their mana costs. if you cast a spell this way, you may cast it as though it had flash`;
  }
  // edh-d-44 (CR 118.9, 102.1; Aluren): any player may cast the spells of a kind without paying their mana costs (the flash half is the next effect, staticEffects)
  if (e.who.ref === 'each' && e.who.who === 'player') {
    const cost = (cc.cost ?? {}) as Record<string, unknown>;
    if (cc.kind !== 'set' || Object.keys(cost).some((k) => cost[k] !== undefined) || cc.life !== undefined || cc.manaValue !== undefined || e.oncePerTurn !== undefined || e.firstSpellThisTurn !== undefined || e.of === undefined || e.of.castFrom !== undefined) {
      throw new NoRenderer('a permission for any player to cast spells other than "without paying their mana costs"');
    }
    return `any player may cast ${spellsPhrase(e.of, st)} without paying their mana costs`;
  }
  // std-freecast-1 (CR 118.9, 601.2b, 102.1): "the first spell each player casts during each of their turns may be cast without paying its mana cost"
  if (e.firstSpellThisTurn === true) {
    const cost = (cc.cost ?? {}) as Record<string, unknown>;
    if (e.who.ref !== 'active' || cc.kind !== 'set' || Object.keys(cost).some((k) => cost[k] !== undefined) || e.oncePerTurn !== undefined || e.of !== undefined) {
      throw new NoRenderer('a first-spell alternative cost other than "the first spell each player casts during each of their turns" for nothing');
    }
    return `the first spell each player casts during each of their turns ${alt('may', 'can')} be cast without paying its mana cost`; // family may-can-be-cast-free
  }
  // edh-cast-11 (CR 118.9, 202.3): "once each turn, you may cast an enchantment spell by paying life equal to its mana value rather than paying its mana cost" (Demon of
  // Fate's Design): the alternative cost is the life payment of each spell (statics/play-permits.ts#grantedAlternatives); one spell each turn, no zone named
  if (cc.life !== undefined) {
    const rec = cc as unknown as Record<string, unknown>;
    if (e.who.ref !== 'you' || cc.life !== 'manaValue' || cc.kind !== 'set' || Object.keys(rec).some((k) => rec[k] !== undefined && k !== 'kind' && k !== 'life') || e.oncePerTurn !== true || e.of === undefined || (e.of.castFrom !== undefined && e.of.castFrom !== 'hand')) {
      throw new NoRenderer('a life alternative cost other than "once each turn, you may cast [a spell] by paying life equal to its mana value rather than paying its mana cost"');
    }
    // edh-next-67 (CR 601.2a, 118.9; Cramped Vents): "a spell from your hand"
    const { castFrom: lifeFrom, ...lifeOuter } = e.of;
    const lifeOf = lifeFrom === 'hand' && lifeOuter.anyOf?.length === 1 && Object.keys(lifeOuter).filter((k) => (lifeOuter as Record<string, unknown>)[k] !== undefined).length === 1 ? lifeOuter.anyOf[0]! : lifeOuter;
    return `once each turn, you may cast ${K.np({ ...lifeOf, zone: 'stack', stackKind: 'spell' }, st, { det: 'a' })}${lifeFrom === 'hand' ? ' from your hand' : ''} by paying life equal to its mana value rather than paying its mana cost`;
  }
  // edh-next-67 (CR 118.9, 202.3; Kentaro, the Smiling Cat): "You may pay {X} rather than pay the mana cost for Samurai spells you cast, where X is that spell's mana value."
  if (cc.manaValue === true) {
    const rec = cc as unknown as Record<string, unknown>;
    if (e.who.ref !== 'you' || cc.kind !== 'set' || Object.keys(rec).some((k) => rec[k] !== undefined && k !== 'kind' && k !== 'manaValue') || e.oncePerTurn !== undefined || e.of === undefined || e.of.castFrom !== undefined) {
      throw new NoRenderer('a mana-value alternative cost other than "you may pay {X} rather than pay the mana cost for [spells] you cast, where X is that spell\'s mana value"');
    }
    return `you may pay {x} rather than pay the mana cost for ${spellsPhrase(e.of, st)} you cast, where x is that spell's mana value`;
  }
  if (e.who.ref !== 'you' || cc.kind !== 'set' || cc.cost === undefined || cc.mana !== undefined || cc.generic !== undefined) throw new NoRenderer('an alternative-cost permission that is not "you may pay [cost] rather than ..."');
  const cost = cc.cost as Record<string, unknown>;
  // edh-cast-11 (CR 118.9, 601.2a, 401.5): "once each turn, you may cast a spell from your hand or the top of your library without paying its mana cost" (One with the
  // Multiverse): the spells cast from either zone, one use between them (a single permission with an `anyOf` of the two zones)
  if (e.oncePerTurn === true && Object.keys(cost).every((k) => cost[k] === undefined) && e.of?.anyOf?.length === 2 && Object.keys(e.of).filter((k) => (e.of as Record<string, unknown>)[k] !== undefined).length === 1) {
    const [a, b] = e.of.anyOf;
    const pure = (f: ObjectFilter | undefined): ObjectFilter | null => {
      if (f === undefined || f.anyOf?.length !== 1 || Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).length !== 2) return null;
      return f.anyOf[0]!;
    };
    const pa = pure(a), pb = pure(b);
    if (pa !== null && pb !== null && a!.castFrom === 'hand' && b!.castFrom === 'library' && JSON.stringify(pa) === JSON.stringify(pb)) {
      return `once each turn, you may cast ${K.np({ ...pa, zone: 'stack', stackKind: 'spell' }, st, { det: 'a' })} from your hand or the top of your library without paying its mana cost`;
    }
    throw new NoRenderer('spells cast from two zones other than "your hand or the top of your library"');
  }
  const costKeys = Object.keys(cost).filter((k) => cost[k] !== undefined);
  // r4-cost (CR 118.9, 701.59a): "you may collect evidence 10 rather than pay the mana cost for spells you cast": one keyword-action cost part, said as its verb
  const action = costKeys.length === 1 && costKeys[0] === 'other' && Array.isArray(cost['other']) && cost['other'].length === 1 && (cost['other'][0] as { kind?: string }).kind === 'action';
  // edh-next-67 (CR 118.9, 107.14; Nissa, Worldsoul Speaker): "You may pay eight {E} rather than pay the mana cost for permanent spells you cast": one payment of energy, as a number
  const energyPart = costKeys.length === 1 && costKeys[0] === 'other' && Array.isArray(cost['other']) && cost['other'].length === 1 && (cost['other'][0] as { kind?: string }).kind === 'payEnergy' ? (cost['other'][0] as { amount?: unknown }).amount : undefined;
  const energy = typeof energyPart === 'number' && energyPart >= 1 ? energyPart : null;
  if (costKeys.some((k) => k !== 'mana') && !action && energy === null) throw new NoRenderer('an alternative cost that is not mana');

  const of = (e.of ?? {}) as ObjectFilter;
  const { castFrom, ...outer } = of;
  // edh-c-47 (CR 118.9, 601.2b, 205.3m; Vision, Spectral Synthezoid): "a noncreature or Robot spell": two plain spell filters, the first a card type left out, the second a subtype
  const kinds = castFrom !== undefined && Object.keys(outer).length === 1 && outer.anyOf?.length === 2 ? outer.anyOf : undefined;
  const plainSpell = (f: ObjectFilter, key: 'notTypes' | 'subtypes'): string | null => {
    const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join(',');
    const v = f[key];
    return keys === [key, 'stackKind', 'zone'].sort().join(',') && f.stackKind === 'spell' && f.zone === 'stack' && v?.length === 1 ? v[0]! : null;
  };
  const noType = kinds === undefined ? null : plainSpell(kinds[0]!, 'notTypes');
  const subType = kinds === undefined ? null : plainSpell(kinds[1]!, 'subtypes');
  const pairSpells = noType !== null && subType !== null ? `a non${noType.toLowerCase()} or ${subType} spell` : null;
  const inner = pairSpells !== null ? {} as ObjectFilter : castFrom !== undefined && Object.keys(outer).length === 1 && outer.anyOf?.length === 1 ? outer.anyOf[0]! : castFrom !== undefined ? null : of;
  if (inner === null) throw new NoRenderer('spells cast from a zone with other qualities around them');
  const from = castFrom === undefined ? '' : castFrom === 'hand' ? ' from your hand' : castFrom === 'exile' ? ' from exile' : castFrom === 'graveyard' ? ' from your graveyard' : null;
  if (from === null) throw new NoRenderer(`spells cast from ${String(castFrom)}`);
  const once = e.oncePerTurn === true;
  // edh-cast-11 (CR 118.9, 202.3, 107.2; As Foretold): "once each turn, you may pay {0} rather than pay the mana cost for a spell you cast with mana value X or less, where X is
  // the number of time counters on ~": the spells whose mana value is at most a counted number, said with the X of Oracle's wording (family mv-x-or-less)
  const mv = inner.manaValue;
  if (once && from === '' && costKeys.length === 1 && costKeys[0] === 'mana' && mv !== undefined && mv.op === '<=' && typeof mv.value === 'object' && mv.value !== null
    && Object.keys(inner).filter((k) => (inner as Record<string, unknown>)[k] !== undefined).length === 1) {
    return `once each turn, you may pay ${formatManaCost(cost['mana'] as ManaCost)} rather than pay the mana cost for a spell you cast with mana value x or less, where x is ${K.qty(mv.value, cloneState(st))}`;
  }
  const spells = pairSpells !== null ? pairSpells : once ? K.np({ ...inner, zone: 'stack', stackKind: 'spell' }, st, { det: 'a' }) : spellsPhrase(inner, st);
  const lead = once ? 'once each turn, you may' : 'you may';
  if (costKeys.length === 0) {
    // r4-cost (CR 118.9, 601.2b): "once each turn, you may cast an instant spell from your hand without paying its mana cost" (one spell: "its")
    if (once) return `${lead} cast ${spells}${from} without paying its mana cost`;
    return `${lead} cast ${spells}${from} without paying their mana costs`;
  }
  if (action) return `${lead} ${K.costVerbs(cc.cost, st, 'you')} rather than pay the mana cost for ${spells} you cast${from}`;
  if (energy !== null) return `${lead} pay ${energy} {e} rather than pay the mana cost for ${spells} you cast${from}`;
  return `${lead} pay ${formatManaCost(cost['mana'] as ManaCost)} rather than pay the mana cost for ${spells} you cast${from}`;
}

function permit(e: Extract<StaticEffect, { s: 'permit' }>, st: RenderState, limited = false): string {
  // std-freecast-5 (CR 702.170a, 702.170f): plot from the top of your library (statics/play-permits.ts#isTopPlotPermit)
  if (e.action === 'plot') {
    const keys = Object.keys(e).filter((k) => (e as unknown as Record<string, unknown>)[k] !== undefined);
    if (e.fromTop !== true || e.who.ref !== 'you' || keys.some((k) => !['s', 'who', 'action', 'fromTop', 'of', 'plotCost'].includes(k)) || (e.of === undefined) === (e.plotCost === undefined)) {
      throw new NoRenderer('a plot permission other than from the top of your library');
    }
    if (e.plotCost === 'manaCost') return `the top card of your library has plot. ${alt('the', 'its')} plot cost is equal to its mana cost`; // family plot-cost-the-its
    return `you may plot ${K.np({ ...e.of!, zone: 'library' }, st, { det: 'none', plural: true, noZone: true })} from the top of your library`; // the cards as cards in a library
  }
  // std-ru (CR 118.9, 202.3; family pay-life-rather-than): "If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost" after the
  // permission for the cards an object's linked ability exiled (statics/play-permits.ts#linkedPermitLifeCost); no other permission has these words here
  if (e.costChange?.life !== undefined && e.of?.is !== undefined) {
    const cc = e.costChange as unknown as Record<string, unknown>;
    if (e.costChange.life !== 'manaValue' || e.costChange.kind !== 'set' || Object.keys(cc).some((k) => cc[k] !== undefined && k !== 'kind' && k !== 'life')
      || !(e.of?.is?.ref === 'linked' || (e.of?.is?.ref === 'bound' && e.single === true && e.action === 'play')) || Object.keys(e.of).length !== 1) throw new NoRenderer('a life cost on a permission other than for the cards exiled with ~ or one of a group');
    const { costChange: _cc, ...plain } = e;
    return `${permit(plain, st, limited)}. if you cast a spell this way, pay life equal to its mana value rather than ${alt('pay', 'paying')} its mana cost`;
  }
  // edh-next-56 (CR 607.2a, 601.3, 118.9; Court of Locthwain): "Until end of turn, you may cast a spell from among cards exiled with ~ without paying its mana cost": ONE card of the cards the
  // object's linked ability exiled, cast for free (`single`, free `costChange`; statics/play-permits.ts#namedSingleKey, isFreeCost). Said whole here: the free words follow ONE spell ("its")
  if (e.single === true && e.action === 'cast' && e.who.ref === 'you' && e.from === undefined && e.asThough === undefined && e.onlyTypes === undefined && isLinkedOnly(e.of)
    && e.costChange?.kind === 'set' && Object.keys(e.costChange.cost ?? {}).length === 0
    && Object.keys(e).filter((k) => (e as unknown as Record<string, unknown>)[k] !== undefined).every((k) => ['s', 'who', 'action', 'of', 'single', 'costChange'].includes(k))
    && Object.keys(e.costChange).filter((k) => (e.costChange as unknown as Record<string, unknown>)[k] !== undefined).every((k) => k === 'kind' || k === 'cost')) {
    return `you may cast a spell from among cards exiled with ${K.obj({ ref: 'self' }, st, 'object').text} without paying its mana cost`;
  }
  // edh-d-100 (CR 601.2f, 118.7; Urianger Augurelt): "you may play cards exiled with ~. Spells you cast this way cost {2} less to cast": the play permission for the cards an object's linked
  // ability exiled with a generic reduction of the spells cast with it (statics/play-permits.ts#namedPermitReduce); only that shape
  if (e.costChange?.kind === 'reduce' && e.action === 'play' && isLinkedOnly(e.of) && e.who.ref === 'you') {
    const cc = e.costChange as unknown as Record<string, unknown>;
    const sym = e.costChange.mana?.length === 1 ? e.costChange.mana[0] : undefined;
    if (sym?.kind !== 'generic' || !Object.keys(cc).every((k) => cc[k] === undefined || k === 'kind' || k === 'mana')
      || !Object.keys(e).filter((k) => (e as unknown as Record<string, unknown>)[k] !== undefined).every((k) => ['s', 'who', 'action', 'of', 'costChange'].includes(k))) throw new NoRenderer('a reduction on a linked play permission other than "spells you cast this way cost {N} less to cast"');
    const { costChange: _cc, ...bare } = e;
    return `${permit(bare, st, limited)}. spells you cast this way cost {${sym.amount}} less to cast`;
  }
  // std-rx3 (CR 118.9, 601.2b): a permission for named objects "without paying its mana cost" ("you may cast those cards without paying their mana costs"); the
  // number of the words follows the objects named (statics/play-permits.ts#isFreeCost)
  if ((e.action === 'cast' || e.action === 'play') && e.of?.is !== undefined && Object.keys(e.of).length === 1 && e.costChange !== undefined) {
    const cc = e.costChange as unknown as Record<string, unknown>;
    const cost = (e.costChange.cost ?? {}) as unknown as Record<string, unknown>;
    const free = e.costChange.kind === 'set' && e.costChange.cost !== undefined && Object.keys(cc).every((k) => cc[k] === undefined || k === 'kind' || k === 'cost') && Object.keys(cost).every((k) => cost[k] === undefined);
    if (!free) throw new NoRenderer(`permit ${e.action} for named objects with a cost other than none`);
    const { costChange: _cc, ...bare } = e;
    const plural = K.obj(e.of.is, cloneState(st), 'object').plural;
    // edh-d-90 (CR 601.3, 118.9; Fire Lord Ozai; family one-of-group-free): ONE card of the group (`single`) is played "without paying its mana cost"
    return `${permit(bare, st, limited)} without paying ${plural && e.single === true ? alt('their mana costs', 'its mana cost') : plural ? 'their mana costs' : 'its mana cost'}`;
  }
  // r3-cost: an alternative cost a static ability gives other spells (no `from`: it permits nothing else)
  if (e.action === 'cast' && e.costChange !== undefined && e.from === undefined && e.fromTop === undefined) return alternativePermit(e, st);
  // C10: from the graveyard (GY1's "you may play lands from your graveyard" included)
  if (e.from === 'graveyard' && (e.action === 'cast' || e.action === 'play') && e.fromTop === undefined && e.of?.is === undefined) return graveyardPermit(e, st);
  for (const k of ['of', 'from', 'asThough', 'count', 'costChange', 'grants', 'fromTop', 'oncePerTurn', 'anyManaType', 'anyManaColor', 'while', 'asAdventure', 'colorlessAnyColor' /* edh-d-97 */] as const) {
    if (e[k] !== undefined && !PERMIT_FIELDS[e.action].includes(k)) throw new NoRenderer(`permit ${e.action} with ${k}`);
  }
  // std-rx27 (CR 601.3, 305.1): "you may play a card exiled with ~": one card of the cards the object's linked ability exiled (statics/play-permits.ts#namedSingleKey)
  // edh-cast-10 (CR 601.3, 205.2a, 406.3; Chandra, Hope's Beacon, Locke, Treasure Hunter, Nashi, Moon Sage's Scion): "you may cast an instant or sorcery spell from among those exiled
  // cards" / "you may cast a spell from among those cards" / "you may play one of those cards": ONE card or spell among the group an earlier instruction named (`single`,
  // statics/play-permits.ts#namedSingleKey; `onlyTypes`, namedObjects)
  if (e.single === true && (e.action === 'cast' || e.action === 'play') && e.of?.is !== undefined && e.of.is.ref === 'bound' && Object.keys(e.of).length === 1 && e.who.ref === 'you'
    && (e.onlyTypes === undefined || (e.action === 'cast' && e.onlyTypes.length === 2 && e.onlyTypes.includes('Instant') && e.onlyTypes.includes('Sorcery')))
    && Object.keys(e).filter((k) => (e as unknown as Record<string, unknown>)[k] !== undefined).every((k) => ['s', 'who', 'action', 'of', 'single', 'onlyTypes'].includes(k))) {
    const info = st.info.get(`b:${e.of.is.name}`);
    const group = K.obj(e.of.is, st, 'object');
    if (!group.plural) throw new NoRenderer('a card from among one card');
    if (e.action === 'play') return `you may play one of ${group.text}`;
    const spell = e.onlyTypes === undefined ? 'a spell' : 'an instant or sorcery spell';
    return `you may cast ${spell} from among ${alt(group.text, ...(info?.zone === 'exile' ? ['those exiled cards'] : []))}`;
  }
  // edh-next-52 (CR 607.2a, 601.3, 205.2; Serpent's Soul-Jar): "Until end of turn, you may cast a creature spell from among cards exiled with ~": ONE card of the cards the
  // object's linked ability exiled, cast as a spell of one card type (`single`, `onlyTypes`; statics/play-permits.ts#namedSingleKey, namedObjects)
  if (e.single === true && e.action === 'cast' && e.who.ref === 'you' && e.from === undefined && e.asThough === undefined && isLinkedOnly(e.of)
    && e.onlyTypes?.length === 1 && ['Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Instant', 'Sorcery'].includes(e.onlyTypes[0]!)
    && Object.keys(e).filter((k) => (e as unknown as Record<string, unknown>)[k] !== undefined).every((k) => ['s', 'who', 'action', 'of', 'single', 'onlyTypes'].includes(k))) {
    const type = e.onlyTypes[0]!.toLowerCase();
    return `you may cast ${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type} spell from among cards exiled with ${K.obj({ ref: 'self' }, st, 'object').text}`;
  }
  // edh-d-96 (CR 601.3, 305.1; March of Reckless Joy): "you may play up to two of those cards": up to that many cards among the group an earlier instruction named (`uses`,
  // statics/play-permits.ts#spentLimit); no other shape has words
  if (e.uses !== undefined) {
    if (e.single !== undefined || e.action !== 'play' || e.of?.is?.ref !== 'bound' || Object.keys(e.of).length !== 1 || e.who.ref !== 'you' || !Number.isInteger(e.uses) || e.uses < 2
      || Object.keys(e).filter((k) => (e as unknown as Record<string, unknown>)[k] !== undefined).some((k) => !['s', 'who', 'action', 'of', 'uses'].includes(k))) throw new NoRenderer('a permission for up to N cards other than "you may play up to two of those cards"');
    const group = K.obj(e.of.is, st, 'object');
    if (!group.plural) throw new NoRenderer('up to N cards from among one card');
    return `you may play up to ${numWord(e.uses)} of ${group.text}`;
  }
  if (e.single !== undefined) {
    const { single: _single, ...bare } = e;
    if (e.single !== true || e.action !== 'play' || !isLinkedOnly(e.of) || JSON.stringify(e.who) !== '{"ref":"you"}' || Object.keys(bare).some((k) => !['s', 'who', 'action', 'of'].includes(k))) {
      throw new NoRenderer('a one-card permission other than "you may play a card exiled with ~"');
    }
    return `you may play a card exiled with ${K.obj({ ref: 'self' }, st, 'object').text}`;
  }
  // FAST5X E29: the rider and the condition are said by `permitRiders` (staticEffect), around the duration; r5-repl: the graveyard rider too
  if (e.anyManaType !== undefined || e.anyManaColor !== undefined || e.colorlessAnyColor !== undefined || e.while !== undefined || e.graveyardInstead !== undefined) throw new NoRenderer('a permission with its rider, outside staticEffect');
  // FAST5X E14 (CR 401.5, 601.3): "from the top of your library"
  if (e.fromTop === true) {
    if (e.laterTurn !== undefined) throw new NoRenderer('a top-card permission after the current turn');
    const top = topPermit(e, st);
    if (top === null) throw new NoRenderer(`permit ${e.action} from the top with other fields`);
    return top;
  }
  if (e.oncePerTurn !== undefined) throw new NoRenderer('once each turn without the top of a library');
  // FAST5 T56 (CR 601.3b, 601.2f): "You may cast ~ as though it had flash if you pay {2} more to cast it." The spell itself, an extra generic cost and nothing else
  if (e.action === 'haveFlash' && e.costChange !== undefined) {
    const price = e.costChange;
    const onlySelf = e.of !== undefined && Object.keys(e.of).length === 1 && e.of.self === true;
    if (!onlySelf || e.asThough !== undefined || e.who.ref !== 'you' || price.kind !== 'increase' || price.mana === undefined || Object.keys(price).length !== 2) throw new NoRenderer('a flash permission with a price other than "pay {N} more" for the spell itself');
    return `you may cast ${K.obj({ ref: 'self' }, st, 'object').text} as though it had flash if you pay ${formatManaCost(price.mana)} more to cast it`;
  }
  // std-rx10 (CR 601.3b, 601.2b, 118.8): "You may cast ~ as though it had flash if you behold a Dragon as an additional cost to cast it." The spell itself and an
  // additional cost (statics/hooks.ts#castFlashAddCosts)
  if (e.action === 'haveFlash' && e.addCost !== undefined) {
    const onlySelf = e.of !== undefined && Object.keys(e.of).length === 1 && e.of.self === true;
    if (!onlySelf || e.asThough !== undefined || e.who.ref !== 'you') throw new NoRenderer('a flash permission with an additional cost other than for the spell itself');
    // edh-d-44 (CR 601.3b, 118.8; Tegwyll's Scouring): tapping untapped creatures is said "by tapping ... in addition to paying its other costs"
    const taps = e.addCost.mana === undefined && e.addCost.other !== undefined && e.addCost.other.length === 1 && e.addCost.other[0]!.kind === 'tapUntapped' && e.addCost.other[0]!.other !== true;
    if (taps) return `you may cast ${K.obj({ ref: 'self' }, st, 'object').text} as though it had flash by ${K.costVerbs(e.addCost, st, 'you').replace(/^tap /, 'tapping ')} in addition to paying its other costs`;
    return `you may cast ${K.obj({ ref: 'self' }, st, 'object').text} as though it had flash if you ${K.costVerbs(e.addCost, st, 'you')} as an additional cost to cast it`;
  }
  // edht4 (CR 601.3b, 601.2c; Timely Ward): "You may cast ~ as though it had flash if it targets a commander." The spell itself and the objects its targets must include one of
  if (e.action === 'haveFlash' && e.ifTargets !== undefined) {
    const onlySelf = e.of !== undefined && Object.keys(e.of).length === 1 && e.of.self === true;
    if (!onlySelf || e.asThough !== undefined || e.who.ref !== 'you' || e.costChange !== undefined || e.addCost !== undefined || e.offTimingSacrifice !== undefined) throw new NoRenderer('a flash permission with a target condition other than for the spell itself');
    return `you may cast ${K.obj({ ref: 'self' }, st, 'object').text} as though it had flash if it targets ${K.np(e.ifTargets, st, { det: 'a' })}`;
  }
  // edh-d-44 (CR 601.3b, 601.2b, 107.3a; Silver Scrutiny): "You may cast this spell as though it had flash if X is 3 or less." The spell itself and a limit on X
  if (e.action === 'haveFlash' && e.ifXAtMost !== undefined) {
    const onlySelf = e.of !== undefined && Object.keys(e.of).length === 1 && e.of.self === true;
    if (!onlySelf || e.asThough !== undefined || e.who.ref !== 'you' || e.costChange !== undefined || e.addCost !== undefined || e.offTimingSacrifice !== undefined || e.ifTargets !== undefined) throw new NoRenderer('a flash permission with a limit on X other than for the spell itself');
    return `you may cast ${K.obj({ ref: 'self' }, st, 'object').text} as though it had flash if x is ${e.ifXAtMost} or less`;
  }
  // edh-perms-4 (CR 601.3b, 603.7, 701.21a; Necromancy): the card's own flash permission with the sacrifice of the permanent it becomes when cast off sorcery timing
  if (e.action === 'haveFlash' && e.offTimingSacrifice === true) {
    const onlySelf = e.of !== undefined && Object.keys(e.of).length === 1 && e.of.self === true;
    if (!onlySelf || e.asThough !== undefined || e.who.ref !== 'you' || e.costChange !== undefined || e.addCost !== undefined) throw new NoRenderer('an off-timing flash permission other than for the spell itself');
    return `you may cast ${K.obj({ ref: 'self' }, st, 'object').text} as though it had flash. if you cast it ${alt('any time', 'at any time')} a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step`;
  }
  const who = K.player(e.who, st, 'subject');
  const may = who.person === 'you' ? 'may' : 'may';
  // std-exile-play-1-1 (CR 608.2c; family they-may-play): one player named before is also "they" as the subject of the permission ("They may play that card ...")
  // when the pronoun names them uniquely (refs.ts#anaphor, `they`)
  // edh-cast-4 (CR 601.3b, 702.8a; family any-player-may): "Any player may cast Sliver spells as though they had flash" is the permission of each player
  const subj = who.they === true ? alt(who.text, 'they') : e.action === 'haveFlash' && e.who.ref === 'each' && who.text === 'each player' ? alt(who.text, 'any player') : who.text;
  // FAST3 T15: a filter that already says "spell" (the parser's "creature spells", "Aura spells and creature spells") is written as the spells it is, the
  // way cost modifiers write theirs (CR 601.3b); before, its head was said twice ("creature creature spells"), so no card read that way
  const of = e.of && e.action === 'haveFlash' && isSpellFilter(e.of) ? spellsPhrase(e.of, st)
    : e.of ? K.np(e.of, st, { det: 'none', plural: true, head: e.action === 'cast' || e.action === 'haveFlash' ? 'spell' : undefined }) : 'spells';
  const from = e.from ? ` from ${e.from === 'graveyard' || e.from === 'hand' || e.from === 'library' ? `${who.person === 'you' ? 'your' : 'their'} ${e.from}` : e.from}` : '';
  // FAST4 T31 (CR 611.2c): the permission a resolving effect gives for the very objects it names ("you may play that card this turn", statics/play-permits.ts);
  // FAST5X E29: "you may cast that card until the end of your next turn" too; FAST5X batch 1 integration: not a target, which the permission itself announces
  // and describes (FAST5 T63, "you may cast target Elf creature card from your graveyard this turn", CR 115.1, 601.3)
  // r5-refs (CR 607.2a, 601.3, 305.1; family play-cards-exiled-with): the cards the object's linked ability exiled, "cards exiled with ~"; to play a card is to play it as a
  // land or cast it, so "play lands and cast spells from among cards exiled with ~" is the same permission
  // edh-c-114 (CR 607.2a, 108.3, 601.3; Kayla's Music Box): "you may play cards you own exiled with ~": the linked cards the player owns (the owner is you), as family play-cards-exiled-with
  if (e.action === 'play' && e.ownOnly === true && e.single === undefined && e.of !== undefined && Object.keys(e.of).length === 1 && e.of.is?.ref === 'linked' && e.of.is.link === 'exiled' && e.from === undefined && e.asThough === undefined && who.person === 'you')
    return `${subj} ${may} play cards you own exiled with ${K.obj({ ref: 'self' }, st, 'object').text}`;
  if ((e.action === 'play' || e.action === 'cast') && e.of !== undefined && Object.keys(e.of).length === 1 && e.of.is?.ref === 'linked' && e.from === undefined && e.asThough === undefined) {
    const self = K.obj({ ref: 'self' }, st, 'object').text;
    // std-rs (CR 607.2a; family cast-the-exiled-card): the cards another ability of the object exiled are also "the exiled card" (the parser's reading of those words)
    const cast = e.of.is.link === 'exiled' ? alt(`cast spells from among cards exiled with ${self}`, 'cast the exiled card') : `cast spells from among cards exiled with ${self}`;
    return e.action === 'play' ? `${subj} ${may} ${alt(`play cards exiled with ${self}`, `play lands and cast spells from among cards exiled with ${self}`)}` : `${subj} ${may} ${cast}`;
  }
  const named = (e.action === 'play' || e.action === 'cast') && e.of !== undefined && Object.keys(e.of).length === 1 && e.of.is !== undefined && (e.action === 'play' || e.of.is.ref !== 'target')
    ? K.obj(e.of.is, st, 'object').text : null;
  // r5-moved (CR 608.2c, 400.7, 611.2a): the cards a move of this ability exiled are also "cards exiled this way" ("Until the end of your next turn, you may play cards exiled
  // this way", Hex Magic; render/steps-zones.ts marks the binding, the parser's group anaphor parser/holes/object.ts#group)
  const exiledWay = named !== null && e.of?.is?.ref === 'bound' && st.info.get(`b:${e.of.is.name}`)?.thisWay === 'exiled this way' && st.info.get(`b:${e.of.is.name}`)?.plural === true;
  const thing = named !== null && exiledWay ? alt(named, 'cards exiled this way') : named;
  switch (e.action) {
    case 'cast': {
      // r5-dig (CR 715.3, 715.3a): "you may cast it from your graveyard as an Adventure" (Mosswood Dreadknight): the card the ability named, in your graveyard (the
      // template reads only these words; the permission names that card where it is)
      if (e.asAdventure === true) {
        if (named === null || from !== '' || e.asThough !== undefined || who.person !== 'you') throw new NoRenderer('"as an Adventure" on a permission other than for a named card of yours');
        return `${subj} ${may} cast ${named} from your graveyard as an Adventure`;
      }
      // std-rh (CR 601.3, 305.1; Laughing Jasper Flint): "you may cast spells from among those cards" is the permission to cast the group's cards that are spells
      // pc-exile-play-1 (CR 406.1, 608.2c; Dream Pillager, Stolen Strategy): the group is also "those exiled cards" when an instruction of the ability exiled it
      const amongGroup = thing !== null && e.of?.is?.ref === 'bound' && st.info.get(`b:${e.of.is.name}`)?.plural === true
        ? alt(thing, `spells from among ${named}`, ...(st.info.get(`b:${e.of.is.name}`)?.zone === 'exile' ? ['spells from among those exiled cards'] : [])) : thing;
      // edh-zones-11 (CR 601.3, 305.1, 406.3; Vivien, Champion of the Wilds): the permission for the card an earlier instruction named, only while it is a creature card
      // ("For as long as it remains exiled, you may cast it if it's a creature spell"): a creature card cast is a creature spell
      // edh-d-56 (CR 601.3, 305.1; Narset, Enlightened Master; family cast-noncreature-spells-from-among-group): the group's cards that are no creature spells
      if (e.exceptTypes !== undefined) {
        if (e.exceptTypes.length !== 1 || e.exceptTypes[0] !== 'Creature' || e.onlyTypes !== undefined || e.of?.is === undefined || e.of.is.ref !== 'bound' || Object.keys(e.of).length !== 1 || from !== '' || e.asThough !== undefined
          || who.person !== 'you') throw new NoRenderer('a card-type exclusion on a permission other than "noncreature spells from among" the cards an earlier instruction named');
        return `${subj} ${may} cast noncreature spells from among ${K.obj(e.of.is, st, 'object').text}`;
      }
      if (e.onlyTypes !== undefined) {
        // edh-d-55 (CR 601.3, 304.1, 307.1; Nivix, Aerie of the Firemind): the limit may be "instant or sorcery" (a card of either type is cast as that kind of spell)
        const instSorc = e.onlyTypes.length === 2 && e.onlyTypes.includes('Instant') && e.onlyTypes.includes('Sorcery');
        if (!(instSorc || (e.onlyTypes.length === 1 && e.onlyTypes[0] === 'Creature')) || e.of?.is === undefined || e.of.is.ref === 'target' || Object.keys(e.of).length !== 1 || from !== '' || e.asThough !== undefined
          || who.person !== 'you') throw new NoRenderer('a card-type limit on a permission other than "you may cast it if it\'s a creature (or instant or sorcery) spell" for a card an earlier instruction named');
        const ifIts = `${subj} ${may} cast ${K.obj(e.of.is, cloneState(st), 'object').text} if it's ${instSorc ? 'an instant or sorcery' : 'a creature'} spell`;
        // edh-next-121 (CR 601.3, 304.1, 307.1; Ral, Leyline Prodigy; family cast-typed-spells-from-among-group): the instant and sorcery cards of a GROUP an instruction named, "you may cast
        // instant and sorcery spells from among them" (the same cards: only a card of those types is cast this way, statics/play-permits.ts#namedObjects)
        const group = instSorc && e.single === undefined && e.of.is.ref === 'bound' && st.info.get(`b:${e.of.is.name}`)?.plural === true;
        return group ? alt(`${subj} ${may} cast instant and sorcery spells from among ${K.obj(e.of.is, st, 'object').text}`, ifIts) : `${subj} ${may} cast ${K.obj(e.of.is, st, 'object').text} if it's ${instSorc ? 'an instant or sorcery' : 'a creature'} spell`;
      }
      // edh-next-100 (CR 601.3, 105.2; Chandra, Dressed to Kill): "you may cast red spells from among them this turn": the spells of one color among the cards of a group an instruction put somewhere
      if (named !== null && e.onlyColors?.length === 1 && e.of?.is?.ref === 'bound' && st.info.get(`b:${e.of.is.name}`)?.plural === true && from === '' && e.asThough === undefined) {
        return `${subj} ${may} cast ${COLOR_WORD[e.onlyColors[0]!] ?? e.onlyColors[0]} spells from among ${named}`;
      }
      return `${subj} ${may} cast ${amongGroup ?? of}${from}${e.asThough ? ` as though ${e.asThough}` : ''}`;
    }
    case 'play': {
      // edh-d-87 (CR 305.1, 601.3; The Omenkeel): the land cards of a GROUP an earlier instruction named, "you may play lands from among those cards" (only a card with a land face is named,
      // and it is played as that face: statics/play-permits.ts#namedObjects, actions/cast.ts#namedPermitTypesAllow)
      if (e.onlyTypes !== undefined) {
        const gb = e.of?.is?.ref === 'bound' ? e.of.is.name : undefined;
        if (e.onlyTypes.length !== 1 || e.onlyTypes[0] !== 'Land' || gb === undefined || st.info.get(`b:${gb}`)?.plural !== true || Object.keys(e.of!).length !== 1 || from !== '' || e.asThough !== undefined
          || who.person !== 'you') throw new NoRenderer('a card-type limit on a play permission other than "you may play lands from among" a group an earlier instruction named');
        return `${subj} ${may} play lands from among ${K.obj(e.of!.is!, st, 'object').text}`;
      }
      // edh-top-8 (CR 305.1, 601.3; family play-lands-cast-spells-among; Elder Brain, Gix): the permission for a group of cards an earlier instruction named is also "you may play
      // lands and cast spells from among them": to play a card is to play it as a land or to cast it
      const bound = e.of?.is?.ref === 'bound' ? e.of.is.name : undefined;
      const group = thing !== null && e.from === undefined && bound !== undefined && st.info.get(`b:${bound}`)?.plural === true;
      const body = group ? alt(`play ${thing}`, `play lands and cast spells from among ${st.info.get(`b:${bound}`)?.thisWay === 'exiled this way' ? alt(thing!, 'the exiled cards') : thing}`) : `play ${thing ?? (e.of ? K.np(e.of, st, { det: 'none', plural: true }) : 'cards')}`;
      const text = `${subj} ${may} ${body}${from}`;
      // r4-dig (CR 611.2c, 400.7): the permission for the card an earlier instruction of the ability exiled is also "you may play that card from exile": that card
      // is a card in exile (a new object once it leaves, CR 400.7), so the zone adds nothing to what the permission names
      const isRef = e.of?.is;
      const exiled = named !== null && e.from === undefined && isRef?.ref === 'bound' && st.info.get(`b:${isRef.name}`)?.zone === 'exile';
      return exiled ? alt(text, `${text} from exile`) : text;
    }
    case 'playLand': {
      // std-rx19 (CR 305.2, 101.4): every player of "each player" is also "players" (family each-player-or-players)
      const who0 = e.who.ref === 'each' && 'who' in e.who && e.who.who === 'player' ? alt(subj, 'players') : subj;
      const n = e.count === undefined || e.count === 1 ? null : typeof e.count === 'number' ? numWord(e.count) : K.qty(e.count, st);
      const poss = who.person === 'you' ? 'your' : 'their';
      // edh-next-11 (CR 305.2; Storm Cauldron): "during each of their turns" says the same as "on each of their turns" (family on-during-each-turn)
      const text = `${who0} ${may} play ${n === null ? 'an additional land' : `${n} additional lands`}${limited ? '' : alt(` on each of ${poss} turns`, ` during each of ${poss} turns`)}`;
      // std-rx23 (CR 305.2a): "You may play up to three additional lands this turn" is the same permission of three more land plays (a permission is never an
      // obligation, so "up to" adds nothing); only for a permission limited in time
      return n !== null && limited ? alt(text, `${who0} ${may} play up to ${n} additional lands`) : text;
    }
    // r4-fxz (CR 302.6, 602.5a, 609.4): "You may activate abilities of creatures you control as though those creatures had haste"
    case 'activate': return `${subj} ${may} activate abilities${e.of ? ` of ${K.np(e.of, st, { det: 'none', plural: true })}` : ''}${e.asThough ? ` as though ${e.asThough}` : ''}`;
    case 'spendMana': {
      // edhc5 (CR 118.1, 119.4): "For each {B} in a cost, you may pay 2 life rather than pay that mana" (K'rrik); and for the spells `of` describes, one symbol of a
      // spell: "As an additional cost to cast green permanent spells, you may pay 2 life. Those spells cost {G} less to cast if you paid life this way. This effect
      // reduces only the amount of green mana you pay." (Defiler of Vigor; rules/life-for.ts)
      if (e.lifeFor !== undefined) {
        if (e.who.ref !== 'you' || e.asThough !== undefined || e.abilities !== undefined) throw new NoRenderer('a pay-life-for-mana permission other than "you may pay 2 life ..."');
        const sym = `{${e.lifeFor.color}}`;
        if (e.of === undefined) {
          if (e.lifeFor.once === true) throw new NoRenderer('a one-symbol life payment for every cost');
          return `for each ${sym} in a cost, you may pay 2 life rather than pay that mana`;
        }
        if (e.lifeFor.once !== true) throw new NoRenderer('a life payment for each symbol of some spells');
        const spells = isSpellFilter(e.of) ? spellsPhrase(e.of, st) : K.np(e.of, st, { det: 'none', plural: true, head: 'spell' });
        return `as an additional cost to cast ${spells}, you may pay 2 life. those spells cost ${sym} less to cast if you paid life this way. this effect reduces only the amount of ${COLOR_WORD[e.lifeFor.color]} mana you pay`;
      }
      // std-rx32 (CR 609.4b): "You may spend mana as though it were mana of any color to activate abilities of creatures you control"
      if (e.abilities === true) {
        if (e.asThough !== 'any color' || e.of === undefined || e.who.ref !== 'you') throw new NoRenderer('an ability spend-mana permission other than "you may ... of any color to activate abilities of ..."');
        // edh-next-11 (CR 602.2b; Manascape Refractor; family spend-any-color-activation-costs): the object's own abilities, "to pay the activation costs of this artifact's abilities"
        // edh-next-140 (CR 609.4b; Quicksilver Elemental): only mana of one type, "You may spend blue mana as though it were mana of any color to pay the activation costs of ~'s abilities"
        if (e.spentType !== undefined) {
          if (JSON.stringify(e.of) !== '{"self":true}') throw new NoRenderer('a spend-one-type-as-any-color permission for abilities of other objects');
          const mana = `${COLOR_WORD[e.spentType]} mana`;
          return alt(`you may spend ${mana} as though it were mana of any color to pay the activation costs of ${K.obj({ ref: 'self' }, st, 'subject').text}'s abilities`, `you may spend ${mana} as though it were mana of any color to activate abilities of it`);
        }
        if (JSON.stringify(e.of) === '{"self":true}') return alt('you may spend mana as though it were mana of any color to activate abilities of it', `you may spend mana as though it were mana of any color to pay the activation costs of ${K.obj({ ref: 'self' }, st, 'subject').text}'s abilities`);
        return `you may spend mana as though it were mana of any color to activate abilities of ${K.np(e.of, st, { det: 'none', plural: true })}`;
      }
      // CLOUD std-fdn (CR 609.4b): "You can spend mana of any type to cast creature spells" (Vizier of the Menagerie): only for the spells `of` describes
      if (e.of !== undefined) {
        if ((e.asThough !== 'any type' && e.asThough !== 'any color') || e.who.ref !== 'you') throw new NoRenderer('a spend-mana permission for some spells other than "you can spend mana of any type" or "you may spend mana as though it were mana of any color"');
        const spells = isSpellFilter(e.of) ? spellsPhrase(e.of, st) : K.np(e.of, st, { det: 'none', plural: true, head: 'spell' });
        // Standard round I (CR 609.4b): Oracle prints the colour wording as "You may spend mana as though it were mana of any color to cast ..."
        return e.asThough === 'any color' ? `you may spend mana as though it were mana of any color to cast ${spells}` : `you can spend mana of any type to cast ${spells}`;
      }
      // edh-mana-keywords-10 (CR 609.4b; Mycosynth Lattice): the permission of every player is "Players may spend mana as though ..." as well as "Each player may ..."
      const plain = `${subj} ${may} spend mana as though it were mana of ${e.asThough ?? 'any type'}`;
      return e.who.ref === 'each' && e.who.who === 'player' && e.asThough === 'any color' ? alt(plain, `players ${may} spend mana as though it were mana of any color`, `all players ${may} spend mana as though it were mana of any color`) : plain;
    }
    // CLOUD std-ecl (CR 601.3b, 702.8a): the object itself is one spell, "as though it had flash"
    case 'haveFlash': {
      // edh-d-44 (CR 601.3b, 601.2i; The Blue Spirit): "You may cast the first creature spell you cast each turn as though it had flash"
      if (e.firstOfKind === true) {
        if (e.of === undefined || e.asThough !== undefined || e.who.ref !== 'you' || !isSpellFilter(e.of) || e.costChange !== undefined || e.addCost !== undefined || e.ifTargets !== undefined || e.ifXAtMost !== undefined) throw new NoRenderer('a first-spell flash permission other than for the spells you cast');
        return `you may cast the first ${K.np(e.of, st, { det: 'none', plural: false })} you cast each turn as though it had flash`;
      }
      const plain = `${subj} ${may} cast ${of} as though ${e.asThough ?? (e.of !== undefined && Object.keys(e.of).length === 1 && e.of.self === true ? 'it had flash' : 'they had flash')}`;
      // edh-cast-6 (CR 601.3b, 702.8a; family cards-you-own-have-flash; Teferi, Mage of Zhalfir): the permission of each player to cast the spells of one card type that you own is
      // also "Creature cards you own that aren't on the battlefield have flash": a card that is not on the battlefield can only be cast, so it is the same permission
      const types = e.of?.types;
      const own = e.who.ref === 'each' && e.who.who === 'player' && e.asThough === undefined && e.of?.owner === 'you' && e.of.stackKind === 'spell' && e.of.zone === 'stack'
        && Object.keys(e.of).length === 4 && types !== undefined && types.length === 1 ? `${String(types[0]).toLowerCase()} cards you own that aren't on the battlefield have flash` : null;
      return own === null ? plain : alt(plain, own);
    }
    // edh-b-14 (CR 302.6, 508.1a, 609.4; Frenzied Saddlebrute): the creatures of every player, attacking your opponents and the planeswalkers they control, the only wording there is
    case 'attackAsThoughHaste':
      if (e.opponentsOnly !== true && e.of !== undefined && Object.keys(e.of).length === 1 && e.of.attachedToSource === true && e.who.ref === 'controllerOf' && JSON.stringify(e.who.object) === '{"ref":"attachedTo"}') {
        return `${K.obj({ ref: 'attachedTo' }, st, 'subject').text} can attack as though it had haste`;
      }
      // edh-d-25 (CR 302.6, 508.1a, 609.4, 303.4; Instill Energy): the enchanted or equipped creature, whose controller attacks with it: "enchanted creature can attack as though it had haste"
      if (e.opponentsOnly === undefined && e.of !== undefined && Object.keys(e.of).length === 1 && e.of.attachedToSource === true && e.who.ref === 'controllerOf' && JSON.stringify(e.who.object) === '{"ref":"attachedTo"}') {
        return `${K.obj({ ref: 'attachedTo' }, st, 'subject').text} can attack as though it had haste`;
      }
      if (e.opponentsOnly !== true || e.who.ref !== 'each' || e.who.who !== 'player' || e.of === undefined || Object.keys(e.of).length !== 1 || JSON.stringify(e.of.types) !== '["Creature"]') throw new NoRenderer('an attack-with-haste permission other than "all creatures can attack your opponents and planeswalkers your opponents control as though those creatures had haste"');
      return 'all creatures can attack your opponents and planeswalkers your opponents control as though those creatures had haste';
    case 'attackAsThoughNoDefender':
      // edh-combat-6 (CR 609.4, 508.1b; Weathered Sentinels): the permission for the players who attacked its controller during their last turn, the object itself, nothing else
      if (e.attackedYouLastTurn === true) {
        if (e.of !== undefined || e.who.ref !== 'you' || e.asThough !== undefined) throw new NoRenderer('a last-turn attacker permission with more than the object itself');
        return `${K.obj({ ref: 'self' }, st, 'subject').text} can attack ${alt('players', 'opponents')} who attacked you during their last turn as though it didn't have defender`; // family players-who-attacked-you
      }
      // r3-static (CR 609.4, 702.3b): "Creatures you control can attack as though they didn't have defender" (Ghalta): the objects `of` matches, which the
      // permission gives only to `who` (statics/hooks.ts#permitsObject), so the filter must say "you control" itself
      if (e.of !== undefined) {
        // edh-players-4 (CR 609.4, 702.3b; Assault Formation): one object an effect names ("Target creature with defender can attack this turn as though it didn't have defender"),
        // the permission written `of: { is: <the object> }` (as std-rx32's pump-and-grant says it)
        const only = Object.keys(e.of).length === 1 && e.of.is !== undefined && (e.of.is.ref === 'target' || e.of.is.ref === 'bound') ? e.of.is : null;
        if (only !== null && (e.who.ref === 'you' || JSON.stringify(e.who) === '{"ref":"each","who":"player"}')) {
          const one = K.obj(only as ObjRef, st, 'subject');
          if (one.plural) throw new NoRenderer('a defender permission for several named objects');
          return `${one.text} can attack as though it didn't have defender`;
        }
        // edh-c-8 (CR 609.4, 301.5, 303.4; Warmonger's Chariot): the enchanted or equipped creature, whose controller attacks with it: "equipped creature can attack ..." or, after a condition that names it, "it can attack ..."
        if (Object.keys(e.of).length === 1 && e.of.attachedToSource === true && e.who.ref === 'controllerOf' && JSON.stringify(e.who.object) === '{"ref":"attachedTo"}') {
          return `${alt(K.obj({ ref: 'attachedTo' }, st, 'subject').text, 'it', 'enchanted wall' /* edh-c-57: family enchanted-wall */)} can attack as though it didn't have defender`;
        }
        // edh-next-17 (CR 609.4, 702.3b; Rolling Stones): "Wall creatures can attack as though they didn't have defender": every player's, the filter names no controller or owner
        if (JSON.stringify(e.who) === '{"ref":"each","who":"player"}' && e.of.controller === undefined && e.of.owner === undefined && e.asThough === undefined && e.attackedYouLastTurn === undefined) {
          return `${K.np(e.of, st, { det: 'none', plural: true })} can attack as though they didn't have defender`;
        }
        if (e.who.ref !== 'you' || e.of.controller !== 'you') throw new NoRenderer('a group defender permission for objects other than ones you control');
        return `${K.np(e.of, st, { det: 'none', plural: true })} can attack as though they didn't have defender`;
      }
      return `${K.obj({ ref: 'self' }, st, 'subject').text} can attack as though it didn't have defender`;
    // FAST5 T37 (CR 510.1b-c): the object itself, whose controller is who
    case 'assignAsUnblocked': {
      // edh-c-47 (CR 510.1b, 510.1c; Wolverine, Claws Out): a character card's own pronouns, "assign his combat damage as though he weren't blocked"
      if (e.of === undefined) return `${subj} ${may} have ${K.obj({ ref: 'self' }, st, 'subject').text} assign ${alt("its combat damage as though it", "his combat damage as though he", "her combat damage as though she", `${K.obj({ ref: 'self' }, st, 'subject').text}'s combat damage as though ${K.obj({ ref: 'self' }, st, 'subject').text}`)} weren't blocked`;
      // edh-d-25 (CR 510.1b-c, 609.4, 611.2a; Outmaneuver): a resolved effect's permission with no choice, "X target blocked creatures assign their combat damage as though they weren't blocked"
      // (`mandatory`: the objects an effect names, of every player, the duration said by the effect)
      if (e.mandatory === true) {
        if (!limited || e.of === undefined || Object.keys(e.of).length !== 1 || (e.of.is?.ref !== 'target' && e.of.is?.ref !== 'bound') || JSON.stringify(e.who) !== '{"ref":"each","who":"player"}') throw new NoRenderer('a mandatory unblocked-damage permission other than for the objects an effect names');
        // (`of` above already named the target in full; a target group is plural)
        if (e.of.is.ref === 'target' ? st.info.get(`t:${e.of.is.id}`)?.plural !== true : false) throw new NoRenderer('a mandatory unblocked-damage permission for one named object');
        return `${of} assign their combat damage as though they weren't blocked`;
      }
      // edh-combat-3 (CR 510.1b-c, 609.4): the objects `of` matches whose controller is `who`. "For each non-Human creature you control, you may have that creature assign
      // its combat damage as though it weren't blocked" (who: you; the filter says "you control" itself) and "Enchanted creature's controller may have it assign ..."
      // (who: the controller of the attached-to object, `of` the attached creature)
      if (e.who.ref === 'you') {
        if (e.of.controller !== 'you' || e.of.attachedToSource === true) throw new NoRenderer('an unblocked-damage permission for objects other than ones you control');
        return `for each ${K.np(e.of, st, { det: 'none', plural: false })}, you may have that creature assign its combat damage as though it weren't blocked`;
      }
      if (e.who.ref === 'controllerOf' && JSON.stringify(e.who.object) === '{"ref":"attachedTo"}' && e.of.attachedToSource === true && e.of.controller === undefined) {
        return `${K.np(e.of, st, { det: 'none', plural: false })}'s controller may have it assign its combat damage as though it weren't blocked`;
      }
      throw new NoRenderer('an unblocked-damage permission for objects of another player');
    }
    // r4-mech (CR 606.3): "you may activate loyalty abilities of Jace planeswalkers you control on any player's turn any time you could cast an instant"
    case 'activateLoyaltyAsInstant': {
      const whose = e.of === undefined ? K.obj({ ref: 'self' }, st, 'possessive').text : `of ${K.np(e.of, st, { det: 'none', plural: true })}`;
      // edh-cast-9 (CR 606.3; Teferi, Master of Time; family loyalty-abilities-of-self): Oracle also says "loyalty abilities of <the permanent>" for the permanent itself
      // edh-next-137 (CR 606.3, 307.1; The Wandering Emperor; family loyalty-instant-any-turn): "any time you could cast an instant" is on any player's turn already
      return e.of === undefined ? alt(`${subj} ${may} activate ${whose} loyalty abilities on any player's turn any time you could cast an instant`, `${subj} ${may} activate loyalty abilities of ${K.obj({ ref: 'self' }, st, 'object').text} on any player's turn any time you could cast an instant`,
        `${subj} ${may} activate ${whose} loyalty abilities any time you could cast an instant`, `${subj} ${may} activate ${K.obj({ ref: 'self' }, st, 'object').text}'s loyalty abilities any time you could cast an instant`)
        : `${subj} ${may} activate loyalty abilities ${whose} on any player's turn any time you could cast an instant`;
    }
    // edh-mana-keywords-8 (CR 702.6a, 602.5d): "you may activate equip abilities any time you could cast an instant"
    case 'activateEquipAsInstant':
      if (e.who.ref !== 'you' || e.of !== undefined) throw new NoRenderer('an equip-at-instant-speed permission for another player or other objects');
      return `you may activate equip abilities ${alt('any time', 'at any time')} you could cast an instant`; // family any-time-at-any-time
    case 'blockAsThough': {
      // p2-attack-block-1 (CR 609.4, 702.14c): "creatures with islandwalk can be blocked as though they didn't have islandwalk": any player's creatures (`who`) may block
      // creatures (`attacker`) as though they didn't have the keyword `asThough` names. "With <keyword>" is said from `asThough`: only an attacker with that keyword
      // has a denial the permission waives, so the attackers it concerns are exactly the creatures with it (the gate refuses two different keywords)
      if (e.attacker !== undefined) {
        // edh-c-106 (CR 609.4, 702.17b; Dragon Hunter): "~ can block Dragons as though it had reach": this object (`of` self) as the blocker of the attackers described
        if (JSON.stringify(e.of) === '{"self":true}' && e.asThough === 'as though it had reach' && JSON.stringify(e.who) === '{"ref":"you"}') return `${K.obj({ ref: 'self' }, st, 'subject').text} can block ${K.np(e.attacker, st, { det: 'none', plural: true })} ${e.asThough}`;
        // edhv31 (CR 609.4, 702.28; Aetherflame Wall): "~ can block creatures with shadow as though they didn't have shadow": the permanent itself is the blocker (`of` self)
        if (e.of !== undefined) {
          if (e.asThough === undefined || JSON.stringify(e.of) !== '{"self":true}' || e.who.ref !== 'you' || JSON.stringify(e.attacker) !== '{"types":["Creature"]}') throw new NoRenderer('a blockAsThough permission with a blocker filter other than the permanent itself');
          return `${K.obj({ ref: 'self' }, st, 'subject').text} can block creatures with ${e.asThough} as though they didn't have ${e.asThough}`;
        }
        if (e.of !== undefined || e.asThough === undefined || JSON.stringify(e.who) !== '{"ref":"each","who":"player"}' || JSON.stringify(e.attacker) !== '{"types":["Creature"]}') throw new NoRenderer('a blockAsThough permission for attackers other than "creatures with <keyword>", any player');
        return `creatures with ${e.asThough} can be blocked as though they didn't have ${e.asThough}`;
      }
      // edh-d-25 (CR 509.1a, 609.4; Masako the Humorless): "tapped creatures you control can block as though they were untapped": the blockers `of` matches, whose controller is `who`
      if (e.of !== undefined && e.asThough === 'as though they were untapped' && e.attacker === undefined && e.who.ref === 'you' && e.of.controller === 'you' && e.of.tapped === true) {
        return `${K.np(e.of, st, { det: 'none', plural: true })} can block as though they were untapped`;
      }
      if (e.of !== undefined) throw new NoRenderer('a blockAsThough permission with a blocker filter and no attackers'); // edh-c-106
      return `${K.obj({ ref: 'self' }, st, 'subject').text} can block ${e.asThough ?? 'as though it had flying'}`;
    }
    case 'lookAt': {
      // edh-next-62 (CR 406.3, 611.2b, 400.7; Gustha's Scepter, Rogue Class): "You may look at it for as long as it remains exiled": the card an earlier instruction named
      // (statics/play-permits.ts#namedLookVisibleTo); the duration is said by the effect around it
      if (e.of !== undefined && Object.keys(e.of).length === 1 && e.of.is !== undefined) return `${subj} ${may} look at ${K.obj(e.of.is, st, 'object').text}`;
      // FAST5X E25 (CR 708.5, 609.4): "you may look at face-down creatures your opponents control any time" (statics/play-permits.ts#faceDownVisibleTo)
      if (e.of !== undefined) {
        const { faceDown, ...rest } = e.of;
        if (faceDown !== true) throw new NoRenderer('a lookAt permission for objects that are not face down');
        return `${subj} ${may} look at face-down ${K.np(rest, st, { det: 'none', plural: true })} any time`;
      }
      return `${subj} ${may} look at the top card of ${who.person === 'you' ? 'your' : 'their'} library any time`;
    }
    // edh-next-12 (CR 402.3, 604.1; Telepathy): "Your opponents play with their hands revealed", "Players play with their hands revealed"
    case 'revealHand': {
      if (e.who.ref === 'you') return 'play with your hand revealed'; // edh-next-71 (Enduring Renewal): the permission of its controller only
      if (e.who.ref !== 'each' || !('who' in e.who) || (e.who.who !== 'opponent' && e.who.who !== 'player')) throw new NoRenderer('a hand revealed other than of each opponent or each player');
      return e.who.who === 'player' ? 'players play with their hands revealed' : 'your opponents play with their hands revealed';
    }
    // p2-dig-1 (CR 401.2): "Players play with the top card of their libraries revealed" (each player, statics/play-permits.ts#topCardRevealed)
    case 'revealTop': return e.who.ref === 'each' && 'who' in e.who && e.who.who === 'player' ? 'players play with the top card of their libraries revealed'
      : `play with the top card of ${who.person === 'you' ? 'your' : 'their'} library revealed`;
  }
}

/** r3-static: the filter "~ or an Equipment attached to it" of a trigger modification, as parser/templates/zz-cloud/r3-static.json builds it. */
const SELF_OR_ITS_EQUIPMENT = JSON.stringify({ anyOf: [{ self: true }, { subtypes: ['Equipment'], attachedToObject: { ref: 'self' } }] });
/** edh-next-124: the one card type of "the first activated ability of an <type> you activate each turn" (as statics/costmods.ts#firstOfTypeKind reads it); null for any other shape. */
function firstOfTypeSource(applies: CostModDef['applies']): string | null {
  const a = applies.abilities;
  if (a === undefined || a.keyword !== undefined || a.kind !== undefined || a.exceptMana !== undefined || a.source === undefined) return null;
  const f = a.source as Record<string, unknown>;
  const keys = Object.keys(f).filter((k) => f[k] !== undefined);
  if (!keys.every((k) => k === 'types' || (k === 'zone' && f[k] === 'battlefield'))) return null;
  return Array.isArray(f['types']) && f['types'].length === 1 && typeof f['types'][0] === 'string' ? f['types'][0] : null;
}

/** std-typechange-2: "this creature or an emblem you own" (The Masamune; sta.stdtc2.triggerMod.dying.selfOrEmblem). */
const SELF_OR_EMBLEM = JSON.stringify({ anyOf: [{ self: true }, { emblem: true, owner: 'you' }] });

/**
 * edh-next-146 (CR 613.1d, 613.1f, 612.8, 509.1b, 607.2d; Psychic Paper): "Equipped creature has ward {1}, it can't be blocked, and its name and creature type are the last chosen name and
 * creature type.": a plain grant of abilities to one object, a plain blocking ban of the same object, then its name and creature types set to the values its source's links hold. The
 * exact three effects only; null for anything else.
 */
function lastChosenNameAndTypeText(effects: StaticEffect[], st: RenderState): string | null {
  if (effects.length !== 3) return null;
  const [g, r, t] = effects as [StaticEffect, StaticEffect, StaticEffect];
  if (g.s !== 'continuous' || r.s !== 'restrict' || t.s !== 'continuous' || !isPlainGrant(g)) return null;
  if (JSON.stringify(r) !== JSON.stringify({ s: 'restrict', subject: g.affects, mode: 'cant', action: 'beBlocked' })) return null;
  if (Object.keys(t).some((k) => k !== 's' && k !== 'affects' && k !== 'mods') || JSON.stringify(t.affects) !== JSON.stringify(g.affects) || t.mods.length !== 1) return null;
  const m = t.mods[0]!;
  if (m.layer !== 4 || typeof m.namedChosen !== 'string' || Object.keys(m).sort().join() !== 'layer,namedChosen,subtypes' || m.subtypes === undefined) return null;
  if (Object.keys(m.subtypes).sort().join() !== 'chosen,chosenSets' || typeof m.subtypes.chosen !== 'string' || m.subtypes.chosenSets !== true) return null;
  const subject = K.obj(g.affects as ObjRef, st, 'subject');
  if (subject.plural) return null;
  return `${staticEffect(g, st)}, it can't be blocked, and its name and creature type are the last chosen name and creature type`;
}

/** The optional fields of a rule that its sentence has words for. */
const RULE_FIELDS: Record<RuleModDef['rule'], string[]> = {
  maxHandSize: ['player', 'value'], handSizeNoLimit: ['player'], startingLife: ['player', 'value'], landPlays: ['player', 'value'], combatDamageUsesToughness: ['of'],
  manaDoesNotEmpty: ['player'], attackTax: ['player', 'value', 'of'], extraBlockers: ['of', 'value'], extraAttackerBlocks: ['of', 'value'], poisonLimit: ['player', 'value'],
  commanderTax: ['value'], lifeTotalSetAs: ['player', 'value'], untapDuringOtherUntapSteps: ['of', 'opponents' /* edh-next-124 */],
  crewSaddlePowerBonus: ['value'], crewSaddleUsesToughness: [], // FAST5X E3
  crewPowerBonus: ['value'], crewUsesToughness: [], // edh-perms-15, edh-next-15
  lethalDamageUsesPower: ['of'], // edh-next-145
  crewStationPowerTripled: [], // trek-18
  drawDuringOpponentsDrawSteps: [], // edh-next-124 (CR 504.1): "you" only
  revealFirstDraw: ['onYourTurns'], // edh-next-144 (CR 701.20a, 121.2): "you" only
  unspentManaBecomes: ['player', 'manaType'], // FAST5X E19 (CR 106.4, 614.1); manaDoesNotEmpty's `manaType` is said too (below)
  manaBurn: ['player'], // edh-next-141 (CR 106.4, 119.3): every player only
  additionalVote: [], mayVoteAdditional: [], // M12-3 (CR 701.38d): "you" only
  choosesVotes: [], // edh-next-135 (CR 701.38a): "you" only
  villainousChoiceExtra: ['player'], // edh-next-135 (CR 701.55c): "an opponent" only
  cascadeLandTapped: [], // edh-d-97 (CR 702.85b): "you" only
  surveilLookAdditional: ['value'], // edh-d-96 (CR 701.25a): "you" only
  stationUsesToughness: ['of'], // cloud r3-mech (CR 702.184a)
  assignsNoCombatDamage: ['of'], // edh-combat-6 (CR 510.1)
  commanderTaxAsLife: ['value'], // CMD2 (CR 903.8)
  blockTax: ['value', 'of'], // r5-static (CR 509.1d)
  legendRuleExempt: ['of'], noLossForZeroLife: ['player'], additionalActivation: ['of'], negativePowerAssignsAsPositive: [], // r3-static (CR 704.5j, 704.5a, 602.5b, 510.1a)
  radiationGainsLife: ['player'], // edh-next-93 (CR 728.1, 119.3): Strong, the Brutish Thespian
  firstCoinFlipsWon: [], // r4-mech (CR 705.1-705.2): "you" only
  damageNotRemovedInCleanup: ['of'], // r4-mech (CR 514.2)
  countersRemain: [], // edhn81 (CR 122.2, 400.7): the source itself only
  zeroLoyaltyKept: ['of'], // r4-mech (CR 704.5i)
  damageLeavesOneLoyalty: ['of'], // edh-d-94 (CR 120.3c, 614.1a)
  chooseAsAttached: ['of', 'asAttached'], // edh-next-146 (CR 701.3a, 607.2d): the source itself only
  mayNotUntap: [], // std-rx13 (CR 502.3): the source itself only
  targetableThroughHexproof: ['of', 'ofPlayers', 'player'], // std-rx32 (CR 702.11b); edh-players-22: the players and the controller of the spells and abilities (Detection Tower)
  activateAsUnactivated: [], // std-rx27 (CR 602.5b, 702.177a): `keyword` only, "you"
  mayExertAsAttacks: [], enlist: [], // std-ry8 (CR 701.43a, 702.154a): the source itself only
  untapLimit: ['player', 'value', 'of'], // p2-player-rules-1 (CR 502.3)
  tapManaMultiplier: ['of', 'value'], // std-mana-1 (CR 106.12, 614.1a): "you" only
  diceAdvantage: [], // p2-c-dieroll-1 (CR 706.6, 614.1a): "you" only
  rollAdjust: ['cost', 'value', 'oncePerTurn'], rollReroll: ['cost', 'oncePerTurn'], // edh-d-49 (CR 706.2, 706.6): "you" only
  tappedLandManaColorless: ['value', 'player', 'manaType' /* edh-next-140: Contamination */], // edh-next-12 (CR 106.12, 614.1a): Damping Sphere
  tappedLandManaOnlyColorless: ['player'], // edh-c-72 (CR 106.12, 614.1a): Ritual of Subdual
  coinAdvantage: [], // edh-next-12 (CR 705.1, 614.1a): "you" only
  extraSpellCopy: [], // edh-cast-13 (CR 707.10, 614.1a): "you" only
  tappedLandManaOnlyType: ['player', 'manaType'], // edh-next-45 (CR 106.12, 614.1a): Infernal Darkness
  damageAsWither: [], // edh-d-44 (CR 702.80a): Everlasting Torment
  devotionBonus: ['value'], // edh-next-140 (CR 700.5): Altar of the Pantheon, "you" only
  damageAsInfect: ['player'], // edh-next-49 (CR 120.3b): Phyrexian Unlife
  roomAbilitiesExtra: [], // edh-next-75 (CR 309.4c, 603.2d): "you" only
  controlSearching: [], searchFoundExiled: [], // edh-next-119 (CR 723.2, 614.1a): the controller's opponents only
};
// edh-next-132 (CR 701.20a; God-Eternal Kefnet): the optional reveal ("You may reveal the first card you draw each turn as you draw it"), kept apart from edh-next-144's entry
RULE_FIELDS.revealFirstDraw.push('optional');

/** FAST5X E19: the word of a mana type in "unspent red mana", "becomes colorless". */
const manaTypeWord = (t: string): string => (t === 'C' ? 'colorless' : COLOR_WORD[t] ?? t);
/** FAST5 T52: did a condition already written in this sentence compare exactly this `distinct` count ("... card types among cards in your graveyard")? */
function conditionCounted(count: Extract<Quantity, { q: 'distinct' }>, st: RenderState): boolean {
  const want = JSON.stringify(count);
  for (const c of st.conds) {
    try {
      const o = JSON.parse(c) as { cond?: string; left?: unknown };
      if (o.cond === 'compare' && JSON.stringify(o.left) === want) return true;
    } catch { /* a condition key is always JSON */ }
  }
  return false;
}

/**
 * r5-static (CR 508.1h, 509.1d): "Creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures",
 * "Nonblack creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you", "Creatures can't block unless
 * their controller pays {1} for each blocking creature they control". Oracle says the per-creature count both ways (equivalence `combat-tax-each`). The
 * protected player is "you" only; the cost is generic mana (`value`: a number, or "{X} ..., where X is <quantity>") or a fixed `cost` of mana or life.
 */
const HAND_COUNT = '{"q":"count","of":{"ref":"each","filter":{"zone":"hand","owner":"you","isCard":true}}}';
/** edh-c-28: the amount of an aura's combat tax as Oracle words it ("{3}", "{1} for each card in your hand"); a computed amount that is not the hand size keeps "{X}, where X is ...". */
function attachedPay(e: RuleModDef, pay: string, where: string): string {
  return JSON.stringify(e.value) === HAND_COUNT ? '{1} for each card in your hand' : `${pay}${where}`;
}

function combatTax(e: RuleModDef, st: RenderState, n: string): string {
  if (e.player !== undefined && !(e.player.ref === 'you' && Object.keys(e.player).length === 1)) throw new NoRenderer(`${e.rule} for another player`);
  if ((e.value !== undefined) === (e.cost !== undefined)) throw new NoRenderer(`${e.rule} needs exactly one of value and cost`);
  if (e.value === 'none') throw new NoRenderer(`${e.rule} without an amount`);
  if (e.rule === 'blockTax' ? e.defenders !== undefined : e.blocking !== undefined) throw new NoRenderer(`${e.rule} with ${e.rule === 'blockTax' ? 'defenders' : 'blocking'}`);
  // a computed amount is "{X} for each ..., where X is the number of enchantments you control" (Oracle's order: the count last)
  // edh-d-38 (CR 107.3, 509.1d; War Cadence): the announced X of the ability that made the effect, fixed as it resolved, is just "{X}" (no "where X is")
  const announcedX = typeof e.value === 'object' && e.value.q === 'X' && Object.keys(e.value).length === 1;
  let pay = typeof e.value === 'object' ? '{X}' : `{${n}}`;
  const where = typeof e.value === 'object' && !announcedX ? `, where X is ${n}` : '';
  if (e.cost !== undefined) {
    const { mana, other, ...rest } = e.cost;
    const life = other?.length === 1 && other[0]!.kind === 'payLife' && typeof other[0]!.amount === 'number' ? other[0]!.amount : undefined;
    if (Object.keys(rest).length > 0 || (mana !== undefined) === (other !== undefined) || (other !== undefined && life === undefined)) throw new NoRenderer(`${e.rule} with this cost`);
    pay = mana !== undefined ? formatManaCost(mana) : `${life} life`;
  }
  // edh-top-13 (CR 508.1h, 122.1; Nils, Discipline Enforcer): the amount is read for each taxed creature: "Each creature with one or more counters on it can't attack you or
  // planeswalkers you control unless its controller pays {X}, where X is the number of counters on that creature."
  const v = e.value;
  if (e.rule === 'attackTax' && e.defenders === 'both' && typeof v === 'object' && v.q === 'counters' && v.kind === 'any' && v.on.ref === 'subject' && Object.keys(v.on).length === 1) {
    return `${K.np(e.of ?? {}, st, { det: 'each' })} can't attack you or planeswalkers you control unless its controller pays {X}, where X is the number of counters on that creature`;
  }
  // edh-c-28 (CR 508.1h, 303.4; Brainwash, Cowed by Wisdom): "Enchanted creature can't attack unless its controller pays {3}": the tax of the creature the source is attached to
  // (whatever it attacks); the amount "{1} for each card in your hand" is one generic mana for each card in the aura's controller's hand
  if (e.rule === 'attackTax' && e.defenders === 'any' && JSON.stringify(e.of) === '{"attachedToSource":true}') {
    return `${K.np(e.of!, st, { det: 'none' })} can't attack unless its controller pays ${attachedPay(e, pay, where)}`;
  }
  // edh-c-110 (CR 508.1h, 509.1d, 122.1; Myr Prototype): the object itself can't attack (or block) unless its controller pays {1} for each +1/+1 counter on it
  if (e.defenders !== 'both' && (e.rule === 'blockTax' ? e.defenders === undefined : e.defenders === 'any') && JSON.stringify(e.of) === '{"is":{"ref":"self"}}'
    && typeof v === 'object' && v.q === 'counters' && v.kind === '+1/+1' && v.on.ref === 'self' && Object.keys(v.on).length === 1) {
    return `~ can't ${e.rule === 'blockTax' ? 'block' : 'attack'} unless you pay {1} for each +1/+1 counter on it`;
  }
  const subj = e.of === undefined ? 'creatures' : K.np(e.of, st, { det: 'none', plural: true });
  if (e.rule === 'blockTax') {
    const what = e.blocking === undefined ? '' : ` ${K.np(e.blocking, st, { det: 'none', plural: true })}`;
    return `${subj} can't block${what} unless their controller pays ${pay} for each ${alt('of those creatures', 'blocking creature they control')}${where}`;
  }
  const at = { players: ' you', planeswalkers: ' planeswalkers you control', both: ' you or planeswalkers you control', any: '' }[e.defenders ?? 'players'];
  const attacking = { players: "creature they control that's attacking you", planeswalkers: "creature they control that's attacking a planeswalker you control", both: '', any: 'attacking creature they control' }[e.defenders ?? 'players'];
  return `${subj} can't attack${at} unless their controller pays ${pay} for each ${attacking ? alt('of those creatures', attacking) : 'of those creatures'}${where}`;
}

function ruleMod(e: RuleModDef, st: RenderState, limited = false): string {
  for (const k of ['player', 'value', 'of'] as const) {
    if (e[k] !== undefined && !RULE_FIELDS[e.rule].includes(k)) throw new NoRenderer(`rule ${e.rule} with ${k}`);
  }
  if (e.manaType !== undefined && e.rule !== 'manaDoesNotEmpty' && e.rule !== 'unspentManaBecomes' && e.rule !== 'tappedLandManaOnlyType' && e.rule !== 'tappedLandManaColorless' /* edh-next-140 */) throw new NoRenderer(`rule ${e.rule} with manaType`);
  if (e.delta !== undefined && e.rule !== 'maxHandSize') throw new NoRenderer(`rule ${e.rule} with delta`); // std-ry3
  if (e.onlyIf !== undefined && e.rule !== 'combatDamageUsesToughness' && e.rule !== 'stationUsesToughness') throw new NoRenderer(`rule ${e.rule} with onlyIf`);
  if ((e.keyword !== undefined) !== (e.rule === 'additionalActivation' || e.rule === 'activateAsUnactivated')) throw new NoRenderer(`rule ${e.rule} with${e.keyword === undefined ? 'out' : ''} keyword`);
  if (e.then !== undefined && e.rule !== 'mayExertAsAttacks') throw new NoRenderer(`rule ${e.rule} with then`);
  const who = e.player ? K.player(e.player, st, 'subject') : K.player({ ref: 'you' }, st, 'subject');
  const poss = e.player ? K.player(e.player, st, 'possessive').text : 'your';
  const v = e.value;
  const n = v === undefined || v === 'none' ? '' : K.qty(v, st);
  // edh-next-132 (CR 701.20a; God-Eternal Kefnet): edh-next-144's reveal made optional, "You may reveal the first card you draw each turn as you draw it."
  if (e.rule === 'revealFirstDraw' && e.optional === true) { if (e.onYourTurns === true) throw new NoRenderer('an optional reveal on your turns only'); return 'you may reveal the first card you draw each turn as you draw it'; }
  switch (e.rule) {
    case 'maxHandSize': {
      if (v === 'none') return `${who.text} ${who.person === 'you' ? 'have' : 'has'} no maximum hand size`;
      // std-ry3 (CR 402.2): "Your maximum hand size is increased by two." / "... is reduced by three."
      if (e.delta !== undefined) {
        if (typeof v === 'object') throw new NoRenderer('a maximum hand size changed by a computed number');
        return `${poss} maximum hand size is ${e.delta === 'increase' ? 'increased' : 'reduced'} by ${n}`;
      }
      if (typeof v !== 'object') return `${poss} maximum hand size is ${n}`;
      // FAST5 T52 (CR 402.2, 205.2a; delirium): a calculated size reads "... is equal to ..." as well, and "seven minus the number of those card types" names
      // the card types the static's own condition counted ("As long as there are four or more card types among cards in your graveyard, ...")
      const eq = `${poss} maximum hand size is equal to ${n}`;
      const base = alt(`${poss} maximum hand size is ${n}`, eq);
      const d = v.q === 'math' && v.op === '-' && v.args.length === 2 ? v.args[1] : undefined;
      if (d !== undefined && typeof d === 'object' && d.q === 'distinct' && d.what === 'cardTypes' && conditionCounted(d, st)) {
        return alt(base, `${poss} maximum hand size is equal to ${K.qty((v as { args: Quantity[] }).args[0]!, st)} minus the number of those card types`);
      }
      return base;
    }
    case 'handSizeNoLimit': {
      const text = `${who.text} ${who.person === 'you' ? 'have' : 'has'} no maximum hand size`;
      // CLOUD C2 (CR 402.2): every player is also "players" ("Players have no maximum hand size")
      const p = e.player as { ref?: string; who?: string } | undefined;
      return p !== undefined && p.ref === 'each' && p.who === 'player' && Object.keys(p).length === 2 ? alt(text, 'players have no maximum hand size') : text;
    }
    case 'startingLife': return `${who.text} ${who.person === 'you' ? 'start' : 'starts'} the game with ${n} life`;
    case 'landPlays': return `${who.text} may play ${typeof v === 'number' && v === 1 ? 'an additional land' : `${typeof v === 'number' ? numWord(v) : n} additional lands`}${limited ? '' : ` on each of ${poss} turns`}`;
    // edh-combat-6 (CR 510.1; Master of Cruelties): "~ assigns no combat damage" (the source, or the one object an effect names)
    case 'assignsNoCombatDamage': {
      if (e.of === undefined) return `${K.obj({ ref: 'self' }, st, 'subject').text} assigns no combat damage`;
      if (Object.keys(e.of).length !== 1 || e.of.is === undefined || (e.of.is.ref !== 'self' && e.of.is.ref !== 'target' && e.of.is.ref !== 'bound' && e.of.is.ref !== 'event')) throw new NoRenderer('a no-combat-damage rule for more than one named object');
      const one = K.obj(e.of.is as ObjRef, st, 'subject');
      return `${one.text} ${one.plural ? 'assign' : 'assigns'} no combat damage`;
    }
    // edh-next-145 (CR 120.6, 704.5g; Zilortha, Strength Incarnate): "Lethal damage dealt to creatures you control is determined by their power rather than their toughness."
    case 'lethalDamageUsesPower': {
      if (e.of === undefined) throw new NoRenderer('lethal damage by power of the source alone');
      return `lethal damage dealt to ${K.np(e.of, st, { det: 'none', plural: true })} is determined by their power rather than their toughness`;
    }
    case 'combatDamageUsesToughness': {
      const assigns = 'assigns combat damage equal to its toughness rather than its power';
      // edh-c-82 (CR 510.1a; Streetwise Negotiator): the source itself, "~ assigns combat damage equal to its toughness rather than its power"
      if (e.onlyIf === undefined && e.of !== undefined && JSON.stringify(e.of) === '{"is":{"ref":"self"}}') return `${K.obj({ ref: 'self' }, st, 'subject').text} ${assigns}`;
      if (e.onlyIf === undefined) return `each ${e.of ? K.np(e.of, st, { det: 'none' }) : 'creature'} ${assigns}`;
      // FAST5 T60 (CR 510.1a): only while its toughness is greater than its power; the creature an Equipment is attached to is "equipped creature"
      if (e.of !== undefined && JSON.stringify(e.of) === '{"attachedToSource":true}') return `as long as ${K.obj({ ref: 'attachedTo' }, st, 'subject').text}'s toughness is greater than its power, it ${assigns}`;
      return `each ${e.of ? K.np(e.of, st, { det: 'none' }) : 'creature'} with toughness greater than its power ${assigns}`;
    }
    // r4-mech (CR 514.2): "damage isn't removed from ~ during cleanup steps", or from each permanent of a description ("from creatures your opponents control")
    case 'countersRemain': return `counters remain on ${K.obj({ ref: 'self' }, st, 'object').text} as it moves to any zone other than a player's hand or library`; // edhn81
    case 'damageNotRemovedInCleanup': return `damage isn't removed from ${e.of === undefined ? K.obj({ ref: 'self' }, st, 'object').text : K.np(e.of, st, { det: 'none', plural: true })} during cleanup steps`;
    // std-rx13 (CR 502.3): "you may choose not to untap ~ during your untap step"
    case 'targetableThroughHexproof': {
      // edh-players-22 (CR 702.11b-c, 609.4; Detection Tower): "your opponents and creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof"
      if (e.ofPlayers === undefined && e.player === undefined) return `${K.np(e.of!, st, { det: 'none', plural: true })} can be the targets of spells and abilities as though they didn't have hexproof`; // std-rx32 (CR 702.11b)
      if (e.ofPlayers !== undefined && JSON.stringify(e.ofPlayers) !== '{"ref":"each","who":"opponent"}') throw new NoRenderer('a hexproof waiver for players other than your opponents');
      if (e.player !== undefined && JSON.stringify(e.player) !== '{"ref":"you"}') throw new NoRenderer('a hexproof waiver for the spells and abilities of a player other than you');
      if (e.of === undefined && e.ofPlayers === undefined) throw new NoRenderer('a hexproof waiver that covers nothing');
      const covered = [...(e.ofPlayers !== undefined ? ['your opponents'] : []), ...(e.of !== undefined ? [K.np(e.of, st, { det: 'none', plural: true })] : [])].join(' and ');
      return `${covered} can be the targets of spells and abilities${e.player !== undefined ? ' you control' : ''} as though they didn't have hexproof`;
    }
    case 'mayNotUntap': return `you may choose not to untap ${K.obj({ ref: 'self' }, st, 'object').text} during your untap step`;
    // std-ry8 (CR 701.43a, 603.12): "you may exert ~ as it attacks", and "When you do, X." (its `then`: one reflexive trigger waiting for the exert)
    case 'mayExertAsAttacks': {
      // edh-combat-1 (CR 701.43a; Combat Celebrant): "If ~ hasn't been exerted this turn, you may exert it as it attacks."; the object is "it" there (the condition named it)
      if (e.unlessExertedThisTurn === true) {
        if (e.then === undefined) throw new NoRenderer('an exert option with a condition and nothing after it');
        const r0 = e.then.do.length === 1 ? e.then.do[0]! : undefined;
        if (r0 === undefined || r0.op !== 'reflexive' || r0.when.did !== e.then.as || r0.when.if !== undefined || r0.modes !== undefined) throw new NoRenderer('the steps after an exert other than "When you do, X"');
        return `if ${K.obj({ ref: 'self' }, st, 'object').text} hasn't been exerted this turn, you may exert it as it attacks. when you do, ${K.steps(r0.do, st)}`;
      }
      // edh-d-12 (CR 701.43a; Themberchaud; family exert-as-name-attacks): a legendary character's own name stands for "he" or "she" in Oracle, so the exerted creature is also named again, "as ~ attacks"
      const exert = `you may exert ${K.obj({ ref: 'self' }, st, 'object').text} as ${alt('it', '~')} attacks`;
      if (e.then === undefined) return exert;
      const r = e.then.do.length === 1 ? e.then.do[0]! : undefined;
      if (r === undefined || r.op !== 'reflexive' || r.when.did !== e.then.as || r.when.if !== undefined || r.modes !== undefined) throw new NoRenderer('the steps after an exert other than "When you do, X"');
      return `${exert}. when you do, ${K.steps(r.do, st)}`;
    }
    case 'enlist': throw new NoRenderer('enlist is said by its keyword');
    // edh-next-146 (CR 701.3a, 607.2d; Psychic Paper): "As this Equipment becomes attached to a creature, choose a creature card name and a creature type."
    case 'chooseAsAttached': {
      const list = e.asAttached ?? [];
      const what = (c: NonNullable<RuleModDef['asAttached']>[number]): string => (c.what === 'color' ? 'a color' : c.what === 'creatureType' ? 'a creature type' : c.cardKind === 'creature' ? 'a creature card name' : 'a card name');
      if (list.length === 0 || list.length > 2 || e.of === undefined) throw new NoRenderer('choices as an attachment becomes attached, other than one or two, or to anything');
      return `as ${K.obj({ ref: 'self' }, st, 'subject').text} becomes attached to ${K.np(e.of, st, { det: 'a' })}, choose ${list.map(what).join(' and ')}`;
    }
    // r4-mech (CR 704.5i): "planeswalkers you control aren't put into their owners' graveyards for having 0 loyalty"
    // edh-d-94 (CR 120.3c, 614.1a; Deification): "if damage dealt to a planeswalker you control of the chosen type would result in all loyalty counters on it being removed, instead all but
    // one of those counters are removed"
    case 'damageLeavesOneLoyalty': return `if damage dealt to ${e.of === undefined ? K.obj({ ref: 'self' }, st, 'object').text : K.np(e.of, st, { det: 'a' })} would result in all loyalty counters on it being removed, instead all but one of those counters are removed`;
    case 'zeroLoyaltyKept': return e.of === undefined
      ? `${K.obj({ ref: 'self' }, st, 'subject').text} isn't put into its owner's graveyard for having 0 loyalty`
      : `${K.np(e.of, st, { det: 'none', plural: true })} aren't put into their owners' graveyards for having 0 loyalty`;
    // r4-mech (CR 705.1-705.2, 614.1a)
    case 'firstCoinFlipsWon': return 'the first time you flip one or more coins each turn, those coins come up heads and you win those flips';
    // edh-cast-13 (CR 707.10, 614.1a; Twinning Staff)
    case 'extraSpellCopy':
      if (e.player !== undefined && JSON.stringify(e.player) !== '{"ref":"you"}') throw new NoRenderer('an additional spell copy for a player other than you');
      return 'if you would copy a spell one or more times, instead copy it that many times plus an additional time. you may choose new targets for the additional copy';
    // p2-c-dieroll-1 (CR 706.6, 614.1a)
    case 'tappedLandManaColorless': {
      // edh-next-12 (CR 106.12, 614.1a; Damping Sphere): "If a land is tapped for two or more mana, it produces {C} instead of any other type and amount." (every player's lands)
      // edh-next-140 (CR 106.12, 614.1a; Contamination): "If a land is tapped for mana, it produces {B} instead of any other type and amount." (every player's lands; one mana of the type)
      if (e.value === 1 && e.manaType !== undefined && e.manaType !== 'C' && e.player !== undefined && JSON.stringify(e.player) === '{"ref":"each","who":"player"}') return `if a land is tapped for mana, it produces {${e.manaType.toLowerCase()}} instead of any other type and amount`;
      if (e.manaType !== undefined) throw new NoRenderer('a tapped-land mana collapse to a type other than Contamination\'s');
      if (e.value !== 2 || e.player === undefined || JSON.stringify(e.player) !== '{"ref":"each","who":"player"}') throw new NoRenderer('a tapped-land mana collapse other than Damping Sphere\'s, for two or more mana of every player\'s lands');
      return 'if a land is tapped for two or more mana, it produces {c} instead of any other type and amount';
    }
    case 'tappedLandManaOnlyColorless':
      // edh-c-72 (CR 106.12, 614.1a; Ritual of Subdual): every player's lands
      if (e.player === undefined || JSON.stringify(e.player) !== '{"ref":"each","who":"player"}') throw new NoRenderer('a tapped-land colorless mana rule for lands other than every player\'s');
      return 'if a land is tapped for mana, it produces colorless mana instead of any other type';
    case 'tappedLandManaOnlyType':
      // edh-next-45 (CR 106.12, 614.1a; Infernal Darkness): every player's lands, a colored type
      if (e.player === undefined || JSON.stringify(e.player) !== '{"ref":"each","who":"player"}' || e.manaType === undefined || e.manaType === 'C') throw new NoRenderer('a tapped-land single-type mana rule for lands other than every player\'s, or for colorless');
      return `if a land is tapped for mana, it produces {${e.manaType.toLowerCase()}} instead of any other type`;
    case 'coinAdvantage': return 'if you would flip a coin, instead flip two coins and ignore one'; // edh-next-12 (Krark's Thumb)
    case 'diceAdvantage': return 'if you would roll one or more dice, instead roll that many dice plus one and ignore the lowest roll';
    case 'rollAdjust': case 'rollReroll': return rollOptionText(e, st); // edh-d-49 (CR 706.2, 706.6)
    // cloud r3-mech (CR 702.184a): "each creature you control with toughness greater than its power stations permanents using its toughness rather than its power"
    case 'stationUsesToughness': {
      const stations = 'stations permanents using its toughness rather than its power';
      if (e.of === undefined) return `${K.obj({ ref: 'self' }, st, 'subject').text} ${stations}`;
      return `each ${K.np(e.of, st, { det: 'none' })}${e.onlyIf !== undefined ? ' with toughness greater than its power' : ''} ${stations}`;
    }
    // edh-next-141 (CR 106.4, 500.5, 119.3; Yurlok of Scorch Thrash): "A player losing unspent mana causes that player to lose that much life." (every player)
    case 'manaBurn':
      if (e.player?.ref !== 'each' || (e.player as { who?: string }).who !== 'player') throw new NoRenderer('mana burn of some players only');
      return 'a player losing unspent mana causes that player to lose that much life';
    case 'manaDoesNotEmpty': {
      // CR 500.5: "Mana pools don't empty" is every player's; "You don't lose unspent mana" is the one player's
      // FAST5X E19 (CR 106.4): "You don't lose unspent red mana as steps and phases end": only mana of that type
      const mana = e.manaType === undefined ? 'unspent mana' : `unspent ${manaTypeWord(e.manaType)} mana`;
      const lose = `${who.text} ${who.person === 'you' ? "don't" : "doesn't"} lose ${mana} as steps and phases end`;
      return e.player?.ref === 'each' && e.manaType === undefined ? alt("mana pools don't empty as steps and phases end", lose, "players don't lose unspent mana as steps and phases end" /* edh-d-5 (Upwelling) */) : lose;
    }
    // r3-static (CR 704.5j): "The "legend rule" doesn't apply to permanents you control" / "The "legend rule" doesn't apply."
    case 'legendRuleExempt': return `the "legend rule" doesn't apply${e.of === undefined ? '' : ` to ${K.np(e.of, st, { det: 'none', plural: true })}`}`;
    // r3-static (CR 602.5b, 702.193a): "Each power-up ability of permanents you control can be activated an additional time" (one more; no `value`)
    // std-rx27 (CR 602.5b, 702.177a): "you may activate exhaust abilities as though they haven't been activated" (statics/hooks.ts#activatesAsUnactivated)
    case 'activateAsUnactivated': return `you may activate ${e.keyword} abilities as though they haven't been activated`;
    case 'additionalActivation': {
      const twice = e.keyword === 'loyalty:twice';
      const plain = `each ${twice ? 'loyalty' : e.keyword} ability of ${e.of === undefined ? 'permanents' : K.np(e.of, st, { det: 'none', plural: true })} can be activated an additional time`;
      // edh-players-6 (CR 606.3, 602.5b; family loyalty-twice): "You may activate the loyalty abilities of planeswalkers you control twice each turn rather than only once" (Oath of Teferi)
      return twice && e.of !== undefined && e.of.is === undefined
        ? alt(plain, `you may activate the loyalty abilities of ${K.np(e.of, st, { det: 'none', plural: true })} twice each turn rather than only once`) : plain;
    }
    // r3-static (CR 510.1a): Oracle's "he" / "his" for a character are "~" and "~'s" by the time the gate compares (equivalence self-by-name)
    case 'negativePowerAssignsAsPositive': return `if ~'s power is negative, ~ assigns combat damage as though ~'s power were positive`;
    // r3-static (CR 704.5a, 104.3b)
    case 'noLossForZeroLife': return `${who.text} ${who.person === 'you' ? "don't" : "doesn't"} lose the game for having 0 or less life`;
    case 'radiationGainsLife': return `${who.text} gain${who.person === 'you' ? '' : 's'} life rather than lose life from radiation`; // edh-next-93 (CR 728.1, 119.3, 614.1a)
    case 'roomAbilitiesExtra': return 'room abilities of dungeons you own trigger an additional time'; // edh-next-75 (CR 309.4c, 603.2d)
    // edh-next-49 (CR 120.3b): "All damage is dealt to you as though its source had infect" (Phyrexian Unlife)
    case 'damageAsWither': return 'all damage is dealt as though its source had wither';
    // edh-next-140 (CR 700.5): "Your devotion to each color and each combination of colors is increased by one." (statics/hooks.ts#devotionBonus)
    case 'devotionBonus': {
      if (e.player !== undefined && e.player.ref !== 'you') throw new NoRenderer('devotionBonus of a player other than you');
      if (typeof v === 'object' || v === 'none') throw new NoRenderer('a devotion bonus of a computed number');
      return `your devotion to each color and each combination of colors is increased by ${v === undefined ? 'one' : n}`;
    }
    case 'damageAsInfect': return `all damage is dealt to ${who.person === 'you' ? 'you' : who.text} as though its source had infect`;
    case 'tapManaMultiplier': {
      // std-mana-1 (CR 106.12, 614.1a): "If you tap a basic land for mana, it produces three times as much of that mana instead."
      const times = v === 2 ? 'twice' : v === 3 ? 'three times' : null;
      if (times === null || e.of === undefined || e.player !== undefined) throw new NoRenderer('tapManaMultiplier other than twice or three times a described permanent of yours');
      return `if you tap ${K.np(e.of, st, { det: 'a' })} for mana, it produces ${times} as much of that mana instead`;
    }
    case 'unspentManaBecomes': {
      // FAST5X E19 (CR 106.4, 614.1): "If you would lose unspent mana, that mana becomes red instead"
      if (e.manaType === undefined) throw new NoRenderer('unspentManaBecomes without a type');
      return `if ${who.text} would lose unspent mana, that mana becomes ${manaTypeWord(e.manaType)} instead`;
    }
    case 'attackTax': return combatTax(e, st, n);
    case 'blockTax': return combatTax(e, st, n);
    case 'extraBlockers': {
      // FAST4 T33 (CR 509.1a): a group says "each creature you control can block ..."; with a duration the extra block is "this turn", not "each combat" (the
      // duration follows, `lasting`)
      const selfOnly = e.of !== undefined && JSON.stringify(e.of) === '{"self":true}';
      const who = e.of && !selfOnly ? alt(K.np(e.of, st, { det: 'a' }), K.np(e.of, st, { det: 'each' })) : e.of ? K.np(e.of, st, { det: 'a' }) : K.obj({ ref: 'self' }, st, 'subject').text;
      const each = limited ? '' : ' each combat';
      // edh-c-94 (CR 509.1a, 107.3; family block-an-additional-for-each; Kemba's Legion): one more creature for each object counted, "can block an additional creature each combat for each Equipment attached to ~"
      const counted1 = typeof v === 'object' && v !== null && v.q === 'count' && v.of.ref === 'each' && 'filter' in v.of && !limited ? v.of.filter : undefined;
      if (counted1 !== undefined) return `${who} can block ${alt(`up to ${n} additional creatures${each}`, `an additional creature${each} for each ${K.np(counted1, st, { det: 'none' })}`)}`;
      return `${who} can block ${v === 'none' || v === undefined ? 'any number of creatures' : typeof v === 'number' && v === 1 ? `an additional creature${each}` : typeof v === 'number' && v > 1 ? alt(`up to ${n} additional creatures${each}`, `an additional ${numWord(v)} creatures${each}`) /* edh-next-8 (family block-an-additional-number): Watcher in the Web */ : `up to ${n} additional creatures${each}`}`;
    }
    case 'extraAttackerBlocks': return `${e.of ? K.np(e.of, st, { det: 'a' }) : K.obj({ ref: 'self' }, st, 'subject').text} can be blocked by ${v === 'none' || v === undefined ? 'any number of creatures' : `up to ${n} additional creatures`}`;
    // T20 (FAST4): CR 502.3, the source itself
    // r4-static (CR 502.3): or the permanents of `of`, "Untap each creature you control during each other player's untap step" / "Untap all creatures you control ..."
    // edh-next-124 (CR 502.3, 102.3; Teferi, Who Slows the Sunset's emblem): `opponents`, "during each opponent's untap step"
    case 'untapDuringOtherUntapSteps': {
      const whose = e.opponents === true ? "each opponent's" : "each other player's";
      return e.of === undefined
        ? `untap ${K.obj({ ref: 'self' }, st, 'object').text} during ${whose} untap step`
        : `untap ${alt(`each ${K.np(e.of, st, { det: 'none' })}`, `all ${K.np(e.of, st, { det: 'none', plural: true })}`)} during ${whose} untap step`;
    }
    // edh-next-124 (CR 504.1; Teferi, Who Slows the Sunset's emblem): "You draw a card during each opponent's draw step."
    case 'drawDuringOpponentsDrawSteps': return "you draw a card during each opponent's draw step";
    // edh-next-144 (CR 701.20a, 121.2; Keranos, God of Storms, Primitive Etchings): "Reveal the first card you draw on each of your turns." / "... each turn."
    case 'revealFirstDraw': return e.onYourTurns === true ? 'reveal the first card you draw on each of your turns' : 'reveal the first card you draw each turn';
    // p2-player-rules-1 (CR 502.3): "Players can't untap more than one nonbasic land during their untap steps." / "You can't untap more than one land during your
    // untap step." / "Your opponents can't untap more than two permanents during their untap steps."
    case 'untapLimit': {
      if (typeof v !== 'number') throw new NoRenderer('an untap limit of a computed number');
      const p = JSON.stringify(e.player ?? { ref: 'you' });
      const what = e.of === undefined ? (v === 1 ? 'permanent' : 'permanents') : K.np(e.of, st, { det: 'none', plural: v !== 1 });
      const tail = `can't untap more than ${n} ${what} during`;
      if (p === '{"ref":"you"}') return `you ${tail} your untap step`;
      if (p === '{"ref":"each","who":"player"}') return `players ${tail} their untap steps`;
      if (p === '{"ref":"each","who":"opponent"}') return `your opponents ${tail} their untap steps`;
      throw new NoRenderer('an untap limit of another player');
    }
    case 'poisonLimit': return `${who.text} ${who.person === 'you' ? 'lose' : 'loses'} the game when ${who.person === 'you' ? 'you have' : 'they have'} ${n} or more poison counters`;
    case 'commanderTax': return `${K.obj({ ref: 'self' }, st, 'subject').text} costs {${n || '2'}} more to cast from the command zone for each time it has been cast from the command zone this game`;
    case 'lifeTotalSetAs': return `${poss} life total is ${n}`;
    // CMD2 (CR 903.8): the commander tax paid in life (Liesa, Shroud of Dusk)
    case 'commanderTaxAsLife': return `rather than pay {2} for each previous time you've cast ${K.obj({ ref: 'self' }, st, 'object').text} from the command zone this game, pay ${n} life that many times`;
    // FAST5X E3: CR 702.122a, 702.171a, the source itself
    case 'crewSaddlePowerBonus': return `${K.obj({ ref: 'self' }, st, 'subject').text} saddles Mounts and crews Vehicles as though its power were ${n} greater`;
    case 'crewPowerBonus': return `${K.obj({ ref: 'self' }, st, 'subject').text} crews Vehicles as though its power were ${n} greater`; // edh-perms-15 (CR 702.122a)
    case 'crewStationPowerTripled': return `${K.obj({ ref: 'self' }, st, 'subject').text} stations Spacecraft and crews Vehicles as though ${K.obj({ ref: 'self' }, st, 'subject').text}'s power were tripled`; // trek-18 (CR 702.122a, 702.184a, 701.11)
    case 'crewUsesToughness': return `${K.obj({ ref: 'self' }, st, 'subject').text} crews Vehicles using its toughness rather than its power`; // edh-next-15 (CR 702.122a)
    case 'crewSaddleUsesToughness': return `${K.obj({ ref: 'self' }, st, 'subject').text} saddles Mounts and crews Vehicles using its toughness rather than its power`;
    // M12-3 (CR 701.38d): the controller of the source has one more vote in every vote
    case 'additionalVote': return 'while voting, you get an additional vote';
    case 'mayVoteAdditional': return 'while voting, you may vote an additional time';
    case 'choosesVotes': return 'you choose how each player votes'; // edh-next-135 (CR 701.38a; Illusion of Choice)
    // edh-next-135 (CR 701.55c; The Valeyard): only "an opponent" (each opponent of the controller)
    case 'villainousChoiceExtra': {
      if (JSON.stringify(e.player) !== JSON.stringify({ ref: 'each', who: 'opponent' })) throw new NoRenderer('a villainous choice faced again by a player other than an opponent');
      return `if an opponent would face a villainous choice, ${alt('they face', 'that player faces')} that choice an additional time`; // family opponent-faces-villainous-again
    }
    // edh-d-97 (CR 702.85b; Averna, the Chaos Bloom): the controller of the source, as they cascade
    case 'cascadeLandTapped': return 'as you cascade, you may put a land card from among the exiled cards onto the battlefield tapped';
    // edh-d-96 (CR 701.25a; Enhanced Surveillance): the controller of the source, a fixed number of cards
    case 'surveilLookAdditional': if (typeof v !== 'number') throw new NoRenderer('additional surveil cards that are not a fixed number'); return `you may look at an additional ${n} cards each time you surveil`;
    // edh-next-119 (CR 723.2, 723.5, 701.23a; family search-control-opponents): the controller's opponents, "your opponents" / "each opponent"
    case 'controlSearching': return `you control ${alt('your opponents', 'each opponent')} while they're searching their libraries`;
    // edh-next-119 (CR 614.1a, 609.4b, 701.23a; family search-control-opponents): "each card they find" / "the cards they find"
    case 'searchFoundExiled': return `while an opponent is searching their library, they exile ${alt('each card', 'the cards')} they find. you may play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color to cast them`;
  }
}

/** "an artifact or creature entering" for the cause of a trigger modifier. */
function causeText(ev: EventPattern, st: RenderState): string {
  // M6-12: "entering the battlefield" is the older wording of the same event (CR 603.6a)
  if (ev.ev === 'zoneChange' && ev.to === 'battlefield' && !ev.from) {
    const who = K.np(ev.subject, st, { det: 'a' });
    return alt(`${who} entering`, `${who} entering the battlefield`);
  }
  if (ev.ev === 'zoneChange' && ev.from === 'battlefield' && ev.to === 'graveyard') return `${K.np(ev.subject, st, { det: 'a' })} dying`;
  // std-rx2 (CR 508.1m, 603.2d): "if a creature attacking causes a triggered ability ... to trigger" (Isshin, Two Heavens as One): the creature declared as an attacker
  if (ev.ev === 'attacks' && ev.attacker !== undefined && Object.keys(ev).length === 2) return `${K.np(ev.attacker, st, { det: 'a' })} attacking`;
  // edh-replace-6 (CR 603.2d, 510.2; Felix Five-Boots): "if a creature you control dealing combat damage to a player causes a triggered ability ... to trigger": combat damage dealt by a
  // described source to any player (nothing else said of the damage)
  if (ev.ev === 'damage' && ev.combat === true && ev.source !== undefined && JSON.stringify(ev.recipient) === '{"player":"any"}' && Object.keys(ev).every((k) => k === 'ev' || k === 'combat' || k === 'source' || k === 'recipient')) {
    return `${K.np(ev.source, st, { det: 'a' })} dealing combat damage to a player`;
  }
  // edh-d-45 (CR 603.2d, 120.1; Wayta, Trainer Prodigy): "if a creature you control being dealt damage causes a triggered ability ... to trigger": damage dealt to a described permanent (nothing else said of it)
  if (ev.ev === 'damage' && ev.recipient?.object !== undefined && Object.keys(ev.recipient).length === 1 && Object.keys(ev).every((k) => k === 'ev' || k === 'recipient')) return `${K.np(ev.recipient.object, st, { det: 'a' })} being dealt damage`;
  // trek-2 (CR 603.2d): "if you gaining life causes a triggered ability ... to trigger" (Dr. Beverly Crusher): a life gain of the doubler's controller
  if (isLifeGainCause(ev)) return 'you gaining life';
  // edh-d-93 (CR 603.2d, 121.1): "if a player drawing a card causes a triggered ability ... to trigger" (Krang, the All-Powerful): a draw of any player
  if (isAnyDrawCause(ev)) return 'a player drawing a card';
  // edh-next-141 (CR 603.2d, 702.37e, 708.8; Panoptic Projektor): "if turning a face-down permanent face up causes a triggered ability ... to trigger": any permanent turned face up
  if (isTurnedFaceUpCause(ev)) return 'turning a face-down permanent face up';
  // edh-cast-2 (CR 603.2d, 601.2i, 707.10): "if you casting or copying an instant or sorcery spell causes a triggered ability ... to trigger" (Veyran, Voice of Duality): a cast of the
  // doubler's controller, copies included, of a spell of a description (nothing else said of the cast)
  if (ev.ev === 'cast' && ev.player === 'you' && ev.orCopy === true && ev.spell !== undefined && Object.keys(ev).every((k) => k === 'ev' || k === 'player' || k === 'spell' || k === 'orCopy')) {
    return `you casting or copying ${K.np({ ...ev.spell, stackKind: 'spell' }, st, { det: 'a' })}`;
  }
  return K.event(ev, st, 'present');
}

function additionalCost(e: Extract<StaticEffect, { s: 'additionalCost' }>, st: RenderState): string {
  // M6-0: a choice between grouped costs ("sacrifice a creature or pay {3}", CR 601.2b) is one sentence over several effects: M6-5 writes its wording
  if (e.choiceGroup !== undefined) throw new NoRenderer('an additional cost in a choice group (M6-5)');
  const self = K.obj({ ref: 'self' }, st, 'subject').text;
  // std-costs-2 (CR 601.2b, 607.2d): "you may choose a creature type and behold two creatures of that type": the choice the cost starts with
  if (e.chooseType !== undefined && (e.repeatable || e.xMax !== undefined || e.choosePlayer !== undefined)) throw new NoRenderer('a chosen creature type with another kind of additional cost');
  // edh-zones-16 (CR 107.3, 601.2b; Open the Way): "X can't be greater than the number of players in the game." on its own: no cost at all, only the largest X a spell may announce
  if (e.xMax !== undefined && Object.values(e.cost).every((v) => v === undefined) && !e.optional && !e.repeatable && e.name === undefined && e.chooseType === undefined && e.choosePlayer === undefined && e.announceCount === undefined) {
    return `x can't be greater than ${K.qty(e.xMax, st)}`;
  }
  const body = `${e.chooseType !== undefined ? 'choose a creature type and ' : ''}${K.costVerbs(e.cost, st, 'you')}`;
  const rep = e.repeatable ? ' any number of times' : '';
  // edh-cast-15 (CR 601.2b, 603.12, 707.10; Plumb the Forbidden, capability feature:additionalCost.copyForEach): "you may sacrifice one or more creatures. When you do, copy this spell for each creature sacrificed this way."
  if (e.copyForEach === true) {
    if (!e.optional || e.repeatable || e.announceCount !== true || e.name === undefined || e.chooseType !== undefined || e.choosePlayer !== undefined || e.xMax !== undefined || body !== 'sacrifice any number of creatures') {
      throw new NoRenderer('a copy for each object of an additional cost other than "you may sacrifice one or more creatures"');
    }
    return `as an additional cost to cast ${self}, you may sacrifice one or more creatures. when you do, copy ${self} for each creature sacrificed this way`;
  }
  // edhc5 (CR 601.2b, 601.2f): the number announced for "you may exile any number of blue cards from your hand" is called "for each card exiled this way" by a reduction
  // that reads it (the sacrifice cost of std-costs-1 keeps "permanent sacrificed this way")
  if (e.announceCount === true && e.name !== undefined) {
    const part = (e.cost.other ?? []).find((p) => ('count' in p && p.count === 'any') || (p.kind === 'removeCounters' && p.anyNumber === true && p.among === true));
    // edh-d-2 (CR 601.2b, 601.2f; Torgaar, Gorex): the sacrifice of creatures only is "creature sacrificed this way", and the exile from the graveyard "card exiled this way"
    const noun = part?.kind === 'exileFrom' && (part.zone === 'hand' || part.zone === 'graveyard') ? 'card exiled this way' : part?.kind === 'discard' ? 'card discarded this way'
      : part?.kind === 'sacrifice' && JSON.stringify(part.filter) === JSON.stringify({ types: ['Creature'] }) ? 'creature sacrificed this way'
      : part?.kind === 'tapUntapped' && part.filter.types?.length === 1 && part.filter.types[0] === 'Creature' ? 'creature tapped this way' /* edh-next-58 (CR 601.2b, 701.26a) */
      : part?.kind === 'removeCounters' ? 'counter removed this way' /* edh-d-45 (CR 122.1; Hierophant Bio-Titan) */ : null;
    if (noun !== null) (st.costCountNouns ??= {})[e.name] = { plural: noun.replace('card ', 'cards ').replace('creature ', 'creatures '), singular: noun };
  }
  // r3-cost (CR 107.3, 601.2b): "X can't be greater than the greatest toughness among creatures you control"
  if (e.xMax !== undefined) {
    if (e.optional || e.repeatable) throw new NoRenderer('a largest X of an optional or repeatable additional cost');
    return `as an additional cost to cast ${self}, ${body}. x can't be greater than ${K.qty(e.xMax, st)}`;
  }
  return e.optional ? `as an additional cost to cast ${self}, you may ${body}${rep}` : `as an additional cost to cast ${self}, ${body}`;
}

/**
 * M6-5 (CR 601.2b, 118.8): "As an additional cost to cast ~, sacrifice a creature or pay {3}": the costs of one choice group in printed order, joined by "or".
 * Only a mandatory group of two or more unnamed, non-repeatable costs has these words (an optional or named grouped cost has none yet).
 */
function choiceGroupCost(group: Extract<StaticEffect, { s: 'additionalCost' }>[], st: RenderState): string {
  if (group.length < 2 || group.some((g) => g.optional || g.repeatable || g.name !== undefined)) throw new NoRenderer('an additional cost choice group that is optional, named or alone');
  const self = K.obj({ ref: 'self' }, st, 'subject').text;
  return `as an additional cost to cast ${self}, ${joinList(group.map((g) => K.costVerbs(g.cost, st, 'you')), 'or')}`;
}

function alternativeCost(e: Extract<StaticEffect, { s: 'alternativeCost' }>, st: RenderState): string {
  // FAST5X E2: the delayed part of a keyword's alternative cost (warp, CR 702.185a) has no wording of its own here: only the keyword says it
  if (e.delay !== undefined) throw new NoRenderer('an alternative cost with a delayed part outside its keyword');
  // edh-next-44 (CR 118.9, 601.3b, 702.8a; Qasali Ambusher): a free cast under a condition that may also be made at instant speed, "If C, you may cast ~ without paying its mana cost and as though it had flash"
  // (the alternative cost with `instantSpeed` and nothing else: sneak's timing is said only by its keyword)
  if (e.instantSpeed === true && e.when !== undefined && e.from === undefined && e.delay === undefined && e.entersAttacking === undefined && e.discardedThisTurn === undefined && e.tapReduces === undefined && e.exileOnLeave === undefined
    && Object.keys(e.cost).filter((k) => (e.cost as Record<string, unknown>)[k] !== undefined).length === 0) {
    return `if ${K.cond(e.when, st)}, you may cast ${K.obj({ ref: 'self' }, st, 'subject').text} without paying its mana cost and as though it had flash`;
  }
  // FAST5X E7: sneak's timing and "enters tapped and attacking" (CR 702.190a-b) have no wording of their own here: only the keyword says them
  if (e.instantSpeed !== undefined || e.entersAttacking !== undefined) throw new NoRenderer('an alternative cost with sneak timing or entry outside its keyword');
  const self = K.obj({ ref: 'self' }, st, 'subject');
  // FAST4 T32: an alternative cost of nothing is "cast ~ without paying its mana cost" (CR 118.9: it is an alternative cost; X is 0, CR 107.3b)
  const costParts = Object.keys(e.cost).filter((k) => (e.cost as Record<string, unknown>)[k] !== undefined);
  if (costParts.length === 0 && e.from === undefined) {
    const free = `you may cast ${self.text} without paying its mana cost`;
    // edh-next-143 (CR 118.9, 601.2b; Once Upon a Time; family first-spell-cast-it): the object named in the condition first, then "it" ("If this spell is the first spell you've cast this game, you may cast it without paying its mana cost")
    if (e.when?.cond === 'firstSpellCast') return alt(`if ${K.cond(e.when, st)}, ${free}`, "if ~ is the first spell you've cast this game, you may cast it without paying its mana cost");
    return e.when ? `if ${K.cond(e.when, st)}, ${free}` : free;
  }
  const body = K.costVerbs(e.cost, st, 'you');
  const poss = self.text === '~' ? "~'s" : 'its';
  const zone = e.from ? ` from ${e.from === 'graveyard' || e.from === 'hand' ? `your ${e.from}` : e.from}` : '';
  const main = e.from ? `you may cast ${self.text}${zone} by ${body.replace(/^pay /, 'paying ').replace(/ and (exile|sacrifice|discard) /g, (_m, v: string) => ` and ${v === 'exile' ? 'exiling' : v === 'sacrifice' ? 'sacrificing' : 'discarding'} `) /* edh-next-68: a graveyard alternative cost with more parts, "paying {3}{R} and exiling four other cards" */} rather than ${alt(`pay ${poss}`, `paying ${poss}`, 'paying its') /* edh-d-16: Raffine's Guidance prints "rather than paying its mana cost" */} mana cost` : `you may ${body} rather than pay ${poss} mana cost`;
  if (!e.when) return main;
  // FAST4 T32: "You may pay {B} rather than pay ~'s mana cost if there are thirteen or more creatures on the battlefield": the condition after it (CR 118.9)
  const c = K.cond(e.when, st);
  // edh-cast-14 (CR 118.9; family alternative-cost-rather-than-first, Invigorate): "If C, rather than pay ~'s mana cost, you may <cost>."
  // edh-next-68 (CR 118.9, 601.3, 614.1; Glimpse the Cosmos): "As long as you control a Giant, you may cast ~ from your graveyard by paying {U} rather than paying its mana cost.
  // If you cast ~ this way and it would be put into your graveyard, exile it instead." (family alternative-cost-as-long-as)
  if (e.from) return `${alt(`if ${c}, `, `as long as ${c}, `)}${main}${e.graveyardInstead === true ? `. if you cast ${self.text} this way and it would be put into your graveyard, exile it instead` : ''}`;
  return alt(`if ${c}, ${main}`, `${main} if ${c}`, `if ${c}, rather than pay ${poss} mana cost, you may ${body}`);
}

function pregame(e: Extract<StaticEffect, { s: 'pregame' }>, st: RenderState): string {
  const self = K.obj({ ref: 'self' }, st, 'subject').text;
  switch (e.action) {
    case 'beginOnBattlefield': {
      // edh-top-1 (Gemstone Caverns): "... and you're not the starting player, ... with a luck counter on it. If you do, exile a card from your hand"
      const when = e.notStarting ? ` and you're not the starting player` : '';
      const cs = e.counters ? ` with ${e.counters.count === 1 ? 'a' : numWord(e.counters.count)} ${e.counters.kind} counter${e.counters.count === 1 ? '' : 's'} on it` : '';
      const exile = e.exileFromHand !== undefined ? `. If you do, exile ${e.exileFromHand === 1 ? 'a card' : `${numWord(e.exileFromHand)} cards`} from your hand` : '';
      return `if ${self} is in your opening hand${when}, you ${e.optional ? 'may ' : ''}begin the game with ${alt('it', self)} on the battlefield${cs}${exile}`;
    }
    case 'reveal': {
      const base = `you ${e.optional ? 'may ' : ''}reveal ${self} from your opening hand`;
      if (e.then === undefined || e.then.length === 0) return base;
      // edhd32 (CR 103.6b): the delayed triggers a reveal creates wait for the first such step of the game: the delay's "next" is said "first" (the game has not begun)
      const first = K.steps(e.then, st).replace(/at the beginning of (the|your) next (upkeep|main phase)\b/g, (_m, who: string, step: string) => `at the beginning of ${who} first ${step}${step === 'main phase' ? ' of the game' : ''}`);
      return `${base}. if you do, ${first}`;
    }
    case 'exileBeforeShuffle': return `if ${self} is in your opening hand, you ${e.optional ? 'may ' : ''}exile it before the game begins`;
  }
}

// FAST4 T33: 'haveCountersPut' ("can't become untapped and can't have counters put on it", CR 122.6)
const SIMPLE_CANT = new Set<RuleAction>(['attack', 'block', 'beBlocked', 'untap', 'tap', 'transform', 'draw', 'gainLife', 'loseLife', 'sacrifice', 'discard', 'haveCountersPut', 'crew' /* edh-c-72 */]);
const isSimpleCant = (e: StaticEffect): e is RestrictionDef => e.s === 'restrict' && e.mode === 'cant' && e.ignoreFor === undefined /* edh-next-143 */ && e.other === undefined && e.max === undefined && e.when === undefined && e.alone !== true && SIMPLE_CANT.has(e.action);

/**
 * T55 (CR 509.1b): a plain ban on blocking creatures of a description, and the ban on being blocked by creatures of that same description, of one subject
 * ("~ can't block or be blocked by non-Spirit creatures"; statics/hooks.ts asks `block` of the blocker and `beBlockedBy` of the attacker).
 */
function blockAndBeBlockedBy(a: StaticEffect, b: StaticEffect): boolean {
  if (a.s !== 'restrict' || b.s !== 'restrict') return false;
  const plain = (r: RestrictionDef): boolean => r.mode === 'cant' && r.other !== undefined && r.max === undefined && r.when === undefined && r.alone !== true && r.exceptMana !== true && r.otherPlayer === undefined;
  return plain(a) && plain(b) && a.action === 'block' && b.action === 'beBlockedBy' && !blocksSelfOnly(a) && JSON.stringify(a.subject) === JSON.stringify(b.subject)
    && JSON.stringify(a.other) === JSON.stringify(b.other);
}

/** FAST5 T37 (CR 506.5): "can't attack alone" / "can't block alone" (a `cant` attack or block that forbids the creature only as the lone attacker or blocker). */
const isAloneBan = (e: StaticEffect): e is RestrictionDef =>
  e.s === 'restrict' && e.mode === 'cant' && e.alone === true && e.other === undefined && e.max === undefined && e.when === undefined && (e.action === 'attack' || e.action === 'block');

/** FAST3 T16: "can't attack unless C" / "can't block unless C" (an `onlyIf` combat restriction with a condition and nothing else). */
const isOnlyIfCombat = (e: StaticEffect): e is RestrictionDef & { when: NonNullable<RestrictionDef['when']> } =>
  e.s === 'restrict' && e.mode === 'onlyIf' && e.other === undefined && e.max === undefined && e.when !== undefined && (e.action === 'attack' || e.action === 'block');

/** FAST3 T16: a group of objects ("white creatures"), not one object or a player. */
const isEachGroup = (r: ObjRef | PlayerRef): boolean => r.ref === 'each' && 'filter' in r;

/**
 * FAST3 T16: the "can't" restrictions of one resolved instruction about one subject read as one sentence with the duration at its end ("Target creature can't
 * attack or block this turn", CR 611.2a, 508.1c, 509.1b). Null when the effects are not all such restrictions of one subject.
 */
export function lastingCants(effects: readonly StaticEffect[], duration: Duration, st: RenderState): string | null {
  // p2-attack-block-1 (CR 611.2a, 508.1c, 509.1b, 602.5): "Until your next turn, target creature can't attack or block, and its activated abilities can't be activated":
  // the bans of one object and, last, the ban on activating its own activated abilities (FAST1 T5's static wording, family shared-subject), for one duration
  const last = effects[effects.length - 1];
  if (effects.length >= 2 && last !== undefined && effects.slice(0, -1).every(isSimpleCant) && isOwnActivateBan(last, (effects[0] as RestrictionDef).subject, st, true)
    && (last as RestrictionDef).exceptMana === undefined) {
    const group = effects.slice(0, -1) as RestrictionDef[];
    const subject = JSON.stringify(group[0]!.subject);
    if (!group.every((g) => JSON.stringify(g.subject) === subject)) return null;
    const words = (pl: boolean): string => joinList(group.map((g) => cantWords(g.action, pl)), 'or');
    return lasting(withSubjects(group[0]!.subject, st, (sj, pl) => alt(`${sj} can't ${words(pl)}, and its activated abilities can't be activated`, `${sj} can't ${words(pl)} and its activated abilities can't be activated`)), duration, st);
  }
  // edh-d-30 (CR 611.2a, 613.1f, 508.1c, 509.1b; Immovable Rod): the loss of all abilities of one object, then plain bans of the same object, one sentence for one duration,
  // "For as long as ~ remains tapped, another target permanent loses all abilities and can't attack or block" (the resolved form of std-rx18's static wording)
  const first = effects[0];
  if (effects.length >= 3 && first !== undefined && first.s === 'continuous' && first.cda !== true && first.mods.length === 1 && JSON.stringify(first.mods[0]) === '{"layer":6,"removeAll":true}'
    && effects.slice(1).every(isSimpleCant) && effects.slice(1).every((x) => JSON.stringify((x as RestrictionDef).subject) === JSON.stringify(first.affects))) {
    const bans = effects.slice(1) as RestrictionDef[];
    return lasting(`${staticEffect(first, st)} and can't ${joinList(bans.map((b) => cantWords(b.action, false)), 'or')}`, duration, st);
  }
  if (effects.length < 2 || !effects.every(isSimpleCant)) return null;
  // p2-attack-block-1 (CR 611.2a, 509.1b): "Green creatures and white creatures can't block this turn": the same "can't" of two groups, one sentence (FAST3 T16's
  // static wording) for one duration
  const [g0, g1] = effects as RestrictionDef[];
  if (effects.length === 2 && g0!.action === g1!.action && isEachGroup(g0!.subject) && isEachGroup(g1!.subject) && JSON.stringify(g0!.subject) !== JSON.stringify(g1!.subject)) {
    const [merged, apart] = withVariants(st, [
      (v) => lasting(withSubjects(g0!.subject, v, (a) => withSubjects(g1!.subject, v, (b, pl) => `${a} and ${b} can't ${cantWords(g0!.action, pl)}`)), duration, v),
      (v) => effects.map((g) => staticEffect(g, v, { duration })).join('. '),
    ]);
    return alt(merged!, apart!);
  }
  const group = effects as RestrictionDef[];
  const subject = JSON.stringify(group[0]!.subject);
  if (!group.every((g) => JSON.stringify(g.subject) === subject)) return null;
  const [merged, apart] = withVariants(st, [
    (v) => lasting(withSubjects(group[0]!.subject, v, (sj, pl) => `${sj} can't ${group.map((g) => cantWords(g.action, pl)).join(' or ')}`), duration, v),
    (v) => group.map((g) => staticEffect(g, v, { duration })).join('. '), // the reading as separate sentences, as before
  ]);
  return alt(merged!, apart!);
}

/** edh-replace-7: a requirement ("attacks each combat if able") of one subject and nothing else. */
const plainMustIfAble = (r: StaticEffect, action: RuleAction): r is RestrictionDef => r.s === 'restrict' && r.mode === 'mustIfAble' && r.action === action && Object.keys(r).every((k) => ['s', 'subject', 'mode', 'action'].includes(k));

/**
 * std-mkm (CR 508.1d, 509.1c, 611.2a): "Target creature attacks or blocks this turn if able": the requirement to attack and the requirement to block of one subject,
 * with no other condition, for one duration said inside the sentence (in any one combat only one of them can apply: the creature attacks on its controller's turn
 * and blocks on another player's). Null for anything else.
 */
export function attackOrBlockIfAble(effects: readonly StaticEffect[], duration: Duration, st: RenderState): string | null {
  if (effects.length !== 2) return null;
  const plainMust = (r: StaticEffect | undefined, action: RuleAction): r is RestrictionDef => r !== undefined && r.s === 'restrict' && r.mode === 'mustIfAble' && r.action === action
    && Object.keys(r).every((k) => ['s', 'subject', 'mode', 'action'].includes(k));
  const [a, b] = effects;
  if (!plainMust(a, 'attack') || !plainMust(b, 'block') || JSON.stringify(a.subject) !== JSON.stringify(b.subject)) return null;
  const inside = inlineDuration(duration);
  if (inside === null) return null;
  return withSubjects(a.subject, st, (sj, pl) => `${sj} ${pl ? 'attack or block' : 'attacks or blocks'} ${inside} if able`);
}

/**
 * FAST5 T57 (CR 615.12, 101.2): "Damage can't be prevented this turn" is two restrictions, one on every permanent and one on every player (the damage's recipients,
 * effects/propose.ts#unpreventableIfRuled), nothing else on them. True for exactly that pair.
 */
export function damageUnpreventable(effects: readonly StaticEffect[], action: 'preventDamage' | 'preventCombatDamage' = 'preventDamage', sources = false): boolean {
  if (effects.length !== 2) return false;
  // Cloud r5-repl: with `sources`, both restrictions name the same sources of the damage ("combat damage that would be dealt by creatures you control")
  const otherOk = (r: RestrictionDef): boolean => (sources ? r.other !== undefined && JSON.stringify(r.other) === JSON.stringify((effects[0] as RestrictionDef).other) : r.other === undefined);
  const bare = (r: StaticEffect): r is RestrictionDef =>
    r.s === 'restrict' && r.mode === 'cant' && r.action === action && otherOk(r) && r.when === undefined && r.max === undefined && r.min === undefined
    && r.alone === undefined && r.otherPlayer === undefined && r.exceptMana === undefined;
  const [a, b] = effects;
  if (!bare(a!) || !bare(b!)) return false;
  const everyPermanent = a.subject.ref === 'each' && 'filter' in a.subject && Object.values(a.subject.filter).every((v) => v === undefined);
  const everyPlayer = b.subject.ref === 'each' && 'who' in b.subject && b.subject.who === 'player';
  return everyPermanent && everyPlayer;
}

/** FAST5 T57: the sentence of `damageUnpreventable` with its duration ("damage can't be prevented this turn"). */
export function damageUnpreventableText(duration: Duration | undefined, st: RenderState, combat = false): string {
  return lasting(`${combat ? 'combat ' : ''}damage can't be prevented`, duration, st); // r5-repl: "combat damage" (CR 615.12, 510.2)
}

/**
 * The effects of one static ability as text. Consecutive "can't" restrictions of the same subject read as one sentence ("Enchanted creature can't attack or
 * block"), or as separate ones; everything else is a sentence of its own.
 */
export function staticEffects(effects: StaticEffect[], st: RenderState): string {
  // edh-next-136 (CR 701.9a, 701.21a, 109.5; Tamiyo, Collector of Tales; sta.edhn136.cantCauseDiscardOrSacrifice.opponents): the discard and the sacrifice an opponent's spell or ability would make you do, one sentence
  if (JSON.stringify(effects) === '[{"s":"restrict","subject":{"ref":"you"},"mode":"cant","action":"discard","causedByOpponents":true},{"s":"restrict","subject":{"ref":"you"},"mode":"cant","action":"sacrifice","causedByOpponents":true}]') {
    return `spells and abilities ${alt('your opponents control', 'each opponent controls')} can't cause you to discard cards or sacrifice permanents`; // (family each-opponent-controls-discard-sacrifice)
  }
  const paper = lastChosenNameAndTypeText(effects, st); // edh-next-146 (Psychic Paper)
  if (paper !== null) return paper;
  // edh-c-45 (CR 601.2f, 118.7, 604.5; Assassin's Ink): "~ costs {1} less to cast if you control an artifact and {1} less to cast if you control an enchantment": two own reductions, each once if its condition holds
  const twoIfs = twoSelfReductionsText(effects, st);
  if (twoIfs !== null) return twoIfs;
  const sacAndOther = additionalSacrificeAndOtherText(effects, st); // edh-d-45 (Dargo)
  if (sacAndOther !== null) return sacAndOther;
  // edh-next-58 (CR 601.2f, 602.2b, 605.1a; Tithe Taker): "spells your opponents cast cost {1} more to cast and abilities your opponents activate cost {1} more to activate unless they're mana
  // abilities": the increase of the spells an opponent casts and of the abilities an opponent activates that are not mana abilities, one sentence (under "during your turn")
  if (effects.length === 2 && effects.every((e) => e.s === 'costMod')) {
    const [a, b] = effects as [Extract<StaticEffect, { s: 'costMod' }>, Extract<StaticEffect, { s: 'costMod' }>];
    const plain = (x: typeof a): boolean => x.change.kind === 'increase' && x.applies.caster === 'opponent' && x.change.generic === undefined && x.change.times === undefined && x.change.life === undefined && x.change.floor === undefined && x.change.coloredOnly === undefined && (x.change.mana?.length ?? 0) > 0;
    if (plain(a) && plain(b) && a.applies.spells !== undefined && Object.keys(a.applies.spells).length === 0 && a.applies.self === undefined && a.applies.abilities === undefined
      && JSON.stringify(b.applies.abilities) === '{"exceptMana":true}' && b.applies.spells === undefined && b.applies.self === undefined) {
      return `spells your opponents cast cost ${formatManaCost(a.change.mana!)} more to cast and abilities your opponents activate cost ${formatManaCost(b.change.mana!)} more to activate unless they're mana abilities`;
    }
  }
  // edh-d-46 (CR 205.4a, 613.1d; Rootpath Purifier): "Lands you control and land cards in your library are basic.": the same supertype gained by two groups, one sentence (the apart reading is the two sentences)
  if (effects.length === 2 && effects.every((e) => e.s === 'continuous' && isEachGroup(e.affects) && JSON.stringify(e.mods) === '[{"layer":4,"supertypes":{"add":["Basic"]}}]') && JSON.stringify(effects[0]) !== JSON.stringify(effects[1])) {
    const [g0, g1] = effects as [Extract<StaticEffect, { s: 'continuous' }>, Extract<StaticEffect, { s: 'continuous' }>];
    const [merged, apart] = withVariants(st, [
      (v) => withSubjects(g0.affects, v, (a) => withSubjects(g1.affects, v, (b) => `${a} and ${b} are basic`)),
      (v) => effects.map((g) => staticEffect(g, v)).join('. '),
    ]);
    return alt(merged!, apart!);
  }
  // std-rx27 (CR 305.2, 601.3, 110.4a): "you may play a land and cast a permanent spell of each permanent type from your graveyard" (each once each turn)
  if (eachPermanentTypeFromGraveyard(effects)) return 'you may play a land and cast a permanent spell of each permanent type from your graveyard';
  // edh-d-91 (CR 305.1, 601.3, 404.1, 400.7; Coram, the Undertaker): "you may play a land and cast a spell from among cards in graveyards that were put there from libraries this turn": a land play
  // and a cast, once each turn each, from any graveyard, of the cards a library put there this turn (statics/play-permits.ts#isAnyGraveyardFromLibraryPermit), all of you and nothing else
  if (JSON.stringify(effects) === JSON.stringify([
    { s: 'permit', who: { ref: 'you' }, action: 'play', of: { types: ['Land'], putThereThisTurn: true, putThereFrom: 'library' }, from: 'graveyard', oncePerTurn: true, anyGraveyard: true },
    { s: 'permit', who: { ref: 'you' }, action: 'cast', of: { putThereThisTurn: true, putThereFrom: 'library' }, from: 'graveyard', oncePerTurn: true, anyGraveyard: true },
  ])) return 'you may play a land and cast a spell from among cards in graveyards that were put there from libraries this turn';
  // pc-exile-play-1 (CR 601.3, 113.6b; Squee, the Immortal): "You may cast this card from your graveyard or from exile": the two permissions for the card itself, one for each zone
  if (effects.length === 2 && effects.every((e) => e.s === 'permit' && e.action === 'cast' && JSON.stringify(e.who) === '{"ref":"you"}' && JSON.stringify(e.of) === '{"self":true}' && Object.keys(e).length === 5)
    && (effects[0] as { from?: string }).from === 'graveyard' && (effects[1] as { from?: string }).from === 'exile') {
    return `you may cast ${K.obj({ ref: 'self' }, st, 'object').text} from ${alt('your graveyard or from exile', 'exile or from your graveyard')}`; // either order of the two zones (family cast-self-graveyard-or-exile)
  }
  // edh-next-68 (CR 601.3, 113.6b; Haakon, Stromgald Scourge): "You may cast ~ from your graveyard, but not from anywhere else."
  if (JSON.stringify(effects) === '[{"s":"permit","who":{"ref":"you"},"action":"cast","of":{"self":true},"from":"graveyard"},{"s":"restrict","subject":{"ref":"each","who":"player"},"mode":"cant","action":"castFromZone","fromZones":["hand","library","exile","command"],"other":{"self":true}}]') return `you may cast ${K.obj({ ref: 'self' }, st, 'object').text} from your graveyard, but not from anywhere else`;
  // edh-next-17 (CR 305.1, 601.3, 101.2; Experimental Frenzy): "You can't play lands or cast spells from your hand": the player's two bans, the land plays and the casts from a hand
  if (effects.length >= 2) {
    const [a, b] = effects as [RestrictionDef, RestrictionDef];
    if (a.s === 'restrict' && b.s === 'restrict' && JSON.stringify(a) === '{"s":"restrict","subject":{"ref":"you"},"mode":"cant","action":"playLand","other":{"zone":"hand"}}'
      && JSON.stringify(b) === '{"s":"restrict","subject":{"ref":"you"},"mode":"cant","action":"castFromZone","fromZones":["hand"]}') {
      const pair = "you can't play lands or cast spells from your hand";
      return effects.length === 2 ? pair : `${pair}. ${staticEffects(effects.slice(2), st)}`;
    }
  }
  // edh-next-17 (CR 601.3, 601.2i, 101.2; Fires of Invention): "You can cast spells only during your turn and you can cast no more than two spells each turn": the two cast restrictions of
  // the controller, one sentence (the plain reading is the two sentences "You can't cast spells unless it's your turn. You can't cast more than two spells each turn.")
  if (effects.length >= 2) {
    const [a, b] = effects as [RestrictionDef, RestrictionDef];
    if (a.s === 'restrict' && b.s === 'restrict' && JSON.stringify(a) === '{"s":"restrict","subject":{"ref":"you"},"mode":"onlyIf","action":"cast","when":{"cond":"turnOf","whose":"you"}}'
      && b.mode === 'cant' && b.action === 'cast' && typeof b.max === 'number' && b.max >= 2 && JSON.stringify(b) === `{"s":"restrict","subject":{"ref":"you"},"mode":"cant","action":"cast","max":${b.max}}`) {
      const pair = `you can cast spells only during your turn and you can cast no more than ${b.max} spells each turn`;
      return effects.length === 2 ? pair : `${pair}. ${staticEffects(effects.slice(2), st)}`; // the effects of the next sentence of the same paragraph follow
    }
  }
  // edh-next-62 (CR 607.2a, 406.3, 400.2; Colfenor's Plans, Kheru Mind-Eater): "You may look at the cards exiled with ~, and you may play lands and cast spells from among those cards"
  const lookLinked = linkedLookText(effects, st);
  if (lookLinked !== null) return lookLinked;
  // edh-next-62 (CR 607.2a, 609.4b, 107.4c, 601.3; Rogue Class level 3): "You may play cards exiled with ~, and you may spend mana as though it were mana of any color to cast those spells"
  // edh-next-137 (CR 607.2a, 114.2; Tibalt, Cosmic Impostor's emblem): or with the cards described in exile (`zone: 'exile'`: the reading of a face whose several abilities exile, parse.ts#linkExiled)
  if (effects.length === 1 && (JSON.stringify(effects[0]) === '{"s":"permit","who":{"ref":"you"},"action":"play","of":{"is":{"ref":"linked","link":"exiled"}},"anyManaColor":true}'
    || JSON.stringify(effects[0]) === '{"s":"permit","who":{"ref":"you"},"action":"play","of":{"is":{"ref":"linked","link":"exiled"},"zone":"exile"},"anyManaColor":true}')) {
    const self = K.obj({ ref: 'self' }, st, 'object').text;
    // edh-d-96 (CR 607.2a, 609.4b, 107.4c, 305.1; Intellect Devourer; families cast-this-way-any-color, play-lands-and-cast-spells): also "You may play lands and cast spells from among cards exiled with ~. If you cast a spell
    // this way, you may spend mana as though it were mana of any color to cast it." (template sta.edhd96.play.linked.anyColor)
    return alt(`you may play cards exiled with ${self}, and you may spend mana as though it were mana of any color to cast those spells`,
      ...[`play cards exiled with ${self}`, `play lands and cast spells from among cards exiled with ${self}`].map((p) => `you may ${p}. if you cast a spell this way, you may spend mana as though it were mana of any color to cast it`));
  }
  // std-rx27 (CR 607.2a, 601.3, 601.3e, 702.8a, 609.4b, 118.9, 614.1c): the static linked cast permissions with riders (statics/play-permits.ts#isLinkedRiderPermit)
  const linked = linkedPermitsText(effects, st);
  if (linked !== null) return linked;
  // std-rx27 (CR 601.3, 305.1, 609.4b): "you may play cards you don't own with stash counters on them from exile, and mana of any type can be spent to cast those
  // spells" (statics/play-permits.ts#isExileFilterPermit): the cards are described as they are in exile
  const ex = effects.length === 1 ? effects[0] : undefined;
  if (ex?.s === 'permit' && (ex.action === 'play' || ex.action === 'cast') && ex.from === 'exile' && ex.of !== undefined && ex.of.is === undefined && ex.of.zone === undefined
    && Object.keys(ex).every((k) => ['s', 'who', 'action', 'from', 'of', 'anyManaType'].includes(k)) && JSON.stringify(ex.who) === '{"ref":"you"}') {
    // trek-7 (CR 113.6, 601.3; Khan, Vengeful Heart): "You may cast this card from exile": the card itself, where it is (`of` exactly `{self: true}`)
    if (ex.of.self !== undefined) {
      if (ex.of.self !== true || Object.keys(ex.of).filter((k) => (ex.of as Record<string, unknown>)[k] !== undefined).length !== 1 || ex.anyManaType !== undefined) throw new NoRenderer('a permission for the card itself in exile with something more');
      return `you may ${ex.action} ${K.obj({ ref: 'self' }, st, 'object').text} from exile`;
    }
    // edh-next-73 (CR 601.3, 305.1, 122.1; Grolnok, the Omnivore): "You may play lands and cast spells from among cards you own in exile with croak counters on them." (the description is the cards you own in
    // exile with counters of one kind; no rider): the generic description below leaves out the owner
    const ofRec = ex.of as Record<string, unknown>;
    const counters = ofRec['counters'] as { kind?: unknown; cmp?: unknown } | undefined;
    if (ex.action === 'play' && ex.anyManaType === undefined && ofRec['owner'] === 'you' && ofRec['isCard'] === true && counters !== undefined && typeof counters.kind === 'string' && counters.cmp === undefined
      && Object.keys(ofRec).filter((k) => ofRec[k] !== undefined).length === 3) return `you may play lands and cast spells from among cards you own in exile with ${counters.kind} counters on them`;
    const cards = K.np({ ...ex.of, zone: 'exile' }, st, { det: 'none', plural: true, noZone: true });
    return `you may ${ex.action} ${cards} from exile${ex.anyManaType === true ? ', and mana of any type can be spent to cast those spells' : ''}`;
  }
  // FAST4 T32: "During your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments" (CR 601.3, 602.5, 109.2)
  if (yourTurnCastActivate(effects)) return yourTurnCastActivateText(effects[1] as RestrictionDef, st);
  // edh-next-18 (CR 118.3, 119.4, 701.21a; Angel of Jubilation, Yasharn): "Players can't pay life or sacrifice creatures to cast spells or activate abilities."
  if (payLifeSacrificeForCosts(effects)) {
    const sac = effects[1] as RestrictionDef;
    const group = JSON.stringify(sac.subject) === '{"ref":"each","who":"opponent"}' ? 'your opponents' : 'players'; // the plural group (family players-plural)
    return `${group} can't pay life or sacrifice ${K.np(sac.other!, st, { det: 'none', plural: true })} to cast spells or activate abilities`;
  }
  // edh-d-3 (CR 118.3, 119.4, 605.1a; Karn's Sylex): "Players can't pay life to cast spells or to activate abilities that aren't mana abilities."
  if (payLifeForCostsNonMana(effects)) return alt("players can't pay life to cast spells or to activate abilities that aren't mana abilities", "each player can't pay life to cast spells or to activate abilities that aren't mana abilities" /* family each-player-cant-pay-life-costs */);
  // std-rx1 (CR 601.3, 602.5, 605.1a, 506.1): "During combat, players can't cast spells or activate abilities that aren't mana abilities" (Yuriko, Blade of the Mighty)
  if (combatCastActivateNonMana(effects)) return combatCastActivateNonManaText(effects[0] as RestrictionDef);
  // cloud std-spm (CR 615.12): the static ability "Damage can't be prevented." (Leyline of Punishment, Spider-Punk): the pair of FAST5 T57, for as long as the source is there
  if (damageUnpreventable(effects)) return "damage can't be prevented";
  // edh-cast-12 (CR 101.2, 615.12; Banefire): "~ can't be countered and the damage can't be prevented": the spell itself can't be countered and the pair of unpreventable
  // damage, both restrictions naming the damage the spell itself deals (`other` exactly the source)
  if (effects.length === 3 && effects[0]!.s === 'restrict' && effects[0]!.mode === 'cant' && effects[0]!.action === 'beCountered' && effects[0]!.subject.ref === 'self' && Object.keys(effects[0]!).length === 4
    && damageUnpreventable(effects.slice(1), 'preventDamage', true) && JSON.stringify((effects[1] as RestrictionDef).other) === '{"self":true}') {
    return `${staticEffectsApart([effects[0]!], st)} and the damage can't be prevented`;
  }
  // edh-c-16 (CR 509.1c, 613.1f, 303.4; Indrik Umbra): "Enchanted creature gets +4/+4 and has first strike, and all creatures able to block it do so.": the enchanted creature's change and the lure naming it, one sentence
  if (effects.length === 2 && effects[0]!.s === 'continuous' && JSON.stringify(effects[0]!.affects) === '{"ref":"attachedTo"}' && effects[0]!.mods.some((m) => m.layer === 6 && m.add !== undefined) /* with a keyword the sentence takes a comma; edh-c-9's pump-only lure says "and" */ && effects[1]!.s === 'restrict' && effects[1]!.mode === 'mustIfAble' && effects[1]!.action === 'block'
    && JSON.stringify(effects[1]!.other) === '{"is":{"ref":"attachedTo"}}' && JSON.stringify(effects[1]!.subject) === '{"ref":"each","filter":{"types":["Creature"]}}' && Object.keys(effects[1]!).length === 5) {
    return `${staticEffectsApart([effects[0]!], st)}, and all creatures able to block it do so`;
  }
  // edh-b-2 (CR 609.4, 702.3b, 613.1f; Colossus of Akros): "it has trample and can attack as though it didn't have defender": the object's own abilities and the permission, one sentence
  if (effects.length === 2 && effects[0]!.s === 'continuous' && effects[1]!.s === 'permit' && effects[1]!.action === 'attackAsThoughNoDefender' && JSON.stringify(effects[1]!.who) === '{"ref":"you"}'
    && Object.keys(effects[1]!).length === 3 && JSON.stringify(effects[0]!.affects) === '{"ref":"self"}' && effects[0]!.mods.length === 1 && effects[0]!.mods[0]!.layer === 6 && effects[0]!.mods[0]!.add !== undefined) {
    return `${staticEffectsApart([effects[0]!], st)} and can attack as though it didn't have defender`;
  }
  // edh-c-23 (CR 702.11b-c, 115.1, 604.1; Gruul Spellbreaker): "you and ~ have hexproof": the player's hexproof (rst.t15.you.hexproof) and the object's own keyword, nothing else
  if (effects.length === 2 && JSON.stringify(effects[0]) === '{"s":"restrict","subject":{"ref":"you"},"mode":"cant","action":"beTargeted","other":{"controller":"opponent"}}' && effects[1]!.s === 'continuous'
    && JSON.stringify(effects[1]!.affects) === '{"ref":"self"}' && effects[1]!.mods.length === 1 && effects[1]!.mods[0]!.layer === 6 && JSON.stringify(Object.keys(effects[1]!.mods[0]!)) === '["layer","add"]'
    && JSON.stringify(effects[1]!.mods[0]!.add) === '[{"kind":"keyword","keyword":"hexproof","text":"hexproof"}]') {
    return `you and ${K.obj({ ref: 'self' }, st, 'object').text} have hexproof`;
  }
  // edh-c-43 (CR 609.4, 702.3b, 613.4c; Spire Serpent): "~ gets +2/+2 and can attack as though it didn't have defender": a power and toughness change of the object itself and the permission, one sentence
  if (effects.length === 2 && effects[0]!.s === 'continuous' && effects[1]!.s === 'permit' && effects[1]!.action === 'attackAsThoughNoDefender' && JSON.stringify(effects[1]!.who) === '{"ref":"you"}'
    && Object.keys(effects[1]!).length === 3 && JSON.stringify(effects[0]!.affects) === '{"ref":"self"}' && effects[0]!.mods.length === 1 && effects[0]!.mods[0]!.layer === '7c' && Object.keys(effects[0]!).length === 3) {
    return `${staticEffectsApart([effects[0]!], st)} and can attack as though it didn't have defender`;
  }
  if (protectionFromOpponents(effects)) return 'you have protection from each of your opponents'; // r5-static (CR 702.16b-e, unverified 702.16k)
  const chosenTypeGroup = youAndObjsProtectionFromChosenType(effects);
  if (chosenTypeGroup !== null) return `you and ${K.np(chosenTypeGroup, st, { det: 'none', plural: true })} have protection from the chosen card type`; // edht4 (Serra's Emissary)
  const protGroup = youAndObjsProtectionFrom(effects);
  if (protGroup !== null) return `you and ${K.np(protGroup.group, st, { det: 'none', plural: true })} have ${protGroup.text}`; // edh-d-5 (Gor Muldrak, Amphinologist)
  // edh-c-42 (CR 615.12, 101.2; Excruciator): "Damage that would be dealt by ~ can't be prevented.": the pair with the damage's source the object itself (`other` exactly the source)
  if (damageUnpreventable(effects, 'preventDamage', true) && JSON.stringify((effects[0] as RestrictionDef).other) === '{"self":true}') return "damage that would be dealt by ~ can't be prevented";
  if (youProtectionFromChosenName(effects)) return 'you have protection from the chosen card name'; // edh-c-92 (Runed Halo)
  // edh-next-122 (CR 701.21a, 406.1, 603.1; The Master, Multiplied; sta.edhn122.triggered.cantCause.sacrificeOrExile): the two bans of what your own triggered abilities can cause
  const ownTriggered = ownTriggeredSacrificeOrExile(effects);
  if (ownTriggered !== null) return `triggered abilities you control can't cause you to sacrifice or exile ${K.np(ownTriggered, st, { det: 'none', plural: true })}`;
  // r5-repl (CR 615.12, 510.2): "Combat damage can't be prevented." (Frenzied Baloth): the same pair, of combat damage only
  if (damageUnpreventable(effects, 'preventCombatDamage')) return "combat damage can't be prevented";
  // r5-repl (CR 615.12, 510.2): "Combat damage that would be dealt by creatures you control can't be prevented." (Questing Beast): the pair with the damage's sources
  if (damageUnpreventable(effects, 'preventCombatDamage', true)) {
    return `combat damage that would be dealt by ${K.np((effects[0] as RestrictionDef).other!, st, { det: 'none', plural: true })} can't be prevented`;
  }
  // std-rx32 (CR 702.11b, 702.21a): "Creatures your opponents control can be the targets of spells and abilities as though they didn't have hexproof. Ward abilities
  // of those creatures don't trigger." (Nowhere to Run): the second sentence names the first one's permanents again
  const [h, w] = effects;
  if (effects.length === 2 && h?.s === 'rule' && h.rule === 'targetableThroughHexproof' && h.of !== undefined && w?.s === 'triggerMod' && w.suppress === true && w.keyword === 'ward'
    && w.cause === undefined && w.additional === 0 && JSON.stringify(w.abilitiesOf) === JSON.stringify(h.of) && (h.of.types === undefined ? h.of.allTypes?.includes('Creature') === true : h.of.types.length === 1 && h.of.types[0] === 'Creature')) {
    return `${staticEffectsApart([h], st)}. ward abilities of those creatures don't trigger`;
  }
  // p2-misc-1 (CR 603.2, 603.6a, 603.10a): "Creatures entering or dying don't cause abilities to trigger" (Hushbringer): the suppression of the same permanents
  // entering and dying, every ability, nothing else
  const plainSuppress = (x: StaticEffect | undefined): x is TriggerModDef => x?.s === 'triggerMod' && x.suppress === true && x.keyword === undefined && x.additional === 0
    && Object.keys(x.abilitiesOf).length === 0 && x.cause?.ev === 'zoneChange';
  if (effects.length === 2 && plainSuppress(h) && plainSuppress(w)) {
    const a = h.cause as { ev: string; from?: string; to?: string; subject?: ObjectFilter };
    const b = w.cause as { ev: string; from?: string; to?: string; subject?: ObjectFilter };
    if (Object.keys(a).length === 3 && a.to === 'battlefield' && a.subject !== undefined && Object.keys(b).length === 4 && b.from === 'battlefield' && b.to === 'graveyard'
      && JSON.stringify(a.subject) === JSON.stringify(b.subject)) {
      return `${K.np(a.subject, st, { det: 'none', plural: true })} entering or dying don't cause abilities to trigger`;
    }
  }
  return staticEffectsApart(effects, st);
}

/**
 * r5-static (CR 702.16b-e; the player's protection, unverified 702.16k): "You have protection from each of your opponents" (Absolute Virtue's reminder: "You can't
 * be dealt damage, enchanted, or targeted by anything controlled by your opponents"): exactly the three restrictions of the player "you" that the template
 * builds, each about objects your opponents control.
 */
function protectionFromOpponents(effects: readonly StaticEffect[]): boolean {
  if (effects.length !== 3) return false;
  const want = ['beEnchanted', 'beTargeted', 'receiveDamage'];
  const got = effects.map((e) => (e.s === 'restrict' && e.mode === 'cant' && JSON.stringify(e.subject) === '{"ref":"you"}' && JSON.stringify(e.other) === '{"controller":"opponent"}'
    && Object.keys(e).length === 5 ? e.action : '')).sort();
  return JSON.stringify(got) === JSON.stringify(want);
}

/**
 * edht4 (CR 702.16a-e, 607.2d; Serra's Emissary, sta.edht4.youAndObjs.protection.chosenCardType): "You and creatures you control have protection from the chosen card type":
 * the player's three restrictions about sources of the chosen card type (damage, targeting, enchanting) and one grant of the keyword (quality `chosen:cardType`) to a group.
 * The group's filter, else null.
 */
function youAndObjsProtectionFromChosenType(effects: readonly StaticEffect[]): ObjectFilter | null {
  if (effects.length !== 4) return null;
  const want = JSON.stringify({ chosen: { link: 'cardType', quality: 'cardType' } });
  const actions = effects.slice(0, 3).map((e) => (e.s === 'restrict' && e.mode === 'cant' && JSON.stringify(e.subject) === '{"ref":"you"}' && JSON.stringify(e.other) === want
    && Object.keys(e).length === 5 ? e.action : '')).sort();
  if (JSON.stringify(actions) !== JSON.stringify(['beEnchanted', 'beTargeted', 'receiveDamage'])) return null;
  const c = effects[3]!;
  if (c.s !== 'continuous' || c.cda === true || c.affects.ref !== 'each' || !('filter' in c.affects) || !isPlainGrant(c) || Object.keys(c).some((k) => !['s', 'affects', 'mods'].includes(k))) return null;
  const add = (c.mods[0] as { add: unknown[] }).add;
  const k = add[0] as Record<string, unknown>;
  if (add.length !== 1 || k['kind'] !== 'keyword' || k['keyword'] !== 'protection' || k['quality'] !== 'chosen:cardType' || Object.keys(k).some((x) => !['kind', 'keyword', 'quality', 'text'].includes(x))) return null;
  return c.affects.filter;
}

/**
 * edh-d-5 (CR 702.16a-e, 702.16j, 604.1; Gor Muldrak, Amphinologist, sta.edhd5.youAndObjs.have.protectionFrom): "You and permanents you control have protection from Salamanders": the
 * player's three restrictions about sources of one description (a color, a card type or a creature type: damage, targeting, enchanting) and one grant of the matching keyword to a group.
 * The group and the keyword's words, else null.
 */
function youAndObjsProtectionFrom(effects: readonly StaticEffect[]): { group: ObjectFilter; text: string } | null {
  if (effects.length !== 4) return null;
  const [r, t, e] = effects as [StaticEffect, StaticEffect, StaticEffect];
  if (t.s !== 'restrict' || t.other === undefined) return null;
  const want = JSON.stringify(t.other);
  const prevent = JSON.stringify({ s: 'replace', replaces: { ev: 'damage', source: t.other, recipient: { player: 'you' } }, body: { b: 'prevent', amount: 'all' } });
  const ban = (x: StaticEffect, action: string): boolean => x.s === 'restrict' && x.mode === 'cant' && JSON.stringify(x.subject) === '{"ref":"you"}' && JSON.stringify(x.other) === want && Object.keys(x).length === 5 && x.action === action;
  if (JSON.stringify(r) !== prevent || !ban(t, 'beTargeted') || !ban(e, 'beEnchanted')) return null;
  const first = t;
  const c = effects[3]!;
  if (c.s !== 'continuous' || c.cda === true || c.affects.ref !== 'each' || !('filter' in c.affects) || !isPlainGrant(c) || Object.keys(c).some((k) => !['s', 'affects', 'mods'].includes(k))) return null;
  const add = (c.mods[0] as { add: unknown[] }).add;
  const k = add[0] as Record<string, unknown>;
  if (add.length !== 1 || k['kind'] !== 'keyword' || k['keyword'] !== 'protection' || typeof k['quality'] !== 'string' || typeof k['text'] !== 'string' || Object.keys(k).some((x) => !['kind', 'keyword', 'quality', 'text'].includes(x))) return null;
  // the restrictions must be exactly the description of the keyword's quality (a color, a card type, a creature type, a creature of a type)
  const quality = k['quality'];
  const f = first.other as Record<string, unknown>;
  const fq = Array.isArray(f['colors']) && Object.keys(f).length === 1 ? `color:${(f['colors'] as string[])[0]}`
    : Array.isArray(f['types']) && Object.keys(f).length === 1 && (f['types'] as string[]).length === 1 ? `type:${(f['types'] as string[])[0]}`
      : Array.isArray(f['subtypes']) && Object.keys(f).length === 1 && (f['subtypes'] as string[]).length === 1 ? `subtype:${(f['subtypes'] as string[])[0]!.toLowerCase()}s`
        : Array.isArray(f['subtypes']) && Array.isArray(f['types']) && Object.keys(f).length === 2 ? `type:Creature&subtype:${(f['subtypes'] as string[])[0]!.toLowerCase()}s` : '';
  if (fq === '' || fq !== quality) return null;
  return { group: c.affects.filter, text: k['text'].replace(/^protection from /, 'protection from ') };
}

/**
 * edh-next-122 (CR 701.21a, 406.1, 603.1, 113.3c; The Master, Multiplied): "Triggered abilities you control can't cause you to sacrifice or exile creature tokens you control": exactly a `cant`
 * sacrifice restriction of "you" with the group as `other` and a `cant` beExiled restriction of that group, both `causedByOwnTriggered` and nothing else. The group's filter, else null.
 */
function ownTriggeredSacrificeOrExile(effects: readonly StaticEffect[]): ObjectFilter | null {
  if (effects.length !== 2) return null;
  const [a, b] = effects as [StaticEffect, StaticEffect];
  if (a.s !== 'restrict' || b.s !== 'restrict' || a.other === undefined) return null;
  const want = { s: 'restrict', subject: { ref: 'you' }, mode: 'cant', action: 'sacrifice', other: a.other, causedByOwnTriggered: true };
  const wantB = { s: 'restrict', subject: { ref: 'each', filter: a.other }, mode: 'cant', action: 'beExiled', causedByOwnTriggered: true };
  return JSON.stringify(a) === JSON.stringify(want) && JSON.stringify(b) === JSON.stringify(wantB) ? a.other : null;
}

/**
 * edh-c-92 (CR 702.16a-e, 201.2, 607.2d; Runed Halo, sta.edhv92.you.protection.chosenCardName): "You have protection from the chosen card name": the player's three
 * restrictions about sources with the chosen name (damage, targeting, enchanting), nothing else.
 */
function youProtectionFromChosenName(effects: readonly StaticEffect[]): boolean {
  if (effects.length !== 3) return false;
  const want = JSON.stringify({ chosen: { link: 'cardName', quality: 'cardName' } });
  const actions = effects.map((e) => (e.s === 'restrict' && e.mode === 'cant' && JSON.stringify(e.subject) === '{"ref":"you"}' && JSON.stringify(e.other) === want
    && Object.keys(e).length === 5 ? e.action : '')).sort();
  return JSON.stringify(actions) === JSON.stringify(['beEnchanted', 'beTargeted', 'receiveDamage']);
}

/**
 * FAST4 T32: a "can't cast spells" restriction and a "can't activate abilities of [permanents]" restriction of the same players, both only during your turn
 * (zz-fast4/t32.json, rst.t32.yourTurn.opponents.castActivate). The objects are permanents on the battlefield (CR 109.2: "artifacts" without "card" or
 * "spell"), so the second one's `other` says `zone: 'battlefield'`; nothing else in it but card types.
 */
function yourTurnCastActivate(effects: readonly StaticEffect[]): boolean {
  if (effects.length !== 2) return false;
  const [a, b] = effects;
  const yourTurn = (r: RestrictionDef): boolean => r.when?.cond === 'turnOf' && r.when.whose === 'you' && r.when.step === undefined;
  if (a?.s !== 'restrict' || b?.s !== 'restrict') return false;
  if (a.mode !== 'cant' || a.action !== 'cast' || a.other !== undefined || a.max !== undefined || !yourTurn(a)) return false;
  if (b.mode !== 'cant' || b.action !== 'activate' || b.max !== undefined || !yourTurn(b) || b.other === undefined) return false;
  const keys = Object.keys(b.other).filter((k) => (b.other as Record<string, unknown>)[k] !== undefined).sort();
  return JSON.stringify(keys) === '["types","zone"]' && b.other.zone === 'battlefield' && JSON.stringify(a.subject) === JSON.stringify(b.subject)
    && a.subject.ref === 'each' && 'who' in a.subject && a.subject.who === 'opponent';
}

function yourTurnCastActivateText(b: RestrictionDef, st: RenderState): string {
  const { zone: _zone, ...perms } = b.other!;
  return `during your turn, your opponents can't cast spells or activate abilities of ${K.np(perms, st, { det: 'none', plural: true })}`;
}

/** edh-next-18: a ban for every player on paying life, then one on sacrificing the permanents `other` describes, both only as a cost of casting a spell or activating an ability (`forCosts`), nothing else in either. */
function payLifeSacrificeForCosts(effects: readonly StaticEffect[]): boolean {
  if (effects.length !== 2) return false;
  const [a, b] = effects;
  if (a?.s !== 'restrict' || b?.s !== 'restrict') return false;
  const plain = (r: RestrictionDef, keys: string[]): boolean => Object.keys(r).filter((k) => (r as unknown as Record<string, unknown>)[k] !== undefined).sort().join(',') === keys.sort().join(',');
  return a.mode === 'cant' && a.action === 'payLife' && a.forCosts === true && plain(a, ['s', 'subject', 'mode', 'action', 'forCosts'])
    && b.mode === 'cant' && b.action === 'sacrifice' && b.forCosts === true && b.other !== undefined && plain(b, ['s', 'subject', 'mode', 'action', 'other', 'forCosts'])
    && JSON.stringify(a.subject) === '{"ref":"each","who":"player"}' && JSON.stringify(a.subject) === JSON.stringify(b.subject);
}

/** edh-d-3: one ban for every player on paying life as a cost of casting a spell or activating an ability that is not a mana ability (`forCosts`, `exceptMana`), nothing else in it. */
function payLifeForCostsNonMana(effects: readonly StaticEffect[]): boolean {
  const [a] = effects;
  if (effects.length !== 1 || a?.s !== 'restrict') return false;
  return a.mode === 'cant' && a.action === 'payLife' && a.forCosts === true && a.exceptMana === true && JSON.stringify(a.subject) === '{"ref":"each","who":"player"}'
    && Object.keys(a).filter((k) => (a as unknown as Record<string, unknown>)[k] !== undefined).sort().join(',') === 'action,exceptMana,forCosts,mode,s,subject';
}

/**
 * std-rx1: a "can't cast spells" restriction and a "can't activate abilities" restriction that spares mana abilities (`exceptMana`, CR 605.1a) of the same
 * players, both only during combat (every step of the combat phase of any turn, CR 506.1; zz-cloud/std-rx1.json). statics/hooks.ts#canActivate asks the
 * second one with the activating player as the subject. Nothing else in either restriction.
 */
function combatCastActivateNonMana(effects: readonly StaticEffect[]): boolean {
  if (effects.length !== 2) return false;
  const [a, b] = effects;
  if (a?.s !== 'restrict' || b?.s !== 'restrict') return false;
  const combat = (r: RestrictionDef): boolean => r.when?.cond === 'turnOf' && r.when.whose === 'any' && Array.isArray(r.when.step)
    && CAST_SELF_ONLY_STEPS[r.when.step.join(',')] === 'during combat';
  const plain = (r: RestrictionDef, keys: string[]): boolean => Object.keys(r).filter((k) => (r as unknown as Record<string, unknown>)[k] !== undefined).sort().join(',') === keys.sort().join(',');
  // edh-c-71 (CR 304.1; Hand to Hand): "can't cast instant spells" (the casts `other` describes: instants only)
  const castKeys = a.other === undefined ? ['s', 'subject', 'mode', 'action', 'when'] : JSON.stringify(a.other) === '{"types":["Instant"]}' ? ['s', 'subject', 'mode', 'action', 'when', 'other'] : null;
  if (castKeys === null) return false;
  return a.mode === 'cant' && a.action === 'cast' && combat(a) && plain(a, castKeys)
    && b.mode === 'cant' && b.action === 'activate' && b.exceptMana === true && combat(b) && plain(b, ['s', 'subject', 'mode', 'action', 'when', 'exceptMana'])
    && JSON.stringify(a.subject) === JSON.stringify(b.subject) && 'who' in a.subject && a.subject.ref === 'each' && (a.subject.who === 'player' || a.subject.who === 'opponent');
}

/**
 * edh-b-12 (CR 601.3, 602.5, 101.2; zz-cloud/edh-b-12.json): the pair "Players can't cast spells from graveyards" (every player, the graveyard only) and "abilities of
 * cards in graveyards can't be activated" (statics/hooks.ts#canActivate asks it with the ability's source as the subject), each with nothing else in it.
 */
function graveyardCastActivate(effects: readonly StaticEffect[]): boolean {
  if (effects.length !== 2) return false;
  const [a, b] = effects;
  if (a?.s !== 'restrict' || b?.s !== 'restrict') return false;
  const keys = (r: RestrictionDef): string => Object.keys(r).filter((k) => (r as unknown as Record<string, unknown>)[k] !== undefined).sort().join(',');
  return a.mode === 'cant' && a.action === 'castFromZone' && keys(a) === 'action,mode,s,subject' && JSON.stringify(a.subject) === '{"ref":"each","who":"player"}'
    && b.mode === 'cant' && b.action === 'activate' && keys(b) === 'action,mode,s,subject' && JSON.stringify(b.subject) === '{"ref":"each","filter":{"zone":"graveyard"}}';
}

/** edh-d-5: a "can't cast" restriction of one targeted player and a "can't activate abilities that aren't mana abilities" restriction of that same player, nothing else in the second. */
export function castThenActivateNonMana(a: StaticEffect, b: StaticEffect): boolean {
  if (a.s !== 'restrict' || b.s !== 'restrict' || a.mode !== 'cant' || a.action !== 'cast' || a.other === undefined || a.subject.ref !== 'target') return false;
  const keys = Object.keys(b).filter((k) => (b as unknown as Record<string, unknown>)[k] !== undefined).sort().join(',');
  return b.mode === 'cant' && b.action === 'activate' && b.exceptMana === true && keys === 'action,exceptMana,mode,s,subject' && JSON.stringify(a.subject) === JSON.stringify(b.subject);
}

function combatCastActivateNonManaText(a: RestrictionDef): string {
  const group = (a.subject as { who: 'player' | 'opponent' }).who === 'opponent' ? 'your opponents' : 'players'; // the plural group (family players-plural)
  return `during combat, ${group} can't cast ${a.other === undefined ? 'spells' : 'instant spells'} or activate abilities that aren't mana abilities`;
}

/**
 * FAST5 T40 (CR 615.1, 510.1): "Prevent all combat damage that would be dealt to and dealt by ~" (Fog Bank): one prevention of combat damage dealt to the object
 * itself and one of combat damage dealt by it, each with nothing else in it.
 */
function selfCombatPrevention(e: StaticEffect, side: 'recipient' | 'source', who: '{"self":true}' | '{"attachedToSource":true}' = '{"self":true}', combat = true): boolean {
  if (e.s !== 'replace' || e.body.b !== 'prevent' || e.body.amount !== 'all' || e.body.then !== undefined || e.optional === true || e.shield !== undefined || e.condition !== undefined || e.selfReplacement === true) return false;
  const ev = e.replaces;
  // edh-c-35 (CR 615.1a, 303.4; Heart of Light): the same pair of ALL damage, not only combat damage (`combat` false: the event names no `combat` at all)
  if (ev.ev !== 'damage' || (combat ? ev.combat !== true : ev.combat !== undefined) || ev.amount !== undefined) return false;
  const keys = Object.keys(ev).filter((k) => (ev as Record<string, unknown>)[k] !== undefined).sort();
  if (side === 'source') return JSON.stringify(keys) === (combat ? '["combat","ev","source"]' : '["ev","source"]') && JSON.stringify(ev.source) === who;
  return JSON.stringify(keys) === (combat ? '["combat","ev","recipient"]' : '["ev","recipient"]') && JSON.stringify(ev.recipient) === `{"object":${who}}`;
}

/**
 * p2-replace-damage-1 (CR 615.1a, 510.2): the described permanents of "Prevent all combat damage that would be dealt to and dealt by creatures you control." (Statecraft):
 * a static prevention of combat damage dealt to a group (no object of its own: neither ~ nor the attached object, which selfCombatPrevention reads) followed by one of
 * combat damage dealt by the same group, each with nothing else in it. Null for any other pair.
 */
function combatToAndByGroup(a: StaticEffect, b: StaticEffect): ObjectFilter | null {
  const plainPrevent = (e: StaticEffect): e is ReplacementDef => e.s === 'replace' && e.body.b === 'prevent' && e.body.amount === 'all' && e.body.then === undefined
    && e.optional !== true && e.shield === undefined && e.condition === undefined && e.selfReplacement !== true && e.replaces.ev === 'damage' && e.replaces.combat === true;
  if (!plainPrevent(a) || !plainPrevent(b)) return null;
  const keys = (e: ReplacementDef): string => JSON.stringify(Object.keys(e.replaces).filter((k) => (e.replaces as Record<string, unknown>)[k] !== undefined).sort());
  if (keys(a) !== '["combat","ev","recipient"]' || keys(b) !== '["combat","ev","source"]') return null;
  const r = (a.replaces as Extract<EventPattern, { ev: 'damage' }>).recipient;
  const f = (b.replaces as Extract<EventPattern, { ev: 'damage' }>).source;
  if (r?.player !== undefined || r?.object === undefined || f === undefined || JSON.stringify(r.object) !== JSON.stringify(f)) return null;
  if (f.is !== undefined || f.self === true || f.attachedToSource === true) return null;
  return f;
}

/**
 * std-ry10 (CR 615.1a, 611.2a, 510.1): "Prevent all combat damage that would be dealt to and dealt by target creature this turn" (Moonlight Geist, Maze of Ith):
 * the resolved form of FAST5 T40's pair, one prevention of combat damage dealt to one object and one of combat damage dealt by the same object, each with nothing
 * else in it, for the effect's duration. Null for any other pair.
 */
export function lastingCombatToAndBy(effects: readonly StaticEffect[], duration: Duration, st: RenderState): string | null {
  if (effects.length !== 2) return null;
  const [to, by] = effects as [StaticEffect, StaticEffect];
  // edh-b-2 (CR 615.1a, 120.2; Kiora, the Crashing Wave): the same pair of ALL damage, not only combat damage; the duration may lead, "Until your next turn, prevent all damage that would be dealt to and dealt by target permanent an opponent controls."
  const combat = to.s === 'replace' && to.replaces.ev === 'damage' && to.replaces.combat === true;
  const plainPrevent = (e: StaticEffect): e is ReplacementDef => e.s === 'replace' && e.body.b === 'prevent' && e.body.amount === 'all' && e.body.then === undefined
    && e.optional !== true && e.shield === undefined && e.condition === undefined && e.selfReplacement !== true && e.replaces.ev === 'damage' && (combat ? e.replaces.combat === true : e.replaces.combat === undefined);
  if (!plainPrevent(to) || !plainPrevent(by)) return null;
  const keys = (e: ReplacementDef): string => JSON.stringify(Object.keys(e.replaces).filter((k) => (e.replaces as Record<string, unknown>)[k] !== undefined).sort());
  if (keys(to) !== (combat ? '["combat","ev","recipient"]' : '["ev","recipient"]') || keys(by) !== (combat ? '["combat","ev","source"]' : '["ev","source"]')) return null;
  const r = (to.replaces as Extract<EventPattern, { ev: 'damage' }>).recipient;
  const s = (by.replaces as Extract<EventPattern, { ev: 'damage' }>).source;
  if (r?.player !== undefined || r?.object === undefined || Object.keys(r.object).length !== 1 || r.object.is === undefined) return null;
  if (s === undefined || Object.keys(s).length !== 1 || JSON.stringify(s.is) !== JSON.stringify(r.object.is)) return null;
  const said = `prevent all ${combat ? 'combat ' : ''}damage that would be dealt to and dealt by ${K.obj(r.object.is, st, 'object').text}`;
  const suffix = durationSuffix(duration, st);
  return !combat && suffix !== '' ? alt(`${said}${suffix}`, `${suffix.trim()}, ${said}`) : `${said}${suffix}`;
}

/**
 * FAST5X E25 (CR 614.1c, 614.1e, 614.12, 708.11, 122.6): "As ~ enters or is turned face up, put X +1/+1 counters on it, where X is ...": the object's own
 * entering with the counters and the same counters put on it while it is turned face up, one static ability of two replacement effects with nothing else.
 */
function entersOrFaceUpCounters(a: StaticEffect, b: StaticEffect | undefined): { kind: string; count: Quantity } | null {
  if (b === undefined || a.s !== 'replace' || b.s !== 'replace') return null;
  if ([a, b].some((e) => e.optional === true || e.shield !== undefined || e.condition !== undefined || e.selfReplacement === true)) return null;
  const ea = a.replaces;
  const eb = b.replaces;
  if (ea.ev !== 'zoneChange' || JSON.stringify(ea) !== JSON.stringify({ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' })) return null;
  if (eb.ev !== 'becomes' || JSON.stringify(eb) !== JSON.stringify({ ev: 'becomes', what: 'turnedFaceUp', object: { self: true } })) return null;
  const ab = a.body;
  const bb = b.body;
  if (ab.b !== 'enters' || bb.b !== 'during' || ab.counters?.length !== 1 || Object.keys(ab).some((k) => k !== 'b' && k !== 'counters') || bb.do.length !== 1) return null;
  const put = bb.do[0]!;
  const c = ab.counters[0]!;
  if (put.op !== 'putCounters' || put.guard !== undefined || put.as !== undefined || JSON.stringify(put.on) !== '{"ref":"self"}') return null;
  if (put.kind !== c.kind || JSON.stringify(put.count) !== JSON.stringify(c.count)) return null;
  return { kind: c.kind, count: c.count };
}

/**
 * edh-next-130 (CR 614.1c, 614.1e, 708.8, 707.2, 611.2a, 610.3; template sta.edhn130.entersOrFaceUp.mayCopy.untilFaceDown, Vesuvan Shapeshifter): the entering object's optional copy of
 * another creature and, as it is turned face up, the choice of up to one other creature it becomes a copy of, both with the same exceptions and both until it is turned face down; the
 * exceptions, or null for any other pair.
 */
function entersOrFaceUpCopy(a: StaticEffect, b: StaticEffect | undefined): CopyExcept[] | null {
  if (b === undefined || a.s !== 'replace' || b.s !== 'replace') return null;
  if ([a, b].some((e) => e.optional === true || e.shield !== undefined || e.condition !== undefined || e.selfReplacement === true)) return null;
  if (JSON.stringify(a.replaces) !== JSON.stringify({ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' })) return null;
  if (JSON.stringify(b.replaces) !== JSON.stringify({ ev: 'becomes', what: 'turnedFaceUp', object: { self: true } })) return null;
  const ab = a.body;
  const bb = b.body;
  if (ab.b !== 'enters' || bb.b !== 'during' || ab.copy === undefined || Object.keys(ab).some((k) => k !== 'b' && k !== 'copy')) return null;
  const until = JSON.stringify({ d: 'until', event: { ev: 'becomes', what: 'turnedFaceDown', object: { self: true } } });
  const of = JSON.stringify({ types: ['Creature'], other: true });
  const c = ab.copy;
  if (Object.keys(c).sort().join() !== 'duration,except,of,optional' || c.optional !== true || JSON.stringify(c.of) !== of || JSON.stringify(c.duration) !== until || c.except === undefined || c.except.length === 0) return null;
  const want = JSON.stringify([
    { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { types: ['Creature'], other: true } }, min: 0, max: 1, as: 'copied' },
    { op: 'if', cond: { cond: 'did', step: 'copied' }, then: [{ op: 'effect', duration: JSON.parse(until), effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '1a', copyOf: { ref: 'bound', name: 'copied' }, except: c.except }] }] }] },
  ]);
  return JSON.stringify(bb.do) === want ? c.except : null;
}

function entersOrFaceUpText(c: { kind: string; count: Quantity }, st: RenderState): string {
  const self = K.obj({ ref: 'self' }, st, 'subject').text;
  const n = c.count;
  const what = typeof n === 'number' ? `${n === 1 ? (/^[aeiou]/i.test(c.kind) ? 'an' : 'a') : numWord(n)} ${c.kind} counter${n === 1 ? '' : 's'} on it` : `X ${c.kind} counters on it, where X is ${K.qty(n, st)}`;
  return `as ${self} enters or is turned face up, put ${what}`;
}

/** r3-static: "you have no maximum hand size" then "you don't lose the game for having 0 or less life", both of you and nothing else (CR 402.2, 704.5a). */
function noMaxHandAndNoZeroLifeLoss(a: StaticEffect, b: StaticEffect): boolean {
  return JSON.stringify(a) === JSON.stringify({ s: 'rule', rule: 'handSizeNoLimit', player: { ref: 'you' } }) && JSON.stringify(b) === JSON.stringify({ s: 'rule', rule: 'noLossForZeroLife' });
}

/** edh-cast-6: a reduction of the cost of the spells you cast and the rule that those same spells can't be countered (`costMod` then `restrict` beCountered of the spells you control). */
function costLessAndUncounterable(a: StaticEffect, b: StaticEffect): boolean {
  if (a.s !== 'costMod' || b.s !== 'restrict' || a.applies.caster !== 'you' || a.applies.spells === undefined || a.applies.self !== undefined || a.applies.abilities !== undefined || a.change.kind !== 'reduce') return false;
  if (b.mode !== 'cant' || b.action !== 'beCountered' || b.other !== undefined || b.max !== undefined || b.when !== undefined || b.subject.ref !== 'each' || !('filter' in b.subject)) return false;
  // "spells you cast": the spells you control but not their copies, which are not cast (CR 707.10; render/refs.ts#spellsYouCast)
  const cast = spellsYouCast(b.subject.filter);
  return cast !== null && sameShape(cast, a.applies.spells);
}


/**
 * edh-c-12 (CR 613.1d-f, 613.4b-c, 508.1c, 509.1b, 509.1a; templates sta.edhv12.*): three one-sentence readings of the object an Aura or Equipment is attached to, said as Oracle
 * prints them: a creature type set with the plain bans on attacking and blocking ("Enchanted creature is a Spirit and can't attack or block", Fog on the Barrow-Downs); a P/T
 * change with the rule that it may block one more creature ("Equipped creature gets +0/+3 and can block an additional creature each combat", Vanguard's Shield); base power and
 * toughness, abilities granted, all other abilities lost and a color and creature type added ("... has base power and toughness 0/4, has defender, loses all other abilities, and
 * is a blue Wall in addition to its other colors and types", Deep Freeze). Only exactly those shapes, the object attachedTo; else null.
 */
function edhC12StaticFold(effects: StaticEffect[], i: number, st: RenderState): { text: string; n: number } | null {
  const e = effects[i];
  if (e?.s !== 'continuous' || e.cda === true || JSON.stringify(e.affects) !== '{"ref":"attachedTo"}' || Object.keys(e).some((k) => !['s', 'affects', 'mods'].includes(k))) return null;
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  const ban = (x: StaticEffect | undefined, action: string): boolean => x?.s === 'restrict' && x.mode === 'cant' && x.action === action && same(x.subject, e.affects) && Object.keys(x).every((k) => ['s', 'subject', 'mode', 'action'].includes(k));
  const m = e.mods;
  if (m.length === 1 && m[0]!.layer === 4 && Object.keys(m[0]!).every((k) => k === 'layer' || k === 'subtypes') && (m[0] as { subtypes?: { set?: unknown } }).subtypes?.set !== undefined
    && ban(effects[i + 1], 'attack') && ban(effects[i + 2], 'block')) {
    return { text: `${staticEffect(e, st)} and can't attack or block`, n: 3 };
  }
  const r = effects[i + 1];
  if (m.length === 1 && m[0]!.layer === '7c' && Object.keys(m[0]!).every((k) => ['layer', 'power', 'toughness'].includes(k)) && r?.s === 'rule' && r.rule === 'extraBlockers' && r.value === 1
    && same(r.of, { is: e.affects }) && Object.keys(r).every((k) => ['s', 'rule', 'value', 'of'].includes(k))) {
    return { text: `${staticEffect(e, st)} and can block an additional creature each combat`, n: 2 };
  }
  if (m.length === 4 && m[0]!.layer === 4 && m[1]!.layer === 5 && m[2]!.layer === 6 && m[3]!.layer === '7b') {
    const [ty, co, ab, pt] = m as unknown as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
    const subs = (ty['subtypes'] as { add?: string[] } | undefined)?.add;
    const cols = (co['colors'] as { add?: string[] } | undefined)?.add;
    const add = ab['add'] as unknown[] | undefined;
    if (Object.keys(ty).length !== 2 || subs === undefined || subs.length !== 1 || Object.keys(co).length !== 2 || cols === undefined || cols.length !== 1 || COLOR_WORD[cols[0]!] === undefined
      || add === undefined || Object.keys(ab).length !== (ab['removeAll'] === true ? 3 : 2) || (ab['removeAll'] !== undefined && ab['removeAll'] !== true) || Object.keys(pt).length !== 3) return null;
    // edh-d-6 (CR 613.1f; Blade of the Oni): without the loss of the other abilities, "... has base power and toughness 5/5, has menace, and is a black Demon in addition to its other colors and types"
    const loses = ab['removeAll'] === true;
    const base = staticEffect({ ...e, mods: [pt as unknown as ContinuousEffectDef['mods'][number]] }, st);
    const grant = staticEffect({ ...e, mods: [{ layer: 6, add } as unknown as ContinuousEffectDef['mods'][number]] }, st);
    const has = afterSubject(grant);
    if (!base.includes(' has base power and toughness ') || has === null || !has.startsWith(' has ')) return null;
    const color = COLOR_WORD[cols[0]!]!;
    return { text: `${base},${has},${loses ? ' loses all other abilities,' : ''} and is ${/^[aeiou]/i.test(color) ? 'an' : 'a'} ${color} ${subs[0]} in addition to its other colors and types`, n: 1 };
  }
  return null;
}

function staticEffectsApart(effects: StaticEffect[], st: RenderState): string {
  const parts: string[] = [];
  for (let i = 0; i < effects.length; ) {
    const e = effects[i]!;
    const c12 = edhC12StaticFold(effects, i, st); // edh-c-12
    if (c12 !== null) {
      parts.push(c12.text);
      i += c12.n;
      continue;
    }
    // edh-b-12 (CR 601.3, 602.5, 113.6; Ashes of the Abhorrent): "Players can't cast spells from graveyards or activate abilities of cards in graveyards."
    if (graveyardCastActivate(effects.slice(i, i + 2))) {
      parts.push("players can't cast spells from graveyards or activate abilities of cards in graveyards");
      i += 2;
      continue;
    }
    const ownerBans = mustAttackOwnerBans(effects, i, st); // edh-top-5 (Xantcha): the attack requirement of the object and its bans on its owner and its owner's planeswalkers
    if (ownerBans !== null) {
      parts.push(ownerBans.text);
      i += ownerBans.n;
      continue;
    }
    const attackBanYou = ownerBans === null ? mustAttackCantAttackYou(effects, i, st) : null; // edh-d-10 (Fealty to the Realm): the attack requirement and the ban on attacking you
    if (attackBanYou !== null) {
      parts.push(attackBanYou.text);
      i += attackBanYou.n;
      continue;
    }
    // FAST5X E14 (CR 401.5, 601.3): "You may look at the top card of your library any time, and you may play lands and cast creature spells from the top of
    // your library" / "You may play lands and cast Bird spells from the top of your library"
    const top = topPermitsSentence(effects, i, st) ?? graveyardPermitsSentence(effects, i, st); // C10: "you may play lands and cast X from your graveyard"
    if (top !== null) {
      parts.push(top.text);
      i += top.n;
      continue;
    }
    // Cloud r3-repl (CR 614.1c, 122.6, 202.3): "Each other Vehicle and creature you control enters with an additional +1/+1 counter on it if its mana value is 4 or
    // less. Otherwise, it enters with three additional +1/+1 counters on it." (Thunderous Velocipede): two entering replacements split by mana value
    // Cloud r3-repl (CR 614.1a, 122.6): "If you would put one or more counters on a permanent or player, put twice that many of each of those kinds of counters
    // on that permanent or player instead." (Innkeeper's Talent): the same change of the counters you put on a permanent and on a player
    const either = i + 1 < effects.length ? permanentOrPlayerCounters(e, effects[i + 1]!, st) : null;
    if (either !== null) {
      parts.push(either);
      i += 2;
      continue;
    }
    // Cloud r3-repl (CR 614.9): "All damage that would be dealt to you and other permanents you control is dealt to ~ instead." (Ancient Adamantoise)
    if (i + 1 < effects.length && youAndOthersToSelf(e, effects[i + 1]!)) {
      parts.push(`all damage that would be dealt to you and other permanents you control is dealt to ${K.obj({ ref: 'self' }, st, 'object').text} instead`);
      i += 2;
      continue;
    }
    // edh-cast-6 (CR 601.2f, 101.2, 701.6a; Thryx, the Sudden Storm; family cost-less-and-cant-be-countered): "Spells you cast with mana value 5 or greater cost {1} less to cast and can't
    // be countered": the reduction and the protection of the same spells you cast, said as one sentence
    if (i + 1 < effects.length && costLessAndUncounterable(e, effects[i + 1]!)) {
      parts.push(alt(`${staticEffect(e, st)} and can't be countered`, [staticEffect(e, st), staticEffect(effects[i + 1]!, st)].join('. ')));
      i += 2;
      continue;
    }
    const byMv = i + 1 < effects.length ? manaValueSplit(e, effects[i + 1]!, st) : null;
    if (byMv !== null) {
      parts.push(byMv);
      i += 2;
      continue;
    }
    // edh-c-72 (CR 115.1, 303.4, 101.2; Anti-Magic Aura; family attached-cant-target-spells-and-be-enchanted): "Enchanted creature can't be the target of spells and can't be enchanted by other
    // Auras": the ban on spells targeting the creature the source is attached to and the ban on other Auras enchanting it, one sentence
    const plainBan = (x: StaticEffect | undefined, action: RuleAction, other: string): boolean => x !== undefined && x.s === 'restrict' && x.mode === 'cant' && x.action === action && JSON.stringify(x.subject) === '{"ref":"attachedTo"}'
      && JSON.stringify(x.other) === other && x.when === undefined && x.max === undefined && Object.keys(x).filter((k) => (x as unknown as Record<string, unknown>)[k] !== undefined).length === 5;
    if (plainBan(e, 'beTargeted', '{"stackKind":"spell"}') && plainBan(effects[i + 1], 'beEnchanted', '{"subtypes":["Aura"],"other":true}')) {
      const [joined, apart] = withVariants(st, [
        (v) => `${staticEffect(e, v)} and can't be enchanted by other Auras`,
        (v) => [staticEffect(e, v), staticEffect(effects[i + 1]!, v)].join('. '),
      ]);
      parts.push(alt(joined!, apart!));
      i += 2;
      continue;
    }
    // edh-c-35 (CR 303.4, 613.1f; Consecrate Land): "Enchanted land has indestructible and can't be enchanted by other Auras." (family attached-grant-and-cant-be-enchanted): a grant to the object the source is
    // attached to and a ban on other Auras enchanting it, one sentence
    const grantAndBan = i + 1 < effects.length && effects[i + 1]!.s === 'restrict' && (effects[i + 1] as RestrictionDef).action === 'beEnchanted' && (effects[i + 1] as RestrictionDef).mode === 'cant' && JSON.stringify((effects[i + 1] as RestrictionDef).other) === '{"subtypes":["Aura"],"other":true}' && (effects[i + 1] as RestrictionDef).when === undefined && (effects[i + 1] as RestrictionDef).max === undefined
      && JSON.stringify((effects[i + 1] as RestrictionDef).subject) === '{"ref":"attachedTo"}' && e.s === 'continuous' && e.affects.ref === 'attachedTo' && e.mods.length === 1 && e.mods[0]!.layer === 6;
    if (grantAndBan) {
      const [joined, apart] = withVariants(st, [
        (v) => `${staticEffect(e, v)} and can't be enchanted by other Auras`,
        (v) => [staticEffect(e, v), staticEffect(effects[i + 1]!, v)].join('. '),
      ]);
      parts.push(alt(joined!, apart!));
      i += 2;
      continue;
    }
    // Cloud C3 (batch 3): also of the object the source is attached to, "... dealt to and dealt by enchanted creature" (CR 303.4, 301.5)
    const toAndByBoth = ([true, false] as const).flatMap((combat) => (['{"self":true}', '{"attachedToSource":true}'] as const).map((w) => ({ combat, w }))).find(({ combat, w }) => i + 1 < effects.length && selfCombatPrevention(e, 'recipient', w, combat) && selfCombatPrevention(effects[i + 1]!, 'source', w, combat));
    if (toAndByBoth !== undefined) {
      const whose: ObjRef = toAndByBoth.w === '{"self":true}' ? { ref: 'self' } : { ref: 'attachedTo' };
      const [both, apart] = withVariants(st, [
        (v) => `prevent all ${toAndByBoth.combat ? 'combat ' : ''}damage that would be dealt to and dealt by ${K.obj(whose, v, 'subject').text}`,
        (v) => [staticEffect(e, v), staticEffect(effects[i + 1]!, v)].join('. '),
      ]);
      parts.push(alt(both!, apart!));
      i += 2;
      continue;
    }
    // p2-replace-damage-1 (CR 615.1a, 510.2): the same pair of a group, "Prevent all combat damage that would be dealt to and dealt by creatures you control." (Statecraft;
    // family combat-to-and-by-group): one prevention of combat damage dealt to the described permanents and one of combat damage dealt by them, the same description
    const groupFilter = i + 1 < effects.length ? combatToAndByGroup(e, effects[i + 1]!) : null;
    if (groupFilter !== null) {
      const [both, apart] = withVariants(st, [
        (v) => `prevent all combat damage that would be dealt to and dealt by ${K.np(groupFilter, v, { det: 'none', plural: true })}`,
        (v) => [staticEffect(e, v), staticEffect(effects[i + 1]!, v)].join('. '),
      ]);
      parts.push(alt(both!, apart!));
      i += 2;
      continue;
    }
    // FAST4 T33: "Creatures with flying can't attack you or planeswalkers you control" (CR 508.1b-c; family shared-subject)
    const n1 = effects[i + 1];
    // r3-static (CR 402.2, 704.5a): "You have no maximum hand size and don't lose the game for having 0 or less life" (Marina Vendrell's Grimoire): two rules of you
    if (n1 !== undefined && noMaxHandAndNoZeroLifeLoss(e, n1)) {
      parts.push(alt("you have no maximum hand size and don't lose the game for having 0 or less life", [staticEffect(e, st), staticEffect(n1, st)].join('. ')));
      i += 2;
      continue;
    }
    const n2 = effects[i + 2];
    // edh-next-130 (CR 614.1c, 614.1e, 708.8, 707.2, 611.2a; Vesuvan Shapeshifter): "As ~ enters or is turned face up, you may choose another creature on the battlefield. If you do,
    // until ~ is turned face down, it becomes a copy of that creature, except ...": the entering copy and the copy made while it is turned face up, both lasting until it is turned face down
    const faceUpCopy = entersOrFaceUpCopy(e, n1);
    if (faceUpCopy !== null) {
      const self = K.obj({ ref: 'self' }, st, 'subject').text;
      const exc = copyExceptText(faceUpCopy, (mods) => K.staticEffect({ s: 'continuous', affects: { ref: 'subject' }, mods }, st), (a) => quotedAbility(a, st, 'creature'), 'creature', false, false, false);
      parts.push(`as ${self} enters or is turned face up, you may choose another creature on the battlefield. if you do, until ${self} is turned face down, it becomes a copy of that creature, except ${exc}`);
      i += 2;
      continue;
    }
    const faceUpCounters = entersOrFaceUpCounters(e, n1);
    if (faceUpCounters !== null) {
      parts.push(entersOrFaceUpText(faceUpCounters, st));
      i += 2;
      continue;
    }
    // edh-d-25 (CR 509.1b, 508.1b-c; Varchild, Betrayer of Kjeldor): "Survivors your opponents control can't block, and they can't attack you or planeswalkers you control": a plain ban on
    // blocking and the pair above, of one group (said with "they" after the comma)
    if (n1 !== undefined && n2 !== undefined && e.s === 'restrict' && e.mode === 'cant' && e.action === 'block' && e.other === undefined && e.otherPlayer === undefined && e.max === undefined && e.min === undefined
      && e.when === undefined && e.alone === undefined && e.exceptMana === undefined && e.goad === undefined && e.subject.ref === 'each' && 'filter' in e.subject
      && attackYouPair(n1, n2) && JSON.stringify((n1 as RestrictionDef).subject) === JSON.stringify(e.subject)) {
      parts.push(withSubjects(e.subject, st, (sj) => `${sj} can't block, and they ${ATTACK_YOU}`));
      i += 3;
      continue;
    }
    if (n1 !== undefined && attackYouPair(e, n1)) {
      parts.push(withSubjects((e as RestrictionDef).subject, st, (sj) => `${sj} ${ATTACK_YOU}`));
      i += 2;
      continue;
    }
    // std-rx6 (CR 508.1c, 509.1b): "Creatures with flying can't attack you or block creatures you control" (Storm, Windrider): the plain ban on attacking you and
    // a ban on blocking a group, of one subject, one sentence
    if (n1 !== undefined && isPlainAttackYou(e) && n1.s === 'restrict' && n1.mode === 'cant' && n1.action === 'block' && n1.other !== undefined && n1.otherPlayer === undefined
      && n1.max === undefined && n1.min === undefined && n1.when === undefined && n1.alone === undefined && n1.exceptMana === undefined && n1.goad === undefined
      && JSON.stringify(n1.subject) === JSON.stringify((e as RestrictionDef).subject)) {
      const other = n1.other;
      parts.push(withSubjects((e as RestrictionDef).subject, st, (sj) => `${sj} can't attack you or block ${K.np(other, st, { det: 'none', plural: true })}`));
      i += 2;
      continue;
    }
    // ... after a P/T change and abilities of the same one object: "Enchanted creature gets +2/+2, has vigilance, and can't attack you or planeswalkers you
    // control" (CR 613.4c, 613.1f, 508.1c: one static ability, its effects in one list)
    if (e.s === 'continuous' && e.cda !== true && n1 !== undefined && n2 !== undefined && attackYouPair(n1, n2) && isOneObject(e.affects, st)
      && JSON.stringify(e.affects) === JSON.stringify((n1 as RestrictionDef).subject) && !(effects[i + 3] !== undefined && isPlainCantSacrificed(effects[i + 3]!))) {
      parts.push(continuous(e, st, undefined, true, false, [ATTACK_YOU]));
      i += 3;
      continue;
    }
    // edh-perms-17 (CR 508.1b-c, 701.21a, 613.4c; Assault Suit): "Equipped creature gets +2/+2, has haste, can't attack you or planeswalkers you control, and can't be sacrificed": the
    // run above followed by a plain ban on sacrificing the same object, one list
    const n3 = effects[i + 3];
    if (e.s === 'continuous' && e.cda !== true && n1 !== undefined && n2 !== undefined && n3 !== undefined && attackYouPair(n1, n2) && isPlainCantSacrificed(n3)
      && isOneObject(e.affects, st) && JSON.stringify(e.affects) === JSON.stringify((n1 as RestrictionDef).subject) && JSON.stringify(e.affects) === JSON.stringify((n3 as RestrictionDef).subject)) {
      parts.push(continuous(e, st, undefined, true, false, [ATTACK_YOU, "can't be sacrificed"]));
      i += 4;
      continue;
    }
    // edh-perms-17 (CR 508.1d, 508.1b, 701.21a; Alexios): "~ attacks each combat if able, can't be sacrificed, and can't attack its owner": the three rules of the source itself
    if (n1 !== undefined && n2 !== undefined && isOwnMustAttack(e) && isPlainCantSacrificed(n1) && isOwnCantAttackOwner(n2)
      && JSON.stringify((n1 as RestrictionDef).subject) === '{"ref":"self"}') {
      parts.push(`~ attacks each combat if able, can't be sacrificed, and can't attack ${JSON.stringify((n2 as RestrictionDef).otherPlayer) === '{"ref":"ownerOf","object":{"ref":"self"}}' ? 'its owner' : K.player((n2 as RestrictionDef).otherPlayer as PlayerRef, st, 'object').text}`);
      i += 3;
      continue;
    }
    // edh-c-17 (CR 604.1, 613.4c, 205.1; sta.edhv17.each.pump.aslongCreature; Earth Surge): "Each land gets +2/+2 as long as it's a creature": a pump of the group of one
    // description that is also a creature (`allTypes: ['creature']`), said with the condition on the group's own members
    if (e.s === 'continuous' && e.cda !== true && isCreatureOnlyPump(e)) {
      const inner: ContinuousEffectDef = { ...e, affects: { ref: 'each', filter: withoutCreatureType((e.affects as { filter: ObjectFilter }).filter) } };
      const fork = cloneState(st);
      const sing = continuous(inner, st, undefined, true).replace(/\.$/, '');
      const plur = continuous(inner, fork, undefined, true).replace(/\.$/, '');
      parts.push(alt(`${sing} as long as it's a creature`, `${plur} as long as they're creatures`));
      i += 1;
      continue;
    }
    // Cloud C3 (batch 3): "Enchanted creature gets +0/+2 and assigns combat damage equal to its toughness rather than its power" (CR 613.4c, 510.1a): the rule of the
    // object the source is attached to said after its change, one sentence
    if (e.s === 'continuous' && e.cda !== true && e.affects.ref === 'attachedTo' && n1 !== undefined && isAttachedToughnessDamage(n1)) {
      parts.push(continuous(e, st, undefined, true, false, ['assigns combat damage equal to its toughness rather than its power']));
      i += 2;
      continue;
    }
    // p2-combat-flow-1 (CR 510.1a, 702.3b): "Each creature you control with defender assigns combat damage equal to its toughness rather than its power and can attack
    // as though it didn't have defender" (Arcades, the Strategist): the rule and the permission of one group you control, one sentence
    if (n1 !== undefined && toughnessDamageNoDefender(e, n1)) {
      parts.push(`each ${K.np((e as RuleModDef).of!, st, { det: 'none' })} assigns combat damage equal to its toughness rather than its power and can attack as though it didn't have defender`);
      i += 2;
      continue;
    }
    // Cloud C3 (batch 3): "Enchanted creature gets +1/+1, has deathtouch, and is goaded", "... has indestructible and is goaded", "... gets +3/+3, must be
    // blocked if able, and is goaded" (CR 613.4c, 613.1f, 509.1c, 701.15a-c): the changes of one object and its static goad said last, one list
    const goad = goadRiders(effects, i, st);
    if (goad !== null) {
      parts.push(continuous(e as ContinuousEffectDef, st, undefined, true, false, goad.extra));
      i += goad.n;
      continue;
    }
    // std-rx18 (CR 613.1f, 508.1c, 509.1b; family loses-all-then-cants): "Enchanted creature loses all abilities and can't attack or block" (Observed Stasis): the
    // loss of all abilities of one object, then two or more plain bans of the same object, one sentence with the subject said once
    if (e.s === 'continuous' && e.cda !== true && isOneObject(e.affects, st) && e.mods.length === 1 && JSON.stringify(e.mods[0]) === '{"layer":6,"removeAll":true}') {
      let j = i + 1;
      while (j < effects.length && isSimpleCant(effects[j]!) && JSON.stringify((effects[j] as RestrictionDef).subject) === JSON.stringify(e.affects)) j++;
      if (j - i > 2) {
        const bans = effects.slice(i + 1, j) as RestrictionDef[];
        const [merged, apart] = withVariants(st, [
          (v) => `${staticEffect(e, v)} and can't ${joinList(bans.map((b) => cantWords(b.action, false)), 'or')}`,
          (v) => effects.slice(i, j).map((x) => staticEffect(x, v)).join(alt('. ', ' and ')),
        ]);
        parts.push(alt(merged!, apart!));
        i = j;
        continue;
      }
    }
    // edh-d-38 (CR 509.1c; Gorm the Great): "~ must be blocked if able, and ~ must be blocked by two or more creatures if able": the plain requirement and the same one with a
    // minimum of blockers, of one subject
    if (n1 !== undefined && plainMustIfAble(e, 'beBlocked') && n1.s === 'restrict' && n1.mode === 'mustIfAble' && n1.action === 'beBlocked' && typeof n1.min === 'number' && n1.min >= 2
      && Object.keys(n1).every((k) => ['s', 'subject', 'mode', 'action', 'min'].includes(k)) && JSON.stringify(n1.subject) === JSON.stringify(e.subject)) {
      parts.push(`${staticEffect(e, st)}, and ${staticEffect(n1, st)}`);
      i += 2;
      continue;
    }
    // edh-replace-7 (CR 508.1d, 509.1c; Khârn the Betrayer): "~ attacks or blocks each combat if able": the requirement to attack and the requirement to block of one subject, with no other field,
    // are one sentence (the lasting form, with its duration inside, is attackOrBlockIfAble above)
    if (n1 !== undefined && plainMustIfAble(e, 'attack') && plainMustIfAble(n1, 'block') && JSON.stringify(n1.subject) === JSON.stringify(e.subject)) {
      parts.push(withSubjects(e.subject, st, (sj, pl) => `${sj} ${pl ? 'attack or block' : 'attacks or blocks'} each combat if able`));
      i += 2;
      continue;
    }
    // FAST5 T37 (CR 506.5): "~ can't attack or block alone": the two alone bans of one subject are one sentence
    if (isAloneBan(e) && n1 !== undefined && isAloneBan(n1) && n1.action !== e.action && JSON.stringify(n1.subject) === JSON.stringify(e.subject)) {
      parts.push(withSubjects(e.subject, st, (sj) => `${sj} can't ${e.action} or ${n1.action} alone`));
      i += 2;
      continue;
    }
    // p2-attack-block-1 (CR 613.1f, 509.1b): "Fish you control have haste and can't be blocked by Humans": a grant of abilities to a group and the ban on being
    // blocked by creatures of a description, of the same group, one sentence with the subject said once
    if (n1 !== undefined && isPlainGrant(e) && e.s === 'continuous' && isEachGroup(e.affects) && n1.s === 'restrict' && n1.mode === 'cant' && n1.action === 'beBlockedBy'
      && n1.other !== undefined && JSON.stringify(n1.subject) === JSON.stringify(e.affects) && Object.keys(n1).every((k) => ['s', 'subject', 'mode', 'action', 'other'].includes(k))) {
      const ban = n1;
      const [both, apart] = withVariants(st, [
        (v) => `${staticEffect(e, v)} and can't be blocked by ${K.np(ban.other!, v, { det: 'none', plural: true })}`,
        (v) => [staticEffect(e, v), staticEffect(n1, v)].join(alt('. ', ' and ')),
      ]);
      parts.push(alt(both!, apart!));
      i += 2;
      continue;
    }
    // edh-d-38 (CR 613.4c, 613.1f, 109.1, 508.1d; Skeletal Swarming): a group that has abilities, must attack each combat and gets a power bonus counted from the OTHER objects
    // of a kind, other than the object modified (`not: {is: subject}`), each object said in the singular: "Each Skeleton you control has trample, attacks each combat if able,
    // and gets +X/+0, where X is the number of other Skeletons you control."
    if (n1 !== undefined && e.s === 'continuous' && isEachGroup(e.affects) && plainMustIfAble(n1, 'attack') && JSON.stringify(n1.subject) === JSON.stringify(e.affects)) {
      const pg = pumpAndGrant(e);
      const pump = pg?.pump as { power?: Quantity; toughness?: Quantity } | undefined;
      const grant = pg?.grant as { add?: AbilityDef[] } | undefined;
      if (pg !== null && pump !== undefined && grant?.add !== undefined && pump.toughness === 0 && pump.power !== undefined && JSON.stringify(pump.power).includes('"not":{"is":{"ref":"subject"}}')) {
        parts.push(`${K.np((e.affects as { filter: ObjectFilter }).filter, st, { det: 'each' })} has ${abilityList(grant.add, st, 'creature')}, ${restrictFor(n1, st, '', false).trim()}, and gets +X/+0, where X is ${K.qty(pump.power, st)}`);
        i += 2;
        continue;
      }
    }
    // edh-c-8 (CR 613.1f, 508.1d; Hellraiser Goblin): "Creatures you control have haste and attack each combat if able": a grant of abilities to a group and the requirement
    // to attack each combat of the same group, one sentence with the subject said once
    if (n1 !== undefined && isPlainGrant(e) && e.s === 'continuous' && isEachGroup(e.affects) && plainMustIfAble(n1, 'attack') && JSON.stringify(n1.subject) === JSON.stringify(e.affects)) {
      const [both, apart] = withVariants(st, [
        (v) => `${staticEffect(e, v)} and attack each combat if able`,
        (v) => [staticEffect(e, v), staticEffect(n1, v)].join(alt('. ', ' and ')),
      ]);
      parts.push(alt(both!, apart!));
      i += 2;
      continue;
    }
    // T55 (CR 509.1b, 101.2): "~ can't block or be blocked by non-Spirit creatures": the ban on blocking them and the ban on being blocked by them, one sentence
    if (n1 !== undefined && blockAndBeBlockedBy(e, n1)) {
      const by = e as RestrictionDef;
      const [both, apart] = withVariants(st, [
        (v) => withSubjects(by.subject, v, (sj) => `${sj} can't block or be blocked by ${K.np(by.other!, v, { det: 'none', plural: true })}`),
        (v) => [staticEffect(e, v), staticEffect(n1, v)].join(alt('. ', ' and ')),
      ]);
      parts.push(alt(both!, apart!));
      i += 2;
      continue;
    }
    if (isSimpleCant(e)) {
      let j = i + 1;
      while (j < effects.length && isSimpleCant(effects[j]!) && JSON.stringify((effects[j] as RestrictionDef).subject) === JSON.stringify(e.subject)) j++;
      // FAST1 T5: "Enchanted creature can't attack or block, and its activated abilities can't be activated" (CR 602.5; family shared-subject)
      const noActivate = j < effects.length && isOwnActivateBan(effects[j]!, e.subject, st, true) ? effects[j] as RestrictionDef : null;
      if (j - i > 1 || noActivate !== null) {
        const group = effects.slice(i, j) as RestrictionDef[];
        // FAST4 T33: "... unless they're mana abilities" (CR 605.1a)
        const tail = noActivate ? `, and its activated abilities can't be activated${noActivate.exceptMana === true ? " unless they're mana abilities" : ''}` : '';
        const [merged, mergedAnd, apart] = withVariants(st, [
          // Cloud C3 (batch 3): three or more are a list, "can't attack, block, or transform" (Oracle's serial comma; two stay "attack or block")
          (v) => {
            const say = (sj: string, pl: boolean): string => `${sj} can't ${joinList(group.map((g) => cantWords(g.action, pl)), 'or')}${tail}`;
            // Standard round 6 (family players-plural-cants): "Players can't draw cards or gain life" (Mornsong Aria), each player said as the plural group, as `restrict`
            const s = e.subject;
            const plural = s.ref === 'each' && 'who' in s && (s.who === 'opponent' || s.who === 'player') ? (s.who === 'opponent' ? 'your opponents' : 'players') : null;
            // p2-player-rules-1 (family life-total-cant-change; CR 119.7, 119.8, 119.5): "can't gain life or lose life" of you alone is "Your life total can't change"
            const life = tail === '' && s.ref === 'you' && group.length === 2 && group.map((g) => g.action).sort().join() === 'gainLife,loseLife' ? ["your life total can't change"] : [];
            // edh-next-36 (CR 602.5, 605.1a; Intercessor's Arrest): the ban on its activated abilities may be a sentence of its own, "Enchanted permanent can't attack, block, or crew Vehicles. Its activated abilities can't be activated unless they're mana abilities."
            if (noActivate !== null && plural === null && life.length === 0) return alt(withSubjects(s, v, say), withSubjects(s, v, (sj, pl) => `${say(sj, pl).slice(0, say(sj, pl).length - tail.length)}. its activated abilities can't be activated${noActivate.exceptMana === true ? " unless they're mana abilities" : ''}`));
            return plural === null && life.length === 0 ? withSubjects(s, v, say) : alt(withSubjects(s, v, say), ...(plural === null ? [] : [say(plural, true)]), ...life);
          },
          // FAST1 T5: "can't block and can't be blocked" says the same as "can't block or be blocked" (CR 101.2; family shared-subject)
          (v) => withSubjects(e.subject, v, (sj, pl) => `${sj} ${group.map((g) => `can't ${cantWords(g.action, pl)}`).join(' and ')}${tail}`),
          (v) => [...group, ...(noActivate ? [noActivate] : [])].map((g) => staticEffect(g, v)).join(alt('. ', ' and ')),
        ]);
        parts.push(alt(merged!, mergedAnd!, apart!));
        i = noActivate ? j + 1 : j;
        continue;
      }
      // FAST3 T16: "White creatures and blue creatures can't block": the same "can't" of two groups is one sentence (CR 509.1b, 101.2)
      const r = effects[i + 1];
      if (r !== undefined && isSimpleCant(r) && r.action === e.action && isEachGroup(e.subject) && isEachGroup(r.subject) && JSON.stringify(r.subject) !== JSON.stringify(e.subject)) {
        const [merged, apart] = withVariants(st, [
          (v) => withSubjects(e.subject, v, (a) => withSubjects(r.subject, v, (b) => `${a} and ${b} can't ${ACTION_CANT[e.action]!}`)),
          (v) => [staticEffect(e, v), staticEffect(r, v)].join(alt('. ', ' and ')),
        ]);
        parts.push(alt(merged!, apart!));
        i += 2;
        continue;
      }
    }
    // edh-c-28 (CR 508.1h, 509.1d, 303.4; Cowed by Wisdom): the attack tax and the block tax of the creature the source is attached to, with one amount: one sentence
    const next = effects[i + 1];
    if (e.s === 'rule' && e.rule === 'attackTax' && e.defenders === 'any' && next !== undefined && next.s === 'rule' && next.rule === 'blockTax' && next.defenders === undefined
      && JSON.stringify(e.of) === '{"attachedToSource":true}' && JSON.stringify(next.of) === JSON.stringify(e.of) && JSON.stringify(next.value) === JSON.stringify(e.value) && JSON.stringify(next.cost) === JSON.stringify(e.cost)) {
      const one = combatTax(e, st, e.value === undefined || e.value === 'none' ? '' : K.qty(e.value, st));
      parts.push(one.replace(" can't attack unless", " can't attack or block unless"));
      i += 2;
      continue;
    }
    // edh-c-110 (Myr Prototype): the object itself's attack tax and block tax with one amount: one sentence
    if (e.s === 'rule' && e.rule === 'attackTax' && e.defenders === 'any' && next !== undefined && next.s === 'rule' && next.rule === 'blockTax' && next.defenders === undefined
      && JSON.stringify(e.of) === '{"is":{"ref":"self"}}' && JSON.stringify(next.of) === JSON.stringify(e.of) && JSON.stringify(next.value) === JSON.stringify(e.value) && e.cost === undefined && next.cost === undefined) {
      const one = combatTax(e, st, e.value === undefined || e.value === 'none' ? '' : K.qty(e.value, st));
      if (one.startsWith("~ can't attack unless you pay")) {
        parts.push(one.replace(" can't attack unless", " can't attack or block unless"));
        i += 2;
        continue;
      }
    }
    // edh-d-15 (CR 601.3, 602.5, 101.2; City of Solitude): the own-turn restrictions of casting and of activating, one sentence
    if (e.s === 'restrict' && next?.s === 'restrict' && e.relativeToSubject === true && next.relativeToSubject === true && e.mode === 'onlyIf' && next.mode === 'onlyIf' && e.action === 'cast' && next.action === 'activate'
      && JSON.stringify({ ...e, action: 0 }) === JSON.stringify({ ...next, action: 0 }) && restrict(e, st) === 'players can cast spells only during their own turns') {
      parts.push('players can cast spells and activate abilities only during their own turns');
      i += 2;
      continue;
    }
    if (isOnlyIfCombat(e) && next !== undefined && isOnlyIfCombat(next) && next.action !== e.action && JSON.stringify(next.subject) === JSON.stringify(e.subject)
      && JSON.stringify(next.when) === JSON.stringify(e.when)) {
      const [merged, apart] = withVariants(st, [
        (v) => withSubjects(e.subject, v, (sj) => `${sj} can't ${ACTION_CANT[e.action]!} or ${ACTION_CANT[next.action]!} unless ${K.cond(e.when!, v)}`),
        (v) => [staticEffect(e, v), staticEffect(next, v)].join(alt('. ', ' and ')),
      ]);
      parts.push(alt(merged!, apart!));
      i += 2;
      continue;
    }
    // M6-5 (CR 601.2b): the additional costs of one choice group are one sentence, "As an additional cost to cast ~, A or B"
    if (e.s === 'additionalCost' && e.choiceGroup !== undefined) {
      let j = i + 1;
      while (j < effects.length && effects[j]!.s === 'additionalCost' && (effects[j] as typeof e).choiceGroup === e.choiceGroup) j++;
      parts.push(choiceGroupCost(effects.slice(i, j) as (typeof e)[], st));
      i = j;
      continue;
    }
    const shared = i + 1 < effects.length ? sharedSubject(e, effects[i + 1]!, st) : null;
    if (shared !== null) {
      parts.push(shared);
      i += 2;
      continue;
    }
    parts.push(staticEffect(e, st));
    i++;
  }
  return parts.length === 1 ? parts[0]! : parts.join(alt('. ', ' and '));
}

/**
 * FAST5 T57 (CR 613.1d, 613.1f, 613.4b): a continuous effect on one object that sets its subtype and base power and toughness and takes away all its abilities
 * (and nothing else): `rest` is the effect's modifications without the loss, which read as "is a Turtle with base power and toughness 0/1". Null for any other.
 */
export function identityAndLoseAll(e: ContinuousEffectDef): { rest: ContinuousEffectDef['mods']; lose: Extract<ContinuousEffectDef['mods'][number], { layer: 6 }> } | null {
  const l6 = e.mods.filter((m): m is Extract<typeof m, { layer: 6 }> => m.layer === 6);
  const one = l6[0];
  if (e.cda === true || l6.length !== 1 || one === undefined || one.removeAll !== true || one.remove !== undefined || one.cantHave !== undefined) return null;
  if (e.mods.filter((m) => m.layer === 4).length !== 1 || e.mods.filter((m) => m.layer === '7b').length !== 1 || e.mods.length !== 3) return null;
  return { rest: e.mods.filter((m) => m.layer !== 6), lose: one };
}

/** One object (not a set, not a player): the subject Oracle can say once for two effects. */
const isOneObject = (r: ObjRef | PlayerRef, st: RenderState): boolean => r.ref !== 'each' && !isPlayerRef(r, st);

/** "its activated abilities can't be activated": a ban on activating the abilities of the subject object itself (CR 602.5; statics/hooks.ts asks `activate`
 * with the source as the subject). */
function isOwnActivateBan(x: StaticEffect, subject: ObjRef | PlayerRef, st: RenderState, exceptMana = false): boolean {
  return x.s === 'restrict' && x.mode === 'cant' && x.action === 'activate' && x.other === undefined && x.max === undefined && x.when === undefined
    && (exceptMana || x.exceptMana === undefined) && isOneObject(subject, st) && JSON.stringify(x.subject) === JSON.stringify(subject);
}

/** Cloud C3 (batch 3): "it assigns combat damage equal to its toughness rather than its power" of the object the source is attached to, always (no `onlyIf`). */
const isAttachedToughnessDamage = (x: StaticEffect): boolean => x.s === 'rule' && x.rule === 'combatDamageUsesToughness' && x.onlyIf === undefined
  && x.value === undefined && x.player === undefined && JSON.stringify(x.of) === '{"attachedToSource":true}';

/** p2-combat-flow-1 (CR 510.1a, 702.3b): an always-on toughness-damage rule of a group you control, then the permission to attack as though without defender of
 * the same group, nothing else. */
function toughnessDamageNoDefender(e: StaticEffect, n: StaticEffect): boolean {
  if (e.s !== 'rule' || e.rule !== 'combatDamageUsesToughness' || e.onlyIf !== undefined || e.value !== undefined || e.player !== undefined || e.of === undefined) return false;
  if ((e.of as ObjectFilter).controller !== 'you' || n.s !== 'permit' || n.action !== 'attackAsThoughNoDefender' || JSON.stringify(n.who) !== '{"ref":"you"}') return false;
  return Object.keys(n).sort().join(',') === 'action,of,s,who' && JSON.stringify(n.of) === JSON.stringify(e.of);
}

/** FAST4 T33: the words of an attackPlayer ban on you with an attack ban on the planeswalkers you control. */
const ATTACK_YOU = "can't attack you or planeswalkers you control";

/**
 * Cloud C3 (batch 3): a continuous effect of one object (not a characteristic-defining one), then optionally its plain "must be blocked if able" (CR 509.1c), then
 * its static goad (`RestrictionDef.goad`, CR 701.15a-c) as the last effect of the run: the predicates said after the changes, in one list. Null otherwise.
 */
function goadRiders(effects: readonly StaticEffect[], i: number, st: RenderState): { extra: string[]; n: number } | null {
  const e = effects[i]!;
  // trek-8: also a group ("All Tribbles get +1/+0 and are goaded": the same description changed and goaded, "are goaded" for the plural subject)
  const group = e.s === 'continuous' && isEachGroup(e.affects);
  if (e.s !== 'continuous' || e.cda === true || !(group || isOneObject(e.affects, st))) return null;
  const same = (r: RestrictionDef): boolean => JSON.stringify(r.subject) === JSON.stringify(e.affects)
    && r.other === undefined && r.otherPlayer === undefined && r.max === undefined && r.min === undefined && r.when === undefined && r.alone === undefined && r.exceptMana === undefined;
  const extra: string[] = [];
  for (let j = i + 1; j < effects.length; j++) {
    const r = effects[j]!;
    if (r.s !== 'restrict' || !same(r) || r.mode !== 'mustIfAble') return null;
    if (r.goad === true && r.action === 'attack') return { extra: [...extra, group ? 'are goaded' : 'is goaded'], n: j - i + 1 };
    if (r.goad === undefined && r.action === 'beBlocked' && extra.length === 0) extra.push('must be blocked if able');
    else return null;
  }
  return null;
}

/**
 * FAST4 T33: "can't attack you or planeswalkers you control" (CR 508.1b-c): a `cant` attackPlayer of the player "you" and a `cant` attack of the planeswalkers
 * you control (`other`), of one subject, nothing else (a battle you protect stays attackable: Oracle does not name it).
 */
function attackYouPair(e: StaticEffect, r: StaticEffect): boolean {
  if (e.s !== 'restrict' || r.s !== 'restrict' || e.mode !== 'cant' || r.mode !== 'cant' || e.action !== 'attackPlayer' || r.action !== 'attack') return false;
  if (JSON.stringify(e.otherPlayer) !== '{"ref":"you"}' || e.other !== undefined || e.max !== undefined || e.when !== undefined || e.exceptMana !== undefined) return false;
  if (JSON.stringify(r.other) !== '{"types":["Planeswalker"],"controller":"you"}' || r.otherPlayer !== undefined || r.max !== undefined || r.when !== undefined) return false;
  return r.exceptMana === undefined && JSON.stringify(e.subject) === JSON.stringify(r.subject);
}

/** edh-perms-17 (CR 701.21a): a plain `cant` beSacrificed: no filter, limit or condition. */
function isPlainCantSacrificed(e: StaticEffect): boolean {
  return e.s === 'restrict' && e.mode === 'cant' && e.action === 'beSacrificed' && e.other === undefined && e.otherPlayer === undefined && e.max === undefined && e.min === undefined
    && e.when === undefined && e.alone === undefined && e.exceptMana === undefined && e.goad === undefined;
}

/** edh-c-17 (CR 613.4c, 205.1): a plain power/toughness change of the group `{allTypes: ['creature'], types: [one type]}` (Earth Surge). */
function isCreatureOnlyPump(e: StaticEffect): e is ContinuousEffectDef {
  if (e.s !== 'continuous' || e.affects.ref !== 'each' || !('filter' in e.affects) || e.mods.length !== 1 || Object.keys(e).some((k) => !['s', 'affects', 'mods'].includes(k))) return false;
  const m = e.mods[0]!;
  if (m.layer !== '7c' || Object.keys(m).some((k) => !['layer', 'power', 'toughness'].includes(k))) return false;
  const f = e.affects.filter;
  return JSON.stringify(f.allTypes) === '["Creature"]' && Object.keys(f).length === 2 && f.types?.length === 1;
}
function withoutCreatureType(f: ObjectFilter): ObjectFilter {
  const { allTypes: _gone, ...rest } = f;
  return rest;
}

/** edh-perms-17 (CR 508.1d): the source's own plain `mustIfAble` attack. */
function isOwnMustAttack(e: StaticEffect): boolean {
  return e.s === 'restrict' && e.mode === 'mustIfAble' && e.action === 'attack' && JSON.stringify(e.subject) === '{"ref":"self"}' && e.other === undefined && e.otherPlayer === undefined
    && e.max === undefined && e.min === undefined && e.when === undefined && e.alone === undefined && e.goad === undefined && e.exceptMana === undefined;
}

/** edh-perms-17 (CR 508.1b-c): the source's own plain `cant` attackPlayer of one player ("~ can't attack its owner", "~ can't attack you"). */
function isOwnCantAttackOwner(e: StaticEffect): boolean {
  return e.s === 'restrict' && e.mode === 'cant' && e.action === 'attackPlayer' && JSON.stringify(e.subject) === '{"ref":"self"}' && e.otherPlayer !== undefined
    && e.other === undefined && e.max === undefined && e.min === undefined && e.when === undefined && e.alone === undefined && e.goad === undefined && e.exceptMana === undefined;
}

/** std-rx6 (CR 508.1c): a plain `cant` attackPlayer of the player "you": no filter, limit, condition or other field. */
function isPlainAttackYou(e: StaticEffect): boolean {
  return e.s === 'restrict' && e.mode === 'cant' && e.action === 'attackPlayer' && JSON.stringify(e.otherPlayer) === '{"ref":"you"}' && e.other === undefined
    && e.max === undefined && e.min === undefined && e.when === undefined && e.alone === undefined && e.exceptMana === undefined && e.goad === undefined;
}

/** FAST3 T15: "~ enters tapped" and nothing else: the object's own entering replacement (CR 614.1d), no condition, no choice, not optional. */
function isOwnPlainTappedEntry(e: StaticEffect): e is ReplacementDef {
  if (e.s !== 'replace' || e.condition !== undefined || e.optional !== undefined || e.selfReplacement !== undefined || e.shield !== undefined) return false;
  const ev = e.replaces;
  if (ev.ev !== 'zoneChange' || JSON.stringify(ev.subject) !== '{"self":true}' || ev.to !== 'battlefield' || Object.keys(ev).length !== 3) return false;
  return JSON.stringify(e.body) === '{"b":"enters","tapped":true}';
}

/** FAST4 T29: the text after the subject of a sentence whose subject is "it" or one alternative group (the words of an object named again); null otherwise. */
function afterSubject(text: string): string | null {
  if (text.startsWith('it ')) return text.slice('it'.length);
  if (!text.startsWith(ALT_OPEN)) return null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ALT_OPEN) depth++;
    else if (text[i] === ALT_CLOSE && --depth === 0) return text.slice(i + 1);
  }
  return null;
}

/** FAST4 T29: a plain "can't be blocked" of one subject: no exception, no limit, no condition. */
const isPlainBeBlocked = (x: StaticEffect): boolean => x.s === 'restrict' && x.mode === 'cant' && x.action === 'beBlocked' && x.other === undefined && x.max === undefined && x.when === undefined;

/** FAST4 T29: a continuous effect that only grants abilities (one layer 6 modification that adds and removes nothing). */
const isPlainGrant = (x: StaticEffect): boolean => x.s === 'continuous' && x.cda !== true && x.mods.length === 1 && x.mods[0]!.layer === 6
  && (x.mods[0] as { add?: unknown[] }).add !== undefined && Object.keys(x.mods[0]!).every((k) => k === 'layer' || k === 'add');

/**
 * std-mkm: a continuous effect of one object (no condition, not a characteristic-defining ability) whose only modifications are a plain grant of abilities
 * (layer 6, `add` alone) and a P/T change (layer 7c), split into the two, else null.
 */
function pumpAndGrant(x: StaticEffect): { e: ContinuousEffectDef; pump: ContinuousEffectDef['mods'][number]; grant: ContinuousEffectDef['mods'][number] } | null {
  if (x.s !== 'continuous' || x.cda === true || x.mods.length !== 2 || Object.keys(x).some((k) => !['s', 'affects', 'mods'].includes(k))) return null;
  const grant = x.mods.find((m) => m.layer === 6);
  const pump = x.mods.find((m) => m.layer === '7c');
  if (grant === undefined || pump === undefined || !isPlainGrant({ ...x, mods: [grant] })) return null;
  return { e: x, pump, grant };
}

/** FAST5X E28: "you and <objects> have hexproof" for [the player's hexproof, a grant of hexproof alone to each object of a group], else null. */
function youAndObjsHaveHexproof(r: StaticEffect, c: StaticEffect, st: RenderState): string | null {
  if (r.s !== 'restrict' || c.s !== 'continuous' || c.cda === true) return null;
  if (JSON.stringify(r.subject) !== '{"ref":"you"}' || r.mode !== 'cant' || r.action !== 'beTargeted' || JSON.stringify(r.other) !== '{"controller":"opponent"}') return null;
  if (Object.keys(r).some((k) => !['s', 'subject', 'mode', 'action', 'other'].includes(k))) return null;
  if (c.affects.ref !== 'each' || !('filter' in c.affects) || !isPlainGrant(c) || Object.keys(c).some((k) => !['s', 'affects', 'mods'].includes(k))) return null;
  const add = (c.mods[0] as { add: unknown[] }).add;
  const k = add[0] as { kind?: string; keyword?: string } & Record<string, unknown>;
  if (add.length !== 1 || k.kind !== 'keyword' || k.keyword !== 'hexproof' || Object.keys(k).some((x) => !['kind', 'keyword', 'text'].includes(x))) return null;
  // edh-perms-2 (Shalai, Voice of Plenty; sta.edhpm2.youAndTwoGroups.hexproof): two groups, each said in full ("you, planeswalkers you control, and other creatures you control have hexproof")
  const two = c.affects.filter.anyOf;
  if (two !== undefined && two.length === 2 && c.affects.filter.zone === 'any' && Object.keys(c.affects.filter).length === 2) {
    return `you, ${K.np(two[0]!, st, { det: 'none', plural: true })}, and ${K.np(two[1]!, st, { det: 'none', plural: true })} have hexproof`;
  }
  return `you and ${K.np(c.affects.filter, st, { det: 'none', plural: true })} have hexproof`;
}

/**
 * FAST1 T5 (family shared-subject): a P/T change of one object followed by a combat restriction or requirement of the same object reads as one sentence with
 * the subject said once: "Enchanted creature gets +2/+1 and can't block", "... and attacks each combat if able" (CR 613.4c, 509.1b, 508.1d). Null when the
 * pair is not of that form; the two sentences stay a reading as before.
 */
function sharedSubject(e: StaticEffect, r: StaticEffect, st: RenderState): string | null {
  // FAST5X E28 (CR 702.11c, 702.11b, 613.1f): "you and other Heroes you control have hexproof": the player's hexproof ("you can't be the target of spells or
  // abilities your opponents control") and the same keyword granted to a group of objects (the static form of FAST5X E1's "you and ... gain hexproof")
  const youAnd = youAndObjsHaveHexproof(e, r, st);
  if (youAnd !== null) return alt(youAnd, [staticEffect(e, st), staticEffect(r, st)].join('. '));
  // "Enchanted permanent doesn't untap during its controller's untap step and its activated abilities can't be activated" (CR 502.3, 602.5)
  if (e.s === 'restrict' && e.mode === 'cant' && e.action === 'untapDuringUntapStep' && e.other === undefined && e.max === undefined && e.when === undefined
    && isOwnActivateBan(r, e.subject, st)) {
    const [merged, apart] = withVariants(st, [
      (v) => `${staticEffect(e, v)} and its activated abilities can't be activated`,
      (v) => [staticEffect(e, v), staticEffect(r, v)].join(alt('. ', ' and ')),
    ]);
    return alt(merged!, apart!);
  }
  // trek-1 (CR 502.3, 101.2; Star Trek beam me up, CR 702 rule number unverified): "Enchanted permanent doesn't untap during its controller's untap step and can't be
  // beamed up" (Marooned): the untap restriction and the beam me up restriction of the same object, the subject said once
  if (e.s === 'restrict' && e.mode === 'cant' && e.action === 'untapDuringUntapStep' && e.other === undefined && e.max === undefined && e.when === undefined
    && r.s === 'restrict' && r.mode === 'cant' && r.action === 'beBeamedUp' && Object.keys(r).length === 4 && JSON.stringify(r.subject) === JSON.stringify(e.subject)) {
    return `${staticEffect(e, st)} and can't be beamed up`;
  }
  // FAST3 T15: "~ enters tapped and doesn't untap during your untap step": the object's own entering replacement (CR 614.1d) and its untap restriction
  // (CR 502.3) with the subject said once (family shared-subject)
  if (isOwnPlainTappedEntry(e) && r.s === 'restrict' && r.mode === 'cant' && r.action === 'untapDuringUntapStep' && r.subject.ref === 'self'
    && r.other === undefined && r.max === undefined && r.when === undefined) {
    const [merged, apart] = withVariants(st, [
      (v) => `${staticEffect(e, v)} and ${restrictFor(r, v, '', false).trim()}`,
      (v) => [staticEffect(e, v), staticEffect(r, v)].join(alt('. ', ' and ')), // the two sentences, as staticEffects writes them without this group
    ]);
    return alt(merged!, apart!);
  }
  // FAST4 T29: "Equipped creature can't be blocked and has hexproof" (the restriction first, then a grant of abilities to the same object; CR 509.1b, 613.1f)
  if (e.s === 'restrict' && r.s === 'continuous' && isPlainBeBlocked(e) && isPlainGrant(r) && isOneObject(r.affects, st) && JSON.stringify(e.subject) === JSON.stringify(r.affects)) {
    const [merged, apart] = withVariants(st, [
      (v) => {
        const first = staticEffect(e, v);
        const second = staticEffect(r, v);
        // the second sentence names the object again ("it" or its noun, render/refs.ts): said once, the subject of both verbs
        const rest = afterSubject(second);
        return rest !== null && rest.startsWith(' has ') ? `${first} and${rest}` : [first, second].join('. ');
      },
      (v) => [staticEffect(e, v), staticEffect(r, v)].join(alt('. ', ' and ')),
    ]);
    return alt(merged!, apart!);
  }
  // std-ru (CR 508.1b, 613.1f; family shared-subject): "~ can't be attacked and has "..."" (The Aetherspark): the ban on attacking the source, then a grant of abilities
  // to the source itself, the subject said once (as FAST4 T29's "can't be blocked and has")
  if (isCantBeAttackedSelf(e) && r.s === 'continuous' && isPlainGrant(r) && r.affects.ref === 'self') {
    const [merged, apart] = withVariants(st, [
      (v) => {
        const first = staticEffect(e, v);
        const rest = afterSubject(staticEffect(r, v));
        return rest !== null && rest.startsWith(' has ') ? `${K.obj({ ref: 'self' }, v, 'subject').text} can't be attacked and${rest}` : `${first}. ${staticEffect(r, v)}`;
      },
      (v) => [staticEffect(e, v), staticEffect(r, v)].join(alt('. ', ' and ')),
    ]);
    return alt(merged!, apart!);
  }
  // r4-static (CR 613.4c, 509.1b; family shared-subject-group-evasion): "Spiders you control get +1/+1 and can't be blocked by creatures with defender": a P/T change
  // of a group or one object and a restriction on who can block the same objects, the subject said once
  // edh-perms-5 (CR 613.4b; Wrecking Ball Arm): also a base power and toughness, "Equipped creature has base power and toughness 7/7 and can't be blocked by ..."
  if (e.s === 'continuous' && r.s === 'restrict' && e.cda !== true && e.mods.length === 1 && (e.mods[0]!.layer === '7c' || e.mods[0]!.layer === '7b' || isPlainGrant(e)) && r.mode === 'cant' && r.action === 'beBlockedBy' // edh-c-92 (CR 613.1f, 509.1b; Cloak of Invisibility): also a plain grant, "Enchanted creature has phasing and can't be blocked except by Walls"
    && r.other !== undefined && r.max === undefined && r.min === undefined && r.when === undefined && JSON.stringify(r.subject) === JSON.stringify(e.affects)) {
    const [merged, apart] = withVariants(st, [
      (v) => {
        const first = staticEffect(e, v);
        const plural = K.obj(e.affects as ObjRef, v, 'subject').plural;
        return `${first} and ${restrictFor(r, v, '', plural).trim()}`;
      },
      (v) => [staticEffect(e, v), staticEffect(r, v)].join('. '),
    ]);
    return alt(merged!, apart!);
  }
  // std-rx33 (CR 613.4c, 613.1f, 509.1a; family gets-has-can-block-additional): "Enchanted creature gets +2/+2, has vigilance, and can block an additional creature
  // each combat": a P/T change and a plain grant of abilities of the attached object, then the rule that it may block one more creature, the subject said once
  const pg = pumpAndGrant(e);
  if (pg !== null && JSON.stringify(pg.e.affects) === '{"ref":"attachedTo"}' && r.s === 'rule' && r.rule === 'extraBlockers' && r.value === 1
    && JSON.stringify(r.of) === '{"is":{"ref":"attachedTo"}}' && Object.keys(r).every((k) => ['s', 'rule', 'value', 'of'].includes(k))) {
    const [merged, apart] = withVariants(st, [
      (v) => {
        const first = staticEffect({ ...pg.e, mods: [pg.pump] }, v);
        const has = afterSubject(staticEffect({ ...pg.e, mods: [pg.grant] }, v));
        return has !== null && has.startsWith(' has ') ? `${first},${has}, and can block an additional creature each combat` : [staticEffect(e, v), staticEffect(r, v)].join('. ');
      },
      (v) => [staticEffect(e, v), staticEffect(r, v)].join('. '),
    ]);
    return alt(merged!, apart!);
  }
  // edh-c-22 (CR 509.1a, 604.1, 613.1f; family has-and-can-block-additional-number; Hundred-Handed One): "it has reach and can block an additional ninety-nine creatures each combat": a plain grant of
  // abilities to the source and the rule that it may block that many more creatures, the subject said once
  if (e.s === 'continuous' && JSON.stringify(e.affects) === '{"ref":"self"}' && e.cda !== true && e.mods.length === 1 && e.mods[0]!.layer === 6 && r.s === 'rule' && r.rule === 'extraBlockers'
    && typeof r.value === 'number' && r.value > 1 && JSON.stringify(r.of) === '{"self":true}' && Object.keys(r).every((k) => ['s', 'rule', 'value', 'of'].includes(k))) {
    const [merged, apart] = withVariants(st, [
      (v) => {
        const first = staticEffect(e, v);
        return /^[^.]* has [^.]*$/.test(first) ? `${first} and can block an additional ${numWord(r.value as number)} creatures each combat` : [first, staticEffect(r, v)].join('. ');
      },
      (v) => [staticEffect(e, v), staticEffect(r, v)].join('. '),
    ]);
    return alt(merged!, apart!);
  }
  // trek-19 (CR 613.4c, 205.1a, 509.1b; De-evolve): "Enchanted creature gets -4/-0, can't block, and is a Salamander": the object's
  // creature type set (layer 4, `subtypes.set`) and a P/T change (layer 7c), then the plain ban on blocking, the subject said once in a list of three
  if (e.s === 'continuous' && r.s === 'restrict' && e.cda !== true && e.mods.length === 2 && Object.keys(e).every((k) => ['s', 'affects', 'mods'].includes(k))
    && r.mode === 'cant' && r.action === 'block' && Object.keys(r).every((k) => ['s', 'subject', 'mode', 'action'].includes(k)) && JSON.stringify(r.subject) === JSON.stringify(e.affects)) {
    const pump = e.mods.find((m) => m.layer === '7c');
    const type = e.mods.find((m) => m.layer === 4 && Object.keys(m).every((k) => k === 'layer' || k === 'subtypes') && (m as { subtypes?: { set?: unknown } }).subtypes?.set !== undefined);
    if (pump !== undefined && type !== undefined) {
      const first = staticEffect({ ...e, mods: [pump] }, st);
      const is = afterSubject(staticEffect({ ...e, mods: [type] }, st));
      if (is !== null && is.startsWith(' is ')) return `${first}, can't block, and${is}`;
    }
  }
  if (e.s !== 'continuous' || r.s !== 'restrict' || e.cda === true || !isOneObject(e.affects, st)) return null;
  // FAST5 T57 (CR 613.1d, 613.1f, 613.4b, 508.1c): "Enchanted creature is a Turtle with base power and toughness 0/1. It can't attack and loses all abilities."
  const lost = identityAndLoseAll(e);
  if (lost !== null && r.mode === 'cant' && r.action === 'attack' && r.other === undefined && r.max === undefined && r.when === undefined && r.min === undefined
    && JSON.stringify(r.subject) === JSON.stringify(e.affects)) {
    const [riders, apart] = withVariants(st, [
      (v) => `${staticEffect({ ...e, mods: lost.rest }, v)}. it can't attack and loses all abilities`,
      (v) => [staticEffect(e, v), staticEffect(r, v)].join(alt('. ', ' and ')),
    ]);
    return alt(riders!, apart!);
  }
  // std-mkm (CR 613.4c, 613.1f, 509.1b): "Equipped creature gets +1/+2, has reach, and can't be blocked by more than one creature": a P/T change and a plain
  // grant of abilities of one object, then a blocking restriction of the same object, the subject said once in a list of three
  const pumpGrant = pumpAndGrant(e);
  // edh-combat-1 (CR 508.1d; Dragon's Rage Channeler): also the plain requirement "and attacks each combat if able" (`mustIfAble` attack: no other field)
  const attacksEach = r.s === 'restrict' && r.mode === 'mustIfAble' && r.action === 'attack' && r.other === undefined && r.otherPlayer === undefined && r.max === undefined && r.min === undefined
    && r.alone === undefined && r.goad === undefined && r.exceptMana === undefined && r.alreadyAttacked === undefined;
  if (pumpGrant !== null && r.s === 'restrict' && ((r.mode === 'cant' && r.action === 'beBlocked') || attacksEach) && r.other === undefined && r.when === undefined && r.min === undefined
    && JSON.stringify(r.subject) === JSON.stringify(e.affects)) {
    const [merged, apart] = withVariants(st, [
      (v) => {
        const first = staticEffect({ ...pumpGrant.e, mods: [pumpGrant.pump] }, v);
        const has = afterSubject(staticEffect({ ...pumpGrant.e, mods: [pumpGrant.grant] }, v));
        const plural = K.obj(e.affects as ObjRef, v, 'subject').plural;
        return has !== null && /^ ha(s|ve) /.test(has) ? `${first},${has}, and ${restrictFor(r, v, '', plural).trim()}` : [staticEffect(e, v), staticEffect(r, v)].join('. ');
      },
      (v) => [staticEffect(e, v), staticEffect(r, v)].join(alt('. ', ' and ')),
    ]);
    return alt(merged!, apart!);
  }
  // edh-c-50 (CR 205.1b, 613.4b, 509.1b; Futurist Operative; family subtypes-basept-cant-be-blocked): "~ is a Human Citizen with base power and toughness 1/1 and can't be blocked": the creature
  // types it becomes (replacing its own) with a base power and toughness, then a plain blocking ban of the same object, the subject said once
  if (e.s === 'continuous' && e.mods.length === 2 && e.mods[0]!.layer === 4 && e.mods[1]!.layer === '7b' && Object.keys(e.mods[0]!).join() === 'layer,subtypes'
    && r.s === 'restrict' && r.mode === 'cant' && r.action === 'beBlocked' && r.other === undefined && r.max === undefined && r.when === undefined && r.min === undefined
    && JSON.stringify(r.subject) === JSON.stringify(e.affects)) {
    const [merged, apart] = withVariants(st, [
      (v) => `${staticEffect(e, v)} and ${restrictFor(r, v, '', K.obj(e.affects as ObjRef, v, 'subject').plural).trim()}`,
      (v) => [staticEffect(e, v), staticEffect(r, v)].join('. '),
    ]);
    return alt(merged!, apart!);
  }
  // edh-perms-1 (CR 613.1d, 613.1f, 509.1b; Brotherhood Regalia): "Equipped creature has ward {2}, is an Assassin in addition to its other types, and can't be blocked.": a plain
  // grant of abilities and an added creature type of one object, then a plain blocking ban of the same object, the subject said once in a list of three
  const typeGrant = e.mods.length === 2 && Object.keys(e).every((k) => ['s', 'affects', 'mods'].includes(k)) ? { type: e.mods.find((m) => m.layer === 4), grant: e.mods.find((m) => m.layer === 6) } : null;
  if (typeGrant?.type !== undefined && typeGrant.grant !== undefined && Object.keys(typeGrant.type).join() === 'layer,subtypes' && isPlainGrant({ ...e, mods: [typeGrant.grant] })
    && r.s === 'restrict' && r.mode === 'cant' && r.action === 'beBlocked' && r.other === undefined && r.max === undefined && r.when === undefined && r.min === undefined
    && JSON.stringify(r.subject) === JSON.stringify(e.affects)) {
    const first = staticEffect({ ...e, mods: [typeGrant.grant] }, st);
    const type = afterSubject(staticEffect({ ...e, mods: [typeGrant.type] }, st));
    const plural = K.obj(e.affects as ObjRef, st, 'subject').plural;
    if (type !== null && /^ (is|are) /.test(type)) return `${first},${type}, and ${restrictFor(r, st, '', plural).trim()}`;
  }
  // FAST4 T29: ... and a grant of abilities before "can't be blocked", "Equipped creature has hexproof and can't be blocked" (CR 613.1f, 509.1b)
  // FAST4 T33: ... and "loses all abilities and can't become untapped" (CR 613.1f, 502.3)
  const loseAll = e.mods.length === 1 && e.mods[0]!.layer === 6 && JSON.stringify(e.mods[0]) === '{"layer":6,"removeAll":true}';
  if (e.mods.length !== 1 || !(e.mods[0]!.layer === '7c' || (isPlainGrant(e) && r.mode === 'cant' && r.action === 'beBlocked')
    // r3-static (CR 613.1f, 509.1c): "it has first strike and must be blocked if able" (The Masamune)
    || (isPlainGrant(e) && r.mode === 'mustIfAble' && r.action === 'beBlocked') || (loseAll && r.mode === 'cant' && (r.action === 'untap' || r.action === 'untapDuringUntapStep')))) return null;
  // MX5: ... also "and can't be blocked by more than one creature" (a limit on the blockers, CR 509.1b)
  const blockLimit = r.max !== undefined && r.mode === 'cant' && r.action === 'beBlocked';
  // Cloud C3 (batch 3): "Enchanted creature gets -1/-1, and its activated abilities can't be activated" (CR 613.4c, 602.5): a new subject after the comma, Oracle's form
  if (e.mods[0]!.layer === '7c' && isOwnActivateBan(r, e.affects, st)) return `${staticEffect(e, st)}, and its activated abilities can't be activated`;
  // Cloud C3 (batch 3): ... and "can't be the target of spells" (CR 115.1, 613.4c): a targeting ban with the spells it names
  const targetBan = r.mode === 'cant' && r.action === 'beTargeted' && r.other !== undefined && JSON.stringify(r.other) === '{"stackKind":"spell"}';
  // edh-c-71 (CR 509.1c): ... and "must be blocked by an Eldrazi if able" after a P/T change (a requirement with `other`: one blocker of that description)
  // edh-d-25 (CR 613.1f, 509.1c; Ace's Baseball Bat): ... and after a plain grant of abilities ("it has first strike and must be blocked by a Dalek if able")
  const blockedBy = r.mode === 'mustIfAble' && r.action === 'beBlocked' && r.other !== undefined && (e.mods[0]!.layer === '7c' || isPlainGrant(e));
  if (JSON.stringify(r.subject) !== JSON.stringify(e.affects) || (r.other !== undefined && !targetBan && !blockedBy) || (r.max !== undefined && !blockLimit) || r.when !== undefined) return null;
  // Cloud C3 (batch 3): ... and "doesn't untap during its controller's untap step" after a P/T change ("Equipped creature gets +4/+2 and doesn't untap ...", CR 502.3)
  // std-mkm: ... and "gets +2/+2 and can't become suspected" (CR 701.60a, 101.2)
  const ok = (r.mode === 'cant' && (r.action === 'block' || r.action === 'beBlocked' || r.action === 'attack' || r.action === 'untapDuringUntapStep' || targetBan || (r.action === 'beSuspected' && e.mods[0]!.layer === '7c') || (loseAll && r.action === 'untap')))
    || (r.mode === 'mustIfAble' && (r.action === 'attack' || r.action === 'block' || (r.action === 'beBlocked' && (isPlainGrant(e) || blockedBy))));
  if (!ok) return null;
  const [merged, apart] = withVariants(st, [
    (v) => {
      const first = staticEffect(e, v);
      const plural = K.obj(e.affects as ObjRef, v, 'subject').plural;
      return `${first} and ${restrictFor(r, v, '', plural).trim()}`;
    },
    (v) => [staticEffect(e, v), staticEffect(r, v)].join(alt('. ', ' and ')),
  ]);
  return alt(merged!, apart!);
}

/**
 * FAST2 T9: two effects of one resolved instruction about one object read with the subject said once: a P/T change and "can't be blocked", "can't block" or
 * "can't attack" ("~ gets +1/+0 until end of turn and can't be blocked this turn", CR 611.2c, 509.1b), or a P/T change of the source and the permission to
 * attack as though it didn't have defender ("... and can attack this turn as though it didn't have defender", CR 609.4, 702.3b). Null when the pair is not of
 * that form; the two sentences stay a reading.
 */
export function sharedEffectSubject(e: StaticEffect, r: StaticEffect, duration: Duration, st: RenderState): string | null {
  // r4-static (CR 611.2c, 509.1c): a group too, for "must be blocked this turn if able" ("Each creature you control gets +3/+3 until end of turn and must be blocked
  // this turn if able"): each object of the group gets both
  const groupMust = e.s === 'continuous' && e.affects.ref === 'each' && r.s === 'restrict' && r.mode === 'mustIfAble' && r.action === 'beBlocked';
  // edh-combat-3 (CR 509.1b, 611.2c, 613.1f): a group too, for "can't be blocked by <creatures> this turn" ("Creatures you control gain first strike and trample until
  // end of turn and can't be blocked by creature tokens this turn"): each object of the group gets both
  const groupCantBlockedBy = e.s === 'continuous' && e.affects.ref === 'each' && r.s === 'restrict' && r.mode === 'cant' && r.action === 'beBlockedBy' && r.other !== undefined && r.other.not === undefined;
  // edh-next-84 (CR 509.1b, 611.2a, 613.1f; Agility Bobblehead): a group too, for "can't be blocked this turn except by <creatures>" after a grant ("Up to two target creatures you control each gain
  // haste until end of turn and can't be blocked this turn except by creatures with haste"): the duration sits between the verb and "except by", as the lone ban says it (restrict case below)
  const groupExceptBy = r.s === 'restrict' && r.mode === 'cant' && r.action === 'beBlockedBy' && r.max === undefined && r.when === undefined && r.other !== undefined
    && Object.keys(r.other).length === 1 && r.other.not !== undefined && inlineDuration(duration) !== null;
  // edh-d-44 (CR 509.1b, 611.2c, 613.1f; Glaring Spotlight): and a grant to a group before "can't be blocked this turn" ("Creatures you control gain hexproof until end of turn and can't be blocked this turn")
  const groupGrantCantBeBlocked = e.s === 'continuous' && e.affects.ref === 'each' && e.mods.length === 1 && isPlainGrant(e) && r.s === 'restrict' && r.mode === 'cant' && r.action === 'beBlocked';
  if (e.s !== 'continuous' || e.cda === true || (!isOneObject(e.affects, st) && !groupMust && !groupCantBlockedBy && !groupGrantCantBeBlocked && !groupExceptBy)) return null;
  // FAST4 T33: also a grant of abilities before "can't be blocked this turn" ("gains lifelink until end of turn and can't be blocked this turn", CR 613.1f)
  const grant = e.mods.length === 1 && isPlainGrant(e);
  // Cloud std-eoe: a base power and toughness too ("has base power and toughness 1/1 until end of turn and can't be blocked this turn", CR 613.4b)
  const base = e.mods.length === 1 && e.mods[0]!.layer === '7b';
  // edh-b-1 (CR 205.1b, 611.2c, 509.1b; family shared-subject-resolved): a change of what the object is for the turn too ("~ becomes a 2/2 blue and black Horror artifact creature until end of
  // turn and can't be blocked this turn", Dimir Keyrune): the card types, the colors and the base power and toughness (layers 4, 5, 7b) of one object, said as one clause
  const becomes = e.mods.length === 3 && e.mods[0]!.layer === 4 && e.mods[1]!.layer === 5 && e.mods[2]!.layer === '7b';
  if (!becomes && (e.mods.length !== 1 || (e.mods[0]!.layer !== '7c' && !grant && !base))) return null;
  let second: ((v: RenderState, plural: boolean) => string) | null = null;
  const sameSubject = r.s === 'restrict' && JSON.stringify(r.subject) === JSON.stringify(e.affects) && (r.other === undefined || (r.action === 'beBlockedBy' && r.mode === 'cant' && (r.other.not === undefined || groupExceptBy))) && r.max === undefined && r.when === undefined;
  if (r.s === 'restrict' && sameSubject && groupExceptBy && grant) {
    // edh-next-84 (family cant-be-blocked-this-turn-except-by-pair): the pair of a grant and the ban, said "gain haste until end of turn and can't be blocked this turn except by creatures with haste"
    const not = r.other!.not!;
    second = (v) => `can't be blocked ${inlineDuration(duration)!} except by ${K.np(not, v, { det: 'none', plural: true })}`;
  } else if (r.s === 'restrict' && sameSubject && !groupExceptBy && r.mode === 'cant' && (r.action === 'beBlocked' || r.action === 'beBlockedBy' || (!grant && (r.action === 'block' || r.action === 'attack')))) {
    second = (v, plural) => `${restrictFor(r, v, '', plural).trim()}${durationSuffix(duration, v)}`;
  } else if (r.s === 'restrict' && sameSubject && r.mode === 'mustIfAble' && r.action === 'beBlocked' && inlineDuration(duration) !== null) {
    // FAST4 T33: "gets +3/+3 until end of turn and must be blocked this turn if able" (CR 509.1c: the duration sits between the verb and "if able")
    // r4-mech: also after a grant ("gains first strike until end of turn and must be blocked this turn if able", CR 613.1f, 509.1c)
    second = () => `must be blocked ${inlineDuration(duration)!} if able`;
  } else if (r.s === 'permit' && r.action === 'attackAsThoughNoDefender' && e.affects.ref === 'self' && r.of === undefined && r.asThough === undefined
    && r.who.ref === 'you' && duration.d === 'endOfTurn') {
    second = () => alt("can attack this turn as though it didn't have defender", `can attack as though it didn't have defender${durationSuffix(duration, st)}`);
  }
  // edh-c-11 (CR 509.1a, 611.2c; Act of Heroism, eff.edhv11.pump.extraBlock): "gets +2/+2 until end of turn and can block an additional creature this turn": the rule of the same object
  else if (r.s === 'rule' && r.rule === 'extraBlockers' && r.value === 1 && e.mods[0]!.layer === '7c' && duration.d === 'endOfTurn' && r.of !== undefined && JSON.stringify(r.of) === JSON.stringify({ is: e.affects })) {
    second = () => 'can block an additional creature this turn';
  }
  // edh-c-52 (CR 509.1a, 611.2c; Give No Ground, eff.edhv52.pump.blockAnyNumber): the same pair with no limit, "can block any number of creatures this turn"
  else if (r.s === 'rule' && r.rule === 'extraBlockers' && r.value === 'none' && e.mods[0]!.layer === '7c' && duration.d === 'endOfTurn' && r.of !== undefined && JSON.stringify(r.of) === JSON.stringify({ is: e.affects })) {
    second = () => 'can block any number of creatures this turn';
  }
  if (second === null) return null;
  const pair = second;
  // Cloud std-eoe (CR 611.2c, 509.1b, 613.4b): the restriction first, then the P/T change of the same object with its own duration ("That creature can't be blocked
  // this turn and has base power and toughness 1/1 until end of turn", Atomic Microsizer); only "can't be blocked" (the restriction that has its own "this turn")
  const restrictFirst = !grant && r.s === 'restrict' && r.mode === 'cant' && r.action === 'beBlocked' && duration.d === 'endOfTurn';
  const [merged, apart, reversed, leadIt] = withVariants(st, [
    (v) => {
      const first = staticEffect(e, v, { duration });
      const plural = K.obj(e.affects as ObjRef, v, 'subject').plural;
      return `${first} and ${pair(v, plural)}`;
    },
    // (edh-next-84: the pair with "except by" has no two-sentence wording, so a "where X is" clause can close the one sentence, program.ts#targetCountWhereX)
    (v) => (groupExceptBy ? `${staticEffect(e, v, { duration })} and ${pair(v, K.obj(e.affects as ObjRef, v, 'subject').plural)}` : [staticEffect(e, v, { duration }), staticEffect(r, v, { duration })].join('. ')),
    (v) => {
      if (!restrictFirst) return null;
      const subj = K.obj(e.affects as ObjRef, v, 'subject');
      const pred = ptPredicate(e, v, subj.plural);
      return pred === null ? null : `${subj.text} ${restrictFor(r as RestrictionDef, v, '', subj.plural).trim()} this turn and ${pred}${durationSuffix(duration, v)}`;
    },
    // edh-d-85 (CR 611.2a, 613.1f, 509.1b; family lead-grant-and-it-cant-be-blocked; Blitzball Stadium, eff.edhd85.dur.lead.grant.andItCantBeBlocked): the duration first, then the
    // grant, then the ban of the same one object said with "it": "Until end of turn, target creature gains "..." and it can't be blocked this turn"
    (v) => {
      if (!grant || r.s !== 'restrict' || r.mode !== 'cant' || r.action !== 'beBlocked' || r.other !== undefined || duration.d !== 'endOfTurn' || !isOneObject(e.affects, v)) return null;
      const subj = K.obj(e.affects as ObjRef, v, 'subject');
      if (subj.plural) return null;
      const list = abilityList((e.mods[0] as { add: AbilityDef[] }).add, v, 'creature');
      // a quoted ability the sentence goes on after has no full stop of its own inside the quotes (Oracle: 'gains "... on it" and it can't be blocked this turn')
      const open = list.endsWith('."') ? list.slice(0, -2) + '"' : list;
      return `${K.dur(duration, v)}, ${subj.text} gains ${open} and it can't be blocked this turn`;
    },
  ]);
  return alt(merged!, apart!, ...(typeof reversed === 'string' ? [reversed] : []), ...(typeof leadIt === 'string' ? [leadIt] : []));
}

/**
 * edh-cast-4 (CR 601.2f, 118.7): the words that complete "This effect reduces only the amount of ___ mana you pay" for a cost reduction of colored mana alone (every part a
 * colored symbol, no generic part, a plain "you" caster): the color's name when all the symbols are of one color, and "colored"; null for any other reduction.
 */
function coloredOnlyReduction(e: StaticEffect): string[] | null {
  if (e.s !== 'costMod' || e.change.coloredOnly !== true || e.change.kind !== 'reduce' || e.change.generic !== undefined || e.change.times !== undefined || e.change.life !== undefined || e.applies.caster !== 'you'
    || e.applies.spells === undefined || e.applies.self === true || e.applies.abilities !== undefined || e.change.mana === undefined || e.change.mana.length === 0) return null;
  if (!e.change.mana.every((m) => m.kind === 'colored')) return null;
  const colors = [...new Set(e.change.mana.map((m) => (m as { color: string }).color))];
  const NAMES: Readonly<Record<string, string>> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
  return colors.length === 1 && NAMES[colors[0]!] !== undefined ? [NAMES[colors[0]!]!, 'colored'] : ['colored'];
}

export function staticEffect(e: StaticEffect, st: RenderState, o: { duration?: Duration } = {}): string {
  switch (e.s) {
    case 'continuous': return continuous(e, st, o.duration, o.duration === undefined);
    case 'costMod': {
      // edh-d-45 (CR 601.2f, 118.7, 105.1; Seal of the Guildpact): "Each spell you cast costs {1} less to cast for each of the chosen colors it is."
      if (e.change.kind === 'reduce' && e.applies.caster === 'you' && e.applies.spells !== undefined && Object.keys(e.applies.spells).length === 0 && !e.applies.self && e.applies.via === undefined && o.duration === undefined
        && e.change.mana !== undefined && e.change.generic === undefined && e.change.floor === undefined && e.change.life === undefined && e.change.coloredOnly === undefined && sameShape(e.change.times, { q: 'chosenColorsOf', link: 'color' })) {
        return `each spell you cast costs ${formatManaCost(e.change.mana)} less to cast for each of the chosen colors it is`;
      }
      // edh-d-45 (CR 702.34a, 601.2f, 118.7; Catalyst Stone): "Flashback costs you pay cost {2} less." / "Flashback costs your opponents pay cost {2} more." (the flashback alternative cost of the spells a player casts)
      if (e.applies.via === 'flashback' && !e.applies.self && e.applies.abilities === undefined && e.applies.spells !== undefined && Object.keys(e.applies.spells).length === 0 && o.duration === undefined
        && e.change.mana !== undefined && e.change.generic === undefined && e.change.times === undefined && e.change.floor === undefined && e.change.life === undefined && e.change.coloredOnly === undefined
        && ((e.applies.caster === 'you' && e.change.kind === 'reduce') || (e.applies.caster === 'opponent' && e.change.kind === 'increase'))) {
        return `flashback costs ${e.applies.caster === 'you' ? 'you pay' : 'your opponents pay'} cost ${formatManaCost(e.change.mana)} ${e.change.kind === 'reduce' ? 'less' : 'more'}`;
      }
      // edh-next-144 (CR 702.152a, 601.2f, 903.8; Henzie "Toolbox" Torre): "Blitz costs you pay cost {1} less for each time you've cast your commander from the command zone this game." (the blitz
      // alternative cost of the spells you cast, reduced by N generic mana for each such cast)
      const perCmd = e.change.generic;
      if (e.applies.via === 'blitz' && e.applies.caster === 'you' && e.change.kind === 'reduce' && !e.applies.self && e.applies.abilities === undefined && e.applies.spells !== undefined && Object.keys(e.applies.spells).length === 0
        && o.duration === undefined && e.change.mana === undefined && e.change.times === undefined && e.change.floor === 'zero' && e.change.life === undefined && e.change.coloredOnly === undefined
        && typeof perCmd === 'object' && perCmd.q === 'math' && perCmd.op === '*' && perCmd.args.length === 2 && typeof perCmd.args[0] === 'number' && sameShape(perCmd.args[1], { q: 'commanderCasts' })) {
        return `blitz costs you pay cost {${perCmd.args[0]}} less for each time you've cast your commander from the command zone this game`;
      }
      // "Creature spells you cast this turn cost {1} less to cast" (the duration inside) is Oracle's order for spells; the others take it at the end
      const inside = e.applies.spells && !e.applies.self && !e.applies.abilities ? inlineDuration(o.duration) : null;
      const base = lasting(costMod(e, st), o.duration, st);
      // edh-cast-4 (CR 601.2f, 118.7; family colored-reduction-reminder): a reduction of colored mana alone (`coloredOnly`) is said with Oracle's explanatory sentence,
      // "This effect reduces only the amount of green mana you pay." (one color) or "... of colored mana ..." (any colors)
      const coloredWord = o.duration === undefined ? coloredOnlyReduction(e) : null;
      if (coloredWord !== null) return alt(...coloredWord.map((w) => `${base}. this effect reduces only the amount of ${w} mana you pay`));
      if (e.change.coloredOnly === true) throw new NoRenderer('a reduction of colored mana alone with more than the explanatory sentence');
      return inside === null ? base : alt(costMod(e, st, inside), base);
    }
    case 'restrict': {
      // edh-next-143 (CR 116.2d; Leonin Arbiter): "Players can't search libraries. Any player may pay {2} for that player to ignore this effect until end of turn.": the ban of every
      // player with the special action that ignores it; that exact shape only (any other restriction with `ignoreFor` has no wording)
      if (e.ignoreFor !== undefined) {
        const { ignoreFor, ...ban } = e;
        if (o.duration !== undefined || e.mode !== 'cant' || JSON.stringify(e.subject) !== '{"ref":"each","who":"player"}' || Object.keys(ignoreFor).some((k) => k !== 'mana') || ignoreFor.mana === undefined || ignoreFor.mana.length === 0) throw new NoRenderer('a restriction a player may pay to ignore, other than a static ban of every player paid with mana');
        return `${staticEffect(ban, st, o)}. any player may pay ${formatManaCost(ignoreFor.mana)} for that player to ignore this effect until end of turn`;
      }
      // M6-7: a requirement with the duration inside ("attacks this turn if able", "able to block X this turn do so") or that names the other creature
      const req = e.mode === 'mustIfAble' && (e.other !== undefined || inlineDuration(o.duration) !== null) ? requirementWithOther(e, st, inlineDuration(o.duration)) : null;
      if (req !== null) {
        // Oracle prints these with the duration inside only ("attacks this turn if able"); no card says "attacks each combat if able until end of turn"
        return inlineDuration(o.duration) === null ? lasting(req, o.duration, st) : req;
      }
      // FAST3 T16: "~ can't be blocked this turn except by creatures with haste" (CR 509.1b, 611.2a): the duration sits between the verb and "except by"
      const except = e.mode === 'cant' && e.action === 'beBlockedBy' && e.max === undefined && e.when === undefined && e.other !== undefined
        && Object.keys(e.other).length === 1 && e.other.not !== undefined ? inlineDuration(o.duration) : null;
      if (except !== null) {
        const not = e.other!.not!;
        const [whole, inside] = withVariants(st, [
          (v) => lasting(restrict(e, v), o.duration, v),
          (v) => withSubjects(e.subject, v, (sj) => `${sj} can't be blocked ${except} except by ${K.np(not, v, { det: 'none', plural: true })}`),
        ]);
        return alt(whole!, inside!);
      }
      // FAST4 T33: a static ability's "can't" with its condition after it reads "if" as well as "as long as" ("~ can't be blocked if you've cast two or more
      // spells this turn"): the condition of a static ability is checked continuously either way (CR 604.1, 611.3a; family static-if). Never for a resolved
      // effect, whose "if" is checked once as it resolves (CR 608.2c).
      if (o.duration === undefined && e.mode === 'cant' && e.when !== undefined && e.other === undefined && e.max === undefined) {
        const { when, ...bare } = e;
        // edh-c-8 (Exquisite Firecraft): the condition may lead the sentence with "if" as well ("If there are two or more instant and/or sorcery cards in your graveyard, ~ can't be countered")
        const [asLong, iff, leadIf] = withVariants(st, [(v) => restrict(e, v), (v) => `${restrict(bare, v)} if ${K.cond(when, v)}`, (v) => `if ${K.cond(when, v)}, ${restrict(bare, v)}`]);
        return alt(asLong!, iff!, leadIf!);
      }
      // MX5: "It doesn't untap during its controller's next untap step", "Lands you control don't untap during your next untap step" (CR 502.3, 611.2a): the
      // duration is the untap step itself, said once
      if (o.duration?.d === 'throughNextUntap') {
        if (e.mode !== 'cant' || e.action !== 'untapDuringUntapStep' || e.other !== undefined || e.max !== undefined || e.when !== undefined) {
          throw new NoRenderer('a duration through the next untap step on another restriction');
        }
        return nextUntapRestriction(e, o.duration, st);
      }
      // Cloud C3 (batch 3): a goad that a resolved effect makes last for good (CR 611.2a) is said with its duration: no other goad does (the goad action lasts
      // until the goader's next turn, CR 701.15a)
      if (e.goad === true && o.duration?.d === 'permanent') return `${restrict(e, st)} for the rest of the game`;
      const plain = restrict(e, st);
      // edh-next-19 (CR 611.2a, 119.7; Stigma Lasher; family cant-gain-life-rest-of-game): "That player can't gain life for the rest of the game." is the ban of a resolved effect with no stated end
      if (e.action === 'gainLife' && e.mode === 'cant' && o.duration?.d === 'permanent' && e.other === undefined) return alt(lasting(plain, o.duration, st), `${plain} for the rest of the game`);
      const base = lasting(plain, o.duration, st);
      // edh-cast-1 (CR 101.2, 601.2a, 611.2a; Domri, Anarch of Bolas; family spells-cast-this-turn-cant-be-countered): "Creature spells you cast this turn can't be countered":
      // the duration sits after "you cast"
      const castInner = e.mode === 'cant' && e.action === 'beCountered' && e.other === undefined && e.max === undefined && e.when === undefined && o.duration?.d === 'endOfTurn'
        && e.subject.ref === 'each' && 'filter' in e.subject ? spellsYouCast(e.subject.filter) : null;
      if (castInner !== null) return alt(base, `${K.np(castInner, st, { det: 'none', plural: true })} you cast this turn can't be countered`);
      // "Target creature must be blocked this turn if able" (CR 509.1c): the duration sits between the verb and "if able"
      const inside0 = e.mode === 'mustIfAble' && e.action === 'beBlocked' ? inlineDuration(o.duration) : null;
      // r4-fxb (family each-combat-this-turn): a requirement lasting the turn applies in each combat of it, "must be blocked each combat this turn if able" (CR 506.1, 509.1c)
      const inside = inside0 === 'this turn' ? alt('this turn', 'each combat this turn') : inside0;
      return inside === null ? base : alt(plain.replace('must be blocked if able', `must be blocked ${inside} if able`), base);
    }
    case 'replace': {
      // edhd63 (CR 614.1a, 120.3, 607.2d; Bitter Feud, template rep.edhd63.damage.doubleBetweenChosenPlayers): the damage one chosen player's sources would deal to the other chosen player or
      // their permanents is doubled; exactly this shape, said whole
      if (JSON.stringify(e) === JSON.stringify(BITTER_FEUD_REPLACEMENT)) return 'if a source controlled by one of the chosen players would deal damage to the other chosen player or a permanent that player controls, that source deals double that damage to that player or permanent instead';
      // edh-d-98 (CR 614.1a, 121.2; Scion of Halaster, template sta.edhd98.firstDraw.lookTwo.oneGraveyard.otherTop.thenDraw): the first draw of the turn replaced by looking at two cards, one
      // into the graveyard, the other back on top, then a draw; exactly this shape, said whole
      if (JSON.stringify(e) === JSON.stringify(FIRST_DRAW_LOOK_TWO)) return 'the first time you would draw a card each turn, instead look at the top two cards of your library. put one of them into your graveyard and the other back on top of your library. then draw a card';
      // the roles of the replaced event are what `{ref:'event'}` means in the body (design 3.5)
      const saved = st.trigger;
      const savedOuter = st.outerTrigger;
      if (saved !== null && saved.length > 0) st.outerTrigger = saved;
      st.trigger = [e.replaces];
      // PUSH1 T2: a prevention without further steps has no body that could read a role, and the replaced event's own words ("damage that would be dealt to
      // it") must not count its roles as other antecedents (design 6.4; the parser makes no mentions of them either)
      if (!(e.body.b === 'prevent' && (e.body.then === undefined || e.body.then.length === 0))) markTriggerRoles(st);
      try {
        return replace(e, st, o.duration);
      } finally {
        st.trigger = saved;
        if (savedOuter === undefined) delete st.outerTrigger;
        else st.outerTrigger = savedOuter;
      }
    }
    case 'permit': {
      // std-exile-play-2-1 (CR 118.9, 202.3, 611.2a; family pay-life-rather-than): a resolved permission for named objects, "You may play those cards this turn. If
      // you cast a spell this way, pay life equal to its mana value rather than pay its mana cost." (statics/play-permits.ts#namedPermitLifeCost): the rider after the
      // permission and its duration
      if (e.costChange?.life !== undefined && e.of?.is !== undefined && e.of.is.ref !== 'linked') {
        const cc = e.costChange as unknown as Record<string, unknown>;
        if (e.costChange.life !== 'manaValue' || e.costChange.kind !== 'set' || Object.keys(cc).some((k) => cc[k] !== undefined && k !== 'kind' && k !== 'life')
          || Object.keys(e.of).length !== 1 || o.duration === undefined) throw new NoRenderer('a life cost on a permission other than "pay life equal to its mana value" for named objects');
        const { costChange: _cc, ...bare } = e;
        return `${staticEffect(bare, st, o)}. if you cast a spell this way, pay life equal to ${alt('its', "that spell's")} mana value rather than ${alt('pay', 'paying')} its mana cost`; // pc-exile-play-4 (family pay-life-that-spells-mana-value)
      }
      // trek-7 (CR 601.2f, 601.3, 611.2a; Zero, Incorporeal Sensate): a resolved permission for ONE named object with the rider "A spell cast this way costs {2} more to
      // cast." after the permission and its duration (statics/play-permits.ts#namedPermitIncrease: a fixed increase of generic mana)
      if (e.costChange?.kind === 'increase' && e.of?.is !== undefined && e.of.is.ref !== 'linked') {
        const cc = e.costChange as unknown as Record<string, unknown>;
        if (e.costChange.mana === undefined || e.costChange.mana.length === 0 || Object.keys(cc).some((k) => cc[k] !== undefined && k !== 'kind' && k !== 'mana')
          || Object.keys(e.of).length !== 1 || o.duration === undefined) throw new NoRenderer('a cost increase on a permission other than "a spell cast this way costs {N} more to cast" for a named object');
        if (K.obj(e.of.is, cloneState(st), 'object').plural) throw new NoRenderer('the cost increase of a permission for several named objects: only the one-card rider has words here');
        const { costChange: increase, increaseIfOpponent, ...bare } = e;
        if (increaseIfOpponent !== undefined && increaseIfOpponent !== true) throw new NoRenderer('an opponent-only cost increase other than true');
        // edh-d-58 (CR 601.2f; Soul Partition): "A spell cast by an opponent this way costs {2} more to cast."
        return `${staticEffect(bare, st, o)}. a spell cast ${increaseIfOpponent === true ? 'by an opponent ' : ''}this way costs ${formatManaCost(increase.mana!)} more to cast`;
      }
      // std-exile-play-2-3 (CR 118.9, 701.67a, 611.2b; Hama, the Bloodbender): "For as long as you control ~, you may cast the exiled card during your turn by
      // waterbending {X} rather than paying its mana cost, where X is its mana value." (statics/play-permits.ts#isWaterbendCost)
      const wb = waterbendPermit(e, st, o.duration);
      if (wb !== null) return wb;
      // std-exile-play-2-4 (CR 611.2a, 611.2c, 202.3; Triple Triad): "until end of turn, you may play the card you own exiled this way and each other card exiled this way
      // with lesser mana value than it without paying their mana costs" (the cards of the group are picked as the effect begins, effects/handlers/lasting.ts)
      const yoursLesser = yoursAndLesserPermit(e, st, o.duration);
      if (yoursLesser !== null) return yoursLesser;
      if (e.anyManaType !== undefined || e.anyManaColor !== undefined || e.colorlessAnyColor !== undefined /* edh-d-97 */ || e.while !== undefined || e.graveyardInstead !== undefined || e.laterTurn !== undefined || e.freeSubtypes !== undefined || e.onCast !== undefined /* edh-next-127 */) return permitRiders(e, st, o.duration);
      if (e.single === true && e.from === 'graveyard') return oneGraveyardSpell(e, st, o.duration); // std-freecast-2
      const preState = e.action === 'attackAsThoughNoDefender' && e.of?.is !== undefined ? cloneState(st) : null; // edh-players-4: the object named in full in each wording
      const preAssign = e.action === 'assignAsUnblocked' ? cloneState(st) : null; // edh-d-25: the object named in full in each wording
      const base = lasting(permit(e, st, isLimited(o.duration)), o.duration, st);
      // edh-zones-7 (CR 611.2a; family permit-free-this-turn-mid): "you may play it this turn without paying its mana cost": the duration between the permission and its cost
      // edh-next-128 (CR 118.9, 611.2a; Yusri, Fortune's Flame): and "you may cast spells from your hand this turn without paying their mana costs" (the same family)
      if ((e.action === 'play' || e.action === 'cast') && (e.of?.is !== undefined || (e.action === 'cast' && e.of?.castFrom === 'hand' && e.who.ref === 'you')) && e.costChange !== undefined && inlineDuration(o.duration) === 'this turn') {
        const mid = permit(e, st, true).replace(/ without paying /, ' this turn without paying ');
        if (mid.includes(' this turn without paying ')) return alt(base, mid);
      }
      // FAST2 T9: "~ can attack this turn as though it didn't have defender" (CR 609.4, 702.3b): the duration between the verb and "as though"
      const inside = e.action === 'attackAsThoughNoDefender' ? inlineDuration(o.duration) : null;
      // FAST3 T15: "You may cast creature spells this turn as though they had flash" (CR 601.3b, 611.2a): the duration between the spells and "as though"
      // edh-d-25 (CR 510.1c, 611.2a; Predatory Focus, Outmaneuver): "assign their combat damage this turn as though they weren't blocked": the duration between the damage and "as though"
      if (e.action === 'assignAsUnblocked' && inlineDuration(o.duration) === 'this turn') {
        return alt(base, permit(e, preAssign!, true).replace(/ as though /, ' this turn as though '));
      }
      const flashInside = e.action === 'haveFlash' ? inlineDuration(o.duration) : null;
      if (flashInside !== null) {
        const plain = permit(e, st, true);
        return alt(base, plain.replace(/ as though /, ` ${flashInside} as though `));
      }
      if (inside === null) return base; // edh-d-86: the inline wording is attackAsThoughNoDefender's only (never said for another permission's `of`)
      // std-rl (CR 611.2a): and a group, "Creatures you control with defender can attack this turn as though they didn't have defender" (permit() checked the group)
      const namedOne = e.action === 'attackAsThoughNoDefender' && preState !== null && e.of !== undefined && Object.keys(e.of).length === 1 && (e.of.is?.ref === 'target' || e.of.is?.ref === 'bound' || e.of.is?.ref === 'self') ? e.of.is : null; // edh-c-110: "~ gets +2/+0 and gains trample until end of turn. It can attack this turn as though it didn't have defender" (Roving Keep)
      const who = namedOne !== null ? `${K.obj(namedOne as ObjRef, preState!, 'subject').text} can attack ${inside} as though it didn't have defender`
        : e.of === undefined ? `${K.obj({ ref: 'self' }, st, 'subject').text} can attack ${inside} as though it didn't have defender` : `${K.np(e.of, st, { det: 'none', plural: true })} can attack ${inside} as though they didn't have defender`;
      return inside === null ? base : alt(base, who);
    }
    case 'rule': {
      // edh-players-6 (CR 606.3, 611.2c; family loyalty-once-more): "For each planeswalker you control, you may activate one of its loyalty abilities once this turn as though
      // none of its loyalty abilities have been activated this turn" (The Chain Veil): one more activation for each planeswalker you control as it resolves
      if (e.rule === 'additionalActivation' && e.keyword === 'loyalty' && e.value === undefined && e.of !== undefined && e.of.is === undefined && o.duration?.d === 'endOfTurn') {
        return `for each ${K.np(e.of, st, { det: 'none' })}, you may activate one of its loyalty abilities once this turn as though none of its loyalty abilities have been activated this turn`;
      }
      const base = lasting(ruleMod(e, st, isLimited(o.duration)), o.duration, st);
      // CLOUD C2 (CR 611.2a, 402.2): a resolved hand-size rule with no stated end lasts for the rest of the game, and its sentence may say so ("You have no
      // maximum hand size for the rest of the game"); a static ability has no duration at all
      const handSize = e.rule === 'handSizeNoLimit' || e.rule === 'maxHandSize';
      return handSize && o.duration?.d === 'permanent' ? alt(`${base} for the rest of the game`, base) : base;
    }
    case 'triggerMod': {
      // CLOUD std-misc: "Creatures entering don't cause abilities to trigger" (Torpor Orb; "entering the battlefield" is normalized by the gate)
      // std-rx32 (CR 702.21a, 603.2): "Ward abilities of creatures your opponents control don't trigger"
      if (e.suppress === true && e.keyword !== undefined) {
        if (e.cause !== undefined || e.additional !== 0 || Object.keys(e.abilitiesOf).length === 0) throw new NoRenderer('a keyword trigger suppression with a cause');
        return lasting(`${e.keyword} abilities of ${K.np(e.abilitiesOf, st, { det: 'none', plural: true })} don't trigger`, o.duration, st);
      }
      if (e.suppress === true) {
        const c = e.cause;
        if (c === undefined || c.ev !== 'zoneChange' || c.to !== 'battlefield' || c.from !== undefined || e.additional !== 0) throw new NoRenderer('a trigger suppression other than of permanents entering');
        const { subject, to: _to, ev: _ev, ...rest } = c;
        if (Object.keys(rest).length > 0) throw new NoRenderer('a trigger suppression of entering with other conditions');
        // edh-players-2 (CR 603.2; Elesh Norn, Mother of Machines): only the abilities of the permanents `abilitiesOf` describes are silenced
        if (Object.keys(e.abilitiesOf).length > 0) return lasting(`${K.np(subject, st, { det: 'none', plural: true })} entering don't cause abilities of ${K.np(e.abilitiesOf, st, { det: 'none', plural: true })} to trigger`, o.duration, st);
        return lasting(`${K.np(subject, st, { det: 'none', plural: true })} entering don't cause abilities to trigger`, o.duration, st);
      }
      if (e.additional === undefined) throw new NoRenderer('triggerMod without an amount');
      const n = e.additional;
      const times = typeof n === 'number' ? (n === 1 ? 'an additional time' : `${numWord(n)} additional times`) : `${K.qty(n, st)} additional times`;
      // r4-fxb (family it-triggers-additional): the ability is also "it", "If a triggered ability of another Elemental you control triggers, it triggers an additional time"
      const that = alt('that ability', 'it');
      // FAST5 T40 (CR 603.2d): no cause is any event, "If a triggered ability of a Ninja creature you control triggers, that ability triggers an additional time"
      // r3-static (CR 603.2d, 301.5): "if a triggered ability of ~ or an Equipment attached to it triggers" (Cloud, Midgar Mercenary): the source or any Equipment on it
      // p2-misc-2 (CR 603.2d, 109.4): "a triggered ability of a colorless spell you control or another colorless permanent you control" (Echoes of Eternity): two
      // descriptions, each said whole (the spell one names the stack, the other one "another")
      const two = Object.keys(e.abilitiesOf).length === 1 && e.abilitiesOf.anyOf?.length === 2 ? e.abilitiesOf.anyOf : null;
      // fail closed: in "a Shaman or another Wizard you control" the one "you control" covers both descriptions, which the union does not say
      if (two !== null && two[0]!.controller === undefined && two[1]!.controller !== undefined) throw new NoRenderer('a union of two descriptions whose controller may be shared');
      const whose = JSON.stringify(e.abilitiesOf) === SELF_OR_ITS_EQUIPMENT ? `${K.obj({ ref: 'self' }, st, 'subject').text} or an equipment attached to it`
        : two !== null && e.cause === undefined ? `${K.np(two[0]!, st, { det: 'a' })} or ${K.np(two[1]!, st, { det: 'a' })}` : K.np(e.abilitiesOf, st, { det: 'a' });
      // edh-mana-keywords-1 (CR 603.2d, 109.4; family trigger-mod-shared-controller): two descriptions of permanents you control are also said with one "you control" for
      // both, "a Shaman or another Wizard you control" (Harmonic Prodigy)
      const shared = two !== null && e.cause === undefined && two[0]!.controller === 'you' && two[1]!.controller === 'you'
        ? `${K.np({ ...two[0]!, controller: undefined }, st, { det: 'a' })} or ${K.np({ ...two[1]!, controller: undefined }, st, { det: 'a' })} you control` : null;
      if (e.cause === undefined) return lasting(`if a triggered ability of ${shared === null ? whose : alt(whose, shared)} triggers, ${that} triggers ${times}`, o.duration, st);
      // std-typechange-2 (CR 603.2d, 114.4): "a triggered ability of this creature or an emblem you own" (The Masamune): the source's own abilities or those of any emblem
      // its controller owns; no other description says emblems
      const caused = JSON.stringify(e.abilitiesOf) === SELF_OR_EMBLEM ? `${K.obj({ ref: 'self' }, st, 'subject').text} or an emblem you own` : K.np(e.abilitiesOf, st, { det: 'a' });
      // edh-misc-5 (CR 603.2d, 603.10a; Gandalf the White): "a legendary permanent or an artifact entering or leaving the battlefield"; two descriptions are each said whole
      if (isEnterLeaveCause(e)) {
        const subject = (e.cause as { subject?: ObjectFilter }).subject;
        const parts = subject?.anyOf?.length === 2 && Object.keys(subject).length === 1 ? subject.anyOf : subject === undefined ? [] : [subject];
        if (parts.length === 0) throw new NoRenderer('an entering-or-leaving cause with no description');
        return lasting(`if ${parts.map((x) => K.np(x, st, { det: 'a' })).join(' or ')} entering or leaving the battlefield causes a triggered ability of ${caused} to trigger, ${that} triggers ${times}`, o.duration, st);
      }
      return lasting(`if ${causeText(e.cause, st)} causes a triggered ability of ${caused} to trigger, ${that} triggers ${times}`, o.duration, st);
    }
    case 'additionalCost': noDuration('an additional cost', o.duration); return additionalCost(e, st);
    case 'alternativeCost': noDuration('an alternative cost', o.duration); return alternativeCost(e, st);
    case 'pregame': noDuration('a pregame action', o.duration); return pregame(e, st);
    case 'castWith': {
      // FAST5X E2 (CR 601.3): "you may cast ~ from your graveyard using its warp ability"
      noDuration('a cast option', o.duration);
      if (e.from !== 'graveyard') throw new NoRenderer('castWith from a zone other than a graveyard');
      return `you may cast ${K.obj({ ref: 'self' }, st, 'subject').text} from your graveyard using its ${e.method} ability`;
    }
    // CMDF (CR 113.6n, 903.3a): "~ can be your commander", a deck-construction ability
    case 'deckConstruction': {
      noDuration('a deck-construction ability', o.duration);
      // r3-static (CR 100.2a, 113.6n): the copy-limit exceptions name the card itself ("~"), so the gate refuses the sentence on any other card's name
      if (e.rule === 'anyNumber' && e.value === undefined) return 'a deck can have any number of cards named ~';
      if (e.rule === 'upTo' && typeof e.value === 'number' && Number.isInteger(e.value) && e.value > 1) return `a deck can have up to ${numWord(e.value)} cards named ~`;
      if (e.rule !== 'canBeCommander' || e.value !== undefined) throw new NoRenderer(`deckConstruction ${e.rule}`);
      return `${K.obj({ ref: 'self' }, st, 'subject').text} can be your commander`;
    }
    default: throw new NoRenderer(`static effect ${(e as { s: string }).s}`);
  }
}

/** edh-d-98 (Scion of Halaster): the one replacement `case 'replace'` above says whole (the build of template sta.edhd98.firstDraw.lookTwo.oneGraveyard.otherTop.thenDraw). */
const FIRST_DRAW_LOOK_TWO = {
  s: 'replace', replaces: { ev: 'draw', player: 'you', firstEachTurn: true }, body: { b: 'instead', do: [
    { op: 'look', who: { ref: 'you' }, at: { ref: 'topCards', player: { ref: 'you' }, count: 2 }, as: 'looked' },
    { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { is: { ref: 'bound', name: 'looked' }, zone: 'library' } }, min: 1, max: 1, as: 'chosen' },
    { op: 'move', what: { ref: 'bound', name: 'chosen' }, to: { zone: 'graveyard' } },
    { op: 'move', what: { ref: 'each', filter: { is: { ref: 'bound', name: 'looked' }, not: { is: { ref: 'bound', name: 'chosen' } }, zone: 'library' } }, to: { zone: 'library', position: 'top' } },
    { op: 'draw', who: { ref: 'you' }, count: 1 },
  ] },
};
