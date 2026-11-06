/**
 * edh-d-85 (Commander coordinator D, EDHREC ranks 5,001-10,000, group combat): the folds of its templates (parser/templates/zz-cloud/edh-d-85.json), called from
 * render/fold.ts#foldAt. Each applies only when every part is exactly what the idiom says.
 *
 * `gainsIfAndIf` (CR 608.2c, 611.2a, 613.1f; Doors of Durin, eff.edhd85.dur.gains.ifCond.andIfCond): "Until your next turn, it gains trample if you control a Dwarf and hexproof if
 * you control an Elf.": two lasting grants to the same object for the same duration, each made only if its own condition holds as the effect resolves (two `effect` steps, each with
 * its `guard`), said as one sentence.
 *
 * `returnUnderTheirControlWithCounter` (CR 110.2, 404.1, 122.6; Immortal Obligation, eff.edhd85.return.bf.underTheirControl.withCounter): "Return target creature card from an opponent's
 * graveyard to the battlefield under their control with a duty counter on it.": a card in an opponent's graveyard enters under its owner's control (the graveyard's player is its
 * owner, CR 404.1), with one counter.
 *
 * `goadedCantAttackYouCantBlockYours` (CR 701.15a-b, 508.1c, 509.1b, 611.2b; Immortal Obligation, eff.edhd85.dur.isGoaded.cantAttackYouOrYours.cantBlockYours): "For as long as that creature has a
 * duty counter on it, it is goaded, can't attack you or a permanent you control, and can't block creatures you control.": one lasting effect of four rules on one object.
 *
 * `exileAnyNumberCardTypesThenPut` (CR 205.2a, 608.2c, 608.2d, 122.6; Winter, Cynical Opportunist, eff.edhd85.mayExileAnyNumber.fourCardTypes.ifDo.putFromAmongWithCounter): "you may exile any
 * number of cards from your graveyard with four or more card types among them. If you do, put a permanent card from among them onto the battlefield with a finality counter on it.":
 * a choice of a set with that many card types (none chosen is declining), its exile, and, if anything was exiled, one card of a kind from among them put onto the battlefield with a counter.
 *
 * `putOptionElse` (CR 608.2c, 118.12; Fishing Gear, parser/lower/conditions.ts#foldNotDidAfterPutOption): "If it's a permanent card, you may put it onto the battlefield under your control. If you
 * don't, create a 1/1 blue Fish creature token.": the lowering writes Z on both paths (after the declined option, and as the `else` when the card is not of that kind); said as Oracle says it.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { abilityList } from './mods';
import type { RenderState } from './state';
import { bind } from './steps-util';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The abilities one guarded grant adds, when the step is exactly `effect` + one continuous layer-6 add + a guard + a limited duration. */
function guardedGrant(s: EffectStep | undefined): { affects: unknown; add: unknown[]; duration: unknown } | null {
  if (s?.op !== 'effect' || s.guard === undefined || s.as !== undefined || s.duration === undefined || s.duration.d === 'permanent' || s.effects.length !== 1) return null;
  if (!Object.keys(s).every((k) => ['op', 'duration', 'effects', 'guard'].includes(k))) return null;
  const e = s.effects[0]!;
  if (e.s !== 'continuous' || e.cda === true || e.mods.length !== 1 || !Object.keys(e).every((k) => ['s', 'affects', 'mods'].includes(k))) return null;
  const m = e.mods[0] as unknown as Record<string, unknown>;
  if (m.layer !== 6 || !Array.isArray(m.add) || m.add.length === 0 || Object.keys(m).length !== 2) return null;
  return { affects: e.affects, add: m.add, duration: s.duration };
}

function gainsIfAndIf(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = guardedGrant(list[i]);
  const b = guardedGrant(list[i + 1]);
  if (a === null || b === null || !same(a.affects, b.affects) || !same(a.duration, b.duration)) return null;
  // exactly a pair: a longer run of such grants ("The same is true for ...", Majestic Myriarch) keeps its own reading
  if (guardedGrant(list[i + 2]) !== null || (i > 0 && guardedGrant(list[i - 1]) !== null)) return null;
  const affects = a.affects as ObjRef;
  if (!('ref' in affects) || affects.ref === 'each') return null; // one object ("it", a target): a group says "gain"
  const s0 = list[i] as Extract<EffectStep, { op: 'effect' }>;
  const s1 = list[i + 1] as Extract<EffectStep, { op: 'effect' }>;
  const dur = K.dur(s0.duration!, st);
  const who = K.obj(affects, st, 'subject');
  if (who.plural) return null;
  const first = `${abilityList(a.add as never, st, 'creature')} if ${K.cond(s0.guard!, st)}`;
  const second = `${abilityList(b.add as never, st, 'creature')} if ${K.cond(s1.guard!, st)}`;
  return { clauses: [plain(`${dur}, ${who.text} gains ${first} and ${second}`, { standalone: true })], consumed: 2 };
}

function returnUnderTheirControlWithCounter(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'move' || s.guard !== undefined || s.until !== undefined || s.link !== undefined || s.remember !== undefined || s.what.ref !== 'target') return null;
  const to = s.to as { zone: string; controller?: unknown; counters?: { kind: string; count: unknown }[] };
  if (to.zone !== 'battlefield' || to.controller !== 'owner' || to.counters?.length !== 1 || to.counters[0]!.count !== 1 || Object.keys(to).length !== 3) return null;
  const spec = st.specs.get((s.what as { id: string }).id) as { filter?: { zone?: unknown; owner?: unknown } } | undefined;
  if (spec?.filter?.zone !== 'graveyard' || spec.filter.owner !== 'opponent') return null; // only a card in an opponent's graveyard: "their" is its owner (CR 404.1)
  const what = K.obj(s.what, st, 'object').text;
  const k = to.counters[0]!.kind;
  // the card it was is now a permanent of the same kind: "that creature" and "it" in what follows (as steps-zones.ts#bindMoved says it for a bound card)
  const types = ((spec.filter as { types?: string[] }).types ?? []).map((t) => t.toLowerCase());
  if (s.as !== undefined) bind(st, s.as, { nouns: [...types, 'card', 'permanent'], plural: false, sameAs: `t:${(s.what as { id: string }).id}` }); // the same object as the target (refs.ts#identityOf)
  return { clauses: [plain(`return ${what} to the battlefield under their control with ${/^[aeiou]/.test(k) ? 'an' : 'a'} ${k} counter on it`, { standalone: true })], consumed: 1 };
}

function goadedCantAttackYouCantBlockYours(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'effect' || s.guard !== undefined || s.as !== undefined || s.duration === undefined || s.duration.d === 'permanent' || s.effects.length !== 4) return null;
  const o = (s.effects[0] as { subject?: unknown }).subject;
  const expected = [
    { s: 'restrict', subject: o, mode: 'mustIfAble', action: 'attack', goad: true },
    { s: 'restrict', subject: o, mode: 'cant', action: 'attackPlayer', otherPlayer: { ref: 'you' } },
    { s: 'restrict', subject: o, mode: 'cant', action: 'attack', other: { controller: 'you' } },
    { s: 'restrict', subject: o, mode: 'cant', action: 'block', other: { types: ['Creature'], controller: 'you' } },
  ];
  if (!same(s.effects, expected) || typeof o !== 'object' || o === null || !('ref' in o) || (o as ObjRef).ref === 'each') return null;
  const who = K.obj(o as ObjRef, st, 'subject');
  if (who.plural) return null;
  return { clauses: [plain(`${K.dur(s.duration, st)}, ${who.text} is goaded, can't attack you or a permanent you control, and can't block creatures you control`, { standalone: true })], consumed: 1 };
}

const NUMBER_WORD: Readonly<Record<number, string>> = { 2: 'two', 3: 'three', 4: 'four', 5: 'five' };

function exileAnyNumberCardTypesThenPut(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, m, f] = [list[i], list[i + 1], list[i + 2]];
  if (c?.op !== 'chooseObjects' || m?.op !== 'move' || f?.op !== 'if' || c.guard !== undefined || m.guard !== undefined || f.guard !== undefined || f.else !== undefined) return null;
  if (typeof c.cardTypesAtLeast !== 'number' || NUMBER_WORD[c.cardTypesAtLeast] === undefined || c.min !== 0 || c.max !== 'any' || !same(c.who, { ref: 'you' })) return null;
  if (!same(c.from, { ref: 'each', filter: { isCard: true, zone: 'graveyard', owner: 'you' } })) return null;
  if (!same(Object.keys(c).sort(), ['as', 'cardTypesAtLeast', 'from', 'max', 'min', 'op', 'who'])) return null;
  if (m.as === undefined || !same(m.what, { ref: 'bound', name: c.as }) || !same(m.to, { zone: 'exile' }) || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (!same(f.cond, { cond: 'did', step: m.as }) || f.then.length !== 2) return null;
  const [c2, m2] = f.then as [EffectStep, EffectStep];
  if (c2.op !== 'chooseObjects' || m2.op !== 'move' || c2.min !== 1 || c2.max !== 1 || !same(c2.who, { ref: 'you' }) || c2.guard !== undefined || m2.guard !== undefined) return null;
  if (!same(Object.keys(c2).sort(), ['as', 'from', 'max', 'min', 'op', 'who'])) return null;
  const from = c2.from as { ref?: string; filter?: { anyOf?: unknown[]; is?: unknown; zone?: unknown } };
  if (from.ref !== 'each' || !same(from.filter?.is, { ref: 'bound', name: m.as }) || from.filter?.zone !== 'exile' || from.filter.anyOf?.length !== 1 || Object.keys(from.filter).length !== 3) return null;
  const to = m2.to as { zone: string; controller?: unknown; counters?: { kind: string; count: unknown }[] };
  if (!same(m2.what, { ref: 'bound', name: c2.as }) || to.zone !== 'battlefield' || !same(to.controller, { ref: 'you' }) || to.counters?.length !== 1 || to.counters[0]!.count !== 1 || Object.keys(to).length !== 3 || m2.as !== undefined) return null;
  const kind = K.np(from.filter.anyOf[0] as never, st, { det: 'none' });
  const k = to.counters[0]!.kind;
  const art = (w: string): string => (/^[aeiou]/.test(w) ? 'an' : 'a');
  return {
    clauses: [plain(`you may exile any number of cards from your graveyard with ${NUMBER_WORD[c.cardTypesAtLeast]} or more card types among them. if you do, put ${art(kind)} ${kind} card from among them onto the battlefield with ${art(k)} ${k} counter on it`, { standalone: true })],
    consumed: 3,
  };
}

function putOptionElse(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'if' || s.guard !== undefined || s.else === undefined || s.cond.cond !== 'matches' || s.then.length !== 2) return null;
  const [may, no] = s.then as [EffectStep, EffectStep];
  if (may.op !== 'may' || may.as === undefined || may.otherwise !== undefined || may.guard !== undefined || no.op !== 'if' || no.guard !== undefined || no.else !== undefined) return null;
  if (!same(no.cond, { cond: 'did', step: may.as, not: true }) || !same(no.then, s.else)) return null;
  const first = K.steps([{ op: 'if', cond: s.cond, then: [may] } as EffectStep], st);
  const z = K.steps(no.then, st);
  return { clauses: [plain(`${first.replace(/\.$/, '')}. if you don't, ${z.replace(/\.$/, '')}`, { standalone: true })], consumed: 1 };
}

/** The folds of edh-d-85 (render/fold.ts#foldAt). */
export function foldEdhD85(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return gainsIfAndIf(list, i, st) ?? returnUnderTheirControlWithCounter(list, i, st) ?? goadedCantAttackYouCantBlockYours(list, i, st) ?? exileAnyNumberCardTypesThenPut(list, i, st) ?? putOptionElse(list, i, st);
}
