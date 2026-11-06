/**
 * edh-next-66 (Commander lane each-player): the folds of its templates (parser/templates/zz-cloud/edh-next-66.json), called from render/fold.ts#foldAt. Each applies only when
 * every part is exactly what the idiom says.
 *
 * `eachPlayerDiscardsHandThenReturnsUpTo` (CR 101.4, 608.2c, 608.2d, 701.9a, 400.3; Ill-Gotten Gains): "Each player discards their hand, then returns up to three cards from
 * their graveyard to their hand.": every player discards their whole hand, then each player in APNAP order chooses between none and that many cards in their own graveyard
 * (the discarded cards are there), then every card chosen is put into its owner's hand. Exactly the three steps of template eff.edhn66.eachPlayer.discardsHand.thenReturnsUpTo.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';
import { bind, countedNoun } from './steps-util';
import { numWord } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const ITERATING = { ref: 'iterating' };

function eachPlayerDiscardsHandThenReturnsUpTo(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const d = list[i];
  const a = list[i + 1];
  const b = list[i + 2];
  if (d?.op !== 'discard' || d.guard !== undefined || d.as !== undefined || d.mode !== undefined || d.filter !== undefined || d.cantAs !== undefined || d.count !== 'hand' || !same(d.who, { ref: 'each', who: 'player' })) return null;
  if (a?.op !== 'chooseObjects' || a.guard !== undefined || a.random !== undefined || a.groupLimit !== undefined || a.startingWith !== undefined || a.eachCardType !== undefined || a.link !== undefined) return null;
  if (a.min !== 0 || typeof a.max !== 'number' || a.max < 2 || a.as === undefined || a.distinct !== undefined || a.damageSource !== undefined) return null;
  if (!same(a.who, ITERATING) || !same(a.perPlayer, { ref: 'each', who: 'player' }) || a.from.ref !== 'each') return null;
  if (!same(a.from.filter, { zone: 'graveyard', owner: ITERATING, isCard: true })) return null;
  if (b?.op !== 'move' || b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.link !== undefined || !same(b.what, { ref: 'bound', name: a.as }) || !same(b.to, { zone: 'hand' })) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"${a.as}"`))) return null;
  bind(st, a.as, { nouns: ['card'], plural: true });
  return { clauses: [plain(`each player discards their hand, then returns up to ${numWord(a.max)} cards from their graveyard to their hand`)], consumed: 3 };
}

/**
 * `eachPlayerReturnsAllPutThereFromBattlefield` (CR 101.4, 400.3, 400.7, 110.2a, 608.2c; Second Sunrise): "Each player returns to the battlefield all artifact, creature,
 * enchantment, and land cards in their graveyard that were put there from the battlefield this turn.": every card of those types in any graveyard that went there from the
 * battlefield this turn is put onto the battlefield under its owner's control (each player returns their own). Exactly the one step of template
 * eff.edhn66.eachPlayer.returnsToBf.allInGraveyard.putThereFromBf. The card types are listed with "and" (the printed list), as one type alone is just that type.
 */
function eachPlayerReturnsAllPutThereFromBattlefield(list: EffectStep[], i: number): Folded | null {
  const m = list[i];
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.what.ref !== 'each' || !('filter' in m.what)) return null;
  if (!same(m.to, { zone: 'battlefield', controller: 'owner' })) return null;
  const f = m.what.filter;
  if (Object.keys(f).sort().join() !== 'anyOf,isCard,putThereFrom,putThereThisTurn,zone' || f.zone !== 'graveyard' || f.isCard !== true || f.putThereThisTurn !== true || f.putThereFrom !== 'battlefield') return null;
  if (f.anyOf?.length !== 1) return null;
  const only = f.anyOf[0]!;
  const types = only.types;
  if (types === undefined || types.length === 0 || Object.keys(only).join() !== 'types') return null;
  const names = types.map((t) => t.toLowerCase());
  const list2 = names.length === 1 ? names[0]! : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  return { clauses: [plain(`each player returns to the battlefield all ${list2} cards in their graveyard that were put there from the battlefield this turn`)], consumed: 1 };
}

/**
 * `eachPlayerShufflesPermanentsIntoLibrary` (CR 701.24a, 108.3, 400.3, 401.1, 101.4, 121.1; Sway of the Stars): every card of every hand and graveyard and every permanent goes into its
 * owner's library, THEN each player shuffles, THEN each player draws a fixed number of cards (all players move before any draws, so a replacement of an opponent's draw sees the
 * permanents already gone). Exactly the three steps of template eff.edhn66.eachPlayer.shuffles.handGraveyardPermanents.draw.
 */
function eachPlayerShufflesPermanentsIntoLibrary(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [m, s, d] = [list[i], list[i + 1], list[i + 2]];
  if (m?.op !== 'move' || s?.op !== 'shuffle' || d?.op !== 'draw') return null;
  if (m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || s.guard !== undefined || d.guard !== undefined || d.as !== undefined) return null;
  const everyone = { ref: 'each', who: 'player' };
  if (m.what.ref !== 'each' || !('filter' in m.what) || !same(m.what.filter, { zone: ['hand', 'graveyard', 'battlefield'] }) || !same(m.to, { zone: 'library' })) return null;
  if (!same(s.who, everyone) || !same(d.who, everyone) || typeof d.count !== 'number') return null;
  return { clauses: [plain(`each player shuffles their hand, graveyard, and all permanents they own into their library, then draws ${countedNoun(d.count, 'card', st)}`, { standalone: true })], consumed: 3 };
}

export function foldEdhN66(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachPlayerDiscardsHandThenReturnsUpTo(list, i, st) ?? eachPlayerReturnsAllPutThereFromBattlefield(list, i) ?? eachPlayerShufflesPermanentsIntoLibrary(list, i, st);
}
