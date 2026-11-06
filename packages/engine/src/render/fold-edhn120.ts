/**
 * Must-finish round edh-next-120 (hidden and simultaneous choices, player choices): the folds of the steps its templates build (render/fold.ts#foldAt tries `foldEdhN120` after the
 * other slices' own folds). A fold applies only when every part is exactly what the idiom says. This file imports no value from render/fold.ts (an import cycle); it takes the types only.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { cloneState, type RenderState } from './state';

const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const SECRET_NUMBER = { op: 'chooseValue', who: { ref: 'each', who: 'player' }, what: 'number', min: 0, secret: true, reveal: true, as: 'secretNumber', link: 'secretNumber' };
const HIGHEST_CHOOSERS = { ref: 'choseNumber', link: 'secretNumber', extreme: 'highest' };
const NOT_LOWEST_CHOOSERS = { ref: 'choseNumber', link: 'secretNumber', extreme: 'lowest', not: true };

/**
 * `secretNumbers` (CR 608.2d, 101.4; Wheel of Misfortune, template eff.edhn120.eachPlayer.secretlyChooses.number.reveal): "Each player secretly chooses a number 0 or greater, then all
 * players reveal those numbers simultaneously and determine the highest and lowest numbers revealed this way." Exactly that one choice.
 */
function secretNumbers(list: EffectStep[], i: number): Folded | null {
  const c = list[i];
  if (c?.op !== 'chooseValue' || !same(c, SECRET_NUMBER)) return null;
  return { clauses: [plain('each player secretly chooses a number 0 or greater, then all players reveal those numbers simultaneously and determine the highest and lowest numbers revealed this way', { standalone: true })], consumed: 1 };
}

/**
 * `damageHighestToChoosers` (CR 608.2d, 120.3; Wheel of Misfortune, template eff.edhn120.damage.highestNumber.toChoseIt): "~ deals damage equal to the highest number to each player who chose
 * that number." Only after the secret number choice of the same list.
 */
function damageHighestToChoosers(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const d = list[i];
  if (d?.op !== 'damage' || d.guard !== undefined || d.as !== undefined || !same(d.to, HIGHEST_CHOOSERS) || !same(d.amount, { q: 'chosenNumber', link: 'secretNumber', extreme: 'highest' })) return null;
  if (Object.keys(d).some((k) => !['op', 'source', 'to', 'amount'].includes(k))) return null;
  if (!list.slice(0, i).some((x) => same(x, SECRET_NUMBER))) return null;
  const src = K.obj(d.source, cloneState(st), 'subject').text;
  return { clauses: [plain(`${src} deals damage equal to the highest number to each player who chose that number`, { standalone: true })], consumed: 1 };
}

/**
 * `notLowestDiscardDraw` (CR 608.2d, 701.9a, 121.1; Wheel of Misfortune, template eff.edhn120.didntChooseLowest.discardHand.thenDraw): "Each player who didn't choose the lowest number discards
 * their hand, then draws seven cards." Only after the secret number choice of the same list.
 */
function notLowestDiscardDraw(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [d, r] = [list[i], list[i + 1]];
  if (d?.op !== 'discard' || r?.op !== 'draw' || d.guard !== undefined || r.guard !== undefined || !same(d, { op: 'discard', who: NOT_LOWEST_CHOOSERS, count: 'hand' })) return null;
  if (Object.keys(r).some((k) => !['op', 'who', 'count'].includes(k)) || !same(r.who, NOT_LOWEST_CHOOSERS)) return null;
  if (!list.slice(0, i).some((x) => same(x, SECRET_NUMBER))) return null;
  const n = K.qty(r.count, cloneState(st));
  return { clauses: [plain(`each player who didn't choose the lowest number discards their hand, then draws ${n} ${n === '1' || n === 'one' ? 'card' : 'cards'}`, { standalone: true })], consumed: 2 };
}

const EACH_OPPONENT = { ref: 'each', who: 'opponent' };

/** A choice word as printed: a word of the closed list (parser/holes/choicewords.ts), never free text. */
const isWord = (w: unknown): w is string => typeof w === 'string' && /^[a-z]+$/.test(w);

/**
 * `secretWords` (CR 608.2d, 101.4; Prisoner's Dilemma, template eff.edhn120.eachOpponent.secretlyChooses.words.reveal): "Each opponent secretly chooses silence or snitch, then the choices
 * are revealed." Exactly that one choice of two or three words.
 */
function secretWords(list: EffectStep[], i: number): Folded | null {
  const c = list[i];
  if (c?.op !== 'chooseValue' || !Array.isArray(c.options) || c.options.length < 2 || c.options.length > 3 || !c.options.every(isWord)) return null;
  if (!same(c, { op: 'chooseValue', who: EACH_OPPONENT, what: 'option', options: c.options, secret: true, reveal: true, as: 'secretOption', link: 'secretOption' })) return null;
  const o = c.options;
  const words = o.length === 2 ? `${o[0]} or ${o[1]}` : `${o[0]}, ${o[1]}, or ${o[2]}`;
  return { clauses: [plain(`each opponent secretly chooses ${words}, then the choices are revealed`, { standalone: true })], consumed: 1 };
}

/**
 * `allChoseOtherwise` (CR 608.2c, 608.2d, 120.3; Prisoner's Dilemma, template eff.edhn120.ifEachOpponentChose.damageEach.otherwise): "If each opponent chose silence, ~ deals 4 damage to each
 * of them. If each opponent chose snitch, ~ deals 8 damage to each of them. Otherwise, ~ deals 12 damage to each opponent who chose silence." Exactly that nesting, after the secret word choice.
 */
function allChoseOtherwise(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'if' || a.guard !== undefined || a.cond.cond !== 'allChose' || a.cond.link !== 'secretOption' || a.then.length !== 1 || a.else?.length !== 1 || Object.keys(a).length !== 4) return null;
  const b = a.else[0]!;
  if (b.op !== 'if' || b.guard !== undefined || b.cond.cond !== 'allChose' || b.cond.link !== 'secretOption' || b.then.length !== 1 || b.else?.length !== 1 || Object.keys(b).length !== 4) return null;
  const [x, y, z] = [a.then[0]!, b.then[0]!, b.else[0]!];
  const self = { ref: 'self' };
  const dmg = (d: EffectStep, to: unknown): d is Extract<EffectStep, { op: 'damage' }> => d.op === 'damage' && d.guard === undefined && same(d.source, self) && same(d.to, to) && Object.keys(d).every((k) => ['op', 'source', 'to', 'amount'].includes(k));
  if (z.op !== 'damage' || z.to.ref !== 'chose' || z.to.link !== 'secretOption') return null;
  const c = z.to.value;
  if (!dmg(x, EACH_OPPONENT) || !dmg(y, EACH_OPPONENT) || !dmg(z, { ref: 'chose', link: 'secretOption', value: c }) || !isWord(a.cond.equals) || !isWord(b.cond.equals) || !isWord(c)) return null;
  if (!list.slice(0, i).some((s) => s.op === 'chooseValue' && s.link === 'secretOption' && s.secret === true)) return null;
  const n = (d: Extract<EffectStep, { op: 'damage' }>): string => K.qty(d.amount, cloneState(st));
  return {
    clauses: [
      plain(`if each opponent chose ${a.cond.equals}, ~ deals ${n(x)} damage to each of them`, { standalone: true }),
      plain(`if each opponent chose ${b.cond.equals}, ~ deals ${n(y)} damage to each of them`, { standalone: true }),
      plain(`otherwise, ~ deals ${n(z)} damage to each opponent who chose ${c}`, { standalone: true }),
    ],
    consumed: 1,
  };
}

/**
 * `protectionFromEachPlayer` (CR 702.16k, 702.16b-c, 702.16e, 608.2c; Noble Heritage, template eff.edhn120.forEachPlayer.youGainProtectionFromThatPlayer): "For each opponent who does, you gain
 * protection from that player until your next turn.": for each player of the group, the three effects that are protection from that player for you: no spell or ability that player controls
 * targets you, no Aura that player controls enchants you, and all damage sources that player controls would deal to you is prevented. Exactly those three effects, of the iterated player.
 */
function protectionFromEachPlayer(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || f.as !== 'each' || f.do.length !== 1 || Object.keys(f).some((k) => !['op', 'over', 'as', 'do'].includes(k))) return null;
  const e = f.do[0]!;
  if (e.op !== 'effect' || e.guard !== undefined || e.as !== undefined || Object.keys(e).some((k) => !['op', 'duration', 'effects'].includes(k))) return null;
  const it = { ref: 'iterating' };
  const want = [
    { s: 'restrict', subject: { ref: 'you' }, mode: 'cant', action: 'beEnchanted', other: { controller: it } },
    { s: 'restrict', subject: { ref: 'you' }, mode: 'cant', action: 'beTargeted', other: { controller: it } },
    { s: 'replace', replaces: { ev: 'damage', source: { controller: it }, recipient: { player: 'you' } }, body: { b: 'prevent', amount: 'all' } },
  ];
  if (!same(e.effects, want)) return null;
  const who = K.player(f.over as never, cloneState(st), 'subject').text;
  if (!who.startsWith('each ')) return null;
  return { clauses: [plain(`for ${who}, you gain protection from that player ${K.dur(e.duration, cloneState(st))}`, { standalone: true })], consumed: 1 };
}

/**
 * `nextEndDrawIfDidntAttack` (CR 603.7a, 608.2c, 506.2, 508.1b; Faramir, Prince of Ithilien, template eff.edhn120.thatPlayersNextEnd.drawIfDidntAttackYou.otherwise): "At the beginning of that
 * player's next end step, you draw a card if they didn't attack you that turn. Otherwise, <effects>.": one delayed trigger at the next end step of the player (the one an earlier step
 * named), whose one instruction is the draw if that player declared no attack on you that turn, else the other effects. Exactly that shape.
 */
function nextEndDrawIfDidntAttack(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const d = list[i];
  if (d?.op !== 'delay' || d.guard !== undefined || d.do.length !== 1 || Object.keys(d).some((k) => !['op', 'when', 'do', 'capture'].includes(k))) return null;
  if (d.capture !== undefined && !same(d.capture, [(d.when as { whose?: { name?: string } }).whose?.name])) return null; // the chosen player kept for the delayed trigger (CR 603.7c)
  const w = d.when;
  if (w.at !== 'step' || w.step !== 'end' || w.next !== true || typeof w.whose !== 'object' || Object.keys(w).some((k) => !['at', 'step', 'whose', 'next'].includes(k))) return null;
  const f = d.do[0]!;
  if (f.op !== 'if' || f.guard !== undefined || f.else === undefined || f.else.length === 0 || Object.keys(f).some((k) => !['op', 'cond', 'then', 'else'].includes(k))) return null;
  if (!same(f.cond, { cond: 'not', of: { cond: 'happened', event: { ev: 'attacks', defender: 'you' }, scope: 'turn', by: w.whose } })) return null;
  if (!same(f.then, [{ op: 'draw', who: { ref: 'you' }, count: 1 }])) return null;
  const whose = K.player(w.whose, cloneState(st), 'possessive').text;
  const rest = K.steps(f.else, cloneState(st));
  return { clauses: [plain(`at the beginning of ${whose} next end step, you draw a card if they didn't attack you that turn`, { standalone: true }), plain(`otherwise, ${rest}`, { standalone: true })], consumed: 1 };
}

export function foldEdhN120(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return secretNumbers(list, i) ?? damageHighestToChoosers(list, i, st) ?? notLowestDiscardDraw(list, i, st) ?? secretWords(list, i) ?? allChoseOtherwise(list, i, st) ?? protectionFromEachPlayer(list, i, st) ?? nextEndDrawIfDidntAttack(list, i, st);
}
