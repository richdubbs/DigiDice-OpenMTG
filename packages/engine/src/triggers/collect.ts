/** Trigger collection: candidates, intervening if (CR 603.4), additional triggers (603.2d), limits (603.2h) (design 8.4). Owner: WP8. Contract: triggers/api.ts#CollectTriggers. */
import type { Game } from '../core/game';
import { diesCause, type ChapterAbilityDef, type EventPattern, type ObjectFilter, type StaticEffect, type TriggerModDef, type TriggeredAbilityDef } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { AbilityRef, GameObject, GameState, PendingTrigger, SemEvent, ZoneKind } from '../types/state';
import { abilitiesFromChars, type AbilityInfo } from '../rules/abilities';
import { charsOfObject, readingStable, type Chars } from '../rules/characteristics';
import type { CollectTriggers } from './api';
import { holds, type CondEnv } from './cond';
import { contextOf } from './context';
import { collectDelayed } from './delayed';
import { objectMatches } from './filters';
import { lookBackApplies, lookBackKinds } from './lookback';
import { isManaActivationPattern, isTriggeredManaAbility } from './forms';
import { historyMatches, type FactsEnv } from '../rules/history';
import { matchEvent } from './match';
import { batchOccurrences, byOccurrenceAmount, occurrences, perEventPattern } from './occurrences';
import { triggersPossible } from './possible';
import { hasReadAhead } from '../statics/levels';
import { keywordRegistry } from '../keywords/registry';

/** An object whose abilities are looked at for a batch: a living object, or one that left a zone during the batch (last known information, CR 603.10). */
export interface Candidate {
  id: ObjectId;
  obj: GameObject;
  chars: Chars;
  /** The zone its abilities are judged in: where it is, or where it was. */
  zone: ZoneKind;
  snapshot: boolean;
  /** CR 603.3a: the controller of a permanent or spell; objects in other zones have no controller, their owner controls the ability. */
  controller: PlayerId;
}

/** The layered controller (layer 2, WP9: `Chars.controller`) when the characteristics function reports one, else the object's own. */
const controllerFor = (o: GameObject, zone: ZoneKind, c: Chars): PlayerId => (zone === 'battlefield' || zone === 'stack' ? (c as Chars & { controller?: PlayerId }).controller ?? o.controller : o.owner);

/** The zones an ability functions in (CR 113.6): the battlefield unless it says otherwise. */
const zonesOf = (def: { zone?: ZoneKind[] }): ZoneKind[] => def.zone ?? ['battlefield'];

/** Cheap test on the printed definition: does this card have a triggered ability that works in `zone`? (Objects outside the battlefield and the stack are only worth enumerating if so.) */
function printedTriggerIn(g: Game, o: GameObject, zone: ZoneKind): boolean {
  const def = g.s.defs[o.defId];
  return def !== undefined && def.faces.some((f) => f.abilities.some((a) => ((a.kind === 'triggered' || a.kind === 'chapter') && (a.kind === 'triggered' ? zonesOf(a) : ['battlefield' as ZoneKind]).includes(zone))
    || (a.kind === 'keyword' && keywordTriggerZones(a.keyword).includes(zone))));
}

/**
 * std-rx22 (CR 113.6, 702.62a): the zones in which a keyword's expansion has a triggered ability (suspend's two abilities work in exile), from the keyword
 * library's data, memoized. A printed keyword is not a printed triggered ability, so without this a card in exile with suspend would never be looked at.
 */
const KEYWORD_TRIGGER_ZONES = new Map<string, readonly ZoneKind[]>();
function keywordTriggerZones(keyword: string): readonly ZoneKind[] {
  const known = KEYWORD_TRIGGER_ZONES.get(keyword);
  if (known) return known;
  const d = keywordRegistry.get(keyword);
  const zones = d?.status !== 'implemented' ? [] : [...new Set(((d.expand ?? []) as unknown[]).flatMap((e) => {
    const t = e as { kind?: unknown; zone?: unknown };
    return t.kind === 'triggered' && Array.isArray(t.zone) ? (t.zone as ZoneKind[]) : [];
  }))];
  KEYWORD_TRIGGER_ZONES.set(keyword, zones);
  return zones;
}

/**
 * std-copy-6 (CR 113.6, 611.2c, 702.62a-b): the objects outside the battlefield and the stack that a continuous effect grants abilities to (layer 6 `add`, a fixed
 * set naming the object in its zone: "If it doesn't have suspend, it gains suspend." on a card in exile). A granted ability is not printed, so printedTriggerIn
 * never finds it; such an object is a candidate, and triggeredAbilitiesOf keeps the abilities of its characteristics that work in its zone.
 */
function grantedAway(s: GameState): ReadonlySet<ObjectId> {
  const out = new Set<ObjectId>();
  for (const r of s.continuousEffects) {
    const e = r.effect;
    if (e.s !== 'continuous' || !e.mods.some((m) => m.layer === 6 && m.add !== undefined && m.add.length > 0)) continue;
    const a = e.affects;
    if (a.ref !== 'fixed' || !('objects' in a)) continue;
    for (const h of a.objects) if (h.zone !== 'battlefield' && h.zone !== 'stack' && s.objects[h.id]?.zone === h.zone) out.add(h.id);
  }
  return out;
}

/**
 * CR 603.2, 603.6a, 603.10: every object whose triggered abilities may care about this batch. Living objects are the permanents, the spells on the stack, the
 * emblems and the objects in other zones with an ability that works there; snapshots are the objects that left a zone during the batch (they can still trigger
 * from where they were when the pattern looks back).
 */
export function candidatesFor(g: Game, batch: readonly SemEvent[]): Candidate[] {
  return readingStable(g.s, () => candidatesIn(g, batch)); // reads every object of a state it does not change: one cache check (WP30)
}

function candidatesIn(g: Game, batch: readonly SemEvent[]): Candidate[] {
  const s = g.s;
  const out: Candidate[] = [];
  const granted = grantedAway(s);
  const living = (ids: readonly ObjectId[], always: boolean): void => {
    for (const id of ids) {
      const o = s.objects[id];
      if (!o || o.kind === 'ability' || o.phasedOut) continue;
      const zone = o.zone;
      if (!always && !printedTriggerIn(g, o, zone) && !granted.has(id)) continue;
      const chars = charsOfObject(s, o);
      out.push({ id, obj: o, chars, zone, snapshot: false, controller: controllerFor(o, zone, chars) });
    }
  };
  living(s.zones.battlefield, true);
  living(s.zones.stack, true);
  living(s.zones.command, true);
  for (const p of s.players) {
    living(s.zones.hand[p.id] ?? [], false);
    living(s.zones.graveyard[p.id] ?? [], false);
  }
  living(s.zones.exile, false);
  // CR 603.10a: only what left a zone IN THIS WINDOW looks back: the old ids of the batch's zone changes. The `before` of other events also holds objects that
  // are long gone (the source of damage dealt by its own "when this dies" ability), and those are not simultaneous leavers.
  const leftNow = new Set<ObjectId>();
  for (const e of batch) if (e.ev === 'zoneChange' && typeof e.data['oldId'] === 'string') leftNow.add(e.data['oldId']);
  const seen = new Set<ObjectId>();
  for (const e of batch) {
    for (const [id, lk] of Object.entries(e.before)) {
      if (seen.has(id) || !leftNow.has(id) || s.objects[id] || lk.object.kind === 'ability') continue;
      seen.add(id);
      const zone = lk.leftZone;
      const chars = lk.chars ?? charsOfObject(s, lk.object);
      out.push({ id, obj: lk.object, chars, zone, snapshot: true, controller: controllerFor(lk.object, zone, chars) });
    }
  }
  return out;
}

export interface TriggeredAbility {
  info: AbilityInfo;
  def: TriggeredAbilityDef | ChapterAbilityDef;
}

/** The triggered abilities of a candidate that work in the zone it is judged in (CR 113.6). Saga chapters are triggered abilities (CR 714.2). */
export function triggeredAbilitiesOf(c: Candidate): TriggeredAbility[] {
  const out: TriggeredAbility[] = [];
  for (const info of abilitiesFromChars(c.chars)) {
    const d = info.def;
    if (d.kind === 'triggered' && (zonesOf(d).includes(c.zone) || c.obj.kind === 'emblem')) out.push({ info, def: d });
    else if (d.kind === 'chapter' && c.zone === 'battlefield') out.push({ info, def: d });
  }
  return out;
}

/** CR 714.2: chapter abilities trigger when lore counters are put on the Saga so that the count reaches a chapter number. */
const LORE: EventPattern = { ev: 'counters', change: 'put', kind: 'lore', on: { self: true } };
function patternsOf(ab: TriggeredAbility): EventPattern[] {
  return ab.def.kind === 'chapter' ? [LORE] : ab.def.trigger.on;
}

/**
 * Which triggers a collection looks for (WP32). `stack`: the ordinary ones, put on the stack the next time a player would receive priority (CR 603.3). `mana`:
 * only triggered mana abilities triggering from the activation of a mana ability (CR 605.1b), which resolve at once without the stack (CR 605.4a,
 * triggers/mana-now.ts); the `stack` collection leaves exactly those out, so each is handled once.
 */
export type CollectMode = 'stack' | 'mana';

/** The patterns of an ability that a collection of this mode matches: the mana-activation patterns of a triggered mana ability belong to the `mana` mode only. */
function patternsFor(ab: TriggeredAbility, mode: CollectMode): EventPattern[] {
  const all = patternsOf(ab);
  if (ab.def.kind !== 'triggered' || !isTriggeredManaAbility(ab.def)) return mode === 'stack' ? all : [];
  return all.filter((p) => isManaActivationPattern(p) === (mode === 'mana'));
}
/** How many of the ability's chapter numbers this event reaches (CR 714.2b-c: "I, II --" is two chapter abilities, so one event adding two counters triggers it twice). */
function chapterHits(def: ChapterAbilityDef, e: SemEvent, exactOnly = false): number {
  const total = e.data['total'];
  const amount = e.data['amount'];
  if (typeof total !== 'number' || typeof amount !== 'number') return 0;
  // M6-6, CR 702.155a: read ahead: the turn the Saga entered, a chapter ability triggers only if the Saga has exactly its chapter number of lore counters
  return [...new Set(def.chapters)].filter((n) => total - amount < n && n <= total && (!exactOnly || n === total)).length;
}

/** M6-6, CR 702.155a: is this a read-ahead Saga (statics/levels.ts) in the turn it entered the battlefield (the history of this turn, triggers/history.ts)? */
function readAheadEnteredThisTurn(g: Game, cand: Candidate): boolean {
  if (!hasReadAhead(cand.chars.abilities)) return false;
  const turn = g.s.turn.number;
  return g.s.history.some((h) => h.turn === turn && h.ev === 'zoneChange' && h.subject === cand.id && h.facts['to'] === 'battlefield');
}

/**
 * M6-12 (m6 design 7): the capabilities of the "triggers an additional time" effects this collector applies exactly (model/capabilities.ts reads them; the walker
 * names every TriggerModDef by its cause, model/cap-walk.ts). Reviewed: a permanent entering the battlefield (CR 603.6a) causes the trigger, judged on the
 * event without looking back, and abilities of permanents on the battlefield trigger an additional fixed number of times (CR 603.2d: Panharmonicon). Not
 * registered: a cause that is a leave-the-battlefield event (CR 603.10a: the abilities of permanents that left with it are snapshots here and count once,
 * Teysa Karlov's "dying"), every other cause (attacking, damage, casting, life, drawing: not reviewed), and a computed number (`timesTriggered` skips it).
 * FAST5 T40 (CR 603.2d, 603.10a): `feature:triggerMod.any`, a mod with NO cause ("If a triggered ability of a Ninja creature you control triggers, that ability
 * triggers an additional time"): whatever event triggers the ability. It also applies to the abilities of a permanent that left the battlefield in this very
 * batch (its leaves-the-battlefield abilities look back, so it was a Ninja you controlled, and a doubler that left with it still applied), judged on the last
 * known information (`timesTriggered`, `triggerMods`).
 * std-rx2 (CR 508.1m, 603.2d; cites unverified): `feature:triggerMod.attacks`, a creature ATTACKING (Isshin, Two Heavens as One): the `attacks` events of a declaration
 * of attackers (triggers/normalize.ts, one per attacker; "whenever you attack" and "whenever one or more creatures attack" read the same events), matched against
 * the attacker filter without looking back, so an ability that triggers on such an event triggers once more for each mod that matches one of its events. A creature
 * put onto the battlefield attacking was never declared as an attacker (CR 508.4) and makes no such event.
 * trek-2 (CR 603.2d, 119.9; cites unverified): `feature:triggerMod.lifeGain`, YOU GAINING LIFE (Dr. Beverly Crusher): the `life` gain events of the doubler's
 * controller (one per gain, triggers/normalize.ts; a life total set higher is a gain too, CR 119.5), matched without looking back like entering: an ability of a
 * permanent you control that one of them triggers ("whenever you gain life", "whenever you gain or lose life") triggers once more per such doubler.
 */
export const TRIGGER_MOD_CAPABILITIES: readonly string[] = ['static:triggerMod', 'feature:triggerMod.enters', 'feature:triggerMod.any', 'feature:triggerMod.suppress.enters' /* CLOUD std-misc: #suppressed */, 'feature:triggerMod.attacks' /* std-rx2 */, 'feature:triggerMod.suppress.keyword' /* std-rx32: #silencedKeywords */, 'feature:triggerMod.dies' /* std-typechange-2: diesCause */, 'feature:triggerMod.suppress.dies' /* p2-misc-1: #suppressed */, 'feature:triggerMod.lifeGain' /* trek-2: isLifeGainCause, CR 603.2d */];

/** std-typechange-2 (CR 114.4): does the description of whose abilities are affected name emblems (`emblem: true`, alone or in one of its `anyOf`)? */
const namesEmblems = (f: ObjectFilter): boolean => f.emblem === true || (f.anyOf ?? []).some((x) => x.emblem === true);

/** p2-misc-2 (CR 112.1): does the description of whose abilities are affected name spells on the stack (`zone: 'stack'`, alone or in one of its `anyOf`)? */
const namesSpells = (f: ObjectFilter): boolean => f.zone === 'stack' || (f.anyOf ?? []).some((x) => x.zone === 'stack');

/** CR 603.2d: the "triggers an additional time" effects currently in force, with the permanent each comes from. */
interface TriggerMod {
  def: TriggerModDef;
  source: ObjectId;
  controller: PlayerId;
}
function triggerMods(g: Game, cands: readonly Candidate[]): TriggerMod[] {
  const out: TriggerMod[] = [];
  for (const c of cands) {
    if (c.zone !== 'battlefield') continue;
    for (const info of abilitiesFromChars(c.chars)) {
      const d = info.def;
      if (d.kind !== 'static' || !zonesOf(d).includes('battlefield')) continue;
      // FAST5 T40 (CR 603.10a): a doubler that left the battlefield in this batch still applies to the abilities that trigger from the same event, but only a mod with no
      // cause (every other mod is for a permanent that is still there, as before)
      // std-typechange-2 (CR 603.10a): ... and a mod whose cause is a creature dying (diesCause), an event that looks back
      const mods = d.effects.filter((x: StaticEffect): x is TriggerModDef => x.s === 'triggerMod' && x.suppress !== true && (!c.snapshot || x.cause === undefined || diesCause(x.cause)));
      if (mods.length === 0) continue;
      if (c.snapshot) {
        // the "as long as ..." of a permanent that is gone can't be judged (rules/conditions read the state as it is now): the extra trigger is not guessed
        if (d.condition) {
          g.log(`${c.chars.name} left the battlefield with this event; the engine can't tell whether it still made abilities trigger an additional time, check it yourself.`, { rules: ['CR 603.2d', 'CR 603.10a'], level: 'manual' });
          continue;
        }
      } else if (d.condition && holds(g, d.condition, { source: { id: c.id, zone: c.zone }, controller: c.controller, event: null }) !== true) continue; // "as long as ..."
      for (const def of mods) out.push({ def, source: c.id, controller: c.controller });
    }
  }
  return out;
}

/**
 * CLOUD std-misc (Torpor Orb: "Creatures entering don't cause abilities to trigger"): the events of the batch that cause no ability to trigger, by the `suppress` trigger
 * modifications of permanents on the battlefield now (right after the event: a permanent that entered with it applies too, CR 603.2, 603.6a). Only a permanent entering
 * is such a cause (model/cap-walk.ts names every other one, never registered); an "as long as ..." the engine can't judge suppresses nothing and says so.
 */
function suppressed(g: Game, cands: readonly Candidate[], batch: readonly SemEvent[]): Set<SemEvent> {
  const out = new Set<SemEvent>();
  for (const c of cands) {
    if (c.zone !== 'battlefield') continue;
    for (const info of abilitiesFromChars(c.chars)) {
      const d = info.def;
      if (d.kind !== 'static' || !zonesOf(d).includes('battlefield')) continue;
      // p2-misc-1 (CR 603.10a, 603.2; unverified): a creature DYING looks back (Hushbringer: "Creatures entering or dying don't cause abilities to trigger"), so a
      // silencer that left the battlefield with the event still silences it (dying at the same time as the other creatures), judged on last known information
      const mods = d.effects.filter((x: StaticEffect): x is TriggerModDef => x.s === 'triggerMod' && x.suppress === true && x.cause !== undefined && (!c.snapshot || diesCause(x.cause)));
      if (mods.length === 0) continue;
      if (c.snapshot) {
        if (d.condition) {
          g.log(`${c.chars.name} left the battlefield with this event; the engine can't tell whether it still kept abilities from triggering, check it yourself.`, { rules: ['CR 603.2', 'CR 603.10a'], level: 'manual' });
          continue;
        }
      } else if (d.condition) {
        const ok = holds(g, d.condition, { source: { id: c.id, zone: c.zone }, controller: c.controller, event: null });
        if (ok === undefined) g.log(`${c.chars.name}: the engine can't tell whether its ability applies; abilities triggered now are put on the stack, check them yourself.`, { rules: ['CR 603.2'], level: 'manual' });
        if (ok !== true) continue;
      }
      for (const m of mods) {
        const cx = { g, source: c.id, controller: c.controller, lookBack: diesCause(m.cause) };
        for (const e of batch) if (!out.has(e) && matchEvent(m.cause!, e, cx)) out.add(e);
      }
    }
  }
  return out;
}

/**
 * std-rx32 ("Ward abilities of those creatures don't trigger", CR 702.21a, 603.2): the `suppress` trigger modifications with a `keyword` of permanents on the battlefield
 * now, each with its source. An "as long as ..." the engine can't judge silences nothing and says so (as #suppressed).
 */
interface Silencer { def: TriggerModDef; source: ObjectId; controller: PlayerId }
function silencedKeywords(g: Game, cands: readonly Candidate[]): Silencer[] {
  const out: Silencer[] = [];
  for (const c of cands) {
    if (c.zone !== 'battlefield' || c.snapshot) continue;
    for (const info of abilitiesFromChars(c.chars)) {
      const d = info.def;
      if (d.kind !== 'static' || !zonesOf(d).includes('battlefield')) continue;
      const mods = d.effects.filter((x: StaticEffect): x is TriggerModDef => x.s === 'triggerMod' && x.suppress === true && x.keyword !== undefined && x.cause === undefined);
      if (mods.length === 0) continue;
      if (d.condition) {
        const ok = holds(g, d.condition, { source: { id: c.id, zone: c.zone }, controller: c.controller, event: null });
        if (ok === undefined) g.log(`${c.chars.name}: the engine can't tell whether its ability applies; abilities triggered now are put on the stack, check them yourself.`, { rules: ['CR 603.2'], level: 'manual' });
        if (ok !== true) continue;
      }
      for (const def of mods) out.push({ def, source: c.id, controller: c.controller });
    }
  }
  return out;
}

/** std-rx32: the keyword whose expansion this triggered ability of the candidate is (CR 702.1: printed, granted or copied), or undefined. */
function expandedFrom(cand: Candidate, key: string): string | undefined {
  const parent = cand.chars.abilities.find((a) => a.key === key)?.parent;
  const p = parent === undefined ? undefined : cand.chars.abilities.find((a) => a.key === parent)?.def;
  return p?.kind === 'keyword' ? p.keyword : undefined;
}

/** CR 603.2d: how many times the ability triggers for this group of events. Only abilities of permanents (p2-misc-2: and of spells, for a mod that names them); never delayed or reflexive ones (those are not collected here). */
function timesTriggered(g: Game, cand: Candidate, group: readonly SemEvent[], mods: readonly TriggerMod[]): number {
  // std-typechange-2 (CR 114.4): an emblem's triggered abilities only for a mod that names emblems (no other mod reads abilities outside the battlefield)
  const emblem = cand.zone === 'command' && cand.obj.kind === 'emblem' && !cand.snapshot;
  // p2-misc-2 (CR 603.2d, 112.1; unverified): a SPELL's triggered abilities ("When you cast this spell, ...", functioning on the stack) only for a mod whose
  // description names spells (Echoes of Eternity: "a triggered ability of a colorless spell you control or another colorless permanent you control")
  const spell = cand.zone === 'stack' && !cand.snapshot;
  if (cand.zone !== 'battlefield' && !emblem && !spell) return 1;
  let n = 1;
  for (const m of mods) {
    if (emblem && !namesEmblems(m.def.abilitiesOf)) continue;
    if (spell && !namesSpells(m.def.abilitiesOf)) continue;
    const dies = diesCause(m.def.cause); // std-typechange-2 (CR 603.10a): the dying is judged on last known information
    const cx = { g, source: m.source, controller: m.controller, lookBack: dies };
    if (typeof m.def.additional !== 'number') continue; // a computed number of extra triggers needs the interpreter's evaluator
    const cause = m.def.cause;
    if (cause !== undefined) {
      if (cand.snapshot && !dies) continue; // a cause that is an event of its own (entering...): abilities of a permanent that left count once, as before
      if (!group.some((e) => matchEvent(cause, e, cx))) continue;
    } // FAST5 T40: no cause: whatever event it is, also for the abilities that look back at a permanent that left (CR 603.10a)
    if (!objectMatches(g.s, m.def.abilitiesOf, cand.obj, [cand.id], { source: m.source, controller: m.controller })) continue;
    n += m.def.additional;
  }
  return n;
}

/** CR 603.2h: "Do this only once each turn" / "triggers only once": how many of `want` triggerings the limit still allows, and record them. */
/**
 * FAST5X E21 (CR 603.2h): the controller took the action of a "Do this only once each turn" ability (effects/run.ts): counted under the key `applyLimit` reads
 * (`<source id>|trigger:<ability key>`, cleared with the turn's other counts).
 */
export function noteLimitedAction(g: Game, key: string): void {
  g.s.turnActivations[key] = (g.s.turnActivations[key] ?? 0) + 1;
}

function applyLimit(g: Game, cand: Candidate, key: string, limit: TriggeredAbilityDef['limit'], want: number): number {
  if (!limit || cand.snapshot) return want;
  const id = `${cand.id}|trigger:${key}`;
  // FAST5X E21 (CR 603.2h): "Do this only once each turn": it triggers only while the action has been taken fewer times this turn; taking it is counted as the
  // ability resolves (effects/run.ts#countLimitedAction), never as it triggers
  if (limit.action === true) return (g.s.turnActivations[id] ?? 0) >= limit.max ? 0 : want;
  if (limit.per === 'turn') {
    const used = g.s.turnActivations[id] ?? 0;
    const n = Math.max(0, Math.min(want, limit.max - used));
    if (n > 0) g.s.turnActivations[id] = used + n;
    return n;
  }
  // per game: remembered on the object itself, so a new object (any zone change, CR 400.7) may trigger again.
  const live = g.s.objects[cand.id];
  if (!live) return want;
  const chosen = (live.chosen ??= {});
  const used = typeof chosen[`trig:${key}`] === 'number' ? (chosen[`trig:${key}`] as number) : 0;
  const n = Math.max(0, Math.min(want, limit.max - used));
  if (n > 0) chosen[`trig:${key}`] = used + n;
  return n;
}

/**
 * FAST4 T27 (`TriggerDef.first`, "for the first time each turn"; CR 603.2, 603.2c): did an event matching one of the patterns, as this ability sees it
 * ("you" its controller, "~" its source), happen this turn BEFORE this batch? Read from the game history (triggers/history.ts writes it before the batch is
 * collected; `historyStart` is where this batch's own entries begin), so an event that happened before the source was on the battlefield counts too.
 * `undefined` when the history cannot answer the question (rules/history.ts throws for facts it does not have): the caller then lets the player check.
 */
function happenedEarlierThisTurn(g: Game, patterns: readonly EventPattern[], cand: Candidate, historyStart: number): boolean | undefined {
  const env: FactsEnv = { you: cand.controller, sourceId: cand.id };
  const turn = g.s.turn.number;
  const h = g.s.history;
  try {
    for (let i = Math.min(historyStart, h.length) - 1; i >= 0; i--) {
      const e = h[i]!;
      if (e.turn === turn && patterns.some((p) => historyMatches(e, p, env))) return true;
    }
  } catch {
    return undefined;
  }
  return false;
}

/**
 * Collect the triggers caused by one batch (design 8.4). The returned triggers are NOT added to `g.s.pendingTriggers`: `triggers/stack.ts` does that, so a test
 * (or a replacement-effect check) can ask what a batch would trigger. FAST4 T27: `historyStart` is the index of `g.s.history` where the batch's own entries
 * begin (what is before it happened earlier: `TriggerDef.first`); by default the batch is not in the history yet.
 */
export const collectTriggers: CollectTriggers = (g, batch, historyStart) => collectWith(g, batch, 'stack', historyStart ?? g.s.history.length);

/** CR 605.1b, 605.4a (WP32): the triggered mana abilities (and delayed ones, CR 603.7) a batch of mana activations triggers; they resolve at once (mana-now.ts). */
export const collectManaTriggers = (g: Game, batch: readonly SemEvent[]): PendingTrigger[] => collectWith(g, batch, 'mana', g.s.history.length);

function collectWith(g: Game, all: readonly SemEvent[], mode: CollectMode, historyStart: number, meta = false): PendingTrigger[] {
  if (all.length === 0) return [];
  const out: PendingTrigger[] = [];
  const triggered: { t: PendingTrigger; cand: Candidate; group: readonly SemEvent[] }[] = []; // std-copy-6: what triggered, for metaEvents
  const cands = triggersPossible(g.s) ? candidatesFor(g, all) : []; // WP32: no definition of the game has a triggered ability: no object can trigger (possible.ts)
  // CLOUD std-misc: the events a "don't cause abilities to trigger" effect silences trigger nothing, delayed abilities included
  const quiet = suppressed(g, cands, all);
  const batch = quiet.size === 0 ? all : all.filter((e) => !quiet.has(e));
  if (quiet.size > 0) g.log(`${quiet.size === 1 ? 'An event causes' : `${quiet.size} events cause`} no abilities to trigger.`, { rules: ['CR 603.2'], level: 'info' });
  const mods = triggerMods(g, cands);
  const silencers = silencedKeywords(g, cands); // std-rx32
  // std-sos review (CR 603.10a, 400.7): the new objects the batch's zone changes made, with the event that made each. A look-back event is judged with the abilities
  // that existed immediately before it: an object that arrived in its zone at the same time as that event or later had no ability there then ("Whenever another
  // creature dies, return this card from your graveyard ..." does not trigger for a creature that died at the same time as this card)
  const arrived = new Map<ObjectId, SemEvent>();
  for (const e of batch) {
    const oldId = e.ev === 'zoneChange' ? e.data['oldId'] : undefined;
    const newId = typeof oldId === 'string' ? g.s.lki[oldId]?.newId : undefined;
    if (newId !== undefined && newId !== oldId) arrived.set(newId, e);
  }
  const arrivedNotBefore = (cand: Candidate, e: SemEvent): boolean => {
    const a = cand.snapshot ? undefined : arrived.get(cand.id);
    return a !== undefined && a !== e && (a.batch === e.batch || a.seq > e.seq);
  };
  for (const cand of cands) {
    if (g.player(cand.controller).hasLost) continue;
    const cx = { g, source: cand.id, controller: cand.controller, lookBack: cand.snapshot };
    let exact: boolean | undefined; // CR 702.155a (read ahead), worked out once per candidate when a chapter ability needs it
    for (const ab of triggeredAbilitiesOf(cand)) {
      const patterns = patternsFor(ab, mode);
      if (patterns.length === 0) continue;
      // std-rx32 (CR 702.21a, 603.2): "Ward abilities of those creatures don't trigger"
      if (silencers.length > 0 && cand.zone === 'battlefield' && !cand.snapshot) {
        const kw = expandedFrom(cand, ab.info.key);
        if (kw !== undefined && silencers.some((m) => m.def.keyword === kw && objectMatches(g.s, m.def.abilitiesOf, cand.obj, [cand.id], { source: m.source, controller: m.controller }))) continue;
      }
      // FAST5X E8 (CR 709.5j): the half a printed ability is on, for "When you unlock this door"
      const acx = ab.info.origin === 'printed' ? { ...cx, face: ab.info.face } : cx;
      const matched: SemEvent[] = [];
      const lookedBack = new Set<SemEvent>(); // AF2: the events that a pattern which matched them looks back at (CR 603.10a), for the effect (contextOf)
      for (const e of batch) {
        const hits = patterns.filter((p) => {
          // A thing that left a zone triggers only from where it was and only for events CR 603.10 lets look back.
          // wave 6 refs review (CR 603.2, 603.6a, 400.7): a permanent that entered and left again within the batch (exiled and returned twice by one resolution,
          // Another Round) triggered on its own entering, judged right after that event while it was on the battlefield: its snapshot sees that event too
          if (cand.snapshot && !(lookBackKinds(p).length > 0 && lookBackApplies(p, e)) && !(cand.zone === 'battlefield' && arrived.get(cand.id) === e)) return false;
          if (lookBackApplies(p, e) && arrivedNotBefore(cand, e)) return false; // CR 603.10a: it was not there just before the event
          return matchEvent(perEventPattern(p, patterns), e, acx); // std-mkm: a one-sided damage amount is the occurrence's (triggers/occurrences.ts)
        });
        const hit = hits.length > 0;
        if (hits.some((p) => lookBackApplies(p, e))) lookedBack.add(e);
        if (hit &&(ab.def.kind !== 'chapter' || chapterHits(ab.def, e, (exact ??= readAheadEnteredThisTurn(g, cand))) > 0)) matched.push(e);
      }
      if (matched.length === 0) continue;
      // CR 603.2c; PUSH1 T2: the combat damage of a step is one event for a damage trigger that names one side of it (CR 510.2, triggers/occurrences.ts)
      // ... and the counters put on ONE creature are one occurrence of "one or more counters are put on a creature" (triggers/occurrences.ts#batchOccurrences)
      // CLOUD std-misc (CR 603.2c): "one or more players discard one or more cards" is the whole batch, once (TriggerDef.wholeBatch)
      let groups = ab.def.kind === 'triggered' && ab.def.trigger.batch ? (ab.def.trigger.wholeBatch === true ? [matched] : batchOccurrences(patterns, matched)) : byOccurrenceAmount(patterns, occurrences(patterns, matched));
      const trig = ab.def.kind === 'triggered' ? ab.def.trigger : undefined;
      // FAST4 T27 (CR 603.2, 603.2c): "for the first time each turn": only the first occurrence of the turn, and none when one happened before this batch
      let firstUnknown = false;
      if (trig?.first === 'turn') {
        const earlier = happenedEarlierThisTurn(g, patterns, cand, historyStart);
        if (earlier === true) continue;
        firstUnknown = earlier === undefined;
        groups = groups.slice(0, 1);
      }
      for (const group of groups) {
        const context = contextOf(group, cand.snapshot ? { [cand.id]: { object: cand.obj, chars: cand.chars, leftZone: cand.zone } } : {}, (e) => lookedBack.has(e));
        if (firstUnknown) g.log(`${cand.chars.name}: the engine can't tell whether this is the first time this turn; it is put on the stack, check it yourself.`, { rules: ['CR 603.2'], level: 'manual' });
        // FAST4 T27 (CR 603.1, 603.2): a "while" / "during" condition of the trigger event is judged now, with the event, and never again (unlike CR 603.4)
        if (trig?.while !== undefined) {
          const ok = holds(g, trig.while, { source: { id: cand.id, zone: cand.zone }, controller: cand.controller, event: context });
          if (ok === false) continue;
          if (ok === undefined) g.log(`${cand.chars.name}: the engine can't check the condition of its trigger event; it is put on the stack, check the condition yourself.`, { rules: ['CR 603.2'], level: 'manual' });
        }
        const interveningIf = ab.def.kind === 'triggered' ? ab.def.interveningIf : undefined;
        if (interveningIf) {
          const env: CondEnv = { source: { id: cand.id, zone: cand.zone }, controller: cand.controller, event: context };
          const ok = holds(g, interveningIf, env);
          if (ok === false) continue; // CR 603.4: it does not trigger
          if (ok === undefined) g.log(`${cand.chars.name}: the engine can't check "if ..." of its triggered ability; it is put on the stack, check the condition when it resolves.`, { rules: ['CR 603.4'], level: 'manual' });
        }
        const limit = ab.def.kind === 'triggered' ? ab.def.limit : undefined;
        const chapters = ab.def.kind === 'chapter' ? chapterHits(ab.def, group[0]!, exact === true) : 1; // CR 714.2c: one trigger per chapter number reached
        const times = applyLimit(g, cand, ab.info.key, limit, chapters * timesTriggered(g, cand, group, mods));
        for (let i = 0; i < times; i++) {
          const ref: AbilityRef = { source: ab.info.origin, face: ab.info.face, index: ab.info.index, key: ab.info.key };
          const t: PendingTrigger = { id: `t${g.s.counters.effect++}`, sourceId: cand.id, sourceName: cand.chars.name, controller: cand.controller, abilityRef: ref, context };
          out.push(t);
          triggered.push({ t, cand, group });
          g.log(`${cand.chars.name} triggers: ${ab.def.text}`, { rules: ['CR 603.2'], level: 'info' });
        }
      }
    }
  }
  out.push(...collectDelayed(g, batch, mode));
  // std-copy-6 (CR 603.2, 603.3b): the triggering of those abilities is an event of its own ("Whenever a triggered ability of ... triggers"); what it triggers
  // triggers at the same time and is put on the stack with them. One level: the abilities that trigger on it make no such event again
  if (mode === 'stack' && !meta && triggered.length > 0) out.push(...collectWith(g, metaEvents(triggered), mode, historyStart, true));
  return out;
}

/**
 * std-copy-6 (CR 603.2, 603.3b, 508.1m): one `abilityTriggered` event per triggered ability of an object that triggered in a batch: the object as `subject`, the
 * ability as `spell` (the pending trigger, `pending:<id>`, which effects/refs.ts finds on the stack by StackInfo.pendingId once it is put there), and whether that
 * object attacking caused it (`byAttacking`: one of the events that triggered it is an `attacks` event of that object).
 */
function metaEvents(triggered: readonly { t: PendingTrigger; cand: Candidate; group: readonly SemEvent[] }[]): SemEvent[] {
  return triggered.map(({ t, cand, group }) => {
    const first = group[0]!;
    const byAttacking = group.some((e) => { const a = e.ev === 'attacks' ? e.roles.attacker : undefined; return a !== undefined && 'objects' in a && a.objects.some((h) => h.id === cand.id); });
    return {
      ev: 'abilityTriggered', seq: first.seq, batch: first.batch, before: {},
      roles: { subject: { objects: [{ id: cand.id, zone: cand.zone }] }, spell: { objects: [{ id: `pending:${t.id}`, zone: 'stack' }] } },
      data: { byAttacking },
    } as SemEvent;
  });
}
