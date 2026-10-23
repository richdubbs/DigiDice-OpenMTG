/**
 * Miracle (CR 702.94). Owner: FAST5X E26.
 *
 * "Miracle [cost]" is a static ability linked to a triggered ability (CR 603.11): "You may reveal this card from your hand as you draw it if it's the first card
 * you've drawn this turn. When you reveal this card this way, you may cast it by paying [cost] rather than its mana cost." (CR 702.94a).
 *
 *  - The reveal is offered AS the card is drawn (core/zones.ts#drawCard calls the hook installed here), only for the first card the player has drawn this turn
 *    (`turnStats.cardsDrawn`, CR 702.94a; any turn, not only their own), and only while the game is being played (the opening hand is drawn before the first
 *    turn, CR 103.5). The card's miracle abilities are read from its characteristics in the hand, so a miracle ability another object grants ("Each instant
 *    and sorcery card in your hand has miracle {2}", CR 613.1f) counts like a printed one; with several, the player chooses which one they use (each is a
 *    separate static ability with its own linked triggered ability, CR 607.2).
 *  - Revealed, the card is shown to every player (CR 701.20a; core/zones.ts#showCards) and the linked triggered ability triggers (CR 702.94a, 603.2): it goes on
 *    the stack the next time a player would receive priority (CR 603.3), controlled by the player who revealed it. As it resolves, they may cast the card by
 *    paying the miracle cost rather than its mana cost (an alternative cost named "miracle", CR 118.9, 601.2b, 601.2f-h; effects/handlers/tokens-cast.ts),
 *    ignoring timing (CR 608.2g). A card no longer in the hand is a new object (CR 400.7): nothing is cast.
 */
import type { Game } from '../core/game';
import { installDrawHook, showCards } from '../core/zones';
import type { CostDef, KeywordAbilityDef } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import { formatManaCost } from '../types/mana';
import type { PendingTrigger } from '../types/state';
import { charsOfObject } from '../rules/characteristics';
import { reflexiveAbility } from './delayed';

/** The miracle abilities of the card `id` in its owner's hand, as the characteristics there say (printed or granted, CR 613.1f). */
function miracleCosts(g: Game, id: ObjectId): CostDef[] {
  const o = g.s.objects[id];
  if (!o || o.zone !== 'hand' || o.kind !== 'card') return [];
  const out: CostDef[] = [];
  for (const a of charsOfObject(g.s, o).abilities) {
    const d = a.def as KeywordAbilityDef;
    if (d.kind === 'keyword' && d.keyword === 'miracle' && d.cost !== undefined) out.push(d.cost);
  }
  return out;
}

const costText = (c: CostDef): string => (c.mana !== undefined && (c.other ?? []).length === 0 ? formatManaCost(c.mana) : 'its miracle cost');

/** CR 702.94a: `player` has just drawn the card `id`. */
function onDraw(g: Game, player: PlayerId, id: ObjectId): void {
  if (g.s.stage !== 'playing' || g.s.turn.number < 1) return; // CR 103.5: the opening hand is not drawn in a turn
  if (g.player(player).turnStats.cardsDrawn !== 1) return; // CR 702.94a: only the first card drawn this turn
  const costs = miracleCosts(g, id);
  if (costs.length === 0) return;
  const name = g.nameOf(id);
  const ans = g.choose({
    kind: 'chooseOption', player, prompt: `Reveal ${name} for its miracle ability?`, min: 0, max: 1, rules: ['CR 702.94a'],
    options: costs.map((c, i) => ({ id: String(i), label: `Reveal it (miracle ${costText(c)})` })),
  }).ids[0];
  if (ans === undefined) return;
  const cost = costs[Number(ans)] ?? costs[0]!;
  showCards(g, [id], g.s.players.map((p) => p.id)); // CR 702.94b, 701.20a
  g.log(`${g.player(player).name} reveals ${name} as they draw it (miracle).`, { rules: ['CR 702.94a', 'CR 702.94b'], level: 'action' });
  const text = `When you reveal ${name} this way, you may cast it by paying ${costText(cost)} rather than its mana cost.`;
  const t: PendingTrigger = {
    id: `t${g.s.counters.effect++}`,
    sourceId: id,
    sourceName: name,
    controller: player,
    abilityRef: { source: 'reflexive', face: 0, index: 0, key: `miracle:${g.s.counters.effect}` },
    context: { ev: 'resolves', roles: {}, before: {} },
    inline: reflexiveAbility(text, [], [{ op: 'cast', who: { ref: 'you' }, what: { ref: 'self' }, costChange: { kind: 'set', cost, name: 'miracle' }, optional: true }]),
    targetSpecs: [],
  };
  g.s.pendingTriggers.push(t); // CR 603.3: on the stack the next time a player would receive priority
}

installDrawHook(onDraw);
