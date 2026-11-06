/**
 * Op handlers: lasting effects and delayed triggers (CR 611, 603.7, 603.12). Owner: WP15. WP0 wrote the empty table the aggregator (handlers/index.ts) spreads into OP_HANDLERS; the capability `op:<op>` appears
 * only when the op has a handler here AND a renderer (design 5.2), so an unfinished package can never make a card wrongly automated.
 * Ops: effect delay reflexive.
 *
 * None of them changes zones, life, damage or counters, so none proposes an event (design 8.7: "none (creates records)"); the records join the state through
 * their one writer each: effects/perform-direct.ts#performEffectRecord (continuous effects, through core/durations.ts#addEffectRecord), triggers/delayed.ts#createDelayedTrigger, triggers/stack.ts#putReflexiveTrigger.
 */
import { armDuration, sourceHolds } from '../../core/durations';
import type { AbilityDef, DelayedWhen, Duration, EffectStep, ObjRef, PlayerPred, StaticEffect } from '../../types/ability';
import type { ContinuousEffectRec } from '../../types/state';
import { abilityDefOnStack } from '../../rules/abilities';
import { RULE_HOOK_ACTIONS } from '../../statics/hooks';
import { STATIC_KINDS } from '../../statics/live';
import { whileObjectHolds } from '../../statics/while-object';
import { createDelayedTrigger } from '../../triggers/delayed';
import { putReflexiveTrigger } from '../../triggers/stack';
import type { ExecCtx, OpHandlers, StepResult } from '../api';
import { evalCond } from '../eval';
import { performControlSync, performEffectRecord } from '../perform-direct';
import { COPY_SNAPSHOT_HOOK } from '../copy';
import { askManual } from '../manual';
import * as pipeline from '../propose';
import { costMovedSelfCard, isCurrent, linkValue, readInfo, resolveObjs, resolvePlayers } from '../refs';
import { getChars } from '../../rules/characteristics';
import { COND, FailsToDetermine, fixChosen, fixDuration, fixNode, fixPlayerPred, lockSet, mentionsSubject, prepareDeferred, STEP, TOP, varsOf } from './lasting-fix';
import { bindActed } from './lifedamage';
import type { ObjHandle } from '../../types/state';

const NOTHING: StepResult = { performed: false, count: 0 };

const nameOfSource = (cx: ExecCtx): string => cx.g.nameOf(cx.source.id);

/** MX2: `feature:copy.thisAbility` (model/cap-walk.ts), registered by model/capabilities.ts: the `effect` handler below states "this ability". */
export const COPY_THIS_ABILITY_FEATURES: readonly string[] = ['copy.thisAbility', 'copy.thisAbility.reflexive' /* edh-next-133: the `reflexive` handler below bakes "this ability" */];

/**
 * edh-next-133 (CR 707.9a, 603.12; Aurora Shifter: "you may pay {E}{E}. When you do, this creature becomes a copy of another target creature you control, except it has this ability and ..."): in the
 * instructions of a reflexive triggered ability, "this ability" is the ability whose text it is (the printed one resolving now), not the reflexive ability: it is fixed now, as that ability itself.
 * Null when such an exception is found but `self` is unknown (the caller leaves the reflexive part to the players).
 */
function bakeThisAbility(steps: EffectStep[], self: AbilityDef | undefined): EffectStep[] | null {
  let unknown = false;
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (typeof x !== 'object' || x === null) return x;
    const r = x as Record<string, unknown>;
    if (r['op'] === 'effect' && Array.isArray(r['effects']) && (r['effects'] as StaticEffect[]).some(hasThisAbility)) {
      if (self === undefined) { unknown = true; return x; }
      return { ...r, effects: (r['effects'] as StaticEffect[]).map((e) => withThisAbility(e, self)) };
    }
    if (r['kind'] !== undefined && r['op'] === undefined) return x; // an ability of its own (quoted): its "this ability" is its own
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, walk(v)]));
  };
  const out = walk(steps) as EffectStep[];
  return unknown ? null : out;
}
/** FAST5 T64: `feature:copy.choose` (types/ability.ts, the 1a modification's `choose`), registered by model/capabilities.ts; the choice is made by effects/copy.ts. */
export const COPY_CHOOSE_FEATURES: readonly string[] = ['copy.choose'];

/** MX2: does this effect make a copy "except it has this ability" (CR 707.9a)? */
const hasThisAbility = (e: StaticEffect): boolean => e.s === 'continuous' && e.mods.some((m) => m.layer === '1a' && (m.except ?? []).some((x) => 'thisAbility' in x));

/** MX2 (CR 707.9a): the copy exception "it has this ability" as the ability itself: `{layer: 6, add: [self]}`, a copiable value of the copy. */
function withThisAbility(e: StaticEffect, self: AbilityDef): StaticEffect {
  if (e.s !== 'continuous') return e;
  return { ...e, mods: e.mods.map((m) => (m.layer === '1a' && m.except ? { ...m, except: m.except.map((x) => ('thisAbility' in x ? { layer: 6 as const, add: [self] } : x)) } : m)) };
}

/**
 * Design 5.2: can a resolved effect of kind `s` be stored, i.e. does something in this build apply it? Exactly when the engine advertises `static:<s>`, which
 * model/capabilities.ts builds from three registrars: the layer system (statics/live.ts `STATIC_KINDS`: `continuous`), the proposal pipeline (effects/propose.ts
 * `STATIC_KINDS`, WP11: `replace`, which carries the prevention and regeneration shields) and the rule hooks (statics/hooks.ts `RULE_HOOK_ACTIONS`, WP16:
 * `static:restrict|permit|rule|costMod`). The same three tables are read here, at call time (ENGINE_CAPABILITIES itself cannot be imported: model/capabilities.ts
 * reads OP_HANDLERS, which contains this module). test/m5/lasting/static-kinds.test.ts and effect.test.ts pin that this agrees with ENGINE_CAPABILITIES.
 * The one exception (M6-5a): `static:additionalCost|alternativeCost` (actions/cast-kinds.ts) are read by the cast path from printed abilities only, so they are
 * advertised but never stored here; the walker gives such an effect inside an `effect` step `feature:castCost.lasting`, which nothing registers. M6-12: the
 * same for `static:triggerMod` (triggers/collect.ts reads the static abilities of permanents, never a stored record): `feature:triggerMod.lasting`.
 */
export function storableKind(s: string): boolean {
  // WP11's table, absent before its merge (`'STATIC_KINDS' in pipeline` is then false; the tests named above fail if this and the builder ever disagree)
  const pipelineKinds = 'STATIC_KINDS' in pipeline ? (pipeline as unknown as { STATIC_KINDS: Readonly<Record<string, true>> }).STATIC_KINDS : {};
  return Object.hasOwn(STATIC_KINDS, s) || Object.hasOwn(pipelineKinds, s) || Object.hasOwn(RULE_HOOK_ACTIONS, `static:${s}`);
}

type StepWhen = Extract<DelayedWhen, { at: 'step' }>;
const withWhose = (w: StepWhen, whose: PlayerPred | undefined): StepWhen => (whose === undefined ? w : { ...w, whose });

/**
 * CR 611.2b: a "for as long as" duration that is already over (or never began) when the effect would start: the effect does nothing. Also an "until [the source]
 * leaves the battlefield" whose source has already left: the event can't happen any more (CR 400.7), so the effect would never end.
 */
function neverStarts(cx: ExecCtx, d: Duration): string | null {
  switch (d.d) {
    case 'whileSource':
      return sourceHolds(cx.g, cx.source, cx.controller, d.as) ? null : 'its "for as long as" duration is already over';
    case 'asLongAs':
      return evalCond(cx, d.cond) ? null : 'its "for as long as" condition is already false';
    case 'until': {
      const p = d.event;
      const leaves = p.ev === 'zoneChange' && p.subject.self === true && ([] as string[]).concat(p.from ?? []).includes('battlefield');
      const onField = isCurrent(cx, cx.source) && cx.source.zone === 'battlefield';
      return leaves && !onField ? 'the source it lasts until has already left the battlefield' : null;
    }
    default:
      return null;
  }
}

/** The effects one `StaticEffect` of the step becomes (CR 611.2c-d): usually one; one per object when a value depends on the object it modifies ("its power"). */
/**
 * edh-combat-5 (CR 702.11d-f; Odric, Lunarch Marshal ruling 2020-01-24): a granted keyword with `likeAmong` becomes the variants (qualities) of that keyword the permanents the filter
 * names have right now, or the plain keyword when one of them has it plain (nothing found: the plain keyword).
 */
function expandVariants(cx: ExecCtx, e: StaticEffect): StaticEffect {
  const needs = (m: Extract<StaticEffect, { s: 'continuous' }>['mods'][number]): boolean => m.layer === 6 && (m.protectionFromColorsOf !== undefined || m.add?.some((a) => a.kind === 'keyword' && a.likeAmong !== undefined) === true);
  if (e.s !== 'continuous' || !e.mods.some(needs)) return e;
  const mods = e.mods.map((m) => {
    if (m.layer !== 6 || !needs(m)) return m;
    const add = (m.add ?? []).flatMap((a): AbilityDef[] => {
      if (a.kind !== 'keyword' || a.likeAmong === undefined) return [a];
      const { likeAmong, ...rest } = a;
      const qualities = new Set<string | undefined>();
      for (const h of resolveObjs(cx, { ref: 'each', filter: likeAmong })) for (const k of getChars(cx.g.s, h.id)?.keywords ?? []) if (k.keyword === a.keyword) qualities.add(k.quality);
      if (qualities.size === 0 || qualities.has(undefined)) return [rest];
      return [...qualities].map((quality) => ({ ...rest, quality }));
    });
    // edh-players-15 (CR 702.16a, 105.1, 608.2h, 400.7; Éowyn, Fearless Knight): "protection from each of that creature's colors": one protection for each color the object has (as it
    // last existed when it has left the battlefield); an object that can't be found or has no color gives none
    if (m.protectionFromColorsOf !== undefined) {
      const colors = new Set<string>();
      for (const h of resolveObjs(cx, m.protectionFromColorsOf)) for (const c of readInfo(cx, h)?.chars?.colors ?? []) colors.add(c);
      const word: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
      for (const c of colors) add.push({ kind: 'keyword', keyword: 'protection', quality: `color:${c}`, text: `protection from ${word[c] ?? c}` });
    }
    const { protectionFromColorsOf: _p, ...rest } = m;
    return { ...rest, add };
  });
  return { ...e, mods };
}

/**
 * edh-next-146 (CR 601.2a, 611.2c, 707.10; Hellish Rebuke, rulings 2021-07-23): "the player who cast ¤" in an ability this effect grants is the player who cast the spell that resolves,
 * fixed now; a copy that was not cast names nobody (the granted ability then does nothing), and an effect of anything but a spell names nobody either.
 */
function fixGrantCaster(cx: ExecCtx, e: StaticEffect): StaticEffect {
  const text = JSON.stringify(e);
  if (!text.includes('"ref":"grantCaster"')) return e;
  const caster = cx.stack?.kind === 'spell' && cx.stack.isCopy !== true ? cx.stack.caster : undefined;
  const fixed = JSON.stringify({ ref: 'fixed', players: caster === undefined ? [] : [caster] });
  return JSON.parse(text.split('{"ref":"grantCaster"}').join(fixed)) as StaticEffect;
}

/**
 * edh-d-101: the action of a continuous effect that only grants "You may play / cast this card from your graveyard" to cards in your own graveyard (`each` cards you own there),
 * or null. The granted ability is exactly a static ability that functions in the graveyard with that one permission of the card itself.
 */
function grantedSelfGraveyardPermit(e: StaticEffect): 'play' | 'cast' | null {
  if (e.s !== 'continuous' || e.mods.length !== 1 || e.affects.ref !== 'each' || !('filter' in e.affects)) return null;
  const f = e.affects.filter as unknown as Record<string, unknown> | undefined;
  if (f === undefined || f['zone'] !== 'graveyard' || f['owner'] !== 'you' || f['isCard'] !== true || f['controller'] !== undefined) return null;
  const m = e.mods[0]!;
  if (m.layer !== 6 || (m.add ?? []).length !== 1 || Object.keys(m).some((k) => k !== 'layer' && k !== 'add' && (m as unknown as Record<string, unknown>)[k] !== undefined)) return null;
  const a = m.add![0]!;
  if (a.kind !== 'static' || JSON.stringify(a.zone) !== '["graveyard"]' || a.condition !== undefined || a.effects.length !== 1) return null;
  const p = a.effects[0]!;
  if (p.s !== 'permit' || (p.action !== 'play' && p.action !== 'cast')) return null;
  return JSON.stringify({ ...p, action: 'x' }) === JSON.stringify({ s: 'permit', who: { ref: 'you' }, action: 'x', of: { self: true }, from: 'graveyard' }) ? p.action : null;
}

function effectsToStore(cx: ExecCtx, e0: StaticEffect, duration: Duration): StaticEffect[] {
  const e = fixGrantCaster(cx, expandVariants(cx, e0));
  // CLOUD std-msh (CR 115.1, 608.2c): "... becomes a copy of that creature" after "up to one target creature" with none chosen: there is nothing to copy, so
  // the effect does nothing (it is not a copy left to apply by hand)
  if (e.s === 'continuous' && e.mods.some((m) => m.layer === '1a' && m.copyOf.ref === 'target' && (cx.targets.get(m.copyOf.id) ?? []).length === 0)) return [];
  if (e.s === 'restrict' && duration.d === 'throughNextUntap' && duration.whose === undefined) {
    // MX5 (CR 502.3, 611.2a): "they don't untap during their controllers' next untap steps": each object's own controller's next untap step ends the effect
    // for that object only, so each object gets a record of its own (core/durations.ts#expireAfterUntapStep reads the one object of each record)
    const fixed = fixNode(cx, e, TOP);
    const locked = lockSet(cx, fixed.subject);
    if (locked.empty) return [];
    const ref = locked.ref;
    if (ref.ref !== 'fixed' || !('objects' in ref)) return [fixed];
    return ref.objects.map((h) => ({ ...fixed, subject: { ref: 'fixed', objects: [h] } }));
  }
  // std-exile-play-2-4 (CR 611.2a, 611.2c-like, 400.7): a play or cast permission for the objects an `each` filter picks ("the card you own exiled this way and each
  // other card exiled this way with lesser mana value than it", Triple Triad): the objects are picked now, with every value of the filter fixed now (the mana value
  // of "it"), and the permission names exactly them from then on (statics/play-permits.ts reads only fixed objects). One that picks nothing permits nothing; a value
  // that can't be determined (there is no "it") permits nothing too (FailsToDetermine, CR 608.2b)
  const lockedGroup = e.s === 'permit' && (e.action === 'play' || e.action === 'cast');
  // edh-d-99 (CR 607.2a, 611.2a, 400.7; King Narfi's Betrayal): ... and the same for the cards linked to the source ("until end of turn, you may cast spells from among cards exiled with this
  // Saga"): the cards exiled with it as the effect begins, each one a new object once it leaves exile (CR 400.7), so a card cast this way is not cast again
  if (lockedGroup && e.of !== undefined && Object.keys(e.of).length === 1 && (e.of.is?.ref === 'each' || e.of.is?.ref === 'linked')) {
    const fixed = fixNode(cx, e, TOP);
    const locked = lockSet(cx, fixed.of!.is!);
    if (locked.empty || locked.ref.ref !== 'fixed' || !('objects' in locked.ref)) return [];
    return [{ ...fixed, of: { is: locked.ref as ObjRef } }];
  }
  // edh-replace-3 (CR 614.1a, 611.2a; Hallowed Moonlight, Mistcaller): the condition of a resolved replacement effect that reads the object it replaces ("and it wasn't cast",
  // `wasCast` of the event's subject) is judged for each event it meets: its `event` references are that event's and stay as they are (as the `then` steps of a prevention do);
  // what it says about this resolution (targets, names, X) is fixed now
  if (e.s === 'replace' && e.condition !== undefined && JSON.stringify(e.condition).includes('"ref":"event"')) {
    const { condition, ...rest } = e;
    return [{ ...fixNode(cx, rest as StaticEffect, TOP), condition: fixNode(cx, condition, STEP) } as StaticEffect];
  }
  // edh-next-99 (CR 614.10, 614.10a, 502.1; Brine Elemental; also a phase or a turn): a one-use skip shield of a GROUP of players ("each opponent skips their next untap step") is one skip for
  // EACH of them: one record per player, each with that player as `whose`, so one player's skipped step does not use up the others' (no player: nothing is skipped)
  if (e.s === 'replace' && e.body.b === 'skip' && (e.replaces.ev === 'step' || e.replaces.ev === 'phase' || e.replaces.ev === 'beginTurn') && typeof e.replaces.whose === 'object' && e.shield !== undefined && e.shield.uses !== 'all') {
    const ps = [...new Set(resolvePlayers(cx, e.replaces.whose))];
    if (ps.length !== 1) return ps.map((p) => fixNode(cx, { ...e, replaces: { ...e.replaces, whose: { ref: 'fixed', players: [p] } } } as StaticEffect, TOP));
  }
  // edhd63 (CR 611.2c, 608.2h; Teyo, Geometric Tactician): "only the nearest opponent in the last chosen direction": the side chosen as the effect resolves, stored as the side itself (a later choice under the
  // same link must not change an effect that already began)
  if (e.s === 'restrict' && e.onlyNearest !== undefined && 'chosen' in e.onlyNearest) {
    const picked = linkValue(cx, e.onlyNearest.chosen)?.values?.[0];
    if (picked === 'left' || picked === 'right') return [fixNode(cx, { ...e, onlyNearest: { side: picked } } as StaticEffect, TOP)];
  }
  if (e.s !== 'continuous') return [fixNode(cx, e, TOP)]; // rule-modifying: identities and values fixed, an `each` filter stays live (CR 611.2c)
  // edh-d-101 (CR 611.2c, 113.6, 601.3, 305.1, 400.7; Kethis, the Hidden Hand): "Until end of turn, each legendary card in your graveyard gains "You may play this card from your graveyard."":
  // the cards in your graveyard as the effect begins gain a permission that lets their owner (you) play each of them from there. That is the permission of exactly those objects for you
  // for as long as the effect lasts (statics/play-permits.ts#isObjectPermit: a card that leaves the graveyard and returns is a new object without it, the 2019-07-12 ruling), so it is stored
  // as such; the timing and land plays stay the usual ones (the ruling). Only that exact grant (model/cap-walk.ts#isGrantedSelfGraveyardPermit)
  const granted = grantedSelfGraveyardPermit(e);
  if (granted !== null) {
    const locked = lockSet(cx, e.affects);
    if (locked.empty || locked.ref.ref !== 'fixed' || !('objects' in locked.ref)) return [];
    return [{ s: 'permit', who: fixNode(cx, { ref: 'you' }, TOP), action: granted, of: { is: locked.ref as ObjRef } } as StaticEffect];
  }
  const locked = lockSet(cx, e.affects); // CR 611.2c: the affected set is determined now and never changes
  if (locked.empty) return [];
  let affects = locked.ref;
  // edh-d-84 (CR 702.26b, 702.26d; Yes Man, Personal Securitron, ruling 2024-03-08): a permanent that is phased out as the effect begins is treated as though it doesn't
  // exist: it is not in the affected set ("Target opponent gains control of ~" with ~ phased out in response changes nothing, so "When they do" never triggers)
  if (affects.ref === 'fixed' && 'objects' in affects && affects.objects.some((h) => h.zone === 'battlefield' && cx.g.s.objects[h.id]?.phasedOut === true)) {
    const kept = affects.objects.filter((h) => !(h.zone === 'battlefield' && cx.g.s.objects[h.id]?.phasedOut === true));
    if (kept.length === 0) return [];
    affects = { ...affects, objects: kept };
  }
  if (!mentionsSubject(e.mods) || affects.ref !== 'fixed' || !('objects' in affects)) return [{ ...e, affects, mods: fixChosen(cx, fixNode(cx, e.mods, TOP)) }];
  const out: StaticEffect[] = [];
  for (const h of affects.objects) {
    const saved = cx.subject;
    cx.subject = { id: h.id, zone: h.zone };
    try {
      out.push({ ...e, affects: { ref: 'fixed', objects: [h] }, mods: fixChosen(cx, fixNode(cx, e.mods, TOP)) });
    } finally {
      if (saved === undefined) delete cx.subject;
      else cx.subject = saved;
    }
  }
  return out;
}

/** edh-next-146: the steps with every `move` of `{ref:'self'}` (in the lists of instructions nested in them too, never in an ability a step creates) made a move of these objects. */
function selfMovesTo(steps: EffectStep[], to: ObjHandle[]): EffectStep[] {
  return steps.map((st) => {
    const out: Record<string, unknown> = { ...st };
    if (st.op === 'move' && JSON.stringify(st.what) === '{"ref":"self"}') out['what'] = { ref: 'fixed', objects: to.map((h) => ({ ...h })) };
    if (st.op !== 'delay' && st.op !== 'reflexive') for (const k of ['do', 'then', 'else'] as const) if (Array.isArray(out[k])) out[k] = selfMovesTo(out[k] as EffectStep[], to);
    return out as unknown as EffectStep;
  });
}

/** CLOUD std-tmt: the value forms of the `effect` op this handler runs (`op:effect.as`: the objects a continuous effect affects are bound to the step's `as`). */
export const EFFECT_OP_FORMS: readonly string[] = ['op:effect.as', 'feature:keyword.likeAmong' /* edh-combat-5 */, 'feature:mod.protectionFromColorsOf' /* edh-players-15 */, 'feature:keyword.exceptAttached', 'feature:keyword.exceptAttached.kinds' /* edh-d-24 */ /* edh-perms-21 */, 'feature:ref.grantCaster' /* edh-next-146 */];

export const LASTING_HANDLERS: OpHandlers = {
  /** CR 611.2: a resolved continuous effect (layers, rules, shields), with its duration; values and identities fixed as it is created (design 9.1). */
  effect: (cx, step) => {
    const g = cx.g;
    const name = nameOfSource(cx);
    const never = neverStarts(cx, step.duration);
    if (never) {
      g.log(`${name}'s effect does nothing: ${never}.`, { rules: ['CR 611.2b'], level: 'info' });
      return NOTHING;
    }
    let duration: Duration;
    try {
      duration = fixDuration(cx, step.duration);
    } catch (e) {
      if (!(e instanceof FailsToDetermine)) throw e;
      g.log(`${name}'s effect does nothing: ${e.message}`, { rules: ['CR 608.2b'], level: 'info' });
      return NOTHING;
    }
    // std-rx32 (CR 611.2b): "for as long as it remains tapped" about an object that is not (or no longer there): the effect never begins
    if (duration.d === 'whileObject' && !whileObjectHolds(g.s, duration)) {
      g.log(`${name}'s effect does nothing: its "for as long as" duration is already over.`, { rules: ['CR 611.2b'], level: 'info' });
      return NOTHING;
    }
    const timestamp = g.newTimestamp(); // CR 613.7b: the effects of one instruction are created together
    let created = 0;
    const locked: ObjHandle[] = []; // CLOUD std-tmt: the objects the effects affect, for the step's `as` (CR 611.2c, 608.2c)
    // CR 611.2b, 301.5c: "for as long as ~ remains attached to it": what it is attached to now; attached to anything else later ends the effect
    const attachedTo = duration.d === 'whileSource' && duration.as === 'attached' ? g.s.objects[cx.source.id]?.attachedTo : undefined;
    for (const e of step.effects) {
      if (!storableKind(e.s)) {
        // Nothing in this build would apply such a record (its capability `static:<s>` is missing; the degrade pass keeps such units away, this is the
        // defensive fallback): resolved by hand, never stored and ignored. The chip lasts as long as the effect would, its players fixed (CR 611.2a).
        askManual(cx, step.span ?? `${name}: an effect of kind "${e.s}"`, `the engine can't apply an effect of kind "${e.s}" yet`, duration);
        continue;
      }
      let stored: StaticEffect[];
      try {
        stored = effectsToStore(cx, e, duration);
      } catch (err) {
        if (!(err instanceof FailsToDetermine)) throw err;
        g.log(`Part of ${name}'s effect does nothing: ${err.message}`, { rules: ['CR 608.2b'], level: 'info' });
        continue;
      }
      if (stored.length === 0) g.log(`${name}'s effect affects nothing.`, { rules: ['CR 611.2c'], level: 'info' });
      if (stored.some(hasThisAbility)) {
        // MX2 (CR 707.9a): "except it has this ability": the ability resolving now, stored as the ability itself (it stays data: its own "this ability" is
        // resolved again whenever IT resolves)
        const self = cx.stackId !== null && g.s.objects[cx.stackId] ? abilityDefOnStack(g.s, g.s.objects[cx.stackId]!) : undefined;
        if (self === undefined) {
          askManual(cx, step.span ?? `${name}: a copy effect "except it has this ability"`, 'the engine can\'t tell which ability "this ability" is (CR 707.9a)', duration);
          continue;
        }
        stored = stored.map((x) => withThisAbility(x, self));
      }
      for (const effect of stored) {
        if (effect.s === 'continuous' && effect.affects.ref === 'fixed' && 'objects' in effect.affects) for (const h of effect.affects.objects) if (!locked.some((x) => x.id === h.id)) locked.push(h);
        const rec: ContinuousEffectRec = {
          id: g.newEffectId(),
          source: { id: cx.source.id, zone: cx.source.zone },
          sourceName: name,
          controller: cx.controller,
          timestamp,
          startedTurn: g.s.turn.number,
          duration,
          effect,
          ...(effect.s === 'replace' && effect.shield && effect.shield.uses !== 'all' ? { usesLeft: effect.shield.uses } : {}), // CR 615.7-615.8
          ...(attachedTo !== undefined ? { attachedTo } : {}),
        };
        if (COPY_SNAPSHOT_HOOK && effect.s === 'continuous' && effect.mods.some((m) => m.layer === '1a')) COPY_SNAPSHOT_HOOK(g, rec); // M6-0 hook: CR 707.4, M6-2 writes rec.copy
        performEffectRecord(g, rec);
        created++;
      }
    }
    if (created > 0) g.log(`${name}'s effect begins${duration.d === 'endOfTurn' ? ' (until end of turn)' : ''}.`, { rules: ['CR 611.2a', 'CR 611.2c', 'CR 611.2d'], level: 'action' });
    if (created > 0) performControlSync(g); // MX2: a control-changing effect applies at once (CR 613.1b, core/control.ts)
    // CLOUD std-tmt (`op:effect.as`, CR 611.2c, 608.2c): "Gain control of all artifacts your opponents control until end of turn. Untap them.": the locked set is "them"
    if (step.as !== undefined) bindActed(cx, step.as, locked, []);
    return { performed: created > 0, count: created };
  },

  /**
   * CR 603.7: create a delayed triggered ability. Its source is the spell or the source of the ability (603.7d-e), its controller the controller of what
   * resolves. What it says about this resolution is fixed now; the objects it names keep the zone they are expected in (603.7c).
   */
  delay: (cx, step) => {
    const g = cx.g;
    // std-tdm (CR 603.7, 603.3d): the delayed trigger's own targets (`delay.targets`) are chosen when it is put on the stack: not fixed now, like a reflexive one's
    const own = new Set((step.targets ?? []).map((t) => t.id));
    const prepared = prepareDeferred(cx, step.do, { keepEvent: step.when.at === 'event', ...(own.size > 0 ? { own } : {}) });
    const targets = own.size > 0 ? prepareDeferred(cx, step.targets!, { keepEvent: step.when.at === 'event', own, bakeBound: true }).node : undefined;
    const captured = { ...prepared.captured };
    for (const n of step.capture ?? []) {
      const b = cx.bindings.get(n);
      if (b) captured[n] = b.objects;
    }
    // CR 603.7: "that player's next end step", "when target player casts a spell": the players are the ones this resolution meant, fixed now (WP8 matches a
    // fixed player set, triggers/filters.ts#refPlayers).
    const w = step.when;
    const when = w.at === 'event' ? { at: 'event' as const, event: fixNode(cx, w.event, COND), ...(w.or !== undefined ? { or: w.or.map((p) => fixNode(cx, p, COND)) } : {}) } : w.at === 'step' ? withWhose(w, fixPlayerPred(cx, w.whose)) : w;
    const duration = step.duration ? fixDuration(cx, step.duration) : undefined;
    // edh-combat-5 (CR 500.8, 603.7a): "At the beginning of that combat" waits for the phase the `extraPhase` step before it added (effects/handlers/game.ts); with none, nothing is created
    const addedPhase = cx.vars.get('$addedPhase');
    if (w.at === 'step' && w.phase === 'added' && addedPhase === undefined) return { performed: false, count: 0 };
    // edh-next-146 (CR 400.7j, 603.7c; Plague Reaver): "Sacrifice this creature: ... Return this creature to the battlefield ... at the beginning of their next upkeep": a move of "~" the delayed
    // trigger makes is a move of the card the cost made of the source (fixed now, so it is returned only if it is still where the cost put it); nothing else of "~" changes
    const movedSelf = costMovedSelfCard(cx);
    const rec = createDelayedTrigger(g, {
      source: { id: cx.source.id, zone: cx.source.zone },
      controller: cx.controller,
      when,
      do: movedSelf === null ? prepared.node : selfMovesTo(prepared.node, movedSelf),
      captured,
      vars: w.at === 'step' && w.phase === 'added' ? { ...varsOf(cx), $phase: addedPhase! } : varsOf(cx),
      ...(duration ? { duration } : {}),
      ...(step.once === true ? { once: true } : {}),
      ...(step.batch === true ? { batch: true } : {}),
      ...(step.wholeBatch === true && step.batch === true ? { wholeBatch: true as const } : {}), // edh-players-13
      ...(targets !== undefined ? { targets } : {}),
    });
    if (duration?.d === 'until') armDuration(g, rec.id);
    g.log(`${nameOfSource(cx)} creates a delayed triggered ability.`, { rules: ['CR 603.7'], level: 'info' });
    return { performed: true, count: 1 };
  },

  /**
   * CR 603.12: "When you do, ...": a reflexive triggered ability that triggers right away if the named step was carried out during this resolution (for `may`
   * and `pay`: if the player chose to, CR 118.12). It goes on the stack the next time a player would receive priority, and its targets are chosen then (603.3d).
   */
  reflexive: (cx, step) => {
    const g = cx.g;
    if (!(cx.results.get(step.when.did)?.performed ?? false)) return NOTHING;
    // FAST5X E16 INTERFACE CHANGE: a reflexive trigger that waits for a result of that step ("When excess damage is dealt to ... this way", CR 603.12, 120.10)
    if (step.when.if !== undefined && !evalCond(cx, step.when.if)) return NOTHING;
    // r5-cost (CR 603.12, 700.2): the targets of a reflexive trigger's modes are its own too
    const own = new Set([...step.targets, ...(step.modes?.options.flatMap((o) => o.program.targets) ?? [])].map((t) => t.id));
    const steps = prepareDeferred(cx, step.do, { keepEvent: true, own });
    const targets = prepareDeferred(cx, step.targets, { keepEvent: true, own, bakeBound: true }).node;
    const bound = { ...steps.captured };
    const modes = step.modes === undefined ? undefined : {
      ...step.modes,
      // std-combat-2 (CR 603.12, 700.2, 608.2h): a number of modes that counts what this resolution did ("you may pay {1} up to three times. When you do, choose up to
      // that many --") is fixed now; the modes are chosen when the trigger is put on the stack (CR 603.3c), after this resolution
      min: prepareDeferred(cx, step.modes.min, { keepEvent: true, own }).node,
      max: prepareDeferred(cx, step.modes.max, { keepEvent: true, own }).node,
      options: step.modes.options.map((o) => {
        const ss = prepareDeferred(cx, o.program.steps, { keepEvent: true, own });
        Object.assign(bound, ss.captured);
        return { ...o, program: { ...o.program, targets: prepareDeferred(cx, o.program.targets, { keepEvent: true, own, bakeBound: true }).node, steps: ss.node } };
      }),
    };
    const name = nameOfSource(cx);
    // edh-next-133 (CR 707.9a, 603.12): "except it has this ability" in the reflexive instructions is the ability resolving now
    const self = cx.stackId !== null && g.s.objects[cx.stackId] ? abilityDefOnStack(g.s, g.s.objects[cx.stackId]!) : undefined;
    const baked = bakeThisAbility(steps.node, self);
    if (baked === null) {
      askManual(cx, step.span ?? `${name}: a copy effect "except it has this ability"`, 'the engine can\'t tell which ability "this ability" is (CR 707.9a)', undefined);
      return NOTHING;
    }
    putReflexiveTrigger(g, {
      source: { id: cx.source.id, zone: cx.source.zone },
      controller: cx.controller,
      text: step.span ?? `Reflexive triggered ability of ${name}.`,
      targets,
      steps: baked,
      bound,
      vars: varsOf(cx),
      context: cx.event,
      ...(modes !== undefined ? { modes } : {}),
    });
    g.log(`${name}'s reflexive triggered ability triggers.`, { rules: ['CR 603.12'], level: 'info' });
    return { performed: true, count: 1 };
  },
};
