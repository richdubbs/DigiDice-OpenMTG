/**
 * Day and night (CR 731, 502.2, 702.145; m6 design 3.6, E14). Owner: M6-4.
 *
 *   DAY_NIGHT_UNTAP             the untap step's second part (core/registries.ts#TURN_BASED.untapSecondPart, CR 502.2, 731.2): if it is day and the PREVIOUS
 *                               TURN'S ACTIVE PLAYER cast no spells during that turn, it becomes night; if it is night and that player cast two or more, it
 *                               becomes day (spells of the other players do not count; neither day nor night: no check, CR 731.2c). Read from the history
 *                               of the previous turn (rules/history.ts, scope `lastTurn`): its `beginTurn` entry names the active player, its `cast` entries
 *                               the spells cast (copies are not cast, CR 707.10).
 *   DAY_NIGHT_IMMEDIATE_CHECKS  what happens "immediately" (effects/registries.ts#IMMEDIATE_CHECKS: after every performed event and first in each state-based
 *                               action check): it becomes day when a player controls a permanent with daybound and it is neither (CR 702.145d); it becomes
 *                               night when a player controls a permanent with nightbound, it is neither and no permanent with daybound is on the battlefield
 *                               (CR 702.145g); a front-face-up daybound permanent transforms at night (CR 702.145c), a back-face-up nightbound one by day
 *                               (CR 702.145f).
 *   the change itself           core/designations.ts#setDayNight calls `afterDayNightChange` (installed here) as the designation changes, so the permanents
 *                               transform AS it becomes night or day (CR 702.145b, e), before the next instruction of a resolving spell.
 *   OP_FORMS                    `op:designate.day|night` (model/capabilities.ts): "it becomes day/night" now acts on the daybound and nightbound permanents.
 *
 * Every transform goes through the `transform` proposal marked `dayNight` (installed by effects/handlers/dfc-ops.ts: core may not import the pipeline), the only
 * transform a permanent with daybound or nightbound can make (CR 702.145b, e; effects/proposal-kinds/transform.ts#forbidden). The checks look at the
 * permanents only in a game where some definition prints daybound or nightbound (a cheap test, cached per `defs` record), so other games pay nothing.
 */
import type { CardDef } from '../types/card';
import type { DefId, ObjectId } from '../types/ids';
import { charsOfObject } from '../rules/characteristics';
import { historyInScope } from '../rules/history';
import type { Game } from './game';
import { installAfterDayNightChange, setDayNight } from './designations';

/** The day/night transform (effects/handlers/dfc-ops.ts installs it when it loads): a `transform` proposal marked `dayNight`; whether it transformed. */
let transformer: ((g: Game, id: ObjectId) => boolean) | null = null;
export function installDayNightTransform(f: ((g: Game, id: ObjectId) => boolean) | null): void {
  transformer = f;
}

/** The capability names of the `designate` forms this module makes real (CR 731.1, 702.145). */
export const OP_FORMS: readonly string[] = ['op:designate.day', 'op:designate.night'];

const BOUND = ['daybound', 'nightbound'];
const printsBound = (def: CardDef): boolean => def.faces.some((f) => f.abilities.some((a) => a.kind === 'keyword' && BOUND.includes(a.keyword)));
const cache = new WeakMap<Record<DefId, CardDef>, boolean>();
/** Does any definition of this game print daybound or nightbound? (Copies and copied abilities come from a definition of the game too.) */
function boundInGame(g: Game): boolean {
  const defs = g.s.defs;
  let v = cache.get(defs);
  if (v === undefined) cache.set(defs, (v = Object.values(defs).some(printsBound)));
  return v;
}

interface Bound { id: ObjectId; daybound: boolean; nightbound: boolean; face: number }
/** The permanents with daybound or nightbound now (their keywords after every layer). */
function boundPermanents(g: Game): Bound[] {
  const out: Bound[] = [];
  for (const id of g.s.zones.battlefield) {
    const o = g.s.objects[id];
    if (!o || o.phasedOut) continue;
    const kws = charsOfObject(g.s, o).keywords.map((k) => k.keyword);
    const daybound = kws.includes('daybound');
    const nightbound = kws.includes('nightbound');
    if (daybound || nightbound) out.push({ id, daybound, nightbound, face: o.face });
  }
  return out;
}

/**
 * Can this permanent be turned over at all (CR 712.9: represented by a double-faced card or token that is not melded or face down)? A copy of a daybound card
 * that is not itself double-faced keeps daybound but never transforms (CR 702.145c only asks for it), so it is not tried after every event.
 */
function turnsOver(g: Game, id: ObjectId): boolean {
  const o = g.s.objects[id];
  const def = o && g.s.defs[o.defId];
  return o !== undefined && def !== undefined && def.faces.length === 2 && ['transform', 'modal_dfc', 'double_faced_token'].includes(def.layout) && o.components === undefined && !o.faceDown;
}

/** CR 702.145b-c, e-f: the permanents that transform now, in order of their ids (one batch); each transforms through the proposal pipeline. */
function transformBound(g: Game): void {
  const d = g.s.designations.dayNight;
  if (d === undefined || !transformer) return;
  const due = boundPermanents(g).filter((b) => ((d === 'night' && b.daybound && b.face === 0) || (d === 'day' && b.nightbound && b.face === 1)) && turnsOver(g, b.id));
  for (const b of due) {
    const o = g.s.objects[b.id];
    if (o && o.zone === 'battlefield' && o.face === b.face) transformer(g, b.id);
  }
}

const running = new WeakSet<Game>();

/** CR 702.145c-d, f-g: the immediate checks (also run as day or night changes). Re-entrant calls (from the transforms' own events) do nothing. */
function immediateCheck(g: Game): void {
  if (running.has(g) || !boundInGame(g)) return;
  running.add(g);
  try {
    if (g.s.designations.dayNight === undefined) {
      const bound = boundPermanents(g);
      if (bound.some((b) => b.daybound)) setDayNight(g, 'day', ['CR 702.145d']);
      else if (bound.some((b) => b.nightbound)) setDayNight(g, 'night', ['CR 702.145g']);
    }
    transformBound(g);
  } finally {
    running.delete(g);
  }
}

/** CR 702.145b, e: as it becomes night (day), the daybound (nightbound) permanents transform. */
installAfterDayNightChange((g) => {
  if (!boundInGame(g)) return;
  if (running.has(g)) return; // immediateCheck transforms them itself
  running.add(g);
  try {
    transformBound(g);
  } finally {
    running.delete(g);
  }
});

/** CR 502.2, 731.2a-b: the previous turn's active player's spells decide whether day becomes night or night becomes day. */
function untapCheck(g: Game): void {
  const d = g.s.designations.dayNight;
  if (d === undefined) return; // CR 731.2c
  const last = historyInScope(g.s, 'lastTurn');
  const active = last.find((e) => e.ev === 'beginTurn')?.actor;
  if (active === undefined) return;
  const cast = last.filter((e) => e.ev === 'cast' && e.actor === active && e.facts['copy'] !== true).length;
  if (d === 'day' && cast === 0) setDayNight(g, 'night', ['CR 502.2', 'CR 731.2a']);
  else if (d === 'night' && cast >= 2) setDayNight(g, 'day', ['CR 502.2', 'CR 731.2b']);
}

export const DAY_NIGHT_IMMEDIATE_CHECKS: readonly ((g: Game) => void)[] = [immediateCheck];
export const DAY_NIGHT_UNTAP: readonly ((g: Game) => void)[] = [untapCheck];
