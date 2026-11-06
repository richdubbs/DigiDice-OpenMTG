/**
 * edh-c-19 sentence joins (parser/lower/ability.ts#buildProgram): a rider sentence that only the sentences before it can use, joined so one template reads them.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');

/**
 * CR 107.3, 118.12 (Shanna, Purifying Blade): "You may pay {X}. If you do, draw X cards. X can't be greater than the amount of life you gained this turn." is one instruction:
 * the cap is a limit on the X the controller may pay, so the three sentences are joined and one template reads them (eff.edhv19.mayPay.x.draw.xCap). Any other sentences are
 * left as they are.
 */
export function joinEdhV19XCap<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    const b = pieces[i + 2];
    if (a !== undefined && b !== undefined && norms(p.tokens).startsWith('you may pay {x}') && norms(a.tokens).startsWith('if you do ,') && norms(b.tokens).startsWith("x can't be greater than ")) {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens, ...b.tokens] });
      i += 2;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * CR 701.20a, 608.2c (Goblin Guide): "Defending player reveals the top card of their library. If it's a land card, that player puts it into their hand." is one instruction: the
 * revealing player is the one who takes the card, so the two sentences are joined and one template reads them (eff.edhv19.player.revealTop.ifCard.putHand). Any other sentences are left as
 * they are.
 */
export function joinEdhV19RevealPut<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    if (a !== undefined && norms(p.tokens).endsWith('the top card of their library .') && /^if it's an? [a-z ]+ card , that player puts it into their hand \.$/.test(norms(a.tokens))) {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * CR 701.26a, 608.2c, 608.2h (Minas Tirith Garrison): "You may tap any number of untapped Humans you control. Draw a card for each Human tapped this way." is one instruction: the
 * cards drawn count the Humans the first sentence tapped, so the two sentences are joined and one template reads them (eff.edhv19.mayTapHumans.drawPerTapped). Any other sentences
 * are left as they are.
 */
export function joinEdhV19TapHumans<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    if (a !== undefined && norms(p.tokens) === 'you may tap any number of untapped humans you control .' && norms(a.tokens) === 'draw a card for each human tapped this way .') {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}
