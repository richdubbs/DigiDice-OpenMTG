/**
 * Designations of players and of the game (CR 725 the monarch, CR 731 day and night): the only code that writes `GameState.designations`, and the inherent
 * triggered abilities of the monarch (CR 725.2). Owner: WP15 (called by the `designate` handler and by its edits of core/turn.ts and core/steps.ts); M6-4 (m6 design
 * 4.2) since milestone 6: the day/night event and the hook of core/day-night.ts. FAST5X-4: speed (CR 702.179): the state-based action of start your engines!
 * (CR 704.5aa, called by core/sba.ts), "your speed increases by N" (the `designate` handler) and the inherent triggered ability of speed (CR 702.179d).
 *
 * MX4: the initiative (CR 726) and its three inherent triggered abilities (CR 726.2), which venture into Undercity (CR 701.49d, core/dungeons.ts).
 */
import type { AbilityDef } from '../types/ability';
import type { PlayerId } from '../types/ids';
import type { PendingTrigger } from '../types/state';
import { charsOfObject } from '../rules/characteristics';
import type { Game } from './game';

/**
 * The inherent triggered abilities of the monarch "have no source" (CR 725.2, an exception to CR 113.8). A pending trigger needs a source id, so they carry this
 * one, which is never the id of an object: nothing can be found under it, and the log calls it by its `sourceName`.
 */
export const MONARCH_SOURCE = 'rule:monarch';

/** CR 725.3: as a player becomes the monarch, the current monarch ceases to be the monarch. Returns whether anything changed. */
export function setMonarch(g: Game, player: PlayerId, rules: string[] = ['CR 725.3']): boolean {
  const d = g.s.designations;
  if (d.monarch === player || g.player(player).hasLost) return false;
  d.monarch = player;
  g.emit({ type: 'designationChanged', what: 'monarch', to: player });
  g.log(`${g.player(player).name} becomes the monarch.`, { rules, level: 'action' });
  return true;
}

/** M6-4: what happens AS it becomes day or night (CR 702.145b, e: the daybound or nightbound permanents transform), installed by core/day-night.ts. */
let afterDayNightChange: ((g: Game) => void) | null = null;
export function installAfterDayNightChange(f: ((g: Game) => void) | null): void {
  afterDayNightChange = f;
}

/**
 * CR 731.1: it becomes day or night; once it is one of them the game always has exactly one of the two. Returns whether anything changed. M6-4: "day becomes
 * night" and "night becomes day" (CR 731.1a: the game loses one designation and gains the other) emit `dayNight`; becoming day or night from neither does not.
 */
export function setDayNight(g: Game, which: 'day' | 'night', rules: string[] = ['CR 731.1']): boolean {
  const d = g.s.designations;
  if (d.dayNight === which) return false;
  const was = d.dayNight;
  d.dayNight = which;
  g.emit({ type: 'designationChanged', what: which, to: which });
  if (was !== undefined) g.emit({ type: 'dayNight', to: which }); // CR 731.1a
  g.log(was === undefined ? `It becomes ${which}.` : `${was === 'day' ? 'Day becomes night' : 'Night becomes day'}.`, { rules, level: 'action' });
  afterDayNightChange?.(g);
  return true;
}

function inherentTrigger(g: Game, controller: PlayerId, key: string, ability: AbilityDef, of: 'monarch' | 'initiative' = 'monarch'): void {
  const t: PendingTrigger = {
    id: `t${g.s.counters.effect++}`,
    sourceId: of === 'monarch' ? MONARCH_SOURCE : INITIATIVE_SOURCE,
    sourceName: of === 'monarch' ? 'The monarch' : 'The initiative',
    controller,
    abilityRef: { source: 'rule', face: 0, index: -1, key },
    context: { ev: 'state', roles: {}, before: {} },
    inline: ability,
  };
  g.s.pendingTriggers.push(t);
  g.log(`The ${of}'s triggered ability triggers: ${ability.text}`, { rules: [of === 'monarch' ? 'CR 725.2' : 'CR 726.2'], level: 'info' });
}

/** CR 725.2: "At the beginning of the monarch's end step, that player draws a card." Called as the end step begins (CR 513.1). */
export function monarchEndStep(g: Game): void {
  const m = g.s.designations.monarch;
  if (m === undefined || m !== g.s.turn.activePlayer || g.player(m).hasLost) return;
  inherentTrigger(g, m, 'monarch:draw', {
    kind: 'triggered',
    text: "At the beginning of the monarch's end step, that player draws a card.",
    trigger: { on: [] },
    effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'fixed', players: [m] }, count: 1 }] },
  });
}

// ---- Speed (CR 702.179) ------------------------------------------------------------------------------------------------------------------------------

/** The inherent triggered ability of speed has no source (CR 702.179d), like the monarch's (see MONARCH_SOURCE). */
export const SPEED_SOURCE = 'rule:speed';

/** A player's speed for an effect that refers to it: no speed counts as 0 (CR 702.179f). */
export const speedOf = (g: Game, player: PlayerId): number => g.s.designations.speed?.[player] ?? 0;

/** Does the player have speed at all (CR 702.179b: a player has none until a rule or effect sets it)? */
export const hasSpeed = (g: Game, player: PlayerId): boolean => g.s.designations.speed?.[player] !== undefined;

function setSpeed(g: Game, player: PlayerId, to: number, rules: string[]): void {
  const d = g.s.designations;
  const from = d.speed?.[player];
  if (from === to) return;
  d.speed = { ...(d.speed ?? {}), [player]: to };
  g.emit({ type: 'speedChanged', player, speed: to, ...(from !== undefined ? { from } : {}) });
  g.log(`${g.player(player).name}'s speed ${from === undefined ? 'becomes' : from > to ? 'decreases to' : 'increases to'} ${to}.`, { rules, level: 'action' }); // std-control-1: decreases
}

/**
 * CR 702.179a, 704.5aa: a player who controls a permanent with start your engines! and has no speed gets speed 1 (a state-based action: core/sba.ts calls this
 * for each player who controls such a permanent). Returns whether anything changed.
 */
export function startEngines(g: Game, player: PlayerId): boolean {
  if (hasSpeed(g, player) || g.player(player).hasLost) return false;
  setSpeed(g, player, 1, ['CR 704.5aa', 'CR 702.179a']);
  return true;
}

/** CR 702.179c: "your speed increases by N"; a player with no speed gets speed N. Returns whether anything changed. */
export function increaseSpeed(g: Game, player: PlayerId, by: number): boolean {
  if (by <= 0 || g.player(player).hasLost) return false;
  setSpeed(g, player, speedOf(g, player) + by, ['CR 702.179c']);
  return true;
}

/**
 * std-control-1 (CR 702.179): "reduce that opponent's speed by N. This effect can't reduce their speed below M": the speed goes down by N but not below M; a speed
 * already at or below M is left as it is, and a player with no speed keeps none (there is no speed to reduce, CR 702.179b). Returns whether anything changed.
 */
export function reduceSpeed(g: Game, player: PlayerId, by: number, floor: number): boolean {
  if (by <= 0 || !hasSpeed(g, player) || g.player(player).hasLost) return false;
  const now = speedOf(g, player);
  const to = Math.max(Math.min(now, floor), now - by);
  if (to === now) return false;
  setSpeed(g, player, to, ['CR 702.179']);
  return true;
}

/** CR 702.179d: the inherent ability of one player (its controller increases their own speed). */
function speedAbility(player: PlayerId): AbilityDef {
  return {
    kind: 'triggered',
    text: 'Whenever one or more opponents lose life during your turn, if your speed is less than 4, your speed increases by 1. This ability triggers only once each turn.',
    trigger: { on: [] },
    interveningIf: { cond: 'compare', left: { q: 'speed' }, op: '<', right: 4 }, // CR 603.4: checked again as it resolves (effects/run.ts)
    effect: { targets: [], steps: [{ op: 'designate', who: { ref: 'fixed', players: [player] }, what: 'speed', by: 1 }] },
  };
}

/** How many of `g.events` `speedEvents` has looked at (per run, as for `monarchEvents`). */
const speedSeen = new WeakMap<Game, number>();

/**
 * CR 702.179d: "Whenever one or more opponents lose life during your turn, if your speed is less than 4, your speed increases by 1. This ability triggers only
 * once each turn." Called each time a player would receive priority, before triggers are collected (as `monarchEvents`). Only the active player's ability can
 * trigger ("during your turn"), at most once each turn (`DesignationState.speedTriggered`), and only if their speed is less than 4 right then (CR 603.4:
 * otherwise it does not trigger, and it may still trigger later that turn). Life loss includes damage (CR 120.3a) and paid life (CR 119.4): every
 * `lifeChanged` event with a negative change of a player other than the active player (every other player is an opponent in a two-player game, CR 102.2).
 */
export function speedEvents(g: Game): void {
  const from = speedSeen.get(g) ?? 0;
  speedSeen.set(g, g.events.length);
  const active = g.s.turn.activePlayer;
  const d = g.s.designations;
  if (!hasSpeed(g, active) || g.player(active).hasLost) return; // CR 702.179d: the ability exists while the player has speed
  if (d.speedTriggered?.[active] === g.s.turn.number) return; // "triggers only once each turn"
  let lost = false;
  for (let i = from; i < g.events.length && !lost; i++) {
    const e = g.events[i]!;
    lost = e.type === 'lifeChanged' && e.delta < 0 && e.player !== active;
  }
  if (!lost || speedOf(g, active) >= 4) return; // CR 603.4: the intervening "if" is checked as the event happens
  d.speedTriggered = { ...(d.speedTriggered ?? {}), [active]: g.s.turn.number };
  const ability = speedAbility(active);
  const t: PendingTrigger = {
    id: `t${g.s.counters.effect++}`,
    sourceId: SPEED_SOURCE,
    sourceName: 'Speed',
    controller: active,
    abilityRef: { source: 'rule', face: 0, index: -1, key: 'speed:increase' },
    context: { ev: 'state', roles: {}, before: {} },
    inline: ability,
  };
  g.s.pendingTriggers.push(t);
  g.log(`${g.player(active).name}'s speed ability triggers: ${ability.text}`, { rules: ['CR 702.179d'], level: 'info' });
}

/** How many of `g.events` `monarchEvents` has looked at (per run; a run starts at a settled state). */
const seen = new WeakMap<Game, number>();

/**
 * Called each time a player would receive priority, before triggers are collected:
 *  - CR 725.4: if the monarch has left the game, the active player becomes the monarch (or the next player in turn order who can);
 *  - CR 725.2: "Whenever a creature deals combat damage to the monarch, its controller becomes the monarch." One trigger per creature, controlled by the player
 *    who was the monarch when it dealt the damage.
 */
export function monarchEvents(g: Game): void {
  const from = seen.get(g) ?? 0;
  seen.set(g, g.events.length);
  const d = g.s.designations;
  if (d.monarch === undefined) return;
  if (g.player(d.monarch).hasLost) {
    const next = g.apnap()[0]; // CR 725.4: the active player, or the next player in turn order still in the game
    if (next !== undefined) setMonarch(g, next, ['CR 725.4']);
    else d.monarch = undefined;
    return;
  }
  for (let i = from; i < g.events.length; i++) {
    const e = g.events[i]!;
    if (e.type !== 'damageDealt' || !e.combat || e.amount <= 0 || e.target !== d.monarch) continue;
    const src = g.s.objects[e.source] ?? g.s.lki[e.source]?.object;
    if (!src) continue;
    const chars = g.s.objects[e.source] ? charsOfObject(g.s, src) : g.s.lki[e.source]?.chars ?? charsOfObject(g.s, src);
    if (!chars.types.includes('Creature')) continue;
    const by = chars.controller ?? src.controller;
    inherentTrigger(g, d.monarch, 'monarch:steal', {
      kind: 'triggered',
      text: 'Whenever a creature deals combat damage to the monarch, its controller becomes the monarch.',
      trigger: { on: [] },
      effect: { targets: [], steps: [{ op: 'designate', who: { ref: 'fixed', players: [by] }, what: 'monarch' }] },
    });
  }
}

// ---- MX4: the initiative (CR 726) -----------------------------------------------------------------------------------------------------------------------

/** The source id of the initiative's inherent triggered abilities, which have no source (CR 726.2, an exception to CR 113.8), like `MONARCH_SOURCE`. */
export const INITIATIVE_SOURCE = 'rule:initiative';

/** MX4 INTERFACE CHANGE (`OP_FORMS`, model/capabilities.ts): "you take the initiative" runs (op:designate.initiative). */
export const INITIATIVE_OP_FORMS: readonly string[] = ['op:designate.initiative'];

/** CR 726.2: "that player ventures into Undercity" (CR 701.49d), the effect of two of the inherent abilities. */
function ventureUndercity(g: Game, p: PlayerId, key: string, text: string): void {
  inherentTrigger(g, p, key, {
    kind: 'triggered',
    text,
    trigger: { on: [] },
    effect: { targets: [], steps: [{ op: 'action', action: 'venture', who: { ref: 'fixed', players: [p] }, arg: 'Undercity' }] },
  }, 'initiative');
}

/**
 * CR 726.3: as a player takes the initiative, the player who has it ceases to have it; CR 726.5: a player who has it and is told to take it keeps the one
 * designation. Either way "Whenever a player takes the initiative, that player ventures into Undercity." triggers (CR 726.2). Returns whether the player took it.
 */
export function takeInitiative(g: Game, player: PlayerId, rules: string[] = ['CR 726.3']): boolean {
  if (g.player(player).hasLost) return false;
  const d = g.s.designations;
  if (d.initiative !== player) {
    d.initiative = player;
    g.emit({ type: 'designationChanged', what: 'initiative', to: player });
    g.log(`${g.player(player).name} takes the initiative.`, { rules, level: 'action' });
  } else {
    g.log(`${g.player(player).name} takes the initiative again (they keep it).`, { rules: ['CR 726.5'], level: 'action' });
  }
  ventureUndercity(g, player, 'initiative:take', 'Whenever a player takes the initiative, that player ventures into Undercity.');
  return true;
}

/** CR 726.2: "At the beginning of the upkeep of the player who has the initiative, that player ventures into Undercity." Called as the upkeep begins. */
export function initiativeUpkeep(g: Game): void {
  const p = g.s.designations.initiative;
  if (p === undefined || p !== g.s.turn.activePlayer || g.player(p).hasLost) return;
  ventureUndercity(g, p, 'initiative:upkeep', 'At the beginning of the upkeep of the player who has the initiative, that player ventures into Undercity.');
}

/** How many of `g.events` `initiativeEvents` has looked at (per run; a run starts at a settled state). */
const seenInitiative = new WeakMap<Game, number>();

/**
 * Called each time a player would receive priority, before triggers are collected (as `monarchEvents`):
 *  - CR 726.4: if the player who has the initiative has left the game, the active player takes it (or the next player in turn order who can);
 *  - CR 726.2: "Whenever one or more creatures a player controls deal combat damage to the player who has the initiative, the controller of those creatures
 *    takes the initiative." One trigger per player whose creatures dealt such damage in the batch, controlled by the player who had the initiative.
 */
export function initiativeEvents(g: Game): void {
  const from = seenInitiative.get(g) ?? 0;
  seenInitiative.set(g, g.events.length);
  const d = g.s.designations;
  if (d.initiative === undefined) return;
  if (g.player(d.initiative).hasLost) {
    const next = g.apnap()[0]; // CR 726.4
    if (next !== undefined) takeInitiative(g, next, ['CR 726.4']);
    else d.initiative = undefined;
    return;
  }
  const holder = d.initiative;
  const by: PlayerId[] = [];
  for (let i = from; i < g.events.length; i++) {
    const e = g.events[i]!;
    if (e.type !== 'damageDealt' || !e.combat || e.amount <= 0 || e.target !== holder) continue;
    const src = g.s.objects[e.source] ?? g.s.lki[e.source]?.object;
    if (!src) continue;
    const chars = g.s.objects[e.source] ? charsOfObject(g.s, src) : g.s.lki[e.source]?.chars ?? charsOfObject(g.s, src);
    if (!chars.types.includes('Creature')) continue;
    const c = chars.controller ?? src.controller;
    if (!by.includes(c)) by.push(c);
  }
  for (const c of by) {
    inherentTrigger(g, holder, 'initiative:steal', {
      kind: 'triggered',
      text: 'Whenever one or more creatures a player controls deal combat damage to the player who has the initiative, the controller of those creatures takes the initiative.',
      trigger: { on: [] },
      effect: { targets: [], steps: [{ op: 'designate', who: { ref: 'fixed', players: [c] }, what: 'initiative' }] },
    }, 'initiative');
  }
}
