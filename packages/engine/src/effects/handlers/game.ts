/**
 * Op handlers: the game itself (CR 104, 114, 500.7, 705, 706, 701.x actions). Owner: WP15. WP0 wrote the empty table the aggregator (handlers/index.ts) spreads into OP_HANDLERS; the capability `op:<op>` appears
 * only when the op has a handler here AND a renderer (design 5.2), so an unfinished package can never make a card wrongly automated.
 * Ops: extraTurn controlPlayer extraPhase endTurn winGame loseGame createEmblem rollDie flipCoin designate action.
 *
 * State changes go through their one writer each: the proposal pipeline for the objects that leave the stack when the turn is ended (CR 724.1b), core/sba.ts for
 * winning and losing (CR 104), core/turn-effects.ts for the turn structure, core/emblems.ts, core/designations.ts, core/dice.ts for the die and the coin
 * (the state's RNG, design 8.8 rule 2; it emits their events: the handlers emit nothing, design 8.6). A form this build cannot carry out is resolved by hand
 * (`askManual`), never skipped.
 */
import { flipCoin, rollDice } from '../../core/dice';
import { createEmblem } from '../../core/emblems';
import { giveCitysBlessing } from '../../core/citys-blessing';
import { increaseSpeed, reduceSpeed, setDayNight, setMonarch, takeInitiative, INITIATIVE_SOURCE, MONARCH_SOURCE } from '../../core/designations';
import { drawGame, loseGame, loseGames, winGame } from '../../core/sba';
import { collectPendingTriggers } from '../../core/triggers';
import { addExtraPhase, addExtraTurns, dropPendingTriggers, markTurnEnding } from '../../core/turn-effects';
import { addPlayerControl } from '../../core/player-control';
import { ACTION_MACROS, UNREGISTERED_ACTIONS } from '../../keywords/actions';
import { playerRestricted } from '../../rules/restrictions';
import type { EffectStep, ObjRef } from '../../types/ability';
import type { PlayerId } from '../../types/ids';
import type { LinkValue } from '../../types/state';
import type { ExecCtx, OpHandlers, StepResult } from '../api';
import { DIE_RESULT_VAR, EXTRA_TURN_VAR, evalQty } from '../eval';
import { askManual } from '../manual';
import { propose, proposeResult } from '../propose';
import { resolveObjs, resolvePlayers, sourceObject } from '../refs';
import { runSteps } from '../run';
import { NATIVE_ACTIONS } from './actions-native';
import { diceAdvantage, firstCoinFlipsWon } from '../../statics/hooks';
import { macroReplacedByManualText } from './manual-text';

const NOTHING: StepResult = { performed: false, count: 0 };

/**
 * std-rx9 (CR 607.2d, 608.2c): the choices of this resolution the abilities of an emblem name ("the chosen type": a `chosen` filter field or condition, whose link
 * the parser set to an earlier instruction's choice, parser/lower/links.ts#resolveEmblemChoices). Only values chosen during this resolution (`ExecCtx.choices`).
 */
function emblemLinks(cx: ExecCtx, abilities: readonly unknown[]): Record<string, LinkValue> {
  const out: Record<string, LinkValue> = {};
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v === null || typeof v !== 'object') return;
    const n = v as Record<string, unknown>;
    const c = n['chosen'];
    const link = c !== null && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>)['link'] : n['cond'] === 'chosen' ? n['link'] : undefined;
    const value = typeof link === 'string' ? cx.choices?.get(link) : undefined;
    if (typeof link === 'string' && value !== undefined) out[link] = value;
    Object.values(n).forEach(walk);
  };
  walk(abilities);
  return out;
}

/**
 * Cloud r3-mech (CR 705.1-705.2): does the object this flip is for care who wins it through a trigger of its own ("Whenever you win a coin flip, ...", event
 * `coinFlip`: Tavern Scoundrel's "{1}, {T}, Sacrifice another permanent: Flip a coin.", Setzer's "... flip a coin.")? Only the flip's own source counts: a flip
 * for an object that doesn't care is flipped without a call and no player wins or loses it (CR 705.2), so another permanent's "whenever you win a coin flip"
 * never makes it a won flip (the rulings of Zndrsplt and Tavern Scoundrel: a flip with no winner, such as Mana Clash's, doesn't trigger them). Read from the
 * source's card definition (last known information once it has left, CR 608.2h); a coin-flip trigger granted to the source is not seen (the flip stays uncalled).
 */
const sourceWatchesFlips = (cx: ExecCtx): boolean => {
  const o = sourceObject(cx);
  const def = o === undefined ? undefined : cx.g.s.defs[o.defId];
  return def !== undefined && JSON.stringify(def.faces).includes('"ev":"coinFlip"');
};

// MX4: the inherent abilities of the monarch and the initiative have no source object (CR 725.2, 726.2): they are named after the designation
const nameOfSource = (cx: ExecCtx): string => (cx.source.id === INITIATIVE_SOURCE ? 'The initiative' : cx.source.id === MONARCH_SOURCE ? 'The monarch' : cx.g.nameOf(cx.source.id));

/** The players a reference stands for, in APNAP order (CR 101.4). */
const apnapPlayers = (cx: ExecCtx, ref: Parameters<typeof resolvePlayers>[1]): PlayerId[] => {
  const ps = resolvePlayers(cx, ref);
  return cx.g.apnap().filter((p) => ps.includes(p));
};

const textOf = (step: EffectStep, fallback: string): string => step.span ?? fallback;

/** p2-coinflip-1 (model/cap-walk.ts#stepForms): the value forms of these handlers. */
export const OP_FORMS: readonly string[] = ['op:flipCoin.untilLose', 'op:flipCoin.called'];

/** The most flips "until you lose a flip" makes before it is handed to the player (a fair coin never gets there; a guard only). */
const MAX_FLIPS_UNTIL_LOSE = 200;

/**
 * p2-coinflip-1 (CR 705.1-705.2): "flip a coin until you lose a flip" (Okaun, Eye of Chaos; Toothy and Zndrsplt): the player flips and calls one coin at a time
 * until they lose one; each won flip is a won flip as it happens (its "whenever a player wins a coin flip" triggers wait for the resolution, CR 603.3). Under
 * "the first time you flip one or more coins each turn, those coins come up heads and you win those flips" every flip of this first instruction would be won and
 * the flips would never end (a loop no player can stop, CR 104.4b): that case, and a guard against a runaway loop, is handed to the player (fail closed).
 */
function flipUntilLose(cx: Parameters<typeof askManual>[0], step: Extract<EffectStep, { op: 'flipCoin' }>, players: readonly PlayerId[]): ReturnType<typeof askManual> {
  const g = cx.g;
  const text = textOf(step, 'flip a coin until you lose a flip');
  if (players.length !== 1 || step.count !== undefined || step.onWin !== undefined || step.onLose !== undefined) return askManual(cx, text, 'a flip until a loss by one player only, without a count or win / lose instructions');
  const p = players[0]!;
  const stats = g.player(p).turnStats;
  if ((stats.coinFlips ?? 0) === 0 && firstCoinFlipsWon(g.s, p)) return askManual(cx, text, 'the coins of this flip all come up heads and are won: the flips never end (CR 705.2, 104.4b)');
  stats.coinFlips = (stats.coinFlips ?? 0) + 1;
  let won = 0;
  for (let k = 0; k < MAX_FLIPS_UNTIL_LOSE; k++) {
    const call = g.choose({
      kind: 'chooseOption', player: p, prompt: 'Call the coin flip.', min: 1, max: 1,
      options: [{ id: 'heads', label: 'Heads' }, { id: 'tails', label: 'Tails' }], rules: ['CR 705.2'],
    }).ids[0] as 'heads' | 'tails';
    if (flipCoin(g, p, call).won !== true) return { performed: true, count: won };
    won++;
  }
  return askManual(cx, text, `${MAX_FLIPS_UNTIL_LOSE} flips won in a row: the rest is handed to the player`);
}

export const GAME_HANDLERS: OpHandlers = {
  /** CR 500.7: extra turns after this one, added one at a time in APNAP order; the most recently created is taken first. */
  extraTurn: (cx, step) => {
    const n = evalQty(cx, step.count);
    if (n === undefined) return NOTHING; // CR 608.2b
    const k = Math.max(0, Math.floor(n));
    const players = apnapPlayers(cx, step.who);
    const ids = players.flatMap((p) => addExtraTurns(cx.g, p, k));
    cx.vars.set(EXTRA_TURN_VAR, ids.length === 1 ? ids[0]! : -1); // audit-fix-2: "During that turn" names exactly one turn (CR 500.7, 611.2a)
    return { performed: k > 0 && players.length > 0, count: k * players.length };
  },

  /** std-control-3 (CR 723.1): the controller controls each of those players during their next turn or combat phase; a player can't be made to control themselves. */
  controlPlayer: (cx, step) => {
    const players = apnapPlayers(cx, step.who).filter((p) => p !== cx.controller && cx.g.player(p).hasLost !== true);
    for (const p of players) addPlayerControl(cx.g, cx.controller, p, step.during, nameOfSource(cx));
    return { performed: players.length > 0, count: players.length };
  },

  /** CR 500.8: an additional phase directly after this phase (or after the phase `after` names). */
  extraPhase: (cx, step) => {
    // std-rq (CR 500.8, 508.1): "Only land creatures can attack during that combat phase" (read for this effect's controller and source)
    const attackers = step.attackers !== undefined && step.phase === 'combat' ? { filter: step.attackers, controller: cx.controller, ...(cx.source ? { sourceId: cx.source.id } : {}) } : undefined;
    addExtraPhase(cx.g, step.phase, step.after, attackers);
    // r4-mech (CR 500.8): "... followed by an additional main phase": a main phase directly after the added combat phase (the latest added phase after a combat
    // phase is taken first as that combat phase ends, core/turn-effects.ts#takeExtraPhase)
    if (step.followedBy === 'main' && step.phase === 'combat') addExtraPhase(cx.g, 'main', 'endCombat');
    return { performed: true, count: 1 };
  },

  /**
   * CR 724.1: end the turn. 724.1a: triggered abilities waiting to be put on the stack cease to exist (what has triggered so far is collected first, so it is
   * among them); 724.1b: every object on the stack is exiled, the resolving one included (each move is proposed: CR 614 replacements still apply); 724.1c-f
   * happen in the turn loop (core/turn.ts): no priority, the current step ends, straight to the cleanup step.
   */
  endTurn: (cx) => {
    const g = cx.g;
    collectPendingTriggers(g);
    dropPendingTriggers(g);
    const onStack = g.s.zones.stack; // read only: the copy below is reversed, not the zone (design 8.5 lint)
    for (const id of [...onStack].reverse()) {
      if (g.s.objects[id]?.zone !== 'stack') continue;
      propose(g, { ev: 'zoneChange', object: { id, zone: 'stack' }, from: 'stack', to: 'exile', destination: {} });
    }
    markTurnEnding(g);
    g.log(`${nameOfSource(cx)} ends the turn.`, { rules: ['CR 724.1', 'CR 724.1b'], level: 'action' });
    return { performed: true, count: 1 };
  },

  /** CR 104.2b: the player wins the game (every opponent loses it; "can't win" and "can't lose" are respected in core/sba.ts). */
  winGame: (cx, step) => {
    const players = apnapPlayers(cx, step.who);
    for (const p of players) winGame(cx.g, p, `${nameOfSource(cx)}'s effect`, ['CR 104.2b']);
    return { performed: players.length > 0, count: players.length };
  },

  /** CR 104.3e: the player loses the game. Every player still in the game losing at once is a draw (CR 104.4a). */
  loseGame: (cx, step) => {
    const g = cx.g;
    const players = apnapPlayers(cx, step.who);
    const reason = `${nameOfSource(cx)}'s effect`;
    const remaining = g.s.players.filter((p) => !p.hasLost);
    if (players.length > 1 && remaining.every((p) => players.includes(p.id) && !playerRestricted(g.s, p.id, 'cantLoseGame'))) {
      drawGame(g, `every player loses the game at once (${reason})`, ['CR 104.3e', 'CR 104.4a']);
    } else if (g.s.options.multiplayer !== undefined) {
      loseGames(g, players, reason, ['CR 104.3e']); // M12-2 (m12 design D8, E7): they lose together and leave together (CR 104.4a, 800.4a)
    } else {
      for (const p of players) loseGame(g, p, reason, ['CR 104.3e']);
    }
    return { performed: players.length > 0, count: players.length };
  },

  /** CR 114.2: the player gets an emblem with these abilities, in the command zone. */
  createEmblem: (cx, step) => {
    const players = apnapPlayers(cx, step.who);
    const links = emblemLinks(cx, step.abilities);
    for (const p of players) createEmblem(cx.g, p, step.abilities, nameOfSource(cx), links);
    return { performed: players.length > 0, count: players.length };
  },

  /**
   * CR 706: roll N-sided dice (core/dice.ts, with the state's RNG). The result (the natural result: no modifier exists in this build, 706.2) is kept for
   * `{q:'dieResult'}`; with several dice rolled by one player it is their total (Clown Car). When several players roll, each roll has its own result and none is
   * "the result": `{q:'dieResult'}` then fails to determine (CR 608.2b), never the meaningless sum. A results table (706.3a) runs the row the result falls in;
   * a table for more than one die or one player is resolved by hand (its capability form `op:rollDie.multiTable` is not advertised, model/cap-walk.ts).
   */
  rollDie: (cx, step) => {
    const sides = step.sides;
    const n = step.count ?? 1;
    const players = apnapPlayers(cx, step.who);
    const table = step.table ?? [];
    if (!Number.isInteger(sides) || sides < 1 || !Number.isInteger(n) || n < 0 || (table.length > 0 && (players.length !== 1 || n !== 1))) {
      return askManual(cx, textOf(step, `roll d${sides}`), 'the engine rolls one die for one player with a results table, or dice without one');
    }
    let total = 0;
    // p2-c-dieroll-1 (CR 706.6, 614.1a, unverified): "instead roll that many dice plus one and ignore the lowest roll" (statics/hooks.ts#diceAdvantage); the kept rolls count
    for (const p of players) for (const r of n > 0 ? rollDice(cx.g, p, sides, n, diceAdvantage(cx.g.s, p)) : []) total += r;
    cx.vars.set(DIE_RESULT_VAR, players.length === 1 ? total : Number.NaN); // NaN: no single result (the evaluator reads it as undetermined)
    const row = table.find((r) => total >= r.min && total <= r.max); // CR 706.3a
    if (row) runSteps(cx, row.do);
    return { performed: players.length > 0 && n > 0, count: players.length * n };
  },

  /**
   * CR 705: flip a coin with the state's RNG. When the effect cares who wins (705.2), the player who flips calls heads or tails first and wins if the call
   * matches; then the steps for a won or a lost flip run.
   */
  flipCoin: (cx, step) => {
    const g = cx.g;
    const players = apnapPlayers(cx, step.who);
    // cloud r3-mech (CR 705.1-705.2): the flip is called when the object it is for cares whether a player wins or loses it: its own instructions, or a
    // "whenever you win / lose a coin flip" trigger of that same object (sourceWatchesFlips); any other flip has no winner or loser
    // p2-coinflip-3 (CR 705.2): and a flip whose wins a later instruction counts ("for each flip you win", `called`)
    const cares = (step.onWin?.length ?? 0) > 0 || (step.onLose?.length ?? 0) > 0 || step.called === true || sourceWatchesFlips(cx);
    if (step.untilLose === true) return flipUntilLose(cx, step, players);
    // r4-mech (CR 705.1): "flip five coins": that many flips, one at a time; a branch belongs to a one-coin flip only (lint and the coin-flip fold)
    const coins = step.count ?? 1;
    if ((step.onWin !== undefined || step.onLose !== undefined) && coins !== 1) return askManual(cx, textOf(step, 'flip coins'), 'a coin flip with win or lose instructions flips one coin');
    let won = 0;
    let heads = 0;
    for (const p of players) {
      // r4-mech (CR 705.1-705.2, 614.1a): the first instruction this turn by which p flips coins, under "those coins come up heads and you win those flips"
      const stats = g.player(p).turnStats;
      const rigged = (stats.coinFlips ?? 0) === 0 && firstCoinFlipsWon(g.s, p);
      stats.coinFlips = (stats.coinFlips ?? 0) + 1;
      for (let k = 0; k < coins; k++) {
        if (rigged) {
          flipCoin(g, p, undefined, true);
          won++;
          heads++;
          if (step.onWin && step.onWin.length > 0) runSteps(cx, step.onWin);
          continue;
        }
        const call = cares
          ? g.choose({
            kind: 'chooseOption', player: p, prompt: 'Call the coin flip.', min: 1, max: 1,
            options: [{ id: 'heads', label: 'Heads' }, { id: 'tails', label: 'Tails' }], rules: ['CR 705.2'],
          }).ids[0] as 'heads' | 'tails'
          : undefined;
        const flip = flipCoin(g, p, call); // core/dice.ts flips and emits
        if (flip.side === 'heads') heads++;
        if (call === undefined) continue;
        const wins = flip.won === true;
        if (wins) won++;
        const branch = wins ? step.onWin : step.onLose;
        // std-copy-1 (CR 603.12, 705.2): "When you win the flip, X": a reflexive trigger in the branch waits for the flip, which is done by now (named by `as`)
        if (step.as !== undefined && branch && branch.length > 0) cx.results.set(step.as, { performed: true, count: won });
        if (branch && branch.length > 0) runSteps(cx, branch);
      }
    }
    return { performed: players.length > 0, count: cares ? won : heads };
  },

  /**
   * CR 725.3: the player becomes the monarch; CR 731.1: it becomes day or night; MX4: CR 726.3, the player takes the initiative (its inherent abilities venture
   * into Undercity, CR 726.2, 701.49d). (Day and night are advertised only through their own capabilities, `op:designate.day|night`,
   * because daybound and nightbound, CR 702.145, are not implemented.)
   */
  designate: (cx, step) => {
    const g = cx.g;
    switch (step.what) {
      case 'monarch': {
        const players = resolvePlayers(cx, step.who);
        if (players.length !== 1) return NOTHING; // exactly one player can be the monarch (CR 725.3); an illegal target: nothing (CR 608.2b)
        setMonarch(g, players[0]!);
        return { performed: true, count: 1 };
      }
      case 'initiative': {
        // MX4: CR 726.3, 726.5; taking it triggers "that player ventures into Undercity" (CR 726.2, core/designations.ts)
        const players = resolvePlayers(cx, step.who);
        if (players.length !== 1) return NOTHING; // only one player can have the initiative (CR 726.3)
        return takeInitiative(g, players[0]!) ? { performed: true, count: 1 } : NOTHING;
      }
      case 'day':
      case 'night':
        setDayNight(g, step.what);
        return { performed: true, count: 1 };
      case 'citysBlessing': {
        // CMD3 (CR 702.131a, 702.131c): each player gets it once, for the rest of the game
        const got = resolvePlayers(cx, step.who).filter((p) => giveCitysBlessing(g, p, 'CR 702.131a')).length;
        return got > 0 ? { performed: true, count: got } : NOTHING;
      }
      case 'speed': {
        // FAST5X-4, CR 702.179c: "your speed increases by N" (a player with no speed gets speed N); the inherent ability of speed (CR 702.179d) runs it
        const players = resolvePlayers(cx, step.who);
        let n = 0;
        // std-control-1 (CR 702.179): `decrease` with its floor reduces the speed ("This effect can't reduce their speed below 1")
        if (step.decrease === true || step.floor !== undefined) {
          if (step.decrease !== true || step.floor === undefined) return NOTHING; // not a form any template writes (cap-walk: op:designate.speed.malformed)
          for (const p of players) if (reduceSpeed(g, p, step.by ?? 1, step.floor)) n++;
          return { performed: n > 0, count: n };
        }
        for (const p of players) if (increaseSpeed(g, p, step.by ?? 1)) n++;
        return { performed: n > 0, count: n };
      }
    }
  },

  /**
   * CR 701: a keyword action, carried out by the keyword library's macro over the primitive steps (design 7.5). An action without a macro is resolved by hand
   * with the library's reason. The step's guard was already checked by the interpreter, so the macro gets the step without it. A macro with `native` (cascade,
   * discover, vote) is run by its handler in actions-native.ts (WP32).
   */
  action: (cx, step) => {
    const macro = ACTION_MACROS[step.action];
    const native = macro?.native !== undefined ? NATIVE_ACTIONS[macro.native] : undefined;
    if (macro && native) {
      const { guard: _guard, ...bare } = step;
      cx.g.log(`${nameOfSource(cx)}: ${step.action}.`, { rules: [macro.rule], level: 'info' });
      return native(cx, bare as typeof step);
    }
    if (!macro?.expand) {
      const why = UNREGISTERED_ACTIONS[step.action] ?? 'the keyword library has no macro for it';
      return askManual(cx, textOf(step, step.action), `the keyword action "${step.action}" is not automated: ${why}`);
    }
    // PUSH1 T1: another card's manual text replaces this action ("if a creature you control would explore, instead ...", CR 614.1a): by hand (design 10)
    const replaced = macroReplacedByManualText(cx.g, step.action);
    if (replaced) return askManual(cx, textOf(step, step.action), `${step.action} is replaced by an ability the engine does not run (CR 614.1a), ${replaced}`);
    const { guard: _guard, ...bare } = step;
    // Cloud r3-repl (CR 701.50a, 614.1a): a connive is proposed first, so "If a creature you control would connive, instead ..." replaces it
    // (effects/proposal-kinds/connive.ts); replaced, the macro does not run (the replacement's instructions did instead)
    if (step.action === 'connive') {
      const n = evalQty(cx, step.n ?? 1);
      const who = resolvePlayers(cx, step.who)[0];
      const me = resolveObjs(cx, (step.subject ?? { ref: 'self' }) as ObjRef)[0];
      // merge wave 8 (audit D4, CR 701.50b): a permanent that left the battlefield still connives (its last known information), but it is no longer "a creature
      // you control": no connive replacement applies to it, so only one still on the battlefield is proposed (the handle of one that left keeps its old zone)
      if (n !== undefined && n > 0 && who !== undefined && me !== undefined && me.zone === 'battlefield' && cx.g.s.objects[me.id]?.zone === 'battlefield') {
        const final = proposeResult(cx.g, { ev: 'connive', object: me, player: who, n });
        if (final === null) return { performed: true, count: 1 };
      }
    }
    cx.g.log(`${nameOfSource(cx)}: ${step.action}.`, { rules: [macro.rule], level: 'info' });
    return runSteps(cx, macro.expand(bare));
  },
};
