/**
 * pc-combat-1 (Commander precon lane pc-combat): the fold of its template eff.pccombat1.attackersDoTheSame (parser/lower/same-for.ts), called from render/fold.ts#foldAt.
 *
 * `attackersDoTheSame` (CR 608.2c, 508.1a, 303.4; Curse of Opulence, Curse of Vitality): "Whenever enchanted player is attacked, you gain 2 life. Each opponent attacking
 * that player does the same." A draw, life gain or token creation of the controller, then the same step with the opponents who attacked enchanted player as the
 * performers (`eachWho`, ATTACKING_ENCHANTED_PLAYER): said as the first step and the sentence "each opponent attacking that player does the same". Only that exact pair.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

/** The opponents who attacked the player the source Aura is attached to (the parser's own constant, parser/lower/same-for.ts#ATTACKING_ENCHANTED_PLAYER; the import rules keep render from importing the parser, a test pins them equal). */
export const ATTACKING_ENCHANTED_PLAYER = { ref: 'eachWho', who: 'opponent', did: { ev: 'attacks', defender: { ref: 'enchantedPlayer' } }, scope: 'attacking' } as const;
const PERFORMED_BY_THE_PLAYER = ['draw', 'gainLife', 'createToken'];

function attackersDoTheSame(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a === undefined || b === undefined || !PERFORMED_BY_THE_PLAYER.includes(a.op)) return null;
  if (JSON.stringify((a as { who?: unknown }).who) !== '{"ref":"you"}') return null;
  if (JSON.stringify({ ...a, who: ATTACKING_ENCHANTED_PLAYER }) !== JSON.stringify(b)) return null;
  const first = K.steps([a], st);
  return { clauses: [plain(`${first}. each opponent attacking that player does the same`, { standalone: true })], consumed: 2 };
}

export function foldPcCombat1(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return attackersDoTheSame(list, i, st);
}
