/**
 * edh-d-33 (Commander lane name-hand, second pass): the folds of its templates (parser/templates/zz-cloud/edh-d-33.json), called from render/fold.ts#foldAt.
 *
 * `returnForEachRevealed` (CR 608.2d, 701.20a, 400.3; Rofellos's Gift, template eff.edhd33.return.eachN.graveyard.hand): "Return an enchantment card from your graveyard to your hand
 * for each card revealed this way." The choice of as many cards of a description as the number of cards an earlier reveal revealed (all of them when there are fewer) and their
 * return to the hand. Only the count of an earlier reveal named "revealed this way".
 */
import type { EffectStep, PlayerRef, StaticEffect } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function returnForEachRevealed(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.as === undefined || a.guard !== undefined || b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.link !== undefined) return null;
  if (a.random !== undefined || a.distinct !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined || a.link !== undefined) return null;
  if (!same(a.who, { ref: 'you' }) || typeof a.min !== 'object' || !same(a.min, a.max) || a.min.q !== 'resultCount' || Object.keys(a.min).length !== 2) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from) || !same(b.what, { ref: 'bound', name: a.as }) || !same(b.to, { zone: 'hand' })) return null;
  if (st.info.get(`r:${a.min.step}`)?.thisWay !== 'revealed this way') return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const what = K.np(a.from.filter, st, { det: 'a' });
  const text = `return ${what} to your hand for each card revealed this way`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/** The folds of edh-d-33 (render/fold.ts#foldAt). */
export function foldEdhD33(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return returnForEachRevealed(list, i, st);
}

/**
 * `playerCantAttackYouOnly` (CR 508.1b-c, 506.3, 611.2a; template eff.edhd33.player.cantAttackYou.dur; Champions of Minas Tirith): "they can't attack you this combat", a lasting `effect` of ONE
 * restriction on the creatures one player controls: a `cant` attackPlayer of you (the planeswalkers you control stay attackable: Oracle does not name them). The text of the player as the
 * subject, or null for any other shape. std-combat-1's `playerCantAttackYou` says the same with the planeswalkers.
 */
export function playerCantAttackYouOnly(effects: readonly StaticEffect[], duration: string, st: RenderState): string | null {
  const [a] = effects;
  if (effects.length !== 1 || a?.s !== 'restrict' || a.mode !== 'cant' || a.action !== 'attackPlayer' || Object.keys(a).some((k) => !['s', 'subject', 'mode', 'action', 'otherPlayer'].includes(k))) return null;
  if (JSON.stringify(a.otherPlayer) !== '{"ref":"you"}' || a.subject.ref !== 'each' || !('filter' in a.subject)) return null;
  const f = a.subject.filter;
  if (Object.keys(f).sort().join(',') !== 'controller,types' || JSON.stringify(f.types) !== '["Creature"]' || typeof f.controller !== 'object') return null;
  const p = K.player(f.controller as PlayerRef, st, 'subject');
  const who = p.they === true ? alt(p.text, 'they') : p.text;
  // edh-d-64 (Web of Inertia): "creatures they control can't attack you this turn" says the same ban with the creatures as the subject (template eff.edhd64.creaturesPlayerControls.cantAttackYou.dur)
  const creatures = p.they === true ? 'creatures they control' : `creatures ${p.text} controls`;
  const tail = ` can't attack you${duration === '' ? '' : ` ${duration}`}`;
  return alt(`${who}${tail}`, `${creatures}${tail}`);
}
