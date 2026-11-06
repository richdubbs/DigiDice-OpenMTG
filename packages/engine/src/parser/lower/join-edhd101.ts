/**
 * edh-d-101 sentence join (parser/lower/ability.ts#buildProgram): "For each opponent, choose up to one target artifact or enchantment that player controls. For each permanent chosen
 * this way, its controller may exile it. Then if one or more of the chosen permanents are still on the battlefield, you search your library for up to that many land cards, put them
 * onto the battlefield tapped, then shuffle." (Disorienting Choice; CR 115.1, 601.2c, 608.2c, 101.4) is one instruction: the second sentence acts on the targets the first only
 * announced, and the third counts those of them that are still on the battlefield. The three sentences are joined, so one template reads them
 * (eff.edhd101.eachOpp.chooseTarget.controllerMayExile.searchRemaining). Joined only for exactly this shape, else the sentences stay as they are.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');
const FIRST = /^for each opponent , choose up to one target .+ that player controls \.$/;
const SECOND = 'for each permanent chosen this way , its controller may exile it .';
const THIRD = /^then if one or more of the chosen permanents are still on the battlefield , you search your library for up to that many .+ , put them onto the battlefield tapped , then shuffle \.?$/;

/**
 * edh-d-101 (CR 607.2a, 406.3, 714.2b; The Creation of Avacyn): a Saga's chapter "Turn the exiled card face up. If it's a creature card, you lose life equal to its mana value." and
 * "You may put the exiled card onto the battlefield if it's a creature card. If you don't put it onto the battlefield, put it into its owner's hand.": the second sentence of each tests
 * or moves the cards the first names (the cards exiled with the Saga, in any number: the rulings of 2024-06-07), so each pair is joined and one template reads it
 * (eff.edhd101.linked.*). Only these exact pairs (one card type word in the test).
 */
const PAIRS: readonly (readonly [RegExp, RegExp])[] = [
  [/^turn the exiled card face up \.$/, /^if it's an? \S+ card , you lose life equal to its mana value \.$/],
  [/^you may put the exiled card onto the battlefield if it's an? \S+ card \.$/, /^if you don't put it onto the battlefield , put it into its owner 's hand \.$/],
];

export function joinEdhD101<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    const b = pieces[i + 2];
    if (a !== undefined && PAIRS.some(([x, y]) => x.test(norms(p.tokens)) && y.test(norms(a.tokens)))) {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens] });
      i += 1;
      continue;
    }
    if (a !== undefined && b !== undefined && FIRST.test(norms(p.tokens)) && norms(a.tokens) === SECOND && THIRD.test(norms(b.tokens))) {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens, ...b.tokens] });
      i += 2;
      continue;
    }
    out.push(p);
  }
  return out;
}
