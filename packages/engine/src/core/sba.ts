/**
 * State-based actions (CR 704) and the end of the game (CR 104). Checked whenever a player would receive priority (CR 117.5),
 * all applicable ones performed simultaneously as a single event (CR 704.3), repeated until none apply.
 * The object state-based actions (704.5d-z) are in core/sba-objects.ts.
 */
import { playerRestricted } from '../rules/restrictions';
import { losesForZeroLife } from '../statics/hooks';
import type { Game } from './game';
import type { GameState } from '../types/state';
import { performObjectSbas } from './sba-objects';
import { dungeonSbas } from './dungeons';
import { startEngines } from './designations';
import { charsOfObject, hasKeyword, readingStable } from '../rules/characteristics';

/** CR 702.179: the keyword's canonical name (keywords/data/start-your-engines.json). */
const START_YOUR_ENGINES = 'start your engines!';
import { IMMEDIATE_CHECKS } from '../effects/registries';
import { commanderDamageLoss, commanderZoneChoices, revealTurnedFaceUp } from './sba-commander';
import { leavePending, noteLoser } from './leave';

/** Returns true if any state-based action was performed. */
export function performStateBasedActions(g: Game): boolean {
  for (const check of IMMEDIATE_CHECKS) check(g); // M6-0 (m6 design 2.6): checks that happen "immediately" (CR 702.145c-d, f-g; M6-4), first in each check
  let any = false;
  revealTurnedFaceUp(g); // M11-1 review: a face-down commander turned face up: its combat damage becomes public (CR 708.8, 903.10a)
  // Player-loss SBAs are checked together (CR 704.3: simultaneously).
  const losers: { id: string; reason: string; rule: string }[] = [];
  for (const p of g.s.players) {
    if (p.hasLost) continue;
    // r3-static (CR 704.5a, 104.3b): "You don't lose the game for having 0 or less life": the player's other losses are still checked
    if (p.life <= 0 && losesForZeroLife(g.s, p.id)) losers.push({ id: p.id, reason: 'has 0 or less life', rule: 'CR 704.5a' });
    else if (p.drewFromEmptyLibrary) losers.push({ id: p.id, reason: 'attempted to draw from an empty library', rule: 'CR 704.5b' });
    else if (p.poison >= 10) losers.push({ id: p.id, reason: 'has ten or more poison counters', rule: 'CR 704.5c' });
    else {
      const commander = commanderDamageLoss(g.s, p.id); // M11-1: CR 704.6c, 903.10a (core/sba-commander.ts)
      if (commander) losers.push({ id: p.id, reason: commander, rule: 'CR 704.6c' });
    }
  }
  for (const p of g.s.players) p.drewFromEmptyLibrary = false;
  // Mark every loser first so simultaneous losses produce a draw (CR 104.4a). A player who can't lose the game stays in it (CR 104.3b-d with the effect).
  for (const l of losers) {
    if (playerRestricted(g.s, l.id, 'cantLoseGame')) continue;
    markLost(g, l.id, l.reason, [l.rule]);
    any = true;
  }
  if (any) checkGameOver(g);
  if (g.s.result) return true;
  // M11-1: CR 704.6d, 903.9a: the commanders put into a graveyard or exile since the last check (asked before this check's own actions move anything)
  if (commanderZoneChoices(g)) any = true;
  if (performObjectSbas(g)) any = true; // CR 704.5d-z
  if (dungeonSbas(g)) any = true; // MX4: CR 704.5t, completed dungeons leave the game
  if (speedSba(g)) any = true; // CR 704.5aa
  return any;
}

/**
 * Can any object of this game have start your engines! (printed, in a granted ability or a token's definition)? Memoized per definition map (copy-on-write,
 * core/game.ts#addDef), so a game without the keyword pays for one look, never for characteristics in every state-based action check.
 */
const ENGINES_DEFS = new WeakMap<GameState['defs'], boolean>();
function enginesInGame(defs: GameState['defs']): boolean {
  let v = ENGINES_DEFS.get(defs);
  if (v === undefined) {
    v = Object.values(defs).some((d) => JSON.stringify(d.faces).includes(`"keyword":"${START_YOUR_ENGINES}"`));
    ENGINES_DEFS.set(defs, v);
  }
  return v;
}

/**
 * FAST5X-4, CR 704.5aa (702.179a): a player who controls a permanent with start your engines! and has no speed gets speed 1. Speed never goes away again
 * (CR 702.179b): losing the permanent later changes nothing.
 */
function speedSba(g: Game): boolean {
  const s = g.s;
  let any = false;
  const ids = s.zones.battlefield;
  if (ids.length === 0 || !enginesInGame(s.defs)) return false;
  for (const p of s.players) {
    if (p.hasLost || s.designations.speed?.[p.id] !== undefined) continue;
    const has = readingStable(s, () => ids.some((id) => {
      const o = s.objects[id];
      if (!o || o.phasedOut) return false; // CR 702.26b: a phased-out permanent is treated as though it does not exist
      const c = charsOfObject(s, o);
      return c.controller === p.id && hasKeyword(c, START_YOUR_ENGINES);
    }));
    if (has && startEngines(g, p.id)) any = true;
  }
  return any;
}

/** CR 104.3: a player loses the game (an effect, a state-based action...). "You can't lose the game" prevents it. */
export function loseGame(g: Game, player: string, reason: string, rules: string[]): void {
  if (playerRestricted(g.s, player, 'cantLoseGame')) {
    g.log(`${g.player(player).name} can't lose the game.`, { rules: ['CR 104.3'], level: 'info' });
    return;
  }
  markLost(g, player, reason, rules);
  checkGameOver(g);
}

/**
 * M12-2 (m12 design D8, E7): several players lose the game by one effect (CR 104.3e) in a multiplayer game: each is marked (one who can't lose the game stays,
 * CR 104.3b), then the game is checked ONCE, so the players who lost together leave together (CR 104.4a, 800.4a; core/leave.ts). A two-player game keeps
 * the one-by-one `loseGame` calls of effects/handlers/game.ts (its log is unchanged, D16).
 */
export function loseGames(g: Game, players: readonly string[], reason: string, rules: string[]): void {
  for (const player of players) {
    if (playerRestricted(g.s, player, 'cantLoseGame')) {
      g.log(`${g.player(player).name} can't lose the game.`, { rules: ['CR 104.3'], level: 'info' });
      continue;
    }
    markLost(g, player, reason, rules);
  }
  checkGameOver(g);
}

/** CR 104.3a: conceding leaves the game at once; no effect can stop it. */
export function concedeGame(g: Game, player: string): void {
  g.player(player).conceded = true;
  markLost(g, player, 'conceded', ['CR 104.3a']);
  checkGameOver(g);
}

/**
 * CR 104.2b: "[a player] wins the game". Every opponent loses the game (an opponent who can't lose the game stays in it, so the game goes on);
 * a player who can't win the game doesn't win; a player who has already lost can't win (CR 104.3f).
 */
export function winGame(g: Game, player: string, reason: string, rules: string[] = ['CR 104.2b']): void {
  const p = g.player(player);
  if (p.hasLost || g.s.result) return;
  if (playerRestricted(g.s, player, 'cantWinGame')) {
    g.log(`${p.name} can't win the game.`, { rules: ['CR 104.2b'], level: 'info' });
    return;
  }
  // The win is announced only once the game is over: an opponent who can't lose the game stays in it (CR 104.3b), and then nobody has won yet.
  const losers = g.s.players.filter((other) => other.id !== player && !other.hasLost);
  for (const other of losers) {
    if (playerRestricted(g.s, other.id, 'cantLoseGame')) {
      g.log(`${other.name} can't lose the game.`, { rules: ['CR 104.3'], level: 'info' });
      continue;
    }
    markLost(g, other.id, `${p.name} won the game`, rules);
  }
  checkGameOver(g);
  const result = g.s.result as { winner: string | null } | null; // (checkGameOver may have set it)
  if (result?.winner === player) g.log(`${p.name} wins the game: ${reason}.`, { rules, level: 'action' });
}

/** CR 104.4c: an effect states that the game is a draw. */
export function drawGame(g: Game, reason: string, rules: string[] = ['CR 104.4c']): void {
  if (g.s.result) return;
  g.s.result = { winner: null, reason };
  g.s.stage = 'over';
  g.log(`The game is a draw: ${reason}.`, { rules, level: 'action' });
  g.emit({ type: 'gameOver', winner: null, reason });
}

function markLost(g: Game, player: string, reason: string, rules: string[]): void {
  const p = g.player(player);
  if (p.hasLost) return;
  p.hasLost = true;
  p.lostReason = reason;
  g.log(`${p.name} loses the game: ${reason}.`, { rules, level: 'warning' });
  g.emit({ type: 'playerLost', player, reason, rules: [...rules] }); // M13-7: the citations of the loss (the hosted results ledger's loss codes)
  noteLoser(g, { player, reason, rules }); // M12-2: in a multiplayer game the player leaves it (CR 104.5, 800.4a) when the game is checked (core/leave.ts)
}

/** CR 104.2a: the last player remaining wins; CR 104.4a: if all players remaining lose simultaneously the game is a draw. */
export function checkGameOver(g: Game): void {
  if (g.s.result) {
    leavePending(g); // M12-2: the game is over: nobody leaves (m12 design D8)
    return;
  }
  const alive = g.s.players.filter((p) => !p.hasLost);
  if (alive.length === 1) {
    const w = alive[0]!;
    g.s.result = { winner: w.id, reason: `${w.name} is the last player remaining` };
    g.s.stage = 'over';
    g.log(`${w.name} wins the game.`, { rules: ['CR 104.2a'], level: 'action' });
    g.emit({ type: 'gameOver', winner: w.id, reason: g.s.result.reason });
  } else if (alive.length === 0) {
    g.s.result = { winner: null, reason: 'all players lost simultaneously' };
    g.s.stage = 'over';
    g.log('The game is a draw.', { rules: ['CR 104.4a'], level: 'action' });
    g.emit({ type: 'gameOver', winner: null, reason: g.s.result.reason });
  }
  // M12-2 (m12 design D8): the game goes on: the players who lost since the last check leave it, together (CR 104.5, 800.4a; core/leave.ts). Nothing is
  // noted in a two-player game, which is over when a player loses (CR 104.2a).
  leavePending(g);
}
