/**
 * Dealing damage (CR 120): the single function every source of damage goes through, combat or not.
 *
 * The four-part sequence of CR 120.4 is: (a) excess-damage modifications, (b) replacement and prevention effects, (c) processing damage
 * into its results, (d) the damage event. Milestone 6 hooks (a) and (b) in before the results below; today only protection prevents
 * damage (CR 702.16e). The source's characteristics are read from last known information when it has left the game's zones
 * (CR 702.2e, 702.15c, 702.80b, 702.90d), and an ability on the stack deals damage as its source (CR 113.7a, 609.7).
 */
import type { ObjectId, PlayerId } from '../types/ids';
import { EngineBug, type Game } from '../core/game';
import { charsOfObject, hasKeyword, ptNumbers, type Chars } from './characteristics';
import { addCounters } from './counters';
import { gainLife, givePoison, loseLife } from './life';
import { hasProtectionFrom } from './protection';

export interface DamageSource {
  id: ObjectId;
  name: string;
  chars: Chars;
  controller: PlayerId;
}

/** Who is dealing the damage, with characteristics as they were (last known information if the source is gone). */
export function damageSource(g: Game, sourceId: ObjectId): DamageSource | null {
  const o = g.maybeObj(sourceId) ?? g.s.lki[sourceId]?.object;
  if (!o) return null;
  if (o.kind === 'ability' && o.stack?.sourceId && o.stack.sourceId !== sourceId) return damageSource(g, o.stack.sourceId);
  const chars = charsOfObject(g.s, o);
  return { id: o.id, name: chars.name || g.nameOf(sourceId), chars, controller: o.controller };
}

/** Life that lifelink sources gain from one damage event, summed per source (CR 702.15e). */
export type LifelinkLedger = Map<ObjectId, { controller: PlayerId; name: string; amount: number }>;

export interface DamageOptions {
  /** Combat damage (CR 120.2a): toxic applies (CR 120.3g). */
  combat?: boolean;
  /** Damage dealt together in one event (all the combat damage of a step): lifelink gains are collected here and settled once per source by `settleLifelink`. */
  lifelink?: LifelinkLedger;
  /** "Can't be prevented" (CR 615.12): no prevention effect applies, protection's included (CR 702.16e). WP11 interface change. */
  unpreventable?: boolean;
  /** The damage has been through the proposal pipeline already: deal it as it is (WP11 interface change, see `installDamageFunnel`). */
  proposed?: boolean;
}

/**
 * WP11 INTERFACE CHANGE (design 8.5, CR 120.4b): the proposal pipeline (effects/propose.ts) applies replacement and prevention effects (prevention shields,
 * "prevent all combat damage", a permanent's own "prevent all damage that would be dealt to it") to EVERY damage event with a source, combat or not, before it
 * is processed here. effects/funnels.ts installs the funnel when it loads; the funnel calls back with `proposed: true`. Damage with a source and no funnel
 * installed is an EngineBug (never dealt without its prevention effects).
 */
export type DamageFunnel = (g: Game, sourceId: ObjectId, target: ObjectId | PlayerId, amount: number, opts: DamageOptions) => number;
let damageFunnel: DamageFunnel | null = null;
export function installDamageFunnel(f: DamageFunnel | null): void {
  damageFunnel = f;
}

/**
 * Cloud r3-repl INTERFACE CHANGE (CR 120.3a, 614.1a): the life loss that damage dealt to a player causes is an event of its own, so an effect that modifies life
 * loss ("If an opponent would lose life during your turn, they lose twice that much life instead.") applies to it; the damage dealt (what lifelink gains,
 * CR 702.15b, and what "that much damage" counts) is unchanged. effects/funnels.ts installs the funnel (a `life` loss proposal); returns the life lost.
 * Without it the loss is taken directly, as before (a game state always loads the funnels, see `installDamageFunnel`).
 */
export type LifeLossFunnel = (g: Game, player: PlayerId, amount: number, cause: string) => number;
let lifeLossFunnel: LifeLossFunnel | null = null;
export function installLifeLossFunnel(f: LifeLossFunnel | null): void {
  lifeLossFunnel = f;
}

/** One damage event of a simultaneous batch (`dealSimultaneousDamage`). */
export interface DamageItem {
  source: ObjectId;
  target: ObjectId | PlayerId;
  amount: number;
  opts?: DamageOptions;
}

/**
 * WP11 INTERFACE CHANGE (review, CR 510.2, 615.7): damage dealt at the same time (all the combat damage of a step) is proposed together, so a "prevent the next
 * N damage" shield that two sources would use is divided by the player it protects instead of being used up in the order the assignments happen to be listed.
 * effects/funnels.ts installs the funnel. Returns the damage dealt by each item.
 */
export type SimultaneousDamageFunnel = (g: Game, items: DamageItem[]) => number[];
let simultaneousFunnel: SimultaneousDamageFunnel | null = null;
export function installSimultaneousDamageFunnel(f: SimultaneousDamageFunnel | null): void {
  simultaneousFunnel = f;
}

/** Deal several damage events at the same time (CR 510.2, 120.4b). */
export function dealSimultaneousDamage(g: Game, items: DamageItem[]): number[] {
  if (!simultaneousFunnel) throw new EngineBug('dealSimultaneousDamage: the damage funnel is not installed (effects/funnels.ts was not loaded)');
  return simultaneousFunnel(g, items);
}

/** CR 702.15b, 702.15e: each lifelink source's controller gains life equal to the total damage that source dealt in the event, as one life gain. */
export function settleLifelink(g: Game, ledger: LifelinkLedger): void {
  for (const e of ledger.values()) gainLife(g, e.controller, e.amount, `lifelink from ${e.name}`);
  ledger.clear();
}

const isPlayer = (g: Game, id: string): boolean => g.s.players.some((p) => p.id === id);

/**
 * FAST5X E16, CR 120.4a, 120.10, 702.2c: how much of `amount` damage, about to be dealt to the permanent with characteristics `tc`, is excess damage, read
 * BEFORE the damage is processed into its results. A creature: the damage beyond lethal damage, its toughness minus the damage already marked on it (never
 * below 0: a creature with lethal damage already marked has no room left), and any nonzero damage from a source with deathtouch is lethal (at most 1 is
 * needed). Damage dealt earlier in the same event is marked (or has removed counters) before the next part is processed, so the parts add up to the excess of
 * the whole event ("taking into account damage from other sources that would be dealt at the same time"). A planeswalker: beyond its loyalty; a battle:
 * beyond its defense. Several of those types: the greatest (CR 120.10). Indestructible changes nothing (CR 702.12b is about destruction, not lethal damage).
 * NaN when a creature's toughness is not a number.
 */
function excessOf(o: { damage: number; counters: Record<string, number> }, tc: Chars, amount: number, deathtouch: boolean): number {
  const candidates: number[] = [];
  if (tc.types.includes('Creature')) {
    const t = ptNumbers(tc).toughness;
    if (t === null) return NaN;
    const room = Math.max(0, t - o.damage);
    const lethal = deathtouch ? Math.min(1, room) : room; // CR 120.4a, 702.2c
    candidates.push(Math.max(0, amount - lethal));
  }
  if (tc.types.includes('Planeswalker')) candidates.push(Math.max(0, amount - Math.max(0, o.counters['loyalty'] ?? 0)));
  if (tc.types.includes('Battle')) candidates.push(Math.max(0, amount - Math.max(0, o.counters['defense'] ?? 0)));
  return candidates.length === 0 ? 0 : Math.max(...candidates);
}

/**
 * `source` deals `amount` damage to `target` (a player, creature, planeswalker or battle). Returns the damage actually dealt (0 if it was
 * prevented or the target can't be dealt damage). A source that would deal 0 damage deals none (CR 120.8).
 */
export function dealDamage(g: Game, sourceId: ObjectId | null, target: ObjectId | PlayerId, amount: number, opts: DamageOptions = {}): number {
  if (amount <= 0) return 0; // CR 120.8
  if (!opts.proposed && sourceId) {
    if (!damageFunnel) throw new EngineBug('dealDamage: the damage funnel is not installed (effects/funnels.ts was not loaded)');
    return damageFunnel(g, sourceId, target, amount, opts); // WP11: CR 120.4b, replacement and prevention first
  }
  const src = sourceId ? damageSource(g, sourceId) : null;
  const srcName = src?.name ?? 'Something';
  const combat = opts.combat === true;
  const rules = [combat ? 'CR 120.2a' : 'CR 120.2b'];
  const results: string[] = [];
  let dealt = 0;
  let excess: number | undefined; // FAST5X E16: damage to a permanent only
  let targetName: string;

  if (isPlayer(g, target)) {
    const p = g.player(target);
    if (p.hasLost) return 0;
    targetName = p.name;
    dealt = amount;
    if (src && hasKeyword(src.chars, 'infect')) {
      givePoison(g, target, amount, `infect damage from ${srcName}`); // CR 120.3b
      results.push('poison');
    } else {
      const cause = `damage from ${srcName}`;
      if (lifeLossFunnel) lifeLossFunnel(g, target, amount, cause); // CR 120.3a, 614.1a: the loss is proposed (Cloud r3-repl)
      else loseLife(g, target, amount, cause); // CR 120.3a
    }
    if (combat && src) {
      const toxic = src.chars.keywords.reduce((n, k) => n + (k.keyword === 'toxic' && typeof k.amount === 'number' ? k.amount : 0), 0); // CR 702.164b: total toxic value
      if (toxic > 0) givePoison(g, target, toxic, `toxic ${toxic} from ${srcName}`); // CR 120.3g
    }
  } else {
    const o = g.obj(target);
    if (o.zone !== 'battlefield' || o.phasedOut) return 0; // CR 120.1: only permanents on the battlefield are dealt damage (a phased-out one is treated as though it doesn't exist, CR 702.26b)
    const tc = charsOfObject(g.s, o);
    targetName = tc.name || g.nameOf(target);
    const isCreature = tc.types.includes('Creature');
    const isWalker = tc.types.includes('Planeswalker');
    const isBattle = tc.types.includes('Battle');
    if (!isCreature && !isWalker && !isBattle) return 0; // CR 120.1a
    if (src && opts.unpreventable !== true && hasProtectionFrom(tc, src.chars)) {
      g.log(`${srcName}'s damage to ${targetName} is prevented by protection.`, { rules: ['CR 702.16e'], level: 'info' });
      return 0;
    }
    dealt = amount;
    excess = excessOf(o, tc, amount, src !== null && hasKeyword(src.chars, 'deathtouch')); // FAST5X E16 (CR 120.4a, 120.10): before the results are processed
    if (isCreature) {
      if (src && (hasKeyword(src.chars, 'wither') || hasKeyword(src.chars, 'infect'))) {
        addCounters(g, target, '-1/-1', amount, src.controller); // CR 120.3d; FAST5X E21: the controller of the source puts them (CR 122.6)
        results.push(`${amount} -1/-1 counter${amount === 1 ? '' : 's'}`);
      } else {
        o.damage += amount; // CR 120.3e
      }
      if (src && hasKeyword(src.chars, 'deathtouch')) o.deathtouchDamaged = true; // CR 702.2b, 704.5h
    }
    if (isWalker) {
      const lost = -addCounters(g, target, 'loyalty', -amount); // CR 120.3c
      results.push(`${lost} loyalty removed`);
    }
    if (isBattle) {
      const lost = -addCounters(g, target, 'defense', -amount); // CR 120.3h
      results.push(`${lost} defense removed`);
    }
  }

  if (src && hasKeyword(src.chars, 'lifelink')) { // CR 120.3f, 702.15b
    if (opts.lifelink) {
      const e = opts.lifelink.get(src.id) ?? { controller: src.controller, name: srcName, amount: 0 };
      e.amount += dealt;
      opts.lifelink.set(src.id, e);
    } else gainLife(g, src.controller, dealt, `lifelink from ${srcName}`);
  }
  if (sourceId) g.emit({ type: 'damageDealt', source: sourceId, target, amount: dealt, combat, ...(excess !== undefined ? { excess } : {}) });
  g.log(`${srcName} deals ${dealt} ${combat ? 'combat ' : ''}damage to ${targetName}${results.length ? ` (${results.join(', ')})` : ''}.`, { rules: [...rules, 'CR 120.3'], level: 'action' });
  return dealt;
}
