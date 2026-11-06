/**
 * edh-c-80 (Commander lane edh-c, EDHREC ranks 21,001-21,500, third pass): the folds of its templates (parser/templates/zz-cloud/edh-c-80.json), called from
 * render/fold.ts#foldAtPlain.
 *
 * `returnHalfCreatures` (CR 400.3, 107.1a, 608.2d; Split the Party, eff.edhv80.return.half.up): the controller of the spell chooses half (rounded up) of the creatures a
 * player controls and returns them to their owners' hands: a `chooseObjects` of that many from the player's creatures and the one `move` of what it chose to the hand. Only that shape.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** The plural nouns of the permanent types (CR 110.4) the half-return says. */
const NOUNS: Readonly<Record<string, string>> = { Creature: 'creatures', Land: 'lands', Artifact: 'artifacts', Enchantment: 'enchantments', Planeswalker: 'planeswalkers' };

function returnHalfCreatures(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.guard !== undefined || b.guard !== undefined) return null;
  if (!same(a.who, { ref: 'you' }) || a.random !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined || a.link !== undefined || a.distinct !== undefined) return null;
  const from = a.from;
  if (from.ref !== 'each') return null;
  const f = from.filter as unknown as { types?: string[]; controller?: { ref?: string } } & Record<string, unknown>;
  const noun = f.types?.length === 1 ? NOUNS[f.types[0]!] : undefined;
  if (Object.keys(f).sort().join() !== 'controller,types' || noun === undefined || f.controller?.ref === undefined) return null;
  const half = { q: 'math', op: 'ceilDiv', args: [{ q: 'count', of: { ref: 'each', filter: from.filter } }, 2] };
  if (!same(a.min, half) || !same(a.max, half)) return null;
  if (!same(b.what, { ref: 'bound', name: a.as }) || !same(b.to, { zone: 'hand' }) || Object.keys(b).some((k) => !['op', 'what', 'to'].includes(k))) return null;
  // the player is the target announced in a sentence of its own ("Choose target player.", render/program.ts#chosenFirst): "they control" is that sentence's player (CR 608.2c)
  const ref = f.controller as { ref: string; id?: string };
  const chosenPlayer = ref.ref === 'target' && ref.id !== undefined && st.chosen?.key === `t:${ref.id}` && st.specs.get(ref.id)?.kind === 'player' && st.specs.get(ref.id)?.max === 1;
  const tail = ' to their owner\'s hand, rounded up';
  const text = chosenPlayer ? alt(`return half the ${noun} they control${tail}`, `return half the ${noun} that player controls${tail}`) : `return half the ${noun} ${K.player(f.controller as never, st, 'subject').text} controls${tail}`;
  return { clauses: [plain(text, { standalone: true })], consumed: 2 };
}

/**
 * `preventToAnyTargetFromSourceOfChoice` (CR 609.7a, 615.1a, 115.1, 611.2a; Shieldmage Advocate, eff.edhv80.prevent.toAnyTarget.bySourceOfYourChoice): the choice of a source as the
 * effect resolves and the prevention of all the damage it would deal to the one "any target" for the turn: the model's two steps of render/fold-p2rd1.ts, with the recipient the
 * target (a player or a permanent). Only that shape, the chosen source named nowhere else.
 */
function preventToAnyTargetFromSourceOfChoice(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const e = list[i + 1];
  if (c?.op !== 'chooseObjects' || c.who.ref !== 'you' || c.guard !== undefined || c.as === undefined || c.min !== 1 || c.max !== 1 || c.random !== undefined) return null;
  if (!same(c.from, { ref: 'each', filter: { zone: ['battlefield', 'stack'] } })) return null;
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || e.effects.length !== 1 || e.duration === undefined) return null;
  const r = e.effects[0]!;
  if (r.s !== 'replace' || r.condition !== undefined || r.optional !== undefined || r.selfReplacement !== undefined || r.shield !== undefined || !same(r.body, { b: 'prevent', amount: 'all' })) return null;
  const rep = r.replaces as { ev?: string; source?: unknown; recipient?: { player?: { ref?: string; id?: string }; object?: unknown } };
  const t = rep.recipient?.player;
  if (rep.ev !== 'damage' || !same(rep.source, { is: { ref: 'bound', name: c.as } }) || t?.ref !== 'target' || t.id === undefined) return null;
  if (!same(rep.recipient, { player: { ref: 'target', id: t.id }, object: { is: { ref: 'target', id: t.id } } }) || st.specs.get(t.id)?.kind !== 'anyTarget') return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":${JSON.stringify(c.as)}`))) return null;
  const dur = K.dur(e.duration, st);
  const to = K.obj({ ref: 'target', id: t.id }, st, 'object').text;
  return { clauses: [plain(`prevent all damage that would be dealt to ${to}${dur ? ` ${dur}` : ''} by a source of your choice`, { standalone: true })], consumed: 2 };
}

/**
 * `eachPlayerReturnsOwnExiledWith` (CR 607.2a, 400.3, 110.2a; Parallax Tide, eff.edhv80.eachPlayer.returnsTheirOwnExiledWith.battlefield): the one `move` of every card exiled with
 * the object (the link `exiled`) to the battlefield, each under its owner's control: "each player returns to the battlefield all cards they own exiled with it." Only that shape.
 */
function eachPlayerReturnsOwnExiledWith(list: EffectStep[], i: number): Folded | null {
  const m = list[i];
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (!same(m.what, { ref: 'each', filter: { is: { ref: 'linked', link: 'exiled' }, zone: 'any', isCard: true } }) || !same(m.to, { zone: 'battlefield', controller: 'owner' })) return null;
  return { clauses: [plain(alt('each player returns to the battlefield all cards they own exiled with ~', 'each player returns to the battlefield all cards they own exiled with it'), { standalone: true })], consumed: 1 };
}

export function foldEdhV80(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return returnHalfCreatures(list, i, st) ?? preventToAnyTargetFromSourceOfChoice(list, i, st) ?? eachPlayerReturnsOwnExiledWith(list, i);
}

const EXCEPT_ENCHANTED = { not: { anyOf: [{ types: ['Creature'], enchanted: true }, { allTypes: ['Creature', 'Enchantment'] }] } };

/**
 * `preventCombatExceptEnchanted` (CR 615.1, 510.2, 303.4b; Inspire Awe, eff.edhv80.prevent.combat.exceptEnchanted): the one prevention of all combat damage dealt by every source
 * except enchanted creatures and enchantment creatures, with its duration, said "Prevent all combat damage that would be dealt this turn except combat damage that would be dealt by
 * enchanted creatures and enchantment creatures." Only that shape (called from render/steps-lasting.ts#effect).
 */
export function preventCombatExceptEnchanted(s: { effects: readonly unknown[]; duration: unknown }, st: RenderState): Folded['clauses'][number] | null {
  if (s.effects.length !== 1) return null;
  const e = s.effects[0] as { s?: string; replaces?: unknown; body?: unknown } & Record<string, unknown>;
  if (e.s !== 'replace' || Object.keys(e).sort().join() !== 'body,replaces,s') return null;
  if (!same(e.replaces, { ev: 'damage', combat: true, source: EXCEPT_ENCHANTED }) || !same(e.body, { b: 'prevent', amount: 'all' })) return null;
  const dur = K.dur(s.duration as never, st);
  return plain(`prevent all combat damage that would be dealt ${dur} except combat damage that would be dealt by enchanted creatures and enchantment creatures`, { standalone: true });
}
