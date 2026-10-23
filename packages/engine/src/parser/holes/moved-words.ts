/**
 * Cloud C7: the words "<participle> this way" after a description of objects (CR 608.2c, 608.2h): "for each creature destroyed this way", "the number of cards
 * exiled this way", "for each permanent sacrificed this way", "for each card discarded this way", "for each card put into a graveyard this way".
 *
 * The participle says which kind of instruction did it (`MovedKind`): a destroy, a move into exile, a discard, a sacrifice, a move into a graveyard, onto the
 * battlefield or into a hand. The Filter hole reads the words as a post-modifier with the marker `$moved` (parser/holes/filter.ts#postModAt); the description
 * is then what the instruction reports it moved, read as each object last existed before it moved (effects/api.ts#StepResult.before). Only a count of such a
 * description is understood: the quantities pass turns `{q:'count', of:{ref:'each', filter:{$moved, ...}}}` into the result count of the ONE earlier instruction
 * of that kind (`{q:'resultCount', step, which}`, lower/quantities.ts); a marker anywhere else survives lowering and the sentence is manual (lower/normalize.ts).
 * No imports but the hole core: parser/holes/filter.ts and parser/holes/moved.ts both read this table.
 */
import type { ObjectFilter } from '../../types/ability';
import type { HoleCtx } from './core';
import { P, phraseAt } from './core';

/** The kinds of instruction a "<participle> this way" names. */
export type MovedKind = 'destroyed' | 'exiled' | 'discarded' | 'sacrificed' | 'graveyard' | 'battlefield' | 'hand' | 'top';

/**
 * The words of each kind after the noun phrase (passive), "this way" included, and what they add to the description: "your hand" / "your graveyard" are the
 * cards you own (CR 400.3: a card goes to its owner's hand or graveyard), so a card returned to another player's hand is not "returned to your hand".
 */
export const PASSIVE: readonly (readonly [readonly string[], MovedKind, ObjectFilter])[] = [
  [P('destroyed this way'), 'destroyed', {}],
  [P('exiled this way'), 'exiled', {}],
  // std-r9b (CR 608.2h, 400.3): "for each card exiled from their hand this way": the cards that were in a hand as they last existed before the move (a card is
  // only ever in its owner's hand), after a search of a player's graveyard, hand, and library
  [P('exiled from their hand this way'), 'exiled', { zone: 'hand' }],
  [P('put into exile this way'), 'exiled', {}],
  [P('discarded this way'), 'discarded', {}],
  [P('sacrificed this way'), 'sacrificed', {}],
  [P('put into a graveyard this way'), 'graveyard', {}],
  [P('put into graveyards this way'), 'graveyard', {}],
  [P('put into your graveyard this way'), 'graveyard', { owner: 'you' }],
  [P('put onto the battlefield this way'), 'battlefield', {}],
  [P('returned to your hand this way'), 'hand', { owner: 'you' }],
  [P("returned to their owners' hands this way"), 'hand', {}],
  [P("returned to its owner 's hand this way"), 'hand', {}], // r4-moved: the tokens of "owner's" ("owner", "'s"), as parser/holes/cost.ts writes them; the row never matched before
  // r5-fxz (CR 701.25a, 701.22a): "for each card you put on top of your library" after a surveil or a scry: the cards it left on top (no "this way": Oracle omits it)
  [P('you put on top of your library'), 'top', { owner: 'you' }],
];

/** The destination a kind of move has (`did.to`); the other kinds are actions that report what they moved wherever it went (CR 701.8a, 701.9a, 701.21a). */
export const MOVED_TO: Readonly<Partial<Record<MovedKind, 'exile' | 'graveyard' | 'battlefield' | 'hand'>>> = { exiled: 'exile', graveyard: 'graveyard', battlefield: 'battlefield', hand: 'hand' };
/** The op of a kind that is an action of its own (the `$op` marker of a condition: a destroy needs none, it is FAST5X E17's reading). */
export const MOVED_OP: Readonly<Partial<Record<MovedKind, 'sacrifice' | 'discard'>>> = { sacrificed: 'sacrifice', discarded: 'discard' };

/**
 * Whether `step` (an effect step of the model, as a record) is an instruction of that kind: the instruction a "<participle> this way" can name. A destroy, a
 * sacrifice (the op of "sacrifice ~" or of a player's choice, CR 701.21a), a discard; a move whose destination is that zone, with nothing delayed; a mill puts cards
 * into a graveyard.
 */
export function movedBy(step: Record<string, unknown>, kind: MovedKind): boolean {
  const op = step['op'];
  if (kind === 'destroyed') return op === 'destroy';
  if (kind === 'sacrificed') return op === 'sacrifice' || op === 'sacrificeChoice';
  if (kind === 'discarded') return op === 'discard';
  if (kind === 'top') return op === 'surveil' || op === 'scry'; // r5-fxz: what it left on top of the library (StepResult.kept)
  if (kind === 'graveyard' && op === 'mill') return true; // a mill puts cards into a graveyard (CR 701.17a): "Mill X cards. ... for each creature card put into your graveyard this way"
  const to = step['to'];
  return op === 'move' && typeof to === 'object' && to !== null && (to as Record<string, unknown>)['zone'] === MOVED_TO[kind] && step['until'] === undefined;
}

/** The marker key of the post-modifier (never part of the model: lower/quantities.ts takes it out, lower/normalize.ts refuses a leftover one). */
export const MOVED_MARK = '$moved';

/**
 * The Filter post-modifier "<participle> this way" at `pos`: the marker of its kind. Weak (1): a template that names the instruction itself ("discard your hand,
 * then draw cards equal to the number of cards discarded this way", FAST4 T26) is the more specific reading of the same words (design 6.3 rule 2).
 */
export function movedFragAt(ctx: HoleCtx, pos: number): { end: number; frag: ObjectFilter; weak: number }[] {
  const out: { end: number; frag: ObjectFilter; weak: number }[] = [];
  for (const [ws, kind, adds] of PASSIVE) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) out.push({ end: e, frag: { [MOVED_MARK]: kind, ...adds } as ObjectFilter, weak: 1 });
  }
  return out;
}
