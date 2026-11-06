/**
 * edh-zones-12 (Commander lane edh-zones): the folds of its templates (parser/templates/zz-cloud/edh-zones-12.json), called from render/fold.ts#foldAt.
 *
 * `linkedPutOneOwnersGraveyard` (CR 607.2a, 608.2d, 400.3; Currency Converter): "Put a card exiled with ~ into its owner's graveyard.": you choose one of the cards the linked exile
 * instruction exiled and it goes to its owner's graveyard. Unlike the hand form of fold.ts#linkedReturnOne, later instructions may read the card ("If it's a land card, create a
 * Treasure token."): the card is "it" there (a card in a graveyard). Only that exact shape: one choice by you of exactly one card of the linked exile, the move of exactly that card
 * to a graveyard with no owner, position, order or other detail.
 *
 * `linkedReturnOthersGraveyard` (CR 607.2a, 109.2, 400.3; Mimic Vat): "return each other card exiled with ~ to its owner's graveyard." after "you may exile that card": every card
 * of the linked exile except the object the trigger's event is about (the card just exiled, whose event handle follows it into exile: effects/refs.ts#rebase), each to its
 * owner's graveyard. Only that exact shape: one move with no guard, name, duration or link of the cards of the linked exile that are not the event's subject.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';
import { bind } from './steps-util';
import { alt } from './text';

const LINKED_CARD = JSON.stringify({ is: { ref: 'linked', link: 'exiled' }, zone: 'any', isCard: true });

function linkedPutOneOwnersGraveyard(list: EffectStep[], i: number): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.groupLimit !== undefined) return null;
  if (b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.link !== undefined || b.remember !== undefined || b.what.ref !== 'bound' || b.what.name !== a.as) return null;
  if (a.from.ref !== 'each' || JSON.stringify(a.from.filter) !== LINKED_CARD || JSON.stringify(b.to) !== JSON.stringify({ zone: 'graveyard' })) return null;
  return { clauses: [plain(alt('put a card exiled with ~ into its owner\'s graveyard', 'put a card exiled with it into its owner\'s graveyard'))], consumed: 2 };
}

function linkedReturnOthersGraveyard(list: EffectStep[], i: number): Folded | null {
  const m = list[i];
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (m.what.ref !== 'each' || !('filter' in m.what)) return null;
  const want = { is: { ref: 'linked', link: 'exiled' }, zone: 'any', not: { is: { ref: 'event', role: 'subject' } } };
  if (JSON.stringify(m.what.filter) !== JSON.stringify(want) || JSON.stringify(m.to) !== JSON.stringify({ zone: 'graveyard' })) return null;
  return { clauses: [plain(`return each other card exiled with ${alt('~', 'it')} to its owner's graveyard`)], consumed: 1 };
}

/** The steps of `list` at `i` that one of this round's templates built, rendered as one clause; called by fold.ts#foldAt. */
export function foldEdhZones12(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const one = linkedPutOneOwnersGraveyard(list, i);
  if (one !== null) {
    const a = list[i];
    if (a?.op === 'chooseObjects') bind(st, a.as, { nouns: ['card'], plural: false, zone: 'graveyard' });
    return one;
  }
  return linkedReturnOthersGraveyard(list, i);
}
