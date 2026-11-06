/**
 * edh-next-120 sentence joins (parser/lower/ability.ts#buildProgram): sentences that only read together, joined so one template reads them.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');

/**
 * CR 608.2c, 608.2d (Prisoner's Dilemma): "If each opponent chose silence, ~ deals 4 damage to each of them. If each opponent chose snitch, ~ deals 8 damage to each of them.
 * Otherwise, ~ deals 12 damage to each opponent who chose silence." is one instruction: "Otherwise" is neither of the two conditions before it, so the three sentences are joined and
 * one template reads them (eff.edhn120.ifEachOpponentChose.damageEach.otherwise). Any other sentences are left as they are.
 */
export function joinEdhN120AllChoseOtherwise<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  const lead = /^if each opponent chose [a-z]+ , ~ deals [0-9a-z]+ damage to each of them \.$/;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    const b = pieces[i + 2];
    if (a !== undefined && b !== undefined && lead.test(norms(p.tokens)) && lead.test(norms(a.tokens)) && /^otherwise , ~ deals [0-9a-z]+ damage to each opponent who chose [a-z]+ \.$/.test(norms(b.tokens))) {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens, ...b.tokens] });
      i += 2;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * CR 603.7a, 608.2c (Faramir, Prince of Ithilien): "At the beginning of that player's next end step, you draw a card if they didn't attack you that turn. Otherwise, create three 1/1 white
 * Human Soldier creature tokens." is one delayed triggered ability: the "Otherwise" is the other branch of the condition inside it, so the two sentences are joined and one template reads
 * them (eff.edhn120.thatPlayersNextEnd.drawIfDidntAttackYou.otherwise). Any other sentences are left as they are.
 */
export function joinEdhN120NextEndOtherwise<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    if (a !== undefined && norms(p.tokens) === "at the beginning of that player 's next end step , you draw a card if they didn't attack you that turn ." && norms(a.tokens).startsWith('otherwise , ')) {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens] });
      i += 1;
      continue;
    }
    out.push(p);
  }
  return out;
}
