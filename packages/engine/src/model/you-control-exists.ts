/**
 * edh-next-140 (CR 605.3b, 608.2c; Altar of the Pantheon): a condition that only asks whether the effect's controller controls a permanent of a description (`exists` of "each"
 * permanents with `controller: 'you'`), or of one of several (`any` of such): it reads the visible board as the ability resolves. Pure shape check, shared by
 * parser/lower/ability.ts#gainLifeIfYouControl and model/cap-walk.ts#nativeManaEffect.
 */
export const youControlExists = (c: unknown): boolean => {
  const x = c as { cond?: string; of?: unknown; atLeast?: unknown };
  if (x?.cond === 'any' && Array.isArray(x.of)) return x.of.length >= 2 && x.of.every((y) => youControlExists(y) && (y as { cond?: string }).cond === 'exists');
  const of = x?.of as { ref?: string; filter?: { controller?: unknown; zone?: unknown } } | undefined;
  return x?.cond === 'exists' && x.atLeast === undefined && of?.ref === 'each' && Object.keys(of).length === 2 && of.filter?.controller === 'you' && (of.filter.zone === undefined || of.filter.zone === 'battlefield');
};
