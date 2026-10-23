/**
 * The "instead of a graveyard" rider of a cast permission (CR 614.1a, 400.7). Owner: r5-repl.
 *
 * "Exile target instant or sorcery card from an opponent's graveyard. You may cast it this turn, and mana of any type can be spent to cast that spell. If that
 * spell would be put into a graveyard, exile it instead." (Nita, Forum Conciliator). The permission's `graveyardInstead` (types/ability.ts#PermissionDef) is
 * recorded on the spell as it is cast with that permission (actions/cast.ts: `StackInfo.permitGraveyardInstead`), so it is a fact of that spell, not of the
 * permission's source: it applies even if the source has left the battlefield or the permission has ended by then. It is a replacement effect that changes
 * where the spell goes when it would be put into a graveyard from the stack (CR 614.1a), as it resolves (CR 608.2n) or when it is countered (CR 701.6a),
 * offered to the proposal pipeline with the other replacement effects (CR 616.1: the spell's owner orders it among them; CR 614.5: once). Nothing else: a copy
 * of the spell was not cast (CR 707.10), a permanent spell that resolves becomes a permanent that is a new object (CR 400.7), and the card put anywhere other
 * than a graveyard is not affected.
 */
import type { ReplacementDef } from '../../types/ability';
import type { Candidate } from '../replacements';
import type { RuleReplacement } from '../registries';

export const permitGraveyardReplacement: RuleReplacement = (g, e) => {
  if (e.ev !== 'zoneChange' || e.to !== 'graveyard' || e.object.zone !== 'stack') return [];
  const o = g.s.objects[e.object.id];
  const info = o?.stack;
  if (!o || o.zone !== 'stack' || !info || info.kind !== 'spell' || info.isCopy === true || info.permitGraveyardInstead === undefined) return [];
  const def = {
    s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, from: 'stack', to: 'graveyard' }, body: { b: 'modify', destination: info.permitGraveyardInstead.to },
  } as ReplacementDef;
  const c: Candidate = {
    id: `rule:permitGraveyard:${o.id}`, def, source: { id: o.id, zone: 'stack' }, klass: 4, // CR 616.1e
    sourceName: `cast with ${info.permitGraveyardInstead.source}`, controller: o.controller,
  };
  return [c];
};

export const PERMIT_GRAVEYARD_RULE_REPLACEMENTS: readonly RuleReplacement[] = [permitGraveyardReplacement];
