/**
 * FAST5X E11: behold (CR 701.4a): "Behold a [quality]" means "Reveal a [quality] card from your hand or choose a [quality] permanent you control on the
 * battlefield." Step: `{op:'action', action:'behold', who, arg}` with `arg` the quality, one subtype ("you may behold an Elf. If you do, ..."); run through
 * actions-native.ts#NATIVE_ACTIONS (`feature:action.native.behold`). The player picks one of the cards and permanents that have the quality; with none, nothing
 * is beheld and the step is not performed ("if you do" is false; control.ts#cannotStart keeps "you may" from being chosen then, CR 608.2d). The cost form
 * ("As an additional cost to cast this spell, behold a Dragon") is the `behold` cost part (rules/pay-parts.ts). Owner: FAST5X E11.
 */
import type { GameState } from '../../types/state';
import type { EffectStep } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import { findObjects } from '../../rules/filter';
import { filterCtxOutside } from '../../rules/filter-env';
import type { StepHandler } from '../api';
import { performAction } from '../perform';
import { firstPlayer, NOTHING } from './zones-util';

type ActionStep = Extract<EffectStep, { op: 'action' }>;

/** Capability names (`feature:action.native.<name>`) of the native action of this module. */
export const BEHOLD_FEATURES: readonly string[] = ['action.native.behold'];

/** CR 701.4a: the permanents `player` controls and the cards in their hand that have the subtype `quality`. */
export function beholdCandidates(s: GameState, player: PlayerId, quality: string): ObjectId[] {
  const ctx = filterCtxOutside(s, { controller: player, x: null });
  return [
    ...findObjects(s, { subtypes: [quality], zone: 'battlefield', controller: 'you' }, ctx).filter((o) => !o.phasedOut).map((o) => o.id),
    ...findObjects(s, { subtypes: [quality], zone: 'hand', owner: 'you' }, ctx).map((o) => o.id),
  ];
}

const behold: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  const player = firstPlayer(cx, st.who);
  if (player === undefined || st.arg === undefined) return NOTHING;
  const options = beholdCandidates(g.s, player, st.arg);
  const name = g.player(player).name;
  if (options.length === 0) {
    g.log(`${name} has no ${st.arg} to behold.`, { rules: ['CR 701.4a'], level: 'info' });
    return NOTHING;
  }
  const id = g.choose({
    kind: 'chooseObjects', player, prompt: `Behold a ${st.arg}: choose one you control or reveal one from your hand.`, options, min: 1, max: 1, rules: ['CR 701.4a'],
  }).ids[0] ?? options[0]!;
  const o = g.s.objects[id];
  if (o?.zone === 'hand') {
    performAction(g, { verb: 'reveal', actor: player, objectId: id });
    g.log(`${name} reveals ${g.nameOf(id)} from their hand to behold it.`, { rules: ['CR 701.4a', 'CR 701.20a'], level: 'info' });
  } else g.log(`${name} beholds ${g.nameOf(id)}.`, { rules: ['CR 701.4a'], level: 'info' });
  performAction(g, { verb: 'behold', actor: player, objectId: id });
  return { performed: true, count: 1 };
};

export const BEHOLD_NATIVES: Readonly<Record<string, StepHandler<ActionStep>>> = { behold };
