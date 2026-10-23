/**
 * Guard G10 per unit (design 6.8: "adding a template may change only formerly-manual units"). Owner: WP19 tests.
 *
 * An ability is split into the units the design makes manual one by one (design 6.6): its kind (a non-manual ability is a unit: its trigger fires on its
 * own, its cost is paid by the engine), the trigger, the intervening "if", each cost part, each automated effect step (of the main program and of each
 * modal option), and, for abilities without an effect program (static, keyword), the ability itself. A unit is automated when it contains no manual node.
 * Comparing two parses of the same card, every automated unit of the first must be in the second, unchanged: a template may add automation, never take it
 * away or change it.
 */
import type { AbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import type { ParseOptions, ParseResult } from '../../../src/parser/types';
import { parseCard } from '../../../src/parser/parse';
import { canonicalJson } from '../../../src/parser/holes';

type Rec = Record<string, unknown>;

const hasManual = (v: unknown): boolean => {
  const json = JSON.stringify(v) ?? '';
  return json.includes('"op":"manual"') || json.includes('"kind":"manual"') || json.includes('"cond":"ask"') || json.includes('"q":"ask"');
};

/** Without bookkeeping that does not depend on meaning (`src`, `prov`, `text`, `span`). */
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v === null || typeof v !== 'object') return v;
  const out: Rec = {};
  for (const [k, x] of Object.entries(v as Rec)) if (k !== 'src' && k !== 'prov' && k !== 'text' && k !== 'span') out[k] = strip(x);
  return out;
}

const key = (tag: string, v: unknown): string => `${tag}:${canonicalJson(strip(v))}`;

/** The automated units of one ability. */
export function automatedUnits(a: AbilityDef): string[] {
  const out: string[] = [];
  const r = a as unknown as Rec;
  if (a.kind !== 'manual') out.push(`kind:${a.kind}`);
  if (a.kind === 'triggered') {
    out.push(key('trigger', a.trigger));
    if (a.interveningIf !== undefined && !hasManual(a.interveningIf)) out.push(key('if', a.interveningIf));
  }
  const cost = r['cost'] as Rec | undefined;
  if (cost) {
    for (const k of ['mana', 'tap', 'untap', 'loyalty'] as const) if (cost[k] !== undefined) out.push(key(`cost.${k}`, cost[k]));
    for (const p of (cost['other'] as Rec[] | undefined) ?? []) if (!hasManual(p)) out.push(key('cost.part', p));
  }
  const programs: Rec[] = [];
  const effect = r['effect'] as Rec | undefined;
  if (effect) {
    programs.push(effect);
    for (const o of ((effect['modes'] as Rec | undefined)?.['options'] as Rec[] | undefined) ?? []) programs.push(o['program'] as Rec);
  }
  programs.forEach((p, i) => {
    for (const s of (p['steps'] as Rec[] | undefined) ?? []) if (!hasManual(s)) out.push(key(`step${i === 0 ? '' : `.mode${i}`}`, s));
  });
  if (!effect && a.kind !== 'manual' && !hasManual(a)) out.push(key('whole', a));
  return out;
}

export interface G10Loss { card: string; face: number; ability: number; lost: string[]; before: string; after: string }

/**
 * Every automated unit of `before` that `after` does not have (per face, per ability index). Abilities are matched by index; when the counts differ the
 * whole face is compared as one bag.
 */
export function g10Losses(card: OracleCard, before: ParseOptions, after: ParseOptions): G10Loss[] {
  return g10LossesOf(card.name, parseCard(card, before), parseCard(card, after));
}

/** The same on two parses of one card. */
export function g10LossesOf(name: string, a: ParseResult, b: ParseResult): G10Loss[] {
  const out: G10Loss[] = [];
  a.faces.forEach((fa, k) => {
    const fb = b.faces[k];
    const pairs: [AbilityDef[], AbilityDef[], number][] =
      fb !== undefined && fb.abilities.length === fa.abilities.length ? fa.abilities.map((x, j) => [[x], [fb.abilities[j]!], j]) : [[fa.abilities, fb?.abilities ?? [], -1]];
    for (const [xs, ys, j] of pairs) {
      const have = new Map<string, number>();
      for (const u of ys.flatMap(automatedUnits)) have.set(u, (have.get(u) ?? 0) + 1);
      const lost: string[] = [];
      for (const u of xs.flatMap(automatedUnits)) {
        const n = have.get(u) ?? 0;
        if (n > 0) have.set(u, n - 1);
        else lost.push(u);
      }
      if (lost.length > 0) out.push({ card: name, face: k, ability: j, lost, before: JSON.stringify(xs.map(strip)), after: JSON.stringify(ys.map(strip)) });
    }
  });
  return out;
}
