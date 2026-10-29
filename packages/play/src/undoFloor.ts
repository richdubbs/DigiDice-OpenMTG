/**
 * Which hot-seat actions can never be taken back (LocalConnection's undo floor). Undo exists to fix misclicks, so it may reverse only what CR 733.1
 * would let a player reverse: never an action that moved cards to or from a library, shuffled a library or revealed cards (CR 733.1, last sentence),
 * never an action that showed a player hidden cards (CR 400.2, 401.2), never a random result (a shuffle or a coin flip changes the RNG) and never
 * the end of the game (CR 104.1, 104.3a). M12 gaps (STATUS "Wave M12" gap 6): never a player leaving a multiplayer game that goes on (a concession or a
 * loss, CR 104.3a, 800.4a): the leave procedure removes what they owned and ends their effects, which no undo may give back.
 */
import { canSee, type GameObject, type GameState, type PlayerId } from '@openmtg/engine';

/** Objects in a hidden zone (CR 400.2) that `player` sees only because something showed them: a library card, another player's hand, a face-down card. */
function secretlySeen(state: GameState, player: PlayerId): Set<string> {
  const out = new Set<string>();
  for (const [id, o] of Object.entries(state.objects)) {
    if (!hiddenFrom(o, player)) continue;
    if (canSee(state, o, player)) out.add(id);
  }
  return out;
}

function hiddenFrom(o: GameObject, player: PlayerId): boolean {
  if (o.zone === 'library') return true;
  if (o.zone === 'hand') return o.owner !== player;
  return o.faceDown === true && o.controller !== player;
}

function sameLibraries(prev: GameState, next: GameState): boolean {
  return prev.players.every((p) => {
    const a = prev.zones.library[p.id] ?? [];
    const b = next.zones.library[p.id] ?? [];
    return a.length === b.length && a.every((id, i) => b[i] === id);
  });
}

/**
 * Why the action that turned `prev` into `next` can never be undone, with the rule; null when undo may reverse it. Conservative on purpose: when in
 * doubt the action stays (a player can always play on; a taken-back peek cannot be forgotten).
 */
export function irreversibleReason(prev: GameState, next: GameState): string | null {
  if (next.result) return 'The game is over (CR 104.1).';
  // M12 gaps (gap 6): explicit, not left to the library check below (the leave procedure takes the leaver's library out of the game too, CR 800.4a)
  const left = next.players.find((p) => p.hasLost && prev.players.some((q) => q.id === p.id && !q.hasLost));
  if (left) return `${left.name} left the game (CR 104.3a, CR 800.4a).`;
  if (prev.rng.some((w, i) => next.rng[i] !== w)) return 'A library was shuffled or a random result was decided (CR 733.1).';
  if (!sameLibraries(prev, next)) return 'Cards moved to or from a library (CR 733.1, CR 401.2).';
  for (const p of next.players) {
    const before = secretlySeen(prev, p.id);
    for (const id of secretlySeen(next, p.id)) if (!before.has(id)) return `${p.name} saw hidden cards (CR 733.1, CR 400.2).`;
  }
  return null;
}
