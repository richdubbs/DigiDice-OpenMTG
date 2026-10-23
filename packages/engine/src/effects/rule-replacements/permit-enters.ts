/**
 * The "enters with" rider of a graveyard permission (CR 614.1c). Owner: C10.
 *
 * "You may cast artifact spells from your graveyard ... If you cast a spell this way, that artifact enters with a finality counter on it." (Noctis, Prince of
 * Lucis), "You may cast this card from your graveyard. If you do, it enters with a finality counter on it." The permission's `entersWith`
 * (types/ability.ts#PermissionDef) is recorded on the spell as it is cast (actions/cast.ts: `StackInfo.permitEnters`), so it is a fact of that spell, not
 * of the permission's source: the permanent the spell becomes enters with those counters even if the source has left the battlefield by then (the effect
 * applies to the spell "cast this way"). It is a replacement effect that modifies how the permanent enters (CR 614.1c), offered to the proposal pipeline with
 * the other replacement effects (CR 616.1: the controller of the permanent orders it among them; CR 614.5: once) as the permanent spell resolves and enters
 * from the stack (CR 608.3a). Nothing else: a copy of the spell was not cast (CR 707.10), the spell put anywhere else is not the permanent it became, and a
 * permanent that later re-enters is a new object (CR 400.7).
 */
import type { ReplacementDef } from '../../types/ability';
import type { Candidate } from '../replacements';
import type { RuleReplacement } from '../registries';

export const permitEntersReplacement: RuleReplacement = (g, e) => {
  if (e.ev !== 'zoneChange' || e.to !== 'battlefield' || e.object.zone !== 'stack') return [];
  const o = g.s.objects[e.object.id];
  const info = o?.stack;
  if (!o || o.zone !== 'stack' || !info || info.kind !== 'spell' || info.isCopy === true || info.permitEnters === undefined) return [];
  const def = {
    s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', counters: info.permitEnters.counters, ...(info.permitEnters.subtypes !== undefined ? { subtypes: info.permitEnters.subtypes } : {}) },
  } as ReplacementDef;
  const c: Candidate = {
    id: `rule:permitEnters:${o.id}`, def, source: { id: o.id, zone: 'stack' }, klass: 4, // CR 616.1e
    sourceName: `cast with ${info.permitEnters.source}`, controller: o.controller,
  };
  return [c];
};

export const PERMIT_ENTERS_RULE_REPLACEMENTS: readonly RuleReplacement[] = [permitEntersReplacement];
