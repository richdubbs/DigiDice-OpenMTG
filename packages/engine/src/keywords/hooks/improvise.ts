/**
 * Improvise (CR 702.126a): "For each generic mana in this spell's total cost, you may tap an untapped artifact you control rather than pay that mana." It is not
 * an additional or alternative cost and applies only after the total cost is determined (CR 702.126b); several instances are redundant (CR 702.126c: the
 * keyword set holds the name once). Tapping an artifact this way is not a {T} cost (CR 302.6 concerns only the creature's own {T} abilities), so a summoning-sick
 * artifact creature may help. Artifacts pay for generic mana only, never for colored mana.
 *
 * FAST5X E26: like convoke (keywords/hooks/convoke.ts), the hook describes the CAPACITY of the option (how much generic mana the untapped artifacts could pay
 * for); rules/payment-options.ts#applyPaymentOptions lets the caster name the artifacts and pays them as a `tapUntapped` part (CR 601.2g-h).
 */
import { charsOfObject, hasKeyword } from '../../rules/characteristics';
import type { KeywordHooks, PaymentOption } from '../types';
import { charsOfId, objectOf } from './common';

export const improviseHooks: Pick<KeywordHooks, 'paymentOptions'> = {
  paymentOptions(g, spell, caster): PaymentOption[] {
    const spellChars = charsOfId(g, spell);
    if (spellChars === null || objectOf(g, spell) === undefined || !hasKeyword(spellChars, 'improvise')) return [];
    let artifacts = 0;
    for (const id of g.s.zones.battlefield) {
      const p = g.s.objects[id];
      if (p === undefined || p.controller !== caster || p.tapped || p.phasedOut) continue;
      if (charsOfObject(g.s, p).types.includes('Artifact')) artifacts += 1;
    }
    if (artifacts === 0) return [];
    return [
      {
        key: 'improvise',
        describe: 'Tap untapped artifacts you control: each pays for {1}.',
        reduces: { generic: artifacts },
        cost: { other: [{ kind: 'tapUntapped', filter: { types: ['Artifact'], controller: 'you' }, count: 'any' }] },
      },
    ];
  },
};
