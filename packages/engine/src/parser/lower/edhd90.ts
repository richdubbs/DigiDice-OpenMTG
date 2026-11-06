/**
 * Round edh-d-90 (Commander coordinator D, band 5,001-10,000, group combat): a lowering pass of its own.
 *
 * bindSacrificedX (CR 107.3, 608.2h, 603.12, 701.21a; Campsite Cuisine: "Whenever you attack, you may sacrifice X Foods. When you do, up to X target attacking creatures each get +3/+3 ..."):
 * the X of "you may sacrifice X <permanents>" (template eff.edhd90.you.maySacrifice.X) is the number of permanents the player chooses to sacrifice as the ability resolves; a later sentence of
 * the ability that says X reads that number, the count of the sacrifice step (`resultCount`). Only in a triggered ability (no announced X to mean instead), when nothing before the sacrifice says
 * X, and the sacrifice is the one such instruction; else every sentence is manual (a reading that could be wrong).
 */
import type { Draft, Rec, Unit } from './types';
import { rewrite, setManual, visit } from './util';

/** The binding name the template gives its sacrifice step (eff.edhd90.you.maySacrifice.X): the mark of the X it defines. */
const MARK = 'sacrificedX';
const X_QTY = '{"q":"X"}';

export function bindSacrificedX(d: Draft, seq: Unit[]): void {
  const at: number[] = [];
  const marks = (v: unknown): boolean => { let m = false; visit(v, (n) => { if (n['op'] === 'sacrifice' && n['as'] === MARK) m = true; }); return m; };
  seq.forEach((u, i) => { if (!u.manual && marks(u.steps)) at.push(i); });
  if (at.length === 0) return;
  const fail = (reason: string): void => { for (const u of seq) setManual(u, { code: 'unbound-reference', reason, unresolved: true }); };
  // only in a triggered ability (no X is announced for it, CR 107.3, 603.3): an activated ability's or a spell's X is the one announced
  if (at.length > 1 || d.trigger === undefined || d.spell === true) return fail('an X that two instructions or an announced {X} could define (CR 107.3)');
  const k = at[0]!;
  const name = MARK;
  const reads = (v: unknown): boolean => JSON.stringify(v).includes(X_QTY);
  const ids = new Set(seq.slice(k + 1).flatMap((u) => u.targetIds ?? []));
  const before = seq.slice(0, k + 1).some((u) => reads(u.steps)) || d.targets.some((t) => !ids.has(t.id) && reads(t));
  if (before) return fail('an X read before the instruction that defines it (CR 107.3)');
  const count = { q: 'resultCount', step: name };
  const sub = (v: unknown): unknown => rewrite(v, (n: Rec) => (JSON.stringify(n) === X_QTY ? { ...count } : undefined));
  for (const u of seq.slice(k + 1)) u.steps = sub(u.steps) as Rec[];
  d.targets = d.targets.map((t) => (ids.has(t.id) ? (sub(t) as typeof t) : t));
}
