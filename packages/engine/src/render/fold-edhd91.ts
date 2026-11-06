/**
 * edh-d-91 (Commander coordinator D, EDHREC ranks 5,001-10,000, group combat): the renderer parts of its templates (parser/templates/zz-cloud/edh-d-91.json). CR cites are from the
 * Comprehensive Rules text of 2026-09-25. Imports no value from render/fold.ts (an import cycle); render/fold.ts#foldAtPlain calls `foldEdhD91` after the other rounds' folds.
 *
 * `chooseReturnWithCounterSubtype` (CR 608.2d, 109.4, 122.6, 205.1b, 400.7, 611.2a; Drana, the Last Bloodchief; eff.edhd91.player.chooses.cardInYourGraveyard,
 * eff.edhd91.you.return.bf.additionalCounters, eff.t77.is.subtype.inaddition): "<player> chooses a <description> card in your graveyard. You return that card to the battlefield with an
 * additional <kind> counter on it. The creature is a <subtype> in addition to its other types.": another player's choice of one card of your graveyard, its return under your control
 * with counters, and the lasting type change of the permanent it became. Only these three exact steps on one bound name.
 *
 * `paySacrificeItSearchSameName` (CR 118.12, 608.2d, 701.21a, 701.23a, 201.2; Canoptek Wraith, eff.edhd91.mayPaySacrificeIt.chooseLand.searchSameName; parser/lower/join-edhd91.ts): "you may pay
 * <mana> and sacrifice it. If you do, choose a land you control. Then search your library for up to two basic land cards which have the same name as the chosen land, put them onto the
 * battlefield tapped, then shuffle.": one optional payment of mana and the source itself, and the instructions done only if it is paid. Only this exact step.
 *
 * `castArtifactFromGroupAffinity` (CR 601.3, 601.2f, 702.41a, 611.2a; Chiss-Goria, Forge Tyrant, eff.edhd91.mayCastArtifactFromGroup.thisTurn.hasAffinity): "you may cast an artifact spell from
 * among <group> this turn. If you do, it has affinity for artifacts.": a one-spell cast permission of artifact spells from a group until end of turn whose spell has affinity for artifacts
 * (PermissionDef.spellKeyword). Only this exact step.
 *
 * `mayReturnOneOfGroup` (CR 608.2c, 608.2d, 400.3; Zurgo and Ojutai, eff.edhd91.may.returnOneOfGroup.ownersHand): "you may return one of those <creatures> to its owner's hand": an option of
 * yours to choose one object of a group an earlier part named (not a target) and put it into its owner's hand. Only this exact step.
 *
 * `revealFourAndOrFromGroup` (CR 701.20a, 701.20e, 608.2c-d; Harper Recruiter, eff.edhd91.dig.mayReveal.fourAndOr.hand): "You may reveal a Cleric card, a Rogue card, a Warrior card, and/or a
 * Wizard card from among them and put those cards into your hand.": up to one card of each of four descriptions (a card that fits two is only one of the choices), revealed together and put
 * into your hand, as edh-b-1's three (render/fold.ts#revealThreeAndOrFromGroup); "the rest" of the group follows. Exactly the six steps of the template.
 *
 * `returnTargetIfManaValueAtMost` (CR 608.2c, 603.4-like resolution check, 202.3; Vulpine Harvester, eff.stdrx31.return.bf.ifCond): "return target <card> to the battlefield if its mana value is less
 * than or equal to <quantity>": the move of the one target whose guard compares that same target's mana value with an amount read as the ability resolves. Only this exact step.
 *
 * `payExileItBatToken` (CR 118.12, 607.2a, 613.1f, 111.1; Timothar, Baron of Bats, eff.edhd91.mayPayExileIt.batToken.gainsReturnQuote, parser/holes/edhd91.ts): "you may pay <mana> and exile it. If you
 * do, create <token>. It gains "When this token deals combat damage to a player, sacrifice it and return the exiled card to the battlefield tapped."": one payment, made only while the card that
 * died is still in its graveyard to be exiled, then the exile, the token and its granted ability (whose "the exiled card" is the card exiled here). Only this exact step.
 */
import type { EffectStep, ObjectFilter, ObjRef } from '../types/ability';
import { acting, plain } from './clause';
import { groupPool, restOfGroup } from './refs';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const onlyKeys = (e: object, keys: string[]): boolean => Object.keys(e).every((k) => keys.includes(k));


const article = (w: string): string => (/^[aeiou]/i.test(w) ? 'an' : 'a');

function chooseReturnWithCounterSubtype(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || c?.op !== 'effect' || a.as === undefined) return null;
  if (!onlyKeys(a, ['op', 'who', 'from', 'min', 'max', 'as']) || a.min !== 1 || a.max !== 1 || a.from.ref !== 'each') return null;
  const { isCard, owner, zone, ...rest } = a.from.filter as Record<string, unknown>;
  if (isCard !== true || owner !== 'you' || zone !== 'graveyard' || Object.keys(rest).length === 0) return null;
  const bound = { ref: 'bound', name: a.as };
  if (!onlyKeys(b, ['op', 'what', 'to']) || !same(b.what, bound)) return null;
  const to = b.to as unknown as Record<string, unknown>; // (edh-d-86 merge: the cast the typecheck asks for)
  const counters = to['counters'] as { kind: string; count: unknown }[] | undefined;
  if (!onlyKeys(to, ['zone', 'controller', 'counters']) || to['zone'] !== 'battlefield' || !same(to['controller'], { ref: 'you' }) || counters?.length !== 1 || typeof counters[0]!.count !== 'number') return null;
  if (!onlyKeys(c, ['op', 'duration', 'effects']) || !same(c.duration, { d: 'permanent' }) || c.effects.length !== 1) return null;
  const e = c.effects[0] as unknown as Record<string, unknown>;
  const mods = e['mods'] as Record<string, unknown>[] | undefined;
  if (!onlyKeys(e, ['s', 'affects', 'mods']) || e['s'] !== 'continuous' || !same(e['affects'], bound) || mods?.length !== 1 || !onlyKeys(mods[0]!, ['layer', 'subtypes']) || mods[0]!['layer'] !== 4) return null;
  const sub = mods[0]!['subtypes'] as Record<string, unknown>;
  const added = sub['add'] as string[] | undefined;
  if (!onlyKeys(sub, ['add']) || added?.length !== 1) return null;
  const who = a.who.ref === 'defending' ? 'defending player' : K.player(a.who, st, 'subject').text;
  const desc = K.np(rest as never, st, { det: 'a' });
  K.clause(a, st);
  K.clause(b, st);
  K.clause(c, st);
  const n = counters[0]!.count as number;
  const kind = counters[0]!.kind;
  const withCounters = n === 1 ? `an additional ${kind} counter` : `${K.qty(n, st)} additional ${kind} counters`;
  const text = `${who} chooses ${desc} card in your graveyard. you return that card to the battlefield with ${withCounters} on it. the creature is ${article(added[0]!)} ${added[0]!} in addition to its other types`;
  return { clauses: [plain(text, { standalone: true })], consumed: 3 };
}

function paySacrificeItSearchSameName(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const p = list[i];
  if (p?.op !== 'pay' || !onlyKeys(p, ['op', 'who', 'cost', 'then']) || !same(p.who, { ref: 'you' }) || p.then === undefined) return null;
  const cost = p.cost as unknown as Record<string, unknown>;
  if (!onlyKeys(cost, ['mana', 'other']) || !Array.isArray(cost['mana']) || (cost['mana'] as unknown[]).length === 0) return null;
  if (!same(cost['other'], [{ kind: 'sacrifice', filter: { self: true }, count: 1, self: true }])) return null;
  const then = [
    { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { types: ['Land'], controller: 'you' } }, min: 1, max: 1, as: 'chosen' },
    { op: 'search', who: { ref: 'you' }, zone: 'library', filter: { supertypes: ['Basic'], types: ['Land'], sharesWith: { with: { ref: 'bound', name: 'chosen' }, quality: 'name' } }, min: 0, max: 2, as: 'search' },
    { op: 'move', what: { ref: 'bound', name: 'search' }, to: { zone: 'battlefield', controller: { ref: 'you' }, tapped: true } },
    { op: 'shuffle', who: { ref: 'you' } },
  ];
  if (!same(p.then, then)) return null;
  const mana = K.cost({ mana: cost['mana'] } as never, st);
  return { clauses: [plain(`you may pay ${mana} and sacrifice it. if you do, choose a land you control. then search your library for up to two basic land cards which have the same name as the chosen land, put them onto the battlefield tapped, then shuffle`, { standalone: true })], consumed: 1 };
}

function castArtifactFromGroupAffinity(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const e = list[i];
  if (e?.op !== 'effect' || !onlyKeys(e, ['op', 'duration', 'effects']) || !same(e.duration, { d: 'endOfTurn' }) || e.effects.length !== 1) return null;
  const p = e.effects[0] as unknown as Record<string, unknown>;
  const of = p['of'] as Record<string, unknown> | undefined;
  if (!onlyKeys(p, ['s', 'who', 'action', 'of', 'onlyTypes', 'single', 'spellKeyword']) || p['s'] !== 'permit' || p['action'] !== 'cast' || !same(p['who'], { ref: 'you' }) || p['single'] !== true) return null;
  if (of === undefined || !onlyKeys(of, ['is']) || !same(p['onlyTypes'], ['Artifact']) || !same(p['spellKeyword'], { kind: 'keyword', keyword: 'affinity', text: 'Affinity for artifacts', filter: { types: ['Artifact'] } })) return null;
  const group = K.obj(of['is'] as never, st, 'object').text;
  return { clauses: [plain(`you may cast an artifact spell from among ${group} this turn. if you do, it has affinity for artifacts`, { standalone: true })], consumed: 1 };
}

function mayReturnOneOfGroup(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  if (m?.op !== 'may' || !onlyKeys(m, ['op', 'who', 'do']) || !same(m.who, { ref: 'you' }) || m.do.length !== 2) return null;
  const [c, mv] = m.do as [EffectStep, EffectStep];
  if (c.op !== 'chooseObjects' || mv.op !== 'move' || c.as === undefined || !onlyKeys(c, ['op', 'who', 'from', 'min', 'max', 'as']) || !same(c.who, { ref: 'you' }) || c.min !== 1 || c.max !== 1) return null;
  if (c.from.ref !== 'each' || !onlyKeys(c.from.filter, ['is']) || c.from.filter.is === undefined) return null;
  if (!onlyKeys(mv, ['op', 'what', 'to']) || !same(mv.what, { ref: 'bound', name: c.as }) || !same(mv.to, { zone: 'hand' })) return null;
  // the group is the objects of one "one or more <creatures> ... deal combat damage" trigger's event, said "those <creatures>" (the nouns of its description; the parser's rule names it so)
  const on = st.trigger ?? [];
  const ev = on.length === 1 ? (on[0] as unknown as Record<string, unknown>) : undefined;
  if (!same(c.from.filter.is, { ref: 'event', role: 'source' }) || ev === undefined || ev['ev'] !== 'damage' || ev['combat'] !== true || ev['source'] === undefined) return null;
  const src = ev['source'] as Record<string, unknown>;
  const { controller: _c, ...desc } = src;
  if (Object.keys(desc).length === 0) return null;
  const nouns = K.np(desc as never, st, { det: 'none', plural: true, noController: true });
  return { clauses: [plain(`you may return one of those ${nouns} to its owner's hand`, { standalone: true })], consumed: 1 };
}

const isBound = (ref: ObjRef, name: string | undefined): boolean => name !== undefined && ref.ref === 'bound' && ref.name === name;

function revealFourAndOrFromGroup(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const cs = list.slice(i, i + 4);
  const [r, m] = [list[i + 4], list[i + 5]];
  if (cs.length !== 4 || r?.op !== 'reveal' || m?.op !== 'move') return null;
  const choices: Extract<EffectStep, { op: 'chooseObjects' }>[] = [];
  for (const x of cs) {
    if (x.op !== 'chooseObjects' || x.as === undefined || x.who.ref !== 'you' || x.min !== 0 || x.max !== 1 || x.random === true || x.guard !== undefined || x.from.ref !== 'each') return null;
    choices.push(x);
  }
  if (r.who.ref !== 'you' || r.guard !== undefined || r.to !== undefined || m.guard !== undefined || m.as !== undefined || m.until !== undefined || !same(m.to, { zone: 'hand' })) return null;
  const names = choices.map((x) => x.as);
  const descs: ObjectFilter[] = [];
  let group: ObjRef | undefined;
  for (let k = 0; k < 4; k++) {
    const from = choices[k]!.from as Extract<ObjRef, { ref: 'each' }>;
    const { not, ...rest } = from.filter;
    if (k === 0 ? not !== undefined : !(not !== undefined && onlyKeys(not, ['is']) && not.is !== undefined)) return null;
    if (k > 0) {
      const is = not!.is!;
      const parts = is.ref === 'union' ? is.of : [is];
      if (parts.length !== k || !parts.every((p, j) => isBound(p, names[j]))) return null;
    }
    const pool = groupPool({ ref: 'each', filter: rest });
    if (pool === null || pool.desc === null || (group !== undefined && !same(pool.group, group))) return null;
    group = pool.group;
    descs.push(pool.desc);
  }
  const union = (x: ObjRef): boolean => x.ref === 'union' && x.of.length === 4 && x.of.every((p, j) => isBound(p, names[j]));
  if (!union(r.what) || !union(m.what)) return null;
  // later steps read the choices only as "the rest" of the group (the move that names the last one)
  if (list.slice(i + 6).some((x) => names.some((n) => JSON.stringify(x).includes(`"name":"${n}"`)) && !(x.op === 'move' && x.what.ref === 'each' && restOfGroup(x.what.filter)?.chosen === names[3]))) return null;
  const them = K.obj(group!, st, 'object');
  if (!them.plural) return null;
  const np = (f: ObjectFilter): string => K.np({ ...f, zone: 'library' }, st, { det: 'a', noZone: true });
  const text = `you may reveal ${np(descs[0]!)}, ${np(descs[1]!)}, ${np(descs[2]!)}, and/or ${np(descs[3]!)} from among ${them.text} and put those cards into your hand`;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 6 };
}

function returnTargetIfManaValueAtMost(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  if (m?.op !== 'move' || m.what.ref !== 'target' || !onlyKeys(m, ['op', 'what', 'to', 'guard']) || m.guard === undefined || !same(m.to, { zone: 'battlefield', controller: { ref: 'you' } })) return null;
  const g = m.guard as unknown as Record<string, unknown>;
  if (g['cond'] !== 'compare' || g['op'] !== '<=' || !onlyKeys(g, ['cond', 'left', 'op', 'right']) || !same(g['left'], { q: 'stat', stat: 'manaValue', of: m.what })) return null;
  const right = g['right'] as Record<string, unknown>;
  if (typeof right !== 'object' || right === null || right['q'] !== 'stat' || right['stat'] !== 'power' || right['sum'] !== true || !same(right['of'], { ref: 'event', role: 'attacker' })) return null;
  const target = K.obj(m.what, st, 'object').text;
  return { clauses: [plain(`return ${target} to the battlefield if its mana value is less than or equal to their total power`, { standalone: true })], consumed: 1 };
}

const BAT_QUOTE_TEXT = 'When this token deals combat damage to a player, sacrifice it and return the exiled card to the battlefield tapped.';

function payExileItBatToken(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const p = list[i];
  if (p?.op !== 'pay' || !onlyKeys(p, ['op', 'who', 'cost', 'guard', 'then']) || !same(p.who, { ref: 'you' }) || p.then?.length !== 3) return null;
  const cost = p.cost as unknown as Record<string, unknown>;
  if (!onlyKeys(cost, ['mana']) || !Array.isArray(cost['mana'])) return null;
  const subject = { ref: 'event', role: 'subject' };
  if (!same(p.guard, { cond: 'matches', object: subject, filter: { zone: 'graveyard' } })) return null;
  const [x, t, e] = p.then as [EffectStep, EffectStep, EffectStep];
  if (x.op !== 'move' || !onlyKeys(x, ['op', 'what', 'to', 'as']) || !same(x.what, subject) || !same(x.to, { zone: 'exile' }) || x.as !== 'exiledCard') return null;
  if (t.op !== 'createToken' || t.as === undefined || e.op !== 'effect' || !onlyKeys(e, ['op', 'duration', 'effects']) || !same(e.duration, { d: 'permanent' }) || e.effects.length !== 1) return null;
  const g = e.effects[0] as unknown as Record<string, unknown>;
  const mods = g['mods'] as Record<string, unknown>[] | undefined;
  if (g['s'] !== 'continuous' || !same(g['affects'], { ref: 'bound', name: t.as }) || mods?.length !== 1 || mods[0]!['layer'] !== 6) return null;
  const add = mods[0]!['add'] as Record<string, unknown>[] | undefined;
  if (add?.length !== 1 || add[0]!['kind'] !== 'triggered' || add[0]!['text'] !== BAT_QUOTE_TEXT) return null;
  const mana = K.cost({ mana: cost['mana'] } as never, st);
  const token = K.clause(t, st).imp;
  const quote = BAT_QUOTE_TEXT.toLowerCase().replace('this token', '~');
  return { clauses: [plain(`you may pay ${mana} and exile it. if you do, ${token}. it gains "${quote}"`, { standalone: true })], consumed: 1 };
}

/** The folds of edh-d-91 (render/fold.ts#foldAtPlain). */
export function foldEdhD91(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return chooseReturnWithCounterSubtype(list, i, st) ?? paySacrificeItSearchSameName(list, i, st) ?? castArtifactFromGroupAffinity(list, i, st) ?? mayReturnOneOfGroup(list, i, st) ?? revealFourAndOrFromGroup(list, i, st) ?? returnTargetIfManaValueAtMost(list, i, st) ?? payExileItBatToken(list, i, st);
}
