/**
 * edh-next-121 (must-finish round "dice, coins and random"): the folds of its templates (parser/templates/zz-cloud/edh-next-121.json), called from render/fold.ts#foldAt. Each applies
 * only when every part is exactly what the idiom says, with no guard, name, duration or link on any step it does not expect.
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { rowLabel, rowSep } from './edhn55';
import { numWord } from './text';
import { bind } from './steps-util';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * `exileUntilThenShuffleRest` (CR 406.1, 401.1, 701.24a, 400.3, 608.2c; Wand of Wonder, eff.edhn121.eachExileUntil.shuffleRest): "Each opponent exiles cards from the top of their library
 * until they exile an instant or sorcery card, then shuffles the rest into their library.": the player (or each player) exiles until the card described, every other card that step
 * exiled and that is still in exile goes back to its owner's library, and the same player (each of them) shuffles. Only those three steps, in that order.
 */
function exileUntilThenShuffleRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [x, m, sh] = [list[i], list[i + 1], list[i + 2]];
  if (x?.op !== 'exileUntil' || x.guard !== undefined || x.total !== undefined || x.link !== undefined || x.as === undefined || x.exiled === undefined || x.who.ref === 'you') return null;
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || m.what.ref !== 'each' || !same(m.to, { zone: 'library' })) return null;
  const f = m.what.filter as Record<string, unknown>;
  if (Object.keys(f).filter((k) => f[k] !== undefined).sort().join(',') !== 'is,not,zone' || f['zone'] !== 'exile' || !same(f['is'], { ref: 'bound', name: x.exiled }) || !same(f['not'], { is: { ref: 'bound', name: x.as } })) return null;
  if (sh?.op !== 'shuffle' || sh.guard !== undefined || sh.as !== undefined || sh.ifSearched !== undefined || !same(sh.who, x.who)) return null;
  const first = K.clause(x, st);
  const text = `${first.sub}, then shuffles the rest into their library`;
  return { clauses: [acting('x', text, text, { standalone: true })], consumed: 3 };
}

/**
 * `rollThenRowsDefineX` (CR 706.3a, 107.3, 608.2h, 608.2c; Wand of Wonder, eff.edhn121.dieRow.xIs, parser/lower/die-roll.ts#defineXRows): "Roll a d20. <instructions that use X>.
 * 1-9 | X is one. 10-19 | X is two. 20 | X is three.": a roll of one d20 by you whose table rows each only fix X (`let X = N`), followed by the rest of the ability, which reads X; said
 * as Oracle prints it, the rows after those instructions. Only when the rest of the ability is every step after the roll, reads X exactly once, and nothing else sets X.
 */
function rollThenRowsDefineX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const r = list[i];
  if (r?.op !== 'rollDie' || r.guard !== undefined || r.as !== undefined || !same(r.who, { ref: 'you' }) || r.count !== undefined || r.modifier !== undefined || r.chooseOne !== undefined
    || r.keepHighest !== undefined || r.afterRoll !== undefined || r.highest !== undefined || r.table === undefined || r.table.length === 0) return null;
  const values: number[] = [];
  for (const row of r.table) {
    const only = row.do.length === 1 ? row.do[0] : undefined;
    if (row.again !== undefined || only?.op !== 'let' || only.name !== 'X' || typeof only.value !== 'number' || only.guard !== undefined) return null;
    values.push(only.value);
  }
  const rest = list.slice(i + 1);
  const restJson = JSON.stringify(rest);
  if (rest.length === 0 || restJson.split('{"q":"var","name":"X"}').length !== 2 || restJson.includes('"op":"let"')) return null;
  const roll = K.clause({ ...r, table: undefined } as EffectStep, st);
  st.vars.set('X', { phrase: 'x', used: false });
  const body = K.steps(rest, st);
  const rows = r.table.map((row, k) => `${rowLabel(row, k === 0, k === r.table!.length - 1)} ${rowSep(row)} x is ${numWord(values[k]!)}`).join('. ');
  const text = `${roll.imp}. ${body}. ${rows}`;
  return { clauses: [acting('you', text, text, { standalone: true })], consumed: list.length - i };
}

/**
 * `exileRandomFromEachOpponentsGraveyard` (CR 608.2d, 406.1, 101.4; Kefka, Dancing Mad, eff.edhn121.exile.randomFromEachOpponentGraveyard): "exile a card at random from each opponent's
 * graveyard": for each opponent in turn order, one card of their graveyard picked at random, then all of them exiled; afterwards they are "cards exiled this way" (several cards). Only
 * that exact shape.
 */
function exileRandomFromEachOpponentsGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, m] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.random !== true || a.guard !== undefined || !same(a.who, { ref: 'you' }) || a.min !== 1 || a.max !== 1 || !same(a.perPlayer, { ref: 'each', who: 'opponent' })) return null;
  if (a.groupLimit !== undefined || a.startingWith !== undefined || a.link !== undefined || a.distinct !== undefined || a.eachCardType !== undefined || a.damageSource !== undefined) return null;
  if (!same(a.from, { ref: 'each', filter: { zone: 'graveyard', isCard: true, owner: { ref: 'iterating' } } })) return null;
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || !same(m.what, { ref: 'bound', name: a.as }) || !same(m.to, { zone: 'exile' })) return null;
  bind(st, a.as, { nouns: ['card'], plural: true, zone: 'exile', thisWay: 'exiled this way' });
  const text = "exile a card at random from each opponent's graveyard";
  return { clauses: [acting('you', text, text, {})], consumed: 2 };
}

/**
 * `ownersOfCastSpellsLoseLife` (CR 608.2c, 119.3, 202.3, 108.3, 400.7h; Kefka, Dancing Mad, eff.edhn121.eachOwnerOfCastSpell.losesLife.manaValue): right after "you may cast any number of
 * spells from among <a group> without paying their mana costs" (a choice and its free cast, which keeps in the choice only the spells cast, `dropUncast`), "Then each player who owns
 * a spell you cast this way loses life equal to its mana value": for each spell cast this way, its owner loses life equal to its mana value. Only that shape.
 */
function ownersOfCastSpellsLoseLife(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, b, f] = [list[i - 2], list[i - 1], list[i]];
  if (f?.op !== 'forEach' || f.guard !== undefined || f.gather !== undefined || f.inDirection !== undefined || f.over.ref !== 'bound' || f.do.length !== 1) return null;
  if (c?.op !== 'chooseObjects' || c.as !== f.over.name || b?.op !== 'cast' || b.dropUncast !== true || b.free !== true || !same(b.what, { ref: 'bound', name: c.as })) return null;
  const spell = { ref: 'bound', name: f.as };
  const lose = f.do[0]!;
  if (lose.op !== 'loseLife' || lose.guard !== undefined || !same(lose.who, { ref: 'ownerOf', object: spell }) || !same(lose.amount, { q: 'stat', stat: 'manaValue', of: spell })) return null;
  const text = 'each player who owns a spell you cast this way loses life equal to its mana value';
  return { clauses: [acting('x', text, text, { standalone: true, leadThen: true })], consumed: 1 };
}

export function foldEdhN121(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return exileUntilThenShuffleRest(list, i, st) ?? rollThenRowsDefineX(list, i, st) ?? exileRandomFromEachOpponentsGraveyard(list, i, st) ?? ownersOfCastSpellsLoseLife(list, i, st);
}
