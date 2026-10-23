/**
 * Hole grammars `Zone` ({zone, owner?}) and `Lib` (a library destination: top, bottom). Owner: WP6.
 *
 * Zones: CR 400.1 (the seven zones), CR 400.3 (owners), CR 401 (libraries). "your graveyard" is {zone:'graveyard', owner:'you'}; "a graveyard" has no owner; "target player's library" has the target marker as owner.
 */
import type { PlayerPred, PlayerRef, ZoneName } from '../../types/ability';
import type { Alt, HoleFn } from './core';
import { P, dedupe, phraseAt, predOf } from './core';
import { possessivePlayerAt } from './player';

const ZONE_WORDS: [string[], ZoneName][] = [
  [P('graveyard'), 'graveyard'], [P('graveyards'), 'graveyard'], [P('hand'), 'hand'], [P('hands'), 'hand'], [P('library'), 'library'], [P('libraries'), 'library'],
];
const LONE_ZONES: [string[], ZoneName][] = [
  [P('the battlefield'), 'battlefield'], [P('the stack'), 'stack'], [P('exile'), 'exile'], [P('the command zone'), 'command'],
];
const W_A = [P('a'), P('an')];
const W_ANY = P('any');
const W_ALL = P('all');
const W_GRAVEYARDS = P('graveyards');

export interface ZoneValue { zone: ZoneName; owner?: PlayerPred }

/** The `owner` of a zone phrase as a filter-style predicate. */
function ownerPred(r: PlayerRef): PlayerPred {
  return predOf(r);
}

export const zone: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  for (const [ws, z] of LONE_ZONES) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) out.push({ end: e, value: { zone: z } satisfies ZoneValue });
  }
  // "a graveyard", "all graveyards": a zone kind without an owner
  for (const [ws, z] of ZONE_WORDS) {
    for (const a of [...W_A, W_ALL, W_ANY]) {
      const p = phraseAt(ctx, pos, a);
      if (p < 0) continue;
      const e = phraseAt(ctx, p, ws);
      if (e >= 0 && z !== 'hand') out.push({ end: e, value: { zone: z } satisfies ZoneValue });
    }
  }
  // FAST3 T14: "graveyards" with no determiner ("up to three target cards from graveyards"): the zone kind of every player, no owner (CR 404.1), the same as
  // "all graveyards"; only the plural, so "from graveyard" stays unknown
  const bare = phraseAt(ctx, pos, W_GRAVEYARDS);
  if (bare >= 0) out.push({ end: bare, value: { zone: 'graveyard' } satisfies ZoneValue });
  // "<owner>'s graveyard"
  for (const o of possessivePlayerAt(ctx, pos)) {
    for (const [ws, z] of ZONE_WORDS) {
      const e = phraseAt(ctx, o.end, ws);
      if (e >= 0) out.push({ end: e, value: { zone: z, owner: ownerPred(o.ref) } satisfies ZoneValue });
    }
  }
  return dedupe(out);
};

const W_ON_TOP = [P('on top of'), P('on the top of')];
const W_ON_BOTTOM = [P('on the bottom of'), P('on bottom of')];
const W_LIBRARY = [P('library')];

/**
 * `Lib` is a library, in two forms that cannot be confused (design 6.3 hole table; the candidate grammar writes `search {lib:Lib}` and `of {lib:Lib}`):
 *   - the library as a PLACE: "your library", "target player's library", "its owner's library" => `{zone:'library', owner}` (no position);
 *   - a Destination fragment: "on top of your library", "on the bottom of its owner's library" => `{zone:'library', owner, position}`.
 * A template that needs the plain zone-with-owner of a general zone phrase ("your graveyard") uses `Zone`, which also takes the library.
 */
export const lib: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  for (const o of possessivePlayerAt(ctx, pos)) {
    const e = phraseAt(ctx, o.end, W_LIBRARY[0]!);
    if (e >= 0) out.push({ end: e, value: { zone: 'library', owner: o.ref } });
  }
  const forms: [readonly (readonly string[])[], 'top' | 'bottom'][] = [[W_ON_TOP, 'top'], [W_ON_BOTTOM, 'bottom']];
  for (const [leads, position] of forms) {
    for (const lead of leads) {
      const p = phraseAt(ctx, pos, lead);
      if (p < 0) continue;
      for (const o of possessivePlayerAt(ctx, p)) {
        const e = phraseAt(ctx, o.end, W_LIBRARY[0]!);
        if (e >= 0) out.push({ end: e, value: { zone: 'library', owner: o.ref, position } });
      }
    }
  }
  return dedupe(out);
};

