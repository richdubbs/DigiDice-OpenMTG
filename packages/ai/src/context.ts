/**
 * The bot's reading of the game: one `Ctx` per decision, built from the bot player's own view (`viewFor`). Everything the heuristics know comes from here,
 * so the bot never sees hidden information (CR 400.2): opponents' hands and every library are redacted in the view, and a redacted object has no
 * characteristics (`chars` returns null for it).
 *
 * The engine's read functions (`getChars`, `legalActions`, `manaSources`) are pure and run on the view as they would on a state: a view is a state minus the RNG,
 * the suspended base state and the identity of hidden objects.
 */
import {
  commanderDamageTo, commanderTax, getChars, hasKeyword, isCommander, isSummoningSick, manaSources, ptNumbers, HIDDEN_DEF,
  type Chars, type Decision, type GameState, type GameView, type ObjectId, type PlayerId,
} from '@openmtg/engine';

export interface Ctx {
  view: GameView;
  /** The view read through the engine's pure functions. */
  state: GameState;
  decision: Decision;
  me: PlayerId;
  /**
   * The opponent the bot's single-opponent estimates read. Two-player: the other player, as always. M12-6 (m12 design 7), with two or more opponents
   * still in the game: the **focus**, the opponent with the most power on the battlefield, then the lowest life, then the next in turn order; never a
   * player who left the game (CR 800.4a).
   */
  opp: PlayerId;
  /**
   * M12-6 (m12 design 7, A1): the opponents still in the game (CR 800.4a: a player who left is skipped), in turn order from the bot (CR 101.4, 103.1).
   * Two-player: `[opp]`, so every two-player code path reads the same opponent as before (D16). Every multiplayer heuristic runs only when it has two or
   * more entries (`multi`).
   */
  opps: PlayerId[];
  /** The caller's seed: it orders equally good choices (`tieKey`). */
  seed: string;
  /** How many times in a row the bot has just cancelled an action (CR 733.1); the priority planner skips that many of its preferred actions. */
  cancels: number;
  chars(id: ObjectId): Chars | null;
}

export function makeCtx(view: GameView, decision: Decision, seed: string): Ctx {
  const me = decision.player;
  const opp = view.players.find((p) => p.id !== me)?.id ?? me;
  const state = view as unknown as GameState;
  const cache = new Map<ObjectId, Chars | null>();
  const chars = (id: ObjectId): Chars | null => {
    if (cache.has(id)) return cache.get(id)!;
    const o = view.objects[id];
    let c: Chars | null = null;
    if (o && o.defId !== HIDDEN_DEF && (view.defs[o.defId] || o.stack)) {
      try { c = getChars(state, id); } catch { c = null; } // an object the view can't characterize (a redacted copy) is treated as unknown
    }
    cache.set(id, c);
    return c;
  };
  const cancels = trailingCancels(view, me);
  const ctx: Ctx = { view, state, decision, me, opp, seed, cancels, chars, opps: [opp] };
  const others = view.players.filter((p) => p.id !== me);
  if (others.length >= 2) { // M12-6: a game that began with three or four players (m12 design D1); two players never get here
    const at = view.players.findIndex((p) => p.id === me);
    const order = [...view.players.slice(at + 1), ...view.players.slice(0, Math.max(0, at))]; // turn order from the bot (CR 101.4)
    const inGame = order.filter((p) => !p.hasLost).map((p) => p.id);
    if (inGame.length > 0) {
      ctx.opps = inGame;
      ctx.opp = focusOf(ctx, inGame);
    }
  }
  return ctx;
}

/** M12-6: are two or more opponents still in the game? Only then do the multiplayer heuristics run (m12 design 7, D16, D17). */
export const multi = (ctx: Ctx): boolean => ctx.opps.length >= 2;

/** The total power of a player's creatures on the battlefield (what they could attack with). */
export const boardPower = (ctx: Ctx, player: PlayerId): number => creatures(ctx, player).reduce((n, id) => n + pt(ctx, id).power, 0);

/** M12-6 (m12 design 7): the focus among `opps` (turn order from the bot): the most power on the battlefield, then the lowest life, then the first. */
function focusOf(ctx: Ctx, opps: readonly PlayerId[]): PlayerId {
  let best = opps[0]!;
  for (const p of opps.slice(1)) {
    const dp = boardPower(ctx, p) - boardPower(ctx, best);
    if (dp > 0 || (dp === 0 && life(ctx, p) < life(ctx, best))) best = p;
  }
  return best;
}

/**
 * M12-6: an opponent among `ids` (option or target ids) for something that hurts them (CR 601.7a "an opponent", 508.5a the defending player): the focus
 * when it is offered, else the first opponent in turn order, else undefined (only the bot itself or non-players are offered).
 */
export function opponentAmong(ctx: Ctx, ids: readonly string[]): PlayerId | undefined {
  if (ids.includes(ctx.opp)) return ctx.opp;
  return ctx.opps.find((p) => ids.includes(p));
}

/** The "<name> cancels." lines (CR 733.1) at the end of the log written for the bot: cancelling restores the state, so this is the only trace of an attempt. */
function trailingCancels(view: GameView, me: PlayerId): number {
  const name = view.players.find((p) => p.id === me)?.name ?? me;
  let n = 0;
  for (let i = view.log.length - 1; i >= 0; i--) {
    const e = view.log[i]!;
    if (e.text === `${name} cancels.` && (e.rules ?? []).includes('CR 733.1')) n++;
    else break;
  }
  return n;
}

// ---- small readers ------------------------------------------------------------------------------------------------------------

/**
 * The seed's order among equally good choices: an FNV-1a hash of the seed and a key naming the choice. Different seeds make different (equally good) plays;
 * the order depends only on the seed and the choice, so it is the same before and after a cancel (CR 733.1) and the planner still skips the same plays.
 */
export function tieKey(ctx: Ctx, key: string): number {
  let h = 0x811c9dc5;
  const text = `${ctx.seed}|${key}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function controller(ctx: Ctx, id: ObjectId): PlayerId | null {
  return ctx.chars(id)?.controller || ctx.view.objects[id]?.controller || null;
}

export function isType(ctx: Ctx, id: ObjectId, type: string): boolean {
  return ctx.chars(id)?.types.includes(type as never) ?? false;
}

export const kw = (ctx: Ctx, id: ObjectId, keyword: string): boolean => {
  const c = ctx.chars(id);
  return c ? hasKeyword(c, keyword) : false;
};

/** Power and toughness as numbers; an unknown value (an unevaluated "*") counts as 0 power and 1 toughness. */
export function pt(ctx: Ctx, id: ObjectId): { power: number; toughness: number } {
  const c = ctx.chars(id);
  if (!c) return { power: 2, toughness: 2 }; // a face-down creature is a 2/2 (CR 708.2a)
  const n = ptNumbers(c);
  return { power: Math.max(0, n.power ?? 0), toughness: n.toughness ?? 1 };
}

/** Damage still needed to destroy the creature by damage (CR 704.5g): toughness minus marked damage. */
export function lethalDamage(ctx: Ctx, id: ObjectId): number {
  return Math.max(0, pt(ctx, id).toughness - (ctx.view.objects[id]?.damage ?? 0));
}

export function battlefield(ctx: Ctx, player: PlayerId, type?: string): ObjectId[] {
  return ctx.view.zones.battlefield.filter((id) => {
    const o = ctx.view.objects[id];
    if (!o || o.phasedOut) return false;
    if (controller(ctx, id) !== player) return false;
    return type === undefined || (o.faceDown && type === 'Creature') || isType(ctx, id, type);
  });
}

export const creatures = (ctx: Ctx, player: PlayerId): ObjectId[] => battlefield(ctx, player, 'Creature');

export const hand = (ctx: Ctx, player: PlayerId): ObjectId[] => ctx.view.zones.hand[player] ?? [];

export const life = (ctx: Ctx, player: PlayerId): number => ctx.view.players.find((p) => p.id === player)?.life ?? 0;

export const libraryCount = (ctx: Ctx, player: PlayerId): number => (ctx.view.zones.library[player] ?? []).length;

/** Cards the bot keeps in its library after any draw it chooses: drawing from an empty library loses the game (CR 121.4, 704.5b). */
export const LIBRARY_MARGIN = 2;

/** Whether the bot can draw `n` cards and still have more than `LIBRARY_MARGIN` cards left. */
export const safeToDraw = (ctx: Ctx, n: number): boolean => n <= 0 || libraryCount(ctx, ctx.me) > n + LIBRARY_MARGIN;

/** A score that means "this wins the game" (or, for a threat on the stack, "this loses it"): above every ordinary score. */
export const LETHAL = 1000;

/** Poison counters (CR 122.1f); ten or more lose the game (CR 704.5c). */
export const poison = (ctx: Ctx, player: PlayerId): number => ctx.view.players.find((p) => p.id === player)?.poison ?? 0;

export const isMyTurn = (ctx: Ctx): boolean => ctx.view.turn.activePlayer === ctx.me;

export const step = (ctx: Ctx): string => ctx.view.turn.step;

export const stackTop = (ctx: Ctx): ObjectId | null => ctx.view.zones.stack[ctx.view.zones.stack.length - 1] ?? null;

/** Summoning sickness (CR 302.6): the creature has not been under its controller's control since their most recent turn began, and has no haste. */
export function canTapToAttack(ctx: Ctx, id: ObjectId): boolean {
  const o = ctx.view.objects[id];
  const c = ctx.chars(id);
  if (!o || !c || o.tapped) return false;
  try { return !isSummoningSick(ctx.state, o, c); } catch { return false; }
}

// ---- Commander (M11-3, m11 design 7; every answer is 0 / false / null outside a Commander game) ------------------------------------------------

/**
 * CR 903.8: the commander tax a cast of this object costs now: {2} (the variant's `tax`) for each earlier cast of that commander from the command zone,
 * only when it is cast from the command zone. 0 for any other object or zone. The commander's records are public (CR 903.6), so the view has them.
 */
export function castTax(ctx: Ctx, id: ObjectId): number {
  const o = ctx.view.objects[id];
  if (!o || o.zone !== 'command') return 0;
  try { return commanderTax(ctx.state, o.cardId); } catch { return 0; }
}

/** CR 903.3: is this permanent a commander (the designation belongs to the card, so a copy or a token of one is not)? */
export function isCommanderObject(ctx: Ctx, id: ObjectId): boolean {
  const o = ctx.view.objects[id];
  if (!o) return false;
  try { return isCommander(ctx.state, o); } catch { return false; }
}

/**
 * CR 903.10a, 704.6c: the combat damage this commander still has to deal to `player` for that player to lose, or null when the game has no such rule
 * (not a Commander game, or a variant without commander damage: Brawl, CR 903.12h, and Duel Commander by OpenMTG's choice). The
 * threshold is the variant's data (`options.commander.damageLimit`), never assumed to be 21.
 */
export function commanderDamageLeft(ctx: Ctx, id: ObjectId, player: PlayerId): number | null {
  const limit = ctx.view.options.commander?.damageLimit;
  const o = ctx.view.objects[id];
  if (limit == null || !o || !isCommanderObject(ctx, id)) return null;
  // A merged permanent's commander component (CR 903.3c) is not tracked here: the card itself is the one the tally is kept for (M11-1 counts by CardId).
  if (o.cardId === undefined) return null;
  try { return Math.max(0, limit - commanderDamageTo(ctx.state, player, o.cardId)); } catch { return null; }
}

/** Mana the player could make right now: one per usable mana source (the widest mode counts), plus the pool. */
export function availableMana(ctx: Ctx, player: PlayerId): number {
  let n = ctx.view.players.find((p) => p.id === player)?.manaPool.length ?? 0;
  try {
    for (const src of manaSources(ctx.state, player)) n += Math.max(1, ...src.modes.map((m) => (m.sacrifices ? 0 : m.units.length)));
  } catch { /* a view the solver can't read: count nothing extra */ }
  return n;
}
