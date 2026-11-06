/**
 * edh-next-143 sentence join (parser/lower/ability.ts#buildProgram): "Each player shuffles all permanents they own into their library, then reveals that many cards from the top of
 * their library. Each player puts all artifact, creature, and land cards revealed this way onto the battlefield, then does the same for enchantment cards, then puts all cards revealed
 * this way that weren't put onto the battlefield on the bottom of their library." is one instruction (CR 101.4, 608.2c; Warp World, rulings 2009-10-01): "that many" of each player is
 * the number of permanents THAT player owned, "revealed this way" names every player's revealed cards, and the enchantments enter after the artifacts, creatures and lands of every
 * player. Both sentences are joined and one template reads them (eff.edhn143.eachPlayer.shufflePermanents.revealThatMany.putTypesThenEnchantments). Joined only for exactly this
 * shape, else the sentences stay as they are.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');
const FIRST = 'each player shuffles all permanents they own into their library , then reveals that many cards from the top of their library .';
const SECOND = "each player puts all artifact , creature , and land cards revealed this way onto the battlefield , then does the same for enchantment cards , then puts all cards revealed this way that weren't put onto the battlefield on the bottom of their library .";

export function joinEdhN143WarpWorld<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    if (a !== undefined && norms(p.tokens) === FIRST && norms(a.tokens) === SECOND) {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}
