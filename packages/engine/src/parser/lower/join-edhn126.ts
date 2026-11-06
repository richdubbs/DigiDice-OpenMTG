/**
 * edh-next-126 sentence join (parser/lower/ability.ts#buildProgram): "Look at the top N cards of your library. As many times as you choose, you may pay N life, put those cards on
 * the bottom of your library in any order, then look at the top N cards of your library. Then shuffle and put the last cards you looked at this way on top in any order." is one
 * instruction (CR 608.2c, 608.2d; Lim-Dûl's Vault, ruling 2007-09-16): "those cards" in each run of the repeat are the cards the run before looked at (the first look's for the
 * first run), and "the last cards you looked at this way" are the last run's (or the first look's when the player never repeats). The cards each look names are one group that
 * every look rebinds, so the three sentences are joined and one template reads them (eff.edhn126.vault.lookPayBottomRepeat). Joined only for exactly this shape, else the
 * sentences stay as they are.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');
const FIRST = /^look at the top \S+ cards of your library \.$/;
const SECOND = /^as many times as you choose , you may pay \S+ life , put those cards on the bottom of your library in any order , then look at the top \S+ cards of your library \.( then shuffle and put the last cards you looked at this way on top in any order \.)?$/;
const THIRD = 'then shuffle and put the last cards you looked at this way on top in any order .';

export function joinEdhN126Vault<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    if (a !== undefined && FIRST.test(norms(p.tokens)) && SECOND.test(norms(a.tokens))) {
      const b = pieces[i + 2];
      const whole = norms(a.tokens).endsWith(THIRD);
      if (whole) {
        out.push({ ...p, tokens: [...p.tokens, ...a.tokens] });
        i++;
        continue;
      }
      if (b !== undefined && norms(b.tokens) === THIRD) {
        out.push({ ...p, tokens: [...p.tokens, ...a.tokens, ...b.tokens] });
        i += 2;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}
