/**
 * Your party (CR 700.8). Owner: T38 (FAST5). Lives in statics/ so the layer evaluator (statics/match.ts) and the interpreter (effects/eval.ts) share it; it imports
 * only types (design 5.4).
 *
 * "Your party consists of up to one each of Cleric, Rogue, Warrior, and Wizard" among the creatures you control (CR 700.8a), and "a creature that's more than
 * one of those types can fill only one of those slots, and which slot it fills is chosen so the party is as large as possible" (the reminder and CR 700.8b).
 * So the size of the party is the largest set of creatures that can each be given a different one of the four types they have: a maximum bipartite matching
 * between creatures and the four slots. A creature with changeling has every creature type (CR 702.73a) and can fill any slot. Pure: it reads only the
 * characteristics it is given, so the layer evaluator and the interpreter agree.
 */
import type { Chars } from '../rules/characteristics';
import { hasEveryCreatureType, isNonCreatureSubtype } from './subtypes';

/** The four party slots, in the order CR 700.8a lists them. */
export const PARTY_TYPES: readonly string[] = ['Cleric', 'Rogue', 'Warrior', 'Wizard'];

/** The creature types of one creature: every one of them (changeling, CR 702.73a), or these. */
export interface PartyCreature {
  all: boolean;
  set: ReadonlySet<string>;
}

/**
 * The creature types of a creature's characteristics (the creature subtypes, and whether it has every one of them). trek-10: a changeling that "becomes a
 * Klingon" has the keyword and only that type (Maskwood Nexus ruling, 2021-02-05), so "every one of them" is read from the computed subtypes.
 */
export const partyCreatureOf = (c: Chars): PartyCreature => ({
  all: hasEveryCreatureType(c.subtypes),
  set: new Set(c.subtypes.filter((t) => !isNonCreatureSubtype(t))),
});

/** The number of party slots the creatures can fill at once (0 to 4). */
export function partySize(creatures: readonly PartyCreature[]): number {
  const fits = creatures.map((c) => PARTY_TYPES.map((t) => c.all || c.set.has(t)));
  const owner: number[] = PARTY_TYPES.map(() => -1); // slot -> the creature filling it
  const place = (i: number, seen: boolean[]): boolean => {
    for (let slot = 0; slot < PARTY_TYPES.length; slot++) {
      if (!fits[i]![slot] || seen[slot]) continue;
      seen[slot] = true;
      if (owner[slot] === -1 || place(owner[slot]!, seen)) {
        owner[slot] = i;
        return true;
      }
    }
    return false;
  };
  let size = 0;
  for (let i = 0; i < creatures.length && size < PARTY_TYPES.length; i++) if (place(i, PARTY_TYPES.map(() => false))) size++;
  return size;
}
