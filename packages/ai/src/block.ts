/**
 * Declaring blockers (CR 509.1). In order: blocks that kill the attacker and survive, blocks that survive, fair trades, two blockers on one big attacker, and
 * chump blocks only while the unblocked damage would be lethal (life or poison). Only the pairs the decision offers are used, an attacker with menace gets two blockers
 * or none (CR 702.111b), an attacker that can't be blocked except by N or more creatures gets N or none (`minBlockers`, FAST5 T57, CR 509.1b), and an attacker
 * that can't be blocked by more than N creatures gets at most N (`maxBlockers`, MX5, CR 509.1b).
 */
import type { DeclareBlockersDecision, ObjectId } from '@openmtg/engine';
import { life, poison, type Ctx } from './context';
import { fight, fighter, toPlayer, type Fighter } from './fight';

export function chooseBlocks(ctx: Ctx, d: DeclareBlockersDecision): { blocker: ObjectId; attacker: ObjectId }[] {
  const combat = ctx.view.combat;
  const attackers = (combat?.attackers ?? []).filter((a) => a.defendingPlayer === ctx.me).map((a) => ({ id: a.id, toMe: a.defender === ctx.me, f: fighter(ctx, a.id) }));
  const may = new Map(d.candidates.map((c) => [c.id, new Set(c.attackers)]));
  const bf = new Map(d.candidates.map((c) => [c.id, fighter(ctx, c.id)]));
  const free = new Set(d.candidates.map((c) => c.id));
  const assigned = new Map<ObjectId, ObjectId[]>();
  const multi = new Set(d.needsMultiple);
  const cap = new Map((d.maxBlockers ?? []).map((x) => [x.attacker, x.max])); // CR 509.1b: "can't be blocked by more than one creature"
  const floor = new Map((d.minBlockers ?? []).map((x) => [x.attacker, x.min])); // FAST5 T57, CR 509.1b: "can't be blocked except by three or more creatures"
  const least = (a: ObjectId): number => Math.max(multi.has(a) ? 2 : 1, floor.get(a) ?? 1);
  const most = (a: ObjectId): number => cap.get(a) ?? Infinity;
  const myLife = life(ctx, ctx.me);
  const slack = myLife <= 8 ? 1.5 : 0;

  const assign = (a: ObjectId, bs: ObjectId[]): void => {
    for (const b of bs) free.delete(b);
    assigned.set(a, [...(assigned.get(a) ?? []), ...bs]);
  };
  const options = (a: ObjectId): Fighter[] => [...free].filter((b) => may.get(b)?.has(a)).map((b) => bf.get(b)!).sort((x, y) => x.value - y.value);
  const open = (): typeof attackers => attackers.filter((a) => !assigned.has(a.id));
  const byValue = [...attackers].sort((x, y) => y.f.value - x.f.value);

  // 1. Kill the attacker and survive; 2. survive; 3. a fair trade.
  for (const a of byValue) {
    if (multi.has(a.id)) continue;
    const opts = options(a.id);
    const kill = opts.find((b) => { const o = fight(a.f, [b]); return o.attackerDies && !o.killed.includes(b.id); });
    if (kill) { assign(a.id, [kill.id]); continue; }
  }
  for (const a of [...open()].sort((x, y) => y.f.power - x.f.power)) {
    if (multi.has(a.id) || a.f.power <= 0) continue;
    const wall = options(a.id).find((b) => { const o = fight(a.f, [b]); return !o.killed.includes(b.id); });
    if (wall) assign(a.id, [wall.id]);
  }
  for (const a of open().sort((x, y) => y.f.value - x.f.value)) {
    if (multi.has(a.id)) continue;
    const trade = options(a.id).find((b) => { const o = fight(a.f, [b]); return o.attackerDies && b.value <= a.f.value + slack; });
    if (trade) assign(a.id, [trade.id]);
  }
  // 4. Two blockers on one attacker worth more than what it can kill (menace attackers need exactly this).
  for (const a of open().sort((x, y) => y.f.value - x.f.value)) {
    if (most(a.id) < 2 || least(a.id) > 2) continue; // (an attacker that needs three or more blockers is a chump-block question only, below)
    const opts = options(a.id);
    let best: { pair: Fighter[]; gain: number } | null = null;
    for (let i = 0; i < opts.length; i++) {
      for (let j = i + 1; j < opts.length; j++) {
        const pair = [opts[i]!, opts[j]!];
        const o = fight(a.f, pair);
        if (!o.attackerDies) continue;
        const lost = pair.filter((b) => o.killed.includes(b.id)).reduce((n, b) => n + b.value, 0);
        const gain = a.f.value - lost;
        if (gain > 0 && (!best || gain > best.gain)) best = { pair, gain };
      }
    }
    if (best) assign(a.id, best.pair.map((b) => b.id));
  }
  // 5. Chump blocks while what gets through would be lethal: life to 0 (CR 104.3b, 704.5a) or ten poison counters (infect, toxic: CR 704.5c).
  const poisonLeft = 10 - poison(ctx, ctx.me);
  const through = (): { life: number; poison: number } => attackers.reduce((n, a) => {
    if (!a.toMe) return n;
    const bs = assigned.get(a.id);
    const dmg = bs ? fight(a.f, bs.map((b) => bf.get(b)!)).through : a.f.power * (a.f.double ? 2 : 1);
    const hit = toPlayer(a.f, dmg);
    return { life: n.life + hit.life, poison: n.poison + hit.poison };
  }, { life: 0, poison: 0 });
  const lethal = (): boolean => { const t = through(); return t.life >= myLife || t.poison >= poisonLeft; };
  const threat = (f: Fighter): number => { const t = toPlayer(f, f.power * (f.double ? 2 : 1)); return t.life / Math.max(1, myLife) + t.poison / Math.max(1, poisonLeft); };
  for (const a of open().filter((x) => x.toMe).sort((x, y) => threat(y.f) - threat(x.f))) {
    if (!lethal()) break;
    const opts = options(a.id);
    const need = least(a.id);
    if (opts.length < need || need > most(a.id)) continue;
    assign(a.id, opts.slice(0, need).map((b) => b.id));
  }
  const out: { blocker: ObjectId; attacker: ObjectId }[] = [];
  for (const [a, bs] of assigned) {
    if (bs.length < least(a)) continue; // never answer a declaration the engine rejects (menace: two, `minBlockers`: more)
    if (bs.length > most(a)) continue; // never answer a declaration the engine rejects (it is not cancellable)
    for (const b of bs) out.push({ blocker: b, attacker: a });
  }
  // "Can't block alone" (CR 506.5, 509.1b): the only blocker would be refused, so no blocks at all
  const blockers = new Set(out.map((x) => x.blocker));
  if (blockers.size === 1 && d.candidates.some((c) => blockers.has(c.id) && c.onlyWithOthers === true)) return [];
  return out;
}
