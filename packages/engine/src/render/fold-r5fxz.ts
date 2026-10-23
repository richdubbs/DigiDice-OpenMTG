/**
 * Standard round 5, r5-fxz: the folds of its templates (parser/templates/zz-cloud/r5-fxz.json), called from render/fold.ts#foldAt.
 *
 * `instructionChoice`: "return an enchantment card from your graveyard to your hand or unlock a locked door of a Room you control" (CR 608.2d; the template
 * eff.r5fxz.instructionChoice.orUnlock names the second instruction, so no other "or" of a sentence is read as a choice): the controller
 * chooses one of two instructions as the ability resolves (`chooseValue` among the options "first" and "second", CR 608.2d; an impossible instruction is not offered, effects/handlers/choose.ts#impossibleInstructions), then one `if` per
 * option, in that order, with that instruction. The fold applies only when every part is exactly that and nothing after it reads the choice.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt } from './text';

export const INSTRUCTION_CHOICE = ['first', 'second'] as const;
export const INSTRUCTION_CHOICE_LINK = 'instructionChoice';

function instructionChoice(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'chooseValue' || c.link !== INSTRUCTION_CHOICE_LINK || c.guard !== undefined || c.what !== 'option' || c.min !== undefined || c.max !== undefined) return null;
  if (c.who.ref !== 'you' || JSON.stringify(c.options) !== JSON.stringify(INSTRUCTION_CHOICE)) return null;
  const branches: EffectStep[][] = [];
  for (let k = 0; k < INSTRUCTION_CHOICE.length; k++) {
    const b = list[i + 1 + k];
    if (b?.op !== 'if' || b.else !== undefined || b.guard !== undefined || b.as !== undefined || b.then.length === 0) return null;
    if (b.cond.cond !== 'chosen' || b.cond.link !== c.link || b.cond.equals !== INSTRUCTION_CHOICE[k]) return null;
    branches.push(b.then);
  }
  if (JSON.stringify(list.slice(i + 1 + INSTRUCTION_CHOICE.length)).includes(`"${INSTRUCTION_CHOICE_LINK}"`)) return null;
  const [a, b] = branches.map((steps) => K.steps(steps, st));
  return { clauses: [plain(`${a} or ${b}`)], consumed: 1 + INSTRUCTION_CHOICE.length };
}

/**
 * "unlock a locked door of a Room you control" (CR 709.5f): the controller chooses one Room they control with a locked door as the ability resolves (not a target),
 * then unlocks one of its locked doors (effects/handlers/levels.ts, 'unlockDoor'). Only that exact choice of one, and nothing after it reads the chosen Room.
 */
function unlockRoomYouControl(list: EffectStep[], i: number): Folded | null {
  const c = list[i];
  const d = list[i + 1];
  if (c?.op !== 'chooseObjects' || c.guard !== undefined || c.who.ref !== 'you' || c.min !== 1 || c.max !== 1 || c.random !== undefined || c.groupLimit !== undefined || c.perPlayer !== undefined) return null;
  if (JSON.stringify(c.from) !== JSON.stringify({ ref: 'each', filter: { subtypes: ['Room'], controller: 'you', lockedDoor: true } })) return null;
  if (d?.op !== 'designateObject' || d.designation !== 'unlockDoor' || d.guard !== undefined || d.as !== undefined || JSON.stringify(d.what) !== JSON.stringify({ ref: 'bound', name: c.as })) return null;
  if (JSON.stringify(list.slice(i + 2)).includes(`"name":"${c.as}"`)) return null;
  return { clauses: [plain('unlock a locked door of a Room you control')], consumed: 2 };
}

const CREATURE_YOU_CONTROL = JSON.stringify({ ref: 'each', filter: { types: ['Creature'], controller: 'you' } });

/**
 * "Return target Aura or Equipment card from your graveyard to the battlefield attached to a creature you control" (CR 303.4f, 301.5c, 110.2): the creature is
 * chosen as the card enters, not targeted (`chooseObjects` of one creature you control, then the move `attachedTo` it; with none, an Aura stays where it is and
 * an Equipment enters unattached, effects/handlers/zones-move.ts). Only that exact choice, read by nothing after the move.
 */
function attachedToCreatureYouControl(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const m = list[i + 1];
  if (c?.op !== 'chooseObjects' || c.guard !== undefined || c.who.ref !== 'you' || c.min !== 1 || c.max !== 1 || c.random !== undefined || c.groupLimit !== undefined || c.perPlayer !== undefined) return null;
  if (JSON.stringify(c.from) !== CREATURE_YOU_CONTROL || m?.op !== 'move' || m.guard !== undefined || m.until !== undefined || m.to.zone !== 'battlefield') return null;
  if (JSON.stringify(m.to.attachedTo) !== JSON.stringify({ ref: 'bound', name: c.as }) || JSON.stringify(list.slice(i + 2)).includes(`"name":"${c.as}"`)) return null;
  const { attachedTo: _host, ...to } = m.to;
  const plainMove = K.clause({ ...m, to } as EffectStep, st);
  const tail = ' attached to a creature you control';
  return { clauses: [{ ...plainMove, imp: `${plainMove.imp}${tail}`, sub: `${plainMove.sub}${tail}` }], consumed: 2 };
}

/**
 * "each opponent chooses a creature they control and exiles it" (CR 608.2d, 608.2f, 101.4): one opponent at a time chooses one of the permanents of the
 * description they control and exiles it (`forEach` over the opponents, a `chooseObjects` by that opponent among their own permanents, then the move). Only that
 * exact body, read by nothing after it.
 */
function eachOpponentExilesOne(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || JSON.stringify(f.over) !== JSON.stringify({ ref: 'each', who: 'opponent' }) || f.do.length !== 2) return null;
  const [c, m] = f.do as [EffectStep, EffectStep];
  const me = JSON.stringify({ ref: 'bound', name: f.as });
  if (c.op !== 'chooseObjects' || c.guard !== undefined || JSON.stringify(c.who) !== me || c.min !== 1 || c.max !== 1 || c.random !== undefined || c.groupLimit !== undefined || c.perPlayer !== undefined) return null;
  if (c.from.ref !== 'each' || !('filter' in c.from)) return null;
  const { controller, anyOf, ...rest } = c.from.filter;
  if (JSON.stringify(controller) !== me || anyOf === undefined || anyOf.length !== 1 || Object.keys(rest).length > 0) return null;
  if (m.op !== 'move' || m.guard !== undefined || m.until !== undefined || m.as !== undefined || JSON.stringify(m.what) !== JSON.stringify({ ref: 'bound', name: c.as }) || JSON.stringify(m.to) !== JSON.stringify({ zone: 'exile' })) return null;
  if (JSON.stringify(list.slice(i + 1)).includes(`"name":"${c.as}"`)) return null;
  return { clauses: [plain(`each opponent chooses ${K.np(anyOf[0]!, st, { det: 'a' })} they control and exiles it`)], consumed: 1 };
}

/**
 * "Look at the top two cards of your library. Exile one of them and put the other into your hand." (CR 401.2, 608.2c, 406.1): one of the cards the look showed,
 * chosen by the player who looked, is exiled, and the others (the looked-at cards still in the library) go to the hand. As render/fold.ts#onePutOtherGraveyard,
 * with the exile first.
 */
function exileOneOtherHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, x, h] = [list[i], list[i + 1], list[i + 2]];
  if (c?.op !== 'chooseObjects' || x?.op !== 'move' || h?.op !== 'move' || c.who.ref !== 'you' || c.guard !== undefined || x.guard !== undefined || h.guard !== undefined) return null;
  if (c.random === true || c.min !== 1 || c.max !== 1 || c.from.ref !== 'bound' || JSON.stringify(x.what) !== JSON.stringify({ ref: 'bound', name: c.as })) return null;
  // the others are the looked-at cards still in the library: the exiled one is found in exile by the binding (CR 400.7j, effects/refs.ts#rebase)
  if (JSON.stringify(h.what) !== JSON.stringify({ ref: 'each', filter: { is: { ref: 'bound', name: c.from.name }, zone: 'library' } }) || x.until !== undefined || h.until !== undefined || x.as !== undefined || h.as !== undefined) return null;
  if (JSON.stringify(x.to) !== JSON.stringify({ zone: 'exile' }) || JSON.stringify(h.to) !== JSON.stringify({ zone: 'hand' })) return null;
  const looked = st.info.get(`b:${c.from.name}`);
  if (looked === undefined || !looked.plural || looked.zone !== 'library') return null;
  if (JSON.stringify(list.slice(i + 3)).includes(`"${c.as}"`) || JSON.stringify(list.slice(i + 3)).includes(`"${c.from.name}"`)) return null;
  return { clauses: [plain(`exile ${alt('one of them', 'one of those cards')} and put the other into your hand`)], consumed: 3 };
}

export function foldR5Fxz(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return instructionChoice(list, i, st) ?? unlockRoomYouControl(list, i) ?? attachedToCreatureYouControl(list, i, st) ?? eachOpponentExilesOne(list, i, st) ?? exileOneOtherHand(list, i, st);
}
