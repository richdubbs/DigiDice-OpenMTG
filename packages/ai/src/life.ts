/**
 * Life a play costs (CR 119.4): Phyrexian mana the bot's sources can't pay (CR 107.4f, 2 life each), "pay N life" in a cost (CR 118.3, 601.2f-h), and the
 * life in an alternative cost such as flashback (CR 118.9, 702.34a). The bot never pays its life down to 0: it would lose the game before its spell
 * resolved (CR 104.3b, 704.5a).
 */
import { manaSources, parseManaSymbol, type Action, type CostDef, type ManaSymbol, type PayCostDecision } from '@openmtg/engine';
import { boardPower, creatures, LETHAL, life, multi, pt, type Ctx } from './context';
import { qty } from './intent';

/**
 * Life the engine's auto-payer would pay for these mana symbols: it pays Phyrexian symbols with mana when it can (rules/solver.ts), so only the ones the
 * bot's untapped sources can't cover cost life. An estimate: each source counts as one mana of any color it can make.
 */
export function phyrexianLife(ctx: Ctx, symbols: readonly ManaSymbol[]): number {
  const phyrexian = symbols.filter((s) => s.kind === 'phyrexian' || s.kind === 'hybridPhyrexian');
  if (phyrexian.length === 0) return 0;
  const sources: Set<string>[] = (ctx.view.players.find((p) => p.id === ctx.me)?.manaPool ?? []).map((u) => new Set([u.type]));
  try {
    for (const src of manaSources(ctx.state, ctx.me)) sources.push(new Set(src.modes.flatMap((m) => m.units.flat())));
  } catch { /* a view the solver can't read: no sources */ }
  const used = sources.map(() => false);
  /** Use the least flexible free source that makes one of these colors. */
  const take = (colors: readonly string[]): boolean => {
    let best = -1;
    sources.forEach((s, i) => {
      if (!used[i] && colors.some((c) => s.has(c)) && (best < 0 || s.size < sources[best]!.size)) best = i;
    });
    if (best < 0) return false;
    used[best] = true;
    return true;
  };
  let generic = 0;
  for (const s of symbols) {
    if (s.kind === 'colored') take([s.color]);
    else if (s.kind === 'hybrid') take(s.colors);
    else if (s.kind === 'colorless') take(['C']);
    else if (s.kind === 'colorlessHybrid') take(['C', s.color]);
    else if (s.kind === 'monoHybrid') { if (!take([s.color])) generic += s.generic; }
    else if (s.kind === 'generic') generic += s.amount;
    else if (s.kind === 'snow') generic += 1;
  }
  let lifePaid = 0;
  let byMana = 0;
  for (const s of phyrexian) {
    const colors = s.kind === 'phyrexian' ? [s.color] : s.kind === 'hybridPhyrexian' ? s.colors : [];
    if (take(colors)) byMana++;
    else lifePaid += 2;
  }
  // Generic mana needs sources too: a Phyrexian symbol paid with life frees one.
  let free = used.filter((u) => !u).length;
  while (free < generic && byMana > 0) { byMana--; free++; lifePaid += 2; }
  return lifePaid;
}

/** Life a cost asks for: its Phyrexian mana and its "pay N life" parts. */
export function costLife(ctx: Ctx, cost: CostDef | undefined, x = 0): number {
  if (!cost) return 0;
  const paid = (cost.other ?? []).reduce((n, p) => n + (p.kind === 'payLife' ? qty(p.amount, x) : 0), 0);
  return paid + phyrexianLife(ctx, (cost.mana ?? []).filter((s) => s.kind !== 'variable'));
}

/** Life a priority action would cost the bot: the mana cost of the face, or the alternative cost of the cast method (flashback ...), or the ability's cost. */
export function actionLife(ctx: Ctx, a: Action, abilityCost?: CostDef): number {
  if (a.type === 'activate') return costLife(ctx, abilityCost);
  if (a.type !== 'cast') return 0;
  const o = ctx.view.objects[a.card];
  const face = ctx.view.defs[o?.defId ?? '']?.faces[a.face ?? 0];
  if (!face) return 0;
  if (a.method) {
    const alt = face.abilities.find((ab) => ab.kind === 'keyword' && ab.keyword === a.method);
    if (alt?.kind === 'keyword' && alt.cost) return costLife(ctx, alt.cost);
  }
  return costLife(ctx, { mana: face.manaCost ?? [] });
}

/**
 * Whether the bot can afford to pay `amount` life for a play worth `score`: never down to 0 (CR 119.4, 104.3b), and, unless the play wins the game, not
 * down to what the opponent's creatures could deal on their next attack.
 */
export function affordsLife(ctx: Ctx, amount: number, score: number): boolean {
  if (amount <= 0) return true;
  const left = life(ctx, ctx.me) - amount;
  if (left <= 0) return false;
  if (score >= LETHAL) return true;
  // M12-6 (A6): with several opponents, the strongest one's next attack (each attacks on their own turn)
  const theirPower = multi(ctx) ? Math.max(...ctx.opps.map((p) => boardPower(ctx, p))) : creatures(ctx, ctx.opp).reduce((n, id) => n + pt(ctx, id).power, 0);
  return left > theirPower;
}

/** Life the mana payment of a payCost decision would take, read from its cost text ("{1}{B/P}{B/P}"): the backstop when a payment comes up. */
export function payCostLife(ctx: Ctx, d: PayCostDecision): number {
  const symbols: ManaSymbol[] = [];
  for (const m of d.costText.matchAll(/\{([^}]+)\}/g)) {
    try {
      const s = parseManaSymbol(m[1]!);
      if (s.kind !== 'variable') symbols.push(s);
    } catch { /* a symbol that is not mana */ }
  }
  return phyrexianLife(ctx, symbols);
}
