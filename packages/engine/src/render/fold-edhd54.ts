/**
 * edh-d-54 (lane d-rank-4): the folds of its templates (parser/templates/zz-cloud/edh-d-54.json), called from render/fold.ts#foldAt. A new fold-*.ts never imports a value from fold.ts.
 *
 * `putOpponentExiledToGraveyard` (CR 400.3, 404.1, 406.1, 608.2d; Ruin Processor): "put a card an opponent owns from exile into that player's graveyard": you choose one card of the
 * opponents' cards in exile, and it goes to its owner's graveyard. Only that exact shape: one chosen card of `{zone: exile, owner: opponent}`, moved to the graveyard of its own owner.
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';

function putOpponentExiledToGraveyard(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.as === undefined || a.random === true || a.guard !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  if (a.min !== 1 || a.max !== 1 || a.who.ref !== 'you') return null;
  if (b.guard !== undefined || b.until !== undefined || b.link !== undefined || b.remember !== undefined || JSON.stringify(b.what) !== JSON.stringify({ ref: 'bound', name: a.as })) return null;
  if (JSON.stringify(b.to) !== JSON.stringify({ zone: 'graveyard', owner: { ref: 'ownerOf', object: { ref: 'bound', name: a.as } } })) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from) || JSON.stringify(a.from.filter) !== JSON.stringify({ zone: 'exile', owner: 'opponent', faceDown: false })) return null;
  if (JSON.stringify(list.slice(i + 2)).includes(`"name":"${a.as}"`)) return null; // a later sentence reads the card: the parser's binding is not said
  return { clauses: [acting('you', "put a card an opponent owns from exile into that player's graveyard", "you put a card an opponent owns from exile into that player's graveyard")], consumed: 2 };
}

export function foldEdhD54(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return putOpponentExiledToGraveyard(list, i, st);
}
