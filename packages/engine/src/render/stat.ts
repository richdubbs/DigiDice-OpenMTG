/**
 * Static effects as sentences (WP2): costMod, restrict, replace, permit, rule, triggerMod, additionalCost, alternativeCost, pregame, and (through
 * render/mods.ts) continuous. With a duration they are the effect of a step ("... this turn"); without one they are the text of a static ability.
 */
import type { AmountChange, AbilityDef, Condition, ContinuousEffectDef, Destination, EffectStep, Duration, EventPattern, ObjectFilter, ObjRef, PlayerPred, PlayerRef, Quantity, ReplacementDef, RestrictionDef, RuleAction, RuleModDef, StaticEffect, TriggerModDef, ZoneName } from '../types/ability';
import { isLifeGainCause } from '../types/ability'; // trek-2 (CR 603.2d)
import { formatManaCost, type ManaCost } from '../types/mana';
import { K } from './kernel';
import { copyExceptText } from './copy-except';
import { quotedAbility } from './quote';
import { continuous, ptPredicate } from './mods';
import { countParts, distinctParts } from './qty';
import { isPlayerRef, markTriggerRoles, withSubjects } from './refs';
import { destPhrase } from './steps-util';
import { MOVE_VERB, tokenText } from './steps-zones';
import { absorb, cloneState, withVariants, type RenderState } from './state';
import { possessiveStep, STEP_NAME } from './turn';
import { alt, ALT_CLOSE, ALT_OPEN, COLOR_WORD, joinList, lowerFirst, NoRenderer, numWord, pluralize, withArticle } from './text';

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
  // n * (count): "{n} less ... for each X"
  if (isMath(g) && g.op === '*' && g.args.length === 2 && typeof g.args[0] === 'number') {
    const per = perText(g.args[1]!, st); // r4-cost: before any other wording ("the creature it targets" has no quantity words of its own)
    if (per) return { amount: `{${g.args[0]}}${mana}`, per };
    const parts = K.qty(g.args[1]!, st);
    return { amount: `{X}${mana}`, per: `, where X is ${K.qty(g, st)}`.replace(/^, where X is/, `, where X is`) + (parts ? '' : '') };
  }
  const per = perText(g, st);
  if (per) return { amount: `{1}${mana}`, per };
  return { amount: `{X}${mana}`, per: `, where X is ${K.qty(g, st)}` };
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
    if (typeof c === 'object' && c.q === 'spellTargetCount' && c.filter !== undefined) return { amount: mana, per: ` if it targets ${K.np(c.filter, st, { det: 'a' })}` };
    // FAST4 T32: min(1, floor(n / N)) of the cards that left your graveyard this turn: "if N or more cards left your graveyard this turn" (CR 400.3: a card in
    // a graveyard is in its owner's; every zone change from it, CR 603.10a)
    const n = leftOwnGraveyard(c);
    if (n !== null) return { amount: mana, per: ` if ${numWord(n)} or more cards left your graveyard this turn` };
    // FAST5 T63 (CR 601.2f, 602.2b): "This ability costs {2} less to activate if you control a creature with a +1/+1 counter on it" (the count of the objects you
    // control, at most once) and "... if you attacked with a Spacecraft this turn" (the attacks of this turn, at most once): the ability's own cost change has no
    // condition field, so each is written as the cost change applied min(1, n) times
    if (typeof c === 'object' && c.q === 'count' && c.of.ref === 'each' && 'filter' in c.of && c.of.filter.controller === 'you') return { amount: mana, per: ` if ${K.cond({ cond: 'exists', of: c.of }, st)}` };
    if (typeof c === 'object' && c.q === 'happenedCount' && c.scope === 'turn' && c.by === undefined && c.per === undefined && c.beforeEvent === undefined && c.event.ev === 'attacks') {
      return { amount: mana, per: ` if ${K.cond({ cond: 'happened', event: c.event, scope: 'turn' }, st)}` };
    }
  }
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
        // r5-mech (CR 404.1, 406.1): a count over two zones, "for each creature card you own in exile and in your graveyard" (its quantity also reads "the total number of")
        if (live.q === 'count' && live.of.ref === 'each' && 'filter' in live.of && Array.isArray(live.of.filter.zone) && live.of.filter.zone.length > 1) {
          const cp = countParts(live, st);
          if (cp) return ` for each ${cp.singular}`;
        }
        const text = K.qty(live, st);
        const m = /^the number of (.*)$/.exec(text);
        if (m) return ` for each ${singularOf(m[1]!, live, st)}`;
        return null;
      }
      // std-costs-1 (CR 601.2b, 601.2f): "for each permanent sacrificed this way", the number announced for the spell's optional cost (render/qty.ts#countParts)
      case 'costCount': return ` for each ${countParts(live, st)!.singular}`;
      // T38 (CR 700.8): "for each creature in your party"
      case 'partySize': return live.of.ref === 'you' ? ' for each creature in your party' : null;
      // FAST4 T21: "for each color among permanents you control" (CR 105.1, 105.2: the colors are white, blue, black, red and green; colorless is not one)
      // r4-cost (CR 105.2, 601.2c): "for each color of the creature it targets" (an activated ability's target, statics/costmods.ts#targetValue)
      case 'distinct': return live.what === 'colors' && live.among.ref === 'target' ? ' for each color of the creature it targets' : live.what === 'colors' ? ` for each color among ${distinctParts(live, st).among}` : null;
      // CMDF (CR 903.8): "{1} less to cast for each time you've cast a commander from the command zone this game" (Font of Magic)
      case 'commanderCasts': return ` for each ${countParts(live, st)!.singular}`;
      // std-sos (CR 122.1, 602.2b): "This ability costs {1} less to activate for each page counter on ~" (the counters of one kind on one object)
      // r4-cost (CR 122.1, 601.2c): "for each +1/+1 counter on the creature it targets"
      // std-rm (CR 122.1): "for each rad counter you have" (the counters of one kind a player has, render/qty.ts#countParts)
      case 'counters': {
        if (live.kind !== 'any' && isPlayerRef(live.on as ObjRef | PlayerRef, st)) return ` for each ${countParts(live, st)!.singular}`;
        return live.kind !== 'any' && (live.on as ObjRef).ref === 'target' ? ` for each ${live.kind} counter on the creature it targets` : live.kind !== 'any' && !isPlayerRef(live.on as ObjRef | PlayerRef, st) ? ` for each ${live.kind} counter on ${K.obj(live.on as ObjRef, st, 'object').text}` : null;
      }
      // std-rm (CR 121.1, 601.2i): "for each card you've drawn this turn", "for each spell you've cast this turn"
      case 'cardsDrawnThisTurn': case 'spellsCastThisTurn': return ` for each ${countParts(live, st)!.singular}`;
      // r4-cost (CR 601.2f): "for each Cave you control and each Cave card in your graveyard", the sum of two counts (each object counted once in its own set)
      case 'math': {
        if (live.op !== '+' || live.args.length !== 2 || !live.args.every((a) => typeof a === 'object' && a.q === 'count')) return null;
        const [a, b] = live.args.map((x) => perText(x, st));
        return a && b ? `${a} and ${b.replace(/^ for /, '')}` : null;
      }
      default: return null;
    }
  }
  return null;
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
      if ((ev.ev === 'cast' && ev.player === 'opponent') || ev.ev === 'attacks') { const cp = countParts(q, st); if (cp !== null) return cp.singular; }
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
  const first = firstSpellEachTurn(e, st, inside); // FAST4 T32
  if (first !== null) return first;
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
    return whereX === null ? `${self} costs ${amount} ${word} to cast${per}` : alt(`${self} costs ${amount} ${word} to cast${per}`, `${self} costs {X} ${word} to cast, where X is ${whereX}`);
  }
  // std-rh (CR 116.2m, 709.5e): "Unlock costs you pay cost {1} less", the special action that unlocks a door of a Room
  if (applies.unlock === true) {
    if (applies.caster !== 'you' || change.kind !== 'reduce' || per !== '' || inside !== '' || change.floor === 'one') throw new NoRenderer('an unlock cost change other than a plain reduction for you');
    return `unlock costs you pay cost ${amount} less`;
  }
  // std-rx27 (CR 602.2b, 118.9): "you may pay {0} rather than pay the equip cost of the first equip ability you activate each turn" (statics/costmods.ts)
  if (applies.firstEachTurn !== undefined) {
    const kw = applies.abilities?.keyword;
    const free = change.kind === 'set' && (change.mana ?? []).length === 0 && change.generic === undefined && change.times === undefined && Object.keys(change).length <= 2;
    if (applies.firstEachTurn !== true || kw === undefined || applies.abilities?.kind !== 'activated' || applies.abilities.source !== undefined || applies.caster !== 'you' || !free || inside !== '') {
      throw new NoRenderer('a first-each-turn cost change other than "pay {0} rather than pay the <keyword> cost of the first <keyword> ability you activate each turn"');
    }
    return `you may pay ${alt('{0}', 'nothing')} rather than pay the ${kw} cost of the first ${kw} ability you activate each turn`; // family pay-zero-nothing
  }
  if (applies.abilities) {
    // FAST5 T60: "exhaust abilities", the activated abilities with a wrapper keyword (CR 702.177a)
    const kind = applies.abilities.keyword !== undefined ? applies.abilities.keyword : applies.abilities.kind === 'loyalty' ? 'loyalty' : applies.abilities.kind === 'mana' ? 'mana' : 'activated';
    // std-rx28 (CR 201.3, 607.2d): "of sources with the chosen name" (Skyseer's Chariot), the objects of that name in every zone (as std-rx6's restriction says them)
    const sf = applies.abilities.source;
    const named = sf !== undefined && sf.zone === 'any' && sf.chosen?.quality === 'cardName' && Object.keys(sf).every((k) => k === 'zone' || k === 'chosen');
    if (sf?.zone === 'any' && !named) throw new NoRenderer('activated abilities of objects in every zone other than the sources with the chosen name');
    const src = named ? ` of ${alt('sources with the chosen name', 'sources with that name')}` : sf ? ` of ${K.np(sf, st, { det: 'none', plural: true })}` : ''; // family chosen-name-or-that-name
    const floor = change.floor === 'one' ? ". this effect can't reduce the mana in that cost to less than one mana" : ''; // r3-cost
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
    const plain = `${kind} abilities${src} cost ${amount} ${word} to activate${per}${floor}`.replace('  ', ' ');
    // std-rx15 (CR 702.6a, 602.2b; family self-keyword-abilities-possessive): "~'s equip abilities cost {2} less to activate", the abilities of the object itself said
    // with its possessive
    if (applies.abilities.keyword !== undefined && floor === '' && per === '' && JSON.stringify(applies.abilities.source) === JSON.stringify({ self: true })) {
      return alt(plain, `${K.obj({ ref: 'self' }, st, 'possessive').text} ${kind} abilities cost ${amount} ${word} to activate`);
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
    const whom = host ? 'enchanted creature' : alt(K.np(f, st, { det: 'a' }), `one or more ${K.np(f, st, { det: 'none', plural: true })}`);
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
    const quality = { cardType: 'a card type', color: 'a color', creatureType: 'a creature type', landType: 'a land type', name: 'a name' }[sw.quality];
    return `${spellsPhrase(unshared, st)} you cast that share ${quality} with ${K.obj(sw.with, st, 'object').text} cost ${amount} ${word} to cast${per}`;
  }
  const spells = spellsPhrase(applies.spells ?? {}, st);
  const text = change.kind === 'set' ? `${spells}${who}${mid} cost ${amount} to cast` : `${spells}${who}${mid} cost ${amount} ${word} to cast${per}`;
  // FAST4 T32: "Colorless spells you cast with mana value 7 or greater cost {1} less to cast": Oracle puts "you cast" before the mana value (CR 202.3)
  const { manaValue: mv, ...withoutMv } = applies.spells ?? {};
  const mvReading = mv !== undefined && caster === 'you' && inside === '' && change.kind !== 'set' && (mv.op === '>=' || mv.op === '<=') && Object.keys(withoutMv).some((k) => k !== 'zone' && k !== 'stackKind')
    ? [`${spellsPhrase(withoutMv, st)} you cast with mana value ${K.qty(mv.value, st)} ${mv.op === '>=' ? 'or greater' : 'or less'} cost ${amount} ${word} to cast${per}`] : [];
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
  if (mvReading.length + colorReading.length + tgpReading.length > 0) return alt(text, ...mvReading, ...colorReading, ...tgpReading);
  // CLOUD C5 (CR 607.2d): "Creature spells you cast of the chosen type cost {1} less to cast": Oracle puts "you cast" before the chosen quality (Herald's Horn, Umori)
  const { chosen, ...withoutChosen } = applies.spells ?? {};
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
  if (isMath(t) && t.op === '*' && t.args.length === 2 && typeof t.args[1] === 'object' && t.args[1].q === 'count') {
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
  const spell = K.np({ ...kind, zone: 'stack', stackKind: 'spell' }, st, { det: 'none' });
  return `the first ${spell} you cast each turn costs ${formatManaCost(change.mana)} ${change.kind === 'increase' ? 'more' : 'less'} to cast${per}`;
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
  beCopied: 'be copied', // std-copy-1 (CR 707.10)
  phaseIn: 'phase in', // trek-4 (CR 702.26c)
  beBeamedUp: 'be beamed up', // trek-1 (Star Trek beam me up; CR 702 rule number unverified)
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
  if (e.mode !== 'mustIfAble' || e.max !== undefined || e.goad === true) return null; // Cloud C3: a static goad is said as the designation (restrictFor)
  if (e.other === undefined) {
    if (inside === null || e.when !== undefined || (e.action !== 'attack' && e.action !== 'block')) return null;
    return withSubjects(e.subject, st, (sj, pl) => `${sj} ${e.action}${pl ? '' : 's'} ${inside} if able`);
  }
  const keys = Object.keys(e.other);
  if (e.action !== 'block' || e.when !== undefined || keys.length !== 1 || keys[0] !== 'is' || e.other.is === undefined) throw new NoRenderer(`a filter on ${e.mode} ${e.action}`);
  const x = K.obj(e.other.is, st, 'object').text;
  const s = e.subject;
  if (!isPlayerRef(s, st) && s.ref === 'each' && 'filter' in s && JSON.stringify(s.filter) === '{"types":["Creature"]}') return `all creatures able to block ${x}${inside ? ` ${inside}` : ''} do so`;
  return withSubjects(s, st, (sj, pl) => `${sj} block${pl ? '' : 's'} ${x} ${inside ?? 'each combat'} if able`);
}

/**
 * MX5 (CR 502.3, 611.2a): "<it> doesn't untap during its controller's next untap step" (no player: each object's own controller), "... during your next
 * untap step", "... during that player's next untap step" (`whose`).
 */
function nextUntapRestriction(e: RestrictionDef, d: Extract<Duration, { d: 'throughNextUntap' }>, st: RenderState): string {
  return withSubjects(e.subject, st, (sj, pl) => {
    const doesnt = pl ? "don't" : "doesn't";
    if (d.whose !== undefined) return `${sj} ${doesnt} untap during ${possessiveStep('untap', d.whose, st, true)}`;
    const step = pl ? alt("their controller's next untap step", "their controllers' next untap steps") : "its controller's next untap step";
    return `${sj} ${doesnt} untap during ${step}`;
  });
}

function restrict(e: RestrictionDef, st: RenderState): string {
  const req = requirementWithOther(e, st, null);
  if (req !== null) return req;
  const s = e.subject;
  // std-control-1 (CR 602.5, 702.193a): "power-up abilities can't be activated": the abilities of that wrapper keyword of every object, and nothing else in it
  if (e.abilityKeyword !== undefined) {
    if (e.mode !== 'cant' || e.action !== 'activate' || e.other !== undefined || e.otherPlayer !== undefined || e.max !== undefined || e.min !== undefined || e.when !== undefined
      || e.exceptMana !== undefined || e.alone !== undefined || e.goad !== undefined || JSON.stringify(s) !== '{"ref":"each","filter":{}}') throw new NoRenderer('a keyword ability ban with more than the ban');
    return `${e.abilityKeyword} abilities can't be activated`;
  }
  // FAST3 T15: "Your opponents can't gain life", "Players can't gain life": each opponent / each player said as the plural group (CR 102.3, 101.2;
  // family players-plural). The restriction applies to each of them, which is what the plural group means.
  if (s.ref === 'each' && 'who' in s && (s.who === 'opponent' || s.who === 'player')) {
    const group = s.who === 'opponent' ? 'your opponents' : 'players';
    const [each, plural] = withVariants(st, [(v) => withSubjects(s, v, (sj, pl) => restrictFor(e, v, sj, pl)), (v) => restrictFor(e, v, group, true)]);
    return alt(each!, plural!);
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
  const base = withSubjects(e.subject, st, (sj, pl) => restrictFor(e, st, sj, pl));
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
  'declareBlockers,combatDamage,endCombat': 'during combat after blockers are declared',
  'untap,upkeep,draw,main1,beginCombat,declareAttackers': 'before combat or during combat before blockers are declared',
};

/** p2-combat-flow-1 (CR 102.1, 102.3, 506.1): the same restrictions in a turn of the spell's caster or of an opponent ("during combat on your turn"). */
const CAST_SELF_ONLY_TURN: Readonly<Record<string, string>> = {
  'you:beginCombat,declareAttackers,declareBlockers,combatDamage,endCombat': 'during combat on your turn',
  'opponent:beginCombat,declareAttackers,declareBlockers,combatDamage,endCombat': "during combat on an opponent's turn",
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

/** r5-static: as statics/hooks.ts#isDeclarationLimit (render/ may not import statics/). */
const isDeclarationLimit = (r: RestrictionDef): boolean =>
  r.mode === 'cant' && typeof r.max === 'number' && (r.action === 'attack' || r.action === 'attackPlayer' || r.action === 'block')
  && r.alone === undefined && r.min === undefined && r.goad === undefined && r.exceptMana === undefined;

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
  // r5-static (CR 508.1c, 509.1b): "No more than one creature can attack each combat", "... can attack you each combat", "... can attack ~ each combat" (the
  // planeswalker of a granted ability), "No more than two creatures can block each combat": a limit on the whole declaration (statics/hooks.ts#declarationLimits)
  if (isDeclarationLimit(e)) return declarationLimitText(e);
  // FAST4 T33: "can't attack you" (attackPlayer) is written only with its planeswalker half (staticEffects#attackYouPair), and "unless they're mana
  // abilities" only for one object's own abilities (restrict): anything else has no words here
  // std-rx6 (CR 508.1c, 506.2): "Creatures can't attack you." alone: the player "you" only (planeswalkers you control stay attackable, as Oracle words it)
  if (isPlainAttackYou(e)) return `${sj} can't attack you`;
  if (e.action === 'attackPlayer' || e.otherPlayer !== undefined && e.mode !== 'mustIfAble') throw new NoRenderer(`${e.action} with a player it concerns`);
  if (e.exceptMana === true) throw new NoRenderer('exceptMana outside one object\'s own abilities');
  if (e.abilityKeyword !== undefined) throw new NoRenderer('a keyword ability ban outside its own words'); // std-control-1
  if (e.alone === true) {
    if (!isAloneBan(e)) throw new NoRenderer('a restriction on acting alone with more than the ban');
    return `${sj} can't ${e.action} alone`;
  }
  const selfOnly = castSelfOnly(e, sj) ?? castSelfAttackedStep(e, sj); // FAST5 T36
  if (selfOnly !== null) return selfOnly;
  const firstTurns = castSelfFirstTurns(e, sj); // std-r9
  if (firstTurns !== null) return firstTurns;
  const selfUnless = castSelfUnless(e, sj, st); // FAST4 T32
  if (selfUnless !== null) return selfUnless;
  if (castOnlyFromHand(e)) return `${sj} can't cast spells from anywhere other than ${pl ? 'their hands' : 'their hand'}`; // FAST4 T32
  // design 3.3: a limit (`max`) and a filter (`other`) are printed where Oracle has words for them, and refused everywhere else
  // MX5: "~ can't be blocked by more than one creature" is a limit on the blockers of one attacker (CR 509.1b; statics/hooks.ts#blockSetValid)
  const limited = e.mode === 'cant' && (e.action === 'cast' || e.action === 'draw' || e.action === 'playLand' || e.action === 'activate' || e.action === 'beBlocked');
  // p2-player-rules-1 (CR 601.2i): a limit on casting spells of a kind, "can't cast more than one noncreature spell each turn" (statics/hooks.ts#castCountOfKind)
  if (e.max !== undefined && (!limited || (e.other !== undefined && e.action !== 'cast'))) throw new NoRenderer(`a limit on ${e.mode} ${e.action}`);
  // FAST5 T57: "~ can't be blocked except by three or more creatures" (CR 509.1b): a minimum on the blockers of one attacker, nothing else
  if (e.min !== undefined && (e.mode !== 'cant' || e.action !== 'beBlocked' || e.other !== undefined || e.max !== undefined || typeof e.min !== 'number' || e.min < 2)) {
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
  if (e.other !== undefined && !blockOnly && !blocksSelfOnly(e) && !blockFiltered && !(e.mode === 'cant' && (e.action === 'beBlockedBy' || e.action === 'beTargeted' || e.action === 'cast' || e.action === 'activate' || e.action === 'sacrifice'))) {
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
    else if (e.action === 'beBlockedBy' && other !== undefined && e.subject.ref === 'self') {
      // FAST3 T12: "Creatures with power less than ~'s power can't block it" is "~ can't be blocked by creatures with power less than ~'s power" (CR 509.1b:
      // statics/hooks.ts asks both `block` of the blocker and `beBlockedBy` of the attacker)
      text = alt(`${sj} ${cant} be blocked${tail()}`, `${K.np(other, st, { det: 'none', plural: true })} ${cant} block ${alt(sj, 'it')}`);
      // FAST3 T16: "~ can't be blocked by creatures with greater power" says "greater than ~'s power" in two words (CR 208.1, 509.1b)
      if (greaterPowerThanSelf(other)) text = alt(text, `${sj} ${cant} be blocked by creatures with greater power`);
    } else if (e.action === 'beBlockedBy') text = `${sj} ${cant} be blocked${tail()}`;
    else if (blockFiltered) text = `${sj} ${cant} block ${K.np(other!, st, { det: 'none', plural: true })}`;
    // std-rx21 (CR 115.1, 702.11b): "can't be the target of spells or abilities your opponents control": `other` is the spell, or the source of the ability, and its
    // controller is an opponent of the controller of this effect (statics/hooks.ts canBeTargeted); hexproof's own words, never the keyword itself
    else if (e.action === 'beTargeted' && other !== undefined && JSON.stringify(other) === '{"controller":"opponent"}') text = `${sj} ${cant} be the target of spells or abilities your opponents control`;
    else if (e.action === 'beTargeted') {
      text = `${sj} ${cant} be the target${tail() === ' of spells or abilities' ? ' of spells or abilities' : ` of ${other ? K.np(other, st, { det: 'none', plural: true }) : 'spells or abilities'}`}`;
      // FAST3 T16: "can't be the target of white spells or abilities from white sources": `other` is the spell, or the source of the ability (statics/hooks.ts
      // canBeTargeted, CR 115.1, 113.7a), so one color filter says both halves
      const c = onlyColor(other);
      if (c !== null) text = alt(text, `${sj} ${cant} be the target of ${c} spells or abilities from ${c} sources`);
      // std-ry5 (CR 115.1; family targets-plural): a group "can't be the targets of spells or abilities" (Ground Seal: "Cards in graveyards ..."), the noun in
      // the number of its subject
      if (pl && other === undefined) text = alt(text, `${sj} ${cant} be the targets of spells or abilities`);
    }
    else if (e.max !== undefined && (e.action === 'cast' || e.action === 'draw' || e.action === 'playLand' || e.action === 'activate')) {
      const unit = e.action === 'cast' ? 'spell' : e.action === 'draw' ? 'card' : e.action === 'playLand' ? 'land' : 'ability';
      const n = e.max;
      const what = e.action === 'cast' && other ? K.np({ ...other, stackKind: 'spell' }, st, { det: 'none', plural: n !== 1 }) : n === 1 ? unit : pluralize(unit); // p2-player-rules-1
      text = `${sj} ${cant} ${ACTION_CANT[e.action]!.split(' ')[0]} more than ${numWord(n)} ${what} each turn`;
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
    else text = `${sj} ${cant} ${cantWords(e.action, pl)}`;
  } else if (e.mode === 'mustIfAble') {
    switch (e.action) {
      case 'attack': text = `${sj} ${pl ? 'attack' : 'attacks'} each combat if able`; break;
      case 'block': text = `${sj} ${pl ? 'block' : 'blocks'} each combat if able`; break;
      case 'beBlocked': text = `${sj} must be blocked if able`; break;
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
    // CMD5 (family restriction-during-combat): "Players can't cast spells during combat" is the restriction in every step of the combat phase (CR 506.1, 604.1)
    if (e.mode === 'cant' && w.cond === 'turnOf' && w.whose === 'any' && Array.isArray(w.step) && CAST_SELF_ONLY_STEPS[w.step.join(',')] === 'during combat') during.push(`${text} during combat`);
    return alt(`as long as ${c}, ${text}`, `${text} as long as ${c}`, ...during);
  }
  return text;
}

// ---------------------------------------------------------------------------
// Replacement effects (CR 614-616)
// ---------------------------------------------------------------------------

/** "twice that many tokens", "twice that much damage", "N more counters": the new amount of a replaced event, in the words of what is counted. */
function amountChange(a: AmountChange, st: RenderState, noun: string, much = false): string {
  const that = much ? 'that much' : 'that many';
  if (a.mul !== undefined) {
    const text = a.mul === 2 ? `twice ${that} ${noun}` : a.mul === 0.5 ? `half ${that} ${noun}, rounded ${a.round ?? 'down'}` : `${numWord(a.mul)} times ${that} ${noun}`;
    // p2-replace-damage-2 (CR 614.1a): three times that much damage is also "triple that damage" (City on Fire; family double-triple-that-damage)
    const word = a.mul === 2 ? 'double' : a.mul === 3 ? 'triple' : null;
    return word !== null && much && noun === 'damage' ? alt(text, `${word} that damage`) : text;
  }
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
  for (const a of copy.additional ?? []) {
    if (a.counters.length !== 1) throw new NoRenderer('an additional copy effect with several counter kinds');
    const c = a.counters[0]!;
    const n = c.count === 1 ? 'an' : typeof c.count === 'number' ? numWord(c.count) : K.qty(c.count, st);
    let cond = '';
    if (a.if) {
      if (Object.keys(a.if).length !== 1 || a.if.types?.length !== 1) throw new NoRenderer('an additional copy effect with a condition other than a card type');
      const type = a.if.types[0]!.toLowerCase();
      cond = ` if it's ${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type}`;
    }
    phrases.push(`it enters with ${n} additional ${c.kind} counter${c.count === 1 ? '' : 's'} on it${cond}`);
  }
  if (copy.except && copy.except.length > 0) {
    phrases.push(copyExceptText(copy.except, (mods) => K.staticEffect({ s: 'continuous', affects: { ref: 'subject' }, mods }, st), (a) => quotedAbility(a, st, 'creature'), K.nounsOf(copy.of)[0])); // MX2: the copied object's noun ("that creature's color")
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
  // std-cardcopy-3 (CR 614.12a, 607.2a): "As ~ enters, exile up to X creature cards from your graveyard. It enters with three +1/+1 counters on it for each creature
  // card exiled this way." (Mimeoplasm, Revered One): cards of your graveyard only, and nothing else in the body
  // p2-misc-1 (CR 731.1, 614.12): "If it's neither day nor night, it becomes day as ~ enters." (Firmament Sage): nothing else in the body
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
  // std-rx24 (CR 614.1c, 614.12a, 122.1b): "~ enters with your choice of a trample counter or a menace counter on it" (Ferocious Tigorilla): a choice of two
  // options of one counter each and nothing else in the body; riot's choice of a counter or haste is keyword data (never card text)
  if (body.choice !== undefined) {
    const kinds = body.choice.map((o) => (o.withAbilities === undefined && o.counters?.length === 1 && o.counters[0]!.count === 1 ? o.counters[0]!.kind : null));
    if (kinds.length !== 2 || kinds.some((k) => k === null) || kinds[0] === kinds[1] || Object.keys(body).some((k) => k !== 'b' && k !== 'choice')) throw new NoRenderer('an entering choice other than two kinds of one counter');
    return `${subject} ${verb} with your choice of ${withArticle(`${kinds[0]!} counter`)} or ${withArticle(`${kinds[1]!} counter`)} on it`;
  }
  if (body.choose && body.choose.length > 0) {
    const what = body.choose.map((c) => {
      switch (c.what) {
        case 'color': return c.exclude && c.exclude.length > 0 ? `a color other than ${joinList(c.exclude.map((x) => COLOR_WORD[x] ?? x), 'and')}` : 'a color'; // CMD3: the Thriving lands
        case 'creatureType': return c.options !== undefined && c.options.length >= 2 ? joinList(c.options, 'or') : 'a creature type'; // r4-cost (CR 205.3m): "choose Elemental, Elf, ..., or Treefolk"
        // std-rx28 (CR 205.2a): "a card type other than creature" (Arachne, Psionic Weaver)
        case 'cardType': return c.options !== undefined && c.options.length >= 2 ? joinList(c.options.map((o) => o.toLowerCase()), 'or') : c.exclude && c.exclude.length > 0 ? `a card type other than ${joinList(c.exclude.map((o) => o.toLowerCase()), 'and')}` : 'a card type'; // std-rD (CR 205.2a): "choose artifact, creature, ..., or sorcery"
        case 'landType': return 'a basic land type';
        // std-rx28 (CR 201.3): "choose a nonland card name" (Skyseer's Chariot)
        case 'cardName': return c.cardKind !== undefined ? alt(`a ${c.cardKind} card name`, `any ${c.cardKind} card name`) : alt('a card name', 'any card name'); // std-rx6 (CR 201.3): family a-or-any-card-name
        case 'number': return c.min !== undefined && c.max !== undefined ? `a number between ${c.min} and ${c.max}` : 'a number'; // std-rx5
        case 'player': return 'a player';
        case 'opponent': return 'an opponent';
        // cloud r3-mech (CR 614.12a): a Siege's choice names its two words alone ("choose Abzan or Mardu"), parser/segment.ts#siegeMode
        case 'option': return c.link === 'siege' && c.options?.length === 2 ? joinList(c.options, 'or') : c.options ? `one of ${joinList(c.options, 'or')}` : 'an option';
        case 'oddEven': return 'odd or even';
      }
    });
    // std-rx6 (CR 614.12a, 402.3): "As ~ enters, look at an opponent's hand, then choose any card name." (Sorcerous Spyglass)
    if (body.lookAtHand === 'opponent') {
      // std-rx28 (CR 614.12a, 402.3, 205.2a): "..., then choose a card type other than creature." (Arachne, Psionic Weaver)
      if (body.choose.length !== 1 || (body.choose[0]!.what !== 'cardName' && body.choose[0]!.what !== 'cardType')) throw new NoRenderer('a look at a hand before a choice other than a card name or type');
      sentences.push(`as ${subject} ${verb}, look at an opponent's hand, then choose ${body.choose[0]!.what === 'cardName' ? alt('any card name', 'a card name') : what[0]!}`); // family a-or-any-card-name
    } else sentences.push(`as ${subject} ${verb}, choose ${joinList(what)}`);
    // FAST5 T57 (CR 614.1c, 614.12a): "~ enters tapped. As it enters, choose a color." says the tapped sentence first, and "it" for the permanent
    if (body.tapped === true && !body.tappedUnless && !body.tappedUnlessPay && !body.copy && !body.counters && !body.faceDown && !body.transformed && !body.prepared
      && !body.attachTo && !body.under && !body.withAbilities) {
      return alt(`${subject} ${verb} tapped. as ${alt('it', subject)} ${verb}, choose ${joinList(what)}`, `as ${subject} ${verb}, choose ${joinList(what)}. ${subject} ${verb} tapped`);
    }
  }
  if (body.copy) {
    const onBf = (body.copy.of.zone === undefined || body.copy.of.zone === 'battlefield') && !body.copy.of.self ? ' on the battlefield' : ''; // T64: the zone may be stated in the filter (Mockingbird)
    // M6-10: a permanent "you control" needs no "on the battlefield": "a creature or planeswalker you control" (CR 110.1, 707.5)
    const of = body.copy.of.self ? K.np({ ...body.copy.of }, st)
      : body.copy.of.zone === undefined && body.copy.of.controller !== undefined
        ? alt(`${K.np({ ...body.copy.of }, st, { det: 'any' })}${onBf}`, K.np({ ...body.copy.of }, st, { det: 'a' }))
        : onBattlefield(K.np({ ...body.copy.of }, st, { det: 'any' }), onBf);
    const exc = enterCopyExceptions(body.copy, st);
    // FAST5 T64 (CR 614.1c, 614.12): "You may have this land enter tapped as a copy of any land card in a graveyard" (Echoing Deeps)
    const tapped = body.copy.tapped === true ? ' tapped' : '';
    // r4-copy (CR 603.12, 614.12): "When you do, exile that card." after the choice of a card to copy (Superior Spider-Man): exactly one reflexive exile of that card
    const then = body.copy.then;
    let after = '';
    if (then !== undefined) {
      const expect = { as: then.as, do: [{ op: 'reflexive', when: { did: then.as }, targets: [], do: [{ op: 'move', what: { ref: 'bound', name: then.as }, to: { zone: 'exile' } }] }] };
      if (!body.copy.optional || JSON.stringify(then) !== JSON.stringify(expect) || body.copy.of.isCard !== true) throw new NoRenderer('steps after an enters-as-a-copy choice other than exiling the copied card');
      after = '. when you do, exile that card';
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
  if (body.tappedUnlessPay) {
    const pay = K.cost(body.tappedUnlessPay, st).replace(/^Pay /, 'pay ');
    // std-rx9 (family enters-choose-then-pay): after the choice sentence of the same replacement, the payment also reads "then you may pay 2 life" (Multiversal Passage)
    const asEnters = `as ${subject} ${verb}, you may ${lowerFirst(pay)}`;
    const lead = sentences.length > 0 ? alt(asEnters, `then you may ${lowerFirst(pay)}`) : asEnters;
    sentences.push(`${lead}. if you don't, ${alt('it', subject)} ${verb} tapped`);
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
      ];
      parts.push(alt(...variants));
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
  if (body.under) parts.push(`under ${K.player(body.under, st, 'possessive').text} control`);
  if (body.withAbilities && body.withAbilities.length > 0) parts.push(`with ${joinList(body.withAbilities.map((a) => abilityWords(a, st)))}`);
  if (parts.length > 0) sentences.push(`${subject} ${verb} ${joinList(parts)}`.replace(' tapped and with', alt(' tapped with', ' tapped and with'))); // FAST1 T5: joinList writes "tapped and with"; Oracle says "enters tapped with"
  return sentences.join('. ');
}

/**
 * r4-repl (CR 614.1c, 122.6, 107.3): "~ enters with a +1/+1 counter on it plus an additional +1/+1 counter on it for each other creature you control" (Sheriff of
 * Safe Passage): one kind, N plus a count of objects (`{q: 'math', op: '+', args: [N, count]}`, the template rep.r4repl.enters.counter.plusAdditional.forEach).
 */
function plusEach(one: { kind: string; count: Quantity }, onIt: string, st: RenderState): string[] {
  const c = one.count;
  if (typeof c !== 'object' || c.q !== 'math' || c.op !== '+' || c.args.length !== 2 || typeof c.args[0] !== 'number' || c.args[0] < 1) return [];
  const n = c.args[0];
  const each = countParts(c.args[1]!, cloneState(st));
  if (each === null) return [];
  return [`with ${n === 1 ? 'a' : numWord(n)} ${one.kind} counter${n === 1 ? '' : 's'} on ${onIt} plus an additional ${one.kind} counter on ${onIt} for each ${each.singular}`];
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
    && x.replaces.ev === 'counters' && x.replaces.change === 'put' && x.replaces.by === 'you' && x.replaces.kind === undefined && x.replaces.atLeast === undefined
    && x.replaces.byEffect === undefined && x.body.b === 'modify' && x.body.count !== undefined && x.body.amount === undefined && x.body.destination === undefined && x.body.to === undefined;
  if (!plain(a) || !plain(b)) return null;
  const ra = a.replaces as Extract<EventPattern, { ev: 'counters' }>;
  const rb = b.replaces as Extract<EventPattern, { ev: 'counters' }>;
  const ca = (a.body as Extract<ReplacementDef['body'], { b: 'modify' }>).count!;
  if (JSON.stringify(ca) !== JSON.stringify((b.body as Extract<ReplacementDef['body'], { b: 'modify' }>).count)) return null;
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
    return `if one or more ${ev.token.types[0]!.toLowerCase()} tokens would be created under your control, those tokens plus ${additionalToken(tokenText(one.token, 1, false, st))} are created instead`;
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
 * r4-repl (CR 614.1a, 614.6, 111.1): "If one or more artifact tokens would be created under your control, that many 5/5 red Dragon creature tokens with flying are
 * created instead." (Draconic Visitor): the tokens of a card type you would create replaced by as many tokens of another description (`instead`, `count` the
 * event's number; the template rep.r4repl.tokens.typed.thatMany.other). null for anything else.
 */
function thatManyOtherTokens(e: ReplacementDef, duration: Duration | undefined, st: RenderState): string | null {
  const ev = e.replaces;
  const b = e.body;
  if (ev.ev !== 'createToken' || b.b !== 'instead' || duration !== undefined || e.condition !== undefined || e.optional === true || e.shield !== undefined || ev.player !== 'you' || ev.byEffect !== undefined) return null;
  if (ev.token === undefined || Object.keys(ev.token).join() !== 'types' || ev.token.types?.length !== 1) return null;
  const one = b.do.length === 1 ? b.do[0]! : undefined;
  if (one === undefined || one.op !== 'createToken' || JSON.stringify(one.count) !== '{"q":"eventAmount"}' || JSON.stringify(one.who) !== '{"ref":"you"}' || Object.keys(one).some((k) => !['op', 'who', 'count', 'token'].includes(k))) return null;
  const kind = ev.token.types[0]!.toLowerCase();
  return `if one or more ${kind} tokens would be created under your control, that many ${tokenText(one.token, 'that many', true, st).replace(/^that many /, '')} are created instead`;
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
      if (rv.ev === 'draw' && rv.player === 'opponent' && rv.exceptFirstInDrawStep === true) return `instead that player skips that draw and ${K.steps(b.do, st)}`;
      // Cloud r3-repl (CR 614.1a, 614.6): "instead" may also come first, "instead exile it and you gain 2 life" (The Darkness Crystal): the same replacement
      const words = K.steps(b.do, st);
      const text = alt(`${words} instead`, `instead ${words}`);
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
        bits.push(anywhere ? alt(words, `exile ${subjectIt} instead of putting ${subjectIt} anywhere else`) : words);
      }
      if (b.count) {
        // M6-1: the passive readings ("twice that many of those tokens are created instead", "that many plus one +1/+1 counters are put on it instead")
        if (ev.ev === 'createToken') {
          const n = amountChange(b.count, st, 'of those tokens');
          bits.push(alt(`${alt('it creates', 'you create')} ${n} instead`.replace(/ instead instead/, ' instead'), `${n} are created instead`));
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
        } else bits.push(`${amountChange(b.count, st, 'of them')} instead`);
      }
      if (b.amount) {
        if (ev.ev === 'damage') {
          const deals = `${alt('it deals', 'that source deals')} ${amountChange(b.amount, st, 'damage', true)}`;
          // M6-10 (CR 614.1a): Oracle repeats the recipient, "it deals double that damage to that permanent or player instead", "... plus 1 to that player instead"
          const r = ev.recipient;
          // p2-replace-damage-2 (CR 614.1a): damage to you is also said "to you" again (Forethought Amulet; family replaced-damage-to-you)
          const to = r === undefined ? 'that permanent or player' : r.object === undefined && r.player !== undefined ? (r.player === 'you' ? alt('that player', 'you') : 'that player') : r.player === undefined ? alt('that creature', 'that permanent') : null;
          // CLOUD std-msh (CR 614.1a, 107.3): "instead it deals that much damage plus X, where X is ~'s power" (Hawkeye, Young Avenger): "instead" first, a computed
          // amount added said with its "where X is" clause
          const add = b.amount.add !== undefined && b.amount.mul === undefined && b.amount.set === undefined ? b.amount.add : undefined;
          const first = add !== undefined && typeof add === 'object' ? [`instead ${alt('it deals', 'that source deals')} that much damage plus x, where x is ${K.qty(add, cloneState(st))}`] : [];
          // r4-repl (CR 614.1a, 107.3): "it deals that much damage plus an amount of damage equal to the number of fire counters on ~ instead" (Fated Firepower)
          if (add !== undefined && typeof add === 'object') first.push(`it deals that much damage plus an amount of damage equal to ${K.qty(add, cloneState(st))} instead`);
          bits.push(to ? alt(`${deals} instead`, `${deals} to ${to} instead`, ...first) : alt(`${deals} instead`, ...first));
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
        if (!b.destination || r === undefined || r.op !== 'reflexive' || r.when.did !== b.then.as || r.when.if !== undefined || r.targets.length > 0) throw new NoRenderer('the steps after a modified event other than "When you do, X"');
        return `${bits.join(', ')}. when you do, ${K.steps(r.do, st)}`;
      }
      return bits.join(', ');
    }
    case 'prevent': {
      const what = b.amount === 'all' ? 'all' : K.qty(b.amount, st);
      // cloud std-spm (CR 615.5): the additional instruction may also follow in the same sentence ("prevent that damage and put that many +1/+1 counters on ~")
      const steps = b.then && b.then.length > 0 ? K.steps(b.then, st) : '';
      const then = steps !== '' ? alt(`. ${steps}`, ` and ${steps}`) : '';
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
    case 'skip': return r.replaces.ev === 'draw' ? alt(`skip ${subjectIt} instead`, 'skip that draw instead') : `skip ${subjectIt} instead`; // r4-repl (CR 614.10): "skip that draw instead"
    case 'regeneration': return `regenerate ${subjectIt} instead`;
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
  if (pay === undefined || pay.op !== 'pay' || typeof pay.as !== 'string' || JSON.stringify(pay.who) !== '{"ref":"you"}' || pay.then !== undefined || pay.else !== undefined || pay.times !== undefined || pay.upTo !== undefined
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
    // FAST4 T28 (CR 611.2a, 514.2): a resolved replacement effect that lasts this turn is "This turn, each creature you control enters with ..."; any other
    // duration has no words here (refused, never dropped)
    const lead = isLimited(duration) ? (inlineDuration(duration) === 'this turn' ? 'this turn, ' : null) : '';
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
    // FAST4 T28 (CR 614.1c, 122.6): counters given to other objects as they enter also read "each other Beast creature you control enters with an additional
    // +1/+1 counter on it" (on top of any counters it would enter with); each reading starts from the same state
    const fork = cloneState(st);
    const plural = enters(b, K.np(ev.subject, st, { det: 'none', plural: true }), st);
    const each = additionalEach(b, ev.subject, fork);
    absorb(st, fork);
    return `${lead}${each === null ? plural : alt(plural, each)}`;
  }
  // Cloud r3-repl (CR 614.1a, 120.2b): "If a red source you control would deal an amount of noncombat damage less than ~'s power to an opponent, that source
  // deals damage equal to ~'s power instead" (Ojer Axonil): the damage raised to a number, `set: max(that damage, N)`, said with the comparison it implies
  const raised = raisedDamage(e, duration, st);
  if (raised !== null) return raised;
  // Cloud r3-repl (CR 614.1a, 111.1): "If you would create one or more artifact tokens, instead create those tokens plus an additional Map token." (Worldwalker Helm)
  const plusOne = tokensPlusOne(e, duration, st) ?? tokensPlusOnePassive(e, duration, st) ?? thatManyOtherTokens(e, duration, st) ?? oneOfEachToken(e, duration);
  if (plusOne !== null) return plusOne;
  // r4-repl (CR 614.1a, 121.2): "As long as you have one or fewer cards in hand, if you would draw one or more cards, you draw that many cards plus one instead."
  const moreDraws = drawManyPlus(e, duration, st) ?? youGetCounters(e, duration, st) ?? extraTurnSkipped(e, duration);
  if (moreDraws !== null) return moreDraws;
  // r4-copy (CR 614.1a, 616.1, 707.2): "The first time you would create one or more tokens each turn, you may instead create that many tokens that are copies of
  // enchanted permanent." (Moonlit Meditation; Mirrormind Crown with "As long as this Equipment is attached to a creature, ...")
  const firstCopies = firstTokensAsCopies(e, duration, st);
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
  if (b.b === 'skip' && ev.ev === 'phase' && ev.phase === 'combat' && e.shield?.uses === 1 && typeof ev.whose === 'object' && e.optional !== true && e.condition === undefined) {
    // std-ry3 (CR 614.10a, 500.11): "<player> skips their next combat phase" (Blinding Angel), the phase sibling of the step form above
    const who = isEventPlayerRef(ev.whose, st.outerTrigger) ? withTrigger(st, st.outerTrigger!, () => K.player(ev.whose as PlayerRef, st, 'subject')) : K.player(ev.whose, st, 'subject');
    return `${who.text} ${who.person === 'you' ? 'skip your' : 'skips their'} next combat phase`;
  }
  if (b.b === 'skip' && ev.ev === 'step') return `skip ${possessiveStep(ev.step, ev.whose, st)}`;
  if (b.b === 'skip' && ev.ev === 'beginTurn' && ev.extra === undefined && typeof ev.whose === 'object' && (e.shield?.uses === 1 || e.shield?.uses === 2)
    && e.shield.amount === undefined && e.optional === undefined && e.condition === undefined) {
    // std-ry5 (CR 614.10, 500.7, 500.11): a one- or two-use shield that skips a player's turns is "you skip your next turn" (Chronatog), "you skip your next two
    // turns" (Eater of Days); an extra turn is one of those turns too (the pattern does not name `extra`)
    const who = K.player(ev.whose, st, 'subject');
    const next = e.shield.uses === 1 ? 'next turn' : 'next two turns';
    return `${who.text} ${who.person === 'you' ? 'skip your' : 'skips their'} ${next}`;
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
  if (b.b === 'redirect' && b.amount === undefined && ev.ev === 'damage' && ev.source === undefined && ev.amount === undefined && isLimited(duration) && !e.shield && !e.condition && e.optional !== true) {
    const r = ev.recipient;
    const objOnly = r?.object !== undefined && r.player === undefined && r.object.is !== undefined && Object.keys(r.object).filter((k) => (r.object as Record<string, unknown>)[k] !== undefined).length === 1;
    const youOnly = r?.object === undefined && JSON.stringify(r?.player) === '"you"';
    if (objOnly || youOnly) {
      const fork = cloneState(st);
      const generic = genericReplace(e, fork, duration);
      const who = objOnly ? K.obj(r!.object!.is!, st, 'object').text : 'you';
      const combat = ev.combat === true ? 'combat ' : ev.combat === false ? 'noncombat ' : '';
      const text = `all ${combat}damage that would be dealt to ${who}${durationSuffix(duration, st)} is dealt to ${refText(b.to, st, 'object').text} instead`;
      absorb(st, fork);
      return alt(text, generic);
    }
  }
  if (b.b === 'redirect' && b.amount !== undefined) return redirectBudget(e, b, st, duration);
  // FAST5 T36 (CR 701.9a, 614.1a): "If a spell or ability an opponent controls causes you to discard ~, put it onto the battlefield instead of putting it into your graveyard"
  if (b.b === 'modify' && ev.ev === 'zoneChange' && ev.byOpponent === true && ev.cause === 'discard' && ev.subject.self === true && ev.from === 'hand' && ev.to === 'graveyard'
    && Object.keys(ev.subject).length === 1 && b.destination?.zone === 'battlefield' && b.destination.controller === 'owner' && Object.keys(b).length === 2 && Object.keys(b.destination).length === 2
    && e.optional !== true && e.condition === undefined && e.shield === undefined && duration === undefined) {
    return `if a spell or ability an opponent controls causes you to discard ${K.obj({ ref: 'self' }, st, 'subject').text}, put it onto the battlefield instead of putting it into your graveyard`;
  }
  // FAST5 T40 (CR 614.1a, 614.5): "Double all damage that sources you control of the chosen type would deal" (Collective Inferno): the doubling of all damage a kind of
  // source would deal, worded without "instead"
  if (b.b === 'modify' && ev.ev === 'damage' && ev.source !== undefined && ev.recipient === undefined && ev.combat === undefined && ev.amount === undefined && b.amount?.mul === 2
    && Object.keys(b.amount).length === 1 && Object.keys(b).length === 2 && e.condition === undefined && e.optional !== true && e.shield === undefined && duration === undefined) {
    const fork = cloneState(st);
    const generic = genericReplace(e, fork, duration);
    // CLOUD std-msh (CR 614.1a, 301.5): "Double all damage equipped creature would deal" (Mjolnir, Hammer of Thor): the one creature the source is attached to
    const attached = JSON.stringify(ev.source) === JSON.stringify({ attachedToSource: true });
    const text = attached ? `double all damage ${K.np(ev.source, st, { det: 'none' })} would deal` : `double all damage that ${K.np(ev.source, st, { det: 'none', plural: true, head: 'source' })} would deal`;
    absorb(st, fork);
    return alt(generic, text); // the "if ... instead" reading is the display; Oracle also words the doubling alone so
  }
  if (b.b === 'prevent' && ev.ev === 'damage' && e.optional !== true) {
    // PUSH1 T2: each reading starts from the same state (the generic one must not make "target creature" of the other an anaphor); both are known after
    const fork = cloneState(st);
    const generic = genericReplace(e, fork, duration);
    const text = preventDamage(e, ev, b, st, duration);
    absorb(st, fork);
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

/** "Prevent all combat damage that would be dealt this turn." / "Prevent the next 3 damage that would be dealt to target creature this turn." */
function preventDamage(e: ReplacementDef, ev: Extract<EventPattern, { ev: 'damage' }>, b: Extract<ReplacementDef['body'], { b: 'prevent' }>, st: RenderState, duration: Duration | undefined): string {
  const amount = b.amount === 'all' ? 'all' : e.shield ? `the next ${K.qty(b.amount, st)}` : `${K.qty(b.amount, st)} of`;
  // p2-replace-damage-1 (CR 615.1a, 120.1, 611.2a): the damage ONE object would deal is also "prevent all combat damage target creature would deal this turn" (Resistance
  // Fighter; family prevent-object-would-deal): the same damage, said with its source as the subject; only all of it, to anything, with nothing after it. Its own
  // state, forked before the other reading names the object
  const src = ev.source;
  const oneSource = src !== undefined && src.is !== undefined && Object.keys(src).filter((k) => (src as Record<string, unknown>)[k] !== undefined).length === 1;
  const wouldDeal = oneSource && ev.recipient === undefined && ev.amount === undefined && b.amount === 'all' && (b.then === undefined || b.then.length === 0) && !e.shield ? (() => {
    const fork = cloneState(st);
    const combatWord = ev.combat === true ? 'combat ' : ev.combat === false ? 'noncombat ' : '';
    return { fork, text: `prevent all ${combatWord}damage ${K.obj(src!.is!, fork, 'subject').text} would deal${durationSuffix(duration, fork)}` };
  })() : null;
  // p2-replace-damage-4 (CR 615.7, 615.1a): a one-use shield on the damage ONE object would deal (to anything, or to you) is "The next time target creature would deal
  // damage this turn, prevent that damage." (Mercenaries; family prevent-next-time-object), its own state forked as above
  const youOnly = JSON.stringify(ev.recipient) === '{"player":"you"}';
  const nextTime = oneSource && (ev.recipient === undefined || youOnly) && ev.amount === undefined && ev.combat === undefined && b.amount === 'all' && (b.then === undefined || b.then.length === 0)
    && e.shield?.uses === 1 && e.shield.amount === undefined ? (() => {
      const fork = cloneState(st);
      return { fork, text: `the next time ${K.obj(src!.is!, fork, 'subject').text} would deal damage${youOnly ? ' to you' : ''}${durationSuffix(duration, fork)}, prevent that damage` };
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
    ? ` to ${K.player(r.player, st, 'object').text} and ${K.np(r.object, st, { det: 'none', plural: true })}` : null;
  if (recipient === null && both === null) throw new NoRenderer('a prevention shield on an object or a player that are not one target');
  const to = recipient ?? both!;
  // p2-replace-damage-1 (CR 120.3, 109.4): a source described by who controls it and its color only is also "sources": "by sources you don't control" (Energy Field;
  // family prevent-by-sources), any object, a spell as well as a permanent
  const srcKeys = ev.source ? Object.keys(ev.source).filter((k) => (ev.source as Record<string, unknown>)[k] !== undefined) : [];
  const sources = ev.source && srcKeys.length > 0 && srcKeys.every((k) => k === 'controller' || k === 'not' || k === 'colors')
    && (ev.source.not === undefined || Object.keys(ev.source.not).join() === 'controller') ? [K.np(ev.source, st, { det: 'none', plural: true, head: 'source' }), K.np(ev.source, st, { det: 'a', head: 'source' })] : [];
  const source = ev.source ? ` by ${alt(K.np(ev.source, st, { det: 'a' }), K.np(ev.source, st, { det: 'none', plural: true }), ...sources)}` : '';
  const then = b.then && b.then.length > 0 ? `. ${K.steps(b.then, st)}` : '';
  const dur = durationSuffix(duration, st);
  const main = `prevent ${amount} ${combat}damage that would be dealt${to}${source}${dur}${then}`;
  // r4-repl (CR 611.2a, 615.1a): a resolved prevention effect may also say its duration before the sources ("... to you and creatures you control this turn by
  // creatures", Eerie Interference) or first ("Until your next turn, prevent all damage that would be dealt to you.", Morningtide's Light); not a shield, whose
  // duration is part of its own words (family prevent-duration-placed)
  const placed = dur === '' || e.shield ? [] : [...(source !== '' ? [`prevent ${amount} ${combat}damage that would be dealt${to}${dur}${source}${then}`] : []), `${dur.trim()}, prevent ${amount} ${combat}damage that would be dealt${to}${source}${then}`];
  if (wouldDeal !== null) { placed.push(wouldDeal.text); absorb(st, wouldDeal.fork); }
  // p2-replace-damage-1 (CR 611.2a, 615.1a): the duration of a resolved prevention may also come before its recipients, "Prevent all damage that would be dealt this turn
  // to creatures you control." (Sivvi's Ruse; family prevent-duration-placed)
  if (dur !== '' && !e.shield && to !== '') placed.push(`prevent ${amount} ${combat}damage that would be dealt${dur}${to}${source}${then}`);
  // p2-replace-damage-1 (CR 615.7, 107.3): a shield of a computed amount is also "prevent the next X damage ... this turn, where X is ..." (Samite Pilgrim; family
  // prevent-x-where), the amount fixed as the shield is created
  if (e.shield && b.amount !== 'all' && typeof b.amount === 'object' && b.amount.q !== 'X' && then === '') {
    placed.push(`prevent the next x ${combat}damage that would be dealt${to}${source}${dur}, where x is ${K.qty(b.amount, cloneState(st))}`);
  }
  if (nextTime !== null) { placed.push(nextTime.text); absorb(st, nextTime.fork); }
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
  const present = K.event(ev, st, 'would');
  // p2-replace-events-2 (family next-time-would): the one-use shield is also "the next time you would draw a card this turn" (Words of Wilding)
  const lead = e.shield && e.shield.uses === 1 ? alt(`the next time ${K.event(ev, st, 'present')}${dur}`, `if ${present}${dur}`, `the next time ${present}${dur}`) : `if ${present}${dur}`;
  const sentence = `${lead}${condition}, ${bodyText(e, it, st)}`.replace(', instead,', ' instead,');
  // FAST5 T69 (CR 611.2a): "Until your next turn, if a source would deal damage to that player ..., it deals double that damage instead": the duration may also lead
  // the replacement of a resolved effect (not a shield, whose duration is part of its own words)
  if (dur === '' || e.shield) return sentence;
  return alt(sentence, `${dur.trim()}, if ${present}${condition}, ${bodyText(e, it, st)}`.replace(', instead,', ' instead,'));
}

// ---------------------------------------------------------------------------
// Permissions, rule modifications, trigger modifiers, cost options
// ---------------------------------------------------------------------------

/** The optional fields of a permission that its sentence has words for (design 3.3: any other that is set is refused, never dropped). */
const PERMIT_FIELDS: Record<Extract<StaticEffect, { s: 'permit' }>['action'], string[]> = {
  cast: ['of', 'from', 'asThough', 'fromTop', 'oncePerTurn', 'anyManaType', 'anyManaColor', 'while', 'asAdventure'], play: ['of', 'from', 'fromTop', 'anyManaType', 'anyManaColor', 'while'], playLand: ['count'], activate: ['of', 'asThough'], spendMana: ['asThough', 'of'] /* CLOUD std-fdn */, haveFlash: ['of', 'asThough', 'costChange'],
  attackAsThoughNoDefender: ['of'] /* r3-static */, blockAsThough: ['asThough', 'attacker'] /* p2-attack-block-1 */, lookAt: ['of'] /* FAST5X E25 */, revealTop: [], assignAsUnblocked: [],
  activateLoyaltyAsInstant: ['of'], // r4-mech (CR 606.3)
  plot: ['of', 'fromTop'], // std-freecast-5 (CR 702.170f): said by permit() itself, before this table is read
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
  const base = `${who.text} may ${what} from the top of ${topLibrary(who)}${topEntersRider([e])}`;
  if (e.oncePerTurn === true) return `once each turn, ${base}`;
  return e.action === 'play' && e.of === undefined ? alt(base, `${who.text} may play the top card of ${topLibrary(who)}`) : base;
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
      : `${who.text} may ${whats.join(' and ')} from the top of ${topLibrary(who)}${topEntersRider(perms)}`;
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
export function anyTypeRider(base: string, plural?: boolean, color = false): string {
  const them = plural === undefined ? alt('it', 'that spell', 'them', 'those spells') : plural ? alt('them', 'those spells') : alt('it', 'that spell');
  // std-exile-play-1-1 (family cast-this-way-any-type): or the sentence "Mana of any type can be spent to cast spells this way." (rider rid.stdexile1.castThisWay.anyManaType)
  // std-exile-play-1-1 (family any-type-rider-and): Oracle also joins the rider without the comma, "... until end of turn and mana of any type can be spent to cast that spell"
  // pc-exile-play-1 (CR 609.4b, 107.4c): or, for a permission with `anyManaColor`, "..., and you may spend mana as though it were mana of any color to cast that spell"
  return alt(`${base}${alt(', and', ' and')} ${color ? 'you may spend mana as though it were mana of any color to cast' : 'mana of any type can be spent to cast'} ${them}`,
    ...(color ? [] : [`${base}. if you cast a spell this way, you may spend mana as though it were mana of any type to cast it`, `${base}. mana of any type can be spent to cast ${alt('spells', 'a spell')} this way`]));
}

/**
 * FAST5X E29: a permission for named objects with "if <condition>" after it ("you may play it if you control a Kavu") and the rider of CR 609.4b after its
 * duration ("you may cast that card for as long as it remains exiled, and mana of any type can be spent to cast it").
 */
function permitRiders(e: Extract<StaticEffect, { s: 'permit' }>, st: RenderState, d: Duration | undefined): string {
  if (e.action !== 'play' && e.action !== 'cast') throw new NoRenderer(`permit ${e.action} with a rider`);
  const { anyManaType, anyManaColor, while: cond, graveyardInstead: gi, ...bare } = e;
  if (anyManaType !== undefined && anyManaColor !== undefined) throw new NoRenderer('a permission with both riders for how its spells are paid');
  const plain = permit(bare, st, isLimited(d));
  const during = duringTurnCounter(cond, d, st); // r5-dig
  const base = during !== null ? `${during}, ${plain}` : lasting(cond === undefined ? plain : `${plain} if ${K.cond(cond, st)}`, d, st);
  const any = anyManaType !== undefined ? anyTypeRider(base) : anyManaColor !== undefined ? anyTypeRider(base, undefined, true) : base;
  if (gi === undefined) return any;
  // r5-repl (CR 614.1a): "... If that spell would be put into a graveyard, exile it instead." (the words of the cast step's rider, render/steps-zones.ts)
  if (e.action !== 'cast') throw new NoRenderer('a play permission with a graveyard rider');
  const to = gi.to.zone === 'exile' && Object.keys(gi.to).length === 1 ? 'exile it'
    : gi.to.zone === 'library' && gi.to.position === 'bottom' && Object.keys(gi.to).length === 2 ? "put it on the bottom of its owner's library" : null;
  if (to === null) throw new NoRenderer('a spell cast this way sent elsewhere than exile or the bottom of its library instead of a graveyard');
  // p2-graveyard-2 (CR 614.1a, 400.7; family cast-this-way-spell): a graveyard permission's spell is also "a spell cast this way" ("Once during each of your turns, you
  // may cast an instant or sorcery spell from your graveyard. If a spell cast this way would be put into your graveyard, exile it instead", Kess, Dissident Mage)
  const spell = e.from === 'graveyard' && e.of?.is === undefined ? alt('that spell', 'a spell cast this way') : 'that spell';
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
  for (const k of ['asThough', 'count', 'costChange', 'grants', 'laterTurn', 'fromTop', 'anyManaType', 'while', 'graveyardInstead'] as const) if (e[k] !== undefined) throw new NoRenderer(`a graveyard permission with ${k}`);
  if (e.who.ref !== 'you' || Object.keys(e.who).length !== 1) throw new NoRenderer('a graveyard permission of another player');
  if (e.action === 'play') {
    if (e.addCost !== undefined || e.entersWith !== undefined || e.oncePerTurn !== undefined) throw new NoRenderer('a graveyard play permission with a rider');
    return `you may play ${e.of === undefined ? 'cards' : K.np(e.of, st, { det: 'none', plural: true })} from your graveyard`;
  }
  if (e.entersSubtypes !== undefined) throw new NoRenderer('a graveyard permission with subtypes it enters as, outside its one-spell form (staticEffect)');
  const self = e.of !== undefined && Object.keys(e.of).length === 1 && e.of.self === true;
  const one = self || e.oncePerTurn === true || e.single === true; // "a creature spell", "~": "its other costs"
  const what = self ? K.obj({ ref: 'self' }, st, 'object').text
    : e.of === undefined ? (one ? 'a spell' : 'spells')
    : one ? K.np(e.of, st, { det: 'a' })
    : isSpellFilter(e.of) ? spellsPhrase(e.of, st) : K.np(e.of, st, { det: 'none', plural: true, head: 'spell' });
  let text = `you may cast ${what} from your graveyard`;
  if (e.addCost !== undefined) text += ` by ${graveyardCostGerund(e.addCost, st)} in addition to ${alt(`paying ${one ? 'its' : 'their'} other costs`, `${one ? 'its' : 'their'} other costs`)}`;
  if (e.oncePerTurn === true) text = `once each turn, ${text}`;
  if (e.entersWith !== undefined) {
    if (e.single === true) throw new NoRenderer('a one-spell graveyard permission with its rider, outside staticEffect');
    const counters = entersCounters(e.entersWith);
    // "that artifact" names the spell by the card type its permission is for (CR 614.1c); the card itself is "it" ("If you do, it enters with ...")
    const noun = self ? null : riderNoun(e.of);
    text += self ? `. if you do, ${alt('it', '~')} enters with ${counters} on it` : `. if you cast a spell this way, ${alt(`that ${noun}`, 'it')} enters with ${counters} on it`;
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
  if (p.kind === 'action' && p.action === 'forage' && p.arg === undefined) return 'foraging';
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
  // std-freecast-1 (CR 118.9, 601.2b, 102.1): "the first spell each player casts during each of their turns may be cast without paying its mana cost"
  if (e.firstSpellThisTurn === true) {
    const cost = (cc.cost ?? {}) as Record<string, unknown>;
    if (e.who.ref !== 'active' || cc.kind !== 'set' || Object.keys(cost).some((k) => cost[k] !== undefined) || e.oncePerTurn !== undefined || e.of !== undefined) {
      throw new NoRenderer('a first-spell alternative cost other than "the first spell each player casts during each of their turns" for nothing');
    }
    return `the first spell each player casts during each of their turns ${alt('may', 'can')} be cast without paying its mana cost`; // family may-can-be-cast-free
  }
  if (e.who.ref !== 'you' || cc.kind !== 'set' || cc.cost === undefined || cc.mana !== undefined || cc.generic !== undefined) throw new NoRenderer('an alternative-cost permission that is not "you may pay [cost] rather than ..."');
  const cost = cc.cost as Record<string, unknown>;
  const costKeys = Object.keys(cost).filter((k) => cost[k] !== undefined);
  // r4-cost (CR 118.9, 701.59a): "you may collect evidence 10 rather than pay the mana cost for spells you cast": one keyword-action cost part, said as its verb
  const action = costKeys.length === 1 && costKeys[0] === 'other' && Array.isArray(cost['other']) && cost['other'].length === 1 && (cost['other'][0] as { kind?: string }).kind === 'action';
  if (costKeys.some((k) => k !== 'mana') && !action) throw new NoRenderer('an alternative cost that is not mana');
  const of = (e.of ?? {}) as ObjectFilter;
  const { castFrom, ...outer } = of;
  const inner = castFrom !== undefined && Object.keys(outer).length === 1 && outer.anyOf?.length === 1 ? outer.anyOf[0]! : castFrom !== undefined ? null : of;
  if (inner === null) throw new NoRenderer('spells cast from a zone with other qualities around them');
  const from = castFrom === undefined ? '' : castFrom === 'hand' ? ' from your hand' : castFrom === 'exile' ? ' from exile' : castFrom === 'graveyard' ? ' from your graveyard' : null;
  if (from === null) throw new NoRenderer(`spells cast from ${String(castFrom)}`);
  const once = e.oncePerTurn === true;
  const spells = once ? K.np({ ...inner, zone: 'stack', stackKind: 'spell' }, st, { det: 'a' }) : spellsPhrase(inner, st);
  const lead = once ? 'once each turn, you may' : 'you may';
  if (costKeys.length === 0) {
    // r4-cost (CR 118.9, 601.2b): "once each turn, you may cast an instant spell from your hand without paying its mana cost" (one spell: "its")
    if (once) return `${lead} cast ${spells}${from} without paying its mana cost`;
    return `${lead} cast ${spells}${from} without paying their mana costs`;
  }
  if (action) return `${lead} ${K.costVerbs(cc.cost, st, 'you')} rather than pay the mana cost for ${spells} you cast${from}`;
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
  if (e.costChange?.life !== undefined) {
    const cc = e.costChange as unknown as Record<string, unknown>;
    if (e.costChange.life !== 'manaValue' || e.costChange.kind !== 'set' || Object.keys(cc).some((k) => cc[k] !== undefined && k !== 'kind' && k !== 'life')
      || e.of?.is?.ref !== 'linked' || Object.keys(e.of).length !== 1) throw new NoRenderer('a life cost on a permission other than for the cards exiled with ~');
    const { costChange: _cc, ...plain } = e;
    return `${permit(plain, st, limited)}. if you cast a spell this way, pay life equal to its mana value rather than ${alt('pay', 'paying')} its mana cost`;
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
    return `${permit(bare, st, limited)} without paying ${plural ? 'their mana costs' : 'its mana cost'}`;
  }
  // r3-cost: an alternative cost a static ability gives other spells (no `from`: it permits nothing else)
  if (e.action === 'cast' && e.costChange !== undefined && e.from === undefined && e.fromTop === undefined) return alternativePermit(e, st);
  // C10: from the graveyard (GY1's "you may play lands from your graveyard" included)
  if (e.from === 'graveyard' && (e.action === 'cast' || e.action === 'play') && e.fromTop === undefined && e.of?.is === undefined) return graveyardPermit(e, st);
  for (const k of ['of', 'from', 'asThough', 'count', 'costChange', 'grants', 'fromTop', 'oncePerTurn', 'anyManaType', 'anyManaColor', 'while', 'asAdventure'] as const) {
    if (e[k] !== undefined && !PERMIT_FIELDS[e.action].includes(k)) throw new NoRenderer(`permit ${e.action} with ${k}`);
  }
  // std-rx27 (CR 601.3, 305.1): "you may play a card exiled with ~": one card of the cards the object's linked ability exiled (statics/play-permits.ts#namedSingleKey)
  if (e.single !== undefined) {
    const { single: _single, ...bare } = e;
    if (e.single !== true || e.action !== 'play' || !isLinkedOnly(e.of) || JSON.stringify(e.who) !== '{"ref":"you"}' || Object.keys(bare).some((k) => !['s', 'who', 'action', 'of'].includes(k))) {
      throw new NoRenderer('a one-card permission other than "you may play a card exiled with ~"');
    }
    return `you may play a card exiled with ${K.obj({ ref: 'self' }, st, 'object').text}`;
  }
  // FAST5X E29: the rider and the condition are said by `permitRiders` (staticEffect), around the duration; r5-repl: the graveyard rider too
  if (e.anyManaType !== undefined || e.anyManaColor !== undefined || e.while !== undefined || e.graveyardInstead !== undefined) throw new NoRenderer('a permission with its rider, outside staticEffect');
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
    return `you may cast ${K.obj({ ref: 'self' }, st, 'object').text} as though it had flash if you ${K.costVerbs(e.addCost, st, 'you')} as an additional cost to cast it`;
  }
  const who = K.player(e.who, st, 'subject');
  const may = who.person === 'you' ? 'may' : 'may';
  // std-exile-play-1-1 (CR 608.2c; family they-may-play): one player named before is also "they" as the subject of the permission ("They may play that card ...")
  // when the pronoun names them uniquely (refs.ts#anaphor, `they`)
  const subj = who.they === true ? alt(who.text, 'they') : who.text;
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
      return `${subj} ${may} cast ${amongGroup ?? of}${from}${e.asThough ? ` as though ${e.asThough}` : ''}`;
    }
    case 'play': {
      const text = `${subj} ${may} play ${thing ?? (e.of ? K.np(e.of, st, { det: 'none', plural: true }) : 'cards')}${from}`;
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
      const text = `${who0} ${may} play ${n === null ? 'an additional land' : `${n} additional lands`}${limited ? '' : ` on each of ${who.person === 'you' ? 'your' : 'their'} turns`}`;
      // std-rx23 (CR 305.2a): "You may play up to three additional lands this turn" is the same permission of three more land plays (a permission is never an
      // obligation, so "up to" adds nothing); only for a permission limited in time
      return n !== null && limited ? alt(text, `${who0} ${may} play up to ${n} additional lands`) : text;
    }
    // r4-fxz (CR 302.6, 602.5a, 609.4): "You may activate abilities of creatures you control as though those creatures had haste"
    case 'activate': return `${subj} ${may} activate abilities${e.of ? ` of ${K.np(e.of, st, { det: 'none', plural: true })}` : ''}${e.asThough ? ` as though ${e.asThough}` : ''}`;
    case 'spendMana': {
      // std-rx32 (CR 609.4b): "You may spend mana as though it were mana of any color to activate abilities of creatures you control"
      if (e.abilities === true) {
        if (e.asThough !== 'any color' || e.of === undefined || e.who.ref !== 'you') throw new NoRenderer('an ability spend-mana permission other than "you may ... of any color to activate abilities of ..."');
        return `you may spend mana as though it were mana of any color to activate abilities of ${K.np(e.of, st, { det: 'none', plural: true })}`;
      }
      // CLOUD std-fdn (CR 609.4b): "You can spend mana of any type to cast creature spells" (Vizier of the Menagerie): only for the spells `of` describes
      if (e.of !== undefined) {
        if ((e.asThough !== 'any type' && e.asThough !== 'any color') || e.who.ref !== 'you') throw new NoRenderer('a spend-mana permission for some spells other than "you can spend mana of any type" or "you may spend mana as though it were mana of any color"');
        const spells = isSpellFilter(e.of) ? spellsPhrase(e.of, st) : K.np(e.of, st, { det: 'none', plural: true, head: 'spell' });
        // Standard round I (CR 609.4b): Oracle prints the colour wording as "You may spend mana as though it were mana of any color to cast ..."
        return e.asThough === 'any color' ? `you may spend mana as though it were mana of any color to cast ${spells}` : `you can spend mana of any type to cast ${spells}`;
      }
      return `${subj} ${may} spend mana as though it were mana of ${e.asThough ?? 'any type'}`;
    }
    // CLOUD std-ecl (CR 601.3b, 702.8a): the object itself is one spell, "as though it had flash"
    case 'haveFlash': return `${subj} ${may} cast ${of} as though ${e.asThough ?? (e.of !== undefined && Object.keys(e.of).length === 1 && e.of.self === true ? 'it had flash' : 'they had flash')}`;
    case 'attackAsThoughNoDefender':
      // r3-static (CR 609.4, 702.3b): "Creatures you control can attack as though they didn't have defender" (Ghalta): the objects `of` matches, which the
      // permission gives only to `who` (statics/hooks.ts#permitsObject), so the filter must say "you control" itself
      if (e.of !== undefined) {
        if (e.who.ref !== 'you' || e.of.controller !== 'you') throw new NoRenderer('a group defender permission for objects other than ones you control');
        return `${K.np(e.of, st, { det: 'none', plural: true })} can attack as though they didn't have defender`;
      }
      return `${K.obj({ ref: 'self' }, st, 'subject').text} can attack as though it didn't have defender`;
    // FAST5 T37 (CR 510.1b-c): the object itself, whose controller is who
    case 'assignAsUnblocked': return `${subj} ${may} have ${K.obj({ ref: 'self' }, st, 'subject').text} assign its combat damage as though it weren't blocked`;
    // r4-mech (CR 606.3): "you may activate loyalty abilities of Jace planeswalkers you control on any player's turn any time you could cast an instant"
    case 'activateLoyaltyAsInstant': {
      const whose = e.of === undefined ? K.obj({ ref: 'self' }, st, 'possessive').text : `of ${K.np(e.of, st, { det: 'none', plural: true })}`;
      return e.of === undefined ? `${subj} ${may} activate ${whose} loyalty abilities on any player's turn any time you could cast an instant`
        : `${subj} ${may} activate loyalty abilities ${whose} on any player's turn any time you could cast an instant`;
    }
    case 'blockAsThough': {
      // p2-attack-block-1 (CR 609.4, 702.14c): "creatures with islandwalk can be blocked as though they didn't have islandwalk": any player's creatures (`who`) may block
      // creatures (`attacker`) as though they didn't have the keyword `asThough` names. "With <keyword>" is said from `asThough`: only an attacker with that keyword
      // has a denial the permission waives, so the attackers it concerns are exactly the creatures with it (the gate refuses two different keywords)
      if (e.attacker !== undefined) {
        if (e.of !== undefined || e.asThough === undefined || JSON.stringify(e.who) !== '{"ref":"each","who":"player"}' || JSON.stringify(e.attacker) !== '{"types":["Creature"]}') throw new NoRenderer('a blockAsThough permission for attackers other than "creatures with <keyword>", any player');
        return `creatures with ${e.asThough} can be blocked as though they didn't have ${e.asThough}`;
      }
      return `${K.obj({ ref: 'self' }, st, 'subject').text} can block ${e.asThough ?? 'as though it had flying'}`;
    }
    case 'lookAt': {
      // FAST5X E25 (CR 708.5, 609.4): "you may look at face-down creatures your opponents control any time" (statics/play-permits.ts#faceDownVisibleTo)
      if (e.of !== undefined) {
        const { faceDown, ...rest } = e.of;
        if (faceDown !== true) throw new NoRenderer('a lookAt permission for objects that are not face down');
        return `${subj} ${may} look at face-down ${K.np(rest, st, { det: 'none', plural: true })} any time`;
      }
      return `${subj} ${may} look at the top card of ${who.person === 'you' ? 'your' : 'their'} library any time`;
    }
    // p2-dig-1 (CR 401.2): "Players play with the top card of their libraries revealed" (each player, statics/play-permits.ts#topCardRevealed)
    case 'revealTop': return e.who.ref === 'each' && 'who' in e.who && e.who.who === 'player' ? 'players play with the top card of their libraries revealed'
      : `play with the top card of ${who.person === 'you' ? 'your' : 'their'} library revealed`;
  }
}

/** r3-static: the filter "~ or an Equipment attached to it" of a trigger modification, as parser/templates/zz-cloud/r3-static.json builds it. */
const SELF_OR_ITS_EQUIPMENT = JSON.stringify({ anyOf: [{ self: true }, { subtypes: ['Equipment'], attachedToObject: { ref: 'self' } }] });
/** std-typechange-2: "this creature or an emblem you own" (The Masamune; sta.stdtc2.triggerMod.dying.selfOrEmblem). */
const SELF_OR_EMBLEM = JSON.stringify({ anyOf: [{ self: true }, { emblem: true, owner: 'you' }] });

/** The optional fields of a rule that its sentence has words for. */
const RULE_FIELDS: Record<RuleModDef['rule'], string[]> = {
  maxHandSize: ['player', 'value'], handSizeNoLimit: ['player'], startingLife: ['player', 'value'], landPlays: ['player', 'value'], combatDamageUsesToughness: ['of'],
  manaDoesNotEmpty: ['player'], attackTax: ['player', 'value', 'of'], extraBlockers: ['of', 'value'], extraAttackerBlocks: ['of', 'value'], poisonLimit: ['player', 'value'],
  commanderTax: ['value'], lifeTotalSetAs: ['player', 'value'], untapDuringOtherUntapSteps: ['of'],
  crewSaddlePowerBonus: ['value'], crewSaddleUsesToughness: [], // FAST5X E3
  unspentManaBecomes: ['player', 'manaType'], // FAST5X E19 (CR 106.4, 614.1); manaDoesNotEmpty's `manaType` is said too (below)
  additionalVote: [], mayVoteAdditional: [], // M12-3 (CR 701.38d): "you" only
  stationUsesToughness: ['of'], // cloud r3-mech (CR 702.184a)
  commanderTaxAsLife: ['value'], // CMD2 (CR 903.8)
  blockTax: ['value', 'of'], // r5-static (CR 509.1d)
  legendRuleExempt: ['of'], noLossForZeroLife: ['player'], additionalActivation: ['of'], negativePowerAssignsAsPositive: [], // r3-static (CR 704.5j, 704.5a, 602.5b, 510.1a)
  firstCoinFlipsWon: [], // r4-mech (CR 705.1-705.2): "you" only
  damageNotRemovedInCleanup: ['of'], // r4-mech (CR 514.2)
  zeroLoyaltyKept: ['of'], // r4-mech (CR 704.5i)
  mayNotUntap: [], // std-rx13 (CR 502.3): the source itself only
  targetableThroughHexproof: ['of'], // std-rx32 (CR 702.11b)
  activateAsUnactivated: [], // std-rx27 (CR 602.5b, 702.177a): `keyword` only, "you"
  mayExertAsAttacks: [], enlist: [], // std-ry8 (CR 701.43a, 702.154a): the source itself only
  untapLimit: ['player', 'value', 'of'], // p2-player-rules-1 (CR 502.3)
  tapManaMultiplier: ['of', 'value'], // std-mana-1 (CR 106.12, 614.1a): "you" only
  diceAdvantage: [], // p2-c-dieroll-1 (CR 706.6, 614.1a): "you" only
};

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
function combatTax(e: RuleModDef, st: RenderState, n: string): string {
  if (e.player !== undefined && !(e.player.ref === 'you' && Object.keys(e.player).length === 1)) throw new NoRenderer(`${e.rule} for another player`);
  if ((e.value !== undefined) === (e.cost !== undefined)) throw new NoRenderer(`${e.rule} needs exactly one of value and cost`);
  if (e.value === 'none') throw new NoRenderer(`${e.rule} without an amount`);
  if (e.rule === 'blockTax' ? e.defenders !== undefined : e.blocking !== undefined) throw new NoRenderer(`${e.rule} with ${e.rule === 'blockTax' ? 'defenders' : 'blocking'}`);
  // a computed amount is "{X} for each ..., where X is the number of enchantments you control" (Oracle's order: the count last)
  let pay = typeof e.value === 'object' ? '{X}' : `{${n}}`;
  const where = typeof e.value === 'object' ? `, where X is ${n}` : '';
  if (e.cost !== undefined) {
    const { mana, other, ...rest } = e.cost;
    const life = other?.length === 1 && other[0]!.kind === 'payLife' && typeof other[0]!.amount === 'number' ? other[0]!.amount : undefined;
    if (Object.keys(rest).length > 0 || (mana !== undefined) === (other !== undefined) || (other !== undefined && life === undefined)) throw new NoRenderer(`${e.rule} with this cost`);
    pay = mana !== undefined ? formatManaCost(mana) : `${life} life`;
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
  if (e.manaType !== undefined && e.rule !== 'manaDoesNotEmpty' && e.rule !== 'unspentManaBecomes') throw new NoRenderer(`rule ${e.rule} with manaType`);
  if (e.delta !== undefined && e.rule !== 'maxHandSize') throw new NoRenderer(`rule ${e.rule} with delta`); // std-ry3
  if (e.onlyIf !== undefined && e.rule !== 'combatDamageUsesToughness' && e.rule !== 'stationUsesToughness') throw new NoRenderer(`rule ${e.rule} with onlyIf`);
  if ((e.keyword !== undefined) !== (e.rule === 'additionalActivation' || e.rule === 'activateAsUnactivated')) throw new NoRenderer(`rule ${e.rule} with${e.keyword === undefined ? 'out' : ''} keyword`);
  if (e.then !== undefined && e.rule !== 'mayExertAsAttacks') throw new NoRenderer(`rule ${e.rule} with then`);
  const who = e.player ? K.player(e.player, st, 'subject') : K.player({ ref: 'you' }, st, 'subject');
  const poss = e.player ? K.player(e.player, st, 'possessive').text : 'your';
  const v = e.value;
  const n = v === undefined || v === 'none' ? '' : K.qty(v, st);
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
    case 'combatDamageUsesToughness': {
      const assigns = 'assigns combat damage equal to its toughness rather than its power';
      if (e.onlyIf === undefined) return `each ${e.of ? K.np(e.of, st, { det: 'none' }) : 'creature'} ${assigns}`;
      // FAST5 T60 (CR 510.1a): only while its toughness is greater than its power; the creature an Equipment is attached to is "equipped creature"
      if (e.of !== undefined && JSON.stringify(e.of) === '{"attachedToSource":true}') return `as long as ${K.obj({ ref: 'attachedTo' }, st, 'subject').text}'s toughness is greater than its power, it ${assigns}`;
      return `each ${e.of ? K.np(e.of, st, { det: 'none' }) : 'creature'} with toughness greater than its power ${assigns}`;
    }
    // r4-mech (CR 514.2): "damage isn't removed from ~ during cleanup steps", or from each permanent of a description ("from creatures your opponents control")
    case 'damageNotRemovedInCleanup': return `damage isn't removed from ${e.of === undefined ? K.obj({ ref: 'self' }, st, 'object').text : K.np(e.of, st, { det: 'none', plural: true })} during cleanup steps`;
    // std-rx13 (CR 502.3): "you may choose not to untap ~ during your untap step"
    case 'targetableThroughHexproof': return `${K.np(e.of!, st, { det: 'none', plural: true })} can be the targets of spells and abilities as though they didn't have hexproof`; // std-rx32 (CR 702.11b)
    case 'mayNotUntap': return `you may choose not to untap ${K.obj({ ref: 'self' }, st, 'object').text} during your untap step`;
    // std-ry8 (CR 701.43a, 603.12): "you may exert ~ as it attacks", and "When you do, X." (its `then`: one reflexive trigger waiting for the exert)
    case 'mayExertAsAttacks': {
      const exert = `you may exert ${K.obj({ ref: 'self' }, st, 'object').text} as it attacks`;
      if (e.then === undefined) return exert;
      const r = e.then.do.length === 1 ? e.then.do[0]! : undefined;
      if (r === undefined || r.op !== 'reflexive' || r.when.did !== e.then.as || r.when.if !== undefined || r.modes !== undefined) throw new NoRenderer('the steps after an exert other than "When you do, X"');
      return `${exert}. when you do, ${K.steps(r.do, st)}`;
    }
    case 'enlist': throw new NoRenderer('enlist is said by its keyword');
    // r4-mech (CR 704.5i): "planeswalkers you control aren't put into their owners' graveyards for having 0 loyalty"
    case 'zeroLoyaltyKept': return e.of === undefined
      ? `${K.obj({ ref: 'self' }, st, 'subject').text} isn't put into its owner's graveyard for having 0 loyalty`
      : `${K.np(e.of, st, { det: 'none', plural: true })} aren't put into their owners' graveyards for having 0 loyalty`;
    // r4-mech (CR 705.1-705.2, 614.1a)
    case 'firstCoinFlipsWon': return 'the first time you flip one or more coins each turn, those coins come up heads and you win those flips';
    // p2-c-dieroll-1 (CR 706.6, 614.1a)
    case 'diceAdvantage': return 'if you would roll one or more dice, instead roll that many dice plus one and ignore the lowest roll';
    // cloud r3-mech (CR 702.184a): "each creature you control with toughness greater than its power stations permanents using its toughness rather than its power"
    case 'stationUsesToughness': {
      const stations = 'stations permanents using its toughness rather than its power';
      if (e.of === undefined) return `${K.obj({ ref: 'self' }, st, 'subject').text} ${stations}`;
      return `each ${K.np(e.of, st, { det: 'none' })}${e.onlyIf !== undefined ? ' with toughness greater than its power' : ''} ${stations}`;
    }
    case 'manaDoesNotEmpty': {
      // CR 500.5: "Mana pools don't empty" is every player's; "You don't lose unspent mana" is the one player's
      // FAST5X E19 (CR 106.4): "You don't lose unspent red mana as steps and phases end": only mana of that type
      const mana = e.manaType === undefined ? 'unspent mana' : `unspent ${manaTypeWord(e.manaType)} mana`;
      const lose = `${who.text} ${who.person === 'you' ? "don't" : "doesn't"} lose ${mana} as steps and phases end`;
      return e.player?.ref === 'each' && e.manaType === undefined ? alt("mana pools don't empty as steps and phases end", lose) : lose;
    }
    // r3-static (CR 704.5j): "The "legend rule" doesn't apply to permanents you control" / "The "legend rule" doesn't apply."
    case 'legendRuleExempt': return `the "legend rule" doesn't apply${e.of === undefined ? '' : ` to ${K.np(e.of, st, { det: 'none', plural: true })}`}`;
    // r3-static (CR 602.5b, 702.193a): "Each power-up ability of permanents you control can be activated an additional time" (one more; no `value`)
    // std-rx27 (CR 602.5b, 702.177a): "you may activate exhaust abilities as though they haven't been activated" (statics/hooks.ts#activatesAsUnactivated)
    case 'activateAsUnactivated': return `you may activate ${e.keyword} abilities as though they haven't been activated`;
    case 'additionalActivation': return `each ${e.keyword} ability of ${e.of === undefined ? 'permanents' : K.np(e.of, st, { det: 'none', plural: true })} can be activated an additional time`;
    // r3-static (CR 510.1a): Oracle's "he" / "his" for a character are "~" and "~'s" by the time the gate compares (equivalence self-by-name)
    case 'negativePowerAssignsAsPositive': return `if ~'s power is negative, ~ assigns combat damage as though ~'s power were positive`;
    // r3-static (CR 704.5a, 104.3b)
    case 'noLossForZeroLife': return `${who.text} ${who.person === 'you' ? "don't" : "doesn't"} lose the game for having 0 or less life`;
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
      return `${who} can block ${v === 'none' || v === undefined ? 'any number of creatures' : typeof v === 'number' && v === 1 ? `an additional creature${each}` : `up to ${n} additional creatures${each}`}`;
    }
    case 'extraAttackerBlocks': return `${e.of ? K.np(e.of, st, { det: 'a' }) : K.obj({ ref: 'self' }, st, 'subject').text} can be blocked by ${v === 'none' || v === undefined ? 'any number of creatures' : `up to ${n} additional creatures`}`;
    // T20 (FAST4): CR 502.3, the source itself
    // r4-static (CR 502.3): or the permanents of `of`, "Untap each creature you control during each other player's untap step" / "Untap all creatures you control ..."
    case 'untapDuringOtherUntapSteps': return e.of === undefined
      ? `untap ${K.obj({ ref: 'self' }, st, 'object').text} during each other player's untap step`
      : `untap ${alt(`each ${K.np(e.of, st, { det: 'none' })}`, `all ${K.np(e.of, st, { det: 'none', plural: true })}`)} during each other player's untap step`;
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
    case 'crewSaddleUsesToughness': return `${K.obj({ ref: 'self' }, st, 'subject').text} saddles Mounts and crews Vehicles using its toughness rather than its power`;
    // M12-3 (CR 701.38d): the controller of the source has one more vote in every vote
    case 'additionalVote': return 'while voting, you get an additional vote';
    case 'mayVoteAdditional': return 'while voting, you may vote an additional time';
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
  // trek-2 (CR 603.2d): "if you gaining life causes a triggered ability ... to trigger" (Dr. Beverly Crusher): a life gain of the doubler's controller
  if (isLifeGainCause(ev)) return 'you gaining life';
  return K.event(ev, st, 'present');
}

function additionalCost(e: Extract<StaticEffect, { s: 'additionalCost' }>, st: RenderState): string {
  // M6-0: a choice between grouped costs ("sacrifice a creature or pay {3}", CR 601.2b) is one sentence over several effects: M6-5 writes its wording
  if (e.choiceGroup !== undefined) throw new NoRenderer('an additional cost in a choice group (M6-5)');
  const self = K.obj({ ref: 'self' }, st, 'subject').text;
  // std-costs-2 (CR 601.2b, 607.2d): "you may choose a creature type and behold two creatures of that type": the choice the cost starts with
  if (e.chooseType !== undefined && (e.repeatable || e.xMax !== undefined || e.choosePlayer !== undefined)) throw new NoRenderer('a chosen creature type with another kind of additional cost');
  const body = `${e.chooseType !== undefined ? 'choose a creature type and ' : ''}${K.costVerbs(e.cost, st, 'you')}`;
  const rep = e.repeatable ? ' any number of times' : '';
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
  // FAST5X E7: sneak's timing and "enters tapped and attacking" (CR 702.190a-b) have no wording of their own here: only the keyword says them
  if (e.instantSpeed !== undefined || e.entersAttacking !== undefined) throw new NoRenderer('an alternative cost with sneak timing or entry outside its keyword');
  const self = K.obj({ ref: 'self' }, st, 'subject');
  // FAST4 T32: an alternative cost of nothing is "cast ~ without paying its mana cost" (CR 118.9: it is an alternative cost; X is 0, CR 107.3b)
  const costParts = Object.keys(e.cost).filter((k) => (e.cost as Record<string, unknown>)[k] !== undefined);
  if (costParts.length === 0 && e.from === undefined) {
    const free = `you may cast ${self.text} without paying its mana cost`;
    return e.when ? `if ${K.cond(e.when, st)}, ${free}` : free;
  }
  const body = K.costVerbs(e.cost, st, 'you');
  const poss = self.text === '~' ? "~'s" : 'its';
  const zone = e.from ? ` from ${e.from === 'graveyard' || e.from === 'hand' ? `your ${e.from}` : e.from}` : '';
  const main = e.from ? `you may cast ${self.text}${zone} by ${body.replace(/^pay /, 'paying ')} rather than pay ${poss} mana cost` : `you may ${body} rather than pay ${poss} mana cost`;
  if (!e.when) return main;
  // FAST4 T32: "You may pay {B} rather than pay ~'s mana cost if there are thirteen or more creatures on the battlefield": the condition after it (CR 118.9)
  const c = K.cond(e.when, st);
  return e.from ? `if ${c}, ${main}` : alt(`if ${c}, ${main}`, `${main} if ${c}`);
}

function pregame(e: Extract<StaticEffect, { s: 'pregame' }>, st: RenderState): string {
  const self = K.obj({ ref: 'self' }, st, 'subject').text;
  switch (e.action) {
    case 'beginOnBattlefield': return `if ${self} is in your opening hand, you ${e.optional ? 'may ' : ''}begin the game with ${alt('it', self)} on the battlefield`;
    case 'reveal': return `you ${e.optional ? 'may ' : ''}reveal ${self} from your opening hand`;
    case 'exileBeforeShuffle': return `if ${self} is in your opening hand, you ${e.optional ? 'may ' : ''}exile it before the game begins`;
  }
}

// FAST4 T33: 'haveCountersPut' ("can't become untapped and can't have counters put on it", CR 122.6)
const SIMPLE_CANT = new Set<RuleAction>(['attack', 'block', 'beBlocked', 'untap', 'tap', 'transform', 'draw', 'gainLife', 'loseLife', 'sacrifice', 'discard', 'haveCountersPut']);
const isSimpleCant = (e: StaticEffect): e is RestrictionDef => e.s === 'restrict' && e.mode === 'cant' && e.other === undefined && e.max === undefined && e.when === undefined && e.alone !== true && SIMPLE_CANT.has(e.action);

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
  // std-rx27 (CR 305.2, 601.3, 110.4a): "you may play a land and cast a permanent spell of each permanent type from your graveyard" (each once each turn)
  if (eachPermanentTypeFromGraveyard(effects)) return 'you may play a land and cast a permanent spell of each permanent type from your graveyard';
  // pc-exile-play-1 (CR 601.3, 113.6b; Squee, the Immortal): "You may cast this card from your graveyard or from exile": the two permissions for the card itself, one for each zone
  if (effects.length === 2 && effects.every((e) => e.s === 'permit' && e.action === 'cast' && JSON.stringify(e.who) === '{"ref":"you"}' && JSON.stringify(e.of) === '{"self":true}' && Object.keys(e).length === 5)
    && (effects[0] as { from?: string }).from === 'graveyard' && (effects[1] as { from?: string }).from === 'exile') {
    return `you may cast ${K.obj({ ref: 'self' }, st, 'object').text} from ${alt('your graveyard or from exile', 'exile or from your graveyard')}`; // either order of the two zones (family cast-self-graveyard-or-exile)
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
    const cards = K.np({ ...ex.of, zone: 'exile' }, st, { det: 'none', plural: true, noZone: true });
    return `you may ${ex.action} ${cards} from exile${ex.anyManaType === true ? ', and mana of any type can be spent to cast those spells' : ''}`;
  }
  // FAST4 T32: "During your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments" (CR 601.3, 602.5, 109.2)
  if (yourTurnCastActivate(effects)) return yourTurnCastActivateText(effects[1] as RestrictionDef, st);
  // std-rx1 (CR 601.3, 602.5, 605.1a, 506.1): "During combat, players can't cast spells or activate abilities that aren't mana abilities" (Yuriko, Blade of the Mighty)
  if (combatCastActivateNonMana(effects)) return combatCastActivateNonManaText(effects[0] as RestrictionDef);
  // cloud std-spm (CR 615.12): the static ability "Damage can't be prevented." (Leyline of Punishment, Spider-Punk): the pair of FAST5 T57, for as long as the source is there
  if (damageUnpreventable(effects)) return "damage can't be prevented";
  if (protectionFromOpponents(effects)) return 'you have protection from each of your opponents'; // r5-static (CR 702.16b-e, unverified 702.16k)
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
  return a.mode === 'cant' && a.action === 'cast' && combat(a) && plain(a, ['s', 'subject', 'mode', 'action', 'when'])
    && b.mode === 'cant' && b.action === 'activate' && b.exceptMana === true && combat(b) && plain(b, ['s', 'subject', 'mode', 'action', 'when', 'exceptMana'])
    && JSON.stringify(a.subject) === JSON.stringify(b.subject) && 'who' in a.subject && a.subject.ref === 'each' && (a.subject.who === 'player' || a.subject.who === 'opponent');
}

function combatCastActivateNonManaText(a: RestrictionDef): string {
  const group = (a.subject as { who: 'player' | 'opponent' }).who === 'opponent' ? 'your opponents' : 'players'; // the plural group (family players-plural)
  return `during combat, ${group} can't cast spells or activate abilities that aren't mana abilities`;
}

/**
 * FAST5 T40 (CR 615.1, 510.1): "Prevent all combat damage that would be dealt to and dealt by ~" (Fog Bank): one prevention of combat damage dealt to the object
 * itself and one of combat damage dealt by it, each with nothing else in it.
 */
function selfCombatPrevention(e: StaticEffect, side: 'recipient' | 'source', who: '{"self":true}' | '{"attachedToSource":true}' = '{"self":true}'): boolean {
  if (e.s !== 'replace' || e.body.b !== 'prevent' || e.body.amount !== 'all' || e.body.then !== undefined || e.optional === true || e.shield !== undefined || e.condition !== undefined || e.selfReplacement === true) return false;
  const ev = e.replaces;
  if (ev.ev !== 'damage' || ev.combat !== true || ev.amount !== undefined) return false;
  const keys = Object.keys(ev).filter((k) => (ev as Record<string, unknown>)[k] !== undefined).sort();
  if (side === 'source') return JSON.stringify(keys) === '["combat","ev","source"]' && JSON.stringify(ev.source) === who;
  return JSON.stringify(keys) === '["combat","ev","recipient"]' && JSON.stringify(ev.recipient) === `{"object":${who}}`;
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
  const plainPrevent = (e: StaticEffect): e is ReplacementDef => e.s === 'replace' && e.body.b === 'prevent' && e.body.amount === 'all' && e.body.then === undefined
    && e.optional !== true && e.shield === undefined && e.condition === undefined && e.selfReplacement !== true && e.replaces.ev === 'damage' && e.replaces.combat === true;
  if (!plainPrevent(to) || !plainPrevent(by)) return null;
  const keys = (e: ReplacementDef): string => JSON.stringify(Object.keys(e.replaces).filter((k) => (e.replaces as Record<string, unknown>)[k] !== undefined).sort());
  if (keys(to) !== '["combat","ev","recipient"]' || keys(by) !== '["combat","ev","source"]') return null;
  const r = (to.replaces as Extract<EventPattern, { ev: 'damage' }>).recipient;
  const s = (by.replaces as Extract<EventPattern, { ev: 'damage' }>).source;
  if (r?.player !== undefined || r?.object === undefined || Object.keys(r.object).length !== 1 || r.object.is === undefined) return null;
  if (s === undefined || Object.keys(s).length !== 1 || JSON.stringify(s.is) !== JSON.stringify(r.object.is)) return null;
  return `prevent all combat damage that would be dealt to and dealt by ${K.obj(r.object.is, st, 'object').text}${durationSuffix(duration, st)}`;
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

function staticEffectsApart(effects: StaticEffect[], st: RenderState): string {
  const parts: string[] = [];
  for (let i = 0; i < effects.length; ) {
    const e = effects[i]!;
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
    const byMv = i + 1 < effects.length ? manaValueSplit(e, effects[i + 1]!, st) : null;
    if (byMv !== null) {
      parts.push(byMv);
      i += 2;
      continue;
    }
    // Cloud C3 (batch 3): also of the object the source is attached to, "... dealt to and dealt by enchanted creature" (CR 303.4, 301.5)
    const toAndBy = (['{"self":true}', '{"attachedToSource":true}'] as const).find((w) => i + 1 < effects.length && selfCombatPrevention(e, 'recipient', w) && selfCombatPrevention(effects[i + 1]!, 'source', w));
    if (toAndBy !== undefined) {
      const whose: ObjRef = toAndBy === '{"self":true}' ? { ref: 'self' } : { ref: 'attachedTo' };
      const [both, apart] = withVariants(st, [
        (v) => `prevent all combat damage that would be dealt to and dealt by ${K.obj(whose, v, 'subject').text}`,
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
    const faceUpCounters = entersOrFaceUpCounters(e, n1);
    if (faceUpCounters !== null) {
      parts.push(entersOrFaceUpText(faceUpCounters, st));
      i += 2;
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
      && JSON.stringify(e.affects) === JSON.stringify((n1 as RestrictionDef).subject)) {
      parts.push(continuous(e, st, undefined, true, false, [ATTACK_YOU]));
      i += 3;
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
    // FAST3 T16: "~ can't attack or block unless C" (CR 508.1c, 509.1b): an "only if" attack and an "only if" block of one subject with one condition
    const next = effects[i + 1];
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
  if (e.s === 'continuous' && r.s === 'restrict' && e.cda !== true && e.mods.length === 1 && e.mods[0]!.layer === '7c' && r.mode === 'cant' && r.action === 'beBlockedBy'
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
  if (pumpGrant !== null && r.s === 'restrict' && r.mode === 'cant' && r.action === 'beBlocked' && r.other === undefined && r.when === undefined && r.min === undefined
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
  if (JSON.stringify(r.subject) !== JSON.stringify(e.affects) || (r.other !== undefined && !targetBan) || (r.max !== undefined && !blockLimit) || r.when !== undefined) return null;
  // Cloud C3 (batch 3): ... and "doesn't untap during its controller's untap step" after a P/T change ("Equipped creature gets +4/+2 and doesn't untap ...", CR 502.3)
  // std-mkm: ... and "gets +2/+2 and can't become suspected" (CR 701.60a, 101.2)
  const ok = (r.mode === 'cant' && (r.action === 'block' || r.action === 'beBlocked' || r.action === 'attack' || r.action === 'untapDuringUntapStep' || targetBan || (r.action === 'beSuspected' && e.mods[0]!.layer === '7c') || (loseAll && r.action === 'untap')))
    || (r.mode === 'mustIfAble' && (r.action === 'attack' || r.action === 'block' || (r.action === 'beBlocked' && isPlainGrant(e))));
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
  if (e.s !== 'continuous' || e.cda === true || (!isOneObject(e.affects, st) && !groupMust)) return null;
  // FAST4 T33: also a grant of abilities before "can't be blocked this turn" ("gains lifelink until end of turn and can't be blocked this turn", CR 613.1f)
  const grant = e.mods.length === 1 && isPlainGrant(e);
  // Cloud std-eoe: a base power and toughness too ("has base power and toughness 1/1 until end of turn and can't be blocked this turn", CR 613.4b)
  const base = e.mods.length === 1 && e.mods[0]!.layer === '7b';
  if (e.mods.length !== 1 || (e.mods[0]!.layer !== '7c' && !grant && !base)) return null;
  let second: ((v: RenderState, plural: boolean) => string) | null = null;
  const sameSubject = r.s === 'restrict' && JSON.stringify(r.subject) === JSON.stringify(e.affects) && r.other === undefined && r.max === undefined && r.when === undefined;
  if (r.s === 'restrict' && sameSubject && r.mode === 'cant' && (r.action === 'beBlocked' || (!grant && (r.action === 'block' || r.action === 'attack')))) {
    second = (v, plural) => `${restrictFor(r, v, '', plural).trim()}${durationSuffix(duration, v)}`;
  } else if (r.s === 'restrict' && sameSubject && r.mode === 'mustIfAble' && r.action === 'beBlocked' && inlineDuration(duration) !== null) {
    // FAST4 T33: "gets +3/+3 until end of turn and must be blocked this turn if able" (CR 509.1c: the duration sits between the verb and "if able")
    // r4-mech: also after a grant ("gains first strike until end of turn and must be blocked this turn if able", CR 613.1f, 509.1c)
    second = () => `must be blocked ${inlineDuration(duration)!} if able`;
  } else if (r.s === 'permit' && r.action === 'attackAsThoughNoDefender' && e.affects.ref === 'self' && r.of === undefined && r.asThough === undefined
    && r.who.ref === 'you' && duration.d === 'endOfTurn') {
    second = () => alt("can attack this turn as though it didn't have defender", `can attack as though it didn't have defender${durationSuffix(duration, st)}`);
  }
  if (second === null) return null;
  const pair = second;
  // Cloud std-eoe (CR 611.2c, 509.1b, 613.4b): the restriction first, then the P/T change of the same object with its own duration ("That creature can't be blocked
  // this turn and has base power and toughness 1/1 until end of turn", Atomic Microsizer); only "can't be blocked" (the restriction that has its own "this turn")
  const restrictFirst = !grant && r.s === 'restrict' && r.mode === 'cant' && r.action === 'beBlocked' && duration.d === 'endOfTurn';
  const [merged, apart, reversed] = withVariants(st, [
    (v) => {
      const first = staticEffect(e, v, { duration });
      const plural = K.obj(e.affects as ObjRef, v, 'subject').plural;
      return `${first} and ${pair(v, plural)}`;
    },
    (v) => [staticEffect(e, v, { duration }), staticEffect(r, v, { duration })].join('. '),
    (v) => {
      if (!restrictFirst) return null;
      const subj = K.obj(e.affects as ObjRef, v, 'subject');
      const pred = ptPredicate(e, v, subj.plural);
      return pred === null ? null : `${subj.text} ${restrictFor(r as RestrictionDef, v, '', subj.plural).trim()} this turn and ${pred}${durationSuffix(duration, v)}`;
    },
  ]);
  return alt(merged!, apart!, ...(typeof reversed === 'string' ? [reversed] : []));
}

export function staticEffect(e: StaticEffect, st: RenderState, o: { duration?: Duration } = {}): string {
  switch (e.s) {
    case 'continuous': return continuous(e, st, o.duration, o.duration === undefined);
    case 'costMod': {
      // "Creature spells you cast this turn cost {1} less to cast" (the duration inside) is Oracle's order for spells; the others take it at the end
      const inside = e.applies.spells && !e.applies.self && !e.applies.abilities ? inlineDuration(o.duration) : null;
      const base = lasting(costMod(e, st), o.duration, st);
      return inside === null ? base : alt(costMod(e, st, inside), base);
    }
    case 'restrict': {
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
        const [asLong, iff] = withVariants(st, [(v) => restrict(e, v), (v) => `${restrict(bare, v)} if ${K.cond(when, v)}`]);
        return alt(asLong!, iff!);
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
      const base = lasting(plain, o.duration, st);
      // "Target creature must be blocked this turn if able" (CR 509.1c): the duration sits between the verb and "if able"
      const inside0 = e.mode === 'mustIfAble' && e.action === 'beBlocked' ? inlineDuration(o.duration) : null;
      // r4-fxb (family each-combat-this-turn): a requirement lasting the turn applies in each combat of it, "must be blocked each combat this turn if able" (CR 506.1, 509.1c)
      const inside = inside0 === 'this turn' ? alt('this turn', 'each combat this turn') : inside0;
      return inside === null ? base : alt(plain.replace('must be blocked if able', `must be blocked ${inside} if able`), base);
    }
    case 'replace': {
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
        const { costChange: increase, ...bare } = e;
        return `${staticEffect(bare, st, o)}. a spell cast this way costs ${formatManaCost(increase.mana!)} more to cast`;
      }
      // std-exile-play-2-3 (CR 118.9, 701.67a, 611.2b; Hama, the Bloodbender): "For as long as you control ~, you may cast the exiled card during your turn by
      // waterbending {X} rather than paying its mana cost, where X is its mana value." (statics/play-permits.ts#isWaterbendCost)
      const wb = waterbendPermit(e, st, o.duration);
      if (wb !== null) return wb;
      // std-exile-play-2-4 (CR 611.2a, 611.2c, 202.3; Triple Triad): "until end of turn, you may play the card you own exiled this way and each other card exiled this way
      // with lesser mana value than it without paying their mana costs" (the cards of the group are picked as the effect begins, effects/handlers/lasting.ts)
      const yoursLesser = yoursAndLesserPermit(e, st, o.duration);
      if (yoursLesser !== null) return yoursLesser;
      if (e.anyManaType !== undefined || e.anyManaColor !== undefined || e.while !== undefined || e.graveyardInstead !== undefined) return permitRiders(e, st, o.duration);
      if (e.single === true && e.from === 'graveyard') return oneGraveyardSpell(e, st, o.duration); // std-freecast-2
      const base = lasting(permit(e, st, isLimited(o.duration)), o.duration, st);
      // FAST2 T9: "~ can attack this turn as though it didn't have defender" (CR 609.4, 702.3b): the duration between the verb and "as though"
      const inside = e.action === 'attackAsThoughNoDefender' ? inlineDuration(o.duration) : null;
      // FAST3 T15: "You may cast creature spells this turn as though they had flash" (CR 601.3b, 611.2a): the duration between the spells and "as though"
      const flashInside = e.action === 'haveFlash' ? inlineDuration(o.duration) : null;
      if (flashInside !== null) {
        const plain = permit(e, st, true);
        return alt(base, plain.replace(/ as though /, ` ${flashInside} as though `));
      }
      // std-rl (CR 611.2a): and a group, "Creatures you control with defender can attack this turn as though they didn't have defender" (permit() checked the group)
      const who = e.of === undefined ? `${K.obj({ ref: 'self' }, st, 'subject').text} can attack ${inside} as though it didn't have defender` : `${K.np(e.of, st, { det: 'none', plural: true })} can attack ${inside} as though they didn't have defender`;
      return inside === null ? base : alt(base, who);
    }
    case 'rule': {
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
        if (c === undefined || c.ev !== 'zoneChange' || c.to !== 'battlefield' || c.from !== undefined || Object.keys(e.abilitiesOf).length > 0 || e.additional !== 0) throw new NoRenderer('a trigger suppression other than of permanents entering');
        const { subject, to: _to, ev: _ev, ...rest } = c;
        if (Object.keys(rest).length > 0) throw new NoRenderer('a trigger suppression of entering with other conditions');
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
      if (e.cause === undefined) return lasting(`if a triggered ability of ${whose} triggers, ${that} triggers ${times}`, o.duration, st);
      // std-typechange-2 (CR 603.2d, 114.4): "a triggered ability of this creature or an emblem you own" (The Masamune): the source's own abilities or those of any emblem
      // its controller owns; no other description says emblems
      const caused = JSON.stringify(e.abilitiesOf) === SELF_OR_EMBLEM ? `${K.obj({ ref: 'self' }, st, 'subject').text} or an emblem you own` : K.np(e.abilitiesOf, st, { det: 'a' });
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
