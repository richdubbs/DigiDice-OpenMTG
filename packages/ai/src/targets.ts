/**
 * Choosing targets (CR 115, 601.2c) and estimating them before casting. One scorer serves both: the priority planner asks "what is the best use of this spell
 * right now?" over the targets it can see, and the `chooseTargets` answer picks among the targets the engine offers. Harmful effects go to the opponent's most
 * valuable things, helpful ones to the bot's own.
 */
import { canBeTargeted, type ObjectFilter, type ObjectId, type PlayerId, type TargetChoice, type TargetSpec, type NumberCmp } from '@openmtg/engine';
import { battlefield, controller, hand, isType, kw, LETHAL, lethalDamage, life, multi, pt, canTapToAttack, safeToDraw, type Ctx } from './context';
import { fighter, fightGain } from './fight';
import type { Polarity, TargetUse, UseKind } from './intent';
import { chosenTargets, incomingDamage, stackSummary } from './source';
import { cardValue, value } from './value';

/** What a target is wanted for: a use from the ability model, or an Aura's effect on what it enchants. */
export interface Want {
  polarity: Polarity;
  kind: UseKind;
  amount: number;
  power: number;
  spec?: TargetSpec;
  /** What a target player sacrifices (TargetUse.filter). */
  filter?: ObjectFilter;
}

export const wantOf = (u: TargetUse): Want => ({ polarity: u.polarity, kind: u.kind, amount: u.amount, power: u.power, spec: u.spec, ...(u.filter ? { filter: u.filter } : {}) });

export interface Pool { objects: ObjectId[]; players: PlayerId[] }

/** How good it is to aim `want` at an object. Positive = good for the bot. */
export function objectScore(ctx: Ctx, want: Want, id: ObjectId): number {
  const o = ctx.view.objects[id];
  if (!o) return -1;
  const mine = controller(ctx, id) === ctx.me;
  if (o.zone === 'stack') {
    const v = stackThreat(ctx, id);
    return mine ? -v : (want.polarity === 'harm' ? v : -v);
  }
  if (o.zone !== 'battlefield') {
    // A card in a graveyard (or exile): getting one of the bot's own back is good; hurting an opponent's graveyard is worth a little.
    const c = ctx.chars(id);
    const v = c ? cardValue(c) : 1;
    if (want.polarity === 'help') return o.owner === ctx.me ? v : -v;
    return o.owner === ctx.me ? -0.5 : 0.5;
  }
  const v = value(ctx, id);
  if (want.polarity === 'harm') {
    const effect = harmEffect(ctx, want, id, v);
    return mine ? -Math.max(0.2, effect) : effect;
  }
  const gain = helpEffect(ctx, want, id, v);
  return mine ? gain : -Math.max(0.5, gain);
}

/**
 * How much a spell or ability on the stack matters (what countering it is worth, CR 701.6): a permanent spell by what it would be on the battlefield and its
 * cost; anything else by the bot's things it targets and the damage it aims at the bot. Damage or life loss that would bring the bot to 0 life loses the
 * game (CR 104.3b, 704.5a): that is a lethal threat, worth any counterspell.
 */
export function stackThreat(ctx: Ctx, id: ObjectId): number {
  const o = ctx.view.objects[id];
  const c = ctx.chars(id);
  if (!o?.stack || !c) return 2;
  if (o.stack.kind === 'spell' && c.types.some((t) => t !== 'Instant' && t !== 'Sorcery' && t !== 'Kindred')) return cardValue(c) + c.manaValue * 1.5;
  let v = 1.5 + c.manaValue;
  const s = stackSummary(ctx, id);
  for (const ts of o.stack.targets) {
    for (const t of ts) {
      if (t.kind === 'object' && controller(ctx, t.id) === ctx.me && ctx.view.objects[t.id]?.zone === 'battlefield') v += value(ctx, t.id);
    }
  }
  // Damage and life loss aimed at the bot, and "each opponent" damage from an opponent's object.
  let toMe = controller(ctx, id) !== ctx.me ? s.oppDamage : 0;
  for (const u of s.uses) {
    if (u.kind !== 'damage' && u.kind !== 'loseLife') continue;
    if (chosenTargets(ctx, id, u.spec.id).some((t) => t.kind === 'player' && t.id === ctx.me)) toMe += u.amount;
  }
  if (toMe > 0 && toMe >= life(ctx, ctx.me) && controller(ctx, id) !== ctx.me) return LETHAL;
  return v + toMe + s.draws * 2 + s.tokens * 2 + (s.sweepDamage === Infinity ? 20 : 0);
}

/** What hurting this permanent achieves (its value if it is gone, less if it only gets weaker). */
function harmEffect(ctx: Ctx, want: Want, id: ObjectId, v: number): number {
  const indestructible = kw(ctx, id, 'indestructible');
  const creature = isType(ctx, id, 'Creature');
  switch (want.kind) {
    case 'damage': {
      if (isType(ctx, id, 'Planeswalker') && !creature) {
        const loyalty = ctx.view.objects[id]?.counters['loyalty'] ?? 0;
        return want.amount >= loyalty ? v + 1 : v * (want.amount / Math.max(1, loyalty)) * 0.7;
      }
      if (!creature) return 0.1;
      if (!indestructible && want.amount >= lethalDamage(ctx, id)) return v + 0.5;
      return 0.2;
    }
    case 'debuff': return creature && !indestructible && -want.amount >= lethalDamage(ctx, id) ? v + 0.5 : v * 0.25;
    case 'destroy': case 'sacrifice': return indestructible ? 0.1 : v;
    case 'exile': case 'steal': return v * (want.kind === 'steal' ? 1.4 : 1.05);
    case 'bounce': return ctx.view.objects[id]?.kind === 'token' ? v : v * 0.45;
    case 'restrict': return creature ? v * 0.8 : v * 0.3;
    case 'tap': return creature && !ctx.view.objects[id]?.tapped ? v * 0.3 : 0.05;
    case 'counters': return creature && want.amount >= lethalDamage(ctx, id) ? v : v * 0.3;
    case 'fight': return creature ? v * 0.6 : 0.1;
    default: return v * 0.5;
  }
}

/** What helping this permanent achieves: a pump matters in combat, an Aura or Equipment on a creature that can attack. */
function helpEffect(ctx: Ctx, want: Want, id: ObjectId, v: number): number {
  if (!isType(ctx, id, 'Creature')) {
    if (want.kind === 'untap') return ctx.view.objects[id]?.tapped ? 1 : 0.1;
    return 0.2;
  }
  switch (want.kind) {
    case 'pump': case 'counters': case 'grant': return pumpGain(ctx, id, { power: want.power, toughness: want.amount }) + (want.kind === 'counters' ? 1 : 0);
    case 'attach': return 1 + v * 0.3 + (canTapToAttack(ctx, id) ? 1 : 0) + pt(ctx, id).power * 0.2;
    case 'untap': return ctx.view.objects[id]?.tapped ? 1 : 0.1;
    default: return 0.5 + v * 0.1;
  }
}

/** The gain of a temporary pump on a creature: in combat, what it changes in the fight; otherwise little (an Aura or counters last: some value). */
export function pumpGain(ctx: Ctx, id: ObjectId, boost: { power: number; toughness: number }): number {
  const combat = ctx.view.combat;
  const a = combat?.attackers.find((x) => x.id === id);
  if (a && a.blocked) {
    const blockers = a.blockedBy.map((b) => fighter(ctx, b));
    return fightGain(fighter(ctx, id, boost), blockers) - fightGain(fighter(ctx, id), blockers);
  }
  if (a && !a.blocked && ctx.view.turn.step === 'declareBlockers' && a.defendingPlayer !== ctx.me) {
    const unblocked = combat!.attackers.filter((x) => !x.blocked && x.defendingPlayer !== ctx.me).reduce((n, x) => n + pt(ctx, x.id).power, 0);
    return unblocked < life(ctx, a.defendingPlayer) && unblocked + boost.power >= life(ctx, a.defendingPlayer) ? 50 : boost.power * 0.3;
  }
  const b = combat?.blockers.find((x) => x.id === id);
  if (b) {
    let gain = 0;
    for (const att of b.blocking) {
      const others = (combat!.attackers.find((x) => x.id === att)?.blockedBy ?? [b.id]).map((x) => fighter(ctx, x, x === id ? boost : { power: 0, toughness: 0 }));
      const base = (combat!.attackers.find((x) => x.id === att)?.blockedBy ?? [b.id]).map((x) => fighter(ctx, x));
      gain += fightGain(fighter(ctx, att), base) - fightGain(fighter(ctx, att), others);
    }
    return gain;
  }
  // Saving a creature from damage on the stack: the pump makes it survive.
  const threat = incomingDamage(ctx, id);
  if (threat > 0 && threat >= lethalDamage(ctx, id) && threat < lethalDamage(ctx, id) + boost.toughness) return value(ctx, id);
  return 0.1;
}

export function playerScore(ctx: Ctx, want: Want, p: PlayerId): number {
  const opp = p !== ctx.me;
  if (want.polarity === 'help') {
    if (opp) return -1;
    if (want.kind !== 'draw') return 1;
    if (want.amount <= 0) return 0; // X = 0: nothing to gain
    return safeToDraw(ctx, want.amount) ? 2 : -2 * want.amount; // never deck itself (CR 121.4, 704.5b)
  }
  if (!opp) return -Math.max(1, want.amount);
  // M12-6 (m12 design 7): with several opponents, harm goes to an opponent it kills (LETHAL), else to the focus first (a tie-break above the others)
  if (multi(ctx)) {
    const s = harmToPlayer(ctx, want, p);
    return s > 0 && s < LETHAL && p === ctx.opp ? s + 0.05 : s;
  }
  return harmToPlayer(ctx, want, p);
}

/** How much a harmful effect aimed at the opponent `p` achieves. */
function harmToPlayer(ctx: Ctx, want: Want, p: PlayerId): number {
  if (want.kind === 'damage' || want.kind === 'loseLife') return want.amount >= life(ctx, p) ? LETHAL : want.amount * 0.6;
  if (want.kind === 'mill') return 0.3;
  if (want.kind === 'discard') return hand(ctx, p).length === 0 ? 0 : 1.5; // an empty hand discards nothing (CR 701.9a)
  if (want.kind === 'sacrifice') {
    // The player sacrifices the permanent they value least among those that match (CR 701.21a); with none, nothing happens.
    const can = battlefield(ctx, p).filter((id) => matches(ctx, id, want.filter));
    return can.length === 0 ? 0 : Math.min(...can.map((id) => value(ctx, id)));
  }
  return 1;
}

export interface Pick { targets: TargetChoice[]; score: number }

/** Choose between min and max targets from the pool: every target worth aiming at, best first, at least `min`. */
export function chooseFrom(ctx: Ctx, want: Want, pool: Pool, min: number, max: number): Pick {
  const scored: { t: TargetChoice; s: number }[] = [
    ...pool.objects.map((id) => ({ t: { kind: 'object' as const, id }, s: objectScore(ctx, want, id) })),
    ...pool.players.map((id) => ({ t: { kind: 'player' as const, id }, s: playerScore(ctx, want, id) })),
  ].sort((a, b) => b.s - a.s);
  // Damage with no fixed number of targets ("any number of targets", divided evenly) is best kept on one target.
  const cap = want.kind === 'damage' && max > 1 && want.spec?.divide === undefined ? Math.max(min, 1) : max;
  const good = scored.filter((x) => x.s > 0).length;
  const n = Math.min(scored.length, Math.max(min, Math.min(cap, good)));
  const chosen = scored.slice(0, n);
  return { targets: chosen.map((x) => x.t), score: chosen.reduce((a, x) => a + x.s, 0) };
}

// ---- estimating the candidates before casting -----------------------------------------------------------------------------------

/** The targets the bot can see for a spec (CR 115.1): a rough filter match plus hexproof, shroud and protection (CR 702.11, 702.18, 702.16). */
export function estimatePool(ctx: Ctx, spec: TargetSpec, sourceId: ObjectId | null): Pool {
  const objects: ObjectId[] = [];
  const players: PlayerId[] = [];
  const src = sourceId ? ctx.chars(sourceId) : null;
  const zone = spec.filter?.zone;
  const zones = zone === undefined ? ['battlefield'] : zone === 'any' ? ['battlefield', 'graveyard', 'exile', 'stack'] : Array.isArray(zone) ? zone : [zone];
  const ids: ObjectId[] = [];
  if (spec.kind === 'spell' || spec.kind === 'stackObject' || spec.kind === 'ability') ids.push(...ctx.view.zones.stack);
  else if (spec.kind !== 'player') { // "target player" names no object (CR 115.1)
    if (zones.includes('battlefield')) ids.push(...ctx.view.zones.battlefield);
    if (zones.includes('graveyard')) for (const p of ctx.view.players) ids.push(...(ctx.view.zones.graveyard[p.id] ?? []));
    if (zones.includes('exile')) ids.push(...ctx.view.zones.exile);
  }
  for (const id of ids) {
    const c = ctx.chars(id);
    const o = ctx.view.objects[id];
    if (!c || !o || o.phasedOut) continue;
    if (spec.kind === 'spell' && o.stack?.kind !== 'spell') continue;
    if (spec.kind === 'ability' && o.stack?.kind === 'spell') continue;
    if (spec.kind === 'anyTarget' && !c.types.some((t) => t === 'Creature' || t === 'Planeswalker' || t === 'Battle')) continue;
    if (spec.kind === 'objectOrPlayer' && !matches(ctx, id, spec.filter)) continue;
    if ((spec.kind === 'object' || spec.kind === 'spell') && !matches(ctx, id, spec.filter)) continue;
    if (o.zone === 'battlefield' && !canBeTargeted(c, c.controller, src, ctx.me)) continue;
    if (sourceId !== null && id === sourceId) continue;
    objects.push(id);
  }
  if (spec.kind === 'player' || spec.kind === 'anyTarget' || spec.kind === 'objectOrPlayer') {
    const who = spec.players?.who ?? 'any';
    for (const p of ctx.view.players) {
      if (p.hasLost) continue;
      if (who === 'you' && p.id !== ctx.me) continue;
      if (who === 'opponent' && p.id === ctx.me) continue;
      players.push(p.id);
    }
  }
  return { objects, players };
}

const cmp = (n: number, c: NumberCmp | undefined): boolean => {
  if (!c || typeof c.value !== 'number') return true;
  const v = c.value;
  switch (c.op) {
    case '<=': return n <= v; case '>=': return n >= v; case '==': return n === v; case '!=': return n !== v; case '<': return n < v; case '>': return n > v;
  }
  return true;
};

const anyOf = (have: readonly string[], want: readonly string[] | undefined): boolean => !want || want.some((w) => have.includes(w));

/** A conservative-optimistic filter match: the fields the bot can read are checked, any other field is assumed to match (the engine decides for real). */
export function matches(ctx: Ctx, id: ObjectId, f: ObjectFilter | undefined): boolean {
  if (!f) return true;
  const c = ctx.chars(id);
  const o = ctx.view.objects[id];
  if (!c || !o) return false;
  if (f.anyOf && !f.anyOf.some((g) => matches(ctx, id, g))) return false;
  if (f.not && matches(ctx, id, f.not)) return false;
  const ctl = c.controller || o.controller;
  if (f.controller === 'you' && ctl !== ctx.me) return false;
  if (f.controller === 'opponent' && ctl === ctx.me) return false;
  if (f.owner === 'you' && o.owner !== ctx.me) return false;
  if (f.owner === 'opponent' && o.owner === ctx.me) return false;
  if (!anyOf(c.types, f.types)) return false;
  if (f.allTypes && !f.allTypes.every((t) => c.types.includes(t as never))) return false;
  if (f.notTypes && f.notTypes.some((t) => c.types.includes(t as never))) return false;
  if (!anyOf(c.subtypes.map((s) => s.toLowerCase()), f.subtypes?.map((s) => s.toLowerCase()))) return false;
  if (!anyOf(c.colors, f.colors)) return false;
  if (f.notColors && f.notColors.some((x) => c.colors.includes(x))) return false;
  if (f.colorless === true && c.colors.length > 0) return false;
  if (!cmp(c.manaValue, f.manaValue)) return false;
  const p = pt(ctx, id);
  if (!cmp(p.power, f.power) || !cmp(p.toughness, f.toughness)) return false;
  const kws = c.keywords.map((k) => k.keyword);
  if (f.keyword && !anyOf(kws, Array.isArray(f.keyword) ? f.keyword : [f.keyword])) return false;
  if (f.notKeyword && (Array.isArray(f.notKeyword) ? f.notKeyword : [f.notKeyword]).some((k) => kws.includes(k))) return false;
  if (f.tapped !== undefined && o.tapped !== f.tapped) return false;
  if (f.token !== undefined && (o.kind === 'token') !== f.token) return false;
  if (f.attacking === true && !ctx.view.combat?.attackers.some((a) => a.id === id)) return false;
  if (f.blocking === true && !ctx.view.combat?.blockers.some((b) => b.id === id)) return false;
  return true;
}
