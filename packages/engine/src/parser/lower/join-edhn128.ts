/**
 * edh-next-128 sentence joins (parser/lower/ability.ts#buildProgram): sentences that only read together, joined so one template reads them.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');

/**
 * CR 705.1, 608.2c (Mana Clash): "You and target opponent each flip a coin. ~ deals 1 damage to each player whose coin comes up tails. Repeat this process until both players' coins come
 * up heads on the same flip." is one process (the repeat runs the two sentences before it), so the three sentences are joined and one template reads them
 * (eff.edhn128.youAndPlayerFlip.tailsDamage.untilBothHeads); and Squee's Revenge (below). Any other sentences are left as they are.
 */
export function joinEdhN128<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    const b = pieces[i + 2];
    // CR 705.2, 608.2c (Squee's Revenge): "Choose a number. Flip a coin that many times or until you lose a flip, whichever comes first. If you win all the flips, draw two cards for each
    // flip.": the number is read by the flip and the flips by the last sentence (eff.edhn128.chooseNumber.flipUntilLoseCapped.drawIfAllWon)
    if (a !== undefined && b !== undefined && norms(p.tokens) === 'choose a number .' && norms(a.tokens) === 'flip a coin that many times or until you lose a flip , whichever comes first .'
      && /^if you win all the flips , draw [a-z0-9]+ cards for each flip \.$/.test(norms(b.tokens))) {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens, ...b.tokens] });
      i += 2;
      continue;
    }
    // CR 608.2d, 613.1b (Scrambleverse): "For each nonland permanent, choose a player at random. Then each player gains control of each permanent for which they were chosen. Untap those
    // permanents." (eff.edhn128.eachNonland.randomPlayer.gainsControl.untap)
    if (a !== undefined && b !== undefined && norms(p.tokens) === 'for each nonland permanent , choose a player at random .' && norms(a.tokens) === 'then each player gains control of each permanent for which they were chosen .'
      && norms(b.tokens) === 'untap those permanents .') {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens, ...b.tokens] });
      i += 2;
      continue;
    }
    if (a !== undefined && b !== undefined && /^you and .+ each flip a coin \.$/.test(norms(p.tokens)) && /^.+ deals 1 damage to each player whose coin comes up tails \.$/.test(norms(a.tokens))
      && norms(b.tokens) === "repeat this process until both players' coins come up heads on the same flip .") {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens, ...b.tokens] });
      i += 2;
      continue;
    }
    out.push(p);
  }
  return out;
}
