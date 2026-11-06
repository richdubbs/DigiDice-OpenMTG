/**
 * edh-players-9 (Commander lane edh-players): quantities that count the players whose history of this turn holds an event, each player judged alone
 * (`happenedPlayers`, rules/history.ts#happenedPlayersOf; CR 102.3, 121.1, 120.2a, 120.8): "for each opponent who drew two or more cards this turn", "the number of
 * opponents that were dealt combat damage this turn", "for each opponent who had two or more lands enter the battlefield under their control this turn". The
 * pattern is written from the judged player's side ("you" of the pattern is that player). CR cites checked against MagicCompRules 20260925 except where marked.
 */
import type { EventPattern, PlayerRef, Quantity } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, phraseAt } from './core';

const W_NUMBER_OF = P('the number of');
const W_OPPONENT = P('opponent');
const W_OPPONENTS = P('opponents');
const W_PLAYER = P('player');
const W_PLAYERS = P('players');
const W_WHO = P('who');
const W_THAT = P('that');

/** "two or more", "three or more", ... (a count of one is "a card": not read, no card prints it for these counts). */
const NUMBERS: [string[], number][] = [['two', 2], ['three', 3], ['four', 4], ['five', 5]].map(([w, n]) => [P(`${w as string} or more`), n as number] as [string[], number]);

const W_CARDS_THIS_TURN = P('cards this turn');
const W_LANDS_ENTER = P('lands enter the battlefield under their control this turn');
const W_DEALT_COMBAT = P('dealt combat damage this turn');
const W_DEALT_DAMAGE = P('dealt damage this turn');

/**
 * The predicate after "who" / "that" for one player of the count: the pattern (from that player's side), the minimum count, and the end of the words.
 *  - plural `drew N or more cards this turn`, singular the same ("for each opponent who drew two or more cards this turn");
 *  - `had N or more lands enter the battlefield under their control this turn`;
 *  - plural `were dealt combat damage this turn` (or `were dealt damage this turn`), singular `was dealt ...`.
 */
function predicateAt(ctx: HoleCtx, pos: number, plural: boolean): { end: number; event: EventPattern; times?: { op: '>='; n: number }; countLeft?: true }[] {
  const out: { end: number; event: EventPattern; times?: { op: '>='; n: number }; countLeft?: true }[] = [];
  const drew = phraseAt(ctx, pos, P('drew'));
  if (drew >= 0) for (const [w, n] of NUMBERS) {
    const a = phraseAt(ctx, drew, w);
    const e = a < 0 ? -1 : phraseAt(ctx, a, W_CARDS_THIS_TURN);
    if (e >= 0) out.push({ end: e, event: { ev: 'draw', player: 'you' }, times: { op: '>=', n } });
  }
  const had = phraseAt(ctx, pos, P('had'));
  if (had >= 0) for (const [w, n] of NUMBERS) {
    const a = phraseAt(ctx, had, w);
    const e = a < 0 ? -1 : phraseAt(ctx, a, W_LANDS_ENTER);
    if (e >= 0) out.push({ end: e, event: { ev: 'zoneChange', to: 'battlefield', subject: { types: ['Land'], controller: 'you' } }, times: { op: '>=', n } });
  }
  const was = phraseAt(ctx, pos, P(plural ? 'were' : 'was'));
  const dealt = was < 0 ? -1 : phraseAt(ctx, was, W_DEALT_COMBAT);
  const dealtAny = was < 0 ? -1 : phraseAt(ctx, was, W_DEALT_DAMAGE);
  if (dealtAny >= 0) out.push({ end: dealtAny, event: { ev: 'damage', recipient: { player: 'you' } }, countLeft: true });
  if (dealt >= 0) out.push({ end: dealt, event: { ev: 'damage', combat: true, recipient: { player: 'you' } }, countLeft: true }); // Tymna's ruling: a player who left since still counts
  return out;
}

/**
 * "for each opponent who ..." (singular, after the words "for each" that a template wrote) and "the number of opponents that ..." (plural). Only the opponents
 * of the controller or every player; weak (design 6.3 rule 2): the fixed templates that read the players who lost life keep their sentences.
 */
export function edhp9QtyAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const forEach = ctx.toks[pos - 2]?.norm === 'for' && ctx.toks[pos - 1]?.norm === 'each';
  const nOf = phraseAt(ctx, pos, W_NUMBER_OF);
  const start = forEach ? pos : nOf;
  if (start < 0) return out;
  const groups: [string[], PlayerRef][] = forEach
    ? [[W_OPPONENT, { ref: 'each', who: 'opponent' }], [W_PLAYER, { ref: 'each', who: 'player' }]]
    : [[W_OPPONENTS, { ref: 'each', who: 'opponent' }], [W_PLAYERS, { ref: 'each', who: 'player' }]];
  for (const [noun, of] of groups) {
    const n = phraseAt(ctx, start, noun);
    if (n < 0) continue;
    for (const rel of [W_WHO, W_THAT]) {
      const r = phraseAt(ctx, n, rel);
      if (r < 0) continue;
      for (const p of predicateAt(ctx, r, !forEach)) {
        const value: Quantity = { q: 'happenedPlayers', of, event: p.event, scope: 'turn', ...(p.times !== undefined ? { times: p.times } : {}), ...(p.countLeft === true ? { countLeft: true as const } : {}) };
        out.push({ end: p.end, value, weak: 1 });
      }
    }
  }
  return out;
}
