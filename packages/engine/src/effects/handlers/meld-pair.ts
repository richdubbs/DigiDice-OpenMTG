/**
 * MX2: the meld instruction of the meld cards, "exile them, then meld them into <result>" (CR 701.42a, 712.4a), after "if you both own and control ~ and a
 * <type> named <its meld partner>" (Gisela, Graf Rats, Hanweir Battlements, Urza, Titania, Vanille; CR 603.4 for the intervening "if"). Owner: MX2.
 *
 * Step: `{op:'action', action:'meldPair', who, arg: <the result's name>}` (template eff.mx2.meld.pair, zz-fast4/mx2.json). "Them" is this object and ONE
 * permanent named its meld partner (the definition's `meld.partner`, CR 201.2) of the partner's card type that the player owns and controls, the one the
 * condition named: with several, the player chooses which (one creature named Bruna, not every one). Both are exiled by the ordinary `move` step (one event,
 * the replacement effects apply), then melded by the meld action (effects/handlers/dfc-ops.ts): a token or a copy that is not the partner card can't be
 * melded and stays exiled (CR 701.42b-c). Never a function per card: the partner and the result are the card's own meld data.
 */
import type { CardType } from '../../types/card';
import type { EffectStep } from '../../types/ability';
import { charsOfObject } from '../../rules/characteristics';
import type { StepHandler } from '../api';
import { runSteps } from '../run';
import { bindAs, byHand, firstPlayer, NOTHING } from './zones-util';

type ActionStep = Extract<EffectStep, { op: 'action' }>;

/** Capability names (`feature:action.native.<name>`) of the native action of this module. */
export const MELD_PAIR_FEATURES: readonly string[] = ['action.native.meldPair'];

/** The card types a meld partner is named by in its pair's condition ("a creature named", "a land named", "an artifact named"). */
const PARTNER_TYPES: readonly CardType[] = ['Creature', 'Land', 'Artifact', 'Enchantment', 'Planeswalker'];

const PARTNER = '\u0000meldPartner';
const BOTH = '\u0000meldPair';

const meldPair: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  const player = firstPlayer(cx, st.who);
  const self = g.s.objects[cx.source.id];
  if (player === undefined) return NOTHING;
  if (!self || cx.source.zone !== 'battlefield' || self.zone !== 'battlefield' || self.phasedOut) {
    g.log(`Nothing is melded: ${g.nameOf(cx.source.id)} is no longer on the battlefield.`, { rules: ['CR 701.42a', 'CR 400.7'], level: 'info' });
    return NOTHING;
  }
  const meld = g.s.defs[self.defId]?.meld;
  if (meld?.partner === undefined || meld.result === undefined || meld.isResult === true) return byHand(cx, st, `${g.nameOf(self.id)} is not a meld card with a partner (CR 712.4)`);
  if (st.arg !== undefined && st.arg !== meld.result) return byHand(cx, st, `${g.nameOf(self.id)} and its partner meld into ${meld.result}, not ${st.arg} (CR 701.42b)`);
  const partnerDef = g.s.defs[meld.partner];
  const partnerTypes = (partnerDef?.faces[0]?.types ?? []).filter((t) => PARTNER_TYPES.includes(t));
  if (partnerTypes.length === 0) return byHand(cx, st, `the definition of ${meld.partner} is not loaded in this game (m6 design E18)`);
  const candidates = g.s.zones.battlefield.filter((id) => {
    if (id === self.id) return false;
    const o = g.s.objects[id];
    if (!o || o.phasedOut || o.owner !== player || o.controller !== player) return false;
    const c = charsOfObject(g.s, o);
    return c.name === meld.partner && partnerTypes.some((t) => c.types.includes(t));
  });
  if (candidates.length === 0) {
    g.log(`Nothing is melded: ${g.player(player).name} doesn't own and control a permanent named ${meld.partner}.`, { rules: ['CR 701.42a', 'CR 603.4'], level: 'info' });
    return NOTHING;
  }
  const partner = candidates.length === 1 ? candidates[0]! : g.choose({
    kind: 'chooseObjects', player, prompt: `${g.nameOf(self.id)}: choose the ${meld.partner} to exile and meld`, options: candidates, min: 1, max: 1, rules: ['CR 701.42a'],
  }).ids[0]!;
  bindAs(cx, PARTNER, [{ id: partner, zone: 'battlefield' }]);
  return runSteps(cx, [
    { op: 'move', what: { ref: 'union', of: [{ ref: 'self' }, { ref: 'bound', name: PARTNER }] }, to: { zone: 'exile' }, as: BOTH },
    { op: 'action', action: 'meld', subject: { ref: 'bound', name: BOTH }, who: st.who, arg: meld.result },
  ] as EffectStep[]);
};

/** The native action of this module by `ActionMacro.native` name (keywords/actions/meld-pair.ts). */
export const MELD_PAIR_NATIVES: Readonly<Record<string, StepHandler<ActionStep>>> = { meldPair };
