/**
 * M12-2 (docs/design/m12-multiplayer.md 8, 9): the multiplayer soak. Seeded random bots (test/m3/bot.ts) play 3- and 4-player Free-for-All games with real
 * fixture cards, the M12 acceptance cards among them, and concede at random moments: while they or another player hold priority (mid-round) and while
 * another player's action waits for a decision (mid-action, m12 design D11). Checks that
 *  - the engine never throws and every action the bots take is accepted,
 *  - every action `legalActions` lists is accepted (sampled),
 *  - after every action: zones and objects agree, no object of a player who left is anywhere in the game (CR 800.4a), no decision is pending for a player
 *    who left (CR 800.4f-h), the player with priority is in the game (CR 800.4a, 800.4j),
 *  - replaying the action log reproduces the final state exactly (determinism, D11's re-runs included),
 * and reports the median and 99th percentile time of one action (design 8: target under 10 ms median).
 * Two games always run; OPENMTG_SLOW=1 runs twelve (six with 3 players, six with 4), the M12-0 probe's count.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, legalActions, replay, type Action, type GameConfig, type GameState } from '../../src/index';
import { compiledDefs } from '../fixtures';
import { Bot } from '../m3/bot';
import { SLOW } from '../slow';
import { FREE_FOR_ALL } from './skeleton/helpers';

const DECK: [string, number][] = [
  ['Forest', 4], ['Mountain', 4], ['Plains', 4], ['Island', 3], ['Swamp', 4],
  ['Llanowar Elves', 2], ['Grizzly Bears', 3], ['Hill Giant', 2], ['Serra Angel', 1], ['Typhoid Rats', 1], ['Raging Goblin', 2], ['Giant Spider', 1],
  ['Lightning Bolt', 2], ['Shock', 2], ['Giant Growth', 1], ['Murder', 1], ['Counterspell', 1], ['Fog', 1], ['Raise the Alarm', 1], ['Doomed Traveler', 1],
  // the acceptance cards of m12 design 3 that the engine plays in full
  ['Zulaport Cutthroat', 1], ['Blood Artist', 1], ['Smothering Tithe', 1], ['Rhystic Study', 1], ['Grave Pact', 1], ['Dictate of Erebos', 1],
  ['Mind Control', 1], ['Act of Treason', 1], ['Captivating Crew', 1], ['Seasoned Dungeoneer', 1], ['Pacifism', 1],
];

const NAMES = ['Alice', 'Bob', 'Carol', 'Dan'];

function config(seed: string, players: number, fullControl: boolean): GameConfig {
  const deck = DECK.flatMap(([n, c]) => Array<string>(c).fill(n));
  return {
    seed,
    players: NAMES.slice(0, players).map((name) => ({ name, deck, stops: { ownTurn: ['main1', 'main2'], opponentTurn: ['declareAttackers', 'end'], fullControl } })),
    defs: compiledDefs([...new Set(DECK.map(([n]) => n))]),
    options: { multiplayer: FREE_FOR_ALL },
  };
}

/** Structural and multiplayer invariants of a state (plain checks: vitest expect() is too slow here). */
function checkInvariants(s: GameState, where: string): void {
  const fail = (msg: string): never => {
    throw new Error(`${where}: invariant violated: ${msg}`);
  };
  const seen = new Set<string>();
  const note = (zone: string, ids: string[]): void => {
    for (const id of ids) {
      const o = s.objects[id];
      if (!o) fail(`${id} listed in ${zone} but missing from objects`);
      if (seen.has(id)) fail(`${id} is listed twice`);
      seen.add(id);
      if (o!.zone !== zone) fail(`${id} says it is in ${o!.zone} but is listed in ${zone}`);
    }
  };
  for (const p of s.players) for (const z of ['library', 'hand', 'graveyard'] as const) note(z, s.zones[z][p.id]!);
  for (const z of ['battlefield', 'stack', 'exile', 'command'] as const) note(z, s.zones[z]);
  for (const id of Object.keys(s.objects)) if (!seen.has(id)) fail(`${id} is in no zone`);
  if (!s.result && s.pending === null) fail('a decision must be pending while the game runs');
  if (s.result) return; // a game that is over keeps its last board (m12 design D8)
  const left = new Set(s.players.filter((p) => p.hasLost).map((p) => p.id));
  for (const p of s.players) if (p.hasLost !== (p.left !== undefined)) fail(`${p.id}: hasLost and left disagree in a game that goes on`);
  for (const o of Object.values(s.objects)) {
    if (left.has(o.owner)) fail(`${o.id} (${o.defId}) is owned by ${o.owner}, who left the game (CR 800.4a)`);
    if ((o.zone === 'battlefield' || o.zone === 'stack') && left.has(o.controller)) fail(`${o.id} (${o.defId}) is controlled by ${o.controller}, who left the game (CR 800.4a)`);
  }
  if (s.pending && left.has(s.pending.player)) fail(`a ${s.pending.kind} decision is pending for ${s.pending.player}, who left the game (CR 800.4f-h)`);
  if (s.priority.player !== null && left.has(s.priority.player)) fail(`${s.priority.player} has priority but left the game (CR 800.4a)`);
  for (const a of s.combat?.attackers ?? []) if (a.defender !== null && left.has(a.defender)) fail(`an attacker attacks ${a.defender}, who left the game (CR 800.4e)`);
}

interface Run {
  config: GameConfig;
  actions: Action[];
  final: GameState;
  times: number[];
  listed: number;
  concededMidRound: number;
  concededMidAction: number;
  leftPlayers: number;
  turns: number;
}

function playGame(index: number, players: number, budget: number): Run {
  const seed = `soak4-${players}-${index}`;
  const cfg = config(seed, players, index % 2 === 0);
  const bot = new Bot(seed);
  let s = createGame(cfg);
  const actions: Action[] = [];
  const times: number[] = [];
  let listed = 0;
  let midRound = 0;
  let midAction = 0;
  let priorities = 0;
  for (let i = 0; i < budget && !s.result; i++) {
    const d = s.pending!;
    let action: Action;
    const inGame = s.players.filter((p) => !p.hasLost).map((p) => p.id);
    // Somebody concedes now and then: about once in 300 priority actions (mid-round), once in 40 other decisions (mid-action; m12 design D11, D12).
    if (inGame.length > 2 && s.turn.number > 0 && bot.int(d.kind === 'priority' ? 300 : 40) === 0) {
      const who = bot.pick(inGame);
      action = { type: 'concede', player: who };
      if (d.kind === 'priority') midRound++;
      else midAction++;
    } else {
      if (d.kind === 'priority' && priorities++ % 4 === 0) {
        for (const la of legalActions(s, d.player)) {
          const r = applyAction(s, la.action);
          if (r.error) throw new Error(`${seed}, action ${i}: listed action "${la.label}" was rejected: ${r.error.message}`);
          listed++;
        }
      }
      action = bot.next(s);
    }
    const t0 = performance.now();
    const r = applyAction(s, action);
    times.push(performance.now() - t0);
    if (r.error) throw new Error(`${seed}, action ${i}: ${JSON.stringify(action)} was rejected: ${r.error.message} (${r.error.rules.join(', ')})`);
    s = r.state;
    actions.push(action);
    checkInvariants(s, `${seed}, action ${i} (${action.type})`);
  }
  return { config: cfg, actions, final: s, times, listed, concededMidRound: midRound, concededMidAction: midAction, leftPlayers: s.players.filter((p) => p.left).length, turns: s.turn.number };
}

const percentile = (xs: number[], p: number): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
};

describe('M12-2: the multiplayer soak (3 and 4 players, random concessions)', () => {
  const runs: Run[] = [];
  const games: [number, number][] = SLOW ? [0, 1, 2, 3, 4, 5].flatMap((i) => [[i, 3], [i, 4]] as [number, number][]) : [[0, 3], [1, 4]];
  const budget = SLOW ? 2500 : 700;

  it(`plays ${games.length} games with 0 engine errors; no object or decision of a player who left survives`, async () => {
    for (const [i, n] of games) {
      runs.push(playGame(i, n, budget));
      await new Promise((resolve) => setTimeout(resolve, 0)); // keep the worker's RPC answered (as the M3 soak)
    }
    const times = runs.flatMap((r) => r.times);
    const sum = (k: 'listed' | 'concededMidRound' | 'concededMidAction' | 'leftPlayers' | 'turns'): number => runs.reduce((n, r) => n + r[k], 0);
    console.log('soak4:', runs.length, 'games,', times.length, 'actions,', sum('turns'), 'turns,', sum('listed'), 'listed actions accepted,',
      sum('concededMidRound'), 'concessions mid-round,', sum('concededMidAction'), 'mid-action,', sum('leftPlayers'), 'players left while the game went on,',
      runs.reduce((n, r) => n + r.final.log.filter((l) => /action in progress is taken back/.test(l.text)).length, 0), 'suspended actions rolled back (the others re-ran),',
      runs.filter((r) => r.final.result).length, 'games ended; action time median', percentile(times, 50).toFixed(2), 'ms, p99', percentile(times, 99).toFixed(2), 'ms');
    expect(times.length).toBeGreaterThan(games.length * 100);
    expect(sum('leftPlayers')).toBeGreaterThan(0);
  }, SLOW ? 900_000 : 180_000);

  it('replaying each action log reproduces the final state exactly (CR determinism; m12 design D11 re-runs included)', () => {
    expect(runs.length).toBe(games.length);
    for (const r of runs) {
      const { state, errors } = replay(r.config, r.actions);
      expect(errors).toEqual([]);
      expect(JSON.stringify(state)).toBe(JSON.stringify(r.final));
    }
  }, SLOW ? 600_000 : 120_000);
});
