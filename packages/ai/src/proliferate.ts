/**
 * CR 701.34a: proliferate. The engine asks for any number of the permanents and players that have a counter (option ids "object:<id>" and
 * "player:<id>"); each chosen one gets one more counter of EACH kind it already has. The bot chooses a holder when that helps its side: its own permanents
 * and itself where the counters are beneficial, the opponent's permanents and the opponent where they are harmful. Counters of other kinds (time, lore,
 * charge, ...) are judged neither way and count for nothing; a holder whose counters do not add up to a gain is skipped.
 */
import type { ChooseOptionDecision, PlayerId } from '@openmtg/engine';
import { controller, type Ctx } from './context';

const BENEFICIAL = new Set(['+1/+1', 'loyalty', 'shield', 'energy', 'experience']);
const HARMFUL = new Set(['-1/-1', 'poison', 'stun']);

/** Is this the proliferate decision (CR 701.34a)? */
export const isProliferate = (d: ChooseOptionDecision): boolean => (d.rules ?? []).includes('CR 701.34a');

/** +1 for a counter kind that helps its holder, -1 for one that hurts it, 0 otherwise. */
const polarity = (kind: string): number => (BENEFICIAL.has(kind) ? 1 : HARMFUL.has(kind) ? -1 : 0);

/** What one more counter of each kind the holder has is worth to the bot. */
function gain(ctx: Ctx, optionId: string): number {
  const sep = optionId.indexOf(':');
  const kind = optionId.slice(0, sep);
  const ref = optionId.slice(sep + 1);
  let counters: Record<string, number> = {};
  let side: PlayerId | null = null;
  if (kind === 'player') {
    const p = ctx.view.players.find((x) => x.id === ref);
    if (p) counters = { ...p.counters, ...(p.poison > 0 ? { poison: p.poison } : {}) };
    side = p ? p.id : null;
  } else if (kind === 'object') {
    counters = ctx.view.objects[ref]?.counters ?? {};
    side = controller(ctx, ref);
  }
  if (side === null) return 0;
  const sign = side === ctx.me ? 1 : -1;
  return Object.entries(counters).reduce((n, [k, c]) => n + (c > 0 ? sign * polarity(k) : 0), 0);
}

export function chooseProliferate(ctx: Ctx, d: ChooseOptionDecision): string[] {
  const usable = d.options.filter((o) => !o.disabled);
  const ranked = usable.map((o) => ({ id: o.id, g: gain(ctx, o.id) })).sort((a, b) => b.g - a.g);
  const n = Math.min(d.max, Math.max(d.min, ranked.filter((r) => r.g > 0).length));
  return ranked.slice(0, n).map((r) => r.id);
}
