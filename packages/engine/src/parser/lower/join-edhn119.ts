/**
 * edh-next-119 sentence join (parser/lower/ability.ts#buildProgram): "You gain control of target opponent during that player's next turn. After that turn, that player takes an extra turn."
 * is one instruction (CR 723.1, 500.7; Emrakul, the Promised End): "that turn" is the controlled turn and "that player" the controlled player, so the two sentences are joined and one template
 * reads them (eff.edhn119.gainControlPlayer.nextTurn.thenExtraTurn). Joined only for a first sentence "you gain control of ... during that player's next turn." followed by exactly this second
 * sentence; any other sentences are left as they are.
 */
import type { Tok } from '../holes/tok';

const norms = (t: readonly Tok[]): string => t.map((x) => x.norm.toLowerCase()).join(' ');
const FIRST = /^you gain control of .+ during that player 's next turn \.$/;
const SECOND = 'after that turn , that player takes an extra turn .';

export function joinEdhN119ControlThenExtraTurn<P extends { tokens: Tok[] }>(pieces: readonly P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const a = pieces[i + 1];
    if (a !== undefined && FIRST.test(norms(p.tokens)) && norms(a.tokens) === SECOND) {
      out.push({ ...p, tokens: [...p.tokens, ...a.tokens] });
      i++;
      continue;
    }
    out.push(p);
  }
  return out;
}
