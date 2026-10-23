/** CR 701 actions that create tokens: investigate (701.16), incubate (701.53), populate (701.36), amass (701.47). Pure macros over primitive ops. Owner: WP3. */
import type { ObjectFilter } from '../../types/ability';
import type { ActionMacro } from '../types';
import { carry, countOf, manualAction } from './common';

/** CR 701.16a: "Investigate" means "Create a Clue token." (CR 111.10f; `n` times when the text says "investigate twice"). */
export const INVESTIGATE: ActionMacro = {
  name: 'investigate',
  rule: 'CR 701.16',
  expand: (step) => carry(step, [{ op: 'createToken', who: step.who, token: { predefined: 'Clue' }, count: countOf(step), ...(step.as !== undefined ? { as: step.as } : {}) }]),
};

/** CR 701.53a: to incubate N, create an Incubator token that enters with N +1/+1 counters on it (CR 111.10i). */
export const INCUBATE: ActionMacro = {
  name: 'incubate',
  rule: 'CR 701.53',
  expand: (step) => {
    if (step.n === undefined) return manualAction(step, 'incubate needs its number N');
    return carry(step, [{ op: 'createToken', who: step.who, token: { predefined: 'Incubator' }, count: 1, counters: [{ kind: '+1/+1', count: step.n }], ...(step.as !== undefined ? { as: step.as } : {}) }]);
  },
};

const OWN_TOKEN_CREATURES: ObjectFilter = { types: ['Creature'], token: true, controller: 'you' };

/** CR 701.36a-b: choose a creature token you control and create a token that's a copy of it; with no creature token, nothing happens. */
export const POPULATE: ActionMacro = {
  name: 'populate',
  rule: 'CR 701.36',
  expand: (step) =>
    carry(step, [
      { op: 'chooseObjects', who: step.who, from: { ref: 'each', filter: OWN_TOKEN_CREATURES }, min: 1, max: 1, as: '_populate' },
      { op: 'copy', what: { ref: 'bound', name: '_populate' }, result: 'token', who: step.who, ...(step.n !== undefined ? { count: step.n } : {}), ...(step.as !== undefined ? { as: step.as } : {}) },
    ]),
};

const YOUR_ARMY: ObjectFilter = { types: ['Creature'], subtypes: ['Army'], controller: 'you' };

/**
 * CR 701.47a: amass [subtype] N = if you don't control an Army creature, create a 0/0 black [subtype] Army creature token; choose an Army creature you control;
 * put N +1/+1 counters on it; if it isn't a [subtype], it becomes one in addition to its other types. `arg` is the subtype ("Zombie", CR 701.47d); the chosen Army
 * is bound to the step's `as` ("the Army you amassed", CR 701.47c). The token has no stated name, so it is named "<subtypes> Token" (CR 111.4).
 */
export const AMASS: ActionMacro = {
  name: 'amass',
  rule: 'CR 701.47',
  expand: (step) => {
    if (step.n === undefined) return manualAction(step, 'amass needs its number N');
    const sub = step.arg ?? 'Zombie';
    const army = step.as ?? '_army';
    // r4-mech (CR 701.47a): another player amasses with an Army THEY control ("Its controller amasses Goblins X"); "you" keeps the filter as it was
    const ARMY: ObjectFilter = step.who.ref === 'you' ? YOUR_ARMY : { ...YOUR_ARMY, controller: step.who };
    return carry(step, [
      {
        op: 'if',
        cond: { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: ARMY } } },
        then: [{ op: 'createToken', who: step.who, token: { colors: ['B'], types: ['Creature'], subtypes: sub === 'Army' ? ['Army'] : [sub, 'Army'], power: 0, toughness: 0 }, count: 1 }],
      },
      { op: 'chooseObjects', who: step.who, from: { ref: 'each', filter: ARMY }, min: 1, max: 1, as: army },
      { op: 'putCounters', on: { ref: 'bound', name: army }, kind: '+1/+1', count: step.n },
      {
        op: 'if',
        cond: { cond: 'matches', object: { ref: 'bound', name: army }, filter: { notSubtypes: [sub] } },
        then: [{ op: 'effect', effects: [{ s: 'continuous', affects: { ref: 'bound', name: army }, mods: [{ layer: 4, subtypes: { add: [sub] } }] }], duration: { d: 'permanent' } }],
      },
    ]);
  },
};
