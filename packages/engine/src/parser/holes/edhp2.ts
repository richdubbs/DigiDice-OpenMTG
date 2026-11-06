/**
 * edh-players-2 (CR 702.11d, 702.11c, 105.1; Veil of Summer): `HexFromColors`, "hexproof from blue and from black" and nothing else: hexproof from one color or
 * several, each "from <color>" after the first one introduced by "and from". It reads both of what the phrase says, so that a template can give the keyword
 * abilities to permanents and the same colors to the player's own hexproof ("hexproof from blue" on a player is "you can't be the target of blue spells or of
 * abilities from blue sources your opponents control", CR 702.11d applied to a player, 702.11c):
 *   value `{ abilities: [<hexproof from <color> keyword ability>...], colors: [<Color>...] }`.
 * A color word in a list that is neither introduced by "from" nor a color the lexicon knows parses to nothing (fail closed); "monocolored", "each color" and the like
 * are not read here (the keyword grammar of Abilities reads them for permanents).
 */
import { P, phraseAt, type HoleFn } from './core';

const W_HEXPROOF_FROM = P('hexproof from');
const W_AND_FROM = P('and from');

export const hexFromColors: HoleFn = (ctx, pos) => {
  let p = phraseAt(ctx, pos, W_HEXPROOF_FROM);
  if (p < 0) return [];
  const colors: string[] = [];
  const words: string[] = [];
  for (;;) {
    const t = ctx.toks[p];
    const c = t !== undefined && t.kind === 'WORD' ? ctx.vocab.colors.get(t.norm) : undefined;
    if (c === undefined || colors.includes(c)) break;
    colors.push(c);
    words.push(t!.norm);
    p++;
    const more = phraseAt(ctx, p, W_AND_FROM);
    if (more < 0) break;
    // a following "and from" that names no color is not part of this phrase (it ends before it)
    const nt = ctx.toks[more];
    if (nt === undefined || nt.kind !== 'WORD' || ctx.vocab.colors.get(nt.norm) === undefined) break;
    p = more;
  }
  if (colors.length === 0) return [];
  const abilities = colors.map((c, i) => ({ kind: 'keyword', keyword: 'hexproof', quality: `color:${c}`, text: `hexproof from ${words[i]!}` }));
  return [{ end: p, value: { abilities, colors } }];
};
