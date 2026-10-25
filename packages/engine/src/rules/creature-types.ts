/**
 * Every creature type (CR 205.3m), for the one question that needs the whole list: how many creature types are there among some objects when one of them is
 * a changeling and so has all of them (CR 702.73a). A type printed on a card but missing from the list still counts when a card has it
 * (rules/filter.ts#creatureTypesOf), so a set newer than the list only makes this set short until the list is refreshed. trek-10: the list is the rules' plus
 * the creature types the cards of the game's own sets print that the rules do not list yet (statics/subtypes.ts), which is the Star Trek set today.
 *
 * WP30: this used to be a second copy of the list in statics/subtypes.ts. There is one list now (statics/subtypes.ts#CREATURE_TYPES, checked against the
 * lexicon generated from the Comprehensive Rules); this module only keeps the set the evaluators read.
 */
import { CREATURE_TYPES } from '../statics/subtypes';

export const ALL_CREATURE_TYPES: ReadonlySet<string> = new Set(CREATURE_TYPES);
