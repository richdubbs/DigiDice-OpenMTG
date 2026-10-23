/**
 * Shield counters (CR 122.1c). Owner: FAST5X E28.
 *
 * "One or more shield counters on a permanent create a single replacement effect and a single prevention effect that protect the permanent. These effects are
 * 'If this permanent would be destroyed as the result of an effect, instead remove a shield counter from it' and 'If damage would be dealt to this permanent,
 * prevent that damage and remove a shield counter from it.'" They are effects of the RULES, not of an ability (like finality counters, CR 122.1h): losing all
 * abilities doesn't remove them (the official ruling: "shield counters are not keyword counters"), and they last while a counter is there. Each is one candidate
 * of the proposal pipeline however many counters there are (CR 616.1: the affected permanent's controller orders it among the other effects; CR 614.5: it
 * applies at most once to one event).
 *
 *  - Destroyed "as the result of an effect" (CR 701.8a: a `destroy` proposal that is not a state-based action's, CR 704.5g-h): instead one shield counter is
 *    removed and the permanent is not destroyed. An indestructible permanent would not be destroyed at all (CR 702.12b), so nothing is removed. When a
 *    regeneration shield (applied by rules/destroy.ts) could also replace the destruction, its controller chooses which one applies (CR 616.1).
 *  - Damage dealt to it: prevented (CR 615) and one shield counter removed. The rulings: damage that can't be prevented (CR 615.12) is dealt and a counter is
 *    still removed; several counters remove only one. Damage several sources deal to it AT THE SAME TIME (combat damage, CR 510.2) is one occurrence: all of
 *    it is prevented and one counter is removed (effects/funnels.ts#proposeSimultaneous runs the deferred removals after the whole batch, and only the first one
 *    per permanent is scheduled).
 * Sacrifice, "toughness 0" and the legend rule are not destruction and not damage: shield counters don't stop them (the ruling).
 */
import { charsOfObject, hasKeyword } from '../../rules/characteristics';
import { regenerationShieldIndex } from '../../rules/destroy';
import { cantDo } from '../../rules/cant';
import type { Game } from '../../core/game';
import type { ObjectId } from '../../types/ids';
import type { ReplacementBody, ReplacementDef } from '../../types/ability';
import type { Proposed } from '../api';
import { deferAfter, proposeNested } from '../nested';
import type { BodyKind, RuleReplacement } from '../registries';
import type { Candidate } from '../replacements';

/** The counter kind (CR 122.1c); `counter:shield` is registered by model/capabilities.ts from this list. */
export const SHIELD_COUNTER_KINDS: readonly string[] = Object.freeze(['shield']);

const DESTROY_DEF: ReplacementDef = Object.freeze({
  s: 'replace', replaces: { ev: 'action', verb: 'destroy', object: { self: true } }, body: { b: 'shieldCounter' },
}) as ReplacementDef;
const DAMAGE_DEF: ReplacementDef = Object.freeze({
  s: 'replace', replaces: { ev: 'damage', recipient: { self: true } }, body: { b: 'shieldCounter' },
}) as ReplacementDef;

const shielded = (g: Game, id: ObjectId): boolean => {
  const o = g.s.objects[id];
  return o !== undefined && o.zone === 'battlefield' && !o.phasedOut && (o.counters['shield'] ?? 0) > 0;
};

export const shieldReplacement: RuleReplacement = (g, e) => {
  let id: ObjectId;
  let def: ReplacementDef;
  if (e.ev === 'destroy') {
    if (e.stateBased === true || e.object.zone !== 'battlefield') return []; // CR 122.1c: only "as the result of an effect"
    id = e.object.id;
    if (!shielded(g, id) || hasKeyword(charsOfObject(g.s, g.s.objects[id]!), 'indestructible')) return []; // CR 702.12b: it would not be destroyed
    def = DESTROY_DEF;
  } else if (e.ev === 'damage') {
    if (typeof e.to === 'string' || e.to.zone !== 'battlefield') return [];
    id = e.to.id;
    if (!shielded(g, id)) return [];
    def = DAMAGE_DEF;
  } else return [];
  const o = g.s.objects[id]!;
  const c: Candidate = {
    id: `rule:shield:${e.ev}:${id}`, def, source: { id, zone: 'battlefield' }, klass: 4, // CR 616.1e
    sourceName: `the shield counter on ${g.nameOf(id)}`, controller: o.controller,
  };
  return [c];
};

export const SHIELD_RULE_REPLACEMENTS: readonly RuleReplacement[] = [shieldReplacement];

/** The permanents a removal of a shield counter is already scheduled for, while the events of one batch are worked out (see the header). */
const PENDING = new WeakMap<Game, Set<ObjectId>>();

/** Remove one shield counter from the permanent (an event of its own, through the pipeline: CR 122.8-style counters changes, CR 614). */
function removeOne(g: Game, id: ObjectId): void {
  const o = g.s.objects[id];
  if (!o || o.zone !== 'battlefield' || (o.counters['shield'] ?? 0) <= 0) return;
  proposeNested(g, { ev: 'counters', change: 'removed', on: { id, zone: 'battlefield' }, kind: 'shield', count: 1, cause: 'rule' });
  g.log(`A shield counter is removed from ${g.nameOf(id)}.`, { rules: ['CR 122.1c'], level: 'info' });
}

function applyShield(g: Game, e: Proposed, c: Candidate): Proposed | null {
  const id = c.source.id;
  if (e.ev === 'destroy') {
    // CR 616.1: a regeneration shield replaces the same destruction; its controller chooses which applies (the other one then has nothing to replace)
    if (e.canRegenerate && !cantDo(g.s, 'beRegenerated', id) && regenerationShieldIndex(g.s, id) >= 0) {
      const pick = g.choose({
        kind: 'chooseOption', player: c.controller, prompt: `${g.nameOf(id)} would be destroyed. Which effect applies first?`,
        options: [{ id: 'shield', label: 'Remove a shield counter' }, { id: 'regenerate', label: 'Use the regeneration shield' }], min: 1, max: 1, rules: ['CR 616.1', 'CR 122.1c', 'CR 701.19a'],
      }).ids[0];
      if (pick === 'regenerate') return e;
    }
    g.log(`${g.nameOf(id)} is not destroyed: a shield counter is removed from it instead.`, { rules: ['CR 122.1c', 'CR 614.6'], level: 'action' });
    removeOne(g, id);
    return null; // CR 614.6: the destruction never happens
  }
  if (e.ev !== 'damage') return e;
  // the removal: once per permanent for the damage of one batch (several sources at the same time are one occurrence), after the event (CR 615.5 timing)
  let pending = PENDING.get(g);
  if (!pending) PENDING.set(g, (pending = new Set()));
  if (!pending.has(id)) {
    pending.add(id);
    deferAfter(() => {
      PENDING.get(g)?.delete(id);
      removeOne(g, id);
    });
  }
  if (e.unpreventable) {
    g.log(`The damage to ${g.nameOf(id)} can't be prevented; a shield counter is still removed.`, { rules: ['CR 615.12', 'CR 122.1c'], level: 'info' });
    return e;
  }
  g.log(`${e.amount} damage ${g.nameOf(e.source.id)} would deal to ${g.nameOf(id)} is prevented (${c.sourceName}).`, { rules: ['CR 122.1c', 'CR 615.1'], level: 'action' });
  g.emit({ type: 'damagePrevented', effect: c.id, batch: g.events.length, amount: e.amount, source: [e.source.id], target: [id] });
  return null; // CR 615.6, 614.7a: damage prevented entirely never happens
}

export const SHIELD_BODY: BodyKind<Extract<ReplacementBody, { b: 'shieldCounter' }>> = {
  capabilities: ['shieldCounter'],
  fits: (_g, e) => e.ev === 'destroy' || e.ev === 'damage',
  apply: (g, e, _b, c) => applyShield(g, e, c),
};
