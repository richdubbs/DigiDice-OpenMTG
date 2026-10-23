/**
 * Generated boards for the executability smoke test (design 8.10.5, 11.3 gate 7, 15.4 "Smoke"): a two-player game at the first main phase of turn 1
 * with a board that satisfies most target requirements: both players have lands of every basic type plus colorless mana, creatures of several types
 * (an artifact creature, a flier, a legendary one), a noncreature artifact, an enchantment, a planeswalker, cards in hand, graveyard, library and exile.
 * The filler cards are SYNTHETIC (invented names, no rules text beyond keywords and mana; design 6.10) and compiled by the engine's default compiler.
 *
 * The card under test is placed in its owner's hand (to cast or play it) and/or on the battlefield (to activate its abilities, see its static
 * abilities work and its triggers fire), not summoning sick.
 */
import { applyAction, compileCard, createGame, seatNeighbor, type CardDef, type GameConfig, type GameState, type ObjectId, type OracleCard, type PlayerId } from '@openmtg/engine';

const card = (name: string, typeLine: string, manaCost: string | undefined, text = '', extra: Partial<OracleCard> = {}): OracleCard =>
  ({ name, layout: 'normal', type_line: typeLine, oracle_text: text, ...(manaCost !== undefined ? { mana_cost: manaCost } : {}), keywords: [], ...extra }) as OracleCard;

/** The synthetic filler cards (design 6.10: invented names). */
export const FILLER_CARDS: readonly OracleCard[] = [
  card('Smoke Plains', 'Basic Land — Plains', undefined),
  card('Smoke Island', 'Basic Land — Island', undefined),
  card('Smoke Swamp', 'Basic Land — Swamp', undefined),
  card('Smoke Mountain', 'Basic Land — Mountain', undefined),
  card('Smoke Forest', 'Basic Land — Forest', undefined),
  card('Smoke Wastes', 'Basic Land', undefined, '{T}: Add {C}.'),
  card('Smoke Bear', 'Creature — Bear', '{1}{G}', '', { power: '2', toughness: '2', colors: ['G'] }),
  card('Smoke Knight', 'Creature — Human Knight', '{1}{W}', '', { power: '2', toughness: '2', colors: ['W'] }),
  card('Smoke Golem', 'Artifact Creature — Golem', '{3}', '', { power: '3', toughness: '3', colors: [] }),
  card('Smoke Dragon', 'Creature — Dragon', '{4}{R}', 'Flying', { power: '4', toughness: '4', colors: ['R'], keywords: ['Flying'] }),
  card('Smoke Zombie', 'Creature — Zombie', '{1}{B}', '', { power: '2', toughness: '2', colors: ['B'] }),
  card('Smoke Sage', 'Legendary Creature — Human Wizard', '{1}{U}', '', { power: '1', toughness: '3', colors: ['U'] }),
  card('Smoke Relic', 'Artifact', '{2}', '', { colors: [] }),
  card('Smoke Sigil', 'Enchantment', '{1}{W}', '', { colors: ['W'] }),
  card('Smoke Walker', 'Legendary Planeswalker — Jace', '{3}{U}', '', { loyalty: '4', colors: ['U'] }),
  card('Smoke Spark', 'Instant', '{R}', '', { colors: ['R'] }),
  card('Smoke Lore', 'Sorcery', '{U}', '', { colors: ['U'] }),
];

let fillerDefs: CardDef[] | undefined;
export function fillerDefinitions(): CardDef[] {
  fillerDefs ??= FILLER_CARDS.map((c) => compileCard(c));
  return fillerDefs;
}

const LANDS = ['Smoke Plains', 'Smoke Island', 'Smoke Swamp', 'Smoke Mountain', 'Smoke Forest'];
const CREATURES = ['Smoke Bear', 'Smoke Knight', 'Smoke Golem', 'Smoke Dragon', 'Smoke Zombie', 'Smoke Sage'];
const OTHER_PERMANENTS = ['Smoke Relic', 'Smoke Sigil', 'Smoke Walker'];

export interface BoardSpec {
  /** Put a copy of the card under test into p1's hand. */
  inHand: boolean;
  /** Put a copy of the card under test onto p1's battlefield (face 0, untapped, not summoning sick). */
  onBattlefield: boolean;
  seed?: string;
  /** Both players stop at every step (default true); false = the engine's default stops, so steps with nothing to do pass by (turn cycles). */
  fullControl?: boolean;
}

export interface Board {
  state: GameState;
  /** The copy in p1's hand, if any. */
  hand?: ObjectId;
  /** The copy on p1's battlefield, if any. */
  permanent?: ObjectId;
}

/**
 * Add an object directly to a zone (board setup only; `s` is a private copy). A permanent put onto the battlefield gets what entering would give it:
 * a planeswalker its loyalty counters (CR 306.5b), a battle its defense counters (CR 310.4b), and a Siege a protector, the next opponent (CR 310.9,
 * 310.12a). Without them the next state-based action check would remove it (CR 704.5i, 704.5v) and the phases would test nothing.
 */
function put(s: GameState, owner: PlayerId, zone: 'hand' | 'battlefield' | 'graveyard' | 'library' | 'exile', defId: string, opts: { counters?: Record<string, number> } = {}): ObjectId {
  const id = `o${s.counters.object++}`;
  const face = s.defs[defId]?.faces[0];
  const number = (v: string | undefined): number | undefined => (v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined);
  const onBattlefield = zone === 'battlefield';
  const loyalty = onBattlefield ? number(face?.loyalty) : undefined;
  const defense = onBattlefield && face?.types.includes('Battle') ? number(face.defense) : undefined;
  const counters = { ...(loyalty !== undefined ? { loyalty } : {}), ...(defense !== undefined ? { defense } : {}), ...(opts.counters ?? {}) };
  // M12-2 (m12 design K1, D13): the board has no one to ask, so the protector is the next opponent in turn order still in the game (`seatNeighbor`, CR 101.4);
  // in a two-player game, the opponent, as before (CR 310.12a)
  const protector = onBattlefield && face?.types.includes('Battle') && face.subtypes.includes('Siege') ? seatNeighbor(s, owner, 'left') : undefined;
  s.objects[id] = {
    id, kind: 'card', cardId: `c${s.counters.card++}`, defId, owner, controller: owner, zone, timestamp: s.counters.timestamp++,
    tapped: false, flipped: false, faceDown: false, phasedOut: false, face: 0, controlledSinceTurn: 0, counters, damage: 0, deathtouchDamaged: false,
    ...(protector !== undefined ? { protector } : {}),
  };
  if (zone === 'battlefield' || zone === 'exile') s.zones[zone].push(id);
  else s.zones[zone][owner]!.push(id);
  return id;
}

function populate(s: GameState, p: PlayerId, landsEach: number): void {
  for (const z of ['hand', 'library', 'graveyard'] as const) {
    for (const id of s.zones[z][p]!) delete s.objects[id];
    s.zones[z][p] = [];
  }
  for (const land of LANDS) for (let i = 0; i < landsEach; i++) put(s, p, 'battlefield', land);
  for (let i = 0; i < 2; i++) put(s, p, 'battlefield', 'Smoke Wastes');
  for (const c of [...CREATURES, ...OTHER_PERMANENTS]) put(s, p, 'battlefield', c);
  for (const c of ['Smoke Bear', 'Smoke Spark', 'Smoke Plains']) put(s, p, 'hand', c);
  for (const c of ['Smoke Bear', 'Smoke Spark', 'Smoke Lore', 'Smoke Relic', 'Smoke Island', 'Smoke Dragon']) put(s, p, 'graveyard', c);
  const lib = [...CREATURES, ...OTHER_PERMANENTS, 'Smoke Spark', 'Smoke Lore', ...LANDS];
  for (let i = 0; i < 30; i++) put(s, p, 'library', lib[i % lib.length]!);
  put(s, p, 'exile', 'Smoke Zombie');
}

/** A game with the generated board, p1 active with priority in the first main phase of turn 1 (CR 103.8a: no draw). */
export function makeBoard(def: CardDef, spec: BoardSpec): Board {
  const defs = [def, ...fillerDefinitions().filter((d) => d.id !== def.id)];
  const deck = Array<string>(40).fill('Smoke Plains');
  const config: GameConfig = {
    seed: spec.seed ?? `smoke:${def.id}`,
    players: [
      { name: 'Smoke One', deck, stops: { fullControl: true } },
      { name: 'Smoke Two', deck, stops: { fullControl: true } },
    ],
    defs,
    options: { startingPlayer: 'p1', skipMulligans: true },
  };
  let s: GameState = structuredClone(createGame(config));
  populate(s, 'p1', 4);
  populate(s, 'p2', 2);
  // the filler has no triggered abilities: pass to the first main phase, THEN add the card under test (so its upkeep triggers wait for turn 3)
  for (let guard = 0; s.turn.step !== 'main1' && s.pending?.kind === 'priority' && guard < 30; guard++) {
    const r = applyAction(s, { type: 'pass', player: s.pending.player });
    if (r.error) throw new Error(`board setup: ${r.error.message}`);
    s = r.state;
  }
  if (s.turn.step !== 'main1') throw new Error(`board setup: stuck in ${s.turn.step}`);
  s = structuredClone(s);
  if (spec.fullControl === false) for (const p of s.players) p.stops = { ...p.stops, fullControl: false };
  const board: Board = { state: s };
  if (spec.inHand) board.hand = put(s, 'p1', 'hand', def.id);
  if (spec.onBattlefield) board.permanent = put(s, 'p1', 'battlefield', def.id);
  return board;
}

/** Is any face of the card a permanent (CR 110.4)? Instants and sorceries are not. */
export function hasPermanentFace(def: CardDef): boolean {
  return def.faces.some((f) => f.types.some((t) => ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'].includes(t)));
}
