/**
 * trek-1: "assimilate", a keyword action of the Star Trek set newer than the Comprehensive Rules in rules/cr (CR 701, rule number unverified), as a macro over the
 * primitive ops (design 7.5). Its reminder text is the rule source: "Put it onto the battlefield under your control with a +1/+1 counter. It's a Borg artifact
 * creature and loses all other creature types." Pure.
 */
import type { EffectStep, ObjRef } from '../../types/ability';
import type { ActionMacro } from '../types';
import { carry, manualAction } from './common';

/** The binding of the permanent the card became (CR 400.7: a new object), read by the type change that follows. */
const ASSIMILATED = '_assimilated';

/**
 * "Assimilate <card>": the player who assimilates (`who`, "you") puts the card (`subject`, the target the ability announced, a card in a graveyard) onto the
 * battlefield under their control with a +1/+1 counter on it (CR 110.2a, 122.6: the counter is put as it enters), then that permanent is a Borg artifact creature
 * and loses all other creature types, with no duration (CR 611.2a: it lasts as long as it is that object, CR 400.7). trek-13: a permanent that is already on the battlefield (The Best of
 * Both Worlds) is not put onto the battlefield: its controller becomes the player who assimilates, it gets the counter and the same type change. "Artifact creature" keeps its other card
 * types and subtypes (CR 205.1b, unverified); "loses all other creature types" makes Borg its only creature type (a `set` of creature types, CR 205.3m,
 * 613.1d; Borg is newer than the list of creature types, which statics/mods.ts#layer4 counts as a creature type on a creature). When the card can't be put onto
 * the battlefield (it left the graveyard), nothing is bound and the type change affects nothing.
 */
export const ASSIMILATE: ActionMacro = {
  name: 'assimilate',
  rule: 'CR 701 (reminder text)', // newer than the 2026-09-25 edition: the Star Trek reminder text is the rule source (number unverified)
  expand: (step) => {
    if (step.subject === undefined) return manualAction(step, 'assimilate needs the card it puts onto the battlefield');
    // assimilate has no number (once is n 1) and no choices; an `arg` has no words in it (render/steps-lasting.ts refuses one, so no automated card carries it)
    if ((step.n !== undefined && step.n !== 1) || step.choices !== undefined) return manualAction(step, 'assimilate takes no number or choices');
    const card = step.subject as ObjRef; // a card (an object reference: `subject` is never a player here, render/steps-lasting.ts checks it)
    const assimilated: ObjRef = { ref: 'bound', name: ASSIMILATED };
    const borg = (affects: ObjRef): EffectStep => ({
      op: 'effect',
      duration: { d: 'permanent' },
      effects: [{ s: 'continuous', affects, mods: [{ layer: 4, types: { add: ['Artifact', 'Creature'] }, subtypes: { set: ['Borg'] } }] }],
    });
    const fromZone: EffectStep[] = [{ op: 'move', what: card, to: { zone: 'battlefield', controller: step.who, counters: [{ kind: '+1/+1', count: 1 }] }, as: ASSIMILATED }, borg(assimilated)];
    // trek-13 (The Best of Both Worlds: "Assimilate target nonartifact creature an opponent controls. (Gain control of it and put a +1/+1 counter on it. It's a Borg artifact creature and
    // loses all other creature types.)"): a permanent already on the battlefield is not moved (CR 400.7): its controller changes for good (CR 611.2a, 613.1b), it gets the counter,
    // and the same type change
    const onBattlefield: EffectStep[] = [
      { op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: card, mods: [{ layer: 2, controller: step.who }] }] },
      { op: 'putCounters', on: card, kind: '+1/+1', count: 1 },
      borg(card),
    ];
    const steps: EffectStep[] = [{ op: 'if', cond: { cond: 'matches', object: card, filter: { zone: 'battlefield' } }, then: onBattlefield, else: fromZone }];
    return carry(step, steps);
  },
};
