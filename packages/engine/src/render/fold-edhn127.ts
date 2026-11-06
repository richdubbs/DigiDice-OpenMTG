/**
 * edh-next-127 (must-finish round "dice, coins and random"): the folds of its templates (parser/templates/zz-cloud/edh-next-127.json), called from render/fold.ts#foldAt. Each applies
 * only when every part is exactly what the idiom says, with no guard, name, duration or link on any step it does not expect.
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * `youAndPlayersDrawThenDiscardRandom` (CR 121.1, 701.9a-b, 101.4, 608.2c; Zurzoth, Chaos Rider, eff.edhn127.youAnd.drawThenDiscardRandom): "you and those players each draw a card,
 * then discard a card at random": the controller and the other named player (or group) each draw the same fixed number of cards, then each discard the same fixed number at
 * random. Only those four steps in that order (draw you, draw them, discard you, discard them); nothing bound or guarded.
 */
function youAndPlayersDrawThenDiscardRandom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [d1, d2, x1, x2] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (d1?.op !== 'draw' || d2?.op !== 'draw' || x1?.op !== 'discard' || x2?.op !== 'discard') return null;
  if (d1.who.ref !== 'you' || x1.who.ref !== 'you' || d2.who.ref === 'you' || d2.who.ref === 'each' || !same(d2.who, x2.who)) return null;
  if (typeof d1.count !== 'number' || d1.count !== d2.count || typeof x1.count !== 'number' || x1.count !== x2.count) return null;
  if (x1.mode !== 'random' || x2.mode !== 'random' || x1.filter !== undefined || x2.filter !== undefined) return null;
  for (const s of [d1, d2, x1, x2]) if (s.guard !== undefined || s.as !== undefined || (s as { upTo?: unknown }).upTo !== undefined) return null;
  const other = K.player(d2.who, st, 'subject');
  const draw = K.clause(d1, st);
  const disc = K.clause(x1, st);
  if (!draw.imp.startsWith('draw ') || !disc.imp.startsWith('discard ') || !disc.imp.endsWith(' at random') || draw.standalone === true || disc.standalone === true) return null;
  const text = `you and ${other.text} each ${draw.imp}, then ${disc.imp}`;
  return { clauses: [acting('you', text, text)], consumed: 4 };
}

/**
 * `chooseLinkedAtRandomThenMayCastFree` (CR 607.2a, 608.2d, 608.2g, 118.9, 603.4; River Song's Diary, eff.edhn127.chooseOneOfThemAtRandom): "if there are four or more cards exiled with ~, choose
 * one of them at random. You may cast it without paying its mana cost.": one card of those the face's linked ability exiled is chosen at random (no player decides), then you may cast exactly
 * that card during the resolution, free. "them" is the group the intervening "if" counted (the parser reads the pronoun only there, holes/core.ts#Discourse.linkedCond). Only those two steps,
 * nothing guarded, and the chosen card named by nothing after them.
 */
function chooseLinkedAtRandomThenMayCastFree(list: EffectStep[], i: number): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'cast' || a.as === undefined || a.random !== true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.groupLimit !== undefined) return null;
  if (!same(a.from, { ref: 'linked', link: 'exiled' })) return null;
  if (!same(b, { op: 'cast', who: { ref: 'you' }, what: { ref: 'bound', name: a.as }, free: true, optional: true })) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":${JSON.stringify(a.as)}`))) return null;
  const text = 'choose one of them at random. you may cast it without paying its mana cost';
  return { clauses: [acting('you', text, text, { standalone: true })], consumed: 2 };
}

/** A random choice of exactly one card of `who`'s `zone` (nothing else in the filter), by you, bound under a name. */
function randomOneOf(x: EffectStep | undefined, zone: 'graveyard' | 'hand'): { as: string; owner: unknown } | null {
  if (x?.op !== 'chooseObjects' || x.random !== true || x.as === undefined || x.guard !== undefined || x.who.ref !== 'you' || x.min !== 1 || x.max !== 1 || x.groupLimit !== undefined) return null;
  const f = x.from.ref === 'each' && 'filter' in x.from ? (x.from.filter as Record<string, unknown>) : null;
  if (f === null || Object.keys(f).filter((k) => f[k] !== undefined).sort().join() !== 'isCard,owner,zone' || f['zone'] !== zone || f['isCard'] !== true) return null;
  return { as: x.as, owner: f['owner'] };
}

/**
 * `exilesTopRandomYardRandomHand` (CR 406.1, 401.1, 404.1, 402.1, 608.2c; Crabomination, eff.edhn127.exilesTopRandomGraveyardRandomHand): "target opponent exiles the top card of their library,
 * a card at random from their graveyard, and a card at random from their hand": one card of that player's graveyard and one of their hand chosen at random, then the top card of their library
 * and those two exiled together by one move. Only those three steps, the two choices of the same player's zones, the move of exactly them.
 */
function exilesTopRandomYardRandomHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const g = randomOneOf(list[i], 'graveyard');
  const h = randomOneOf(list[i + 1], 'hand');
  const m = list[i + 2];
  if (g === null || h === null || !same(g.owner, h.owner) || typeof g.owner !== 'object' || g.owner === null || (g.owner as { ref?: string }).ref === 'you') return null;
  if (m?.op !== 'move' || m.guard !== undefined || m.until !== undefined || m.link !== undefined || !same(m.to, { zone: 'exile' })) return null;
  if (!same(m.what, { ref: 'union', of: [{ ref: 'topCards', player: g.owner, count: 1 }, { ref: 'bound', name: g.as }, { ref: 'bound', name: h.as }] })) return null;
  const who = K.player(g.owner as Parameters<typeof K.player>[0], st, 'subject');
  if (who.person !== 'sg') return null;
  const text = `${who.text} exiles the top card of their library, a card at random from their graveyard, and a card at random from their hand`;
  return { clauses: [acting('x', text, text, { standalone: true })], consumed: 3 };
}

/**
 * `castASpellFromExiledFree` (CR 608.2g, 118.9, 305.9; Crabomination, eff.edhn127.castASpellFromAmong.free): "You may cast a spell from among cards exiled this way without paying its mana cost.": a
 * choice by you of up to one nonland card of the group an earlier move exiled (still in exile), then its free cast during the resolution. Only that shape.
 */
function castASpellFromExiledFree(list: EffectStep[], i: number): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 0 || a.max !== 1 || a.groupLimit !== undefined) return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? (a.from.filter as Record<string, unknown>) : null;
  if (f === null || Object.keys(f).filter((k) => f[k] !== undefined).sort().join() !== 'is,notTypes,zone' || f['zone'] !== 'exile' || !same(f['notTypes'], ['Land'])) return null;
  const is = f['is'] as { ref?: string; name?: string } | undefined;
  if (is?.ref !== 'bound' || typeof is.name !== 'string') return null;
  const exiler = list.slice(0, i).find((x) => x.op === 'move' && x.as === is.name && same(x.to, { zone: 'exile' }));
  if (exiler === undefined) return null;
  if (!same(b, { op: 'cast', who: { ref: 'you' }, what: { ref: 'bound', name: a.as }, free: true })) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":${JSON.stringify(a.as)}`))) return null;
  const text = 'you may cast a spell from among cards exiled this way without paying its mana cost';
  return { clauses: [acting('you', text, text, { standalone: true })], consumed: 2 };
}

/**
 * `mayChooseOneForNotChosen` (CR 608.2d, 608.2c; Thunderwave, eff.edhn127.mayChooseA): "You may choose a creature. Thunderwave deals 3 damage to each creature not chosen this way.": an optional choice by
 * you of at most one object of one description (no target), named afterwards ONLY as the group "not chosen this way" (none or one object, parser/lower/mentions.ts#chosenOneAsGroupOf). Only that
 * choice, and only when a later step excludes exactly it (`not: {is: <it>}`) and nothing else names it.
 */
function mayChooseOneForNotChosen(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 0 || a.max !== 1 || a.groupLimit !== undefined || a.link !== undefined || a.distinct !== undefined) return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? (a.from.filter as Record<string, unknown>) : null;
  if (f === null || Object.keys(f).filter((k) => f[k] !== undefined).join() !== 'anyOf' || !Array.isArray(f['anyOf']) || f['anyOf'].length !== 1) return null;
  const rest = JSON.stringify(list.slice(i + 1));
  const name = JSON.stringify(a.as);
  const excluded = `"not":{"is":{"ref":"bound","name":${name}}}`;
  if (!rest.includes(excluded) || rest.split(`"name":${name}`).length - 1 !== rest.split(excluded).length - 1) return null;
  const one = f['anyOf'][0] as Parameters<typeof K.np>[0];
  st.info.set(`b:${a.as}`, { nouns: K.nounsOf(one), plural: true, thisWay: 'chosen this way' });
  const text = `you may choose ${K.np(one, st, { det: 'a' })}`;
  return { clauses: [acting('you', text, text, { standalone: true })], consumed: 1 };
}

/**
 * `ifTwoExiledCopyRandomCastFree` (CR 608.2c, 608.2d, 707.12, 118.9; Mysterious Stranger, eff.edhn127.ifTwoOrMoreExiled.chooseRandomCopy + rid.r4copy.mayCastCopy.free): "If two or more cards are exiled
 * this way, choose one of them at random and copy it. You may cast the copy without paying its mana cost.": when the earlier move exiled two or more cards, one of those still in exile is chosen at random
 * (no player decides) and you may cast a copy of it, free. Only that one `if` with exactly those two steps, the group the one an earlier move of this list exiled.
 */
function ifTwoExiledCopyRandomCastFree(list: EffectStep[], i: number): Folded | null {
  const s = list[i];
  if (s?.op !== 'if' || s.else !== undefined || s.then.length !== 2) return null;
  const c = s.cond as { cond?: string; left?: { q?: string; of?: { ref?: string; name?: string } }; op?: string; right?: unknown };
  const group = c.left?.of;
  if (c.cond !== 'compare' || c.left?.q !== 'count' || group?.ref !== 'bound' || typeof group.name !== 'string' || c.op !== '>=' || c.right !== 2 || Object.keys(c.left).length !== 2) return null;
  if (!list.slice(0, i).some((x) => x.op === 'move' && x.as === group.name && same(x.to, { zone: 'exile' }))) return null;
  const [a, b] = s.then;
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.random !== true || a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.guard !== undefined || !same(a.from, { ref: 'each', filter: { is: { ref: 'bound', name: group.name }, zone: 'exile' } })) return null;
  if (!same(b, { op: 'cast', what: { ref: 'bound', name: a.as }, who: { ref: 'you' }, copyIn: 'exile', optional: true, free: true })) return null;
  if (list.slice(i + 1).some((x) => JSON.stringify(x).includes(`"name":${JSON.stringify(a.as)}`))) return null;
  const text = 'if two or more cards are exiled this way, choose one of them at random and copy it. you may cast the copy without paying its mana cost';
  return { clauses: [acting('you', text, text, { standalone: true })], consumed: 1 };
}

/** The folds of edh-next-127's templates (render/fold.ts#foldAt). */
export function foldEdhN127(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return youAndPlayersDrawThenDiscardRandom(list, i, st) ?? chooseLinkedAtRandomThenMayCastFree(list, i) ?? exilesTopRandomYardRandomHand(list, i, st) ?? castASpellFromExiledFree(list, i) ?? mayChooseOneForNotChosen(list, i, st) ?? ifTwoExiledCopyRandomCastFree(list, i);
}
