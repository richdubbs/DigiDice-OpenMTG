/**
 * M11-1 (m11 design 2), CR 903.10a, 704.6c, 702.124d: the commander damage tally. Owner: M11-1. core/combat-damage.ts records the combat damage a commander
 * deals to a player; this module writes it, so the move part (core/move-parts/commander.ts) and the state-based actions (core/sba-commander.ts) share it
 * without an import cycle (it imports no other core module).
 *
 * Hidden information (review finding 2; CR 400.2, 708.2): a face-down commander's damage is kept on the permanent (`GameObject.hiddenCommanderDamage`,
 * private) and joins the public tally, with its `commanderDamage` event, once the permanent is turned face up or leaves the battlefield (CR 708.9: it is
 * revealed). Until then only its controller is told (a private text on the damage log line). CR 704.6c reads the public and the hidden damage.
 */
import type { CardId, ObjectId, PlayerId } from '../types/ids';
import type { GameObject, GameState } from '../types/state';
import { commanderCardOf, commanderOfCard } from '../statics/commander';
import type { Game } from './game';

/** Add `amount` to the public tally of `card` against `player` and emit the event (right after the damage it counts, or as hidden damage is revealed). */
export function addCommanderDamage(g: Game, player: PlayerId, card: CardId, source: ObjectId, amount: number): number {
  const p = g.player(player);
  const total = (p.commanderDamage?.[card] ?? 0) + amount;
  p.commanderDamage = { ...p.commanderDamage, [card]: total };
  g.emit({ type: 'commanderDamage', player, commander: card, source, amount, total });
  return total;
}

/** The commander's name from its record (public, CR 903.6), not from the object (which may be face down or gone). */
export function commanderName(s: GameState, card: CardId): string {
  const c = commanderOfCard(s, card);
  return (c && s.defs[c.rec.defId]?.name) || 'a commander';
}

/**
 * CR 708.9, 708.8: the hidden damage of a commander that is revealed now (`o` left the battlefield, or is a permanent no longer face down) joins the public
 * tally. `o` is the object as it was (last known information for one that left); `live` removes the record from the permanent itself.
 */
export function revealCommanderDamage(g: Game, o: GameObject, live: boolean): void {
  const hidden = o.hiddenCommanderDamage;
  if (!hidden) return;
  if (live) delete o.hiddenCommanderDamage; // `o` is the permanent itself then
  const card = commanderCardOf(g.s, o);
  if (card === undefined) return;
  for (const [player, n] of Object.entries(hidden)) {
    if (n <= 0 || !g.s.players.some((p) => p.id === player)) continue;
    const total = addCommanderDamage(g, player, card, o.id, n);
    g.log(`${commanderName(g.s, card)} is revealed: the ${n} combat damage it dealt to ${g.player(player).name} face down is commander damage (${total} in total).`, { rules: ['CR 903.10a', 'CR 708.9'], level: 'info' });
  }
}

/** CR 704.6c: the combat damage each commander card has dealt to `player`, public and hidden (face-down commanders on the battlefield). */
export function commanderDamageTotals(s: GameState, player: PlayerId): { card: CardId; total: number; hidden: boolean }[] {
  const out = new Map<CardId, { total: number; hidden: boolean }>();
  for (const [card, n] of Object.entries(s.players.find((p) => p.id === player)?.commanderDamage ?? {})) out.set(card, { total: n, hidden: false });
  for (const id of s.zones.battlefield) {
    const o = s.objects[id];
    const n = o?.hiddenCommanderDamage?.[player];
    const card = o && n ? commanderCardOf(s, o) : undefined;
    if (!n || card === undefined) continue;
    const cur = out.get(card) ?? { total: 0, hidden: false };
    out.set(card, { total: cur.total + n, hidden: true });
  }
  return [...out].map(([card, v]) => ({ card, ...v }));
}
