/**
 * Degrading the abilities of ONE card together (design 10.2, 6.7 "linked"). Owner: WP1. Additive to model/api.ts (`degradeAbility` is per ability).
 *
 * Linked abilities (CR 607) read what another ability of the same object produced: Fiend Hunter's leaves-the-battlefield ability returns "the exiled
 * card" that its enters ability exiled. If the PRODUCER becomes manual (a missing capability in its target spec, say), the link store stays empty and the
 * consumer would silently do nothing: the card would look automated and the exiled creature would never come back. So after each ability is degraded on
 * its own, every consumer of a link that no remaining ability produces is made manual too (reason "tainted: ..."), repeatedly, since a tainted consumer may
 * itself have been a producer. The compile pipeline calls this once per face instead of `degradeAbility` per ability.
 *
 * WP20 INTERFACE CHANGE (review): a consumer of a link that NO ability of the face produces (its producer was never understood, so the parser emitted a
 * manual ability that produces nothing) reads nothing just the same (CR 607.1: Pillar of Origins' "creature spell of the chosen type" when "choose a
 * creature type" is manual), so it is tainted too: the links lost are the ones consumed or ever produced that no remaining ability produces.
 */
import type { AbilityDef } from '../types/ability';
import type { CapabilitySet, FaceLines } from './api';
import { degradeAbility, degradeWith } from './degrade';
import { collectLinks, type LinkUse } from './lint-card';

function linksOf(def: AbilityDef): { produced: Set<string>; consumers: LinkUse[] } {
  const producers: LinkUse[] = [];
  const consumers: LinkUse[] = [];
  collectLinks(def, '', producers, consumers);
  return { produced: new Set(producers.map((p) => p.link)), consumers };
}

export interface DegradedAbilities {
  abilities: AbilityDef[];
  /** The capabilities that were missing (the union over the abilities), sorted. */
  requires: string[];
}

/**
 * std-rh (CR 702.167a, 702.167c, 607.2a): the link a face reads from ANOTHER face of the same card. Craft is printed on the front face, which returns the card transformed
 * and remembers the exiled cards in the new permanent's link store ("the exiled card used to craft it", read by the back face). A face that reads it has no producer of
 * its own; a front face whose craft is not understood keeps the whole card from being full (the card's level is its least automated face), so nothing reads a missing link.
 */
const OTHER_FACE_LINKS: ReadonlySet<string> = new Set(['craft']);

export function degradeAbilities(abilities: readonly AbilityDef[], caps: CapabilitySet, lines: FaceLines): DegradedAbilities {
  const first = abilities.map((a) => degradeAbility(a, caps, lines));
  const requires = [...new Set(first.flatMap((r) => r.requires))].sort();
  let current = first.map((r) => r.def);
  const everProduced = new Set(abilities.flatMap((a) => [...linksOf(a).produced]));
  for (let round = 0; round < abilities.length + 1; round++) {
    const stillProduced = new Set(current.flatMap((a) => [...linksOf(a).produced]));
    const consumed = current.flatMap((a) => linksOf(a).consumers.map((c) => c.link));
    const lost = new Set([...everProduced, ...consumed].filter((l) => !stillProduced.has(l) && !OTHER_FACE_LINKS.has(l)));
    if (lost.size === 0) break;
    let changed = false;
    current = current.map((def) => {
      const culprits = linksOf(def).consumers
        .filter((c) => lost.has(c.link))
        .map((c) => ({ path: c.path, taint: `tainted: link "${c.link}" is ${everProduced.has(c.link) ? 'produced by a manual unit' : 'produced by no understood ability'}, so this reads nothing (CR 607.1)` }));
      if (culprits.length === 0) return def;
      changed = true;
      return degradeWith(def, culprits, lines);
    });
    if (!changed) break;
  }
  return { abilities: current, requires };
}
