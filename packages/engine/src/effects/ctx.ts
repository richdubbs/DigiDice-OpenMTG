/**
 * The execution context of one resolution and the per-target legality check (CR 608.2b). Owner: WP4.
 * Contract: effects/api.ts#ExecCtx. The context is rebuilt on every re-execution and never stored in GameState.
 */
import type { Game } from '../core/game';
import type { EffectProgram, TargetSpec } from '../types/ability';
import type { GameObject, ObjHandle, StackTargetChoice, TargetChoice } from '../types/state';
import { matchesFilter } from '../rules/filter';
import { gameOf, hookpoints } from '../rules/hookpoints';
import { controllerDealtCombatDamageBySourceThisTurn } from '../rules/history';
import { playerPredMatches } from '../rules/predicates';
import { equalToughnessHolds } from '../rules/targets';
import { filterMentionsX, relaxUnannouncedX } from '../rules/filter-env';
import { choosesXOnResolution } from '../types/x-on-resolution';
import type { ExecCtx, TargetSlot } from './api';
import './eval'; // installs the quantity evaluator that references and filters use
import { filterCtxOf, resolvePlayers } from './refs';

/** The handle of a chosen object target: where it is now, or where it was when it left (then it is stale and its legality fails, CR 608.2b); `null` if unknown. */
function handleFor(g: Game, id: string): ObjHandle | null {
  const o = g.s.objects[id];
  if (o) return { id, zone: o.zone };
  const l = g.s.lki[id];
  return l ? { id, zone: l.leftZone } : null;
}

function slotFor(g: Game, choice: StackTargetChoice): TargetSlot {
  return choice.kind === 'player' ? { handle: null, player: choice.id, legal: true } : { handle: handleFor(g, choice.id), legal: true, ...('for' in choice ? { for: choice.for } : {}) };
}

/**
 * Build the context for the top object of the stack: source, controller, the (already flattened) program, the chosen targets with their legality.
 * `program.targets[i]` is the spec of the i-th list of `obj.stack.targets` (announcement stores one list per spec, in program order, CR 601.2c). An object
 * without stack information (a permanent whose static abilities are being evaluated) gets a context with no targets and no stack.
 */
export function makeCtx(g: Game, obj: GameObject, program: EffectProgram): ExecCtx {
  const stack = obj.stack ?? null;
  const sourceId = stack?.sourceId ?? obj.id;
  const zone = g.s.objects[sourceId]?.zone ?? g.s.lki[sourceId]?.leftZone ?? obj.zone;
  const cx: ExecCtx = {
    g,
    source: { id: sourceId, zone },
    stackId: stack ? obj.id : null,
    ...(stack ? { stackTimestamp: obj.timestamp } : {}), // WP14 INTERFACE CHANGE: CR 701.27f (effects/handlers/zones-status.ts)
    controller: obj.controller,
    program,
    stack,
    targets: new Map(),
    event: stack?.event ?? null,
    bindings: new Map(),
    results: new Map(),
    vars: new Map(),
    choices: new Map(), // FAST3 T13 INTERFACE CHANGE: what chooseValue chose during this resolution
  };
  program.targets.forEach((spec, i) => cx.targets.set(spec.id, (stack?.targets[i] ?? []).map((choice) => slotFor(g, choice))));
  checkAll(cx);
  return cx;
}

/** CR 115.4: "any target" is a creature, a player, a planeswalker or a battle. */
const ANY_TARGET_TYPES = ['Creature', 'Planeswalker', 'Battle'];

/** Is this one chosen target still legal (CR 608.2b)? Same zone, still the right kind of thing, and still a legal target for the spell or ability (CR 115.2, 702.11b, 702.16b). */
function targetLegal(cx: ExecCtx, spec: TargetSpec, slot: TargetSlot): boolean {
  const s = cx.g.s;
  const sourceId = cx.stack?.sourceId ?? cx.stackId ?? cx.source.id;
  if (slot.player !== undefined) {
    if (spec.kind !== 'player' && spec.kind !== 'objectOrPlayer' && spec.kind !== 'anyTarget') return false;
    const p = s.players.find((x) => x.id === slot.player);
    if (!p || p.hasLost) return false;
    if (playerPredMatches(spec.players?.who ?? 'any', p.id, cx.controller, (ref) => resolvePlayers(cx, ref)) !== true) return false;
    if (spec.players?.lostLife === true && p.turnStats.lifeLost <= 0) return false; // edh-c-34 (CR 608.2b, 119.3): still a player who has lost life this turn
    if (spec.players?.activePlayer === true && s.turn.activePlayer !== p.id) return false; // trek-16 (CR 608.2b, 500.1): still the player whose turn it is
    if (spec.players?.otherThan !== undefined) { const them = resolvePlayers(cx, spec.players.otherThan); if (them.length === 0 || them.includes(p.id)) return false; } // edh-cast-15 (CR 608.2b): still not the player the reference names
    if (spec.players?.dealtCombatDamageBySource === true && !controllerDealtCombatDamageBySourceThisTurn(s, p.id, sourceId)) return false; // edh-cast-13 (CR 608.2b, 510.2): still the player the source dealt combat damage to
    return hookpoints.canBeTargeted(gameOf(s), p.id, sourceId, cx.controller) === null;
  }
  const h = slot.handle;
  const o = h ? s.objects[h.id] : undefined;
  if (!h || !o || o.zone !== h.zone) return false; // it left the zone it was in: it is a new object now (CR 400.7)
  if (o.id === cx.stackId) return false; // a spell never targets itself
  const ctx = filterCtxOf(cx);
  // edh-d-97 (CR 107.3f, 608.2b): before its controller has chosen the X they pay as it resolves, a comparison with X holds for some X (types/x-on-resolution.ts)
  const filter = (xNotChosenYet(cx) ? relaxUnannouncedX(spec.filter) : spec.filter) ?? {};
  switch (spec.kind) {
    case 'object': case 'objectOrPlayer':
      if (o.kind === 'ability' || !matchesFilter(s, o, { ...filter, zone: filter.zone ?? 'battlefield' }, ctx)) return false;
      break;
    case 'anyTarget':
      if (o.kind === 'ability' || !matchesFilter(s, o, { types: ANY_TARGET_TYPES, zone: 'battlefield' }, ctx) || !matchesFilter(s, o, { ...filter, zone: filter.zone ?? 'battlefield' }, ctx)) return false;
      break;
    case 'spell':
      if (o.kind === 'ability' || !matchesFilter(s, o, { ...filter, zone: 'stack' }, ctx)) return false;
      break;
    case 'ability':
      if (o.kind !== 'ability' || o.zone !== 'stack' || !matchesFilter(s, o, { ...filter, zone: 'stack' }, ctx)) return false;
      break;
    case 'stackObject':
      if (o.zone !== 'stack' || !matchesFilter(s, o, { ...filter, zone: 'stack' }, ctx)) return false;
      break;
    case 'player':
      return false; // a player-only spec holding an object
  }
  return hookpoints.canBeTargeted(gameOf(s), o.id, sourceId, cx.controller) === null;
}

/** edh-d-97: the resolving ability's X is the one its controller chooses as they pay, and they have not chosen it yet (types/x-on-resolution.ts). */
const xNotChosenYet = (cx: ExecCtx): boolean => cx.stack !== null && cx.stack.x === undefined && choosesXOnResolution(cx.program);

/**
 * edh-d-97 (CR 107.3f, 608.2b; Relentless Dead): the controller has just chosen X as they pay (effects/handlers/pay.ts#payChosenX): every chosen target whose spec's
 * filter reads X is checked again with that X ("another target Zombie creature card with mana value X"); one it no longer allows is illegal for the rest of the
 * resolution, so the instructions that name it do nothing to it. A target that was illegal stays illegal.
 */
export function recheckXTargets(cx: ExecCtx): void {
  for (const spec of cx.program.targets) {
    if (!filterMentionsX(spec.filter)) continue;
    for (const t of cx.targets.get(spec.id) ?? []) if (t.legal && !targetLegal(cx, spec, t)) t.legal = false;
  }
}

/** edh-d-83: the player a per-player target is for now, as rules/targets.ts#perPlayerKey reads it at announcement (the owner of a card in a graveyard, else the controller). */
function keyNow(cx: ExecCtx, spec: TargetSpec, id: string): string | undefined {
  const o = cx.g.s.objects[id];
  if (o === undefined) return undefined;
  return spec.kind === 'object' && spec.filter?.zone === 'graveyard' ? o.owner : o.controller;
}

/** Fill in `slot.legal` for every chosen target. While it is computed all targets count as legal, so a filter that mentions another target of the ability can read it. */
function checkAll(cx: ExecCtx): void {
  const specs = new Map(cx.program.targets.map((spec) => [spec.id, spec]));
  for (const slots of cx.targets.values()) for (const t of slots) t.legal = true;
  const verdicts: [TargetSlot, boolean][] = [];
  for (const [id, slots] of cx.targets) {
    const spec = specs.get(id);
    for (const t of slots) verdicts.push([t, spec !== undefined && targetLegal(cx, spec, t)]);
  }
  for (const [t, ok] of verdicts) t.legal = ok;
  // edh-d-83 (CR 115.1, 608.2b; Blatant Thievery ruling 2004-10-04: "If a permanent changes controller after being targeted but before this spell resolves, you won't gain control of
  // that permanent"): a target of "for each player, ... target ... that player controls" that the player it was chosen for no longer controls (owns, in a graveyard) is illegal
  for (const [id, slots] of cx.targets) {
    const spec = specs.get(id);
    // edh-next-146 review (CR 601.7a; Evangelize ruling 2006-09-25): also a target "of an opponent's choice they control" the opponent who chose it no longer controls
    if (spec === undefined || (spec.perPlayer !== true && spec.perOpponent !== true && spec.chooserControls !== true)) continue;
    for (const t of slots) if (t.legal && t.for !== undefined && t.handle !== null && keyNow(cx, spec, t.handle.id) !== t.for) t.legal = false;
  }
  // edh-c-74 (CR 608.2b, 601.2c, 110.2; Incriminate, Trial of Agony): the targets "controlled by the same player" no longer share one controller (one of them changed hands): the set
  // is no longer what the spell named, so none of its targets is legal (the ability does not act on a set with two controllers; the controller of the whole set would be several players)
  for (const [id, slots] of cx.targets) {
    if (specs.get(id)?.sameController !== true) continue;
    const owners = new Set(slots.filter((t) => t.legal && t.handle !== null).map((t) => cx.g.s.objects[t.handle!.id]?.controller));
    if (owners.size > 1) for (const t of slots) t.legal = false;
  }
  // edh-next-126 (CR 608.2b, 115.1; V.A.T.S., ruling 2024-03-08): the legal targets "with equal toughness" no longer all have the same toughness: none of them is legal (the spell won't resolve)
  for (const [id, slots] of cx.targets) {
    const spec = specs.get(id);
    if (spec?.equalToughness !== true) continue;
    const live = slots.filter((t) => t.legal && t.handle !== null).map((t): TargetChoice => ({ kind: 'object', id: t.handle!.id }));
    if (!equalToughnessHolds(cx.g.s, spec, live)) for (const t of slots) t.legal = false;
  }
}

/**
 * CR 608.2b: ONE legality check over the targets of every chosen mode, made when resolution begins (`makeCtx`). The ability does not resolve only if it has
 * targets and all of them are illegal. This returns the verdict of that check: it never recomputes, because a target that was legal and has been acted on since
 * (it moved) must stay legal for the rest of this resolution, and reading it keeps using its handle (design 3.1 rule 4). To judge a changed state, build the
 * context again: the interpreter rebuilds it from the settled base state on every re-execution.
 */
export function recheckAll(cx: ExecCtx): { legal: number; total: number } {
  let legal = 0;
  let total = 0;
  for (const slots of cx.targets.values()) for (const t of slots) { total++; if (t.legal) legal++; }
  return { legal, total };
}
