/**
 * std-rx31 (wave 2, Standard lane rx31): the folds of its templates (parser/templates/zz-cloud/std-rx31.json), called from render/fold.ts#foldAt.
 *
 * `putOneInsteadOfHand` (CR 608.2c, 614.15, 400.7): "Return up to two target creature cards from your graveyard to your hand. If this spell was bargained, you may put
 * one of those cards with mana value 4 or less onto the battlefield instead of putting it into your hand." The parser's rider rid.stdrx31.instead.putOneOfThose.battlefield
 * puts the new instructions BEFORE the return (parser/lower/riders.ts, `@before`): if C, you choose up to one of the targets still in the graveyard with that mana value
 * and put it onto the battlefield under your control; the return then moves only the others (the card put onto the battlefield is a new object, CR 400.7). Only that
 * exact shape: the `if` with no `else` holding the choice and the move of exactly the chosen card, then the move of exactly those targets to the hand.
 */
import type { EffectStep } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { groupPool } from './refs';
import type { RenderState } from './state';
import { bind, destPhrase } from './steps-util';
import { alt, joinList, numWord, withArticle } from './text';

function putOneInsteadOfHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'if' || a.else !== undefined || a.guard !== undefined || a.as !== undefined || a.then.length !== 2) return null;
  if (b?.op !== 'move' || b.guard !== undefined || b.as !== undefined || b.until !== undefined || JSON.stringify(b.to) !== JSON.stringify({ zone: 'hand' }) || b.what.ref !== 'target') return null;
  const [c, m] = a.then;
  if (c?.op !== 'chooseObjects' || c.who.ref !== 'you' || c.min !== 0 || c.max !== 1 || c.random === true || c.groupLimit !== undefined || c.perPlayer !== undefined || c.guard !== undefined) return null;
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.what.ref !== 'bound' || m.what.name !== c.as) return null;
  if (JSON.stringify(m.to) !== JSON.stringify({ zone: 'battlefield', controller: { ref: 'you' } })) return null;
  if (c.from.ref !== 'each' || !('filter' in c.from)) return null;
  const f = c.from.filter;
  const spec = st.specs.get(b.what.id);
  if (Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join(',') !== 'is,manaValue,zone' || JSON.stringify(f.is) !== JSON.stringify(b.what)) return null;
  if (spec === undefined || spec.filter?.zone === undefined || JSON.stringify(f.zone) !== JSON.stringify(spec.filter.zone) || f.manaValue?.op !== '<=' || spec.max === 1) return null;
  if (JSON.stringify(list.slice(i + 2)).includes(`"name":"${c.as}"`)) return null;
  const ret = K.steps([b], st);
  const n = typeof f.manaValue.value === 'number' ? String(f.manaValue.value) : K.qty(f.manaValue.value, st);
  const text = `${ret}. If ${K.cond(a.cond, st)}, you may put ${numWord(1)} of those cards with mana value ${n} or less onto the battlefield instead of putting it into your hand`;
  return { clauses: [plain(text, { standalone: true })], consumed: 2 };
}

/**
 * `revealOneFromGroup` (CR 701.20a, 608.2c-d): "You may reveal a creature card from among them." with nothing moved in that sentence (the parser's
 * eff.stdrx31.dig.reveal.fromAmong): your optional choice of at most one card of one description among a group looked at, then your reveal of exactly that card to
 * every player. Later sentences name it "that card", "it" and "the revealed card" ("If that card has mana value 2 or less, you may put it onto the battlefield ...
 * If you didn't put the revealed card onto the battlefield this way, put it into your hand.", Break Out). A move of the card right after is chooseFromGroup's.
 */
function revealOneFromGroup(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 0 || a.max !== 1 || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc === null) return null;
  const r = list[i + 1];
  if (r?.op !== 'reveal' || r.guard !== undefined || r.as !== undefined || r.who.ref !== 'you' || r.what.ref !== 'bound' || r.what.name !== a.as || (r.to !== undefined && r.to !== 'all')) return null;
  const m = list[i + 2];
  if (m?.op === 'move' && m.what.ref === 'bound' && m.what.name === a.as) return null;
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  const np = K.np({ ...pool.desc, zone: 'library' }, st, { det: 'a', noZone: true });
  bind(st, a.as, { nouns: ['card'], plural: false, zone: 'library', alts: ['the revealed card'] });
  const text = `you may reveal ${np} from among ${them.text}`;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
}

/**
 * `insteadRevealMore` (CR 614.15, 608.2c-d, 701.20a): "You may reveal a creature or land card from among them and put it into your hand. If you gained life this turn, you
 * may instead reveal two creature and/or land cards from among them and put them into your hand." (the parser's rider rid.stdrx31.instead.mayReveal.upTo.hand, an
 * "instead" fold of the whole sentence): if C, your choice of up to N cards of the description among the same group, revealed and put into your hand; otherwise the
 * choice of one. "You may ... two" lets you reveal fewer, as the choice of up to N does (none, one or two). Only that shape: the same group in both branches, each
 * branch a choice by you, the reveal of exactly the chosen cards, their move to your hand, under one name.
 */
function insteadRevealMore(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'if' || s.guard !== undefined || s.as !== undefined || s.else?.length !== 3 || s.then.length !== 3) return null;
  const shape = (b: EffectStep[]): { max: unknown; from: string } | null => {
    const [c, r, m] = b;
    if (c?.op !== 'chooseObjects' || c.who.ref !== 'you' || c.min !== 0 || c.random === true || c.groupLimit !== undefined || c.perPlayer !== undefined || c.guard !== undefined) return null;
    if (r?.op !== 'reveal' || r.guard !== undefined || r.as !== undefined || r.who.ref !== 'you' || r.what.ref !== 'bound' || r.what.name !== c.as || (r.to !== undefined && r.to !== 'all')) return null;
    if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.what.ref !== 'bound' || m.what.name !== c.as || JSON.stringify(m.to) !== JSON.stringify({ zone: 'hand' })) return null;
    return { max: c.max, from: JSON.stringify(groupPool(c.from)?.group ?? null) };
  };
  const one = shape(s.else);
  const more = shape(s.then);
  if (one === null || more === null || one.max !== 1 || typeof more.max !== 'number' || more.max < 2 || one.from !== more.from || one.from === 'null') return null;
  const c = s.then[0] as Extract<EffectStep, { op: 'chooseObjects' }>;
  const pool = groupPool(c.from);
  if (pool === null || pool.desc === null || (s.else[0] as Extract<EffectStep, { op: 'chooseObjects' }>).as !== c.as) return null;
  const first = K.steps(s.else, st);
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  const np = K.np({ ...pool.desc, zone: 'library' }, st, { det: 'none', plural: true, count: numWord(more.max), noZone: true });
  const text = `${first}. If ${K.cond(s.cond, st)}, you may instead reveal ${np} from among ${them.text} and put them into your hand`;
  return { clauses: [plain(text, { standalone: true })], consumed: 1 };
}

/**
 * `putOneOntoBattlefieldNamedLater` (CR 608.2c-d, 400.7): "You may put a Hero, Equipment, or Vehicle card from among them onto the battlefield. If it's a double-faced
 * card, you may transform it." (Nick Fury, Agent of S.H.I.E.L.D.): render/fold.ts#chooseFromGroup writes the choice and the move, but only while nothing after
 * them but "the rest" names the chosen card; here a later sentence names the permanent it became ("it", "that permanent"). Only your optional choice of at most
 * one card of one description among a group looked at, not revealed, then its move onto the battlefield under your control (unnamed).
 */
function putOneOntoBattlefieldNamedLater(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 0 || a.max !== 1 || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc === null) return null;
  const m = list[i + 1];
  if (m?.op !== 'move' || m.guard !== undefined || m.until !== undefined || m.as !== undefined || m.what.ref !== 'bound' || m.what.name !== a.as) return null;
  if (m.to.zone !== 'battlefield' || JSON.stringify(m.to.controller) !== JSON.stringify({ ref: 'you' })) return null;
  const later = JSON.stringify(list.slice(i + 2));
  if (!later.includes(`"name":"${a.as}"`)) return null; // chooseFromGroup's otherwise
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  const np = K.np({ ...pool.desc, zone: 'library' }, st, { det: 'a', noZone: true });
  const text = `you may put ${np} from among ${them.text} ${destPhrase(m.to, st, false, true)}`;
  bind(st, a.as, { nouns: [...new Set([...K.nounsOf(pool.desc), 'permanent'])], plural: false, zone: 'battlefield' });
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
}

/** What "it's a 3/3 Robot artifact creature with flying" says, of the lasting effect on the permanent a move named `as` (null for anything else). */
function asCreatureWords(e: EffectStep | undefined, as: string): string | null {
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || JSON.stringify(e.duration) !== JSON.stringify({ d: 'permanent' }) || e.effects.length !== 1) return null;
  const c = e.effects[0]!;
  // (the effect is on the permanent the move put onto the battlefield, a new object, CR 400.7: the name the move gives it)
  if (c.s !== 'continuous' || JSON.stringify(c.affects) !== JSON.stringify({ ref: 'bound', name: as }) || Object.keys(c).length !== 3 || c.mods.length !== 3) return null;
  const [l4, l6, l7] = c.mods as unknown as Record<string, unknown>[];
  if (l4?.['layer'] !== 4 || JSON.stringify(l4['types']) !== JSON.stringify({ set: ['Artifact', 'Creature'] }) || Object.keys(l4).length !== 3) return null;
  const subs = (l4['subtypes'] as { set?: unknown } | undefined)?.set;
  if (!Array.isArray(subs) || subs.length === 0 || !subs.every((x) => typeof x === 'string')) return null;
  if (l6?.['layer'] !== 6 || Object.keys(l6).length !== 2 || !Array.isArray(l6['add'])) return null;
  const kws = (l6['add'] as Record<string, unknown>[]);
  if (kws.length === 0 || !kws.every((k) => k['kind'] === 'keyword' && typeof k['text'] === 'string')) return null;
  if (l7?.['layer'] !== '7b' || typeof l7['power'] !== 'number' || typeof l7['toughness'] !== 'number' || Object.keys(l7).length !== 3) return null;
  const kind = `${String(l7['power'])}/${String(l7['toughness'])} ${(subs as string[]).join(' ')} artifact creature with ${joinList(kws.map((k) => String(k['text']).toLowerCase()), 'and')}`;
  return `${alt("it's", 'it is')} ${withArticle(kind)}`;
}

const TO_BF = JSON.stringify({ zone: 'battlefield', controller: { ref: 'you' } });
const plainMove = (m: EffectStep | undefined): m is Extract<EffectStep, { op: 'move' }> => m?.op === 'move' && m.guard === undefined && m.until === undefined && JSON.stringify(m.to) === TO_BF;

/**
 * `returnOrReturnAsCreature` (CR 608.2c, 205.1a, 611.2a, 613.1d, 613.1f, 613.4b): "Return it to the battlefield if it's an artifact creature card. Otherwise, return it to
 * the battlefield and it's a 3/3 Robot artifact creature with flying." (Brilliance Unleashed; the parser's eff.stdrx31.return.bf.ifCond, fl.otherwise and
 * eff.stdrx31.return.bf.andItsA.ptArtifactCreature): one `if` on what the object is, the same move of it onto the battlefield under your control in both branches, and
 * in the other branch a lasting effect on the permanent it became with no duration (CR 611.2a) that makes it an artifact creature of those subtypes (its other
 * types and creature subtypes are replaced, CR 205.1a), with those keywords and that base power and toughness. `returnAsCreature` is the second branch alone.
 * Only that shape, keyword abilities only.
 */
function returnOrReturnAsCreature(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'if' || s.guard !== undefined || s.as !== undefined || s.then.length !== 1 || s.else?.length !== 2 || s.cond.cond !== 'matches') return null;
  const [m1] = s.then;
  const [m2, e] = s.else;
  if (!plainMove(m1) || !plainMove(m2) || m2.as === undefined) return null;
  const what = JSON.stringify(m2.what);
  if (JSON.stringify(m1.what) !== what || JSON.stringify(s.cond.object) !== what || JSON.stringify(list.slice(i + 1)).includes(`"name":"${m2.as}"`)) return null;
  const its = asCreatureWords(e, m2.as);
  if (its === null) return null;
  const first = K.steps([m1], st);
  const cond = K.cond(s.cond, st);
  const second = K.steps([m2], st);
  return { clauses: [plain(`${first} if ${cond}. Otherwise, ${second} and ${its}`, { standalone: true })], consumed: 1 };
}

function returnAsCreature(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  if (!plainMove(m) || m.as === undefined || JSON.stringify(list.slice(i + 2)).includes(`"name":"${m.as}"`)) return null;
  const its = asCreatureWords(list[i + 1], m.as);
  if (its === null) return null;
  return { clauses: [plain(`${K.steps([m], st)} and ${its}`, { standalone: true })], consumed: 2 };
}

export function foldStdRx31(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return returnOrReturnAsCreature(list, i, st) ?? returnAsCreature(list, i, st) ?? putOneInsteadOfHand(list, i, st) ?? revealOneFromGroup(list, i, st) ?? insteadRevealMore(list, i, st) ?? putOneOntoBattlefieldNamedLater(list, i, st);
}
