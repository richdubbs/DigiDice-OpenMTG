/**
 * Delve (CR 702.66a): "For each generic mana in this spell's total cost, you may exile a card from your graveyard rather than pay that mana." It is not an
 * additional or alternative cost and applies only after the total cost is determined (CR 702.66b); several instances are redundant (CR 702.66c: the keyword set
 * holds the name once). A card exiled this way pays for generic mana only, never for colored mana.
 *
 * std-tdm: like improvise (keywords/hooks/improvise.ts), the hook describes the CAPACITY of the option (how much generic mana the cards in the caster's graveyard
 * could pay for); rules/payment-options.ts#applyPaymentOptions lets the caster name the cards and pays them as an `exileFrom` part (CR 601.2g-h). The spell itself
 * is on the stack while it is cast (CR 601.2a), so it is never one of them, even when it is cast from the graveyard.
 */
import { hasKeyword } from '../../rules/characteristics';
import type { KeywordHooks, PaymentOption } from '../types';
import { charsOfId, objectOf } from './common';

export const delveHooks: Pick<KeywordHooks, 'paymentOptions'> = {
  paymentOptions(g, spell, caster): PaymentOption[] {
    const spellChars = charsOfId(g, spell);
    if (spellChars === null || objectOf(g, spell) === undefined || !hasKeyword(spellChars, 'delve')) return [];
    const cards = (g.s.zones.graveyard[caster] ?? []).filter((id) => id !== spell).length;
    if (cards === 0) return [];
    return [
      {
        key: 'delve',
        describe: 'Exile cards from your graveyard: each pays for {1}.',
        reduces: { generic: cards },
        cost: { other: [{ kind: 'exileFrom', zone: 'graveyard', count: 'any' }] },
      },
    ];
  },
};
