/**
 * Must-finish round edh-next-142 (library, draw and search; code edhn142): the folds of the steps its templates build (render/fold.ts#foldAtPlain tries `foldEdhN142` with the other
 * slices' own folds). A fold applies only when every part is exactly what the idiom says.
 */
import type { EffectStep, ObjectFilter, PlayerRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { numWord } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const PHASE_OPTIONS = ['draw step', 'main phase', 'combat phase'];

/** The lasting skip the template eff.edhn142.chooses.skipStepOrPhase builds for one option, for the player `who`. */
function skipFor(option: string, who: PlayerRef): unknown[] {
  const skip = (replaces: Record<string, unknown>) => ({ s: 'replace', replaces: { ...replaces, whose: who }, body: { b: 'skip' } });
  const effects = option === 'draw step' ? [skip({ ev: 'step', step: 'draw' })]
    : option === 'main phase' ? [skip({ ev: 'phase', phase: 'precombatMain' }), skip({ ev: 'phase', phase: 'postcombatMain' })]
    : [skip({ ev: 'phase', phase: 'combat' })];
  return [{ op: 'effect', duration: { d: 'endOfTurn' }, effects }];
}

/**
 * "That player chooses draw step, main phase, or combat phase. The player skips each instance of the chosen step or phase this turn." (Fatespinner; CR 608.2d, 614.1b, 614.10, 500.11, 611.2a):
 * the one player the sentence names chooses one of the three, then each step or phase of that kind of the turn (both main phases for "main phase", an added one too) is skipped
 * for that player. Exactly the four steps of the template.
 */
function choosesStepOrPhaseToSkip(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'chooseValue' || c.guard !== undefined || c.what !== 'option' || c.link === undefined || !same(c.options, PHASE_OPTIONS) || c.random !== undefined || c.secret !== undefined) return null;
  if (c.who.ref !== 'event' && c.who.ref !== 'target' && c.who.ref !== 'controllerOf') return null; // one player an earlier clause names
  for (let k = 0; k < 3; k++) {
    const s = list[i + 1 + k];
    if (s?.op !== 'if' || s.guard !== undefined || s.else !== undefined || !same(s.cond, { cond: 'chosen', link: c.link, equals: PHASE_OPTIONS[k] }) || !same(s.then, skipFor(PHASE_OPTIONS[k]!, c.who))) return null;
  }
  const who = K.player(c.who, st, 'subject').text;
  return { clauses: [plain(`${who} chooses draw step, main phase, or combat phase. the player skips each instance of the chosen step or phase this turn`, { standalone: true })], consumed: 4 };
}

/**
 * "Each opponent may search their library for up to three basic land cards. They each put one of those cards onto the battlefield tapped under your control and the rest onto the battlefield
 * tapped under their control." (Rootweaver Druid; CR 101.4, 608.2d, 701.23a, 110.2a): each opponent in turn may search their own library for up to N cards of the description, chooses one of
 * them, which enters tapped under your control, and the others enter tapped under that opponent's control. Exactly the one `may` of template eff.edhn142.eachOpponentMay.search.upTo.oneToYouRestTheirs.
 */
function eachOpponentSearchesOneToYou(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  if (m?.op !== 'may' || m.guard !== undefined || m.otherwise !== undefined || !same(m.who, { ref: 'each', who: 'opponent' }) || m.as === undefined || m.do.length !== 4) return null;
  const [s, c, give, rest] = m.do;
  if (s?.op !== 'search' || s.guard !== undefined || !same(s.who, { ref: 'iterating' }) || s.zone !== 'library' || s.owner !== undefined || s.alsoZones !== undefined || s.min !== 0 || typeof s.max !== 'number' || s.max < 2 || s.as === undefined
    || s.reveal !== undefined || s.and !== undefined || s.differentNames !== undefined || s.groupLimit !== undefined) return null;
  const found = { ref: 'each', filter: { is: { ref: 'bound', name: s.as }, zone: 'library' } };
  if (c?.op !== 'chooseObjects' || c.guard !== undefined || !same(c.who, { ref: 'iterating' }) || !same(c.from, found) || c.min !== 1 || c.max !== 1 || c.as === undefined) return null;
  if (give?.op !== 'move' || give.guard !== undefined || !same(give.what, { ref: 'bound', name: c.as }) || !same(give.to, { zone: 'battlefield', controller: { ref: 'you' }, tapped: true })) return null;
  const others = { ref: 'each', filter: { is: { ref: 'bound', name: s.as }, not: { is: { ref: 'bound', name: c.as } }, zone: 'library' } };
  if (rest?.op !== 'move' || rest.guard !== undefined || !same(rest.what, others) || !same(rest.to, { zone: 'battlefield', controller: { ref: 'iterating' }, tapped: true })) return null;
  const what = K.np({ ...s.filter, zone: 'library' }, st, { det: 'none', plural: true, noZone: true });
  return { clauses: [plain(`each opponent may search their library for up to ${numWord(s.max)} ${what}. they each put one of those cards onto the battlefield tapped under your control and the rest onto the battlefield tapped under their control`, { standalone: true })], consumed: 1 };
}

/**
 * "put two cards from your hand both on top of your library or both on the bottom of your library" (Dream Cache; CR 401.4, 608.2d): you choose that many cards from your hand, then ONE side
 * of your library for all of them (top or bottom), and put them there in an order you choose. Exactly the four steps of template eff.edhn142.put.fromHand.bothTopOrBothBottom.
 */
function putFromHandBothTopOrBottom(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const [a, b, t, u] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (a?.op !== 'chooseObjects' || a.guard !== undefined || a.who.ref !== 'you' || !same(a.from, { ref: 'each', filter: { zone: 'hand', owner: 'you' } }) || typeof a.min !== 'number' || a.min < 2 || a.max !== a.min || a.as === undefined
    || a.random !== undefined || a.eachColorPair !== undefined || a.eachCardType !== undefined || a.groupLimit !== undefined || a.distinct !== undefined) return null;
  if (b?.op !== 'chooseValue' || b.guard !== undefined || b.who.ref !== 'you' || b.what !== 'option' || b.link === undefined || !same(b.options, ['top', 'bottom']) || b.random !== undefined || b.secret !== undefined) return null;
  const side = (s: EffectStep | undefined, which: 'top' | 'bottom'): boolean => s?.op === 'if' && s.guard === undefined && s.else === undefined && same(s.cond, { cond: 'chosen', link: b.link, equals: which })
    && same(s.then, [{ op: 'move', what: { ref: 'bound', name: a.as }, to: { zone: 'library', position: which, order: 'chosen' } }]);
  if (!side(t, 'top') || !side(u, 'bottom')) return null;
  return { clauses: [plain(`put ${numWord(a.min)} cards from your hand both on top of your library or both on the bottom of your library`)], consumed: 4 };
}

/**
 * "You may put up to one land card from among them onto the battlefield tapped and up to one Elf card from among them into your hand." (Bounty of Skemfar; CR 608.2c, 608.2d, 701.20a, 110.2a): two
 * choices of yours among the same group still in the library, each of at most one card of its description, the first put onto the battlefield tapped under your control, the second (among the
 * cards left) into your hand. Exactly the four steps of template eff.edhn142.may.putUpToOne.bfTapped.andUpToOne.hand.fromAmong.
 */
function putUpToOneEachFromGroup(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c, e] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  const one = (x: EffectStep | undefined): x is Extract<EffectStep, { op: 'chooseObjects' }> => x?.op === 'chooseObjects' && x.guard === undefined && x.who.ref === 'you' && x.min === 0 && x.max === 1 && x.as !== undefined
    && x.random === undefined && x.eachColorPair === undefined && x.eachCardType === undefined && x.groupLimit === undefined && x.distinct === undefined && x.perPlayer === undefined && x.startingWith === undefined && x.link === undefined;
  if (!one(a) || !one(c) || a.from.ref !== 'each' || c.from.ref !== 'each') return null;
  const fa = a.from.filter;
  const fc = c.from.filter;
  const keys = (f: Record<string, unknown>): boolean => Object.keys(f).sort().join() === 'anyOf,is,zone' && f['zone'] === 'library';
  if (!keys(fa as Record<string, unknown>) || !keys(fc as Record<string, unknown>) || !same(fa.is, fc.is) || fa.anyOf?.length !== 1 || fc.anyOf?.length !== 1 || fa.is === undefined) return null;
  if (b?.op !== 'move' || b.guard !== undefined || b.as !== undefined || !same(b.what, { ref: 'bound', name: a.as }) || !same(b.to, { zone: 'battlefield', controller: { ref: 'you' }, tapped: true })) return null;
  if (e?.op !== 'move' || e.guard !== undefined || e.as !== undefined || !same(e.what, { ref: 'bound', name: c.as }) || !same(e.to, { zone: 'hand' })) return null;
  const them = K.obj(fa.is, st, 'object');
  if (!them.plural) return null;
  const kind = (f: ObjectFilter): string => K.np({ ...f, isCard: true, zone: 'library' }, st, { det: 'none', plural: false, noZone: true });
  return { clauses: [plain(`you may put up to one ${kind(fa.anyOf[0]!)} from among ${them.text} onto the battlefield tapped and up to one ${kind(fc.anyOf[0]!)} from among ${them.text} into your hand`, { standalone: true })], consumed: 4 };
}

/** The folds of edh-next-142 (render/fold.ts#foldAtPlain). */
export function foldEdhN142(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return choosesStepOrPhaseToSkip(list, i, st) ?? eachOpponentSearchesOneToYou(list, i, st) ?? putFromHandBothTopOrBottom(list, i, st) ?? putUpToOneEachFromGroup(list, i, st);
}
