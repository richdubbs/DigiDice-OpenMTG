/**
 * Declaring attackers (CR 508.1). A creature attacks when no blocker the opponent has can kill it for free, or when the trade is fair; everything attacks when
 * the attack is lethal through the best blocks; and enough creatures stay home that the opponent's next attack is not lethal.
 */
import type { DeclareAttackersDecision, ObjectId, PlayerId } from '@openmtg/engine';
import { commanderDamageLeft, controller, creatures, isType, kw, life, multi, poison, type Ctx } from './context';
import { fight, fighter, toPlayer, type Fighter } from './fight';

/** Could `blocker` block `attacker` as far as the bot can tell (flying needs flying or reach, CR 702.9b, 702.17b)? The engine decides for real. */
export function couldBlock(ctx: Ctx, blocker: ObjectId, attacker: ObjectId): boolean {
  if (kw(ctx, attacker, 'flying') && !kw(ctx, blocker, 'flying') && !kw(ctx, blocker, 'reach')) return false;
  if (kw(ctx, attacker, 'shadow') !== kw(ctx, blocker, 'shadow')) return false;
  if (kw(ctx, attacker, 'horsemanship') && !kw(ctx, blocker, 'horsemanship')) return false;
  return true;
}

const hits = (f: Fighter): number => f.power * (f.double ? 2 : 1);

export function chooseAttacks(ctx: Ctx, d: DeclareAttackersDecision): { attacker: ObjectId; defender: PlayerId | ObjectId }[] {
  if (multi(ctx)) return chooseAttacksMulti(ctx, d); // M12-6: two or more opponents; a two-player game never gets there (m12 design D16)
  const oppLife = life(ctx, ctx.opp);
  const blockers = creatures(ctx, ctx.opp).filter((id) => !ctx.view.objects[id]?.tapped);
  const cands = d.candidates.map((c) => ({ c, f: fighter(ctx, c.id), defender: c.defenders.includes(ctx.opp) ? ctx.opp : c.defenders[0]! }));
  const slack = oppLife <= 6 ? 1.5 : 0;

  const wants = (f: Fighter): boolean => {
    if (f.power <= 0) return false;
    let possible = blockers.filter((b) => couldBlock(ctx, b, f.id));
    if (kw(ctx, f.id, 'menace') && possible.length < 2) possible = []; // CR 702.111b
    for (const b of possible) {
      const bf = fighter(ctx, b);
      const o = fight(f, [bf]);
      if (!o.attackerDies) continue;
      if (!o.killed.includes(b)) return false; // blocked and killed for free
      if (bf.value < f.value - slack) return false; // a bad trade
    }
    return true;
  };

  // Lethal through the best blocks: each potential blocker stops one attacker, the biggest ones (CR 509.1a). Lethal is life to 0 (CR 704.5a) or ten
  // poison counters from infect and toxic (CR 702.90b, 702.164c, 704.5c).
  const unblocked = (pick: (h: { life: number; poison: number }) => number): number => {
    const each = cands.map((x) => pick(toPlayer(x.f, hits(x.f))));
    const total = each.reduce((n, v) => n + v, 0);
    const stopped = cands.map((x, i) => (x.f.trample ? 0 : each[i]!)).sort((a, b) => b - a).slice(0, blockers.length).reduce((n, v) => n + v, 0);
    return total - stopped;
  };
  const alpha = cands.length > 0 && (unblocked((h) => h.life) >= oppLife || unblocked((h) => h.poison) >= 10 - poison(ctx, ctx.opp));

  // M11-3 (m11 design 7): CR 903.10a, 704.6c: a commander whose hit would bring its commander damage to the variant's limit wins if unblocked, so it attacks
  // like a lethal attack would. Only in a variant with that rule (`commanderDamageLeft` is null otherwise: Brawl, Duel Commander, any other game).
  const commanderKill = (x: (typeof cands)[number]): boolean => {
    const left = x.defender === ctx.opp ? commanderDamageLeft(ctx, x.c.id, ctx.opp) : null;
    return left !== null && hits(x.f) > 0 && hits(x.f) >= left;
  };
  let attacking = cands.filter((x) => x.c.mustAttack || alpha || wants(x.f) || commanderKill(x));
  if (!alpha) attacking = keepDefense(ctx, attacking, cands.map((x) => x.c.id));
  // "Can't attack alone" (CR 506.5, 508.1c): the only attacker would be refused, so no attack at all
  if (attacking.length === 1 && attacking[0]!.c.onlyWithOthers === true && !attacking[0]!.c.mustAttack) return [];
  return attacking.map((x) => ({ attacker: x.c.id, defender: x.defender }));
}

/** Keep blockers home while the opponent's creatures could kill the bot on the crack-back (CR 506-510 next turn). */
function keepDefense<T extends { c: { id: ObjectId; mustAttack?: boolean }; f: Fighter }>(ctx: Ctx, attacking: T[], candidates: ObjectId[]): T[] {
  const myLife = life(ctx, ctx.me);
  const poisonLeft = 10 - poison(ctx, ctx.me);
  // Their creatures' hits on the bot (life and poison, CR 120.3a-b), the most dangerous first: each blocker kept home stops one.
  const theirs = creatures(ctx, ctx.opp).map((id) => { const f = fighter(ctx, id); return toPlayer(f, hits(f)); })
    .sort((a, b) => b.life / Math.max(1, myLife) + b.poison / Math.max(1, poisonLeft) - a.life / Math.max(1, myLife) - a.poison / Math.max(1, poisonLeft));
  const out = [...attacking];
  const lethal = (): boolean => {
    const home = creatures(ctx, ctx.me).filter((id) => !ctx.view.objects[id]?.tapped || candidates.includes(id))
      .filter((id) => !out.some((x) => x.c.id === id) || kw(ctx, id, 'vigilance'));
    const rest = theirs.slice(home.length);
    return rest.reduce((n, h) => n + h.life, 0) >= myLife || rest.reduce((n, h) => n + h.poison, 0) >= poisonLeft;
  };
  while (out.length > 0 && lethal()) {
    // Keep home the attacker that blocks best (the toughest one).
    const i = out.reduce((best, x, j) => (!x.c.mustAttack && (best < 0 || x.f.toughness > out[best]!.f.toughness) ? j : best), -1);
    if (i < 0) break;
    out.splice(i, 1);
  }
  return out;
}

// ---- M12-6: several opponents (m12 design 7, A2-A5) ---------------------------------------------------------------------------------------------------

interface MultiCand {
  c: DeclareAttackersDecision['candidates'][number];
  f: Fighter;
  /** The opponents (players) it can attack, the ones a requirement names first (goad, CR 701.15b; `among`, CR 508.1d). */
  players: PlayerId[];
  /** The planeswalkers of opponents it can attack (CR 508.1b, 802.3). */
  walkers: ObjectId[];
}

/**
 * Attacks with two or more opponents still in the game (CR 802: attack multiple players; 506.2, 508.1b: each attacker chooses its own defender):
 *  1. a lethal split: for each opponent, lowest life first, the fewest attackers that finish them through their best blocks (life, CR 704.5a; ten poison,
 *     704.5c), then a commander whose hit brings an opponent's commander damage to the variant's limit (CR 903.10a, 704.6c);
 *  2. the rest group on one opponent: the one most of them can attack without being blocked badly (then the lowest life, then turn order); an attacker
 *     that would be blocked badly there picks its own opponent (the fewest blockers that kill it, then the lowest life);
 *  3. a planeswalker whose loyalty the attacker's damage removes, when its controller has nothing that could block it;
 *  4. enough creatures stay home that the strongest single opponent's attack is not lethal (each opponent attacks on their own turn; the bot's attackers
 *     stay tapped until its next untap step, CR 502.3).
 * A creature with a requirement (goad's "attacks a player other than the goader", CR 701.15b) picks a defender that obeys it; `obeyRequirements` checks
 * the rest. A player who left is never attacked (CR 800.4a; the decision does not offer them, and `opps` skips them).
 */
function chooseAttacksMulti(ctx: Ctx, d: DeclareAttackersDecision): { attacker: ObjectId; defender: PlayerId | ObjectId }[] {
  const reqs = (d.requirements ?? []).filter((r) => r.kind === 'attack' && r.among !== undefined);
  const order = (p: PlayerId): number => ctx.opps.indexOf(p);
  const blockersOf = new Map(ctx.opps.map((p) => [p, creatures(ctx, p).filter((id) => !ctx.view.objects[id]?.tapped)]));
  const cands: MultiCand[] = d.candidates.map((c) => {
    let players = ctx.opps.filter((p) => c.defenders.includes(p));
    const amongs = reqs.filter((r) => r.creature === c.id).map((r) => r.among!);
    if (amongs.length > 0) {
      const all = players.filter((p) => amongs.every((a) => a.includes(p)));
      const some = players.filter((p) => amongs.some((a) => a.includes(p)));
      players = all.length > 0 ? all : some.length > 0 ? some : players;
    }
    const walkers = c.defenders.filter((id) => ctx.view.objects[id] !== undefined && isType(ctx, id, 'Planeswalker') && ctx.opps.includes(controller(ctx, id) ?? ''));
    return { c, f: fighter(ctx, c.id), players, walkers };
  });

  /** Blockers of `p` that could block the attacker (as far as the bot can tell). */
  const possibleBlockers = (f: Fighter, p: PlayerId): ObjectId[] => {
    const possible = (blockersOf.get(p) ?? []).filter((b) => couldBlock(ctx, b, f.id));
    return kw(ctx, f.id, 'menace') && possible.length < 2 ? [] : possible; // CR 702.111b
  };
  /** Blockers of `p` that kill the attacker for free or in a bad trade (the two-player `wants` test, per opponent). */
  const badBlocks = (f: Fighter, p: PlayerId): number => {
    const slack = life(ctx, p) <= 6 ? 1.5 : 0;
    let n = 0;
    for (const b of possibleBlockers(f, p)) {
      const bf = fighter(ctx, b);
      const o = fight(f, [bf]);
      if (o.attackerDies && (!o.killed.includes(b) || bf.value < f.value - slack)) n++;
    }
    return n;
  };
  const wantsVs = (f: Fighter, p: PlayerId): boolean => f.power > 0 && badBlocks(f, p) === 0;

  const assigned = new Map<ObjectId, PlayerId | ObjectId>();
  const lethalSplit = new Set<ObjectId>();
  /** Opponents a lethal split finishes this combat. */
  const doomed = new Set<PlayerId>();
  const open = (): MultiCand[] => cands.filter((x) => !assigned.has(x.c.id));

  // 1. Lethal splits (as the two-player alpha strike, per opponent: each potential blocker stops one attacker, the biggest ones, CR 509.1a).
  const lethalOn = (p: PlayerId, xs: MultiCand[]): boolean => {
    const blockers = blockersOf.get(p)?.length ?? 0;
    const sum = (pick: (h: { life: number; poison: number }) => number): number => {
      const each = xs.map((x) => pick(toPlayer(x.f, hits(x.f))));
      const total = each.reduce((n, v) => n + v, 0);
      const stopped = xs.map((x, i) => (x.f.trample ? 0 : each[i]!)).sort((a, b) => b - a).slice(0, blockers).reduce((n, v) => n + v, 0);
      return total - stopped;
    };
    return xs.length > 0 && (sum((h) => h.life) >= life(ctx, p) || sum((h) => h.poison) >= 10 - poison(ctx, p));
  };
  for (const p of [...ctx.opps].sort((a, b) => life(ctx, a) - life(ctx, b) || order(a) - order(b))) {
    const pool = open().filter((x) => x.players.includes(p) && hits(x.f) > 0).sort((a, b) => hits(b.f) - hits(a.f));
    if (!lethalOn(p, pool)) continue;
    const take: MultiCand[] = [];
    for (const x of pool) {
      take.push(x);
      if (lethalOn(p, take)) break;
    }
    for (const x of take) { assigned.set(x.c.id, p); lethalSplit.add(x.c.id); }
    doomed.add(p);
  }
  for (const x of open()) {
    const kills = x.players.filter((p) => { const left = commanderDamageLeft(ctx, x.c.id, p); return left !== null && hits(x.f) > 0 && hits(x.f) >= left; });
    if (kills.length > 0) { assigned.set(x.c.id, kills[0]!); lethalSplit.add(x.c.id); doomed.add(kills[0]!); }
  }
  // The others attack the opponents a lethal split does not already finish (an attacker that can attack only those still goes there).
  const alive = (ps: PlayerId[]): PlayerId[] => { const a = ps.filter((p) => !doomed.has(p)); return a.length > 0 ? a : ps; };

  // 3 (before 2, so a walker it can finish takes the attacker first). Loyalty left after the attackers already sent at each walker.
  const loyalty = new Map<ObjectId, number>();
  for (const x of open()) {
    if (hits(x.f) <= 0 || x.f.infect) continue;
    const w = x.walkers.find((id) => {
      const left = loyalty.get(id) ?? ctx.view.objects[id]?.counters['loyalty'] ?? 0;
      const ctl = controller(ctx, id);
      return left > 0 && hits(x.f) >= left && ctl !== null && possibleBlockers(x.f, ctl).length === 0;
    });
    if (w === undefined) continue;
    assigned.set(x.c.id, w);
    loyalty.set(w, (loyalty.get(w) ?? ctx.view.objects[w]?.counters['loyalty'] ?? 0) - hits(x.f));
  }

  // 2. Group on one opponent.
  const rest = open();
  const primary = [...alive(ctx.opps)].sort((a, b) => {
    const n = (p: PlayerId): number => rest.filter((x) => x.players.includes(p) && wantsVs(x.f, p)).length;
    return n(b) - n(a) || life(ctx, a) - life(ctx, b) || order(a) - order(b);
  })[0]!;
  for (const x of rest) {
    if (x.players.includes(primary) && wantsVs(x.f, primary)) { assigned.set(x.c.id, primary); continue; }
    const ranked = [...alive(x.players)].sort((a, b) => badBlocks(x.f, a) - badBlocks(x.f, b) || life(ctx, a) - life(ctx, b) || order(a) - order(b));
    const own = ranked.find((p) => wantsVs(x.f, p));
    if (own !== undefined) assigned.set(x.c.id, own);
    else if (x.c.mustAttack) assigned.set(x.c.id, ranked[0] ?? x.c.defenders[0]!); // an attack requirement (CR 508.1d): the least bad defender
  }

  let attacking = cands.filter((x) => assigned.has(x.c.id));
  attacking = keepDefenseMulti(ctx, attacking, cands.map((x) => x.c.id), lethalSplit);
  // "Can't attack alone" (CR 506.5, 508.1c): the only attacker would be refused, so no attack at all
  if (attacking.length === 1 && attacking[0]!.c.onlyWithOthers === true && !attacking[0]!.c.mustAttack) return [];
  return attacking.map((x) => ({ attacker: x.c.id, defender: assigned.get(x.c.id)! }));
}

/**
 * M12-6 (A5): the crack-back reserve against the strongest single opponent: keep blockers home while any one opponent's creatures could kill the bot on
 * their turn (CR 506-510). The attackers of a lethal split stay in the attack longest.
 */
function keepDefenseMulti(ctx: Ctx, attacking: MultiCand[], candidates: ObjectId[], lethalSplit: ReadonlySet<ObjectId>): MultiCand[] {
  const myLife = life(ctx, ctx.me);
  const poisonLeft = 10 - poison(ctx, ctx.me);
  const danger = (h: { life: number; poison: number }): number => h.life / Math.max(1, myLife) + h.poison / Math.max(1, poisonLeft);
  const each = ctx.opps.map((p) => creatures(ctx, p).map((id) => { const f = fighter(ctx, id); return toPlayer(f, hits(f)); }).sort((a, b) => danger(b) - danger(a)));
  const out = [...attacking];
  const lethal = (): boolean => {
    const home = creatures(ctx, ctx.me).filter((id) => !ctx.view.objects[id]?.tapped || candidates.includes(id))
      .filter((id) => !out.some((x) => x.c.id === id) || kw(ctx, id, 'vigilance'));
    return each.some((theirs) => {
      const rest = theirs.slice(home.length);
      return rest.reduce((n, h) => n + h.life, 0) >= myLife || rest.reduce((n, h) => n + h.poison, 0) >= poisonLeft;
    });
  };
  while (out.length > 0 && lethal()) {
    // Keep home the attacker that blocks best (the toughest one), outside a lethal split first.
    let i = -1;
    out.forEach((x, j) => {
      if (x.c.mustAttack) return;
      if (i < 0) { i = j; return; }
      const best = out[i]!;
      const split = (y: MultiCand): number => (lethalSplit.has(y.c.id) ? 1 : 0);
      if (split(x) < split(best) || (split(x) === split(best) && x.f.toughness > best.f.toughness)) i = j;
    });
    if (i < 0) break;
    out.splice(i, 1);
  }
  return out;
}
