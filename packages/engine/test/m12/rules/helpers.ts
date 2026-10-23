/**
 * M12-2: helpers for the multiplayer rules tests (test/m12/rules/*, docs/design/m12-multiplayer.md 9). A Free-for-All game of 3 or 4 players (CR 806) at
 * the first main phase of turn 1 (Alice active, everyone with full control), with real fixture cards placed into zones (the milestone 3/4 scenario style),
 * driven by real actions and answers through `applyAction`.
 */
import { applyAction, createGame, type CardDef, type DecisionAnswer, type GameConfig, type GameEvent, type GameState, type PlayerId } from '../../../src/index';
import { clone } from '../../../src/util/clone';
import { compiledDefs } from '../../fixtures';
import { act, answer, put, type PutOptions } from '../../m3/scenario';
import { FREE_FOR_ALL } from '../skeleton/helpers';

export { act, answer, find, findAll, pass, put, reject } from '../../m3/scenario';
export { FREE_FOR_ALL };

type Zones = Partial<Record<'hand' | 'battlefield' | 'graveyard' | 'library' | 'exile', (string | PutOptions)[]>>;

export const PLAYERS: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4'];
const NAMES = ['Alice', 'Bob', 'Carol', 'Dan'];

export interface MpScenario {
  /** 3 or 4 (default 4). */
  players?: number;
  /** Fixture cards used besides Plains. */
  cards?: string[];
  defs?: CardDef[];
  zones?: Partial<Record<PlayerId, Zones>>;
  seed?: string;
  life?: number;
  /** Extra game options (a Commander game, ...). */
  options?: Partial<GameConfig['options']>;
  /** Each player's commanders (a Commander game: also pass `options.commander`). */
  commanders?: Partial<Record<PlayerId, CardDef[]>>;
  /** Called after the cards are placed, before the game moves on to the main phase (attach an Aura, set a controller...). */
  setup?: (s: GameState) => void;
  /** Players WITHOUT full control (their stops are the defaults). */
  autoPass?: PlayerId[];
}

/** The configuration of a multiplayer scenario (decks of 40 Plains). */
export function mpConfig(o: MpScenario = {}): GameConfig {
  const n = o.players ?? 4;
  const defs = [...compiledDefs([...new Set(['Plains', ...(o.cards ?? [])])]), ...(o.defs ?? []), ...Object.values(o.commanders ?? {}).flatMap((x) => x ?? [])];
  const deck = Array(40).fill('Plains') as string[];
  return {
    seed: o.seed ?? 'm12-rules',
    players: NAMES.slice(0, n).map((name, i) => ({
      name, deck, stops: o.autoPass?.includes(PLAYERS[i]!) ? {} : { fullControl: true },
      ...(o.commanders?.[PLAYERS[i]!] ? { commanders: o.commanders[PLAYERS[i]!]!.map((d) => d.id) } : {}),
    })),
    defs: [...new Map(defs.map((d) => [d.id, d])).values()],
    options: { multiplayer: FREE_FOR_ALL, startingPlayer: 'p1', skipMulligans: true, ...(o.life !== undefined ? { startingLife: o.life } : {}), ...(o.options ?? {}) },
  };
}

/** A multiplayer game at the first main phase of turn 1 (Alice active), with exactly the given cards. */
export function mpScenario(o: MpScenario = {}): GameState {
  const cfg = mpConfig(o);
  let s = clone(createGame(cfg));
  for (const p of s.players.map((x) => x.id)) {
    for (const z of ['hand', 'library'] as const) {
      for (const id of s.zones[z][p]!) delete s.objects[id];
      s.zones[z][p] = [];
    }
    const zones = o.zones?.[p];
    for (const name of ['library', 'hand', 'graveyard', 'battlefield', 'exile'] as const) for (const spec of zones?.[name] ?? []) put(s, p, name, spec);
    for (let i = 0; i < 20; i++) put(s, p, 'library', 'Plains');
  }
  o.setup?.(s);
  while (s.turn.step !== 'main1') s = act(s, { type: 'pass', player: s.pending!.player });
  return s;
}

/** Apply an action that must be legal; returns the state and the events. */
export function step(s: GameState, action: Parameters<typeof applyAction>[1]): { state: GameState; events: GameEvent[] } {
  const r = applyAction(s, action);
  if (r.error) throw new Error(`Action rejected: ${r.error.message} [${r.error.rules.join(', ')}]`);
  return { state: r.state, events: r.events };
}

/** The player concedes (CR 104.3a). */
export const concede = (s: GameState, player: PlayerId): { state: GameState; events: GameEvent[] } => step(s, { type: 'concede', player });

export const playerOf = (s: GameState, id: PlayerId) => s.players.find((p) => p.id === id)!;
export const lifeOf = (s: GameState, id: PlayerId): number => playerOf(s, id).life;
export const logHas = (s: GameState, re: RegExp, rule?: string): boolean => s.log.some((l) => re.test(l.text) && (!rule || (l.rules ?? []).includes(rule)));
export const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
export const namesOn = (s: GameState, controller?: PlayerId): string[] =>
  s.zones.battlefield.filter((id) => !controller || s.objects[id]!.controller === controller).map((id) => nameOf(s, id));
/** Every object owned by the player, in any zone. */
export const ownedBy = (s: GameState, p: PlayerId): string[] => Object.values(s.objects).filter((o) => o.owner === p).map((o) => o.id);

/** Answer the pending decisions in order, paying costs automatically; stops at priority or when the answers run out. */
export function drive(s: GameState, answers: DecisionAnswer[] = []): GameState {
  let t = s;
  let i = 0;
  while (t.pending && t.pending.kind !== 'priority') {
    if (t.pending.kind === 'payCost' && answers[i]?.kind !== 'payCost') { t = answer(t, { kind: 'payCost', auto: true }); continue; }
    if (t.pending.kind === 'order' && answers[i]?.kind !== 'order') { t = answer(t, { kind: 'order', ids: t.pending.items.map((x) => x.id) }); continue; }
    const a = answers[i++];
    if (!a) break;
    t = answer(t, a);
  }
  return t;
}

/** Everyone passes in turn until the stack is empty (decisions answered by `answers` in order, costs paid automatically). */
export function resolveStack(s: GameState, answers: DecisionAnswer[] = []): GameState {
  let t = s;
  const queue = [...answers];
  for (let i = 0; i < 200 && t.zones.stack.length > 0 && !t.result; i++) {
    if (t.pending?.kind === 'priority') t = act(t, { type: 'pass', player: t.pending.player });
    while (t.pending && t.pending.kind !== 'priority') {
      if (t.pending.kind === 'payCost') { t = answer(t, { kind: 'payCost', auto: true }); continue; }
      if (t.pending.kind === 'order') { t = answer(t, { kind: 'order', ids: t.pending.items.map((x) => x.id) }); continue; }
      const a = queue.shift();
      if (!a) return t;
      t = answer(t, a);
    }
  }
  return t;
}

/** Pass priority (whoever holds it) until `done`; fails at another decision. */
export function passUntil(s: GameState, done: (s: GameState) => boolean, what: string, max = 200): GameState {
  let t = s;
  for (let i = 0; i < max; i++) {
    if (done(t)) return t;
    if (t.result) throw new Error(`The game ended while waiting for ${what}`);
    // no attack on the way; M12-3: but what a requirement makes a creature attack (goad, CR 701.15b, 508.1d): the decision's example of an obeying declaration
    if (t.pending?.kind === 'declareAttackers') { t = answer(t, { kind: 'declareAttackers', attacks: t.pending.obeying ?? [] }); continue; }
    if (t.pending?.kind === 'declareBlockers') { t = answer(t, { kind: 'declareBlockers', blocks: [] }); continue; }
    if (t.pending!.kind !== 'priority') throw new Error(`Waiting for ${what} but a ${t.pending!.kind} decision of ${t.pending!.player} is pending: ${t.pending!.prompt}`);
    t = act(t, { type: 'pass', player: t.pending!.player });
  }
  throw new Error(`Never reached ${what}`);
}
