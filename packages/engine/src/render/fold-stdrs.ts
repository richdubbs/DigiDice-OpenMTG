/**
 * std-rs (Standard round S, card wave 2 slice s3): the folds of its templates (parser/templates/zz-cloud/std-rs.json), tried after r5-fxz's (render/fold.ts#foldAt).
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import { anyTypeRider } from './stat';
import type { Folded } from './fold';
import { K } from './kernel';
import { alt } from './text';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * "You may look at and play those cards for as long as they remain exiled." (CR 406.3, 701.20e, 611.2a, 601.3, 305.1): you look at the cards (a card exiled face
 * down stays visible to you while it remains the same object in exile, CR 400.7; core/zones.ts#showCards), and you may play them for as long as they remain exiled.
 * Optionally the permission's `anyManaType` (CR 609.4b), ", and mana of any type can be spent to cast that spell" or the rider sentence "If you cast a spell
 * this way, you may spend mana as though it were mana of any type to cast it." (render/stat.ts#anyTypeRider). Exactly a `look` of yours at the objects, then that one lasting permission of yours for the same objects, nothing else.
 */
function lookAndPlay(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const look = list[i];
  const perm = list[i + 1];
  if (look?.op !== 'look' || look.guard !== undefined || look.as !== undefined || look.who.ref !== 'you' || Object.keys(look).length !== 3) return null;
  if (perm?.op !== 'effect' || perm.guard !== undefined || perm.as !== undefined || perm.effects.length !== 1 || !(same(perm.duration, { d: 'remainsExiled' }) || same(perm.duration, { d: 'endOfTurn' }))) return null; // edh-next-56 (Headliner Scarlett): "... and play that card this turn" too
  const e = perm.effects[0]!;
  if (e.s !== 'permit' || e.action !== 'play' || e.who.ref !== 'you' || !same(e.of, { is: look.at })) return null;
  if (Object.keys(e).some((k) => !['s', 'who', 'action', 'of', 'anyManaType', 'anyManaColor'].includes(k)) || (e.anyManaType !== undefined && e.anyManaType !== true) || (e.anyManaColor !== undefined && (e.anyManaColor !== true || e.anyManaType !== undefined))) return null;
  const them = K.obj(look.at, st, 'object');
  const base = `you may look at and play ${them.text} ${K.dur(perm.duration, st)}`;
  // edh-d-87 (CR 609.4b, 601.3; Predators' Hour; family look-and-play-any-color): with `anyManaColor`, ", and you may spend mana as though it were mana of any color to cast that spell"
  const anyColor = (b: string): string => `${b}, and you may spend mana as though it were mana of any color to cast ${them.plural ? alt('them', 'those spells') : alt('it', 'that spell')}`;
  const text = e.anyManaType === true ? anyTypeRider(base, them.plural) : e.anyManaColor === true ? anyColor(base) : base;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
}

/** The folds of std-rs. */
export function foldStdRs(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return lookAndPlay(list, i, st);
}
