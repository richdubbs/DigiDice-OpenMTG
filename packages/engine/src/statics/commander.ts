/**
 * M11-0 (docs/design/m11-commander.md 4.2): pure readers of the Commander state (CR 903). They take a `GameState` only, so every layer may use them (the
 * import rules let statics be imported by rules, core, effects and triggers; statics/match.ts and rules/filter.ts read `isCommander` for the
 * `commander` filter field). Outside a Commander game (`GameState.options.commander` absent) every answer is "no commander": no object is a commander,
 * the tax is 0, the identity is undefined (CR 903.4f). Owner: M11-0; M11-1 may add readers here.
 */
import type { CardId, PlayerId } from '../types/ids';
import type { Color } from '../types/mana';
import { COLORS } from '../types/mana';
import type { CommanderRec, GameObject, GameState } from '../types/state';

/** Is this a Commander game (CR 903)? */
export const isCommanderGame = (s: GameState): boolean => s.options.commander !== undefined;

/** The commander records of a player (none outside a Commander game). */
export const commandersOf = (s: GameState, player: PlayerId): readonly CommanderRec[] => s.players.find((p) => p.id === player)?.commanders ?? [];

/** The owner and record of the commander designation a card has (CR 903.3), or undefined. */
export function commanderOfCard(s: GameState, card: CardId | undefined): { owner: PlayerId; rec: CommanderRec } | undefined {
  if (card === undefined || !isCommanderGame(s)) return undefined;
  for (const p of s.players) {
    const rec = p.commanders?.find((c) => c.card === card);
    if (rec) return { owner: p.id, rec };
  }
  return undefined;
}

/**
 * CR 903.3: is this object a commander? The designation belongs to the CARD, so a commander turned face down or copying something else still is one, and a
 * token, a copy of a spell (CR 707.10) or a permanent copying a commander is not (a different card or none). CR 903.3b-c: a melded or merged permanent is
 * a commander when one of its components is a commander card. An ability on the stack is not a card.
 */
export function isCommander(s: GameState, o: GameObject): boolean {
  if (!isCommanderGame(s) || o.kind !== 'card') return false;
  if (commanderOfCard(s, o.cardId) !== undefined) return true;
  return o.components?.some((c) => c.kind === 'card' && commanderOfCard(s, c.cardId) !== undefined) === true;
}

/**
 * CR 903.8, 702.124d: the commander tax to cast this commander card from the command zone now: `CommanderOptions.tax` for each previous cast of THAT
 * commander from the command zone (a partner's casts do not count). 0 for a card that is not a commander or outside a Commander game.
 */
export function commanderTax(s: GameState, card: CardId | undefined): number {
  const c = commanderOfCard(s, card);
  return c ? (s.options.commander?.tax ?? 0) * c.rec.casts : 0;
}

/** CR 903.8: how many times `player` has cast their commanders from the command zone this game (both, with partners): the `commanderCasts` quantity. */
export const commanderCastsOf = (s: GameState, player: PlayerId): number => commandersOf(s, player).reduce((n, c) => n + c.casts, 0);

/**
 * CR 903.4, 702.124c: the color identity of `player`'s commander (both commanders' identities combined), in WUBRG order. undefined when it is undefined
 * (CR 903.4f: the player has no commander, which is every player outside a Commander game) or not known (a commander definition without
 * `colorIdentity`: the caller resolves by hand, never guesses). An empty array is a colorless identity.
 */
export function commanderIdentity(s: GameState, player: PlayerId): Color[] | undefined {
  const recs = commandersOf(s, player);
  if (recs.length === 0 || recs.some((r) => r.identity === null)) return undefined;
  const set = new Set(recs.flatMap((r) => r.identity ?? []));
  return COLORS.filter((c) => set.has(c));
}

/**
 * M11-1: the commander card an object represents (CR 903.3, 903.3b-c), or undefined: the object's own card when it is a commander, else the first component
 * of a melded or merged permanent that is one. Commander damage (CR 903.10a, 702.124d) is counted against this card.
 */
export function commanderCardOf(s: GameState, o: GameObject): CardId | undefined {
  if (!isCommanderGame(s) || o.kind !== 'card') return undefined;
  if (commanderOfCard(s, o.cardId) !== undefined) return o.cardId;
  return o.components?.find((c) => c.kind === 'card' && commanderOfCard(s, c.cardId) !== undefined)?.cardId;
}

/**
 * M11-1, CR 903.4, 903.4f: the colors "one mana of any color in your commander's color identity" may be, for `player`: the identity (possibly empty: the
 * ability adds nothing), or 'unknown' when a commander's identity was not given (CR 903.4a: never guessed; the ability is resolved by hand). A player without
 * a commander (every player outside a Commander game) has an undefined identity: [] (CR 903.4f: that part of the ability does nothing).
 */
export function identityManaColors(s: GameState, player: PlayerId): Color[] | 'unknown' {
  if (commandersOf(s, player).some((r) => r.identity === null)) return 'unknown';
  return commanderIdentity(s, player) ?? [];
}

/** CR 903.10a, 704.6c: the combat damage the commander `card` has dealt to `player` this game. */
export const commanderDamageTo = (s: GameState, player: PlayerId, card: CardId): number => s.players.find((p) => p.id === player)?.commanderDamage?.[card] ?? 0;
