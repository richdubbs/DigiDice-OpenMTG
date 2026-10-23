/**
 * Dividing damage: combat damage among blockers or attackers (CR 510.1c-d, trample CR 702.19b) and damage or counters announced on cast (CR 601.2d).
 */
import type { AssignDamageDecision, ChooseDivisionDecision, ObjectId } from '@openmtg/engine';
import { controller, isType, lethalDamage, life, multi, type Ctx } from './context';
import { value } from './value';

/**
 * Destroy the most total value the damage can pay for (each recipient's `lethal` is what the engine counts as lethal, deathtouch included); with trample the
 * rest goes to the attacked player or permanent once every blocker has lethal damage (CR 702.19b), otherwise onto the creatures that are left.
 */
export function assignCombatDamage(ctx: Ctx, d: AssignDamageDecision): { id: string; amount: number }[] {
  const amounts = new Map<string, number>(d.recipients.map((r) => [r.id, 0]));
  const target = d.recipients.find((r) => r.trampleTarget);
  const others = d.recipients.filter((r) => !r.trampleTarget);
  const worth = (id: string): number => (ctx.view.objects[id] ? value(ctx, id) * (controller(ctx, id) === ctx.me ? -1 : 1) : 0);
  let best: { set: number; value: number; cost: number } = { set: 0, value: 0, cost: 0 };
  const n = Math.min(others.length, 12);
  for (let mask = 1; mask < 1 << n; mask++) {
    let cost = 0, v = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { cost += others[i]!.lethal; v += worth(others[i]!.id); }
    if (cost <= d.amount && (v > best.value || (v === best.value && cost < best.cost))) best = { set: mask, value: v, cost };
  }
  let left = d.amount;
  for (let i = 0; i < n; i++) if (best.set & (1 << i)) { amounts.set(others[i]!.id, others[i]!.lethal); left -= others[i]!.lethal; }
  const allLethal = others.every((r) => amounts.get(r.id)! >= r.lethal);
  if (left > 0 && target && d.canTrample && allLethal) { amounts.set(target.id, left); left = 0; }
  if (left > 0) {
    const rest = others.filter((r) => amounts.get(r.id)! < r.lethal).sort((a, b) => worth(b.id) - worth(a.id));
    const sink = rest[0] ?? others.sort((a, b) => worth(b.id) - worth(a.id))[0] ?? target ?? d.recipients[0]!;
    amounts.set(sink.id, amounts.get(sink.id)! + left);
  }
  return [...amounts].map(([id, amount]) => ({ id, amount }));
}

/** CR 601.2d: each target gets at least 1; damage goes to the opponent's creatures until they die, then to the opponent; counters to the bot's best creature. */
export function divide(ctx: Ctx, d: ChooseDivisionDecision): number[] {
  const amounts = d.targets.map(() => 1);
  let left = d.total - amounts.length;
  if (left <= 0) return amounts;
  const idx = d.targets.map((t, i) => ({ t, i }));
  if (d.what === 'damage') {
    const creaturesFirst = idx.filter(({ t }) => ctx.view.objects[t.id] && controller(ctx, t.id) !== ctx.me && isType(ctx, t.id, 'Creature'))
      .sort((a, b) => value(ctx, b.t.id) - value(ctx, a.t.id));
    for (const { t, i } of creaturesFirst) {
      const need = Math.max(0, lethalDamage(ctx, t.id as ObjectId) - amounts[i]!);
      const give = Math.min(need, left);
      amounts[i]! += give;
      left -= give;
    }
    // M12-6 (A12): with several opponents, an opponent the rest finishes first (CR 704.5a), then the focus
    const kill = multi(ctx) ? idx.find(({ t, i }) => ctx.opps.includes(t.id) && amounts[i]! + left >= life(ctx, t.id)) : undefined;
    const face = kill ?? idx.find(({ t }) => t.id === ctx.opp) ?? idx.find(({ t }) => !ctx.view.objects[t.id] && t.id !== ctx.me) ?? creaturesFirst[0] ?? idx[0]!;
    amounts[face.i]! += left;
    return amounts;
  }
  const mine = idx.filter(({ t }) => ctx.view.objects[t.id] && controller(ctx, t.id) === ctx.me).sort((a, b) => value(ctx, b.t.id) - value(ctx, a.t.id));
  amounts[(mine[0] ?? idx[0]!).i]! += left;
  return amounts;
}
