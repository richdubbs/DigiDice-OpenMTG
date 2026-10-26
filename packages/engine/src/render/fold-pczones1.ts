/**
 * pc-zones-1: the folds of its templates (parser/templates/zz-cloud/pc-zones-1.json), called from render/fold.ts#foldAt. CR cites from memory, unverified.
 *
 * `revealUntilPutAllHand` (CR 701.20a-b, 401.1, 608.2c): "Reveal cards from the top of your library until you reveal a nonland card, then put all cards revealed this way
 * into your hand." (Treasure Hunt): your reveal from the top of your library until you reveal one card of a description, then the move of every card revealed (the hit
 * included) into your hand. Only that exact body; a count other than one, another player or another destination is not this sentence.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { groupPool, restOfGroup } from './refs';
import type { RenderState } from './state';
import { destPhrase } from './steps-util';
import { alt, numWord } from './text';

const isBound = (ref: ObjRef, name: string | undefined): boolean => name !== undefined && ref.ref === 'bound' && ref.name === name;
const unread = (list: EffectStep[], from: number, ...names: (string | undefined)[]): boolean =>
  !list.slice(from).some((x) => names.some((n) => n !== undefined && JSON.stringify(x).includes(`"name":"${n}"`)));

function revealUntilPutAllHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const r = list[i];
  const m = list[i + 1];
  if (r?.op !== 'revealUntil' || m?.op !== 'move' || r.guard !== undefined || r.who.ref !== 'you' || r.revealed === undefined || r.count !== undefined || r.as === undefined) return null;
  if (m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (m.what.ref !== 'each' || JSON.stringify(m.what.filter) !== JSON.stringify({ is: { ref: 'bound', name: r.revealed }, zone: 'library' }) || JSON.stringify(m.to) !== '{"zone":"hand"}') return null;
  const what = K.np({ ...r.filter, zone: 'library' }, st, { det: 'a', noZone: true });
  return { clauses: [plain(`reveal cards from the top of your library until you reveal ${what}, then put all cards revealed this way into your hand`, { standalone: true })], consumed: 2 };
}

/**
 * `putUpToFromGroupAndRest` (CR 701.20e, 608.2c-d, 401.1): "Put up to three enchantment cards from among them into your hand and the rest of the revealed cards into your
 * graveyard." (Kruphix's Insight): your choice of up to N (two or more, no total limit: "you may put a ... card" of one card keeps fold.ts's older two-sentence reading) of the described cards of a group looked at or revealed, their move, and the move of
 * the rest of the group (parser/lower/mentions.ts#restOf), as one sentence. The rest is also said "the rest of the revealed cards" (family rest-of-the-revealed-cards).
 * Only that exact shape, with nothing reading the choice afterwards; fold.ts#putUpToTotalFromGroupAndRest is the same shape with a total limit.
 */
function putUpToFromGroupAndRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || c?.op !== 'move' || a.as === undefined || a.random === true || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  if (a.guard !== undefined || b.guard !== undefined || c.guard !== undefined || b.as !== undefined || c.as !== undefined || b.until !== undefined || c.until !== undefined) return null;
  if (a.startingWith !== undefined || a.eachCardType !== undefined || a.link !== undefined || b.link !== undefined || c.link !== undefined || b.remember !== undefined || c.remember !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 0 || typeof a.max !== 'number' || a.max < 2 || !isBound(b.what, a.as) || a.distinct !== undefined) return null;
  if (JSON.stringify(b.to) !== '{"zone":"hand"}' || JSON.stringify(c.to) !== '{"zone":"graveyard"}') return null; // only the hand and the graveyard: every other shape keeps its older reading
  const pool = groupPool(a.from);
  if (pool === null || pool.desc === null || c.what.ref !== 'each') return null;
  const rest = restOfGroup(c.what.filter);
  if (rest === null || rest.chosen !== a.as || rest.group !== (pool.group as { name: string }).name) return null;
  if (!unread(list, i + 3, a.as)) return null;
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  const np = K.np({ ...pool.desc, zone: 'library' }, st, { det: 'none', plural: true, noZone: true });
  const restText = K.obj(c.what, st, 'object').text;
  const revealed = st.info.get(`b:${(pool.group as { name: string }).name}`)?.revealedTop === true; // a reveal (not a look) made the group (std-ro)
  const restWords = revealed ? alt(restText, 'the rest of the revealed cards') : restText;
  const text = `put up to ${numWord(a.max)} ${np} from among ${them.text} ${destPhrase(b.to, st, true, true)} and ${restWords} ${destPhrase(c.to, st, true, true)}`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 3 };
}

/**
 * `revealUntilMayPutRestBottom` (CR 701.20a-b, 401.4, 608.2c; parser/lower/mentions.ts#revealedNotPutOf): "Reveal cards from the top of your library until you reveal a nonland
 * permanent card. You may put that card onto the battlefield. Then put all cards revealed this way that weren't put onto the battlefield on the bottom of your library in a
 * random order." (Genesis Storm): your reveal until one card of a description, your option to put that card onto the battlefield, and the move of every revealed card still
 * in the library (the card it stopped at included, when it was not put) to the bottom in a random order. Only that exact body.
 */
function revealUntilMayPutRestBottom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const r = list[i];
  const m = list[i + 1];
  const b = list[i + 2];
  if (r?.op !== 'revealUntil' || m?.op !== 'may' || b?.op !== 'move' || r.guard !== undefined || r.who.ref !== 'you' || r.revealed === undefined || r.count !== undefined || r.as === undefined) return null;
  if (Object.keys(m).some((k) => !['op', 'who', 'do', 'guard'].includes(k) && (m as unknown as Record<string, unknown>)[k] !== undefined)) return null;
  if (m.guard !== undefined || m.who.ref !== 'you' || m.do.length !== 1 || b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.link !== undefined || b.remember !== undefined) return null;
  const put = m.do[0]!;
  if (put.op !== 'move' || put.guard !== undefined || put.as !== undefined || put.until !== undefined || !isBound(put.what, r.as) || JSON.stringify(put.to) !== '{"zone":"battlefield","controller":{"ref":"you"}}') return null;
  if (b.what.ref !== 'each' || JSON.stringify(b.what.filter) !== JSON.stringify({ is: { ref: 'bound', name: r.revealed }, zone: 'library' })) return null;
  if (JSON.stringify(b.to) !== '{"zone":"library","position":"bottom","order":"random"}' || !unread(list, i + 3, r.as, r.revealed)) return null;
  const rest = "put all cards revealed this way that weren't put onto the battlefield on the bottom of your library in a random order";
  return {
    clauses: [K.clause(r, st), plain('you may put that card onto the battlefield', { standalone: true }), acting('you', rest, `you ${rest}`, { leadThen: true })],
    consumed: 3,
  };
}

export function foldPcZones1(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return revealUntilPutAllHand(list, i, st) ?? putUpToFromGroupAndRest(list, i, st) ?? revealUntilMayPutRestBottom(list, i, st);
}
