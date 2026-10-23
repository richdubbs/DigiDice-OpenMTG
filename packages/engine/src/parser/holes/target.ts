/**
 * The determiners that introduce a target phrase ("target", "another target", "up to two target", "any number of other target", "one or two target"):
 * how many targets the phrase announces (CR 601.2c, 115.1) and whether the noun after it is singular or plural. Shared by the Player, Obj and Recipient
 * grammars. Owner: WP6.
 */
import type { Quantity } from '../../types/ability';
import type { HoleCtx } from './core';
import { P, anaphorQty, numberAt, phraseAt } from './core';

export interface TargetDet {
  end: number;
  min: number | Quantity;
  max: number | 'any' | Quantity;
  another: boolean;
  /** Number of the noun that must follow. */
  number: 'singular' | 'plural';
  /** "each of up to two target ...": the same targets, named one by one. The verb after the phrase is singular; callers put the flag `each-of` on the parse. */
  eachOf?: boolean;
}

const W_TARGET = P('target');
const W_ANOTHER_TARGET = P('another target');
const W_UP_TO = P('up to');
const W_ANY_NUMBER_OF = P('any number of');
const W_ONE_OR_TWO = P('one or two');
const W_ONE_OR_MORE = P('one or more');
const W_ONE_TWO_OR_THREE = P('one , two , or three'); // FAST4 T34
const W_OTHER = P('other');
const W_THAT_MANY = P('that many');

/** A literal number or X in front of "target" (token level on purpose: calling the Qty hole here would re-enter it through Obj at the same position). */
function counts(ctx: HoleCtx, pos: number): { end: number; value: number | Quantity }[] {
  const t = ctx.toks[pos];
  if (t === undefined) return [];
  if (t.kind === 'X') return [{ end: pos + 1, value: { q: 'X' } }];
  const n = numberAt(ctx, pos);
  return n === undefined ? [] : [{ end: pos + 1, value: n }];
}

const W_EACH_OF = P('each of');

/**
 * Every reading of the words in front of the noun after "target" (the word "target" itself is consumed), with the "each of" forms of analysis 8.2
 * (rows 9, 14, 16, 18, 19, 22, 23). "each of" needs a quantifier: "each of target creature" and "each of another target creature" are not English.
 */
export function targetDets(ctx: HoleCtx, pos: number): TargetDet[] {
  const out = plainDets(ctx, pos);
  const eachOf = phraseAt(ctx, pos, W_EACH_OF);
  if (eachOf >= 0) for (const d of plainDets(ctx, eachOf)) if (d.number === 'plural' || d.min !== d.max) out.push({ ...d, eachOf: true });
  return out;
}

function plainDets(ctx: HoleCtx, pos: number): TargetDet[] {
  const out: TargetDet[] = [];
  const bare = phraseAt(ctx, pos, W_TARGET);
  if (bare >= 0) out.push({ end: bare, min: 1, max: 1, another: false, number: 'singular' });
  const another = phraseAt(ctx, pos, W_ANOTHER_TARGET);
  if (another >= 0) out.push({ end: another, min: 1, max: 1, another: true, number: 'singular' });

  const withOther = (p: number): { end: number; other: boolean }[] => {
    const o = phraseAt(ctx, p, W_OTHER);
    const res: { end: number; other: boolean }[] = [];
    const t = phraseAt(ctx, p, W_TARGET);
    if (t >= 0) res.push({ end: t, other: false });
    if (o >= 0) { const t2 = phraseAt(ctx, o, W_TARGET); if (t2 >= 0) res.push({ end: t2, other: true }); }
    return res;
  };

  const upTo = phraseAt(ctx, pos, W_UP_TO);
  if (upTo >= 0) {
    for (const c of counts(ctx, upTo)) {
      for (const t of withOther(c.end)) out.push({ end: t.end, min: 0, max: c.value, another: t.other, number: c.value === 1 ? 'singular' : 'plural' });
    }
    // r3-choose (CR 601.2c, 603.3d, 603.2): "choose up to that many target creatures you control" (Heroic Feast).
    // Merge wave 8 (audit D2, CR 603.12, 608.2c): "that many" is the Qty hole's number anaphor, resolved by lowering pass 5 (lower/quantities.ts#resolveTargetNumbers)
    // by the unique-candidate rule over the numbers known as the targets are chosen: the triggering event's amount (the life gained), or, for the targets of a
    // reflexive trigger, also what the instructions before it did ("you may discard any number of cards. When you do, up to that many target creatures ...")
    const thatMany = phraseAt(ctx, upTo, W_THAT_MANY);
    if (thatMany >= 0) {
      for (const t of withOther(thatMany)) out.push({ end: t.end, min: 0, max: anaphorQty({ sort: 'number', number: 'singular', text: 'that many' }) as Quantity, another: t.other, number: 'plural' });
    }
  }
  const anyN = phraseAt(ctx, pos, W_ANY_NUMBER_OF);
  if (anyN >= 0) for (const t of withOther(anyN)) out.push({ end: t.end, min: 0, max: 'any', another: t.other, number: 'plural' });
  const oneOrTwo = phraseAt(ctx, pos, W_ONE_OR_TWO);
  if (oneOrTwo >= 0) for (const t of withOther(oneOrTwo)) out.push({ end: t.end, min: 1, max: 2, another: t.other, number: 'plural' });
  const oneOrMore = phraseAt(ctx, pos, W_ONE_OR_MORE);
  if (oneOrMore >= 0) for (const t of withOther(oneOrMore)) out.push({ end: t.end, min: 1, max: 'any', another: t.other, number: 'plural' });
  // FAST4 T34 (CR 601.2c, 601.2d): "one, two, or three target attacking or blocking creatures", the recipients of a division (Deft Dismissal)
  const oneTwoThree = phraseAt(ctx, pos, W_ONE_TWO_OR_THREE);
  if (oneTwoThree >= 0) for (const t of withOther(oneTwoThree)) out.push({ end: t.end, min: 1, max: 3, another: t.other, number: 'plural' });
  for (const c of counts(ctx, pos)) {
    for (const t of withOther(c.end)) out.push({ end: t.end, min: c.value, max: c.value, another: t.other, number: c.value === 1 ? 'singular' : 'plural' });
  }
  return out;
}
