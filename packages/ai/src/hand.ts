/**
 * Opening hands and hand management: keep or mulligan (CR 103.5), which cards go to the bottom, which cards to discard (CR 514.1, 701.9).
 */
import type { MulliganDecision, ObjectId } from '@openmtg/engine';
import { battlefield, hand, type Ctx } from './context';
import { cardValue } from './value';

const isLand = (ctx: Ctx, id: ObjectId): boolean => ctx.chars(id)?.types.includes('Land') ?? false;

/** CR 103.5: keep a seven-card hand with two to five lands; one fewer card per mulligan makes the bot less picky, and it never goes below five cards. */
export function keepHand(ctx: Ctx, d: MulliganDecision): boolean {
  const cards = hand(ctx, ctx.me);
  const lands = cards.filter((id) => isLand(ctx, id)).length;
  const spells = cards.length - lands;
  if (d.mulligans >= 2 || d.handSize <= 4) return true;
  if (d.mulligans === 1) return lands >= 1 && spells >= 1 && lands <= 5;
  if (lands < 2 || lands > 5) return false;
  // At least one spell the lands could cast soon.
  return cards.some((id) => !isLand(ctx, id) && (ctx.chars(id)?.manaValue ?? 99) <= lands + 1);
}

/** How much the bot wants to keep a card in hand: lands while it needs them, spells it can cast soon. */
export function keepValue(ctx: Ctx, id: ObjectId, landsAfter: number): number {
  const c = ctx.chars(id);
  if (!c) return 0;
  if (c.types.includes('Land')) return landsAfter < 5 ? 8 : 1.5;
  return cardValue(c) * 0.6 + (c.manaValue <= landsAfter + 1 ? 3 : 0) - Math.max(0, c.manaValue - landsAfter - 2);
}

/** The `count` cards to let go (to the bottom after a mulligan, or discarded): keep a land count close to 40% of what stays. */
export function cardsToShed(ctx: Ctx, options: readonly ObjectId[], count: number): ObjectId[] {
  const out: ObjectId[] = [];
  const pool = [...options];
  const landsInPlay = battlefield(ctx, ctx.me, 'Land').length;
  for (let k = 0; k < count && pool.length > 0; k++) {
    const keptLands = pool.filter((id) => isLand(ctx, id)).length;
    const keptSize = pool.length - 1;
    const tooManyLands = landsInPlay + keptLands > Math.max(3, Math.round((landsInPlay + keptSize) * 0.45));
    let worst = 0;
    let worstScore = Infinity;
    pool.forEach((id, i) => {
      let s = keepValue(ctx, id, landsInPlay + keptLands);
      if (isLand(ctx, id)) s += tooManyLands ? -6 : 2;
      if (s < worstScore) { worstScore = s; worst = i; }
    });
    out.push(pool.splice(worst, 1)[0]!);
  }
  return out;
}
