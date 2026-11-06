/**
 * edh-next-128 (must-finish round "dice, coins and random", EDHREC 5,001-10,000): the folds of its readings (parser/templates/zz-cloud/edh-next-128.json, parser/lower/ability.ts
 * #indicatedTableAbilities), called from render/fold.ts#foldAt. Each applies only when every part is exactly what the idiom says, with no guard, name or link on any step.
 *
 * `indicatedAbilities` (CR 706.2, 608.2c, 611.2a; Celebr-8000): the steps "if a die came up N, <object> gains <keyword> until end of turn" for N = 2, 3, ... in order, all for the same
 * object, are "For each other result, it gains the indicated ability until end of turn." with the table of results after the ability's other sentences ("• 2 -- menace" ...); a
 * doubles step right after them is said between the two, as Oracle prints it.
 * `doublesAlsoGains` (CR 706.2, 608.2c; eff.edhn128.ifRolledDoubles.alsoGains): "If you rolled doubles, it also gains double strike until end of turn." (the dice of the last roll came
 * up one number).
 * `flipUntilBothHeads` (Mana Clash): below.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { joinList, numWord } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
type Rec = Record<string, unknown>;
const keysOf = (o: object): string => Object.keys(o).filter((k) => (o as Rec)[k] !== undefined).sort().join(',');

/** A step "if <cond>, <object> gains <keywords> until end of turn" with nothing else: its condition, object and keyword words, else null. */
function grantIf(s: EffectStep | undefined): { cond: Rec; affects: ObjRef; words: string[] } | null {
  if (s?.op !== 'if' || s.guard !== undefined || s.else !== undefined || keysOf(s) !== 'cond,op,then' || s.then.length !== 1) return null;
  const e = s.then[0]!;
  if (e.op !== 'effect' || keysOf(e) !== 'duration,effects,op' || !same(e.duration, { d: 'endOfTurn' }) || e.effects.length !== 1) return null;
  const c = e.effects[0]!;
  if (c.s !== 'continuous' || keysOf(c) !== 'affects,mods,s' || c.mods.length !== 1 || !('ref' in c.affects)) return null;
  const m = c.mods[0] as unknown as Rec;
  if (keysOf(m) !== 'add,layer' || m['layer'] !== 6 || !Array.isArray(m['add']) || m['add'].length === 0) return null;
  const words: string[] = [];
  for (const a of m['add'] as Rec[]) {
    if (a['kind'] !== 'keyword' || typeof a['keyword'] !== 'string' || keysOf(a) !== 'keyword,kind,text' || a['text'] !== a['keyword']) return null;
    words.push(a['keyword']);
  }
  return { cond: s.cond as unknown as Rec, affects: c.affects as ObjRef, words };
}

/** The die number N of "a die of the last roll came up N" (`diceResults` match N at least 1), else null. */
function resultAtLeastOne(c: Rec): number | null {
  const l = c['left'] as Rec | undefined;
  return c['cond'] === 'compare' && keysOf(c) === 'cond,left,op,right' && c['op'] === '>=' && c['right'] === 1 && l?.['q'] === 'diceResults' && keysOf(l) === 'match,q' && typeof l['match'] === 'number' ? l['match'] : null;
}
const isDoubles = (c: Rec): boolean => same(c, { cond: 'compare', left: { q: 'diceResults', match: 'distinct' }, op: '==', right: 1 });

function doublesText(g: { affects: ObjRef; words: string[] }, st: RenderState): string {
  return `if you rolled doubles, ${K.obj(g.affects, st, 'subject').text} also gains ${joinList(g.words, 'and')} until end of turn`;
}

function indicatedAbilities(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const rows: { n: number; word: string }[] = [];
  let affects: ObjRef | undefined;
  let j = i;
  for (; j < list.length; j++) {
    const g = grantIf(list[j]);
    const n = g === null ? null : resultAtLeastOne(g.cond);
    if (g === null || n === null || n !== rows.length + 2 || g.words.length !== 1 || (affects !== undefined && !same(affects, g.affects))) break;
    affects = g.affects;
    rows.push({ n, word: g.words[0]! });
  }
  if (rows.length < 2 || affects === undefined) return null;
  let text = `for each other result, ${K.obj(affects, st, 'subject').text} gains the indicated ability until end of turn`;
  const d = grantIf(list[j]);
  let consumed = rows.length;
  if (d !== null && isDoubles(d.cond) && st.diceRolled === 2) {
    text += `. ${doublesText(d, st)}`;
    consumed++;
  }
  text += `.${rows.map((r) => ` • ${r.n} -- ${r.word}`).join('')}`;
  return { clauses: [plain(text, { standalone: true })], consumed };
}

function doublesAlsoGains(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const d = grantIf(list[i]);
  if (d === null || !isDoubles(d.cond) || st.diceRolled !== 2) return null; // review: only after a roll of two dice (one die is always "one number")
  return { clauses: [plain(doublesText(d, st), { standalone: true })], consumed: 1 };
}

/** The folds of edh-next-128 (render/fold.ts#foldAt). */
export function foldEdhN128(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return indicatedAbilities(list, i, st) ?? doublesAlsoGains(list, i, st) ?? flipUntilBothHeads(list, i, st) ?? chooseNumberFlipCapped(list, i) ?? scrambleControl(list, i);
}

/**
 * `flipUntilBothHeads` (CR 705.1, 608.2c, 120.2b; Mana Clash, eff.edhn128.youAndPlayerFlip.tailsDamage.untilBothHeads): "You and target opponent each flip a coin. ~ deals 1 damage to each
 * player whose coin comes up tails. Repeat this process until both players' coins come up heads on the same flip.": a repeat of two uncalled flips (you, then the other player) and the
 * three damage steps of the results (both tails: one damage event to both players, `also`), until both came up heads. Only that exact shape.
 */
function flipUntilBothHeads(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const r = list[i];
  if (r?.op !== 'repeat' || keysOf(r) !== 'do,op,times,until' || r.times !== 1 || r.do.length !== 5) return null;
  const [a, b, both, mine, theirs] = r.do as EffectStep[];
  if (a?.op !== 'flipCoin' || b?.op !== 'flipCoin' || keysOf(a) !== 'as,op,who' || keysOf(b) !== 'as,op,who' || !same(a.who, { ref: 'you' }) || a.as === b.as) return null;
  const h = (n: string, v: number): Rec => ({ cond: 'compare', left: { q: 'resultCount', step: n }, op: '==', right: v });
  const all = (x: number, y: number): Rec => ({ cond: 'all', of: [h(a.as!, x), h(b.as!, y)] });
  if (!same(r.until, all(1, 1))) return null;
  const dmg = (s: EffectStep | undefined, cond: Rec): EffectStep | null => {
    if (s?.op !== 'if' || keysOf(s) !== 'cond,op,then' || !same(s.cond, cond) || s.then.length !== 1) return null;
    const d = s.then[0]!;
    return d.op === 'damage' && (keysOf(d) === 'amount,op,source,to' || keysOf(d) === 'also,amount,op,source,to') && d.amount === 1 ? d : null;
  };
  const d0 = dmg(both, all(0, 0));
  const d1 = dmg(mine, all(0, 1));
  const d2 = dmg(theirs, all(1, 0));
  if (d0 === null || d1 === null || d2 === null || d0.op !== 'damage' || d1.op !== 'damage' || d2.op !== 'damage' || !same(d0.source, d1.source) || !same(d0.source, d2.source)) return null;
  if (d1.also !== undefined || d2.also !== undefined || !same(d1.to, { ref: 'you' }) || !same(d2.to, b.who) || !same(d0.to, { ref: 'you' }) || !same(d0.also, [{ to: b.who, amount: 1 }])) return null;
  const other = K.player(b.who, st, 'object').text;
  const src = K.obj(d0.source, st, 'subject').text;
  return { clauses: [plain(`you and ${other} each flip a coin. ${src} deals 1 damage to each player whose coin comes up tails. repeat this process until both players' coins come up heads on the same flip`, { standalone: true })], consumed: 1 };
}

/**
 * `chooseNumberFlipCapped` (CR 608.2d, 705.2, 608.2c; Squee's Revenge, eff.edhn128.chooseNumber.flipUntilLoseCapped.drawIfAllWon): "Choose a number. Flip a coin that many times or until
 * you lose a flip, whichever comes first. If you win all the flips, draw two cards for each flip.": the number (no range), the capped run of called flips, then the draw when every flip
 * was won (the flips won equal the number). Only those three steps.
 */
function chooseNumberFlipCapped(list: EffectStep[], i: number): Folded | null {
  const [c, f, d] = [list[i], list[i + 1], list[i + 2]];
  if (c?.op !== 'chooseValue' || keysOf(c) !== 'as,link,min,op,what,who' || c.what !== 'number' || c.min !== 0 || !same(c.who, { ref: 'you' }) || c.link === undefined) return null;
  const n = { q: 'chosenNumber', link: c.link };
  if (f?.op !== 'flipCoin' || keysOf(f) !== 'as,op,times,untilLose,who' || f.untilLose !== true || !same(f.times, n) || !same(f.who, { ref: 'you' })) return null;
  if (d?.op !== 'if' || keysOf(d) !== 'cond,op,then' || !same(d.cond, { cond: 'compare', left: { q: 'resultCount', step: f.as }, op: '==', right: n }) || d.then.length !== 1) return null;
  const dr = d.then[0]!;
  if (dr.op !== 'draw' || keysOf(dr) !== 'count,op,who' || !same(dr.who, { ref: 'you' })) return null;
  const k = dr.count as unknown as Rec;
  const args = k['args'] as unknown[] | undefined;
  if (k['q'] !== 'math' || k['op'] !== '*' || args?.length !== 2 || typeof args[0] !== 'number' || args[0] < 1 || !same(args[1], n)) return null;
  return { clauses: [plain(`choose a number. flip a coin that many times or until you lose a flip, whichever comes first. if you win all the flips, draw ${numWord(args[0])} card${args[0] === 1 ? '' : 's'} for each flip`, { standalone: true })], consumed: 3 };
}

/**
 * `scrambleControl` (CR 608.2d, 613.1b, 701.26b; Scrambleverse, eff.edhn128.eachNonland.randomPlayer.gainsControl.untap): "For each nonland permanent, choose a player at random. Then each
 * player gains control of each permanent for which they were chosen. Untap those permanents.": for each nonland permanent a random player, who gains control of it (for the rest of the
 * game), then every nonland permanent untaps. Only those two steps.
 */
function scrambleControl(list: EffectStep[], i: number): Folded | null {
  const [f, u] = [list[i], list[i + 1]];
  const nonland = { ref: 'each', filter: { notTypes: ['Land'] } };
  if (f?.op !== 'forEach' || keysOf(f) !== 'as,do,op,over' || !same(f.over, nonland) || f.do.length !== 2) return null;
  const [c, e] = f.do as EffectStep[];
  if (c?.op !== 'chooseValue' || keysOf(c) !== 'as,op,random,what,who' || c.what !== 'player' || c.random !== true || !same(c.who, { ref: 'you' })) return null;
  if (!same(e, { op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: { ref: 'bound', name: f.as }, mods: [{ layer: 2, controller: { ref: 'bound', name: c.as } }] }] })) return null;
  if (!same(u, { op: 'untap', what: nonland })) return null;
  return { clauses: [plain('for each nonland permanent, choose a player at random. then each player gains control of each permanent for which they were chosen. untap those permanents', { standalone: true })], consumed: 2 };
}
