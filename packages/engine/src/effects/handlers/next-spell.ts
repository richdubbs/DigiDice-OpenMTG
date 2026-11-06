/**
 * Standard round 10: "the next spell you cast this turn can't be countered", "the next creature spell you cast this turn can't be countered" (CR 101.2, 601.2i,
 * 611.2; cites unverified). Op: nextSpell. The effect waits for the next spell its player casts this turn that matches the filter and applies to it as it becomes
 * cast (core/turn-effects.ts#takeNextSpellRiders, called by actions/cast.ts): a rider, never a trigger, so no player gets priority between the cast and the rider (unlike "copy the next spell
 * you cast this turn when you cast it", a delayed triggered ability, CR 603.7). Each such effect applies to one spell, the first match after it was created;
 * two of them both apply to that spell. It ends with the turn (`TurnState.nextSpell`, cleared as a turn begins).
 *
 * The filter is matched against the spell on the stack (rules/filter.ts#matchesFilter, "you" = the effect's controller) on the fields NEXT_SPELL_FILTER_FIELDS
 * lists, its card types, colors and types of the spell itself; model/cap-walk.ts makes any other field an unregistered form (fail closed).
 *
 * std-rx26: rider `keyword` ("the next noncreature spell you cast this turn has affinity for artifacts", "... has convoke"; CR 601.2a, 601.2f, 611.2c, 613.1f;
 * cites unverified): the spell has the keyword from the moment it is put on the stack to be cast, so a cost keyword works while the costs are determined and paid
 * (core/turn-effects.ts#lockNextSpellKeywords). Only the keywords NEXT_SPELL_KEYWORDS names: those the cast reads from the spell itself as it is cast.
 *
 * std-freecast-1: rider `free`, "the next red or green creature spell you cast this turn can be cast without paying its mana cost" (CR 118.9, 601.2b, 601.2i, 611.2;
 * cites unverified): while it waits, the player may cast a spell it matches for the alternative cost of nothing (statics/play-permits.ts#grantedAlternatives);
 * the next matching spell the player casts uses it up, whichever way it was paid for (core/turn-effects.ts#takeNextSpellRiders).
 */
import { addNextSpellRider } from '../../core/turn-effects';
import type { EffectStep } from '../../types/ability';
import type { OpHandlers, StepHandler } from '../api';
import { resolvePlayers } from '../refs';
import { NOTHING } from './zones-util';
import { cardCount } from './cards-util';

type Step = Extract<EffectStep, { op: 'nextSpell' }>;

/** The ObjectFilter fields a `nextSpell` filter may use: what the spell is (anything else: model/cap-walk.ts makes the step an unregistered form). */
export const NEXT_SPELL_FILTER_FIELDS: readonly string[] = ['types', 'allTypes', 'notTypes', 'subtypes', 'supertypes', 'colors', 'notColors', 'colorless', 'multicolored', 'anyOf', 'zone', 'stackKind', 'chosen' /* edh-next-18 (CR 607.2d, 601.3b): Progenitor's Icon, "the chosen type", read from the rider's source */, 'castFrom' /* edh-d-50 (CR 601.2a): "from your hand" */, 'faceDown' /* edh-next-141 (CR 708.4, 702.37c; Panoptic Projektor): "the next face-down creature spell", a spell cast face down (morph, disguise, CR 708.2) */];

/** std-rx26: the keywords a `keyword` rider may give the next spell (CR 702.41a affinity, 702.51a convoke, 702.126a improvise); any other is refused. */
export const NEXT_SPELL_KEYWORDS: readonly string[] = ['affinity', 'convoke', 'improvise', 'cascade' /* pc-exile-play-3 (CR 702.85a) */, 'storm' /* pc-exile-play-3 (CR 702.40a) */, 'undaunted' /* trek-13 (CR 702.125a) */, 'sunburst' /* edh-mana-keywords-12 (CR 702.44a): Solar Array */, 'rebound' /* edh-d-50 (CR 702.88a): Narset Transcendent */];

/** std-rx26: is this a keyword a `keyword` rider can give (one of NEXT_SPELL_KEYWORDS; affinity with its filter, the others with no parameter)? */
export function nextSpellKeywordOk(k: unknown): boolean {
  if (k === null || typeof k !== 'object') return false;
  const r = k as Record<string, unknown>;
  if (r['kind'] !== 'keyword' || typeof r['keyword'] !== 'string' || !NEXT_SPELL_KEYWORDS.includes(r['keyword'])) return false;
  const extra = Object.keys(r).filter((x) => !['kind', 'keyword', 'text', 'filter'].includes(x));
  return extra.length === 0 && (r['keyword'] === 'affinity') === (r['filter'] !== undefined);
}

/** edh-c-53: a `reduce` rider takes generic mana off the next spell's cost (statics/costmods.ts#costModsFor): one generic symbol of a positive amount. */
export function nextSpellReduceOk(m: unknown): boolean {
  if (!Array.isArray(m) || m.length !== 1) return false;
  const x = m[0] as Record<string, unknown>;
  return x['kind'] === 'generic' && typeof x['amount'] === 'number' && Number.isInteger(x['amount']) && x['amount'] > 0 && Object.keys(x).length === 2;
}

/** Does `f` use only NEXT_SPELL_FILTER_FIELDS (also inside `anyOf`)? */
/** edh-d-95 (CR 614.1c, 122.6): the counters of an `enters` rider: one or more kinds, each a whole number of one or more (no computed amount). */
export function nextSpellEntersOk(c: unknown): boolean {
  return Array.isArray(c) && c.length > 0 && c.every((x) => x !== null && typeof x === 'object' && typeof (x as Record<string, unknown>)['kind'] === 'string' && Number.isInteger((x as Record<string, unknown>)['count'])
    && ((x as Record<string, unknown>)['count'] as number) > 0 && Object.keys(x as object).length === 2);
}

export function nextSpellFilterOk(f: unknown): boolean {
  if (f === undefined) return true;
  if (f === null || typeof f !== 'object' || Array.isArray(f)) return false;
  const rec = f as Record<string, unknown>;
  for (const [k, v] of Object.entries(rec)) {
    if (v === undefined) continue;
    if (!NEXT_SPELL_FILTER_FIELDS.includes(k)) return false;
    if (k === 'zone' && v !== 'stack') return false;
    if (k === 'stackKind' && v !== 'spell') return false;
    if (k === 'castFrom' && v !== 'hand') return false; // edh-d-50
    if (k === 'faceDown' && v !== true) return false; // edh-next-141: a spell cast face down
    if (k === 'anyOf' && !(Array.isArray(v) && v.every(nextSpellFilterOk))) return false;
  }
  return true;
}

const nextSpell: StepHandler<Step> = (cx, st) => {
  const players = resolvePlayers(cx, st.who);
  if (players.length === 0 || !nextSpellFilterOk(st.filter)) return NOTHING;
  if (st.rider !== 'keyword' && (st.lasting !== undefined || JSON.stringify(st.filter ?? {}).includes('castFrom'))) return NOTHING; // edh-d-50: fail closed (model/cap-walk.ts refuses it first)
  if (st.rider === 'keyword' && !nextSpellKeywordOk(st.keyword)) return NOTHING; // fail closed (model/cap-walk.ts refuses it first)
  // edh-next-38 (CR 601.2f, 107.3, 608.2h; Kaza, Elminster): "costs {X} less, where X is <quantity>": X is counted as the effect resolves and fixed then; none or zero changes nothing
  let mana = st.mana;
  if (st.rider === 'reduce' && st.amount !== undefined) {
    if (st.mana !== undefined) return NOTHING;
    const n = cardCount(cx, st.amount);
    if (n === undefined) return NOTHING;
    if (n === 0) return { performed: true, count: 0 };
    mana = [{ kind: 'generic', amount: n }] as NonNullable<typeof st.mana>;
  }
  if (st.rider === 'reduce' && !nextSpellReduceOk(mana)) return NOTHING; // edh-c-53: a generic reduction only
  if (st.rider === 'enters' && !nextSpellEntersOk(st.counters)) return NOTHING; // edh-d-95: a fixed number of counters of a kind (model/cap-walk.ts refuses anything else first)
  // edh-next-18 (CR 608.2h, 607.2d; Progenitor's Icon): "the chosen type" is fixed as the effect is applied, from the source's choice then; a source with no choice does nothing
  let filter = st.filter as Record<string, unknown> | undefined;
  const chosen = filter?.['chosen'] as { link: string; quality: string } | undefined;
  if (filter !== undefined && chosen !== undefined) {
    const value = cx.g.s.objects[cx.source.id]?.links?.[chosen.link]?.values?.[0];
    if (chosen.quality !== 'creatureType' || typeof value !== 'string' || st.rider !== 'flash') return NOTHING;
    const { chosen: _c, ...rest } = filter;
    filter = { ...rest, subtypes: [value] };
  }
  for (const player of players) {
    const keyword = st.rider === 'keyword' && st.keyword ? { sourceId: cx.source.id, keyword: JSON.parse(JSON.stringify(st.keyword)) as NonNullable<typeof st.keyword>, ...(st.lasting === true ? { lasting: true as const, lockId: `nsl${cx.g.newEffectId()}` } : {}) } : {};
    const reduce = st.rider === 'reduce' && mana ? { mana: JSON.parse(JSON.stringify(mana)) as NonNullable<typeof st.mana>, sourceId: cx.source.id } : {};
    const enters = st.rider === 'enters' && st.counters ? { counters: JSON.parse(JSON.stringify(st.counters)) as NonNullable<typeof st.counters>, sourceId: cx.source.id } : {}; // edh-d-95
    addNextSpellRider(cx.g, { player, controller: cx.controller, ...(filter !== undefined ? { filter: filter as typeof st.filter } : {}), rider: st.rider, ...keyword, ...reduce, ...enters });
    const what = st.rider === 'keyword' ? `${st.lasting === true ? 'and each later such spell ' : ''}has ${st.keyword?.keyword ?? 'a keyword'}` : st.rider === 'free' ? 'can be cast without paying its mana cost' : st.rider === 'life' ? 'can be cast by paying life equal to its mana value rather than its mana cost' : st.rider === 'reduce' ? 'costs less to cast' : st.rider === 'flash' ? 'can be cast as though it had flash' : st.rider === 'enters' ? 'enters with additional counters' : "can't be countered";
    const rules = st.rider === 'keyword' ? ['CR 601.2f', 'CR 611.2'] : st.rider === 'free' || st.rider === 'life' ? ['CR 118.9', 'CR 611.2'] : st.rider === 'reduce' ? ['CR 601.2f', 'CR 118.7', 'CR 611.2'] : st.rider === 'flash' ? ['CR 601.3b', 'CR 702.8a', 'CR 611.2'] : ['CR 101.2', 'CR 611.2'];
    cx.g.log(`The next ${st.filter === undefined ? 'spell' : 'such spell'} ${cx.g.player(player).name} casts this turn ${what}.`, { rules, level: 'action' });
  }
  return { performed: true, count: players.length };
};

export const NEXT_SPELL_HANDLERS: OpHandlers = { nextSpell };
