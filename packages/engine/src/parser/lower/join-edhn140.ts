/**
 * edh-next-140 sentence join (parser/lower/ability.ts#buildProgram): "Return it to the battlefield. It's an Aura enchantment with enchant Forest you control and "..." ~ loses all other
 * abilities." is one instruction (CR 303.4f, 614.1c, 613.1d; Harold and Bob, First Numens, eff.edhn140.return.bf.asAura.losesOthers): the second sentence says how the object ENTERS (an Aura,
 * attached as it enters, with nothing to enchant it stays where it is), so the two sentences are joined and one template reads them. Joined only for a first sentence "return it to the
 * battlefield." (or "return ~ to the battlefield.") followed by a sentence that starts "it's an aura enchantment with enchant" and ends "loses all other abilities."; any other sentences are left as they are.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm.toLowerCase()).join(' ');
const FIRST = /^return (?:it|~) to the battlefield \.$/;
const SECOND = /^it's an aura enchantment with enchant .* loses all other abilities \.$/; // review of the whole-index G10: Old-Growth Troll (no "loses all other abilities") keeps its sentences

export function joinEdhN140ReturnAsAura<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    if (a !== undefined && FIRST.test(norms(p.tokens)) && SECOND.test(norms(a.tokens))) {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}
