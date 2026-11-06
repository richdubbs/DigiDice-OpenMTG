/**
 * edh-d-92: a sentence join, so that one template reads two sentences that make one instruction (as the joins of lower/ability.ts). Any other sentences are left as they are.
 *
 * `joinEdhD92` (CR 115.1, 702.62b, 122.1, 608.2d; Jhoira's Timebug, eff.edhd92.chooseTarget.permanentOrSuspended.mayRemoveOrPutTime): "Choose target permanent you control or suspended card
 * you own." and "If that permanent or card has a time counter on it, you may remove a time counter from it or put another time counter on it." are one instruction: the first sentence only
 * names the target that the second acts on ("that permanent or card" names both halves of the first one's target phrase).
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm).join(' ');

export function joinEdhD92<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const next = pieces[i + 1];
    if (next !== undefined && norms(p.tokens) === 'choose target permanent you control or suspended card you own .'
      && norms(next.tokens) === 'if that permanent or card has a time counter on it , you may remove a time counter from it or put another time counter on it .') {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens] });
      i++;
      continue;
    }
    // CR 406.1, 608.2c, 702.62a (The Parting of the Ways, eff.edhd92.exileTop.nonlandTimeCountersMv.gainsSuspend): "Exile the top five cards of your library.", "For each nonland card
    // exiled this way, put a number of time counters on that card equal to its mana value." and "If it doesn't have suspend, it gains suspend." are one instruction: the second and third
    // act on each card the first exiled ("it" is that card, the one of the "for each")
    const third = pieces[i + 2];
    if (next !== undefined && third !== undefined && /^exile the top \S+ cards of your library \.$/.test(norms(p.tokens))
      && norms(next.tokens) === 'for each nonland card exiled this way , put a number of time counters on that card equal to its mana value .'
      && norms(third.tokens) === "if it doesn't have suspend , it gains suspend .") {
      out.push({ ...p, tokens: [...p.tokens, ...next.tokens, ...third.tokens] });
      i += 2;
      continue;
    }
    out.push(p);
  }
  return out;
}
