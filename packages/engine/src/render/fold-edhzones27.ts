/**
 * edh-zones-27 (Commander lane edh-zones): the folds of its templates (parser/templates/zz-cloud/edh-zones-27.json), called from render/fold.ts#foldAt. Each applies only when
 * every part is exactly what the idiom says.
 *
 * `chooseOneThenRemoveKind` (CR 122.1, 608.2d, 400.7; Mari, the Killing Quill): "you may remove a hit counter from a card that player owns in exile": your choice of exactly one object of a
 * description that has a counter of the kind (in any zone, not only the battlefield), then one counter of that kind removed from exactly the chosen one; the removal is named, so "if you
 * do" reads whether a counter was removed. Exactly the two steps of template eff.edhz27.removeCounter.fromOneWithKind.
 */
import type { EffectStep, ObjectFilter, ObjRef } from '../types/ability';
import type { Folded } from './fold';
import { withVariants, type RenderState } from './state';
import { plain } from './clause';
import { K } from './kernel';
import { bind } from './steps-util';
import { countersText } from './steps-life';
import { alt } from './text';

const isBound = (ref: ObjRef, name: string | undefined): boolean => name !== undefined && ref.ref === 'bound' && ref.name === name;
const unread = (list: EffectStep[], from: number, name: string): boolean => !list.slice(from).some((x) => JSON.stringify(x).includes(`"name":"${name}"`));

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const UNFOLDING = new WeakSet<EffectStep>();

export function foldEdhZones27(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return chooseOneThenRemoveKind(list, i, st) ?? putOneFromAmongThem(list, i, st);
}

/**
 * `putOneFromAmongThem` (CR 608.2d, 110.2a, 400.7j; Aminatou's Augury): "You may put a land card from among them onto the battlefield." after "Exile the top eight cards of your library.":
 * your choice of zero or one card of a description among the group the exile made (`zone: 'any'`: the cards are in exile now), put onto the battlefield under your control.
 * Exactly the two steps of template eff.edhz27.put.fromExiledTop.battlefield; the pair written apart ("... exiled this way ...") stays a reading.
 */
function putOneFromAmongThem(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || UNFOLDING.has(a) || a.guard !== undefined || b.guard !== undefined || a.as === undefined || b.as !== undefined || b.until !== undefined) return null;
  if (!same(a.who, { ref: 'you' }) || a.min !== 0 || a.max !== 1 || a.random === true || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from)) return null;
  const f = a.from.filter;
  if (Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join(',') !== 'anyOf,is,zone' || f.zone !== 'any' || f.anyOf?.length !== 1 || f.is?.ref !== 'bound') return null;
  if (!same(b.what, { ref: 'bound', name: a.as }) || !same(b.to, { zone: 'battlefield', controller: { ref: 'you' } }) || b.link !== undefined || b.remember !== undefined) return null;
  if (st.info.get(`b:${f.is.name}`) === undefined || !unread(list, i + 2, a.as)) return null;
  const kind = f.anyOf[0]!;
  const unfold = (v: RenderState): string => {
    UNFOLDING.add(a);
    try { return K.steps([a, b], v); } finally { UNFOLDING.delete(a); }
  };
  const [folded, unfolded] = withVariants(st, [(v) => `you may put ${K.np(kind, v, { det: 'a', head: 'card' })} from among them onto the battlefield`, unfold]);
  bind(st, a.as, { nouns: K.nounsOf(kind), plural: false, optional: true });
  return { clauses: [plain(alt(folded!, unfolded!))], consumed: 2 };
}

function chooseOneThenRemoveKind(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'removeCounters' || a.random === true || a.guard !== undefined || b.guard !== undefined || b.upTo === true || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.as === undefined || !isBound(b.from as ObjRef, a.as) || b.count !== 1 || b.kind === 'any' || !unread(list, i + 2, a.as)) return null;
  const from = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (from === null || from.counters?.kind !== b.kind || from.counters.cmp !== undefined || Object.keys(from.counters).filter((k) => (from.counters as Record<string, unknown>)[k] !== undefined).length !== 1) return null;
  const { counters: _c, ...inner } = from;
  // the zone is part of the description here (a card in exile, "from a card that player owns in exile"): the battlefield default of the other folds does not apply
  const noun = K.np(inner as ObjectFilter, st, { det: 'a' });
  bind(st, a.as, { nouns: K.nounsOf(inner as ObjectFilter), plural: false });
  if (b.as !== undefined) st.info.set(`b:${b.as}`, { nouns: ['counter'], plural: false, actor: 'you' });
  return { clauses: [plain(`remove ${countersText(1, b.kind, st)} from ${noun}`)], consumed: 2 };
}

/** The card types a spell can have, in the order of the template's permissions (CR 205.2a: every nonland card type a card can be cast with). */
export const NONLAND_SPELL_TYPES: readonly string[] = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Instant', 'Kindred', 'Planeswalker', 'Sorcery'];

/**
 * `eachNonlandTypePermit` (CR 611.2a, 601.3, 118.9, 205.2a; Aminatou's Augury): "for each nonland card type, you may cast a spell of that type from among the exiled cards without paying its
 * mana cost": one one-spell, free cast permission for the cards a step named, per nonland card type, all of one effect step (so one duration). Exactly the step of template
 * eff.edhz27.permit.cast.eachNonlandType.free.durFirst; the sentence without its duration, or null for any other effect step (called from render/steps-lasting.ts#effect).
 */
export function eachNonlandTypePermit(s: Extract<EffectStep, { op: 'effect' }>, st: RenderState): string | null {
  if (s.as !== undefined || s.guard !== undefined || s.effects.length !== NONLAND_SPELL_TYPES.length) return null;
  let group: ObjRef | undefined;
  for (const [k, e] of s.effects.entries()) {
    if (e.s !== 'permit' || e.action !== 'cast' || e.single !== true || !same(e.who, { ref: 'you' }) || !same(e.onlyTypes, [NONLAND_SPELL_TYPES[k]]) || !same(e.costChange, { kind: 'set', cost: {} })) return null;
    if (e.of === undefined || Object.keys(e.of).length !== 1 || e.of.is?.ref !== 'bound') return null;
    const keys = Object.keys(e).filter((x) => (e as unknown as Record<string, unknown>)[x] !== undefined);
    if (keys.some((x) => !['s', 'who', 'action', 'of', 'costChange', 'onlyTypes', 'single'].includes(x))) return null;
    if (group !== undefined && !same(group, e.of.is)) return null;
    group = e.of.is;
  }
  if (group === undefined) return null;
  const them = K.obj(group, st, 'object');
  if (!them.plural) return null;
  return `for each nonland card type, you may cast a spell of that type from among ${alt(them.text, 'the exiled cards')} without paying its mana cost`;
}

const EVENT_PLAYER = { ref: 'event', role: 'player' };

/**
 * `nextDrawExileTopPlay` (CR 614.1a, 614.6, 615.7, 121.1, 406.1, 611.2a; Urabrask, Heretic Praetor): "the next time they would draw a card this turn, instead they exile the top card of their
 * library. They may play it this turn.": one shield (a single use) on that player's draw, whose replacement exiles the top card of their library and lets them play it this turn. The
 * player is the one the trigger's event names. Exactly the step of template eff.edhz27.nextDraw.they.exileTop.mayPlay; the two sentences, or null for any other effect step (called from
 * render/steps-lasting.ts#effect).
 */
export function nextDrawExileTopPlay(s: Extract<EffectStep, { op: 'effect' }>): string | null {
  if (s.as !== undefined || s.guard !== undefined || !same(s.duration, { d: 'endOfTurn' }) || s.effects.length !== 1) return null;
  const e = s.effects[0]!;
  if (e.s !== 'replace' || !same(e.replaces, { ev: 'draw', player: EVENT_PLAYER }) || !same(e.shield, { uses: 1 }) || e.optional !== undefined || e.condition !== undefined || e.selfReplacement !== undefined) return null;
  const b = e.body;
  if (b.b !== 'instead' || b.do.length !== 2) return null;
  const [m, p] = b.do;
  if (m?.op !== 'move' || p?.op !== 'effect' || m.as === undefined || m.guard !== undefined || p.guard !== undefined || p.as !== undefined) return null;
  if (!same(m.what, { ref: 'topCards', player: EVENT_PLAYER, count: 1 }) || !same(m.to, { zone: 'exile' }) || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (!same(p.duration, { d: 'endOfTurn' }) || p.effects.length !== 1) return null;
  const permit = p.effects[0]!;
  if (permit.s !== 'permit' || permit.action !== 'play' || !same(permit.who, EVENT_PLAYER) || !same(permit.of, { is: { ref: 'bound', name: m.as } }) || Object.keys(permit).length !== 4) return null;
  return `the next time ${alt('they', 'that player')} would draw a card this turn, instead ${alt('they exile', 'that player exiles')} the top card of ${alt('their', "that player's")} library. ${alt('they', 'that player')} may play it this turn`;
}
