/**
 * The proposal kinds of milestone 5 (damage, life, draw, zoneChange, createToken, counters, destroy, step), registered in effects/registries.ts#PROPOSAL_KINDS.
 * M6-0 (m6 design 2.6, E17) moved here, unchanged, the cases of the four exhaustive switches over `Proposed` that every new kind would otherwise have to edit:
 * `semOf` (effects/replacements.ts: the semantic event a pattern sees, CR 614.1, 616.1), `affectedPlayer` (effects/propose.ts: who chooses among replacement
 * effects, CR 616.1), the "can't" questions (effects/cant.ts: CR 614.17, 101.2) and `performEvent` (effects/perform.ts, through effects/perform-events.ts).
 * Owner: M6-1 from W1.
 *
 * `capabilities`: the `feature:replace.on.<ev>[.<verb>]` names (m6 design D2) of the replacement patterns a proposal of this kind is matched against, i.e.
 * the pattern kinds `semOf` translates: zoneChange, damage, life, draw, createToken, counters, step, and `action` with the verb `destroy`. They were already
 * honored by milestone 5, so M6-0 registers them in the same commit as the walker names them (G10: no formerly full card is demoted).
 */
import type { Game } from '../../core/game';
import type { PlayerId } from '../../types/ids';
import type { ObjHandle, SemEvent } from '../../types/state';
import { controllerOf } from '../../rules/characteristics';
import { playerRestricted } from '../../rules/restrictions';
import { ruleDenial, type EnterFacts } from '../../statics/hooks';
import type { RuleQuery } from '../../statics/api';
import type { Proposed } from '../api';
import {
  performCountersEvent, performCreateTokenEvent, performDamageEvent, performDestroyEvent, performDrawEvent, performLifeEvent, performNothing,
  performZoneChangeEvent,
} from '../perform-events';
import type { ProposalKind } from '../registries';

type Ev<K extends Proposed['ev']> = Extract<Proposed, { ev: K }>;

const base = { seq: 0, batch: 0, before: {} };

/**
 * CR 616.1: the affected object's controller (its owner if it has none). M6-1 (m6 design D4, CR 108.4, 613.1b): a permanent's or a spell's controller is
 * judged after layer 2 (`controllerOf`); an object in any other zone has no controller (CR 108.4a), so its owner chooses.
 */
const ofObject = (g: Game, h: ObjHandle): PlayerId => {
  const live = g.s.objects[h.id];
  if (live && (live.zone === 'battlefield' || live.zone === 'stack')) return controllerOf(g.s, live);
  const o = live ?? g.s.lki[h.id]?.object;
  if (o && !live && (o.zone === 'battlefield' || o.zone === 'stack')) return o.controller;
  return o?.owner ?? g.s.turn.activePlayer;
};

/** The "can't" questions of an event (design 9.4) and the first denial among them, as a log line (CR 614.17). */
type Asked = { q: RuleQuery; controller?: PlayerId } & EnterFacts;
function firstDenial(g: Game, asked: Asked[]): string | null {
  for (const { q, ...opts } of asked) {
    const d = ruleDenial(g.s, q, opts);
    if (d) return `That can't happen (${q.action}): ${d.message}`;
  }
  return null;
}

export const DAMAGE_KIND: ProposalKind<Ev<'damage'>> = {
  ev: 'damage',
  capabilities: ['feature:replace.on.damage'],
  semOf: (_g, e) => {
    const toPlayer = typeof e.to === 'string';
    return {
      ...base, ev: 'damage',
      roles: { source: { objects: [e.source] }, ...(typeof e.to === 'string' ? { recipient: { players: [e.to] } } : { object: { objects: [e.to] } }) },
      data: { amount: e.amount, combat: e.combat, toPlayer },
    };
  },
  affectedPlayer: (g, e) => (typeof e.to === 'string' ? e.to : ofObject(g, e.to)),
  forbidden: (g, e) => firstDenial(g, [
    { q: { action: 'receiveDamage', subject: typeof e.to === 'string' ? e.to : e.to.id, other: e.source.id } },
    { q: { action: 'dealDamage', subject: e.source.id, other: typeof e.to === 'string' ? e.to : e.to.id } },
  ]),
  perform: (g, e, caller) => performDamageEvent(g, e, caller),
};

export const LIFE_KIND: ProposalKind<Ev<'life'>> = {
  ev: 'life',
  capabilities: ['feature:replace.on.life'],
  semOf: (_g, e) => ({ ...base, ev: 'life', roles: { player: { players: [e.player] } }, data: { change: e.change, amount: e.amount } }),
  affectedPlayer: (_g, e) => e.player,
  forbidden: (g, e) => {
    if (playerRestricted(g.s, e.player, e.change === 'gain' ? 'cantGainLife' : 'cantLoseLife')) {
      return `${g.player(e.player).name} can't ${e.change === 'gain' ? 'gain' : 'lose'} life (CR ${e.change === 'gain' ? '119.7' : '119.8'}).`;
    }
    return firstDenial(g, [{ q: { action: e.change === 'gain' ? 'gainLife' : 'loseLife', subject: e.player } }]);
  },
  perform: (g, e) => performLifeEvent(g, e),
};

export const DRAW_KIND: ProposalKind<Ev<'draw'>> = {
  ev: 'draw',
  capabilities: ['feature:replace.on.draw'],
  semOf: (g, e) => {
    const p = g.s.players.find((x) => x.id === e.player);
    return { ...base, ev: 'draw', roles: { player: { players: [e.player] } }, data: { nth: (p?.turnStats.cardsDrawn ?? 0) + 1 } };
  },
  affectedPlayer: (_g, e) => e.player,
  forbidden: (g, e) => firstDenial(g, [{ q: { action: 'draw', subject: e.player } }]),
  perform: (g, e) => performDrawEvent(g, e),
};

export const ZONE_CHANGE_KIND: ProposalKind<Ev<'zoneChange'>> = {
  ev: 'zoneChange',
  capabilities: ['feature:replace.on.zoneChange'],
  semOf: (g, e) => {
    const o = g.s.objects[e.object.id];
    return { ...base, ev: 'zoneChange', roles: { subject: { objects: [e.object] }, ...(o ? { player: { players: [o.controller] } } : {}) }, data: { from: e.from ?? undefined, to: e.to, oldId: e.object.id, cause: e.destination.cause } };
  },
  affectedPlayer: (g, e) => (e.to === 'battlefield' && e.destination.controller ? e.destination.controller : ofObject(g, e.object)),
  forbidden: (g, e) => {
    const d = e.destination;
    const controller = d.controller ?? g.s.objects[e.object.id]?.controller;
    const enter: Asked = {
      q: { action: 'enter', subject: e.object.id },
      ...(controller !== undefined ? { controller } : {}), ...(d.face !== undefined ? { face: d.face } : {}), ...(d.faceDown !== undefined ? { faceDown: d.faceDown } : {}),
    };
    return firstDenial(g, [
      ...(e.to === 'battlefield' ? [enter] : []),
      ...(e.from === 'battlefield' ? [{ q: { action: 'leave' as const, subject: e.object.id } }] : []),
      ...(e.to === 'exile' ? [{ q: { action: 'beExiled' as const, subject: e.object.id } }] : []),
    ]);
  },
  perform: (g, e) => performZoneChangeEvent(g, e),
};

export const CREATE_TOKEN_KIND: ProposalKind<Ev<'createToken'>> = {
  ev: 'createToken',
  capabilities: ['feature:replace.on.createToken'],
  semOf: (_g, e) => ({ ...base, ev: 'createToken', roles: { player: { players: [e.player] } }, data: { count: e.count } }),
  affectedPlayer: (_g, e) => e.player,
  forbidden: () => null,
  perform: (g, e) => performCreateTokenEvent(g, e),
};

export const COUNTERS_KIND: ProposalKind<Ev<'counters'>> = {
  ev: 'counters',
  capabilities: ['feature:replace.on.counters'],
  semOf: (g, e): SemEvent => {
    if (typeof e.on === 'string') return { ...base, ev: 'counters', roles: { player: { players: [e.on] } }, data: { change: e.change, kind: e.kind, amount: e.count, onPlayer: true, ...(e.by !== undefined ? { by: e.by } : {}) } };
    const o = g.s.objects[e.on.id];
    const have = o && Object.hasOwn(o.counters, e.kind) ? o.counters[e.kind]! : 0;
    // Cloud r3-repl (CR 122.6, 122.6a): who puts them, as effects/perform-events.ts#performCounters says it: the proposal's player, else (the counters a permanent
    // enters with, a rule's) its controller, so "if you would put one or more counters" sees them (Innkeeper's Talent)
    const by = e.by ?? (e.change === 'put' && (e.cause === 'replacement' || e.cause === 'rule') ? o?.controller : undefined);
    return { ...base, ev: 'counters', roles: { subject: { objects: [e.on] } }, data: { change: e.change, kind: e.kind, amount: e.count, total: e.change === 'put' ? have + e.count : Math.max(0, have - e.count), ...(by !== undefined ? { by } : {}) } };
  },
  affectedPlayer: (g, e) => (typeof e.on === 'string' ? e.on : ofObject(g, e.on)),
  forbidden: (g, e) => (e.change === 'put' ? firstDenial(g, [{ q: { action: 'haveCountersPut', subject: typeof e.on === 'string' ? e.on : e.on.id } }]) : null),
  perform: (g, e) => performCountersEvent(g, e),
};

export const DESTROY_KIND: ProposalKind<Ev<'destroy'>> = {
  ev: 'destroy',
  capabilities: ['feature:replace.on.action.destroy'],
  semOf: (_g, e) => ({ ...base, ev: 'action', roles: { subject: { objects: [e.object] } }, data: { verb: 'destroy' } }),
  affectedPlayer: (g, e) => ofObject(g, e.object),
  forbidden: (g, e) => firstDenial(g, [{ q: { action: 'beDestroyed', subject: e.object.id } }]),
  perform: (g, e, caller) => performDestroyEvent(g, e, caller),
};

export const STEP_KIND: ProposalKind<Ev<'step'>> = {
  ev: 'step',
  capabilities: ['feature:replace.on.step'],
  semOf: (_g, e) => ({ ...base, ev: 'step', roles: { player: { players: [e.whose] } }, data: { step: e.step } }),
  affectedPlayer: (_g, e) => e.whose,
  forbidden: () => null,
  perform: (g, e) => performNothing(g, e), // the turn structure performs the step itself; proposing it only lets "skip" effects act (M6-1)
};
