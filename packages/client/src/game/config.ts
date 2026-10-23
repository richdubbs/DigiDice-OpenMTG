/** From the New game screen's choices to an engine `GameConfig` (pure; the screen fetches the definitions and the seed). */
import {
  COMMANDER_VARIANTS, MAX_PLAYERS, cleanText, commanderOptions, type CardDef, type CommanderVariant, type GameConfig, type PlayerConfig, type StopSettings,
} from '@openmtg/engine';
import type { DeckList } from '@openmtg/server/api';
import { FORMAT_OPTIONS } from '../decks/formats';

/**
 * M11-2 (docs/design/m11-commander.md 5.1): the Commander variants a game can be started in from the New game screen, in the engine's variant ids (which
 * are also the deck library's format ids, decks/formats.ts). THE one list: adding or removing a variant on the New game screen is one line here.
 * All four (design section 9, Q3).
 */
export const COMMANDER_GAME_VARIANTS: readonly CommanderVariant[] = [
  'commander',
  'duel',
  'brawl',
  'standardbrawl',
];

/** The Commander variant a format id plays as, or null for a format without a commander (or a variant not offered above). */
export function commanderVariantOf(format: string): CommanderVariant | null {
  return (COMMANDER_GAME_VARIANTS as readonly string[]).includes(format) ? (format as CommanderVariant) : null;
}

/**
 * Formats a game can be checked against: the deck library's formats (C3, decks/formats.ts, the ids of F1's format rules); of the Commander formats only
 * the variants offered above (M11-2: the command zone arrived with milestone 11).
 */
export const FORMATS: readonly { id: string; label: string }[] = FORMAT_OPTIONS.filter((f) => !f.commander || commanderVariantOf(f.id) !== null).map((f) => ({
  id: f.id,
  label: f.name,
}));

export const DEFAULT_FORMAT = 'casual';

/** Older or other spellings of a format id (F1 accepts these as aliases of 'casual'; "edh" is Commander). */
const FORMAT_ALIASES: Record<string, string> = { freeform: 'casual', none: 'casual', edh: 'commander' };

/** The id in FORMATS for a deck's saved format, or null when it is not one offered here. */
export function offeredFormat(format: string | undefined): string | null {
  if (!format) return null;
  const id = FORMAT_ALIASES[format.toLowerCase()] ?? format.toLowerCase();
  return FORMATS.some((f) => f.id === id) ? id : null;
}

/**
 * CR 103.4: 20 life, or the Commander variant's own starting life (CR 903.7: 40; Duel Commander 20; CR 903.12f: two-player Brawl 25). M12-4b: with three or
 * four players (`players`, default 2) the variant's multiplayer life (CR 903.7: Commander 40; CR 903.12f: Brawl and Standard Brawl 30); Duel Commander has
 * none (a two-player format): its two-player life is returned and `formatProblem` refuses the game.
 */
export function startingLifeFor(format: string, players = 2): number {
  const v = commanderVariantOf(format);
  if (!v) return 20;
  const variant = COMMANDER_VARIANTS[v];
  return players > 2 ? (variant.multiplayerLife ?? variant.startingLife) : variant.startingLife;
}

/** M12-4b (m12 design 5.3 item 1): the seats' player ids, in the New game screen's order (p1 is the person at the screen's first seat). */
export const PLAYER_IDS = ['p1', 'p2', 'p3', 'p4'] as const;

/** CR 800.1 (M12-1): a game has two players, or three or four (MAX_PLAYERS) in a multiplayer game. */
export const MIN_PLAYERS = 2;
export { MAX_PLAYERS };

/** Why `format` cannot be played with `players` players, or null. */
export function formatProblem(format: string, players: number): string | null {
  const v = commanderVariantOf(format);
  if (players > 2 && v !== null && COMMANDER_VARIANTS[v].multiplayerLife === null)
    return `${COMMANDER_VARIANTS[v].name} is a two-player format: choose Commander, Brawl or Standard Brawl for ${players} players.`;
  return null;
}

export interface PlayerSetup {
  name: string;
  deck: DeckList;
  /**
   * CMP1: the companion the deck check read (`ValidateResponse.companion`, CR 702.139a: the Companion section's card, or the one fitting card of an MTGO
   * sideboard); null: none. Absent: the deck's Companion section (one card) is the companion.
   */
  companion?: string | null;
}

export interface StartOptions {
  /** CR 103.4: each player begins the game with 20 life unless a variant says otherwise. */
  startingLife: number;
  /** Who takes the first turn: a player's index, or "random" (the game picks the starting player at random from the seed and
   * nobody is asked; CR 103.1's "a random player chooses" happens only for a config with no starting player). */
  firstPlayer: 'random' | number;
}

export const DEFAULT_START: StartOptions = { startingLife: 20, firstPlayer: 'random' };

const commanderEntries = (deck: DeckList) => (deck.commander ?? []).filter((e) => e.count > 0);

/**
 * CMP1 (CR 702.139a): the Oracle name of the companion a player reveals, or null: the deck check's reading when there is one (`PlayerSetup.companion`),
 * else the deck's Companion section when it holds exactly one card (more than one is a deck error the check reports; none is revealed then).
 */
export function companionOf(p: PlayerSetup): string | null {
  if (p.companion !== undefined) return p.companion;
  const section = (p.deck.companion ?? []).filter((e) => e.count > 0);
  return section.length === 1 && section[0]!.count === 1 ? section[0]!.name : null;
}

/**
 * Every Oracle name the games' decks use, once each, sorted (the request for `POST /api/cards/defs`): the main decks, the commanders (M11-2, CR 903.3) and,
 * since FAST5 MX7, the sideboards (outside the game, CR 400.11a: learn can bring their Lesson cards into the game, CR 701.48a).
 */
export function deckCardNames(players: readonly PlayerSetup[]): string[] {
  const companions = players.map(companionOf).filter((n): n is string => n !== null); // CMP1: outside the game, CR 702.139a
  return [...new Set([...players.flatMap((p) => [...p.deck.main, ...commanderEntries(p.deck), ...p.deck.sideboard].map((e) => e.name)), ...companions])].sort();
}

/** FAST5 MX7: the Oracle names of the cards that start in the game (the main decks and the commanders, CR 903.6), once each, sorted. */
export function mainCardNames(players: readonly PlayerSetup[]): string[] {
  return [...new Set(players.flatMap((p) => [...p.deck.main, ...commanderEntries(p.deck)].map((e) => e.name)))].sort();
}

/** How many commanders a deck designates (CR 903.3: one; CR 702.124: two with a partner ability). */
export function commanderCount(deck: DeckList): number {
  return commanderEntries(deck).reduce((n, e) => n + e.count, 0);
}

/**
 * Why a deck cannot be played in a game of `format`, or null. A Commander game needs one commander, or two (CR 903.3, 702.124); a deck with a
 * commander is played only in a Commander format (outside one there is no command zone to start it in, and it is never shuffled in silently).
 */
export function unplayableReason(deck: DeckList, format: string = DEFAULT_FORMAT): string | null {
  const commanders = commanderCount(deck);
  const variant = commanderVariantOf(format);
  if (variant === null && commanders > 0) return 'This deck has a commander: choose a Commander format to play it (CR 903.3).';
  if (variant !== null && commanders === 0) return 'A Commander game needs a commander: set one in the deckbuilder (CR 903.3).';
  if (variant !== null && commanders > 2) return `This deck has ${commanders} commanders: a deck has one, or two with a partner ability (CR 702.124).`;
  if (!deck.main.some((e) => e.count > 0)) return 'The deck has no cards in its main deck.';
  return null;
}

/** Things the players should know about how a deck enters the game (shown before the game starts, never silently dropped). */
export function deckNotes(deck: DeckList): string[] {
  const notes: string[] = [];
  const side = deck.sideboard.reduce((n, e) => n + e.count, 0);
  if (side > 0) notes.push(`The sideboard (${side} cards) stays outside the game (CR 100.4); learn can put its Lesson cards into your hand (CR 701.48a).`);
  const companion = companionOf({ name: '', deck });
  if (companion !== null) {
    notes.push(`${companion} is your companion: it starts outside the game, revealed to both players; once per game, in a main phase of your turn with an empty stack, you may pay {3} to put it into your hand (CR 702.139a, 116.2g).`);
  }
  return notes;
}

export class ConfigBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigBuildError';
  }
}

/**
 * The game's configuration: each main deck (and sideboard, FAST5 MX7) as definition ids (one per card), the compiled definitions embedded, the stops from Settings, the seed.
 * With `commander` (M11-2, m11 design 4.1): each deck's commander section becomes `PlayerConfig.commanders` (the main deck is the rest, the 99), and
 * `options.commander` the variant's rules (`commanderOptions`). Throws ConfigBuildError when a card has no definition (the caller shows which).
 *
 * M12-4b (m12 design D1, D2, 5.3 item 1): with three or four players the game is a multiplayer game (`options.multiplayer`: Free-for-All with the attack
 * multiple players option, CR 806, 802, 800.1) and the players are **seated at random from the seed** (CR 806.3): `config.players` is the
 * seating order, clockwise; each player keeps the id of their New game seat (p1 is the first seat's). A two-player config is exactly as before (no shuffle,
 * no `multiplayer`). The starting life is the caller's (`startingLifeFor(format, players)`).
 */
export function buildGameConfig(args: {
  players: readonly PlayerSetup[];
  defs: Record<string, CardDef>;
  seed: string;
  start: StartOptions;
  stops: StopSettings;
  commander?: CommanderVariant | null;
}): GameConfig {
  const { players, defs, seed, start, stops } = args;
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new ConfigBuildError(`A game has ${MIN_PLAYERS} to ${MAX_PLAYERS} players (CR 800.1).`);
  const variant = args.commander ?? null;
  const used = new Map<string, CardDef>();
  const missing = new Set<string>();
  const idsOf = (entries: readonly { name: string; count: number }[]): string[] => {
    const out: string[] = [];
    for (const e of entries) {
      const def = defs[e.name];
      if (!def) {
        missing.add(e.name);
        continue;
      }
      used.set(def.id, def);
      for (let n = 0; n < e.count; n++) out.push(def.id);
    }
    return out;
  };
  const playerConfigs: PlayerConfig[] = players.map((p, i) => {
    const deck = idsOf(p.deck.main);
    // CMP1 (CR 702.139a): the revealed companion. Its card must load (the player expects it); one copy of it leaves the sideboard (constructed lists name it
    // there too), since PlayerConfig.companion is outside the game already.
    const companionName = companionOf(p);
    const companion = companionName !== null ? idsOf([{ name: companionName, count: 1 }])[0] : undefined;
    let skipCompanion = companion !== undefined;
    // FAST5 MX7 (CR 400.11a): the sideboard, outside the game. A sideboard card without a definition stays out of the game entirely (it could not be
    // brought in anyway), so a sideboard never blocks a game from starting.
    const sideboard: string[] = [];
    for (const e of p.deck.sideboard) {
      const def = defs[e.name];
      if (!def) continue;
      used.set(def.id, def);
      for (let n = 0; n < e.count; n++) {
        if (skipCompanion && def.id === companion) {
          skipCompanion = false;
          continue;
        }
        sideboard.push(def.id);
      }
    }
    const config: PlayerConfig = {
      id: PLAYER_IDS[i]!, name: playerName(p.name), deck, ...(sideboard.length > 0 ? { sideboard } : {}), ...(companion !== undefined ? { companion } : {}),
      stops: { ...stops, ownTurn: [...stops.ownTurn], opponentTurn: [...stops.opponentTurn] },
    };
    if (variant !== null) config.commanders = idsOf(commanderEntries(p.deck));
    return config;
  });
  if (missing.size > 0) throw new ConfigBuildError(`No card definition for: ${[...missing].sort().join(', ')}.`);
  const multiplayer = playerConfigs.length > 2;
  const first = start.firstPlayer === 'random' ? randomSeat(seed, playerConfigs.length) : start.firstPlayer;
  if (!Number.isInteger(first) || first < 0 || first >= playerConfigs.length) throw new ConfigBuildError('The player chosen to play first is not in this game.');
  return {
    seed,
    players: multiplayer ? seatAtRandom(playerConfigs, seed) : playerConfigs,
    defs: [...used.values()],
    options: {
      startingLife: start.startingLife,
      startingPlayer: PLAYER_IDS[first]!,
      ...(variant !== null ? { commander: commanderOptions(variant) } : {}),
      ...(multiplayer ? { multiplayer: { variant: 'freeForAll' as const, attack: 'multiple' as const } } : {}),
    },
  };
}

/** FNV-1a of a text: the seed's hash for the random choices here (pure: the same seed always gives the same answer). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A seat picked at random from the game's seed (FNV-1a), so the same seed always gives the same first player and the config stays pure. */
export function randomSeat(seed: string, seats: number): number {
  return hash(seed) % seats;
}

/**
 * A player's name as the game gets it: without control characters (a pasted tab or bidirectional override, which a text input keeps) and trimmed. The
 * rule of shown text that online names and replays use (engine util/shown-text.ts), so a replay of a local game records names its import accepts
 * (RPL-0 review).
 */
export function playerName(typed: string): string {
  return cleanText(typed).trim();
}

/**
 * M12-4b (m12 design D2; CR 806.3 "The players are randomly seated around the table"): the players in a seating order shuffled from the
 * seed (Fisher-Yates, one hash per swap), so the same seed always seats them the same way and the config of a saved game replays it. Pure.
 */
export function seatAtRandom<T>(players: readonly T[], seed: string): T[] {
  const out = [...players];
  for (let i = out.length - 1; i > 0; i--) {
    const j = hash(`${seed}:seating:${i}`) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
