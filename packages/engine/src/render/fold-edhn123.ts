/**
 * edh-next-123 (CR 406.3, 611.2b, 601.3, 609.4b, 400.7; Arvinox, the Mind Flail): "For as long as those cards remain exiled, you may look at them, you may cast permanent
 * spells from among them, and you may spend mana as though it were mana of any color to cast those spells.": one resolved lasting effect (until none of the cards is in exile any
 * more) of two permissions of you for the same group an earlier instruction exiled: a `lookAt` for the group and a `cast` of its permanent cards (`onlyTypes`, the permanent types) with `anyManaColor`. Null for
 * any other shape (the general renderers then say it or refuse).
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { numWord } from './text';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt } from './text';

/** CR 110.4: the permanent card types that can be spells (a land is never cast, CR 305.9): a permanent spell is a spell of one of them. */
const PERMANENT_TYPES = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Planeswalker'];

type LastingStep = Extract<EffectStep, { op: 'effect' }>;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** Every key of the step that is set is one of `keys` (an extra field the words do not say makes the fold refuse). */
const onlyKeys = (x: object, keys: readonly string[]): boolean => Object.entries(x).every(([k, v]) => v === undefined || keys.includes(k));

export function lookCastPermanentsAnyColor(s: LastingStep, st: RenderState): string | null {
  if (s.effects.length !== 2 || !same(s.duration, { d: 'remainsExiled' }) || s.guard !== undefined) return null;
  const [look, cast] = s.effects;
  if (look?.s !== 'permit' || cast?.s !== 'permit') return null;
  if (look.action !== 'lookAt' || !same(look.who, { ref: 'you' }) || look.of?.is?.ref !== 'bound' || Object.keys(look).some((k) => !['s', 'who', 'action', 'of'].includes(k)) || Object.keys(look.of).length !== 1) return null;
  const group = look.of.is;
  if (!same(cast, { s: 'permit', who: { ref: 'you' }, action: 'cast', of: { is: group }, onlyTypes: PERMANENT_TYPES, anyManaColor: true })) return null;
  if (st.info.get(`b:${group.name}`)?.plural !== true) return null;
  const them = K.obj(group, st, 'object').text;
  return `for as long as ${alt('those cards', 'they')} remain exiled, you may look at ${them}, you may cast permanent spells from among ${alt('them', 'those cards')}, and you may spend mana as though it were mana of any color to cast those spells`;
}

/**
 * edh-next-123 (CR 701.55a, 701.55b, 101.4, 601.2, 118.9, 202.3; Ensnared by the Mara, eff.edhn123.villainous.exileUntilCastOrTopDamage): "Each opponent faces a villainous choice
 * -- They exile cards from the top of their library until they exile a nonland card, then you may cast that card without paying its mana cost, or that player exiles the top
 * four cards of their library and ~ deals damage equal to the total mana value of those exiled cards to that player.": a `forEach` over your opponents (in turn order, CR
 * 101.4: each one chooses and the chosen option is done before the next chooses, the 2023-10-13 ruling) of one villainous `may` of that opponent. Only that exact shape.
 */
function villainousExileUntilOrTop(list: EffectStep[], i: number): Folded | null {
  const fe = list[i];
  if (fe?.op !== 'forEach' || !onlyKeys(fe, ['op', 'over', 'as', 'do']) || !same(fe.over, { ref: 'each', who: 'opponent' }) || fe.do.length !== 1) return null;
  const each = { ref: 'bound', name: fe.as };
  const may = fe.do[0];
  if (may?.op !== 'may' || may.villainous !== true || !same(may.who, each) || may.guard !== undefined || may.as !== undefined || may.anyOne !== undefined || may.gather !== undefined) return null;
  const [until, cast] = may.do;
  if (may.do.length !== 2 || until?.op !== 'exileUntil' || cast?.op !== 'cast' || until.as === undefined) return null;
  if (!same(until, { op: 'exileUntil', who: each, filter: { notTypes: ['Land'] }, as: until.as })) return null;
  if (!same(cast, { op: 'cast', who: { ref: 'you' }, what: { ref: 'bound', name: until.as }, free: true, optional: true })) return null;
  const [move, dmg] = may.otherwise ?? [];
  if (may.otherwise?.length !== 2 || move?.op !== 'move' || dmg?.op !== 'damage' || move.as === undefined || move.what.ref !== 'topCards' || typeof move.what.count !== 'number') return null;
  const n = move.what.count;
  if (!same(move, { op: 'move', what: { ref: 'topCards', player: each, count: n }, to: { zone: 'exile' }, as: move.as })) return null;
  if (!same(dmg, { op: 'damage', source: { ref: 'self' }, to: each, amount: { q: 'stat', stat: 'manaValue', of: { ref: 'bound', name: move.as }, sum: true } })) return null;
  const text = `each opponent faces a villainous choice -- they exile cards from the top of their library until they exile a nonland card, then you may cast that card without paying its mana cost, or that player exiles the top ${numWord(n)} cards of their library and ~ deals damage equal to the total mana value of those exiled cards to that player`;
  return { clauses: [plain(text, { standalone: true })], consumed: 1 };
}

/**
 * edh-next-123 (CR 406.1, 607.2a, 608.2c, 608.2h, 400.7, 601.2, 118.9, 401.1; Possibility Storm, eff.edhn123.exileSpell.exileUntilSharesType.castFree.exiledBottom): "that player exiles it,
 * then exiles cards from the top of their library until they exile a card that shares a card type with it. That player may cast that card without paying its mana cost. Then they put
 * all cards exiled with ~ on the bottom of their library in a random order.": the cast trigger's spell exiled, the caster's exile-until of a card sharing a card type with that spell
 * (read as it last existed on the stack if it is gone, CR 608.2h; the 2013-04-15 ruling), the caster's optional free cast of the card it stopped at, and every card this resolution exiled
 * that is still in exile (the spell and the cards exiled until; a card cast is a new object, CR 400.7) put on the bottom of its owner's library in a random order (CR 400.3). These are
 * the cards "exiled with ~": the source exiles cards only this way, and each resolution puts all of its own back.
 * Only that exact shape (the four steps of the template), in a cast trigger.
 */
function stormExileUntilShared(list: EffectStep[], i: number): Folded | null {
  const SPELL = { ref: 'event', role: 'spell' };
  const CASTER = { ref: 'event', role: 'player' };
  const [mv, until, cast, back] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (mv?.op !== 'move' || mv.as === undefined || until?.op !== 'exileUntil' || until.as === undefined || until.exiled === undefined || back === undefined) return null;
  if (!same(mv, { op: 'move', what: SPELL, to: { zone: 'exile' }, as: mv.as })) return null;
  if (!same(until, { op: 'exileUntil', who: CASTER, filter: { sharesWith: { with: SPELL, quality: 'cardType' } }, as: until.as, exiled: until.exiled })) return null;
  if (!same(cast, { op: 'cast', who: CASTER, what: { ref: 'bound', name: until.as }, free: true, optional: true })) return null;
  const exiledThisWay = { ref: 'each', filter: { is: { ref: 'union', of: [{ ref: 'bound', name: mv.as }, { ref: 'bound', name: until.exiled }] }, zone: 'exile' } };
  if (!same(back, { op: 'move', what: exiledThisWay, to: { zone: 'library', position: 'bottom', order: 'random' } })) return null;
  const text = 'that player exiles it, then exiles cards from the top of their library until they exile a card that shares a card type with it. that player may cast that card without paying its mana cost. then they put all cards exiled with ~ on the bottom of their library in a random order';
  return { clauses: [plain(text, { standalone: true })], consumed: 4 };
}

/**
 * edh-next-123 (CR 601.2c, 115.1, 406.1, 122.1, 608.2c; Tasha, the Witch Queen): "For each opponent, exile up to one target instant or sorcery card from that player's graveyard and put a
 * page counter on it.": the move to exile of a per-opponent target (one target for each opponent, from that player's graveyard) bound by the move, then one counter of a kind on each card
 * that move exiled. "it" is each card (one per opponent), said once with the instruction. Only that shape: the move of one per-opponent target, then exactly one counter on what it moved.
 */
function perOpponentExileThenCounter(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [mv, pc] = [list[i], list[i + 1]];
  if (mv?.op !== 'move' || pc?.op !== 'putCounters' || mv.as === undefined || mv.what.ref !== 'target' || !onlyKeys(mv, ['op', 'what', 'to', 'as'])) return null;
  if (!same(mv.to, { zone: 'exile' }) || !same(pc, { op: 'putCounters', on: { ref: 'bound', name: mv.as }, kind: pc.kind, count: 1 }) || typeof pc.kind !== 'string') return null;
  const spec = st.specs.get(mv.what.id);
  if (spec === undefined || (spec as { perOpponent?: true }).perOpponent !== true) return null;
  if (spec.min !== 0 || spec.max !== 1 || spec.filter?.zone !== 'graveyard') return null;
  const target = K.obj(mv.what, st, 'object').text;
  return { clauses: [plain(`for each opponent, exile ${target} and put ${/^[aeiou]/.test(pc.kind) ? 'an' : 'a'} ${pc.kind} counter on it`, { standalone: true })], consumed: 2 };
}

/**
 * edh-next-123 (CR 115.1, 601.2c, 401.1, 400.3, 701.24a, 406.1, 608.2c, 608.2h, 101.4, 601.2, 118.9; Guff Rewrites History, eff.edhn123.ownersShuffle.exileUntilNonland.eachCastsFree):
 * "Those permanents' owners shuffle them into their libraries. Each player who controlled one of those permanents exiles cards from the top of their library until they exile a nonland
 * card, then puts the rest on the bottom of their library in a random order. Each player may cast the nonland card they exiled without paying its mana cost.": after the per-player
 * targets ("For each player, choose target ... that player controls."), the targets put into their owners' libraries and those owners shuffling; for each player who controlled one of
 * them (as they last existed, CR 608.2h) in turn order, an exile until a nonland card and the rest of the cards that exile exiled to the bottom in a random order; then, for each card it
 * stopped at, its owner's optional free cast. Only that exact shape, for one per-player target.
 */
function ownersShuffleExileUntilCast(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [mv, sh, loop, casts] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (mv?.op !== 'move' || mv.what.ref !== 'target' || loop?.op !== 'forEach' || casts?.op !== 'forEach' || loop.gather === undefined) return null;
  const T = mv.what;
  const spec = st.specs.get(T.id);
  if (spec === undefined || (spec as { perPlayer?: true }).perPlayer !== true || spec.min !== 1 || spec.max !== 1) return null;
  const owner = { ref: 'ownerOf', object: T };
  if (!same(mv, { op: 'move', what: T, to: { zone: 'library', owner } }) || !same(sh, { op: 'shuffle', who: owner })) return null;
  const P = { ref: 'bound', name: loop.as };
  const [until, rest] = loop.do;
  if (loop.do.length !== 2 || until?.op !== 'exileUntil' || until.exiled === undefined || until.as !== loop.gather || !same(loop.over, { ref: 'controllerOf', object: T }) || loop.guard !== undefined) return null;
  if (!same(until, { op: 'exileUntil', who: P, filter: { notTypes: ['Land'] }, as: loop.gather, exiled: until.exiled })) return null;
  if (!same(rest, { op: 'move', what: { ref: 'each', filter: { is: { ref: 'bound', name: until.exiled }, not: { is: { ref: 'bound', name: loop.gather } }, zone: 'exile' } }, to: { zone: 'library', position: 'bottom', order: 'random' } })) return null;
  const C = { ref: 'bound', name: casts.as };
  if (!same(casts, { op: 'forEach', over: { ref: 'bound', name: loop.gather }, as: casts.as, do: [{ op: 'cast', who: { ref: 'ownerOf', object: C }, what: C, free: true, optional: true }] })) return null;
  if (list.length !== i + 4) return null;
  // the lead "For each player, choose target ... that player controls." is said by the program (render/program.ts#chooseTargets) and names the targets, here "those permanents";
  // when it is not (the steps said alone), the lead is said here
  const lead = st.mentioned.has(`t:${T.id}`) ? '' : `for each player, choose ${K.obj(T, st, 'object').text}. `;
  if (lead === '') K.obj(T, st, 'object'); // (the reference is read, as every step that names the targets reads it)
  const text = `${lead}those permanents' owners shuffle them into their libraries. each player who controlled one of those permanents exiles cards from the top of their library until they exile a nonland card, then puts the rest on the bottom of their library in a random order. each player may cast the nonland card they exiled without paying its mana cost`;
  return { clauses: [plain(text, { standalone: true })], consumed: 4 };
}

/** The folds of this round's templates, called from render/fold.ts#foldAt. */
export function foldEdhN123(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return villainousExileUntilOrTop(list, i) ?? stormExileUntilShared(list, i) ?? perOpponentExileThenCounter(list, i, st) ?? ownersShuffleExileUntilCast(list, i, st);
}
