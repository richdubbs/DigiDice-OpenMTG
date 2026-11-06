/**
 * The funnels of the milestone 3/4 primitives (design 8.5, WP11 interface change in core/zones.ts, rules/damage.ts, rules/destroy.ts): every zone change, token
 * creation, damage event (one at a time or simultaneous) and destruction, whoever asks for it, goes through the proposal pipeline (effects/propose.ts) before
 * the primitive performs it. Owner: WP11 (an addition to the files of design 5.1).
 *
 * Loading this module installs the funnels. core/create.ts and core/apply.ts import it for that side effect, so the funnels are in place whatever module graph
 * a caller loads (every game state is created by core/create.ts, every action applied by core/apply.ts); a primitive called with no funnel installed is an
 * EngineBug, never a silent move without its replacement effects.
 */
import type { Game } from '../core/game';
import { installTokenFunnel, installZoneChangeFunnel, type MoveOptions } from '../core/zones';
import type { ObjectId, PlayerId } from '../types/ids';
import type { ObjHandle, ZoneKind } from '../types/state';
import { installDamageFunnel, installLifeLossFunnel, installSimultaneousDamageFunnel, type DamageItem, type DamageOptions } from '../rules/damage';
import { installCostCounterFunnel, installCostDrawFunnel, installCostGainLifeFunnel } from '../rules/pay-parts';
import { installPayLifeFunnel } from '../rules/life';
import { installLoseGameFunnel } from '../core/sba';
import { installDestroyFunnel, installDestroyManyFunnel, installStaticRegenerations, type DestroyOptions, type DestroyResult } from '../rules/destroy';
import { replacementIndex } from './replacement-index';
import type { Proposed } from './api';
import { ruleForbids } from './cant';
import { inDamageBatch } from './damage-batch';
import { installEntryPipeline, performEvent, type CallerOptions, type Performed } from './perform';
import { healMarkedDamage } from './perform-events';
import './mana-ability'; // WP31: installs the resolver of mana abilities decided as they resolve (rules/mana.ts, CR 605.3b)
import './until-return'; // FAST4 MX1: installs the second one-shot effect of a move "until" an event (core/durations.ts, CR 610.3)
import './merge-leave'; // M6-9: installs where the card components of a token merged permanent go (core/move-parts/components.ts, CR 730.3e)
import { affectedPlayer, installProposeTogether, isZero, proposeResult, runPipeline } from './propose';
import { charsOfObject, hasKeyword } from '../rules/characteristics';
import { damageAsInfect } from '../statics/hooks';
import { shieldBudgetLeft } from './replace-bodies';
import { applicable, handleOf, semOf } from './replacements';
import { collectingAfter, installNestedProposer, installNestedRunner, installSemOf } from './nested';
import { runSteps } from './run';

type Damage = Extract<Proposed, { ev: 'damage' }>;

function zoneFunnel(g: Game, id: ObjectId, to: ZoneKind, opts: MoveOptions): ObjectId | null {
  const o = g.obj(id);
  const e: Proposed = {
    ev: 'zoneChange', object: { id, zone: o.zone }, from: o.zone, to,
    destination: {
      ...(opts.controller !== undefined ? { controller: opts.controller } : {}),
      ...(opts.tapped ? { tapped: true } : {}),
      ...(opts.faceDown ? { faceDown: true } : {}),
      ...(opts.face !== undefined ? { face: opts.face } : {}),
      ...(opts.position !== undefined ? { position: opts.position } : {}),
      ...(opts.cause !== undefined ? { cause: opts.cause } : {}),
    },
  };
  return proposeResult(g, e)?.newIds[0] ?? null;
}

/** A token created by the milestone 3/4 route (a manual operation): one `createToken` proposal, so its own "as it enters" effects apply (CR 616.1g). */
function tokenFunnel(g: Game, defId: string, controller: PlayerId, opts: { tapped?: boolean }): ObjectId | null {
  return proposeResult(g, { ev: 'createToken', player: controller, count: 1, token: defId, ...(opts.tapped ? { enter: { tapped: true } } : {}) })?.newIds[0] ?? null;
}

function damageEvent(g: Game, sourceId: ObjectId, target: ObjectId | PlayerId, amount: number, opts: DamageOptions): Damage | null {
  const source = handleOf(g, sourceId);
  const to: ObjHandle | PlayerId | null = g.s.players.some((p) => p.id === target) ? target : handleOf(g, target);
  if (!source || !to) return null;
  return { ev: 'damage', source, to, amount, combat: opts.combat === true, unpreventable: opts.unpreventable === true };
}

function damageFunnel(g: Game, sourceId: ObjectId, target: ObjectId | PlayerId, amount: number, opts: DamageOptions): number {
  const e = damageEvent(g, sourceId, target, amount, opts);
  return e ? proposeResult(g, e, { damage: opts })?.amount ?? 0 : 0;
}

/**
 * CR 615.7: when two or more damage events dealt at the same time (CR 510.2) would use the same "prevent the next N damage" shield and it can't prevent all of
 * them, the player or the controller of the shielded permanent chooses which damage it prevents: one `chooseNumber` per event but the last (the rest is then
 * forced), each bounded so the division always uses the whole shield. Returns, per event index, the share of each shield (by record id) it may use.
 */
function divideShields(g: Game, events: (Damage | null)[]): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>();
  const covered = new Map<string, { idx: number[]; name: string }>();
  events.forEach((e, i) => {
    if (!e || e.unpreventable || isZero(e)) return;
    for (const c of applicable(g, e)) {
      if (c.recId === undefined || c.def.body.b !== 'prevent' || shieldBudgetLeft(g, c.recId) === undefined) continue;
      const entry = covered.get(c.recId) ?? { idx: [], name: c.sourceName };
      entry.idx.push(i);
      covered.set(c.recId, entry);
    }
  });
  for (const [recId, { idx, name }] of covered) {
    if (idx.length < 2) continue;
    const left = shieldBudgetLeft(g, recId)!;
    const amounts = idx.map((i) => events[i]!.amount);
    const total = amounts.reduce((n, x) => n + x, 0);
    if (total <= left) continue; // it prevents all of it whatever the order
    const first = events[idx[0]!]!;
    const who = affectedPlayer(g, first);
    const target = (e: Damage): string => (typeof e.to === 'string' ? g.player(e.to).name : g.nameOf(e.to.id));
    let remaining = left;
    idx.forEach((i, k) => {
      const e = events[i]!;
      const after = amounts.slice(k + 1).reduce((n, x) => n + x, 0);
      const min = Math.max(0, remaining - after);
      const max = Math.min(amounts[k]!, remaining);
      const n = min === max ? min : g.choose({
        kind: 'chooseNumber', player: who, min, max, rules: ['CR 615.7'],
        prompt: `${name} can prevent ${remaining} more of the ${total} damage dealt to ${target(e)} at the same time. How much of the ${e.amount} damage from ${g.nameOf(e.source.id)} does it prevent?`,
      }).n;
      const share = out.get(i) ?? new Map<string, number>();
      share.set(recId, n);
      out.set(i, share);
      remaining -= n;
    });
  }
  return out;
}

/**
 * CR 101.4: the players in APNAP order (the active player, then the others in turn order). M12-2 (m12 design E23): only the players still in the game: an
 * active player who left the game during their turn is not first any more (CR 800.4j: the turn has no active player); the order starts with the next player.
 * A two-player game keeps its list exactly (D16).
 */
function apnap(g: Game): PlayerId[] {
  if (g.s.options.multiplayer !== undefined) return g.apnap();
  const out: PlayerId[] = [];
  let p: PlayerId = g.s.turn.activePlayer;
  for (let i = 0; i < g.s.players.length && !out.includes(p); i++) {
    out.push(p);
    p = g.nextPlayer(p);
  }
  return out;
}

/**
 * M6-1 (m6 design D4, 3.1.8; effects/api.ts#ProposeSimultaneous): several events that happen at the same time. First the CR 615.7 division of every
 * "prevent the next N" shield among the damage events (`divideShields`), then each event's replacement and prevention effects (CR 616.1) in APNAP order of
 * the affected players (all of the active player's events first, CR 101.4), then every event that is left is performed, in the order given (one batch for
 * triggers, CR 603.2c); what the bodies deferred (CR 615.5) happens after all of them. `callers`: the milestone 3/4 options of each event's call-site.
 */
export function proposeSimultaneous(g: Game, events: (Proposed | null)[], callers: CallerOptions[] = []): (Performed | null)[] {
  return inDamageBatch(g, () => proposeBatch(g, events, callers));
}
function proposeBatch(g: Game, events: (Proposed | null)[], callers: CallerOptions[]): (Performed | null)[] {
  const destroyed = events.flatMap((e) => (e && e.ev === 'destroy' ? [e.object.id] : []));
  if (destroyed.length > 0 && g.indestructibleAtProposal === null) {
    // trek-8 re-review (CR 608.2f, 702.12b): who is indestructible is settled for the whole batch before the first permanent is destroyed
    g.indestructibleAtProposal = new Map(destroyed.map((id) => [id, hasKeyword(charsOfObject(g.s, g.obj(id)), 'indestructible')]));
    try {
      return proposeBatch(g, events, callers);
    } finally {
      g.indestructibleAtProposal = null;
    }
  }
  // edh-next-49 (CR 510.2, 120.3b; Phyrexian Unlife ruling 2011-06-01): "all damage is dealt as though its source had infect" is decided once for a simultaneous batch, before any part changes life
  const damaged = [...new Set(events.flatMap((e) => (e && e.ev === 'damage' && typeof e.to === 'string' ? [e.to as PlayerId] : [])))];
  if (events.filter((e) => e && e.ev === 'damage').length > 1 && g.infectAtProposal === null) {
    const snap = new Map(damaged.filter((p) => g.s.players.some((x) => x.id === p)).map((p) => [p, damageAsInfect(g.s, p)] as const));
    if (snap.size > 0) {
      g.infectAtProposal = snap;
      try { return proposeBatch(g, events, callers); } finally { g.infectAtProposal = null; }
    }
  }
  const shares = divideShields(g, events.map((e) => (e && e.ev === 'damage' ? e : null)));
  const rank = new Map(apnap(g).map((p, i) => [p, i]));
  const order = events.map((_e, i) => i).filter((i) => events[i] !== null)
    .sort((a, b) => (rank.get(affectedPlayer(g, events[a]!)) ?? 99) - (rank.get(affectedPlayer(g, events[b]!)) ?? 99) || a - b);
  const finals: (Proposed | null)[] = events.map(() => null);
  const deferred: (() => void)[] = [];
  for (const i of order) {
    const { value, after } = collectingAfter(() => runPipeline(g, events[i]!, shares.get(i)));
    finals[i] = value;
    deferred.push(...after);
  }
  // Cloud r5-repl, wave 8 review (CR 510.2, 614.1a): "all other damage already dealt to him is healed" heals the damage marked BEFORE this event. The parts of
  // one simultaneous event are dealt at the same time, so each permanent is healed once before any part is dealt, and the parts are then dealt without the mark
  // (performing them one by one with it would heal the damage another part deals to it at the same time: two blockers' 2 + 2 would leave 2, not 4)
  const healed = new Set<string>();
  const ready = finals.map((f) => {
    if (f === null || f.ev !== 'damage' || f.healFirst !== true) return f;
    const key = typeof f.to === 'string' ? f.to : f.to.id;
    if (!healed.has(key)) { healed.add(key); healMarkedDamage(g, f); }
    const { healFirst: _healed, ...rest } = f;
    return rest as Proposed;
  });
  const out = ready.map((f, i) => (f ? performEvent(g, f, callers[i] ?? {}) : null));
  for (const f of deferred) f();
  return out;
}

/**
 * edh-d-86: the players a "your life total would be reduced to N or less" replacement covers now (the controller of the object with it; only the `you` form, which is the one template
 * built), each with the greatest N. Empty when there is none.
 */
function lossBatchCovers(g: Game): Map<PlayerId, number> {
  const out = new Map<PlayerId, number>();
  for (const x of replacementIndex(g.s).get('life') ?? []) {
    const r = x.effect.replaces;
    if (r.ev !== 'life' || r.toAtMost === undefined || r.player !== 'you') continue;
    const c = g.s.objects[x.object]?.controller;
    if (c !== undefined) out.set(c, Math.max(out.get(c) ?? -Infinity, r.toAtMost));
  }
  return out;
}

/** All the damage of one simultaneous event (CR 510.2: the combat damage of a step): `proposeSimultaneous` (M6-1; the shields divided first, CR 615.7). */
function simultaneousFunnel(g: Game, items: DamageItem[]): number[] {
  const events = items.map((it) => (it.amount > 0 ? damageEvent(g, it.source, it.target, it.amount, it.opts ?? {}) : null));
  // edh-d-86 (CR 510.2, 120.3a, 614.1a; Enduring Angel): the loss of life of one simultaneous batch is ONE reduction of the life total for the question "would your life total be reduced
  // to N or less": for a player a `toAtMost` replacement covers (its controller), the losses of the batch are held, and after the damage the summed loss is proposed once when the
  // replacement would apply to it (life - sum <= N); otherwise each loss is proposed as before, one per source, in order (triggers and history unchanged, review)
  const covered = g.lossBatch === null && items.filter((it) => it.amount > 0 && typeof it.target === 'string').length > 1 ? lossBatchCovers(g) : new Map<PlayerId, number>();
  const batch = covered.size > 0;
  if (batch) g.lossBatch = new Map([...covered.keys()].map((p) => [p, []]));
  let done: ReturnType<typeof proposeSimultaneous>;
  let held: Map<PlayerId, { amount: number; cause: string }[]> | null = null;
  try {
    done = proposeSimultaneous(g, events, items.map((it) => ({ damage: it.opts ?? {} })));
  } finally {
    if (batch) { held = g.lossBatch; g.lossBatch = null; }
  }
  for (const [player, parts] of held ?? []) {
    if (parts.length === 0 || g.player(player).hasLost) continue;
    const sum = parts.reduce((n, x) => n + x.amount, 0);
    if (g.player(player).life - sum <= covered.get(player)!) proposeResult(g, { ev: 'life', change: 'loss', player, amount: sum, cause: 'damage dealt at the same time', fromDamage: true });
    else for (const x of parts) if (!g.player(player).hasLost) proposeResult(g, { ev: 'life', change: 'loss', player, amount: x.amount, cause: x.cause, fromDamage: true });
  }
  return done.map((r) => r?.amount ?? 0);
}

function destroyFunnel(g: Game, id: ObjectId, opts: DestroyOptions): DestroyResult {
  const o = g.obj(id);
  // CR 701.19c, design 9.4 (`beRegenerated`): "can't be regenerated" makes the shields not apply.
  const canRegenerate = opts.cantRegenerate !== true && !ruleForbids(g, { action: 'beRegenerated', subject: id });
  const r = proposeResult(g, { ev: 'destroy', object: { id, zone: o.zone }, canRegenerate, ...(opts.stateBased === true ? { stateBased: true as const } : {}) }, { destroy: opts });
  return r?.destroyed ?? 'none';
}

/** trek-8 review (CR 608.2f, 704.3): the destructions of one batch, each proposed before any permanent leaves (`proposeSimultaneous`; rules/destroy.ts#destroyMany). */
function destroyManyFunnel(g: Game, items: readonly { id: ObjectId; opts: DestroyOptions }[]): DestroyResult[] {
  const events = items.map(({ id, opts }): Proposed | null => {
    const o = g.maybeObj(id);
    if (!o || o.zone !== 'battlefield') return null;
    const canRegenerate = opts.cantRegenerate !== true && !ruleForbids(g, { action: 'beRegenerated', subject: id });
    return { ev: 'destroy', object: { id, zone: o.zone }, canRegenerate, ...(opts.stateBased === true ? { stateBased: true as const } : {}) };
  });
  return proposeSimultaneous(g, events, items.map(({ opts }) => ({ destroy: opts }))).map((r) => r?.destroyed ?? 'none');
}

installZoneChangeFunnel(zoneFunnel);
installTokenFunnel(tokenFunnel);
installDamageFunnel(damageFunnel);
installSimultaneousDamageFunnel(simultaneousFunnel);
// Cloud r3-repl (CR 118.3, 122.6): the counters a cost puts are proposed too (cause 'cost', by the paying player)
installCostCounterFunnel((g, player, id, kind, count) => proposeResult(g, { ev: 'counters', change: 'put', on: { id, zone: 'battlefield' }, kind, count, cause: 'cost', by: player })?.amount ?? 0);
// edh-cast-14 (CR 118.1, 119.3, 614.1a): the life an opponent gains to pay a cost (Invigorate) is proposed, so life gain replacements apply to it
// edh-c-48 (CR 121.2, 614.11; the draw handler's two steps, effects/handlers/cards-draw.ts): the cards of a draw cost are proposed as one `drawMany` and then each as a `draw`
installCostDrawFunnel((g, player, count) => {
  const final = count > 0 ? proposeResult(g, { ev: 'drawMany', player, count })?.event : undefined;
  const k = final?.ev === 'drawMany' ? final.count : 0;
  for (let i = 0; i < k; i++) proposeResult(g, { ev: 'draw', player });
});
installCostGainLifeFunnel((g, player, amount, cause) => proposeResult(g, { ev: 'life', change: 'gain', player, amount, cause })?.amount ?? 0);
// Cloud r3-repl (CR 120.3a, 614.1a): the life loss damage causes is proposed, so effects that modify life loss apply to it
installLifeLossFunnel((g, player, amount, cause) => {
  const held = g.lossBatch?.get(player);
  if (held !== undefined) { held.push({ amount, cause }); return amount; } // edh-d-86: held for the batch (simultaneousFunnel)
  return proposeResult(g, { ev: 'life', change: 'loss', player, amount, cause, fromDamage: true })?.amount ?? 0;
}); // edh-players-3: fromDamage
// std-library-4 (CR 119.4, 614.1a): a payment of life is proposed, so "If you would pay life ..., ... instead" replaces it (effects/proposal-kinds/pay-life.ts)
installPayLifeFunnel((g, player, amount, cause, rules) => { proposeResult(g, { ev: 'payLife', player, amount, cause, rules }); });
// edh-replace-7 (CR 104.3, 614.1a): a loss of the game is proposed, so "If you would lose the game, instead ..." replaces it (effects/proposal-kinds/lose-game.ts)
installLoseGameFunnel((g, player, reason, rules) => { proposeResult(g, { ev: 'loseGame', player, reason, rules }); });
installDestroyFunnel(destroyFunnel);
installDestroyManyFunnel(destroyManyFunnel);
// edh-c-45 (CR 614.1a, 701.19b; Mossbridge Troll): the static "If ~ would be destroyed, regenerate it" effects of the battlefield (rules/destroy.ts#staticRegenerationCovers judges whom each covers)
installStaticRegenerations((s) => (replacementIndex(s).get('action') ?? []).flatMap((r) => {
  const e = r.effect;
  const o = s.objects[r.object];
  if (r.zone !== 'battlefield' || r.otherwise === true || o === undefined || e.shield !== undefined || e.body.b !== 'regeneration' || e.replaces.ev !== 'action' || e.replaces.verb !== 'destroy' || e.replaces.actor !== undefined || e.condition !== undefined) return [];
  return [{ source: r.object, controller: o.controller, filter: e.replaces.object ?? {} }];
}));
installProposeTogether((g, events) => proposeSimultaneous(g, [...events]));
installEntryPipeline(runPipeline);
// M6-1 (m6 design 3.1.5, 3.2): what the replacement bodies need from the interpreter (effects/nested.ts)
installNestedRunner((cx, steps) => {
  runSteps(cx, steps);
});
installNestedProposer((g, e) => proposeResult(g, e));
installSemOf(semOf);
