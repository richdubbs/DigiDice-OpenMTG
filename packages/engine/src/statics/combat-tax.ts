/**
 * r5-static: the costs to attack and to block (CR 508.1h-j, 509.1d-f), from the rule modifications `attackTax` and `blockTax` (types/ability.ts RuleModDef).
 * "Creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures" is not a restriction: the attack is
 * legal, and it has a cost the attacking player may pay (CR 508.1d: a requirement that would need a cost is not counted). This module only says which costs a
 * declaration has; core/combat-tax.ts makes the player pay them or declare again.
 *
 * Each tax is computed for one declared creature at a time, with the effect's controller as "you" (CR 109.5): `of` (the creatures it taxes, default every
 * creature) matched as the creature is now, `value` (generic mana) or `cost` per creature. Several effects add up (CR 508.1h: the total cost). A quantity
 * that can't be determined, or a filter the statics can't judge, makes the tax `unknown`: the caller lets the players settle it by hand, never a silent
 * free attack.
 */
import type { CostDef, ObjectFilter, RuleModDef } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameState } from '../types/state';
import { evalQuantity } from './match';
import { objectMatches } from './rule-match';
import { cxOf, refIncludes, ruleContext, type RuleContext, type RuleSource } from './rule-sources';

/** One creature's share of the cost of a declaration, from one effect. */
export interface CombatTax {
  creature: ObjectId;
  sourceName: string;
  /** The cost for this creature; null when it can't be determined (`why`). */
  cost: CostDef | null;
  why?: string;
}

const generic = (n: number): CostDef => ({ mana: [{ kind: 'generic', amount: n }] });

/** The cost of one creature under one effect, or null with the reason when it can't be determined. */
function costOf(ctx: RuleContext, src: RuleSource, m: RuleModDef): { cost: CostDef | null; why?: string } {
  if (m.cost !== undefined) {
    // an {X} that was not fixed (model/cap-walk.ts keeps such a card manual) is never read as 0
    if ((m.cost.mana ?? []).some((x) => x.kind === 'variable')) return { cost: null, why: 'the cost has an X that was not fixed' };
    return { cost: m.cost };
  }
  if (m.value === undefined || m.value === 'none') return { cost: null, why: 'no cost given' };
  const n = evalQuantity(cxOf(ctx, src), m.value);
  if (n === undefined) return { cost: null, why: 'the amount to pay can not be determined' };
  return { cost: generic(Math.max(0, n)) }; // CR 107.1b
}

/** Does `f` describe this creature (undefined: every creature)? undefined when the statics can't judge the filter. */
function describes(ctx: RuleContext, src: RuleSource, id: ObjectId, f: ObjectFilter | undefined): boolean | undefined {
  return f === undefined ? true : objectMatches(cxOf(ctx, src), id, f);
}

/** CR 508.1h: is an attack on this defender (a player, or a planeswalker or battle) one the effect taxes? */
function protects(ctx: RuleContext, src: RuleSource, m: RuleModDef, defender: PlayerId | ObjectId): boolean {
  const scope = m.defenders ?? 'players';
  if (scope === 'any') return true;
  const who = m.player ?? { ref: 'you' as const };
  const cx = cxOf(ctx, src);
  if (ctx.view.s.players.some((p) => p.id === defender)) return scope !== 'planeswalkers' && refIncludes(cx, who, defender);
  if (scope === 'players') return false;
  const o = ctx.view.s.objects[defender];
  const c = ctx.view.get(defender);
  return o !== undefined && c !== undefined && c.types.includes('Planeswalker') && refIncludes(cx, who, o.controller);
}

function taxesOf(ctx: RuleContext, src: RuleSource, m: RuleModDef, creature: ObjectId, out: CombatTax[]): void {
  const fits = describes(ctx, src, creature, m.of);
  if (fits === false) return;
  if (fits === undefined) {
    out.push({ creature, sourceName: src.name, cost: null, why: 'which creatures it applies to can not be judged' });
    return;
  }
  out.push({ creature, sourceName: src.name, ...costOf(ctx, src, m) });
}

/** CR 508.1h: the costs of this attack declaration, one entry per taxed attacker and effect (empty when it costs nothing). */
export function attackTaxes(s: GameState, attacks: readonly { attacker: ObjectId; defender: PlayerId | ObjectId }[]): CombatTax[] {
  const ctx = ruleContext(s);
  if (!ctx || attacks.length === 0) return [];
  const out: CombatTax[] = [];
  for (const src of ctx.sources) {
    const m = src.effect;
    if (m.s !== 'rule' || m.rule !== 'attackTax') continue;
    for (const a of attacks) if (protects(ctx, src, m, a.defender)) taxesOf(ctx, src, m, a.attacker, out);
  }
  return out;
}

/**
 * CR 509.1d: the costs of this block declaration, one entry per taxed blocker and effect. A creature blocking several attackers is taxed once ("for each of
 * those creatures": the blocking creatures); with `blocking`, only when one of the attackers it blocks is one the effect names.
 */
export function blockTaxes(s: GameState, blocks: readonly { blocker: ObjectId; attacker: ObjectId }[]): CombatTax[] {
  const ctx = ruleContext(s);
  if (!ctx || blocks.length === 0) return [];
  const out: CombatTax[] = [];
  const blockers = [...new Set(blocks.map((b) => b.blocker))];
  for (const src of ctx.sources) {
    const m = src.effect;
    if (m.s !== 'rule' || m.rule !== 'blockTax') continue;
    for (const blocker of blockers) {
      if (m.blocking !== undefined) {
        const named = blocks.filter((b) => b.blocker === blocker).map((b) => describes(ctx, src, b.attacker, m.blocking));
        if (named.includes(undefined)) {
          out.push({ creature: blocker, sourceName: src.name, cost: null, why: 'which attackers it applies to can not be judged' });
          continue;
        }
        if (!named.includes(true)) continue;
      }
      taxesOf(ctx, src, m, blocker, out);
    }
  }
  return out;
}

/**
 * CR 508.1d, 509.1c: the effects that put a cost on attacking (`attack`) or blocking (`block`) right now, as source name and text. A requirement that could
 * be obeyed only by paying a cost does not count, and which requirements need a cost depends on the whole declaration, so rules/requirements.ts checks no
 * requirement while one of these applies (rules/requirements-manual.ts lists them with the manual texts).
 */
export function combatTaxTexts(s: GameState, kind: 'attack' | 'block'): { sourceName: string; text: string }[] {
  const ctx = ruleContext(s);
  if (!ctx) return [];
  const rule = kind === 'attack' ? 'attackTax' : 'blockTax';
  return ctx.sources.filter((src) => src.effect.s === 'rule' && src.effect.rule === rule).map((src) => ({ sourceName: src.name, text: src.text }));
}
