/**
 * The ONE matcher for triggers, replacement effects, delayed triggers, durations and history filters (design 3.5, 8.4). Owner: WP8.
 * Contract: triggers/api.ts#MatchEvent.
 *
 * `matchEvent(pattern, e, cx)` answers "is this semantic event an occurrence of this pattern, as seen by the object at `cx.source` controlled by
 * `cx.controller`?". Filters are evaluated against the state AFTER the event, except where CR 603.10 says the game looks back in time: then against the last
 * known information in `e.before` (`lookBackApplies`). Every field of a pattern is either evaluated or the pattern does not match: no field is ever ignored.
 */
import type { EventPattern, ObjectFilter, PlayerPred } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { EventRole } from '../types/ability';
import type { GameObject, GameState, SemEvent } from '../types/state';
import type { MatchContext, MatchEvent } from './api';
import { cmpMatches, lookupObject, objectMatches, playerMatches, type FilterCx } from './filters';
import { EVENT_FORMS_PARTS, SUPPORTED as SUPPORTED_EVENT_FORMS } from './forms';
import { lookBackApplies } from './lookback';
import { factsMatchFilter } from '../rules/history';
import { MANA_SOURCE } from './normalize';
import { contextOf } from './context';
import { boardBefore } from './lookback-board';

/** M6-0: the event kinds milestone 6 added to `EventPattern` (m6 design 2.1); until a package lists one in its `EMITS`, no engine code emits it. */
const M6_EVENT_KINDS: readonly EventPattern['ev'][] = ['phase', 'dayNight'];

/**
 * Features this module implements: "one or more" triggers (`TriggerDef.batch`, collected in collect.ts), "do this only once each turn" (collect.ts) and the finer
 * event forms whose `GameEvent`s the engine emits (forms.ts: `ev.action.sacrifice`, `ev.becomes.tapped`, ...). WP32: `trigger.mana`, triggered mana abilities
 * resolved at once without the stack (CR 605.4a, mana-now.ts).
 */
// FAST4 T27: 'trigger.while' and 'trigger.first' (`TriggerDef.while` / `first`, judged in collect.ts when the event happens, CR 603.1, 603.2), and 'wasCast.by'
// ("if you cast it", CR 601.2a: the cast record's caster, read by every evaluator of `wasCast`: triggers/cond.ts, effects/eval.ts, statics/match.ts; the
// announcement's evaluator does not read it and names it `feature:announce.cond.wasCast.by`, model/forms.ts); FAST5 T37: 'wasCast.spent' (adamant, "if at least three
// white mana was spent to cast ~", CR 601.2h: the colors of `CostsPaid.manaSpent`, read by the same three evaluators)
// FAST5 T50: 'delay.batch' (the `batch` of an event-timed `delay` step, "one or more ..." / "whenever you attack ... this turn", collected in delayed.ts, CR 603.2c)
// FAST5X E2: 'ev.cast.via', the alternative cost a spell was cast for ("a spell was warped this turn", CR 702.185c): the `via` data of the cast event
// (triggers/normalize.ts) and the history entry's `via` fact (triggers/history.ts, rules/history.ts)
// FAST5X E18: 'ev.cast.nthMatching', "their first noncreature spell each turn": the Nth of the caster's spells this turn that match the pattern's `spell` (history)
// FAST5X E16: 'ev.damage.excess', "is dealt excess damage" (CR 120.10): the `excess` data of the damage event (rules/damage.ts computes it, normalize.ts carries it)
export const FEATURES: readonly string[] = ['trigger.batch', 'trigger.batch.whole' /* CLOUD std-misc */, 'delay.batch', 'delay.targets' /* std-tdm: delayed.ts#delayedAbility, CR 603.7, 603.3d */, 'trigger.limit', 'trigger.mana', 'trigger.while', 'trigger.first', 'wasCast.by', 'wasCast.spent', 'wasCast.object' /* std-tdm: effects/eval.ts#castRecordOf */, 'wasCast.fromOwner' /* Standard round 4, r4-trig: effects/eval.ts#wasCast, CR 400.3 */, 'ev.cast.via', 'ev.cast.notFrom' /* Standard round 5, r5-trig: the `from` of the cast event and history entry (CR 601.2a) */, 'ev.cast.nthMin' /* r5-trig: the cast event's `nth` (CR 601.2i) */, 'ev.cast.nthMatching', 'ev.damage.excess', 'ev.damage.amountIsToughness' /* std-rx28: CR 120.1, 208.1 */, 'ev.damage.toSourceTarget' /* std-rx28: CR 115.9b */, 'ev.activate.activated' /* std-rx28: CR 602.2 */, 'did.which', 'did.which.move' /* FAST5 T75 */, 'ev.counters.by', 'trigger.limit.action' /* FAST5X E21 */, 'delayed.step.anyMain' /* r5-fxb: delayed.ts#fires, CR 505.1 */, 'lookback.attachments' /* r5-fxb: LastKnown.attached, CR 603.10a */, 'trigger.tappedForMana' /* std-mana-1: rules/mana.ts#addMana `tapped`, CR 106.12 */, ...SUPPORTED_EVENT_FORMS];

/**
 * Event kinds that CANNOT occur in this build because no engine code emits the `GameEvent` they are derived from (none since WP15's `rollDie` emits `dieRolled`). Their matchers
 * exist and are tested with hand-built events, but `ev:<ev>` is not a capability, so a card that needs one stays manual instead of being falsely automated.
 * Whoever adds the emitter removes the kind from this list (a test scans the sources for the emitters and fails when this list is out of date).
 */
// M6-0 (m6 design 2.6): derived from the milestone 6 packages' `EMITS` (triggers/forms.ts#EVENT_FORMS_PARTS): `phase` is emitted by nobody (replacement
// patterns only: "skip your next combat phase", CR 614.10; their capability is `feature:replace.on.phase`), `dayNight` once M6-4 emits it.
export const NOT_EMITTED: readonly EventPattern['ev'][] = M6_EVENT_KINDS.filter((k) => !EVENT_FORMS_PARTS.some((p) => p.EMITS.includes(k)));

/** FAST5X E2: was the spell cast for the alternative cost `via` (CR 118.9)? A second cost of the same name on a face is `<name>:2` (actions/cast-options.ts). */
export const castVia = (paid: unknown, via: string): boolean => typeof paid === 'string' && (paid === via || paid.startsWith(`${via}:`));

type Matcher<K extends EventPattern['ev']> = (p: Extract<EventPattern, { ev: K }>, e: SemEvent, cx: MatchContext) => boolean;

const filterCx = (cx: MatchContext): FilterCx => ({ source: cx.source, controller: cx.controller });

/** The first object of a role, with every id it had (a zone change: the old and the new) and the form it is judged in (live or last known). */
function roleObject(cx: MatchContext, e: SemEvent, role: EventRole, snapshot: boolean): { o: GameObject; ids: ObjectId[] } | undefined {
  const v = e.roles[role];
  if (!v || !('objects' in v) || v.objects.length === 0) return undefined;
  const id = v.objects[0]!.id;
  const ids = [id];
  for (const k of ['oldId', 'newId'] as const) {
    const x = e.data[k];
    if (typeof x === 'string' && !ids.includes(x)) ids.push(x);
  }
  const snap = e.before[id] ?? (typeof e.data['oldId'] === 'string' ? e.before[e.data['oldId']] : undefined);
  const live = cx.g.s.objects[id];
  const o = snapshot && snap ? snap.object : live ?? snap?.object ?? lookupObject(cx.g.s, id);
  return o ? { o, ids } : undefined;
}

/** Does the role's object satisfy the filter? A role the event does not have fails a filter that was written, and passes when there is none. */
function roleMatches(cx: MatchContext, e: SemEvent, role: EventRole, f: ObjectFilter | undefined, snapshot: boolean, withEvent = false): boolean {
  if (f === undefined) return true;
  const r = roleObject(cx, e, role, snapshot);
  if (!r) return false;
  // The zone of a zone-change subject is the pattern's `from` / `to`, not the filter's: a filter that names none is a filter on characteristics.
  const { zone: _zone, ...rest } = f;
  // std-combat-1 (CR 603.2): a description that names another object of the same event reads it from this event (`withEvent`, the attach event only)
  return objectMatches(cx.g.s, rest, r.o, r.ids, withEvent ? { ...filterCx(cx), event: contextOf([e]) } : filterCx(cx));
}

/** std-combat-3: does a description compare with a quantity that is not a number (CR 603.10a: read on the battlefield as it was)? */
const readsQuantity = (f: ObjectFilter): boolean => JSON.stringify(f).includes('"q":');

/** std-combat-3 (CR 603.10a): the subject of a leaves-the-battlefield event against its description, on the battlefield as it was just before it left. */
function lookBackMatches(cx: MatchContext, e: SemEvent, f: ObjectFilter): boolean {
  const r = roleObject(cx, e, 'subject', true);
  if (!r) return false;
  const oldId = typeof e.data['oldId'] === 'string' ? e.data['oldId'] : r.o.id;
  const before = boardBefore(cx.g.s, e.before[oldId] ?? cx.g.s.lki[oldId]);
  if (before === null) return false;
  const { zone: _zone, ...rest } = f;
  return objectMatches(before, rest, r.o, r.ids, { ...filterCx(cx), event: contextOf([e]) });
}

const playerOf = (e: SemEvent, role: EventRole = 'player'): PlayerId | undefined => {
  const v = e.roles[role];
  return v && 'players' in v ? v.players[0] : undefined;
};

const pm = (cx: MatchContext, pred: PlayerPred | undefined, player: PlayerId | undefined): boolean => playerMatches(cx.g.s, pred, player, filterCx(cx));

/** std-copy-4 (CR 400.7): the ids `id` had before, newest first, by the `newId` links of last known information (a spell that became this permanent, ...). */
function formerIds(s: GameState, id: ObjectId): ObjectId[] {
  const out: ObjectId[] = [];
  let cur = id;
  for (let guard = 0; guard < 8; guard++) {
    const prev = Object.entries(s.lki).find(([k, l]) => l.newId === cur && k !== cur)?.[0];
    if (prev === undefined || out.includes(prev)) break;
    out.push(prev);
    cur = prev;
  }
  return out;
}

/**
 * FAST5X E18 (CR 601.2i; `EventPattern` cast `nthMatching`): which of its caster's spells cast this turn that match `filter` the cast event's spell is (1 for "their
 * first noncreature spell each turn"), counted from the game history: the entries of this turn's casts (never copies, CR 707.10) by the same player, up to and
 * including this spell's own entry (triggers/stack.ts writes a batch's history before collecting its triggers; an entry not written yet comes after every
 * written one). The facts are those the spell had as it was cast (triggers/history.ts). NaN when the event names no caster or spell.
 */
function nthMatchingOf(cx: MatchContext, filter: ObjectFilter | undefined, e: SemEvent): number {
  const caster = playerOf(e);
  const spell = e.roles['spell'];
  const spellId = spell && 'objects' in spell ? spell.objects[0]?.id : undefined;
  if (caster === undefined || spellId === undefined) return Number.NaN;
  const s = cx.g.s;
  // std-copy-4 (CR 400.7, 201.5): "other than ~" leaves out the spell the source was (it became the permanent as it resolved: a new object with a new id)
  const was = filter !== undefined && JSON.stringify(filter).includes('"other":true') && cx.source !== undefined ? formerIds(s, cx.source) : undefined;
  const env = { you: cx.controller, sourceId: cx.source, ...(was !== undefined ? { sourceWas: was } : {}) };
  let n = 0;
  for (const h of s.history) {
    if (h.turn !== s.turn.number || h.ev !== 'cast' || h.actor !== caster || h.facts['copy'] === true) continue;
    if (h.subject === spellId) return n + 1;
    if (filter === undefined || factsMatchFilter(h.facts, '', filter, env, h.subject)) n++;
  }
  return n + 1;
}
const zoneIn = (z: unknown, want: string | string[] | undefined): boolean => want === undefined || (typeof z === 'string' && (Array.isArray(want) ? want.includes(z) : want === z));
const numberData = (e: SemEvent, k: string): number | undefined => (typeof e.data[k] === 'number' ? (e.data[k] as number) : undefined);

const MATCHERS: { [K in EventPattern['ev']]?: Matcher<K> } = {
  /** CR 603.6, 603.10a: enters, leaves, dies, is put into a graveyard/hand/library/exile. Judged as it was when the pattern looks back (`lookBackApplies`). */
  zoneChange: (p, e, cx) => {
    const from = e.data['from'];
    if (!zoneIn(from, p.from) || !zoneIn(e.data['to'], p.to)) return false;
    if (p.cause === 'craft' && e.data['cause'] !== 'craft') return false; // Standard round 3, r3-trig (CR 702.167a): exiled as craft's material
    // std-control-1 (CR 400.7, 610.3): a FIXED object named in the zone it leaves ("until this card is cast from exile": the card as it was in exile) is the object before
    // the move: judged as it was there (the event's look-back snapshot), never as the new object it became
    const fixedFrom = p.from !== undefined && p.subject?.is?.ref === 'fixed' && 'objects' in p.subject.is && p.subject.is.objects.length > 0 && p.subject.is.objects.every((h) => zoneIn(h.zone, p.from));
    const lookBack = cx.lookBack || lookBackApplies(p, e);
    // std-combat-3 (CR 603.10a): a quantity in the description of what left the battlefield ("with the greatest power among creatures that player controls") is read
    // on the battlefield as it was immediately before the event, with the event to name its player (triggers/lookback-board.ts); unknown: no match (fail closed)
    if (lookBack && from === 'battlefield' && p.subject !== undefined && readsQuantity(p.subject)) return lookBackMatches(cx, e, p.subject);
    // pc-tokens-2 (CR 603.6a, 614.1c; Amulet of Vigor): "enters tapped" / "enters untapped" is how it ENTERED (the event's `tapped`), not how it is when the trigger is
    // collected: a permanent put onto the battlefield untapped and tapped afterwards by the same effect did not enter tapped
    if (p.to === 'battlefield' && p.subject?.tapped !== undefined && e.data['to'] === 'battlefield') {
      const { tapped: want, ...rest } = p.subject;
      if ((e.data['tapped'] === true) !== want) return false;
      return roleMatches(cx, e, 'subject', rest, lookBack || fixedFrom);
    }
    return roleMatches(cx, e, 'subject', p.subject, lookBack || fixedFrom);
  },
  /** std-copy-6 (CR 603.2, 603.3b): a triggered ability of the `subject` object triggered (triggers/collect.ts#metaEvents); `causedBy` attacking: that object attacking caused it. */
  abilityTriggered: (p, e, cx) => (p.causedBy === undefined || (p.causedBy === 'attacking' && e.data['byAttacking'] === true)) && roleMatches(cx, e, 'subject', p.of, false),
  /** CR 601.2i. A copy is not cast (CR 707.10): it matches only when the pattern says `orCopy`. */
  cast: (p, e, cx) => {
    if (e.data['copy'] === true && p.orCopy !== true) return false;
    if (p.from !== undefined && e.data['from'] !== p.from) return false;
    if (p.notFrom !== undefined && (typeof e.data['from'] !== 'string' || e.data['from'] === p.notFrom)) return false; // Standard round 5, r5-trig (CR 601.2a)
    if (p.nthMin !== undefined && !((numberData(e, 'nth') ?? 0) >= p.nthMin)) return false; // Standard round 5, r5-trig (CR 601.2i): not the caster's first spell this turn
    if (p.nth !== undefined && p.nthMatching !== true && numberData(e, 'nth') !== p.nth) return false; // FAST1 T4: the Nth spell that player cast this turn
    // FAST5X E18 (CR 601.2i): the Nth spell of the caster this turn among those that match `spell` ("their first noncreature spell each turn")
    if (p.nth !== undefined && p.nthMatching === true && nthMatchingOf(cx, p.spell, e) !== p.nth) return false;
    if (p.via !== undefined && !castVia(e.data['via'], p.via)) return false; // FAST5X E2: cast for its warp cost (CR 702.185c)
    if (p.modal === true && e.data['modal'] !== true) return false; // Standard round 3, r3-trig (CR 700.2): a modal spell (modes were chosen as it was cast)
    // std-exile-play-1-1 (CR 108.3, 601.2a): "a spell they don't own": its owner is not its caster (a spell with no caster or no object never matches)
    if (p.notOwnedByCaster === true) {
      const spell = roleObject(cx, e, 'spell', false);
      const caster = playerOf(e);
      if (spell === undefined || caster === undefined || spell.o.owner === caster) return false;
    }
    // std-lci (CR 106.3): "using mana produced by ~": the trigger's own object produced some of the mana spent (triggers/normalize.ts#MANA_SOURCE)
    if (p.manaFromSelf === true && e.data[`${MANA_SOURCE}${cx.source}`] !== 1) return false;
    return pm(cx, p.player, playerOf(e)) && roleMatches(cx, e, 'spell', p.spell, false);
  },
  /**
   * CR 602.2. A mana ability (CR 605.3b) is an activation too, but only a pattern that says `manaAbility` sees it; and `manaAbility: true` ("activates a mana
   * ability", "taps ... for mana") sees only mana abilities, never another {T} ability of the same permanent (CR 605.1a; WP32 review). Absent: non-mana only,
   * unless the pattern names the kind of ability (`ability`): "whenever you activate an exhaust ability" sees an exhaust mana ability too (CR 605.1a,
   * 702.177a; a loyalty ability is never a mana ability, CR 605.1a).
   */
  activate: (p, e, cx) =>
    (p.ability !== undefined && p.manaAbility === undefined ? true : (e.data['mana'] === true) === (p.manaAbility === true)) && (p.ability === undefined || e.data[p.ability] === true) && pm(cx, p.player, playerOf(e)) && roleMatches(cx, e, 'source', p.source, false) && roleMatches(cx, e, 'spell', p.activated, false) && (p.tapped !== true || e.data['tapped'] === true) && (p.produced === undefined || String(e.data['produced'] ?? '').includes(p.produced)), // std-mana-1: `tapped`, `produced` (CR 106.12); std-rx28: `activated` (CR 602.2, 115.9b); FAST5X E20: `ability`, an exhaust (CR 702.177a) or loyalty (CR 606.3) ability
  /** CR 508.1m, 508.3. `alone`: it is the only attacker declared; `count`: the number of attackers declared together. */
  attacks: (p, e, cx) => {
    if (p.alone !== undefined && e.data['alone'] !== p.alone) return false;
    if (!cmpMatches(p.count, numberData(e, 'count'))) return false;
    if (!cmpMatches(p.power, numberData(e, 'totalPower'))) return false; // Standard round 3, r3-trig (CR 508.1): the total power of the declaration's attackers
    if (p.defender !== undefined && !(defenderMatches(p.defender, e, cx) || (p.orPlaneswalker === true && planeswalkerOf(p.defender, e, cx)))) return false;
    return roleMatches(cx, e, 'attacker', p.attacker, false);
  },
  /** CR 509.3a: without `attacker` it triggers once per blocker (the flagged first pair); CR 509.3b: with `attacker`, once per attacker it blocks that satisfies it. */
  blocks: (p, e, cx) => {
    if (p.attacker === undefined && e.data['first'] === false) return false;
    return roleMatches(cx, e, 'blocker', p.blocker, false) && roleMatches(cx, e, 'attacker', p.attacker, false);
  },
  /** std-rx35 (CR 509.1h): an attacker no blocker was declared for. */
  attacksUnblocked: (p, e, cx) => {
    // pc-combat-4 (CR 509.1h, 508.1b): attacking a player that matches (never a planeswalker or battle)
    if (p.defender !== undefined) {
      const d = e.data['defenderPlayer'];
      if (typeof d !== 'string' || !pm(cx, p.defender, d)) return false;
    }
    return roleMatches(cx, e, 'attacker', p.attacker, false);
  },
  /** CR 509.3c: without `by` it triggers once per attacker (the flagged first pair), with `by` once per blocker that satisfies it. */
  becomesBlocked: (p, e, cx) => {
    if (p.by === undefined && e.data['first'] !== true) return false;
    return roleMatches(cx, e, 'attacker', p.attacker, false) && roleMatches(cx, e, 'blocker', p.by, false);
  },
  /** CR 120.2, 510.2. The damage that was dealt (prevented damage is no event, CR 603.2g). */
  damage: (p, e, cx) => {
    if (p.combat !== undefined && e.data['combat'] !== p.combat) return false;
    if (!cmpMatches(p.amount, numberData(e, 'amount'))) return false;
    // FAST5X E16 (CR 120.10): "is dealt excess damage": part of this damage to a permanent was beyond lethal damage, loyalty or defense (NaN, unknown: no)
    if (p.excess === true && !((numberData(e, 'excess') ?? 0) > 0)) return false;
    // std-rx28 (CR 120.1, 208.1; Taii Wakeen, Perfect Shot): the damage dealt to an object equals its toughness as the damage is dealt (the live object, or its last
    // known information once it has left); damage to a player never matches
    // std-rx28 (CR 115.9b, 120.1; Imodane, the Pyrohammer): the damaged object is one of the targets of the source, a spell or ability on the stack (or as it last
    // existed there); damage to a player never matches
    if (p.toSourceTarget === true) {
      const src = e.roles['source'];
      const srcId = src && 'objects' in src ? src.objects[0]?.id : undefined;
      const rec = e.roles['object'];
      const recId = rec && 'objects' in rec ? rec.objects[0]?.id : undefined;
      const so = srcId !== undefined ? lookupObject(cx.g.s, srcId) : undefined;
      if (e.data['toPlayer'] === true || recId === undefined || so?.stack === undefined || !so.stack.targets.flat().some((t) => t.kind === 'object' && t.id === recId)) return false;
    }
    if (p.amountIsToughness === true) {
      const amount = numberData(e, 'amount');
      if (amount === undefined || e.data['toPlayer'] === true || !roleMatches(cx, e, 'object', { toughness: { op: '==', value: amount } }, false)) return false;
    }
    if (!roleMatches(cx, e, 'source', p.source, false)) return false;
    if (p.recipient) {
      const toPlayer = e.data['toPlayer'] === true;
      // PUSH1 T2 (INTERFACE CHANGE): a recipient with both an object and a player part is either of them ("any target", "a player or planeswalker";
      // CR 115.4, 120.1): damage to a player is judged by the player part, damage to an object by the object part. Before, it could never match.
      if (p.recipient.object !== undefined && p.recipient.player !== undefined) {
        if (toPlayer ? !pm(cx, p.recipient.player, playerOf(e, 'recipient')) : !roleMatches(cx, e, 'object', p.recipient.object, false)) return false;
      } else {
        if (p.recipient.object !== undefined && (toPlayer || !roleMatches(cx, e, 'object', p.recipient.object, false))) return false;
        if (p.recipient.player !== undefined && (!toPlayer || !pm(cx, p.recipient.player, playerOf(e, 'recipient')))) return false;
      }
    }
    return true;
  },
  /**
   * CR 603.2b: at the beginning of a step; `whose` is the player whose turn it is. FAST5X E17: `nth`, "your second main phase", only the main phase that is
   * the Nth main phase of its turn (CR 505.1b; not an additional main phase after it, CR 505.1a).
   */
  step: (p, e, cx) => e.data['step'] === p.step && pm(cx, p.whose, playerOf(e)) && (p.nth === undefined || numberData(e, 'mainPhase') === p.nth),
  /** CR 119.9, 119.10: life gained or lost. */
  life: (p, e, cx) => e.data['change'] === p.change && pm(cx, p.player, playerOf(e)) && cmpMatches(p.amount, numberData(e, 'amount')),
  /** CR 121.2: `nth` is "the Nth card you draw each turn". */
  // edh-players-1 (CR 504.1): `exceptFirstInDrawStep`, not the first card the turn player drew in their own draw step (normalize.ts says which it was)
  draw: (p, e, cx) => pm(cx, p.player, playerOf(e)) && (p.nth === undefined || numberData(e, 'nth') === p.nth) && !(p.exceptFirstInDrawStep === true && e.data['firstInDrawStep'] === true),
  /** CR 603.2e: "becomes" happens at the time of the change only. `monstrous`, `renowned`, `saddled`, `crewed` come from the keyword actions' `actionPerformed` events (verbs in normalize.ts). */
  becomes: (p, e, cx) => {
    if (e.data['what'] !== p.what) return false;
    // `by` is "a spell or ability [an opponent controls]" (CR 115.1, 702.21a): judged on the spell or ability that targets it (the `spell` role, design 3.5),
    // never on that ability's source: an ability is not a spell, and it is controlled by whoever activated it or controlled its source when it triggered
    // (CR 602.2a, 603.3a), not by whoever controls the source now (WP32).
    // Standard round 4, r4-trig (CR 115.1): with `player`, a player who becomes the target (the event's `player` role is the targeted player)
    if (p.what === 'targeted' && p.player !== undefined) return e.data['targetIsPlayer'] === true && pm(cx, p.player, playerOf(e)) && roleMatches(cx, e, 'spell', p.by, false);
    // Standard round 4, r4-trig (CR 110.1, 115.1): an object target described as a permanent with `zone: 'battlefield'` said explicitly ("a player or permanent") is one on
    // the battlefield, never a spell or a card in another zone (roleMatches ignores a filter's zone; patterns without it read as before)
    if (p.what === 'targeted' && p.object.zone === 'battlefield' && roleObject(cx, e, 'subject', false)?.o.zone !== 'battlefield') return false;
    if (p.what === 'targeted') return e.data['targetIsPlayer'] !== true && roleMatches(cx, e, 'subject', p.object, false) && roleMatches(cx, e, 'spell', p.by, false);
    // Standard round 5, r5-trig (CR 702.122b, 702.171c): "~ crews a Vehicle": the creature tapped for the cost is the event's `source` role (normalize.ts)
    // Standard round 5, r5-trig (CR 502.3): "during your untap step": only an untap by the untap step (normalize.ts)
    if (p.untapStep === true && (p.what !== 'untapped' || e.data['untapStep'] !== true)) return false;
    if (p.what === 'crewCostPaid' || p.what === 'saddleCostPaid' || p.what === 'teamworkCostPaid') return p.by !== undefined && roleMatches(cx, e, 'subject', p.object, false) && roleMatches(cx, e, 'source', p.by, false);
    if (p.level !== undefined && e.data['level'] !== p.level) return false; // M6-0: "when this Class becomes level N" (CR 716.2a)
    // FAST5X E8 (CR 709.5h-i): "you unlock" / "you fully unlock": the player who unlocked it is the controller; "this door" is the half the ability is on
    if (p.what === 'unlocked' || p.what === 'fullyUnlocked') {
      if (playerOf(e) !== cx.controller) return false;
      if (p.door === 'this' && (cx.face === undefined || e.data['face'] !== cx.face)) return false;
    }
    if (p.door !== undefined && p.what !== 'unlocked') return false;
    // cloud std-dsk (CR 702.37e, 708.2, 701.40b): "whenever you turn a permanent face up": the player who turned it face up (the event's player, normalize.ts);
    // the field means nothing for another change, so it never matches there
    if (p.player !== undefined && (p.what !== 'turnedFaceUp' || !pm(cx, p.player, playerOf(e)))) return false;
    // std-rx31 (CR 701.3a): "becomes attached to a creature": `by` describes the permanent it became attached to (the event's `object`, normalize.ts)
    // std-combat-1 (CR 603.2, 202.3; Eriette, the Beguiler): each description may name the other object of the event ("with mana value less than or equal to that
    // Aura's mana value"), read as the event happens (the attach looks back at nothing, CR 603.10)
    if (p.what === 'attached' && p.by !== undefined) return roleMatches(cx, e, 'subject', p.object, false, true) && roleMatches(cx, e, 'object', p.by, false, true);
    return p.by === undefined && roleMatches(cx, e, 'subject', p.object, p.what === 'unattached');
  },
  /** CR 122.7 (the Nth counter), 701.x. `atLeast`: the total on the object reaches N with this event. */
  counters: (p, e, cx) => {
    if (e.data['change'] !== p.change) return false;
    if (p.kind !== undefined && e.data['kind'] !== p.kind) return false;
    // FAST5X E21 (CR 122.6, 122.6a): "whenever you put ... counters on ...": the player who put them (absent when no player is known: never matches)
    if (p.by !== undefined && !(typeof e.data['by'] === 'string' && pm(cx, p.by, e.data['by'] as PlayerId))) return false;
    if (p.atLeast !== undefined) {
      const total = numberData(e, 'total');
      const amount = numberData(e, 'amount');
      if (typeof p.atLeast !== 'number' || total === undefined || amount === undefined || p.change !== 'put' || !(total >= p.atLeast && total - amount < p.atLeast)) return false;
    }
    if ('player' in p.on) return e.data['onPlayer'] === true && pm(cx, p.on.player, playerOf(e)); // counters on a player (poison, energy, experience)
    return e.data['onPlayer'] !== true && roleMatches(cx, e, 'subject', p.on, false);
  },
  /** CR 701: sacrifice, discard, cycle, scry, search, ... `object` is judged as it was for the verbs that look back (sacrifice, counter). */
  // cloud std-spm (CR 305.1): `from`, the zone a land was played from; std-lci: `revealed`, whether an explore revealed a land card
  action: (p, e, cx) => e.data['verb'] === p.verb && (p.won === undefined || e.data['won'] === p.won) /* p2-player-rules-3 (CR 701.30c) */ && expendMatches(p, e) && (p.from === undefined || e.data['from'] === p.from) && (p.notFrom === undefined || (typeof e.data['from'] === 'string' && e.data['from'] !== p.notFrom)) /* r4-trig (CR 305.1) */ && (p.searched === undefined || (e.data['zone'] === 'library' && e.data['zoneOwner'] === playerOf(e))) /* r4-trig (CR 701.23a) */ && (p.revealed === undefined || e.data['revealed'] === p.revealed) && pm(cx, p.actor, playerOf(e)) && roleMatches(cx, e, 'subject', p.object, lookBackApplies(p, e)) && roleMatches(cx, e, 'object', p.exploited, true) /* std-rx17: the exploited creature, as it last existed (CR 702.110b, 603.10a) */,
  /** CR 111. */
  createToken: (p, e, cx) => pm(cx, p.player, playerOf(e)) && roleMatches(cx, e, 'newObject', p.token, false),
  /** CR 706. */
  dieRoll: (p, e, cx) => pm(cx, p.player, playerOf(e)) && cmpMatches(p.result, numberData(e, 'result')),
  /** Cloud r3-mech, CR 705.2: a called coin flip, won or lost. */
  coinFlip: (p, e, cx) => pm(cx, p.player, playerOf(e)) && (p.won === undefined || e.data['won'] === p.won),
  /** M12-3, CR 603.9: a player lost or left the game (not as the result of a draw: triggers/normalize.ts emits nothing then). */
  // The player has lost and, in a game that goes on, left it (CR 104.5): "an opponent" is judged as they were before, a player other than the controller (CR
  // 102.3), not by the "still in the game" reading the other patterns use (triggers/filters.ts skips players who left, M12-1)
  loseGame: (p, e, cx) => {
    const who = playerOf(e);
    if (who === undefined) return false;
    if (p.player === 'opponent') return who !== cx.controller;
    return pm(cx, p.player, who);
  },
  /** Standard round 3, r3-trig (CR 108.4, 613.1b): the control of a permanent passed from the player `from` to the player `to`. */
  controlChange: (p, e, cx) => {
    const from = e.data['from'];
    const to = e.data['to'];
    if (typeof from !== 'string' || typeof to !== 'string' || from === to) return false;
    return pm(cx, p.from, from) && pm(cx, p.to, to) && roleMatches(cx, e, 'subject', p.object, false);
  },
  /**
   * At the beginning of a turn. Whether a turn is an extra turn is known only to the `turn` proposal (effects/proposal-kinds/turn.ts, `data.extra`; p2-replace-events-3:
   * "If a player would begin an extra turn, that player skips that turn instead", CR 500.7, 614.10); a trigger's event does not record it, so a pattern that asks
   * matches nothing there.
   */
  beginTurn: (p, e, cx) => (p.extra === undefined || (typeof e.data['extra'] === 'boolean' && e.data['extra'] === p.extra)) && pm(cx, p.whose, playerOf(e)),
  /** CR 608.2p-ish: a spell or ability finished resolving. */
  resolves: (p, e, cx) => roleMatches(cx, e, 'subject', p.what, false),
  /** CR 603.8: a state trigger is not an event; `triggers/state.ts` evaluates its condition. No event ever matches it. */
  state: () => false,
  /** M6-0, CR 614.10: a phase about to begin (only a proposal is one: replacement patterns, effects/proposal-kinds/phase.ts); `whose` is the active player. */
  phase: (p, e, cx) => e.data['phase'] === p.phase && pm(cx, p.whose, playerOf(e)),
  /** M6-0, CR 731.1a: day becomes night or night becomes day (emitted from M6-4). */
  dayNight: (p, e) => p.to === undefined || e.data['to'] === p.to,
};

/** M12-3 (CR 506.3, 508.1b): "or a planeswalker you control": the attack is on a planeswalker on the battlefield whose controller matches `want` (a player). */
function planeswalkerOf(want: NonNullable<Extract<EventPattern, { ev: 'attacks' }>['defender']>, e: SemEvent, cx: MatchContext): boolean {
  if (want === 'planeswalker' || want === 'battle') return false;
  const r = roleObject(cx, e, 'defender', false);
  if (r === undefined || r.o.zone !== 'battlefield' || cx.g.s.defs[r.o.defId]?.faces.some((f) => f.types.includes('Planeswalker')) !== true) return false;
  return pm(cx, want, r.o.controller);
}

/**
 * FAST5X E20 (CR 700.14): "you expend N": the mana spent this turn to cast spells was less than N before this payment and at least N after it, so each N is
 * expended at most once a turn. `n` belongs to `expend` only, which needs it: any other combination never matches.
 */
function expendMatches(p: Extract<EventPattern, { ev: 'action' }>, e: SemEvent): boolean {
  if (p.verb !== 'expend') return p.n === undefined;
  const before = numberData(e, 'spentBefore');
  const after = numberData(e, 'spentAfter');
  return p.n !== undefined && before !== undefined && after !== undefined && before < p.n && after >= p.n;
}

function defenderMatches(want: NonNullable<Extract<EventPattern, { ev: 'attacks' }>['defender']>, e: SemEvent, cx: MatchContext): boolean {
  if (want === 'planeswalker' || want === 'battle') {
    const r = roleObject(cx, e, 'defender', false);
    return r !== undefined && (r.o.zone === 'battlefield') && cx.g.s.defs[r.o.defId]?.faces.some((f) => f.types.includes(want === 'planeswalker' ? 'Planeswalker' : 'Battle')) === true;
  }
  // CR 506.3, 508.1b: each attacker attacks exactly one player, planeswalker or battle. "attacks you / a player / an opponent" is an attack on that
  // player: a creature attacking a planeswalker or battle is not attacking its controller or protector (CR 508.5 defines only "defending player").
  const defender = playerOf(e, 'defender');
  return defender !== undefined && pm(cx, want, defender);
}

/** `EventPattern` discriminators (`ev`) the matcher understands AND whose events the engine emits (capabilities `ev:<ev>`, design 5.2; finer names: forms.ts). */
export const EVENT_MATCHERS: Readonly<Record<string, true>> = Object.fromEntries(
  Object.keys(MATCHERS).filter((k) => !(NOT_EMITTED as readonly string[]).includes(k)).map((k) => [k, true as const]),
);

/** Is this event an occurrence of the pattern? See the file comment. */
export const matchEvent: MatchEvent = (pattern, e, cx) => {
  if (pattern.ev !== e.ev) return false;
  const m = MATCHERS[pattern.ev] as Matcher<typeof pattern.ev> | undefined;
  return m ? m(pattern as never, e, cx) : false;
};

