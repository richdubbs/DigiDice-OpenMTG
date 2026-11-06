/**
 * edh-c-56 (coordinator C, EDHREC ranks 29,501-30,000, second pass): the folds of its templates (parser/templates/zz-cloud/edh-c-56.json), called from render/fold.ts#foldAt. Each
 * applies only when every part is exactly what the idiom says.
 *
 * `playerExilesAllFromGraveyard` (CR 406.1, 404.1, 608.2c; Mudhole, eff.edhv56.player.exiles.allTypeFromGraveyard): "Target player exiles all land cards from their graveyard.": the
 * cards of the description in that player's graveyard all go to exile (one move of each such card, nothing else on the step).
 *
 * `losesThenRevealsAtRandom` (CR 119.3, 701.20a, 608.2c; Hired Torturer, eff.edhv56.player.loses.thenRevealsAtRandom): "Target opponent loses 2 life, then reveals a card at random from
 * their hand.": the life loss, then the same player's random pick from their hand and the reveal of that card. Exactly those three steps.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function playerExilesAllFromGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || !same(m.to, { zone: 'exile' })) return null;
  if (Object.keys(m).sort().join(',') !== 'op,to,what' || m.what.ref !== 'each') return null;
  const f = m.what.filter as unknown as { anyOf?: Record<string, unknown>[]; zone?: unknown; owner?: unknown } & Record<string, unknown>;
  if (Object.keys(f).sort().join(',') !== 'anyOf,owner,zone' || f.zone !== 'graveyard' || f.anyOf === undefined || f.anyOf.length !== 1 || f.owner === undefined || typeof f.owner !== 'object') return null;
  const who = K.player(f.owner as never, st, 'subject');
  // only a card type alone ("land cards"): the description of a card in a graveyard says "from a graveyard" on its own
  const d = f.anyOf[0]!;
  if (Object.keys(d).join(',') !== 'types' || !Array.isArray(d['types']) || d['types'].length !== 1) return null;
  return { clauses: [plain(`${who.text} exiles all ${String(d['types'][0]).toLowerCase()} cards from their graveyard`)], consumed: 1 };
}

function losesThenRevealsAtRandom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [l, c, r] = [list[i], list[i + 1], list[i + 2]];
  if (l?.op !== 'loseLife' || c?.op !== 'chooseObjects' || r?.op !== 'reveal' || c.as !== 'picked' || r.as !== 'them') return null;
  if (l.guard !== undefined || c.guard !== undefined || r.guard !== undefined || Object.keys(l).sort().join(',') !== 'amount,op,who') return null;
  if (l.who.ref !== 'target') return null; // one chosen player: a group ("each opponent") would pool every hand in the one random pick
  if (!same(c.who, l.who) || !same(r.who, l.who) || c.random !== true || c.min !== 1 || c.max !== 1 || c.perPlayer !== undefined || c.groupLimit !== undefined || c.link !== undefined) return null;
  if (c.from.ref !== 'each' || !same(c.from.filter, { zone: 'hand', owner: l.who }) || !same(r.what, { ref: 'bound', name: 'picked' })) return null;
  const who = K.player(l.who as never, st, 'subject');
  const n = K.qty(l.amount as never, st);
  return { clauses: [plain(`${who.text} loses ${n} life, then reveals a card at random from their hand`)], consumed: 3 };
}

/**
 * `bounceAttachedAndSelf` (CR 400.3, 303.4, 608.2c; Disappear, eff.edhv56.attached.andSelf.bounce): "Return enchanted creature and this Aura to their owners' hands.": two moves to
 * hand, the creature this Aura is attached to and the Aura itself, nothing else on either step.
 */
function bounceAttachedAndSelf(list: EffectStep[], i: number): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  const plainMove = (m: EffectStep | undefined, ref: string): boolean => m?.op === 'move' && Object.keys(m).sort().join(',') === 'op,to,what' && same(m.what, { ref }) && same(m.to, { zone: 'hand' });
  if (!plainMove(a, 'attachedTo') || !plainMove(b, 'self')) return null;
  return { clauses: [plain("return enchanted creature and ~ to their owners' hands")], consumed: 2 };
}

/**
 * `destroyIfAnotherSameName` (CR 701.8a, 201.2, 608.2c; Winnow, eff.edhv56.destroy.ifAnotherSameName): "Destroy target nonland permanent if another permanent with the same name is on
 * the battlefield.": one destroy step whose guard is that some permanent other than the destroyed one has its name. Exactly that guard.
 */
function destroyIfAnotherSameName(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const d = list[i];
  if (d?.op !== 'destroy' || d.guard === undefined || Object.keys(d).sort().join(',') !== 'guard,op,what') return null;
  if (!same(d.guard, { cond: 'exists', atLeast: 1, of: { ref: 'each', filter: { zone: 'battlefield', not: { is: d.what }, sharesWith: { with: d.what, quality: 'name' } } } })) return null;
  return { clauses: [plain(`destroy ${K.obj(d.what as never, st, 'object').text} if another permanent with the same name is on the battlefield`)], consumed: 1 };
}

export function foldEdhV56(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return playerExilesAllFromGraveyard(list, i, st) ?? losesThenRevealsAtRandom(list, i, st) ?? bounceAttachedAndSelf(list, i) ?? destroyIfAnotherSameName(list, i, st);
}
