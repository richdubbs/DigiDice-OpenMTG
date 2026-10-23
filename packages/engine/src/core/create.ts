/**
 * Creating a game from decks and card definitions.
 */
import { FACE_DOWN_DEF_IDS, type CardDef } from '../types/card';
import type { DefId, PlayerId } from '../types/ids';
import { MAX_PLAYERS, type GameOptions, type GameState, type PlayerState, type StopSettings } from '../types/state';
import { seedRng, shuffleInPlace } from '../rng';
import { run } from './apply';
import { deepFreeze } from '../util/clone';
import { COMMANDER_VARIANTS } from './commander';

export interface PlayerConfig {
  id?: PlayerId;
  name: string;
  /** Deck as a list of DefIds (one entry per card). In a Commander game: the deck WITHOUT the commander(s) (99 cards with one commander, CR 903.5a). */
  deck: DefId[];
  /**
   * FAST5 MX7 INTERFACE CHANGE (additive, optional): the player's sideboard as DefIds (one entry per card). Its cards are outside the game (CR 400.11a, 100.4):
   * `GameState.outside`, which learn reads (CR 701.48a). Absent or empty: the player owns no card outside the game.
   */
  sideboard?: DefId[];
  stops?: Partial<StopSettings>;
  /**
   * M11-0 (m11 design 4.1): in a Commander game (`GameConfig.options.commander`), the player's commander card(s): one, or two with a partner ability
   * (CR 903.3, 702.124b). They begin the game face up in the command zone (CR 903.6, 103.2c). The engine checks only the count; who may be a commander,
   * partner pairs and color identity are deck construction (packages/cards/src/formats/commander.ts), checked before the game is created.
   */
  commanders?: DefId[];
  /**
   * CMP1 INTERFACE CHANGE (additive, optional): the card with a companion ability this player reveals before the game begins (CR 702.139a, 103.2b), as a
   * DefId. It is a card they own outside the game (CR 400.11): it joins `GameState.outside` (NOT also listed in `sideboard`: a deck whose list names the
   * companion in its sideboard too, as Arena and MTGO lists do, passes the sideboard without that one copy) and `PlayerState.companion` records it as
   * revealed. The engine does not check the companion condition: that is deck construction (packages/cards/src/formats/companion.ts), checked before the
   * game is created, like the commander rules.
   */
  companion?: DefId;
}

export interface GameConfig {
  seed: string;
  players: PlayerConfig[];
  defs: CardDef[] | Record<DefId, CardDef>;
  options?: Partial<GameOptions>;
}

/**
 * Arena-like default stops. The engine still auto-passes for a player who can do nothing but pass and use mana abilities (AP1 smart auto-pass, core/turn.ts).
 * MRE (C6 gap 3): both players stop in the declare blockers step, so the attacker and the defender can cast tricks after blocks (CR 509.2: the active player gets
 * priority once blockers are declared, then the other player, CR 117.3d). Nothing changes when no creature attacks: that step is then skipped (CR 508.8).
 */
export const DEFAULT_STOPS: StopSettings = {
  ownTurn: ['main1', 'declareBlockers', 'main2'],
  opponentTurn: ['declareAttackers', 'declareBlockers', 'end'],
  fullControl: false,
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * M6-0 (m6 design D7, 2.2): the two face-down pseudo-definitions every game has (ids: types/card.ts#FACE_DOWN_DEF_IDS). A face-down permanent or spell is a
 * 2/2 creature with no name, text, subtypes or mana cost (CR 708.2a, 701.40a, 702.37a); the `ward2` profile adds ward {2} (CR 702.168a, 701.58a). Opponents'
 * views show a face-down object as one of these (M6-3), and a copy of a face-down object copies one of these (CR 708.2, 707.2; M6-2): the hidden card is
 * never named. Nothing reads them before M6-3.
 */
const faceDownDef = (id: string, abilities: CardDef['faces'][number]['abilities']): CardDef => ({
  id,
  name: '',
  layout: 'normal',
  faces: [{
    name: '', manaCost: null, typeLine: 'Creature', supertypes: [], types: ['Creature'], subtypes: [], oracleText: '', power: '2', toughness: '2',
    colors: [], keywords: [], abilities,
  }],
  isToken: false,
  automation: { level: 'full', faces: [{ abilities: abilities.map(() => ({ level: 'full', manual: [] })) }], unsupported: [], source: 'keywords-only' },
});

/** The two pseudo-definitions (frozen; equal in every game, so every game's `defs` holds the same two). */
export const FACE_DOWN_DEFS: readonly CardDef[] = [
  deepFreeze(faceDownDef(FACE_DOWN_DEF_IDS.plain, [])),
  deepFreeze(faceDownDef(FACE_DOWN_DEF_IDS.ward2, [{ kind: 'keyword', keyword: 'ward', text: 'Ward {2}', cost: { mana: [{ kind: 'generic', amount: 2 }] } }])), // CR 702.21a
];

/** Build the state before the start-of-game procedure. */
export function initialState(config: GameConfig): GameState {
  checkPlayerCount(config);
  const defs: Record<DefId, CardDef> = Array.isArray(config.defs) ? Object.fromEntries(config.defs.map((d) => [d.id, d])) : { ...config.defs };
  for (const d of FACE_DOWN_DEFS) defs[d.id] ??= d; // M6-0 (m6 design 2.2): the face-down pseudo-definitions
  // Definitions are shared between every state of the game (util/clone.ts#cloneState) and must never be mutated in place.
  for (const d of Object.values(defs)) deepFreeze(d);
  // M11-0: a Commander game starts at its variant's life unless the config says otherwise (CR 903.7, 103.4c-d)
  // M12-1: in a multiplayer Commander game, the variant's multiplayer life (CR 903.7: 40; CR 903.12f: multiplayer Brawl 30; Duel Commander: none, refused)
  const commander = config.options?.commander;
  const options: GameOptions = { startingLife: commander ? commanderStartingLife(config) : 20, startingHandSize: 7, ...config.options };
  checkCommanderConfig(config, defs);
  const players: PlayerState[] = config.players.map((pc, i) => ({
    id: pc.id ?? `p${i + 1}`,
    name: pc.name,
    life: options.startingLife, // CR 103.4
    poison: 0,
    manaPool: [],
    landsPlayedThisTurn: 0,
    lastTurnStarted: 0,
    drewFromEmptyLibrary: false,
    hasLost: false,
    conceded: false,
    mulligans: 0,
    keptHand: false,
    stops: { ...DEFAULT_STOPS, ...pc.stops },
    counters: {},
    turnStats: { lifeGained: 0, lifeLost: 0, spellsCast: 0, cardsDrawn: 0 },
  }));
  if (new Set(players.map((p) => p.id)).size !== players.length) throw new ConfigError('Player ids must be unique.');

  const s: GameState = {
    schema: 1,
    seed: config.seed,
    rng: seedRng(config.seed),
    options,
    defs,
    players,
    objects: {},
    zones: { library: {}, hand: {}, graveyard: {}, battlefield: [], stack: [], exile: [], command: [] },
    turn: { number: 0, activePlayer: players[0]!.id, step: 'untap', startingPlayer: players[0]!.id, extraTurns: [], skipSteps: [] },
    stage: 'choosePlayOrder',
    priority: { player: null, passes: 0 },
    combat: null,
    continuousEffects: [],
    pendingTriggers: [],
    turnActivations: {},
    delayedTriggers: [],
    history: [],
    designations: {},
    reminders: [],
    lki: {},
    pending: null,
    suspended: null,
    log: [],
    result: null,
    counters: { object: 1, timestamp: 1, log: 0, decision: 0, card: 1, effect: 1 },
    actionCount: 0,
  };

  // Object ids, card ids and timestamps are handed out in the order the cards are created. Decklists group copies together, so
  // creating them in decklist order would let an opponent read the identity of hidden cards from their ids (CR 400.2). The
  // cards are therefore created in a random order drawn from a stream of their own (so the game's RNG is untouched); the
  // library is shuffled anyway (CR 103.3).
  const idRng = seedRng(`${config.seed}:object-ids`);
  const unknown = new Set<string>();
  config.players.forEach((pc, i) => {
    const pid = players[i]!.id;
    s.zones.library[pid] = [];
    s.zones.hand[pid] = [];
    s.zones.graveyard[pid] = [];
    const deck = [...pc.deck];
    shuffleInPlace(idRng, deck);
    for (const defId of deck) {
      const def = defs[defId];
      if (!def) { unknown.add(defId); continue; }
      const id = `o${s.counters.object++}`;
      s.objects[id] = {
        id, kind: 'card', cardId: `c${s.counters.card++}`, defId, owner: pid, controller: pid, zone: 'library',
        timestamp: s.counters.timestamp++, tapped: false, flipped: false, faceDown: false, phasedOut: false, face: 0,
        controlledSinceTurn: 0, counters: {}, damage: 0, deathtouchDamaged: false,
      };
      s.zones.library[pid]!.push(id);
    }
  });
  if (unknown.size) throw new ConfigError(`Unknown cards in deck: ${[...unknown].join(', ')}`);
  // FAST5 MX7 (CR 400.11a, 100.4): the sideboards, outside the game; the key is present only when some player has one (older states and configs stay equal).
  // CMP1 (CR 702.139a, 400.11): a revealed companion is a card its owner owns outside the game too, after the sideboard.
  if (config.players.some((pc) => (pc.sideboard?.length ?? 0) > 0 || pc.companion !== undefined)) {
    const outside: Record<PlayerId, DefId[]> = {};
    config.players.forEach((pc, i) => {
      const side = [...(pc.sideboard ?? []), ...(pc.companion !== undefined ? [pc.companion] : [])];
      for (const defId of side) if (!defs[defId]) unknown.add(defId);
      outside[players[i]!.id] = side;
    });
    if (unknown.size) throw new ConfigError(`Unknown cards in sideboard: ${[...unknown].join(', ')}`);
    s.outside = outside;
    config.players.forEach((pc, i) => {
      if (pc.companion !== undefined) players[i]!.companion = { defId: pc.companion }; // CR 702.139a: revealed (public)
    });
  }
  if (commander) setUpCommanders(s, config);
  return s;
}

/**
 * M12-1 (m12 design D1, D4, 4.1): a game begins with two players, or with 3 to MAX_PLAYERS players and `options.multiplayer` (CR 800.1: a multiplayer game
 * is one that begins with more than two players). The only multiplayer variant is Free-for-All with the attack multiple players option (CR 806, 802,
 * 806.2b; no limited range of influence, CR 806.2a, 903.2). Anything else is refused: a two-player game with `multiplayer` would play multiplayer rules
 * (CR 103.8c, 800.6) that a two-player game does not have, and a 3-4 player game without it would play two-player rules (CR 103.8a).
 */
function checkPlayerCount(config: GameConfig): void {
  const n = config.players.length;
  const mp = config.options?.multiplayer;
  if (n < 2 || n > MAX_PLAYERS) throw new ConfigError(`A game has 2 to ${MAX_PLAYERS} players (CR 800.1); ${n} given.`);
  if (n === 2 && mp !== undefined) throw new ConfigError('A two-player game is not a multiplayer game (CR 800.1): remove options.multiplayer.');
  if (n > 2 && mp === undefined) throw new ConfigError(`A game with ${n} players is a multiplayer game (CR 800.1): it needs options.multiplayer (Free-for-All, CR 806).`);
  if (mp === undefined) return;
  if (mp.variant !== 'freeForAll') throw new ConfigError(`Unsupported multiplayer variant: ${String(mp.variant)} (only Free-for-All, CR 806).`);
  if (mp.attack !== 'multiple') throw new ConfigError(`Unsupported attack option: ${String(mp.attack)} (only attack multiple players, CR 802, 806.2b).`);
}

/**
 * M11-0, M12-1: the starting life of a Commander game (CR 103.4c-d): the variant's two-player life, or its multiplayer life in a game with
 * `options.multiplayer` (CR 903.7, 903.12f). Duel Commander is a two-player format (m12 design 10 Q8): refused with more players, even
 * when the config gives a starting life of its own.
 */
function commanderStartingLife(config: GameConfig): number {
  const variant = COMMANDER_VARIANTS[config.options!.commander!.variant];
  if (config.options?.multiplayer === undefined) return variant.startingLife;
  if (variant.multiplayerLife === null) throw new ConfigError(`${variant.name} is a two-player format: it can't be played with ${config.players.length} players.`);
  return variant.multiplayerLife;
}

/** M11-0: the commander part of a config is consistent (CR 903.3, 702.124b-g: one or two commanders per player; none outside a Commander game). */
function checkCommanderConfig(config: GameConfig, defs: Record<DefId, CardDef>): void {
  const isCommanderGame = config.options?.commander !== undefined;
  for (const pc of config.players) {
    const n = pc.commanders?.length ?? 0;
    if (!isCommanderGame && n > 0) throw new ConfigError(`${pc.name} has a commander, but this is not a Commander game (options.commander).`);
    if (isCommanderGame && (n < 1 || n > 2)) throw new ConfigError(`${pc.name} needs one commander, or two with a partner ability (CR 903.3, 702.124g); ${n} given.`);
    for (const id of pc.commanders ?? []) if (!defs[id]) throw new ConfigError(`Unknown commander: ${id}`);
  }
}

/**
 * M11-0: CR 903.6, 103.2c: each player's commander(s) begin the game face up in the command zone, with their designation (`PlayerState.commanders`). Created
 * after the libraries, so a library's object ids are those of the same 99 cards in a game without commanders. CR 903.4a: the color identity is fixed now.
 */
function setUpCommanders(s: GameState, config: GameConfig): void {
  config.players.forEach((pc, i) => {
    const p = s.players[i]!;
    p.commanders = [];
    for (const defId of pc.commanders ?? []) {
      const id = `o${s.counters.object++}`;
      const cardId = `c${s.counters.card++}`;
      s.objects[id] = {
        id, kind: 'card', cardId, defId, owner: p.id, controller: p.id, zone: 'command',
        timestamp: s.counters.timestamp++, tapped: false, flipped: false, faceDown: false, phasedOut: false, face: 0,
        controlledSinceTurn: 0, counters: {}, damage: 0, deathtouchDamaged: false,
      };
      s.zones.command.push(id);
      const identity = s.defs[defId]!.colorIdentity;
      p.commanders.push({ card: cardId, defId, casts: 0, identity: identity ? [...identity] : null });
    }
  });
}

/**
 * Create a game and run the start-of-game procedure (CR 103) up to the first decision
 * (who plays first, mulligans) or the first priority.
 */
export function createGame(config: GameConfig): GameState {
  const s = initialState(config);
  return run(s, { type: 'startGame' }, []).state;
}
