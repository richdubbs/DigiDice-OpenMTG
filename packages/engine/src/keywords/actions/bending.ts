/**
 * FAST5 MX6: the keyword actions of Tarkir: Dragonstorm, Avatar: The Last Airbender and Edge of Eternities as macros over the primitive ops (design 7.5):
 * endure (CR 701.63), earthbend (CR 701.66) and "empower <planeswalker type> N" (CR 701.71, empower Jace). Pure. Not here, on purpose
 * (`UNREGISTERED_ACTIONS` in index.ts gives the reason for each): waterbend (a cost only, FAST5X E10) and behold; airbend is native (FAST5X E10, native.ts).
 */
import type { EffectStep, ObjectFilter, ObjRef, Quantity, TokenDef } from '../../types/ability';
import type { ActionMacro } from '../types';
import { carry, manualAction, subjectOf } from './common';

/** A quantity that is certainly 0 (a literal), so the action does nothing (CR 701.63b). */
const isZero = (q: Quantity): boolean => q === 0;
/** A quantity that is a literal number greater than 0 (no run-time check needed). */
const isPositive = (q: Quantity): boolean => typeof q === 'number' && q > 0;

/**
 * CR 701.63a: to endure N, the permanent's controller creates an N/N white Spirit creature token unless they put N +1/+1 counters on that permanent. CR 701.63b:
 * endure 0 does nothing. `subject` is the permanent ("~", "it"), `who` its controller (the template writes `controllerOf` the subject). A permanent that is no
 * longer on the battlefield can't have counters put on it, so its controller creates the token (the choice "unless they put counters" is one they can't make;
 * Tarkir: Dragonstorm release notes). The token has no stated name: "Spirit Token" (CR 111.4).
 */
export const ENDURE: ActionMacro = {
  name: 'endure',
  rule: 'CR 701.63',
  expand: (step) => {
    if (step.n === undefined) return manualAction(step, 'endure needs its number N');
    const n = step.n;
    if (isZero(n)) return carry(step, []); // CR 701.63b
    const me = subjectOf(step) as ObjRef; // the permanent that endures (an object reference: `subject` is never a player here)
    const token: TokenDef = { colors: ['W'], types: ['Creature'], subtypes: ['Spirit'], power: n, toughness: n };
    const create: EffectStep = { op: 'createToken', who: step.who, token, count: 1 };
    // the question the controller answers (the `may` handler asks "<span> Do you?"): yes puts the counters, no creates the token
    const words = typeof n === 'number' ? String(n) : 'X';
    const question = `put ${words} +1/+1 counter${words === '1' ? '' : 's'} on it rather than create a ${words}/${words} white Spirit creature token (endure ${words}, CR 701.63a).`;
    const choose: EffectStep = {
      op: 'if',
      // still the same permanent on the battlefield (CR 400.7): a card in another zone can't have the counters put on it
      cond: { cond: 'all', of: [{ cond: 'exists', of: me }, { cond: 'matches', object: me, filter: { zone: 'battlefield' } }] },
      then: [{ op: 'may', who: step.who, do: [{ op: 'putCounters', on: me, kind: '+1/+1', count: n }], otherwise: [create] }],
      else: [create],
    };
    // X ("it endures X, where X is ..."): endure 0 does nothing (CR 701.63b), so the amount is checked as the action is carried out
    const out = carry(step, isPositive(n) ? [choose] : [{ op: 'if', cond: { cond: 'compare', left: n, op: '>', right: 0 }, then: [choose] }]);
    return withMaySpan(out, question);
  },
};

/** The produced steps with the prompt of their `may` step replaced (carry() stamps the action's own words on every step; they don't say what "yes" does). */
function withMaySpan(steps: EffectStep[], span: string): EffectStep[] {
  const fix = (st: EffectStep): EffectStep => {
    if (st.op === 'may') return { ...st, span };
    if (st.op === 'if') return { ...st, then: st.then.map(fix), ...(st.else ? { else: st.else.map(fix) } : {}) };
    return st;
  };
  return steps.map(fix);
}

const RETURN_TAPPED: EffectStep = { op: 'move', what: { ref: 'event', role: 'subject' }, to: { zone: 'battlefield', controller: { ref: 'you' }, tapped: true } };

/**
 * CR 701.66a: "Earthbend N" means "Target land you control becomes a 0/0 land creature with haste in addition to its other types. Put N +1/+1 counters on it.
 * When that land dies or is put into exile, return it to the battlefield tapped under your control." The target is announced by the ability that says
 * "earthbend N" (parser/lower/targets.ts places "target land you control" at the word "earthbend"), so the step's `subject` names it. The effect has no
 * duration (CR 611.2a; it ends when the land leaves, CR 400.7). The delayed triggered ability (CR 603.7) triggers once, the next time that land dies (a creature
 * put into a graveyard from the battlefield, CR 700.4) or is put into exile from the battlefield; it is split in two records with one event each, and only one
 * can ever trigger (the land leaves the battlefield once, CR 400.7). "Return it" is the card in its new zone (CR 603.6, 603.7c), "you" the player who
 * earthbent (CR 603.7d-e: the controller of the delayed ability).
 */
export const EARTHBEND: ActionMacro = {
  name: 'earthbend',
  rule: 'CR 701.66',
  expand: (step) => {
    if (step.subject === undefined) return manualAction(step, 'earthbend needs its target land (CR 701.66a)');
    if (step.n === undefined) return manualAction(step, 'earthbend needs its number N');
    const land = step.subject;
    const it = land as ObjRef; // the target land (an object reference: `subject` is never a player here)
    return carry(step, [
      {
        op: 'effect',
        duration: { d: 'permanent' },
        effects: [{
          s: 'continuous',
          affects: land,
          mods: [
            { layer: 4, types: { add: ['Creature'] } },
            { layer: 6, add: [{ kind: 'keyword', keyword: 'haste', text: 'haste' }] },
            { layer: '7b', power: 0, toughness: 0 },
          ],
        }],
      },
      { op: 'putCounters', on: land, kind: '+1/+1', count: step.n },
      { op: 'delay', when: { at: 'event', event: { ev: 'zoneChange', subject: { is: it, types: ['Creature'] }, from: 'battlefield', to: 'graveyard' } }, do: [RETURN_TAPPED] },
      { op: 'delay', when: { at: 'event', event: { ev: 'zoneChange', subject: { is: it }, from: 'battlefield', to: 'exile' } }, do: [RETURN_TAPPED] },
      // std-mana-12 (CR 603.2): the player earthbent ("whenever you earthbend", Avatar Aang)
      { op: 'reportAction', who: step.who, verb: 'earthbend' },
    ]);
  },
};

/**
 * The tokens "empower <type> N" creates when you control no <type> token, by planeswalker type, from the reminder text of the cards that say it (Edge of Eternities
 * and Aetherdrift Jace cards: "create a blue Jace planeswalker token with '[−1]: Surveil 1' and '[−3]: Draw a card.'"). Not legendary, no stated name ("Jace
 * Token", CR 111.4), no printed loyalty: it enters with no loyalty counters (CR 306.5b) and gets them from the empower instruction right away, before state-based
 * actions are checked (CR 704.3).
 */
const EMPOWER_TOKENS: Readonly<Record<string, TokenDef>> = {
  Jace: {
    colors: ['U'],
    types: ['Planeswalker'],
    subtypes: ['Jace'],
    abilities: [
      { kind: 'activated', text: '-1: Surveil 1.', cost: { loyalty: -1 }, isLoyalty: true, effect: { targets: [], steps: [{ op: 'surveil', who: { ref: 'you' }, count: 1 }] } },
      { kind: 'activated', text: '-3: Draw a card.', cost: { loyalty: -3 }, isLoyalty: true, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] } },
    ],
  },
};

/**
 * "Empower Jace N", CR 701.71a (2026-09-25 edition; first built from the reminder text, which says the same): "If you don't control a Jace planeswalker token,
 * create a blue Jace planeswalker token with 0 loyalty, '[−1]: Surveil 1,' and '[−3]: Draw a card.' Choose a Jace planeswalker token you control. Put N loyalty
 * counters on it." With several Jace tokens the player chooses one. Counters are put with the proposal pipeline (CR 122.1, 614.16), so "N" may be 0.
 */
export const EMPOWER: ActionMacro = {
  name: 'empower',
  rule: 'CR 701.71a',
  expand: (step) => {
    const token = step.arg !== undefined ? EMPOWER_TOKENS[step.arg] : undefined;
    if (step.n === undefined || step.arg === undefined || token === undefined) return manualAction(step, 'empower needs a planeswalker type whose token this build knows (Jace) and a number');
    const mine: ObjectFilter = { subtypes: [step.arg], token: true, controller: 'you' };
    const chosen = { ref: 'bound', name: '_empowered' } as const;
    return carry(step, [
      { op: 'if', cond: { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: mine } } }, then: [{ op: 'createToken', who: step.who, token, count: 1 }] },
      { op: 'chooseObjects', who: step.who, from: { ref: 'each', filter: mine }, min: 1, max: 1, as: '_empowered' },
      { op: 'putCounters', on: chosen, kind: 'loyalty', count: step.n },
    ]);
  },
};
