/**
 * M11-1 (m11 design 2, D4): the replacement effect of the Commander rules. Owner: M11-1.
 *
 * CR 903.9b: "If a commander would be put into its owner's hand or library from anywhere, its owner may put it into the command zone instead. This replacement
 * effect may apply more than once to the same event. This is an exception to rule 614.5." It is a candidate like any other replacement effect (CR 616.1: the
 * affected object's controller orders it with the others), class 4 (CR 616.1e). Its owner answers `commanderZone` (rule '903.9b'); yes: the event goes to the
 * command zone with the cause 'commander' (an ordinary `zoneChanged`, m11 design 4.4). Its id names the destination, so after another replacement effect sent
 * the commander from the library to the hand (or back), it is offered again (the exception to CR 614.5), while a declined offer is not asked twice for the
 * same destination.
 *
 * CR 903.9c: a melded or merged commander (CR 903.3b-c): on yes, the event keeps its zone and carries `DestinationFacts.commanderCard`; as the permanent
 * leaves and becomes its cards (core/move-parts/components.ts), that card goes to the command zone (cause 'commander') and every other component where
 * the event sends it.
 */
import type { Game } from '../../core/game';
import type { Proposed } from '../api';
import type { RuleReplacement } from '../registries';
import type { Candidate } from '../replacements';
import { commanderCardOf, isCommander } from '../../statics/commander';

type ZoneChange = Extract<Proposed, { ev: 'zoneChange' }>;

/** CR 903.9b: ask the owner, then send the commander to the command zone instead (or leave the event as it is). */
function toCommandZone(g: Game, e: ZoneChange): Proposed | null {
  const o = g.s.objects[e.object.id];
  const card = o ? commanderCardOf(g.s, o) : undefined;
  if (!o || o.zone !== e.object.zone || card === undefined || (e.to !== 'hand' && e.to !== 'library')) return null;
  const composite = o.components !== undefined && o.components.length > 0;
  const name = composite ? g.s.defs[o.components!.find((c) => c.cardId === card)!.defId]?.name ?? 'your commander' : g.nameOf(o.id);
  const ans = g.choose({
    kind: 'commanderZone', player: o.owner, object: o.id, card, rule: '903.9b', zone: e.to,
    prompt: `Your commander ${name} would be put into your ${e.to}. Put it into the command zone instead?`, rules: ['CR 903.9b', ...(composite ? ['CR 903.9c'] : [])],
  });
  if (!ans.command) return null;
  // The card goes to a public zone face up (CR 903.6 style), so naming it here tells nobody anything the move itself does not.
  g.log(`${g.player(o.owner).name} puts ${name} into the command zone instead of their ${e.to}${composite ? '; the other cards of the permanent go there' : ''}.`, { rules: ['CR 903.9b', 'CR 614.1a', ...(composite ? ['CR 903.9c'] : [])], level: 'action' });
  // CR 903.9c: a melded or merged commander: the permanent and its other components go where the event says, the commander card to the command zone
  if (composite) return { ...e, destination: { ...e.destination, commanderCard: card } };
  return { ...e, to: 'command', destination: { cause: 'commander' } };
}

const commanderZoneReplacement: RuleReplacement = (g, e) => {
  if (e.ev !== 'zoneChange' || (e.to !== 'hand' && e.to !== 'library') || e.from === null) return [];
  const o = g.s.objects[e.object.id];
  if (!o || o.zone !== e.object.zone || !isCommander(g.s, o)) return [];
  // CR 903.9c: a melded or merged commander (CR 903.3b-c) too: its commander card alone goes to the command zone (core/move-parts/components.ts)
  if (commanderCardOf(g.s, o) === undefined) return [];
  const c: Candidate = {
    id: `rule:903.9b:${o.id}:${e.to}`,
    def: { s: 'replace', replaces: { ev: 'zoneChange', subject: { commander: true }, to: e.to }, body: { b: 'modify', destination: { zone: 'command' } }, optional: true },
    source: { id: o.id, zone: o.zone },
    klass: 4,
    sourceName: 'Commander rules (CR 903.9b)',
    controller: o.owner,
    rule: (g2, now) => (now.ev === 'zoneChange' ? toCommandZone(g2, now) : null),
  };
  return [c];
};

export const COMMANDER_RULE_REPLACEMENTS: readonly RuleReplacement[] = [commanderZoneReplacement];
