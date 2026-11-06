/**
 * edh-next-40 (Commander EDHREC ranks 6,251-7,500, second pass): the folds of its templates, called from render/fold.ts#foldAt.
 *
 * `putHitRestOfOtherReveal` (CR 701.20a, 701.20b, 110.2a, 400.3, 404.1, 608.2c; Smeagol, Helpful Guide, Curse of Unbinding): after ANOTHER player's "reveals cards from the top of
 * their library until they reveal <a card>", you put that card onto the battlefield (tapped or not) under your control and the rest go into THEIR graveyard (a card goes to its
 * owner's graveyard, CR 404.1): "Put that card onto the battlefield tapped under your control and the rest into their graveyard." or, as two sentences, "Put that card onto
 * the battlefield under your control. That player puts the rest of the revealed cards into their graveyard." Only a move of the one bound card to the battlefield under your
 * control (tapped or not) and the move of the rest of that group to the graveyard, right after the other player's reveal (family reveal-hit-rest-their-graveyard).
 */
import type { EffectStep } from '../types/ability';
import { cloneState } from './state';
import type { RenderState } from './state';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { restOfGroup } from './refs';
import { alt } from './text';

function putHitRestOfOtherReveal(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const rv = list[i - 1];
  const a = list[i];
  const b = list[i + 1];
  if (rv?.op !== 'revealUntil' || rv.who.ref === 'you' || a?.op !== 'move' || b?.op !== 'move' || a.what.ref !== 'bound' || b.what.ref !== 'each') return null;
  if ([a, b].some((s) => s.guard !== undefined || s.as !== undefined || s.until !== undefined || s.link !== undefined || s.remember !== undefined)) return null;
  const tapped = a.to.tapped === true;
  if (JSON.stringify(a.to) !== JSON.stringify(tapped ? { zone: 'battlefield', controller: { ref: 'you' }, tapped: true } : { zone: 'battlefield', controller: { ref: 'you' } })) return null;
  if (JSON.stringify(b.to) !== JSON.stringify({ zone: 'graveyard' })) return null;
  const rest = restOfGroup(b.what.filter);
  if (rest === null || rest.chosen !== a.what.name || rv.as !== a.what.name) return null;
  const that = K.obj(a.what, st, 'object');
  const restText = K.obj(b.what, st, 'object').text;
  const lead = `put ${that.text} onto the battlefield${tapped ? ' tapped' : ''} under your control`;
  const one = `${lead} and ${restText} into their graveyard`;
  const who = K.player(rv.who, st, 'subject').text;
  const two = `${lead}. ${who} puts the rest of the revealed cards into their graveyard`;
  return { clauses: [acting('you', alt(one, two), alt(`you ${one}`, `you ${two}`), { standalone: true })], consumed: 2 };
}

/**
 * `transformAnyNumber` (CR 701.27a, 608.2d; Tovolar, Dire Overlord, eff.edhn40.transform.anyNumber): "Transform any number of Human Werewolves you control.": your choice of any
 * number (none included) of the permanents of a description, and the transform of exactly those. Only those two steps, the cards chosen read by nothing after them.
 */
function transformAnyNumber(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'changeFace' || a.as === undefined || a.guard !== undefined || b.guard !== undefined || a.min !== 0 || a.max !== 'any') return null;
  if (a.who.ref !== 'you' || a.from.ref !== 'each' || JSON.stringify(b.what) !== JSON.stringify({ ref: 'bound', name: a.as }) || b.to !== 'transform' || b.manifest !== undefined || b.faceDownAs !== undefined) return null;
  if (Object.keys(a).some((k) => !['op', 'who', 'from', 'min', 'max', 'as'].includes(k)) || Object.keys(b).some((k) => !['op', 'what', 'to'].includes(k))) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const text = `transform any number of ${K.np(a.from.filter, cloneState(st), { det: 'none', plural: true })}`;
  return { clauses: [acting('you', text, `you ${text}`, { standalone: true })], consumed: 2 };
}

/**
 * `playerPutsHitRestBottomAny` (CR 701.20a, 401.4, 110.2a, 400.3, 608.2c; Proteus Staff, eff.edhn40.thePlayer.putsThat.battlefield.rest.bottomAny): after ANOTHER player's "reveals cards from
 * the top of their library until they reveal <a card>", "The player puts that card onto the battlefield and the rest on the bottom of their library in any order.": the card goes
 * onto the battlefield under its owner's control (the library is its owner's: the player who revealed is the one who puts it, CR 110.2a) and the other revealed cards to the
 * bottom of that library in the order its owner chooses (CR 401.4). Only those two moves right after the other player's reveal; "they put" is the same words (family reveal-player-puts-hit).
 */
function playerPutsHitRestBottomAny(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const rv = list[i - 1];
  const a = list[i];
  const b = list[i + 1];
  if (rv?.op !== 'revealUntil' || rv.who.ref === 'you' || a?.op !== 'move' || b?.op !== 'move' || a.what.ref !== 'bound' || b.what.ref !== 'each') return null;
  if ([a, b].some((s) => s.guard !== undefined || s.as !== undefined || s.until !== undefined || s.link !== undefined || s.remember !== undefined)) return null;
  if (JSON.stringify(a.to) !== JSON.stringify({ zone: 'battlefield', controller: 'owner' }) || JSON.stringify(b.to) !== JSON.stringify({ zone: 'library', position: 'bottom', order: 'chosen' })) return null;
  const rest = restOfGroup(b.what.filter);
  if (rest === null || rest.chosen !== a.what.name || rv.as !== a.what.name) return null;
  const that = K.obj(a.what, st, 'object');
  const restText = K.obj(b.what, st, 'object').text;
  const text = `puts ${that.text} onto the battlefield and ${restText} on the bottom of their library in any order`;
  return { clauses: [acting('x', alt(`the player ${text}`, `they ${text.replace(/^puts/, 'put')}`), alt(`the player ${text}`, `they ${text.replace(/^puts/, 'put')}`), { standalone: true })], consumed: 2 };
}

export function foldEdhN40(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return putHitRestOfOtherReveal(list, i, st) ?? transformAnyNumber(list, i, st) ?? playerPutsHitRestBottomAny(list, i, st);
}
