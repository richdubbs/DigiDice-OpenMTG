/** CR 701 actions that put counters: double counters (701.10e), adapt (701.46), support (701.41). Pure macros over primitive ops. Owner: WP3. */
import type { ActionMacro } from '../types';
import { carry, manualAction, subjectOf } from './common';

/**
 * CR 701.10e: to double the number of a kind of counters on a player or permanent, give it as many of those counters as it already has. `subject` is what is
 * doubled (a set is doubled one object at a time, each by its own number), `arg` the counter kind.
 */
export const DOUBLE_COUNTERS: ActionMacro = {
  name: 'doubleCounters',
  rule: 'CR 701.10',
  expand: (step) => {
    if (step.subject === undefined || step.arg === undefined) return manualAction(step, 'double needs the thing to double and the kind of counter');
    const kind = step.arg;
    const each = { ref: 'bound', name: '_double' } as const;
    return carry(step, [{ op: 'forEach', over: step.subject, as: '_double', do: [{ op: 'putCounters', on: each, kind, count: { q: 'counters', on: each, kind } }] }]);
  },
};

/** CR 701.46a: "Adapt N" means "If this permanent has no +1/+1 counters on it, put N +1/+1 counters on it." */
export const ADAPT: ActionMacro = {
  name: 'adapt',
  rule: 'CR 701.46',
  expand: (step) => {
    if (step.n === undefined) return manualAction(step, 'adapt needs its number N');
    const me = subjectOf(step);
    return carry(step, [
      {
        op: 'if',
        cond: { cond: 'compare', left: { q: 'counters', on: me, kind: '+1/+1' }, op: '==', right: 0 },
        then: [{ op: 'putCounters', on: me, kind: '+1/+1', count: step.n }],
      },
    ]);
  },
};

/**
 * CR 701.41a: support N = put a +1/+1 counter on each of up to N [other] target creatures. The up-to-N targets are announced by the ability that says "support N"
 * (its `TargetSpec`s, CR 601.2c), so the step's `subject` names them: a support step without its targets cannot be expanded.
 */
export const SUPPORT: ActionMacro = {
  name: 'support',
  rule: 'CR 701.41',
  expand: (step) => {
    if (step.subject === undefined) return manualAction(step, 'support needs the targets it puts counters on');
    return carry(step, [{ op: 'putCounters', on: step.subject, kind: '+1/+1', count: 1 }]);
  },
};

/**
 * FAST5X E9, CR 701.68a: to "blight N" means to put N -1/-1 counters on a creature you control. The player chooses one creature they control (not a target)
 * and puts the N counters on it; the choice is bound as the step's `as` when it has one, else `_blighted` ("the blighted creature", CR 701.68c; CLOUD std-ecl: the
 * parser names it when a later instruction says "the blighted creature", as it names amass's Army). A player who controls no creature puts no counters
 * (CR 701.68b: and can't choose to blight, which effects/handlers/control.ts#cannotStart judges from this expansion's first step). "Each opponent blights N":
 * each of those players chooses one of their own creatures, one player at a time in APNAP order (CR 608.2e-f).
 */
export const BLIGHT: ActionMacro = {
  name: 'blight',
  rule: 'CR 701.68',
  expand: (step) => {
    if (step.n === undefined) return manualAction(step, 'blight needs its number N');
    const blighted = { ref: 'bound', name: '_blighted' } as const;
    const put = { op: 'putCounters', on: blighted, kind: '-1/-1', count: step.n } as const;
    if (step.who.ref === 'you') {
      const name = step.as ?? '_blighted';
      return carry(step, [
        { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, min: 1, max: 1, as: name },
        { ...put, on: { ref: 'bound', name } },
      ]);
    }
    const it = { ref: 'iterating' } as const;
    return carry(step, [{
      op: 'forEach', over: step.who, as: '_blighter', do: [
        { op: 'chooseObjects', who: it, from: { ref: 'each', filter: { types: ['Creature'], controller: it } }, min: 1, max: 1, as: '_blighted' },
        put,
      ],
    }]);
  },
};
