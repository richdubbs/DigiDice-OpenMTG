/**
 * edh-d-91 ADDITION (Commander coordinator D, group combat): `BatExiledReturnQuote`, the quoted ability Timothar, Baron of Bats gives its Bat token (CR 603.1, 607.1, 607.2a, 613.1f; ruling
 * 2021-11-19): "When this token deals combat damage to a player, sacrifice it and return the exiled card to the battlefield tapped." Value: a list of that one triggered ability, whose "the exiled
 * card" is the card the granting ability exiled in the SAME resolution (the bound name `exiledCard` of template eff.edhd91.mayPayExileIt.batToken.gainsReturnQuote; effects/handlers/lasting-fix.ts
 * fixes it to that card as the granting effect is created, so each Bat returns only its own card). Only this exact quote (fail closed).
 */
import type { AbilityDef } from '../../types/ability';
import type { Alt, HoleFn } from './core';

const WORDS = 'when ~ deals combat damage to a player , sacrifice it and return the exiled card to the battlefield tapped .';

/** The bound name the granting template gives the exiled card (eff.edhd91.mayPayExileIt.batToken.gainsReturnQuote). */
export const BAT_EXILED_NAME = 'exiledCard';

export const batExiledReturnQuote: HoleFn = (ctx, pos) => {
  const t = ctx.toks[pos];
  if (t?.kind !== 'QUOTE' || t.sub === undefined) return [];
  if (t.sub.map((x) => x.norm).join(' ') !== WORDS) return [];
  const ability: AbilityDef = {
    kind: 'triggered',
    text: 'When this token deals combat damage to a player, sacrifice it and return the exiled card to the battlefield tapped.',
    trigger: { on: [{ ev: 'damage', source: { self: true }, combat: true, recipient: { player: 'any' } }] },
    effect: {
      targets: [],
      steps: [
        { op: 'sacrifice', what: { ref: 'event', role: 'source' } },
        { op: 'move', what: { ref: 'bound', name: BAT_EXILED_NAME }, to: { zone: 'battlefield', controller: { ref: 'you' }, tapped: true } },
      ],
    },
  } as AbilityDef;
  return [{ end: pos + 1, value: [ability] } satisfies Alt];
};
