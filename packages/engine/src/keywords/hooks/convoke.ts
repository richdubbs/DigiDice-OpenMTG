/**
 * Convoke (CR 702.51a): "For each colored mana in this spell's total cost, you may tap an untapped creature of that color you control rather than pay that
 * mana. For each generic mana in this spell's total cost, you may tap an untapped creature you control rather than pay that mana." It is not an additional or
 * alternative cost and applies only after the total cost is determined (CR 702.51b); tapping a creature this way is not a {T} cost, so summoning sickness does
 * not matter (CR 302.6 concerns only {T} and {Q} costs of the creature's own abilities).
 *
 * The hook describes the CAPACITY of the option: how much generic mana the untapped creatures could pay for and which colors they could pay. Casting (WP7,
 * `paymentOptions` in the payment step, design 8.2) decides how many creatures to tap and applies the reduction.
 */
import { charsOfObject, hasKeyword } from '../../rules/characteristics';
import { sortColors, type Color } from '../../types/mana';
import type { KeywordHooks, PaymentOption } from '../types';
import { charsOfId, objectOf } from './common';

export const convokeHooks: Pick<KeywordHooks, 'paymentOptions'> = {
  paymentOptions(g, spell, caster): PaymentOption[] {
    const spellChars = charsOfId(g, spell);
    if (spellChars === null || objectOf(g, spell) === undefined || !hasKeyword(spellChars, 'convoke')) return [];
    let creatures = 0;
    const colors = new Set<Color>();
    for (const id of g.s.zones.battlefield) {
      const p = g.s.objects[id];
      if (p === undefined || p.controller !== caster || p.tapped || p.phasedOut) continue;
      const c = charsOfObject(g.s, p);
      if (!c.types.includes('Creature')) continue;
      creatures += 1;
      for (const col of c.colors) colors.add(col);
    }
    if (creatures === 0) return [];
    return [
      {
        key: 'convoke',
        describe: "Tap untapped creatures you control: each pays for {1} or for one mana of that creature's color.",
        reduces: { generic: creatures, colors: sortColors(colors) },
        cost: { other: [{ kind: 'tapUntapped', filter: { types: ['Creature'], controller: 'you' }, count: 'any' }] },
      },
    ];
  },
};
