/**
 * FAST5X E28: the keyword action "forage" as an effect (CR 701.61a), run by the `action` op through actions-native.ts#NATIVE_ACTIONS. Owner: FAST5X E28.
 * Step: `{op:'action', action:'forage', who}`.
 *
 *  - CR 701.61a: to forage means "exile three cards from your graveyard or sacrifice a Food". The player chooses which, among the ones they can do (three
 *    cards a "can't" effect lets them exile, a Food it lets them sacrifice: rules/cost.ts#forageOptions, CR 614.17b), then the cards or the Food. Each card
 *    moves through the proposal pipeline (a replacement may change where it goes).
 *  - A player who can do neither can't forage: nothing happens and the step is not performed, so "if you do" is false; "you may forage" is not even offered
 *    then (effects/handlers/control.ts#cannotStart, CR 608.2d).
 *  - Foraging emits the `forage` action of the player (as paying it as a cost does, rules/pay-parts.ts), which "whenever you forage" matches
 *    (`{ev:'action', verb:'forage'}`).
 *
 * `as` binds the exiled cards or the sacrificed Food (where they went).
 */
import type { EffectStep } from '../../types/ability';
import type { PlayerId } from '../../types/ids';
import type { GameState, ObjHandle } from '../../types/state';
import { forageOptions } from '../../rules/cost';
import type { StepHandler } from '../api';
import { performAction } from '../perform';
import { bindAs, did, firstPlayer, NOTHING, proposeMove } from './zones-util';

type ActionStep = Extract<EffectStep, { op: 'action' }>;

/** Capability names (`feature:action.native.<name>`) of the native action of this module. */
export const FORAGE_FEATURES: readonly string[] = ['action.native.forage'];

/** CR 701.61a, 608.2d: can `player` forage at all (three cards to exile from their graveyard, or a Food to sacrifice)? */
export function canForage(s: GameState, player: PlayerId): boolean {
  const f = forageOptions(s, player);
  return f.yard.length >= 3 || f.food.length > 0;
}

const forage: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  const player = firstPlayer(cx, st.who);
  if (player === undefined) {
    bindAs(cx, st.as, []);
    return NOTHING;
  }
  const name = g.player(player).name;
  const { yard, food } = forageOptions(g.s, player);
  if (yard.length < 3 && food.length === 0) {
    g.log(`${name} can't forage: they have neither three cards in their graveyard to exile nor a Food to sacrifice.`, { rules: ['CR 701.61a'], level: 'info' });
    bindAs(cx, st.as, []);
    return NOTHING;
  }
  const rules = ['CR 701.61a'];
  let how: 'exile' | 'food' = yard.length >= 3 ? 'exile' : 'food';
  if (yard.length >= 3 && food.length > 0) {
    how = g.choose({
      kind: 'chooseOption', player, prompt: 'Forage: exile three cards from your graveyard or sacrifice a Food.',
      options: [{ id: 'exile', label: 'Exile three cards from your graveyard' }, { id: 'food', label: 'Sacrifice a Food' }], min: 1, max: 1, rules,
    }).ids[0] === 'food' ? 'food' : 'exile';
  }
  const pool = how === 'exile' ? yard : food;
  const count = how === 'exile' ? 3 : 1;
  const ids = pool.length === count ? pool : g.choose({
    kind: 'chooseObjects', player, prompt: how === 'exile' ? 'Forage: choose three cards in your graveyard to exile.' : 'Forage: choose a Food to sacrifice.',
    options: pool, min: count, max: count, rules,
  }).ids;
  const names = ids.map((id) => g.nameOf(id));
  const moved: ObjHandle[] = [];
  for (const id of ids) {
    const from = g.s.objects[id]?.zone;
    if (from === undefined) continue;
    const m = how === 'exile' ? proposeMove(cx, { id, zone: from }, 'exile', { cause: 'exile' }) : proposeMove(cx, { id, zone: from }, 'graveyard', { cause: 'sacrifice' });
    if (m.ok && m.to) moved.push(m.to);
  }
  g.log(`${name} forages: ${how === 'exile' ? 'exiles' : 'sacrifices'} ${names.join(', ')}.`, { rules, level: 'action' });
  performAction(g, { verb: 'forage', actor: player });
  bindAs(cx, st.as, moved);
  return did(1);
};

/** The native action of this module by `ActionMacro.native` name (keywords/actions/index.ts#FORAGE). */
export const FORAGE_NATIVES: Readonly<Record<string, StepHandler<ActionStep>>> = { forage };
