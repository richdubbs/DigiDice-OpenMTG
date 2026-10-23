/**
 * CMD2 (commander batch): cast triggers of the spell itself, "When you cast this spell, ..." (CR 113.6k, 601.2i, 603.2). Such an ability functions on the
 * stack: triggers/collect.ts collects the triggered abilities of spells whose `zone` includes 'stack' (the storm keyword's expansion, CR 702.40a, already
 * plays this way). `lower/trigger-zone.ts#offBattlefield` reads the zone (['stack']) and keeps the ability manual; this module says when it may be automated
 * instead, the way FAST5 T37 automates "When you cycle ~" (lower/ability.ts#triggered then requires the whole effect to be understood and no intervening "if").
 * Kept apart from trigger-zone.ts (owned by the graveyard-zone work, CR 113.6m) so that the two changes do not touch the same lines. Pure.
 */
import type { TriggerDef, ZoneName } from '../../types/ability';

// CMD2's reading of the text, kept for the other rounds that read a self trigger's text with it (p2-trigger-events-2's selfOffAndOnBattlefield, unmerged): copying
// or countering the spell and the mana spent to cast it are safe; any other mention of the spell, or a pronoun that may name it, is not
// Standard round 3, r3-trig: the end of the words is "not followed by a word character", not `\b`: "~" is no word character, so `\b` after it never matched
const CAST_SELF_SAFE = /\b(?:copy|counter) (?:it|~|this spell)(?![\w'~])|\bspent to cast (?:it|~|this spell)(?![\w'~])/gi;
const CAST_SELF_MENTION = /~|\b(?:it|its|itself|it's|this spell|this creature|this card|this permanent)\b/i;
/** Text outside quoted abilities: a granted ability functions on the object that gets it, not on this one (CR 113.6, 113.1c). */
const unquoted = (text: string): string => text.replace(/["“][^"”]*["”]/g, ' ');
/** CMD2's text test: does `rest` name the spell itself only to copy or counter it or to read the mana spent to cast it? */
export const castSelfTextSafe = (rest: string): boolean => !CAST_SELF_MENTION.test(unquoted(rest).replace(CAST_SELF_SAFE, ' '));

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const NESTED_ABILITY_KINDS: ReadonlySet<string> = new Set(['activated', 'triggered', 'static', 'keyword', 'mana', 'loyalty', 'chapter', 'manual']);

/**
 * p2-c-cast-zone-1 (CR 113.6k, 400.7, 707.10, 701.6a, 601.2h): does the lowered effect of a cast trigger name the spell itself only where that is read correctly from
 * the stack, where the ability functions: as what a `copy` or `counter` step acts on (the copy is of the spell, or of what it last was; countering it). The mana
 * spent to cast it (`{q:'manaSpent'}`) and how it was cast (`{cond:'wasCast'}`, "if it was kicked") name no object and read this spell. Any other `{ref:'self'}`,
 * `{ref:'event', role:'spell'}` (the cast event's spell is this spell) or `self` filter (the spell may have resolved into a permanent, a new object, by the time a later instruction would act on it) keeps the ability manual.
 * Replaces CMD2's reading of the text, which also refused every "it" ("search your library for a land card, put it onto the battlefield").
 */
export function castSelfProgramSafe(program: unknown): boolean {
  let safe = true;
  const walk = (v: unknown, parent: Rec | null, key: string | null): void => {
    if (!safe) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, parent, key); return; }
    if (!isRec(v)) return;
    // an ability inside the effect (a token's "Sacrifice this creature: Add {C}.", a granted ability) names its own object as `self`, not this spell (CR 113.1c, 113.6)
    if (parent !== null && typeof v['kind'] === 'string' && NESTED_ABILITY_KINDS.has(v['kind'])) return;
    // the cast event's spell is this spell too ("return it to your hand": `{ref:'event', role:'spell'}`), as is the object itself (`{ref:'self'}`)
    if (v['ref'] === 'self' || (v['ref'] === 'event' && v['role'] === 'spell')) {
      // a copy of the spell on the stack (not a token made from it: Osgood, Operation Double stays manual) or countering it
      const allowed = key === 'what' && parent !== null && ((parent['op'] === 'copy' && parent['result'] === 'spell') || parent['op'] === 'counter');
      if (!allowed) safe = false;
      return;
    }
    if (v['self'] === true || Object.keys(v).some((k) => k.startsWith('$'))) { safe = false; return; }
    for (const [k, x] of Object.entries(v)) walk(x, v, k);
  };
  walk(program, null, null);
  return safe;
}

/**
 * Is this the cast trigger of the spell itself in a form this parser automates: the one cast event by "you" ("When you cast this spell", optionally with a
 * "while" condition of the event)? `away` is what `offBattlefield` said about the trigger (the cast trigger of ~ functions on the stack: `zone` ['stack']). The
 * effect is judged once lowered (castSelfProgramSafe, p2-c-cast-zone-1), by lower/ability.ts#triggered's whole-effect check.
 */
export function castSelfAutomated(trigger: TriggerDef, away: { zone: ZoneName[] } | null, _rest?: string): boolean {
  if (away === null || away.zone.length !== 1 || away.zone[0] !== 'stack') return false;
  const [p] = trigger.on;
  if (trigger.on.length !== 1 || p === undefined || p.ev !== 'cast' || trigger.batch === true || trigger.first !== undefined || p.player !== 'you') return false;
  if (p.spell?.self !== true || Object.entries(p.spell).some(([k, v]) => v !== undefined && k !== 'self')) return false;
  return !(p.orCopy === true || p.nth !== undefined || p.nthMatching !== undefined || p.via !== undefined);
}
