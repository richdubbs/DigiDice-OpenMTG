/**
 * A small combat simulator (CR 510): who dies when one attacker meets its blockers, with first strike and double strike (CR 702.7, 702.4), deathtouch
 * (CR 702.2), trample (CR 702.19), indestructible (CR 702.12) and damage already marked. An estimate for planning only; the engine does the real thing.
 */
import type { ObjectId } from '@openmtg/engine';
import { kw, pt, type Ctx } from './context';
import { qty } from './intent';
import { value } from './value';

export interface Fighter {
  id: ObjectId;
  power: number;
  toughness: number;
  damage: number;
  first: boolean;
  double: boolean;
  deathtouch: boolean;
  trample: boolean;
  indestructible: boolean;
  lifelink: boolean;
  /** Damage to a player is poison counters instead of life loss (CR 702.90b). Against creatures it is -1/-1 counters, as lethal as damage (CR 702.90c). */
  infect: boolean;
  /** Total toxic value: poison counters on top of the damage to a player (CR 702.164c). */
  toxic: number;
  value: number;
}

/** What one creature's combat damage to a player does: life lost and poison counters (CR 120.3a-b, 702.90b, 702.164c). */
export function toPlayer(f: Fighter, damage: number): { life: number; poison: number } {
  if (damage <= 0) return { life: 0, poison: 0 };
  const hits = f.double ? 2 : 1;
  return { life: f.infect ? 0 : damage, poison: (f.infect ? damage : 0) + f.toxic * hits };
}

export function fighter(ctx: Ctx, id: ObjectId, boost: { power: number; toughness: number } = { power: 0, toughness: 0 }): Fighter {
  const { power, toughness } = pt(ctx, id);
  return {
    id, power: Math.max(0, power + boost.power), toughness: toughness + boost.toughness, damage: ctx.view.objects[id]?.damage ?? 0,
    first: kw(ctx, id, 'first strike'), double: kw(ctx, id, 'double strike'), deathtouch: kw(ctx, id, 'deathtouch'), trample: kw(ctx, id, 'trample'),
    indestructible: kw(ctx, id, 'indestructible'), lifelink: kw(ctx, id, 'lifelink'), infect: kw(ctx, id, 'infect'), toxic: toxicValue(ctx, id),
    value: value(ctx, id),
  };
}

/** The sum of a creature's toxic N values (CR 702.164b). */
function toxicValue(ctx: Ctx, id: ObjectId): number {
  return (ctx.chars(id)?.keywords ?? []).reduce((n, k) => n + (k.keyword === 'toxic' ? qty(k.amount) : 0), 0);
}

/** Damage that destroys `f` (CR 704.5g, 704.5h): its remaining toughness, or 1 from a deathtouch source. */
const lethalFrom = (f: Fighter, src: Fighter): number => (src.deathtouch ? 1 : Math.max(1, f.toughness - f.damage));

export interface Outcome {
  attackerDies: boolean;
  /** Blockers the attacker destroys. */
  killed: ObjectId[];
  /** Damage that goes through to the player (trample) or, unblocked, the attacker's whole damage. */
  through: number;
}

/**
 * One attacker against its blockers. The attacker divides its damage to destroy the most valuable blockers first (CR 510.1c), trampling over what is left
 * (CR 702.19b); the blockers all hit the attacker.
 */
export function fight(att: Fighter, blockers: readonly Fighter[]): Outcome {
  if (blockers.length === 0) return { attackerDies: false, killed: [], through: att.power * (att.double ? 2 : 1) };
  const alive = new Set(blockers.map((b) => b.id));
  const marked = new Map<ObjectId, number>(blockers.map((b) => [b.id, 0]));
  let attDamage = 0;
  let attDead = false;
  let through = 0;
  const attackerHits = (): void => {
    let left = att.power;
    const order = [...blockers].filter((b) => alive.has(b.id)).sort((a, b) => b.value - a.value);
    for (const b of order) {
      const need = Math.max(0, lethalFrom(b, att) - marked.get(b.id)!);
      if (need <= left) { marked.set(b.id, marked.get(b.id)! + need); left -= need; }
    }
    if (att.trample) through += left;
    else if (order.length > 0) marked.set(order[0]!.id, marked.get(order[0]!.id)! + left);
  };
  const blockersHit = (strikers: readonly Fighter[]): void => {
    for (const b of strikers) {
      if (!alive.has(b.id)) continue;
      attDamage += b.power;
      if (b.deathtouch && b.power > 0) attDead = true;
    }
  };
  const settle = (): void => {
    for (const b of blockers) if (alive.has(b.id) && !b.indestructible && marked.get(b.id)! >= lethalFrom(b, att)) alive.delete(b.id);
    attDead = !att.indestructible && (attDead || attDamage >= att.toughness - att.damage);
  };
  const hasFirstStep = att.first || att.double || blockers.some((b) => b.first || b.double);
  if (hasFirstStep) {
    if (att.first || att.double) attackerHits();
    blockersHit(blockers.filter((b) => b.first || b.double));
    settle();
    if (!attDead && !att.first) attackerHits();
    if (!attDead) blockersHit(blockers.filter((b) => !b.first));
    settle();
  } else {
    attackerHits();
    blockersHit(blockers);
    settle();
  }
  return { attackerDies: attDead, killed: blockers.filter((b) => !alive.has(b.id)).map((b) => b.id), through };
}

/** Net value of one attacker meeting these blockers, from the attacker's side: blockers killed minus the attacker if it dies. */
export function fightGain(att: Fighter, blockers: readonly Fighter[]): number {
  const o = fight(att, blockers);
  const killed = blockers.filter((b) => o.killed.includes(b.id)).reduce((n, b) => n + b.value, 0);
  return killed - (o.attackerDies ? att.value : 0);
}
