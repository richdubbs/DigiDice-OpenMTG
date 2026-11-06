/**
 * edh-d-102 (CR 614.1a, 614.6, 121.1, 406.1, 607.2a, 601.3, 305.1, 400.7; Uba Mask): the two static abilities "If a player would draw a card, that player exiles that card face up instead." and
 * "Each player may play lands and cast spells from among cards they exiled with this artifact this turn.", each in its one exact form (a draw replacement whose one instruction exiles the
 * top card of the drawing player's library, that player recorded as the one who exiled it; a linked play permission of each player for the cards they exiled with ~ this turn). Null for
 * any other static ability.
 */
import type { StaticAbilityDef } from '../types/ability';

const canon = (v: unknown): string => JSON.stringify(v);

export function ubaMaskStatic(def: StaticAbilityDef): string | null {
  if (def.condition !== undefined || def.zone !== undefined || def.otherwise !== undefined || def.effects.length !== 1) return null;
  const e = def.effects[0]!;
  const ev = { ref: 'event', role: 'player' };
  if (e.s === 'replace') {
    const move = { op: 'move', what: { ref: 'topCards', player: ev, count: 1 }, to: { zone: 'exile' } };
    const ok = (m: unknown): boolean => canon(m) === canon(move) || canon(m) === canon({ ...move, link: 'exiled' });
    if (canon(e.replaces) !== canon({ ev: 'draw', player: 'any' }) || e.body.b !== 'instead' || e.body.do.length !== 1 || !ok(e.body.do[0]) || Object.keys(e).length !== 3) return null;
    return 'if a player would draw a card, that player exiles that card face up instead.';
  }
  if (e.s === 'permit') {
    if (canon(e) !== canon({ s: 'permit', who: { ref: 'each', who: 'player' }, action: 'play', of: { is: { ref: 'linked', link: 'exiled' }, putThereThisTurn: true }, ownOnly: true })) return null;
    return 'each player may play lands and cast spells from among cards they exiled with ~ this turn.';
  }
  return null;
}
