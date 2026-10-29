/**
 * Scenario helpers for milestone 3 tests: build a game, place real fixture cards directly into zones,
 * and drive it with real actions.
 */
import {
  applyAction, createGame, legalActions, noAbilityCompiler, pipelineCompiler, type AbilityCompiler, type Action, type CardDef, type DecisionAnswer, type GameConfig, type GameState,
  type LegalAction, type ObjectId, type PlayerId, type StopSettings, type ZoneKind,
} from '../../src/index';
import { clone } from '../../src/util/clone';
import { compiledDef, compiledDefs } from '../fixtures';

export type Zones = Partial<Record<'hand' | 'battlefield' | 'graveyard' | 'library' | 'exile', (string | PutOptions)[]>>;
export interface PutOptions {
  name: string;
  tapped?: boolean;
  /** Turn number during which the object came under its controller's control (default 0 = not summoning sick). */
  since?: number;
  face?: number;
  counters?: Record<string, number>;
  onAdventure?: boolean;
}
export interface ScenarioOptions {
  p1?: Zones;
  p2?: Zones;
  /** Extra definitions (synthetic cards). */
  defs?: CardDef[];
  seed?: string;
  stops?: Partial<StopSettings>;
  life?: number;
  /**
   * WP18: fixture cards whose text is kept as manual text (one manual ability per face, as milestone 4 compiled an unknown line) whatever the compile
   * pipeline learns; their keyword abilities (fuse, split second, flash...) stay automated. For tests whose subject is manual resolution or casting (they
   * use an instant such as Lightning Bolt as the spell a player resolves by hand), not the card's own effect.
   */
  manual?: string[];
}

const FULL: Partial<StopSettings> = { fullControl: true };

function nameOf(x: string | PutOptions): PutOptions {
  return typeof x === 'string' ? { name: x } : x;
}

/** The compiler of `ScenarioOptions.manual`: the pipeline's keyword abilities, the rest of the face as one manual ability. */
const manualText: AbilityCompiler = (face, card) => {
  const keywords = pipelineCompiler(face, card).abilities.filter((a) => a.kind === 'keyword');
  const rest = noAbilityCompiler(face, card);
  return { abilities: [...keywords, ...rest.abilities], unsupported: rest.unsupported };
};

/** Add an object directly to a zone of the state (test setup only; mutates `s`). */
export function put(s: GameState, owner: PlayerId, zone: Exclude<ZoneKind, 'stack' | 'command'>, spec: string | PutOptions): ObjectId {
  const o = nameOf(spec);
  if (!s.defs[o.name]) throw new Error(`Definition "${o.name}" is not in the scenario; list it in the cards option`);
  const id = `o${s.counters.object++}`;
  s.objects[id] = {
    id, kind: 'card', cardId: `c${s.counters.card++}`, defId: o.name, owner, controller: owner, zone,
    timestamp: s.counters.timestamp++, tapped: o.tapped === true, flipped: false, faceDown: false, phasedOut: false, face: o.face ?? 0,
    controlledSinceTurn: o.since ?? 0, counters: { ...(o.counters ?? {}) }, damage: 0, deathtouchDamaged: false,
    ...(o.onAdventure ? { chosen: { onAdventure: true } } : {}),
  };
  if (zone === 'battlefield' || zone === 'exile') s.zones[zone].push(id);
  else s.zones[zone][owner]!.push(id);
  return id;
}

/** Remove every object from a player's hand and library (a clean slate), then add the given zones. */
function setup(s: GameState, owner: PlayerId, zones: Zones | undefined): void {
  for (const z of ['hand', 'library'] as const) {
    for (const id of s.zones[z][owner]!) delete s.objects[id];
    s.zones[z][owner] = [];
  }
  for (const name of ['library', 'hand', 'graveyard', 'battlefield', 'exile'] as const) {
    for (const spec of zones?.[name] ?? []) put(s, owner, name, spec);
  }
  // Keep the library non-empty so nobody decks during a scenario.
  for (let i = 0; i < 20; i++) put(s, owner, 'library', 'Plains');
}

/** A game at the first main phase of turn 1 (p1 active, both players with full control), with exactly the given cards. */
export function scenario(cards: string[], opts: ScenarioOptions = {}): GameState {
  const byHand = new Set(opts.manual ?? []);
  const defs = [...compiledDefs([...new Set([...cards, 'Plains'])].filter((n) => !byHand.has(n))), ...[...byHand].map((n) => compiledDef(n, manualText)), ...(opts.defs ?? [])];
  const deck = Array(40).fill('Plains') as string[];
  const config: GameConfig = {
    seed: opts.seed ?? 'm3-scenario',
    players: [
      { name: 'Alice', deck, stops: { ...FULL, ...opts.stops } },
      { name: 'Bob', deck, stops: { ...FULL, ...opts.stops } },
    ],
    defs,
    options: { startingPlayer: 'p1', skipMulligans: true, ...(opts.life !== undefined ? { startingLife: opts.life } : {}) },
  };
  let s = createGame(config);
  s = clone(s);
  setup(s, 'p1', opts.p1);
  setup(s, 'p2', opts.p2);
  // Turn 1: priority in upkeep, the starting player skips the draw (CR 103.8a), then the first main phase.
  while (s.turn.step !== 'main1') s = act(s, { type: 'pass', player: s.pending!.player });
  return s;
}

export function act(state: GameState, action: Action): GameState {
  const r = applyAction(state, action);
  if (r.error) throw new Error(`Action rejected: ${r.error.message} [${r.error.rules.join(', ')}]`);
  return r.state;
}

export function reject(state: GameState, action: Action): { message: string; rules: string[] } {
  const r = applyAction(state, action);
  if (!r.error) throw new Error(`Expected the action to be rejected: ${JSON.stringify(action)}`);
  expectUnchanged(state, r.state);
  return r.error;
}

function expectUnchanged(before: GameState, after: GameState): void {
  if (before !== after) throw new Error('A rejected action must return the very same state object');
}

export function answer(state: GameState, a: DecisionAnswer): GameState {
  const d = state.pending;
  if (!d) throw new Error('No pending decision');
  return act(state, { type: 'answer', player: d.player, decisionId: d.id, answer: a });
}

/** Find the first object with this name in a zone. */
export function find(s: GameState, name: string, zone: ZoneKind, owner?: PlayerId): ObjectId {
  const ids: ObjectId[] = zone === 'battlefield' || zone === 'stack' || zone === 'exile' ? s.zones[zone] : Object.values(s.zones[zone]).flat();
  const hit = ids.find((id) => {
    const o = s.objects[id]!;
    return s.defs[o.defId]!.name === name && (!owner || o.owner === owner);
  });
  if (!hit) throw new Error(`No ${name} in ${zone}`);
  return hit;
}

export function findAll(s: GameState, name: string, zone: ZoneKind, owner?: PlayerId): ObjectId[] {
  const ids: ObjectId[] = zone === 'battlefield' || zone === 'stack' || zone === 'exile' ? s.zones[zone] : Object.values(s.zones[zone]).flat();
  return ids.filter((id) => s.objects[id]!.zone === zone && s.defs[s.objects[id]!.defId]!.name === name && (!owner || s.objects[id]!.owner === owner));
}

/**
 * The player who holds priority passes. Once the game is over (`s.result`, and `advance` then clears `s.pending`), nobody can pass any more: the state is
 * returned unchanged, so a helper that passes several times in a row (`passBoth`, a resolve loop) stops cleanly when one of its passes ends the game. Review
 * 2026-10-26 F6: a triggered ability put on the stack starts a new round of passes, so the pass that resolves it (and may end the game) is no longer always the
 * second one of a `passBoth`.
 */
export const pass = (s: GameState): GameState => (s.result || s.pending === null ? s : act(s, { type: 'pass', player: s.pending.player }));

/** Both players pass in succession so the top of the stack resolves (or the step ends if the stack is empty). */
export function passBoth(s: GameState): GameState {
  return pass(pass(s));
}

/** Cast a card (from p1's hand by default) and pay automatically; returns the state with the spell on the stack. */
export function castAuto(s: GameState, name: string, opts: { player?: PlayerId; face?: number; method?: string; answers?: DecisionAnswer[] } = {}): GameState {
  const player = opts.player ?? 'p1';
  const zone: ZoneKind = opts.method === 'flashback' ? 'graveyard' : 'hand';
  const card = find(s, name, zone, player);
  let t = act(s, { type: 'cast', player, card, ...(opts.face !== undefined ? { face: opts.face } : {}), ...(opts.method ? { method: opts.method } : {}) });
  for (const a of opts.answers ?? []) t = answer(t, a);
  while (t.pending && t.pending.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
  return t;
}

export function labels(s: GameState, player: PlayerId): string[] {
  return legalActions(s, player).map((a) => a.label);
}

export function legal(s: GameState, player: PlayerId, kind?: LegalAction['kind']): LegalAction[] {
  return legalActions(s, player).filter((a) => !kind || a.kind === kind);
}

export const pool = (s: GameState, player: PlayerId): string => s.players.find((p) => p.id === player)!.manaPool.map((u) => u.type).sort().join('');
export const life = (s: GameState, player: PlayerId): number => s.players.find((p) => p.id === player)!.life;
export const isTapped = (s: GameState, id: ObjectId): boolean => s.objects[id]!.tapped;
export const zoneNames = (s: GameState, zone: 'hand' | 'graveyard' | 'library', player: PlayerId): string[] => s.zones[zone][player]!.map((id) => s.objects[s.objects[id]!.id]!.defId);
export const battlefieldNames = (s: GameState, player?: PlayerId): string[] => s.zones.battlefield.filter((id) => !player || s.objects[id]!.controller === player).map((id) => s.objects[id]!.defId);

/**
 * Pass priority (whoever holds it) until the given turn and step begins; the active player then has priority.
 * Combat declarations that come up on the way are answered with "no attackers" / "no blockers" (milestone 4).
 */
export function advanceTo(s: GameState, turn: number, step: GameState['turn']['step']): GameState {
  let guard = 0;
  while (!(s.turn.number === turn && s.turn.step === step)) {
    if (s.result || ++guard > 500) throw new Error(`Could not reach turn ${turn} ${step}`);
    const d = s.pending;
    if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else s = pass(s);
  }
  return s;
}
