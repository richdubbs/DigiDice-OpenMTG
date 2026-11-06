/**
 * edh-d-73 (lane face-down, concept round): the folds of its templates (parser/templates/zz-cloud/edh-d-73.json), called from render/fold.ts#foldAt. A new fold-*.ts never imports a
 * value from fold.ts.
 *
 * `millThenExileGraveyard` (CR 701.17a, 406.1, 404.1; Death in Heaven): "Target player mills two cards, then exiles their graveyard." A mill by a player, then a move of every card of
 * that same player's graveyard into exile: the player does both (exiling a graveyard changes nothing for the cards' owner, CR 406.1). Only that exact shape.
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { CLAUSES_CARDS } from './steps-cards';
import { faceDownSetWords } from './steps-edhmk12';
import { bind } from './steps-util';

function millThenExileGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'mill' || b?.op !== 'move' || a.guard !== undefined || b.guard !== undefined || b.until !== undefined || (b.link !== undefined && b.link !== 'exiled') || b.remember !== undefined || b.as !== undefined) return null;
  if (a.who.ref !== 'target' && !(a.who.ref === 'each' && a.who.who === 'opponent')) return null;
  // the cards of that player's graveyard (of the graveyards of every opponent, for "each opponent": the same cards as each opponent's own)
  if (b.what.ref !== 'each' || JSON.stringify(b.what.filter) !== JSON.stringify({ zone: 'graveyard', owner: a.who })) return null;
  if (JSON.stringify(b.to) !== JSON.stringify({ zone: 'exile' })) return null;
  const c = CLAUSES_CARDS.mill(a, st);
  if (c.actor === null || c.pred === undefined || c.standalone === true) return null;
  const text = `${c.sub}, then exiles their graveyard`;
  return { clauses: [acting(c.actor, text, text, { pred: `${c.pred}, then exiles their graveyard`, standalone: true })], consumed: 2 };
}

/**
 * `linkedPutAllFaceDown` (CR 607.2a, 708.3, 110.2a; Death in Heaven): "Put all creature cards exiled with ~ onto the battlefield face down under your control. They're 2/2 Cyberman artifact
 * creatures.": every card of one kind that the object's linked ability exiled, still in exile, enters face down under the controller's control (render/fold-edhzones9.ts#linkedPutAll
 * says the face-up move); the sentence of the set characteristics (`faceDownAs`) follows. Exactly the one `move` of template eff.edhd73.linked.putAll.bf.faceDown.
 */
function linkedPutAllFaceDown(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'move' || a.guard !== undefined || a.until !== undefined || a.link !== undefined || a.remember !== undefined || a.what.ref !== 'each' || !('filter' in a.what)) return null;
  const f = a.what.filter;
  const kinds = f.anyOf;
  if (JSON.stringify(f.is) !== '{"ref":"linked","link":"exiled"}' || f.zone !== 'any' || f.isCard !== true || kinds?.length !== 1 || Object.keys(f).some((k) => !['is', 'zone', 'isCard', 'anyOf'].includes(k))) return null;
  const { faceDownAs, ...to } = a.to;
  if (JSON.stringify(to) !== '{"zone":"battlefield","faceDown":true,"controller":{"ref":"you"}}') return null;
  const card = K.np(kinds[0]!, st, { det: 'none' });
  const self = K.obj({ ref: 'self' }, st, 'object').text;
  if (a.as !== undefined) bind(st, a.as, { nouns: [...K.nounsOf(kinds[0]!), 'card'], plural: true });
  const text = `put all ${card} cards exiled with ${self} onto the battlefield face down under your control`;
  const side = faceDownAs === undefined ? '' : `. they're ${faceDownSetWords(faceDownAs, true)}`;
  return { clauses: [acting('you', `${text}${side}`, `you ${text}${side}`, { standalone: side !== '' })], consumed: 1 };
}

export function foldEdhD73(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return millThenExileGraveyard(list, i, st) ?? linkedPutAllFaceDown(list, i, st);
}
