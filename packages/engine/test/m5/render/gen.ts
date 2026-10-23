/**
 * A seeded generator of type-valid ability JSON for the totality fuzz of the renderer (test/m5/render/fuzz.test.ts). It covers every discriminator of the
 * model: all 57 ops, all quantity, condition, duration, event, cost-part and static-effect kinds. It does not try to be meaningful, only valid: the
 * renderer must print it or refuse it with NoRenderer, never crash.
 */
import { eventRoles } from '../../../src/render/refs';
import type {
  AbilityDef, Condition, CostDef, CostPart, Duration, EffectProgram, EffectStep, EventPattern, EventRole, KeywordActionName, Modification, ObjectFilter, ObjRef, PlayerRef,
  Quantity, StaticEffect, TargetSpec, ZoneName,
} from '../../../src/types/ability';

export type Rng = () => number;

/** mulberry32: a tiny deterministic generator, enough for tests. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZONES: ZoneName[] = ['library', 'hand', 'battlefield', 'graveyard', 'stack', 'exile', 'command'];
const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
const TYPES = ['Creature', 'Artifact', 'Enchantment', 'Land', 'Planeswalker', 'Instant', 'Sorcery'];
const SUBTYPES = ['Goblin', 'Elf', 'Aura', 'Equipment', 'Island', 'Zombie'];
const KEYWORDS = ['flying', 'first strike', 'trample', 'haste', 'vigilance', 'deathtouch', 'reach'];
const ACTIONS: KeywordActionName[] = [
  'investigate', 'explore', 'amass', 'connive', 'populate', 'proliferate', 'bolster', 'adapt', 'monstrosity', 'support', 'fabricate', 'manifest', 'cloak', 'manifestDread', 'suspect', 'incubate',
  'discover', 'learn', 'goad', 'detain', 'exert', 'clash', 'vote', 'ringTempts', 'venture', 'timeTravel', 'meld', 'planeswalk', 'doubleCounters', 'doublePT', 'collectEvidence', 'forage',
  'blight', 'endure', 'behold', 'waterbend', 'airbend', 'earthbend', 'abandon', 'setInMotion', 'assemble', 'harness', 'openAttraction', 'rollToVisit', 'cascade', 'cycle', 'transmute',
];
const STEPS = ['untap', 'upkeep', 'draw', 'main1', 'beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat', 'main2', 'end', 'cleanup'] as const;

export class Gen {
  /** Target ids available to references. */
  targets: string[] = [];
  names: string[] = [];
  /** The event roles the trigger being generated exposes (null outside a trigger: any role is accepted there). */
  roles: { role: EventRole; kind: 'object' | 'player' }[] | null = null;

  constructor(readonly r: Rng) {}

  int(n: number): number {
    return Math.floor(this.r() * n);
  }
  chance(p: number): boolean {
    return this.r() < p;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)]!;
  }
  some<T>(xs: readonly T[], max = 2): T[] {
    const n = 1 + this.int(max);
    return Array.from({ length: n }, () => this.pick(xs));
  }

  player(depth: number): PlayerRef {
    const k = this.int(12);
    switch (k) {
      case 0: return { ref: 'anOpponent' };
      case 1: return { ref: 'each', who: this.pick(['player', 'opponent', 'otherPlayer'] as const) };
      case 2: return { ref: 'active' };
      case 3: return { ref: 'defending' };
      case 4: return { ref: 'iterating' };
      case 5: {
        if (this.roles === null) return { ref: 'event', role: this.pick(['player', 'recipient', 'defender'] as const) };
        const rs = this.roles.filter((x) => x.kind === 'player');
        return rs.length > 0 ? { ref: 'event', role: this.pick(rs).role } : { ref: 'you' };
      }
      case 6: return depth > 0 ? { ref: 'controllerOf', object: this.obj(depth - 1) } : { ref: 'you' };
      case 7: return depth > 0 ? { ref: 'ownerOf', object: this.obj(depth - 1) } : { ref: 'you' };
      case 8: return { ref: 'linked', link: 'chosen' };
      case 9: return this.targets.length > 0 ? { ref: 'target', id: this.pick(this.targets) } : { ref: 'you' };
      default: return { ref: 'you' };
    }
  }

  obj(depth: number): ObjRef {
    const k = this.int(13);
    switch (k) {
      case 0: return { ref: 'self' };
      case 1: return this.targets.length > 0 ? { ref: 'target', id: this.pick(this.targets) } : { ref: 'self' };
      case 2: return { ref: 'bound', name: this.names.length > 0 ? this.pick(this.names) : 'x' };
      case 3: {
        if (this.roles === null) return { ref: 'event', role: this.pick(['subject', 'object', 'source', 'spell', 'attacker', 'blocker', 'newObject'] as const) };
        const rs = this.roles.filter((x) => x.kind === 'object');
        return rs.length > 0 ? { ref: 'event', role: this.pick(rs).role } : { ref: 'self' };
      }
      case 4: return { ref: 'attachedTo' };
      case 5: return { ref: 'linked', link: 'exiled' };
      case 6: return { ref: 'each', filter: this.filter(depth) };
      case 7: return { ref: 'subject' };
      case 8: return { ref: 'topCards', player: { ref: 'you' }, count: this.int(5) + 1 };
      case 9: return depth > 0 ? { ref: 'union', of: [this.obj(depth - 1), this.obj(depth - 1)] } : { ref: 'self' };
      default: return { ref: 'each', filter: this.filter(depth) };
    }
  }

  filter(depth: number): ObjectFilter {
    const f: ObjectFilter = {};
    if (this.chance(0.7)) f.types = this.some(TYPES);
    if (this.chance(0.15)) f.allTypes = this.some(TYPES);
    if (this.chance(0.15)) f.notTypes = this.some(TYPES);
    if (this.chance(0.2)) f.subtypes = this.some(SUBTYPES);
    if (this.chance(0.1)) f.notSubtypes = this.some(SUBTYPES);
    if (this.chance(0.1)) f.supertypes = [this.pick(['Basic', 'Legendary', 'Snow'])];
    if (this.chance(0.1)) f.notSupertypes = [this.pick(['Basic', 'Legendary'])];
    if (this.chance(0.2)) f.colors = this.some(COLORS);
    if (this.chance(0.1)) f.notColors = this.some(COLORS);
    if (this.chance(0.05)) f.colorless = true;
    if (this.chance(0.05)) f.multicolored = true;
    if (this.chance(0.05)) f.monocolored = true;
    if (this.chance(0.3)) f.controller = this.pick(['you', 'opponent', 'any'] as const);
    if (this.chance(0.1)) f.owner = this.pick(['you', 'opponent', 'any'] as const);
    if (this.chance(0.15)) f.zone = this.chance(0.3) ? this.some(ZONES) : this.pick(ZONES);
    if (this.chance(0.05)) f.zone = 'any';
    if (this.chance(0.1)) f.manaValue = { op: this.pick(['<=', '>=', '==', '!=', '<', '>'] as const), value: this.int(6) };
    if (this.chance(0.1)) f.power = { op: this.pick(['<=', '>='] as const), value: this.int(6) };
    if (this.chance(0.1)) f.toughness = { op: '==', value: { q: 'X' } };
    if (this.chance(0.1)) f.keyword = this.chance(0.5) ? this.pick(KEYWORDS) : this.some(KEYWORDS);
    if (this.chance(0.05)) f.notKeyword = this.pick(KEYWORDS);
    if (this.chance(0.05)) f.hasAbility = this.pick(['activated', 'mana', 'triggered', 'static'] as const);
    if (this.chance(0.1)) f.tapped = this.chance(0.5);
    if (this.chance(0.07)) f.token = this.chance(0.5);
    if (this.chance(0.05)) f.isCard = this.chance(0.5);
    if (this.chance(0.04)) f.faceDown = this.chance(0.5);
    if (this.chance(0.03)) f.transformed = true;
    if (this.chance(0.03)) f.isCopy = true;
    if (this.chance(0.08)) f.attacking = this.chance(0.7) ? true : { defender: 'you' };
    if (this.chance(0.05)) f.blocking = true;
    if (this.chance(0.03)) f.blocked = true;
    if (this.chance(0.05)) f.other = true;
    if (this.chance(0.03)) f.attached = this.chance(0.5);
    if (this.chance(0.03)) f.attachedToSource = true;
    if (this.chance(0.05)) f.counters = { kind: '+1/+1', cmp: this.chance(0.5) ? { op: '>=', value: 2 } : undefined };
    if (this.chance(0.04)) f.enteredThisTurn = true;
    if (this.chance(0.04)) f.dealtDamageThisTurn = true;
    if (this.chance(0.03)) f.attackedThisTurn = true;
    if (this.chance(0.03)) f.blockedThisTurn = true;
    if (this.chance(0.03)) f.name = 'Island';
    if (this.chance(0.02)) f.notName = 'Forest';
    if (this.chance(0.03)) f.chosen = { link: 'c', quality: this.pick(['color', 'creatureType', 'cardType', 'landType', 'cardName'] as const) };
    if (this.chance(0.03)) f.stackKind = this.pick(['spell', 'activatedAbility', 'triggeredAbility', 'ability', 'copy'] as const);
    if (this.chance(0.03)) f.castFrom = this.pick(ZONES);
    if (this.chance(0.02)) f.self = true;
    if (depth > 0 && this.chance(0.05)) f.sharesWith = { with: { ref: 'self' }, quality: this.pick(['creatureType', 'color', 'cardType', 'name', 'landType'] as const) };
    if (depth > 0 && this.chance(0.05)) f.not = { controller: 'you' };
    if (depth > 0 && this.chance(0.04)) f.anyOf = [this.filter(depth - 1), this.filter(depth - 1)];
    return f;
  }

  quantity(depth: number): Quantity {
    const k = this.int(26);
    switch (k) {
      case 0: return this.int(10);
      case 1: return { q: 'X' };
      case 2: return { q: 'var', name: 'n' };
      case 3: return { q: 'count', of: this.obj(depth) };
      case 4: return { q: 'countPlayers', of: this.player(0) };
      case 5: return { q: 'stat', stat: this.pick(['power', 'toughness', 'manaValue', 'loyalty', 'defense'] as const), of: this.obj(0), sum: this.chance(0.3) };
      case 6: return { q: 'life', of: this.player(0) };
      case 7: return { q: 'zoneSize', zone: this.pick(ZONES), of: this.player(0) };
      case 8: return { q: 'counters', on: this.chance(0.5) ? this.obj(0) : this.player(0), kind: this.pick(['+1/+1', 'charge', 'any']) };
      case 9: return { q: 'devotion', to: this.some(COLORS), of: this.player(0) };
      case 10: return { q: 'distinct', what: this.pick(['colors', 'cardTypes', 'creatureTypes', 'names', 'landTypes', 'manaValues'] as const), among: this.obj(0) };
      case 11: return { q: 'happenedCount', event: this.event(0), scope: this.pick(['turn', 'combat', 'game'] as const), by: this.chance(0.5) ? 'you' : undefined };
      case 12: return { q: 'eventAmount' };
      case 13: return { q: 'resultCount', step: 'n' };
      case 14: return { q: 'targetCount', id: this.targets[0] ?? 't0' };
      case 15: return { q: 'spellTargetCount' };
      case 16: return { q: 'dieResult' };
      case 17: return { q: this.pick(['speed', 'age', 'level', 'turnNumber', 'cardsDrawnThisTurn', 'spellsCastThisTurn', 'lifeGainedThisTurn'] as const) };
      case 18: return depth > 0 ? { q: 'math', op: this.pick(['+', '-', '*', 'floorDiv', 'ceilDiv', 'min', 'max'] as const), args: [this.quantity(depth - 1), this.quantity(depth - 1)] } : 2;
      case 19: return depth > 0 ? { q: 'live', value: this.quantity(depth - 1) } : { q: 'X' };
      case 20: return { q: 'ask', text: 'the number you are told' };
      default: return this.int(5);
    }
  }

  condition(depth: number): Condition {
    const k = this.int(14);
    switch (k) {
      case 0: return depth > 0 ? { cond: 'all', of: [this.condition(depth - 1), this.condition(depth - 1)] } : { cond: 'turnOf', whose: 'you' };
      case 1: return depth > 0 ? { cond: 'any', of: [this.condition(depth - 1), this.condition(depth - 1)] } : { cond: 'turnOf', whose: 'opponent' };
      case 2: return depth > 0 ? { cond: 'not', of: this.condition(depth - 1) } : { cond: 'turnOf', whose: 'you' };
      case 3: return { cond: 'compare', left: this.quantity(1), op: this.pick(['<=', '>=', '==', '!=', '<', '>'] as const), right: this.quantity(1) };
      case 4: return { cond: 'exists', of: this.obj(1), atLeast: this.chance(0.3) ? this.int(4) : undefined };
      case 5: return { cond: 'matches', object: this.obj(0), filter: this.filter(0) };
      case 6: return { cond: 'turnOf', whose: this.pick(['you', 'opponent', 'any'] as const), step: this.chance(0.5) ? this.pick(STEPS) : undefined };
      case 7: return { cond: 'wasCast', kicked: this.chance(0.5) ? true : undefined, from: this.chance(0.3) ? this.pick(ZONES) : undefined, via: this.chance(0.2) ? 'flashback' : undefined, xAtLeast: this.chance(0.2) ? 3 : undefined };
      case 8: return { cond: 'happened', event: this.event(0), scope: this.pick(['turn', 'combat', 'game'] as const), times: this.chance(0.3) ? { op: '>=', value: 2 } : undefined, by: this.chance(0.3) ? 'you' : undefined };
      case 9: return { cond: 'did', step: this.names[0] ?? 'x', not: this.chance(0.4) };
      case 10: return { cond: 'designation', who: this.player(0), what: this.pick(['monarch', 'initiative', 'citysBlessing', 'day', 'night'] as const) };
      case 11: return { cond: 'chosen', link: 'color', equals: 'red' };
      case 12: return { cond: 'ask', text: 'the thing is true' };
      default: return { cond: 'turnOf', whose: 'you' };
    }
  }

  duration(depth: number): Duration {
    const k = this.int(9);
    switch (k) {
      case 0: return { d: 'endOfTurn' };
      case 1: return { d: 'endOfCombat' };
      case 2: return { d: 'permanent' };
      case 3: return { d: 'whileSource', as: this.pick(['onBattlefield', 'controlled', 'attached', 'tapped'] as const) };
      case 4: return { d: 'until', event: this.event(0) };
      case 5: return { d: 'untilNextTurn', whose: this.player(0) };
      case 6: return { d: 'untilNextStep', step: this.pick(STEPS), whose: this.chance(0.5) ? 'you' : undefined };
      case 7: return depth > 0 ? { d: 'asLongAs', cond: this.condition(depth - 1) } : { d: 'endOfTurn' };
      default: return { d: 'endOfTurn' };
    }
  }

  event(depth: number): EventPattern {
    const k = this.int(18);
    const f = (): ObjectFilter => this.filter(depth);
    switch (k) {
      case 0: return { ev: 'zoneChange', subject: f(), from: this.chance(0.5) ? this.pick(ZONES) : undefined, to: this.chance(0.7) ? this.pick(ZONES) : undefined };
      case 1: return { ev: 'cast', player: this.chance(0.7) ? this.pick(['you', 'opponent', 'any'] as const) : undefined, spell: this.chance(0.4) ? f() : undefined, from: this.chance(0.2) ? this.pick(ZONES) : undefined, orCopy: this.chance(0.1) };
      case 2: return { ev: 'activate', player: this.pick(['you', 'opponent'] as const), source: this.chance(0.5) ? f() : undefined, manaAbility: this.chance(0.5) ? false : undefined };
      case 3: return { ev: 'attacks', attacker: this.chance(0.7) ? f() : undefined, alone: this.chance(0.2), defender: this.chance(0.3) ? this.pick(['you', 'planeswalker', 'battle'] as const) : undefined, count: this.chance(0.1) ? { op: '>=', value: 2 } : undefined };
      case 4: return { ev: 'blocks', blocker: this.chance(0.7) ? f() : undefined, attacker: this.chance(0.3) ? f() : undefined };
      case 5: return { ev: 'becomesBlocked', attacker: f(), by: this.chance(0.3) ? f() : undefined };
      case 6: return { ev: 'damage', source: this.chance(0.7) ? f() : undefined, recipient: this.chance(0.7) ? { object: this.chance(0.5) ? f() : undefined, player: this.chance(0.5) ? 'any' : undefined } : undefined, combat: this.chance(0.5), amount: this.chance(0.2) ? { op: '>=', value: 3 } : undefined };
      case 7: return { ev: 'step', step: this.pick(STEPS), whose: this.chance(0.7) ? this.pick(['you', 'opponent', 'any'] as const) : undefined };
      case 8: return { ev: 'life', change: this.pick(['gain', 'loss'] as const), player: this.chance(0.7) ? 'you' : undefined, amount: this.chance(0.2) ? { op: '>=', value: 2 } : undefined };
      case 9: return { ev: 'draw', player: this.pick(['you', 'opponent'] as const), nth: this.chance(0.3) ? 2 : undefined };
      case 10: return { ev: 'becomes', what: this.pick(['tapped', 'untapped', 'targeted', 'attached', 'unattached', 'transformed', 'turnedFaceUp', 'monstrous', 'renowned', 'saddled', 'crewed'] as const), object: f(), by: this.chance(0.2) ? f() : undefined };
      case 11: return { ev: 'counters', change: this.pick(['put', 'removed'] as const), kind: this.chance(0.7) ? '+1/+1' : undefined, on: this.chance(0.8) ? f() : { player: 'you' }, atLeast: this.chance(0.2) ? 2 : undefined };
      case 12: return { ev: 'action', verb: this.pick([...ACTIONS, 'sacrifice', 'discard', 'cycle', 'scry', 'surveil', 'search', 'shuffle', 'mill', 'create', 'playLand', 'regenerate', 'exile', 'destroy', 'tap', 'untap', 'counter', 'attach', 'transform', 'reveal'] as const), actor: this.chance(0.7) ? 'you' : undefined, object: this.chance(0.5) ? f() : undefined };
      case 13: return { ev: 'createToken', player: this.chance(0.7) ? 'you' : undefined, token: this.chance(0.3) ? f() : undefined };
      case 14: return { ev: 'dieRoll', player: 'you', result: this.chance(0.3) ? { op: '>=', value: 5 } : undefined };
      case 15: return depth > 0 ? { ev: 'state', cond: this.condition(depth - 1) } : { ev: 'beginTurn', whose: 'you' };
      case 16: return { ev: 'beginTurn', whose: this.chance(0.5) ? 'you' : undefined, extra: this.chance(0.2) };
      default: return { ev: 'resolves', what: f() };
    }
  }

  costPart(): CostPart {
    const k = this.int(14);
    switch (k) {
      case 0: return { kind: 'sacrifice', filter: this.filter(0), count: this.chance(0.5) ? 1 : this.pick([2, 'any'] as const), self: this.chance(0.2) };
      case 1: return { kind: 'payLife', amount: this.quantity(0) };
      case 2: return { kind: 'discard', filter: this.chance(0.5) ? this.filter(0) : undefined, count: this.pick([1, 2, 'any'] as const), random: this.chance(0.2), self: this.chance(0.1), hand: this.chance(0.1) };
      case 3: return { kind: 'exileFrom', zone: this.pick(ZONES), filter: this.chance(0.5) ? this.filter(0) : undefined, count: this.pick([1, 2] as const), self: this.chance(0.2) };
      case 4: return { kind: 'tapUntapped', filter: this.filter(0), count: this.pick([1, 2, 'any'] as const), other: this.chance(0.3) };
      case 5: return { kind: 'tapPower', filter: this.filter(0), power: this.int(5) + 1, other: this.chance(0.3) };
      case 6: return { kind: 'removeCounters', counter: this.pick(['+1/+1', 'charge', 'any']), count: this.int(3) + 1, self: this.chance(0.5), filter: this.chance(0.3) ? this.filter(0) : undefined };
      case 7: return { kind: 'putCounters', counter: '-1/-1', count: this.int(3) + 1, self: this.chance(0.5), filter: this.chance(0.3) ? this.filter(0) : undefined };
      case 8: return { kind: 'returnToHand', filter: this.filter(0), count: this.pick([1, 2, 'any'] as const), self: this.chance(0.2) };
      case 9: return { kind: 'reveal', zone: 'hand', filter: this.chance(0.5) ? this.filter(0) : undefined, count: this.pick([1, 2] as const), self: this.chance(0.2) };
      case 10: return { kind: 'mill', count: this.int(4) + 1 };
      case 11: return { kind: 'payEnergy', amount: this.int(4) + 1 };
      case 12: return { kind: 'action', action: this.pick(ACTIONS), arg: this.chance(0.5) ? this.int(5) : undefined };
      default: return { kind: 'manual', text: 'Do a handstand' };
    }
  }

  cost(): CostDef {
    const c: CostDef = {};
    if (this.chance(0.6)) c.mana = [{ kind: 'generic', amount: this.int(4) }, ...(this.chance(0.5) ? [{ kind: 'colored' as const, color: this.pick(COLORS) }] : [])];
    if (this.chance(0.4)) c.tap = true;
    if (this.chance(0.05)) c.untap = true;
    if (this.chance(0.1)) c.loyalty = this.int(7) - 3;
    if (this.chance(0.4)) c.other = Array.from({ length: 1 + this.int(2) }, () => this.costPart());
    return c;
  }

  mods(): Modification[] {
    const out: Modification[] = [];
    if (this.chance(0.1)) out.push({ layer: 2, controller: this.player(0) });
    if (this.chance(0.2)) out.push({ layer: 4, types: this.chance(0.5) ? { add: ['Creature'] } : { set: ['Creature'] }, subtypes: this.chance(0.5) ? { set: ['Elk'] } : { all: true }, supertypes: this.chance(0.1) ? { add: ['Legendary'] } : undefined });
    if (this.chance(0.2)) out.push({ layer: 5, colors: this.chance(0.5) ? { set: this.some(COLORS) } : { add: [this.pick(COLORS)] } });
    if (this.chance(0.3)) out.push({ layer: 6, add: this.chance(0.7) ? [{ kind: 'keyword', text: '', keyword: this.pick(KEYWORDS) }] : undefined, removeAll: this.chance(0.2) ? true : undefined, remove: this.chance(0.1) ? ['flying'] : undefined });
    if (this.chance(0.2)) out.push({ layer: '7b', power: this.int(5), toughness: this.int(5) });
    if (this.chance(0.4)) out.push({ layer: '7c', power: this.chance(0.7) ? this.int(5) - 1 : this.quantity(1), toughness: this.chance(0.7) ? this.int(5) - 1 : this.quantity(1) });
    if (this.chance(0.05)) out.push({ layer: '7d', switchPT: true });
    if (this.chance(0.03)) out.push({ layer: '7a', power: this.quantity(1), toughness: this.quantity(1) });
    if (this.chance(0.03)) out.push({ layer: '1a', copyOf: this.obj(0) });
    if (this.chance(0.03)) out.push({ layer: '1b', faceDown: true });
    if (this.chance(0.03)) out.push({ layer: 3, changeWord: { from: 'red', to: 'blue', kind: 'color' } });
    return out.length > 0 ? out : [{ layer: '7c', power: 1, toughness: 1 }];
  }

  staticEffect(depth: number): StaticEffect {
    const k = this.int(10);
    switch (k) {
      case 0: return { s: 'continuous', affects: this.chance(0.8) ? this.obj(0) : this.player(0), mods: this.mods(), cda: this.chance(0.1) };
      case 1: return { s: 'costMod', applies: { self: this.chance(0.3), spells: this.chance(0.5) ? this.filter(0) : undefined, abilities: this.chance(0.2) ? { kind: this.pick(['activated', 'loyalty', 'mana'] as const) } : undefined, caster: this.pick(['you', 'opponent', 'any'] as const) }, change: { kind: this.pick(['increase', 'reduce', 'set'] as const), generic: this.chance(0.7) ? this.int(3) : this.quantity(1), mana: this.chance(0.2) ? [{ kind: 'colored', color: 'R' }] : undefined } };
      case 2: return { s: 'restrict', subject: this.chance(0.5) ? this.obj(0) : this.player(0), mode: this.pick(['cant', 'mustIfAble', 'onlyIf'] as const), action: this.pick(['attack', 'block', 'beBlocked', 'beBlockedBy', 'attackPlayer', 'cast', 'activate', 'playLand', 'draw', 'gainLife', 'loseLife', 'lose', 'win', 'untap', 'untapDuringUntapStep', 'tap', 'beTapped', 'transform', 'search', 'sacrifice', 'discard', 'beTargeted', 'beCountered', 'beDestroyed', 'beRegenerated', 'beSacrificed', 'beExiled', 'beAttached', 'beEnchanted', 'beEquipped', 'dealDamage', 'receiveDamage', 'preventDamage', 'enter', 'leave', 'gainAbility', 'haveCountersPut', 'payLife', 'castFromZone', 'spendMana'] as const), other: this.chance(0.3) ? this.filter(0) : undefined, max: this.chance(0.1) ? 1 : undefined, when: depth > 0 && this.chance(0.2) ? this.condition(0) : undefined };
      case 3: return { s: 'replace', replaces: this.event(0), body: this.replacementBody(depth), condition: depth > 0 && this.chance(0.1) ? this.condition(0) : undefined, optional: this.chance(0.1), shield: this.chance(0.1) ? { uses: 1 } : undefined };
      case 4: return { s: 'permit', who: this.player(0), action: this.pick(['cast', 'play', 'playLand', 'activate', 'spendMana', 'haveFlash', 'attackAsThoughNoDefender', 'blockAsThough', 'lookAt', 'revealTop'] as const), of: this.chance(0.5) ? this.filter(0) : undefined, from: this.chance(0.3) ? this.pick(ZONES) : undefined, asThough: this.chance(0.3) ? 'it had flash' : undefined, count: this.chance(0.3) ? 1 : undefined };
      case 5: return { s: 'rule', rule: this.pick(['maxHandSize', 'startingLife', 'landPlays', 'combatDamageUsesToughness', 'manaDoesNotEmpty', 'attackTax', 'extraBlockers', 'extraAttackerBlocks', 'handSizeNoLimit', 'poisonLimit', 'commanderTax', 'lifeTotalSetAs'] as const), player: this.chance(0.7) ? this.player(0) : undefined, value: this.chance(0.7) ? this.int(5) : 'none', of: this.chance(0.2) ? this.filter(0) : undefined };
      case 6: return { s: 'triggerMod', cause: this.event(0), abilitiesOf: this.filter(0), additional: this.chance(0.8) ? 1 : this.quantity(0) };
      case 7: return { s: 'additionalCost', cost: this.cost(), optional: this.chance(0.5), repeatable: this.chance(0.2) };
      case 8: return { s: 'alternativeCost', cost: this.cost(), from: this.chance(0.3) ? this.pick(ZONES) : undefined, name: 'alt', when: depth > 0 && this.chance(0.2) ? this.condition(0) : undefined };
      default: return { s: 'pregame', action: this.pick(['beginOnBattlefield', 'reveal', 'exileBeforeShuffle'] as const), optional: this.chance(0.5) };
    }
  }

  replacementBody(depth: number): Extract<StaticEffect, { s: 'replace' }>['body'] {
    const k = this.int(7);
    switch (k) {
      case 0: return { b: 'instead', do: depth > 0 ? [this.step(depth - 1)] : [{ op: 'endTurn' }] };
      case 1: return { b: 'modify', amount: this.chance(0.5) ? { mul: 2 } : undefined, count: this.chance(0.5) ? { mul: 2 } : undefined, destination: this.chance(0.4) ? { zone: 'exile' } : undefined, to: this.chance(0.1) ? { ref: 'you' } : undefined };
      case 2: return { b: 'prevent', amount: this.chance(0.5) ? 'all' : this.int(4) };
      case 3: return { b: 'redirect', to: this.chance(0.5) ? this.obj(0) : this.player(0) };
      case 4: return { b: 'skip' };
      case 5: return { b: 'enters', tapped: this.chance(0.5), tappedUnless: this.chance(0.2) ? this.condition(0) : undefined, counters: this.chance(0.3) ? [{ kind: '+1/+1', count: 2 }] : undefined, choose: this.chance(0.2) ? [{ what: 'color', link: 'c' }] : undefined, copy: this.chance(0.1) ? { of: this.filter(0), optional: true } : undefined, faceDown: this.chance(0.05) };
      default: return { b: 'regeneration' };
    }
  }

  destination(): Extract<EffectStep, { op: 'move' }>['to'] {
    const zone = this.pick(ZONES.filter((z) => z !== 'battlefield'));
    if (this.chance(0.3)) return { zone: 'battlefield', controller: this.pick(['owner'] as const), tapped: this.chance(0.3), attacking: this.chance(0.1), faceDown: this.chance(0.05) };
    return { zone, owner: this.chance(0.2) ? { ref: 'you' } : undefined, position: zone === 'library' ? this.pick(['top', 'bottom', 'random', undefined]) : undefined };
  }

  step(depth: number): EffectStep {
    const you: PlayerRef = { ref: 'you' };
    const who = (): PlayerRef => (this.chance(0.6) ? you : this.player(0));
    const sub = (): EffectStep[] => (depth > 0 ? [this.step(depth - 1)] : [{ op: 'draw', who: you, count: 1 }]);
    const k = this.int(58);
    switch (k) {
      case 0: return { op: 'if', cond: this.condition(1), then: sub(), else: this.chance(0.4) ? sub() : undefined };
      case 1: return { op: 'may', who: who(), do: sub(), otherwise: this.chance(0.2) ? sub() : undefined, as: this.chance(0.3) ? 'm' : undefined };
      case 2: return { op: 'pay', who: who(), cost: this.cost(), times: this.chance(0.1) ? 2 : undefined, mandatory: this.chance(0.2), then: this.chance(0.4) ? sub() : undefined, else: this.chance(0.4) ? sub() : undefined };
      case 3: return { op: 'forEach', over: this.obj(1), as: 'e', do: sub() };
      case 4: return { op: 'repeat', times: this.int(4) + 1, do: sub() };
      case 5: return { op: 'let', name: 'n', value: this.quantity(1) };
      case 6: return { op: 'chooseObjects', who: who(), from: this.obj(1), min: this.int(2), max: this.pick([1, 2, 'any'] as const), as: this.chance(0.5) ? 'c' : 'd', random: this.chance(0.1) };
      case 7: return { op: 'chooseValue', who: who(), what: this.pick(['color', 'creatureType', 'cardType', 'landType', 'cardName', 'number', 'player', 'opponent', 'option', 'oddEven'] as const), as: 'v', options: this.chance(0.3) ? ['a', 'b'] : undefined };
      case 8: return { op: 'manual', text: 'Do the thing.', reason: 'test' };
      case 9: return { op: 'damage', source: this.obj(0), to: this.chance(0.5) ? this.obj(0) : this.player(0), amount: this.quantity(1), divided: this.chance(0.2) ? this.pick(['announced', 'evenlyRoundDown', 'evenlyRoundUp'] as const) : undefined, unpreventable: this.chance(0.1) };
      case 10: return { op: 'gainLife', who: who(), amount: this.quantity(1) };
      case 11: return { op: 'loseLife', who: who(), amount: this.quantity(1) };
      case 12: return { op: 'setLife', who: who(), value: this.quantity(0) };
      case 13: return { op: 'draw', who: who(), count: this.quantity(1) };
      case 14: return { op: 'discard', who: who(), count: this.chance(0.2) ? 'hand' : this.quantity(0), filter: this.chance(0.3) ? this.filter(0) : undefined, mode: this.chance(0.3) ? this.pick(['choose', 'random', 'opponentChooses'] as const) : undefined };
      case 15: return { op: 'mill', who: who(), count: this.quantity(0) };
      case 16: return { op: 'scry', who: you, count: this.int(4) + 1 };
      case 17: return { op: 'surveil', who: you, count: this.int(4) + 1 };
      case 18: return { op: 'reveal', who: who(), what: this.obj(0), to: this.chance(0.2) ? 'all' : undefined, as: this.chance(0.3) ? 'r' : undefined };
      case 19: return { op: 'look', who: who(), at: this.obj(0), as: this.chance(0.3) ? 'l' : undefined };
      case 20: return { op: 'search', who: who(), zone: this.pick(ZONES), owner: this.chance(0.2) ? this.player(0) : undefined, filter: this.filter(0), min: this.chance(0.3) ? 0 : undefined, max: this.pick([1, 2, 'any'] as const), reveal: this.chance(0.4), as: 's' };
      case 21: return { op: 'shuffle', who: who() };
      case 22: return { op: 'piles', cards: this.obj(0), separator: who(), chooser: who(), chosen: 'p1', other: 'p2' };
      case 23: return { op: 'move', what: this.obj(1), to: this.destination(), until: this.chance(0.1) ? this.duration(0) : undefined, link: this.chance(0.2) ? 'moved' : undefined };
      case 24: return { op: 'destroy', what: this.obj(1), regeneration: this.chance(0.3) ? this.pick(['allowed', 'cant'] as const) : undefined };
      case 25: return { op: 'sacrifice', what: this.obj(0) };
      case 26: return { op: 'sacrificeChoice', who: who(), filter: this.filter(0), count: this.int(3) + 1, mode: this.chance(0.2) ? 'all' : undefined };
      case 27: return { op: 'counter', what: this.obj(0), to: this.chance(0.3) ? this.destination() : undefined };
      case 28: return { op: 'createToken', who: who(), token: this.chance(0.3) ? { predefined: this.pick(['Treasure', 'Food', 'Clue']) } : { name: 'Bear', colors: this.some(COLORS), types: ['Creature'], subtypes: ['Bear'], power: this.chance(0.8) ? 2 : { q: 'X' }, toughness: 2, keywords: this.chance(0.3) ? ['flying'] : undefined, abilities: this.chance(0.1) ? [{ kind: 'keyword', text: '', keyword: 'haste' }] : undefined }, count: this.quantity(0), tapped: this.chance(0.2), attacking: this.chance(0.1), attachTo: this.chance(0.05) ? this.obj(0) : undefined, counters: this.chance(0.1) ? [{ kind: '+1/+1', count: 1 }] : undefined };
      case 29: return { op: 'copy', what: this.obj(0), result: this.pick(['spell', 'token'] as const), who: who(), count: this.chance(0.2) ? 2 : undefined, newTargets: this.chance(0.3) ? this.pick([true, false, 'may'] as const) : undefined, except: this.chance(0.1) ? this.mods() : undefined, tapped: this.chance(0.1), attacking: this.chance(0.1) };
      case 30: return { op: 'tap', what: this.obj(0) };
      case 31: return { op: 'untap', what: this.obj(0) };
      case 32: return { op: 'attach', what: this.obj(0), to: this.chance(0.8) ? this.obj(0) : null };
      case 33: return { op: 'changeFace', what: this.obj(0), to: this.pick(['transform', 'convert', 'faceUp', 'faceDown', 'flip'] as const), manifest: this.chance(0.1) };
      case 34: return { op: 'phaseOut', what: this.obj(0) };
      case 35: return { op: 'regenerate', what: this.obj(0), duration: this.chance(0.3) ? this.duration(0) : undefined };
      case 36: return { op: 'removeFromCombat', what: this.obj(0) };
      case 37: return { op: 'fight', a: this.obj(0), b: this.obj(0) };
      case 38: return { op: 'exchange', a: this.chance(0.5) ? this.obj(0) : this.player(0), b: this.chance(0.5) ? this.obj(0) : this.player(0), what: this.pick(['control', 'life', 'hands', 'powerToughness'] as const) };
      case 39: return { op: 'cast', who: who(), what: this.obj(0), free: this.chance(0.5), costChange: this.chance(0.2) ? { kind: this.pick(['reduce', 'increase', 'set'] as const), generic: 2 } : undefined, optional: this.chance(0.5) };
      case 40: return { op: 'putCounters', on: this.chance(0.7) ? this.obj(0) : this.player(0), kind: this.pick(['+1/+1', 'poison', 'energy', 'charge']), count: this.quantity(0) };
      case 41: return { op: 'removeCounters', from: this.obj(0), kind: this.pick(['+1/+1', 'any']), count: this.chance(0.3) ? 'all' : this.quantity(0) };
      case 42: return { op: 'moveCounters', from: this.obj(0), to: this.obj(0), kind: '+1/+1', count: this.chance(0.3) ? 'all' : this.quantity(0) };
      case 43: return this.chance(0.5)
        ? { op: 'addMana', who: you, units: [this.some(['W', 'U', 'B', 'R', 'G', 'C'] as const, 5)], restriction: this.chance(0.2) ? { spells: this.filter(0), spellRider: 'cantBeCountered' } : undefined }
        : { op: 'addMana', who: you, dynamic: this.pick([{ kind: 'anyColor', count: 1 }, { kind: 'anyOneColor', count: 2 }, { kind: 'chosen', link: 'c', count: 1 }, { kind: 'ofType', type: 'G', count: { q: 'X' } }, { kind: 'sameAsSpent' }] as const) };
      case 44: return { op: 'effect', effects: [this.staticEffect(depth)], duration: this.duration(0) };
      case 45: return { op: 'delay', when: this.pick([{ at: 'step', step: 'end', next: true }, { at: 'endOfCombat' }, { at: 'event', event: this.event(0) }] as const), do: sub(), capture: this.chance(0.2) ? ['c'] : undefined, duration: this.chance(0.2) ? { d: 'endOfTurn' } : undefined };
      case 46: return { op: 'reflexive', when: { did: 'm' }, targets: [], do: sub() };
      case 47: return { op: 'extraTurn', who: who(), count: 1 };
      case 48: return { op: 'extraPhase', phase: this.pick(['combat', 'main'] as const), after: this.chance(0.5) ? this.pick(STEPS) : undefined };
      case 49: return { op: 'endTurn' };
      case 50: return { op: 'winGame', who: who() };
      case 51: return { op: 'loseGame', who: who() };
      case 52: return { op: 'createEmblem', who: you, abilities: [{ kind: 'keyword', text: '', keyword: 'flying' }] };
      case 53: return { op: 'rollDie', who: you, sides: this.pick([6, 20]), count: this.chance(0.3) ? 2 : undefined, table: this.chance(0.2) ? [{ min: 1, max: 5, do: sub() }] : undefined };
      case 54: return { op: 'flipCoin', who: who(), onWin: this.chance(0.5) ? sub() : undefined, onLose: this.chance(0.5) ? sub() : undefined };
      case 55: return { op: 'designate', who: you, what: this.pick(['monarch', 'initiative', 'day', 'night'] as const) };
      case 56: return { op: 'action', action: this.pick(ACTIONS), subject: this.chance(0.6) ? this.obj(0) : undefined, who: you, n: this.chance(0.5) ? this.int(4) : undefined, arg: this.chance(0.2) ? 'x' : undefined };
      default: return { op: 'draw', who: you, count: 1 };
    }
  }

  program(depth: number): EffectProgram {
    const targets: TargetSpec[] = [];
    const n = this.int(3);
    for (let i = 0; i < n; i++) {
      const id = `t${i}`;
      targets.push({
        id, kind: this.pick(['object', 'player', 'objectOrPlayer', 'anyTarget', 'spell', 'ability', 'stackObject'] as const),
        filter: this.chance(0.7) ? this.filter(0) : undefined, players: this.chance(0.2) ? { who: 'opponent' } : undefined,
        min: this.pick([0, 1, 2] as const), max: this.pick([1, 2, 'any'] as const), text: '', distinctFrom: i > 0 && this.chance(0.2) ? ['t0'] : undefined,
        divide: this.chance(0.05) ? { what: 'damage', total: 2 } : undefined, groupLimit: this.chance(0.05) ? { stat: 'power', cmp: { op: '<=', value: 5 } } : undefined,
      });
      this.targets.push(id);
    }
    const steps = Array.from({ length: 1 + this.int(3) }, () => this.step(depth));
    // every declared spec is used (CR 601.2c: a spec no step names is refused by the renderer)
    const text = JSON.stringify(steps);
    for (const t of targets) if (!text.includes(`"id":"${t.id}"`)) steps.push({ op: 'tap', what: { ref: 'target', id: t.id } });
    const program: EffectProgram = { targets, steps };
    if (this.chance(0.1) && depth > 0) {
      program.modes = { min: 1, max: this.pick([1, 2, 'any'] as const), options: [{ text: '', program: { targets: [], steps: [this.step(0)] } }, { text: '', program: { targets: [], steps: [this.step(0)] } }], allowRepeat: this.chance(0.2) };
    }
    return program;
  }

  ability(): AbilityDef {
    this.roles = null;
    this.targets = [];
    this.names = ['c', 'm', 'r', 's'];
    const k = this.int(9);
    switch (k) {
      case 0: return { kind: 'spell', text: '', effect: this.program(2) };
      case 1: return { kind: 'activated', text: '', cost: this.cost(), effect: this.program(2), isMana: this.chance(0.2), isLoyalty: this.chance(0.2), sorcerySpeed: this.chance(0.2), limit: this.chance(0.2) ? { per: 'turn', max: 1 } : undefined, onlyIf: this.chance(0.2) ? this.condition(1) : undefined };
      case 2: {
        const on = Array.from({ length: 1 + this.int(2) }, () => this.event(1));
        this.roles = eventRoles(on);
        return { kind: 'triggered', text: '', trigger: { on, batch: this.chance(0.2) }, interveningIf: this.chance(0.2) ? this.condition(1) : undefined, effect: this.program(2), limit: this.chance(0.1) ? { per: 'turn', max: 1 } : undefined };
      }
      case 3: return { kind: 'static', text: '', effects: Array.from({ length: 1 + this.int(2) }, () => this.staticEffect(1)), condition: this.chance(0.2) ? this.condition(1) : undefined };
      case 4: return { kind: 'keyword', text: '', keyword: this.pick([...KEYWORDS, 'kicker', 'protection', 'landwalk', 'enchant', 'ward']), cost: this.chance(0.3) ? this.cost() : undefined, amount: this.chance(0.2) ? 2 : undefined, quality: this.chance(0.2) ? 'color:R' : undefined, filter: this.chance(0.2) ? this.filter(0) : undefined };
      case 5: return { kind: 'chapter', text: '', chapters: [1, 2], effect: this.program(1) };
      case 6: return { kind: 'classLevel', text: '', level: 2, cost: this.chance(0.5) ? this.cost() : undefined, abilities: [{ kind: 'keyword', text: '', keyword: 'flying' }] };
      case 7: return { kind: 'levelBracket', text: '', min: 1, max: this.chance(0.5) ? 4 : null, power: '2', toughness: '2', abilities: [{ kind: 'keyword', text: '', keyword: 'haste' }] };
      default: return { kind: 'manual', text: 'Some text.', reason: 'test', shape: 'unknown' };
    }
  }
}
