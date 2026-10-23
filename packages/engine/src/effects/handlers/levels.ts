/**
 * The `designateObject` op (m6 design 3.7): designations of a permanent that rules and effects read. Owner: M6-6.
 *
 *  - `classLevel` (CR 716.2a): "This Class's level becomes N" (the level up of a class level bar, statics/levels.ts). The level is a designation any permanent can
 *    have (CR 716.2b); it is never level counters (CR 716.4).
 *  - `solved` (CR 719.3a-b): "this Case becomes solved". It stays until the permanent leaves the battlefield; becoming solved again does nothing.
 *  - `prepared` / `unprepared` (CR 722.3a-c): core/prepare.ts (the exile copy of the prepare spell).
 *  - `saddled` (FAST5X E3, CR 702.171a-b): "this permanent becomes saddled until end of turn" (the saddle ability, keywords/data/saddle.json) and "target Mount
 *    you control becomes saddled until end of turn". It lasts until the cleanup step (core/steps.ts, CR 514.2) or until the permanent leaves the battlefield
 *    (CR 400.7). Becoming saddled while saddled is becoming saddled again (each resolution is the event; "for the first time each turn" counts them).
 *
 *  - `suspected` / `unsuspected` (FAST5X E12, CR 701.60a-d): "suspect it" (the keyword action, keywords/actions/suspect.ts) and "it's no longer suspected".
 *    Only a permanent can be suspected (CR 701.60b); a suspected permanent can't become suspected again (CR 701.60d: nothing happens, no event). The
 *    designation records a new timestamp: the rule-generated layer 6 effect that gives menace and "This creature can't block" (statics/suspect.ts, CR 701.60c)
 *    has it. Becoming no longer suspected also takes a timestamp, only so that the layer system sees the state change (statics/live.ts#layerSourcesPresent).
 *    std-mkm: a permanent that "can't become suspected" (a `cant` beSuspected restriction, statics/hooks.ts#ruleDenial; CR 101.2) is not suspected either.
 *
 * Each change emits `objectDesignation` (normalized to `becomes` with `what`, triggers/normalize.ts; event forms triggers/forms-levels.ts). The capability is the
 * value form `op:designateObject.<designation>` (model/cap-walk.ts), registered here only for the designations whose mechanism is implemented.
 */
import type { EffectStep } from '../../types/ability';
import type { StepHandler } from '../api';
import { becomePrepared, becomeUnprepared, hasPrepareSpell } from '../../core/prepare';
import { bindAs, did, permanentsOf } from './zones-util';
import { ruleDenial } from '../../statics/hooks';
import { plottedTurn, PLOTTED_KEY } from '../../core/special/plot';
import { resolveObjs } from '../refs';
import { WARPED_KEY } from '../../rules/filter';

import { doorEffect } from './rooms';
type Step = Extract<EffectStep, { op: 'designateObject' }>;

/** The value forms of `designateObject` this build runs (capabilities `op:designateObject.<designation>`, model/capabilities.ts). */
export const OP_FORMS: readonly string[] = [
  'op:designateObject.classLevel', 'op:designateObject.solved', 'op:designateObject.prepared', 'op:designateObject.unprepared', 'op:designateObject.saddled',
  'op:designateObject.suspected', 'op:designateObject.unsuspected', // FAST5X E12 (CR 701.60a)
  'op:designateObject.unlockDoor', 'op:designateObject.lockOrUnlockDoor', // FAST5X E8 (CR 709.5f-g, effects/handlers/rooms.ts)
  'op:designateObject.harnessed', // cloud r3-mech (CR 701.64)
  'op:designateObject.plotted', // r5-fxb (CR 702.170c-d): an effect makes a card in exile plotted
  'op:designateObject.warped', // std-costs-2 (CR 702.185a): the card warp's delayed triggered ability exiled is a warped card
];

const designateObject: StepHandler<Step> = (cx, st) => {
  const g = cx.g;
  if (st.designation === 'plotted') return plotByEffect(cx, st);
  if (st.designation === 'warped') return warpedByEffect(cx, st);
  const done = permanentsOf(cx, st.what).filter((h) => {
    const o = g.s.objects[h.id];
    if (!o || o.phasedOut) return false; // a phased-out permanent is treated as though it doesn't exist (CR 702.26b)
    const name = g.nameOf(o.id);
    switch (st.designation) {
      case 'classLevel': {
        if (st.level === undefined) return false;
        o.classLevel = st.level;
        g.emit({ type: 'objectDesignation', objectId: o.id, what: 'classLevel', level: st.level });
        g.log(`${name}'s level becomes ${st.level}.`, { rules: ['CR 716.2a'], level: 'action' });
        return true;
      }
      case 'solved': {
        if (o.solved === true) return false; // CR 719.3b: it stays solved; it does not become solved again
        o.solved = true;
        g.emit({ type: 'objectDesignation', objectId: o.id, what: 'solved' });
        g.log(`${name} becomes solved.`, { rules: ['CR 719.3b'], level: 'action' });
        return true;
      }
      // cloud r3-mech (CR 701.64): "Harness ~": a permanent becomes harnessed; once harnessed it stays so (until it leaves the battlefield, CR 400.7)
      case 'harnessed': {
        if (o.zone !== 'battlefield' || o.harnessed === true) return false;
        o.harnessed = true;
        g.emit({ type: 'objectDesignation', objectId: o.id, what: 'harnessed' });
        g.log(`${name} becomes harnessed.`, { rules: ['CR 701.64'], level: 'action' });
        return true;
      }
      case 'prepared':
        // CR 722.3a: a permanent can't gain the designation unless it has a prepare spell, nor while it already has it
        if (o.prepared === true || !hasPrepareSpell(g.s, o)) return false;
        return becomePrepared(g, o.id);
      case 'unprepared':
        return becomeUnprepared(g, o.id);
      case 'saddled': {
        // FAST5X E3, CR 702.171b: only permanents can be or become saddled
        if (o.zone !== 'battlefield') return false;
        o.saddled = true;
        g.emit({ type: 'objectDesignation', objectId: o.id, what: 'saddled' });
        g.log(`${name} becomes saddled until end of turn.`, { rules: ['CR 702.171b'], level: 'action' });
        return true;
      }
      // FAST5X E8 (CR 709.5f-g): the controller of the effect chooses the door
      case 'unlockDoor':
        return doorEffect(g, o.id, cx.controller, 'unlock');
      case 'lockOrUnlockDoor':
        return doorEffect(g, o.id, cx.controller, 'lockOrUnlock');
      case 'suspected': {
        // FAST5X E12, CR 701.60a-b, 701.60d: only a permanent, and never again while it is suspected
        if (o.zone !== 'battlefield' || o.suspected !== undefined) return false;
        // std-mkm (CR 701.60a, 101.2): "can't become suspected" (a `cant` beSuspected restriction): nothing happens, no event
        const denied = ruleDenial(g.s, { action: 'beSuspected', subject: o.id });
        if (denied !== null) {
          g.log(`${name} can't become suspected (${denied.message}).`, { rules: ['CR 701.60a', 'CR 101.2'], level: 'info' });
          return false;
        }
        o.suspected = g.newTimestamp();
        g.emit({ type: 'objectDesignation', objectId: o.id, what: 'suspected' });
        g.log(`${name} becomes suspected (it has menace and can't block).`, { rules: ['CR 701.60a', 'CR 701.60c'], level: 'action' });
        return true;
      }
      case 'unsuspected': {
        // FAST5X E12, CR 701.60a: "a spell or ability causes it to no longer be suspected"
        if (o.zone !== 'battlefield' || o.suspected === undefined) return false;
        delete o.suspected;
        g.newTimestamp(); // the layer system's memo key (statics/live.ts#layerSourcesPresent) must see the change
        g.emit({ type: 'objectDesignation', objectId: o.id, what: 'unsuspected' });
        g.log(`${name} is no longer suspected.`, { rules: ['CR 701.60a'], level: 'action' });
        return true;
      }
    }
  });
  bindAs(cx, st.as, done);
  return did(done.length);
};

/**
 * r5-fxb (CR 702.170c, 702.170d, 400.7): "Exile target spell. It becomes plotted.": an effect makes a card in exile plotted (core/special/plot.ts#PLOTTED_KEY: the
 * turn it became plotted, so its owner may cast it without paying its mana cost on a later turn, actions/cast-opt/plot.ts), whether or not it has plot. Only a
 * card in exile can be plotted (CR 702.170a): a token, a copy of a spell, or an object a replacement effect put elsewhere stays as it is. A card already plotted
 * stays plotted from the turn it first became so (unverified).
 */
function plotByEffect(cx: Parameters<StepHandler<Step>>[0], st: Step): ReturnType<StepHandler<Step>> {
  const g = cx.g;
  const done = resolveObjs(cx, st.what).filter((h) => {
    const o = g.s.objects[h.id];
    if (!o || o.zone !== 'exile' || h.zone !== 'exile' || o.kind !== 'card') return false;
    if (plottedTurn(o) !== undefined) return false;
    o.chosen = { ...(o.chosen ?? {}), [PLOTTED_KEY]: g.s.turn.number };
    g.emit({ type: 'objectDesignation', objectId: o.id, what: 'plotted' }); // "When this card becomes plotted" (CR 702.170a, 603.2; triggers/forms-plot.ts)
    g.log(`${g.nameOf(o.id)} becomes plotted: its owner may cast it without paying its mana cost on a later turn.`, { rules: ['CR 702.170c', 'CR 702.170d'], level: 'action' });
    return true;
  });
  bindAs(cx, st.as, done);
  return did(done.length);
}

/**
 * std-costs-2 (CR 702.185a, 400.7): warp's delayed triggered ability exiles the permanent (keywords/data/warp.json), and the card it exiled is a warped card ("a warped
 * creature card you own in exile", Close Encounter; rules/filter.ts#WARPED_KEY). Only a card in exile: a token, or an object a replacement effect put elsewhere,
 * is not one. The card stops being warped as it leaves exile (it is a new object, CR 400.7).
 */
function warpedByEffect(cx: Parameters<StepHandler<Step>>[0], st: Step): ReturnType<StepHandler<Step>> {
  const g = cx.g;
  const done = resolveObjs(cx, st.what).filter((h) => {
    const o = g.s.objects[h.id];
    if (!o || o.zone !== 'exile' || h.zone !== 'exile' || o.kind !== 'card') return false;
    o.chosen = { ...(o.chosen ?? {}), [WARPED_KEY]: g.s.turn.number };
    return true;
  });
  bindAs(cx, st.as, done);
  return did(done.length);
}

export const LEVELS_HANDLERS = { designateObject };
