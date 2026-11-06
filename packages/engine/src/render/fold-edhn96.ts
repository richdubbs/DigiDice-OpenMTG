/**
 * edh-next-96 (top-rank round, second pass 4): the folds of its templates, called from render/fold.ts#foldAtPlain.
 *
 * `playerPutsRevealedGraveyard` (CR 701.20a, 701.20b, 404.1, 608.2c; Mind Funeral, Trepanation Blade; eff.edhn40.player.putsRest.theirGraveyard): after ANOTHER player's "reveals cards
 * from the top of their library until ...", "That player puts all cards revealed this way into their graveyard.": the move of every card that reveal revealed,
 * the cards it stopped at included, into the graveyard of the owner of that library (the player who revealed). Read at the move, whatever steps lie between it and the reveal (Trepanation
 * Blade counts the cards between). Only that move, in the library, with the reveal's own `revealed` name.
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { alt } from './text';
import type { RenderState } from './state';

function playerPutsRevealedGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (m.what.ref !== 'each' || JSON.stringify(m.to) !== JSON.stringify({ zone: 'graveyard' })) return null;
  const f = m.what.filter;
  if (JSON.stringify(f) !== JSON.stringify({ is: { ref: 'bound', name: (f.is as { name?: string } | undefined)?.name }, zone: 'library' }) || f.is?.ref !== 'bound') return null;
  const group = f.is.name;
  const rv = list.slice(0, i).find((s) => s.op === 'revealUntil' && s.revealed === group);
  if (rv?.op !== 'revealUntil' || rv.who.ref === 'you' || rv.who.ref === 'each' || rv.guard !== undefined) return null;
  // edh-d-87 (Trepanation Blade; family player-puts-the-revealed-cards): the player who revealed is also "that player" again, and the cards "the revealed cards"
  const who = alt(K.player(rv.who, st, 'subject').text, 'that player');
  const text = alt('puts all cards revealed this way into their graveyard', 'puts the revealed cards into their graveyard');
  return { clauses: [acting('x', `${who} ${text}`, `${who} ${text}`, { standalone: true })], consumed: 1 };
}

export function foldEdhN96(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return playerPutsRevealedGraveyard(list, i, st);
}
