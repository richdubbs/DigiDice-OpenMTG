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

type Step = Extract<EffectStep, { op: 'nextSpell' }>;

/** The ObjectFilter fields a `nextSpell` filter may use: what the spell is (anything else: model/cap-walk.ts makes the step an unregistered form). */
export const NEXT_SPELL_FILTER_FIELDS: readonly string[] = ['types', 'allTypes', 'notTypes', 'subtypes', 'supertypes', 'colors', 'notColors', 'colorless', 'multicolored', 'anyOf', 'zone', 'stackKind'];

/** std-rx26: the keywords a `keyword` rider may give the next spell (CR 702.41a affinity, 702.51a convoke, 702.126a improvise); any other is refused. */
export const NEXT_SPELL_KEYWORDS: readonly string[] = ['affinity', 'convoke', 'improvise', 'cascade' /* pc-exile-play-3 (CR 702.85a) */, 'storm' /* pc-exile-play-3 (CR 702.40a) */];

/** std-rx26: is this a keyword a `keyword` rider can give (one of NEXT_SPELL_KEYWORDS; affinity with its filter, the others with no parameter)? */
export function nextSpellKeywordOk(k: unknown): boolean {
  if (k === null || typeof k !== 'object') return false;
  const r = k as Record<string, unknown>;
  if (r['kind'] !== 'keyword' || typeof r['keyword'] !== 'string' || !NEXT_SPELL_KEYWORDS.includes(r['keyword'])) return false;
  const extra = Object.keys(r).filter((x) => !['kind', 'keyword', 'text', 'filter'].includes(x));
  return extra.length === 0 && (r['keyword'] === 'affinity') === (r['filter'] !== undefined);
}

/** Does `f` use only NEXT_SPELL_FILTER_FIELDS (also inside `anyOf`)? */
export function nextSpellFilterOk(f: unknown): boolean {
  if (f === undefined) return true;
  if (f === null || typeof f !== 'object' || Array.isArray(f)) return false;
  const rec = f as Record<string, unknown>;
  for (const [k, v] of Object.entries(rec)) {
    if (v === undefined) continue;
    if (!NEXT_SPELL_FILTER_FIELDS.includes(k)) return false;
    if (k === 'zone' && v !== 'stack') return false;
    if (k === 'stackKind' && v !== 'spell') return false;
    if (k === 'anyOf' && !(Array.isArray(v) && v.every(nextSpellFilterOk))) return false;
  }
  return true;
}

const nextSpell: StepHandler<Step> = (cx, st) => {
  const players = resolvePlayers(cx, st.who);
  if (players.length === 0 || !nextSpellFilterOk(st.filter)) return NOTHING;
  if (st.rider === 'keyword' && !nextSpellKeywordOk(st.keyword)) return NOTHING; // fail closed (model/cap-walk.ts refuses it first)
  for (const player of players) {
    const keyword = st.rider === 'keyword' && st.keyword ? { sourceId: cx.source.id, keyword: JSON.parse(JSON.stringify(st.keyword)) as NonNullable<typeof st.keyword> } : {};
    addNextSpellRider(cx.g, { player, controller: cx.controller, ...(st.filter !== undefined ? { filter: st.filter } : {}), rider: st.rider, ...keyword });
    const what = st.rider === 'keyword' ? `has ${st.keyword?.keyword ?? 'a keyword'}` : st.rider === 'free' ? 'can be cast without paying its mana cost' : "can't be countered";
    const rules = st.rider === 'keyword' ? ['CR 601.2f', 'CR 611.2'] : st.rider === 'free' ? ['CR 118.9', 'CR 611.2'] : ['CR 101.2', 'CR 611.2'];
    cx.g.log(`The next ${st.filter === undefined ? 'spell' : 'such spell'} ${cx.g.player(player).name} casts this turn ${what}.`, { rules, level: 'action' });
  }
  return { performed: true, count: players.length };
};

export const NEXT_SPELL_HANDLERS: OpHandlers = { nextSpell };
