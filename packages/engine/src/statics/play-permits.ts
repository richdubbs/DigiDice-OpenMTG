/**
 * FAST4 T31: play permissions for specific cards (CR 601.2a, 305.1, 611.2, 608.2c): "Exile the top card of your library. You may play that card this turn.",
 * "Mill a card. You may play that card this turn.", "You may play that card for as long as you control ~." A resolved `effect` step stores a permission
 * `{s:'permit', action:'play' | 'cast', who, of:{is:<the card>}}`; the effect handler fixes the card as it is created (effects/handlers/lasting-fix.ts, CR 611.2c),
 * so the permission names that object in that zone only: once the card leaves the zone it is a new object and the permission is gone (CR 400.7).
 *
 * What the permission changes (and nothing else; CR 601.3, 305.1): the card may be cast from the zone it is in (`cast`, `play` for a nonland card) or played as
 * a land from there (`play` for a land card, using a land play: CR 305.2), by the players of `who`, even if they don't own it. Timing, costs, land plays per
 * turn, "can't" effects and every other check of casting or playing stay as they are (actions/cast.ts#castCheck, actions/land.ts#landCheck). The cards are
 * offered by core/legal.ts.
 *
 * Only this one form is honored: a permission stored by a resolving effect whose `of` is exactly `{is: ...}` and that has no other optional field (`from`,
 * `asThough`, ...) but `laterTurn` (FAST5X E2: warp's "after the current turn has ended", CR 702.185a: from the next turn on, `feature:permit.<action>.laterTurn`).
 * Its capability is `permit:<action>.object` (model/cap-walk.ts); any other play or cast permission needs `permit:<action>` (and
 * `feature:permit.<action>.of`), which nothing registers, so a static "you may play lands from your graveyard" or "cast spells from the top of your library"
 * is never read as this (fail closed).
 *
 * FAST5X E29 adds, on these permissions for named objects: `anyManaType` ("..., and mana of any type can be spent to cast it", CR 609.4b: the spell's payment
 * may use mana of any type, actions/cast.ts via `anyManaTypePermit`) and `while` ("you may play it if you control a Wizard": the permission applies only while
 * the condition holds, judged each time it is read; capabilities `feature:permit.<action>.anyManaType` and `.while`). Its durations ("until the end of your
 * next turn", "until your next end step", "for as long as it remains exiled") are core/durations.ts's.
 *
 * FAST5X E14 adds the permissions for the card on top of a library ("You may cast creature spells from the top of your library", "You may play lands from the
 * top of your library", CR 401.5, 601.3, 305.1; `fromTop`, capability `permit:<action>.top`) and "You may look at the top card of your library any time"
 * (`lookAt`, capability `permit:lookAt`, read by core/view.ts#canSee). A top-card permission is for whichever card is on top now (CR 611.3a), is usable only
 * while the player may look at that card (castCheck and landCheck refuse a card the player can't see, CR 400.2), and its qualities (`of`) are checked on the
 * face being cast or played (topPermitFor, CR 601.3e).
 *
 * GY1 adds "You may play lands from your graveyard" as a static ability of an object (Crucible of Worlds; CR 305.1, 116.2a: a land is played "from the zone it
 * was in"; capability `permit:play.zone`): the players of `who` may play land cards they own from their own graveyard (CR 404.1). Each such play is a land
 * play like any other (CR 305.2, 305.2a: actions/land.ts#landCheck counts it and keeps the timing of CR 305.1 and 305.3); a land is never cast (CR 305.9), so
 * the permission never lets a card be cast. Only exactly that form is honored (isGraveyardLandPermit): any other `from`, `of`, `who` or optional field, or one
 * made by a resolving effect, is never read as this (fail closed; C10 below honors the resolved one and "play cards" too).
 *
 * C10 adds casting from the graveyard and playing cards from it (isGraveyardPermit; CR 601.3, 601.3e, 305.1, 404.1; capabilities `permit:cast.zone` and
 * `permit:play.zone`): "You may cast artifact spells from your graveyard by paying 3 life in addition to paying their other costs. If you cast a spell this
 * way, that artifact enters with a finality counter on it.", "Once during each of your turns, you may cast a creature spell from your graveyard", "During
 * your turn, you may play cards from your graveyard", "You may cast ~ from your graveyard" (the card's own static ability, CR 113.6), and the same
 * permissions made by a resolving effect while they last ("Until end of turn, you may cast creature spells from your graveyard", CR 611.2a; GY1 refused
 * those). The player casts the card from where it is with its normal costs and timing (actions/cast.ts#castCheck: CR 601.2a-i unchanged) plus, when the
 * permission says so, an additional cost (`addCost`, CR 601.2f, 118.8, `feature:permit.cast.addCost`), once each turn per source object (CR 400.7,
 * `feature:permit.cast.oncePerTurn`) and counters the permanent enters with (`entersWith`, CR 614.1c, `feature:permit.cast.entersWith`, applied by
 * effects/rule-replacements/permit-enters.ts). Several permissions that allow it in different ways are for the player to choose (CR 601.3): the cast
 * method `permission:<n>` (graveyardPermitUses).
 *
 * trek-11 adds "outside the game" as a place such a permission can name (CR 400.11, 400.11a-b; `PermissionDef.alsoOutside`, isPermanentPlayPermit): "Once during each of
 * your turns, you may play a permanent card you own from outside the game or from your graveyard" (The Holodeck). ONE graveyard permission (a `play` of the permanent
 * card types, once each turn) that also covers the cards the player owns outside the game (`GameState.outside`, their sideboard): its graveyard half is the ordinary one
 * (a land card is played through the `playLand` action, any other permanent card cast through `cast`), its outside half is the `playOutside` special action
 * (core/special/play-outside.ts), which stages the card (core/zones.ts#stageFromOutside) and runs the same land play or cast; both spend the same once-each-turn
 * counter, so a use in either place is the turn's (outsideCastUses, outsideLandKey). Only that one form is honored; any other use of the field is a form nothing registers.
 */
import type { CostDef, CounterSpec, Destination, ObjRef, PermissionDef } from '../types/ability';
import type { CardType } from '../types/card';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameState } from '../types/state';
import type { Chars } from '../rules/characteristics';
import { evalCondition, type EvalCx } from './match';
import { objectMatches, spellActor } from './rule-match';
import { anyZone, charsViewOf, cxOf, overlayZone, refIncludes, ruleContext, type CharsView, type RuleContext, type RuleSource } from './rule-sources';
import { readLink } from './links';
import { manaValue } from '../types/mana';

/** The capability names this module makes true (model/capabilities.ts adds them; model/cap-walk.ts emits them). */
export const PLAY_PERMIT_CAPABILITIES: readonly string[] = [
  'permit:play.object', 'permit:cast.object', 'feature:permit.play.laterTurn', 'feature:permit.cast.laterTurn',
  // FAST5X E14 (CR 401.5, 601.3, 305.1): the top card of a library
  'permit:play.top', 'permit:cast.top', 'feature:permit.cast.oncePerTurn', 'permit:lookAt',
  'feature:permit.play.zone.oncePerTurn', // std-rx27 (CR 305.2): a graveyard land permission once each turn (graveyardLandKey)
  // trek-11 (CR 400.11, 400.11a-b, 305.1, 601.3): "Once during each of your turns, you may play a permanent card you own from outside the game or from your graveyard"
  // (isPermanentPlayPermit; the `playOutside` special action, core/special/play-outside.ts, reads outsideCastUses and outsideLandKey)
  'feature:permit.play.zone.outside',
  // FAST5X E25 (CR 708.5, 609.4): "you may look at face-down creatures your opponents control any time" (core/view.ts#canSee, faceDownVisibleTo below)
  'permit:lookAt.faceDown',
  // CLOUD std-fdn (CR 609.4b): "You can spend mana of any type to cast creature spells" (a static ability; isSpendAnyTypePermit, actions/cast.ts)
  'permit:spendMana.anyTypeFor',
  'permit:spendMana.anyColorAbilities', // std-rx32 (CR 609.4b): isSpendAnyColorAbilitiesPermit, actions/activate.ts
  // FAST5X E29 (CR 609.4b): "and mana of any type can be spent to cast that spell"; "you may play it if you control a Kavu" (a condition read each time)
  'feature:permit.play.anyManaType', 'feature:permit.cast.anyManaType', 'feature:permit.play.while', 'feature:permit.cast.while',
  // GY1 (CR 305.1, 116.2a, 404.1): "You may play lands from your graveyard" (a static ability; isGraveyardLandPermit)
  'permit:play.zone',
  // C10 (CR 601.3, 601.3e, 601.2f, 614.1c): casting from the graveyard (isGraveyardPermit), its additional cost and "enters with" rider
  'permit:cast.zone', 'feature:permit.cast.addCost', 'feature:permit.cast.entersWith',
  // std-freecast-2 (CR 601.3, 614.1c, 205.1b): "you may cast a creature spell from your graveyard this turn. If you do, it enters with ... and is a Vampire in addition
  // to its other types" (a resolved effect's one-spell graveyard permission, `single`; `entersSubtypes`)
  'feature:permit.cast.zone.single', 'feature:permit.cast.entersSubtypes',
  // std-rx24 (CR 702.133a): jump-start's graveyard permission exiles the spell cast with it any time it would leave the stack (`exileOnLeave`; actions/cast.ts)
  'feature:permit.cast.exileOnLeave',
  // Cloud r3-mech (CR 702.187a-b, 305.1): mayhem with no cost (a land): "You may play this card from your graveyard if you discarded it this turn" (isDiscardedSelfPlayPermit)
  'permit:play.discardedSelf',
  // r3-cost (CR 118.9, 601.2b): an alternative cost a static ability gives other spells (isAltCostPermit, grantedAlternatives; actions/cast.ts)
  'permit:cast.alternative',
  // r5-refs (CR 607.2a, 601.3, 305.1): "You may play cards exiled with ~", a static ability of the object that exiled them (isLinkedPermit)
  'permit:play.linked', 'permit:cast.linked',
  // std-ru (CR 118.9, 202.3): "If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost" on such a permission (linkedPermitLifeCost)
  'feature:permit.play.linked.lifeCost', 'feature:permit.cast.linked.lifeCost',
  // std-exile-play-2-1 (CR 118.9, 202.3, 611.2a): the same rider on a resolved permission for named objects ("You may play those cards this turn. If you cast a
  // spell this way, pay life equal to its mana value rather than pay its mana cost."; isObjectPermit, permitLifeCost)
  'feature:permit.play.named.lifeCost', 'feature:permit.cast.named.lifeCost',
  // r5-repl (CR 614.1a, 400.7): "If that spell would be put into a graveyard, exile it instead" on a cast permission for named objects (graveyardInsteadPermit,
  // actions/cast.ts, effects/rule-replacements/permit-graveyard.ts)
  'feature:permit.cast.zone.graveyardInstead', // p2-graveyard-2 (CR 614.1a): ... and on a graveyard permission (graveyardPermitUses, actions/cast.ts)
  'feature:permit.cast.graveyardInstead',
  // r5-dig (CR 715.3): "you may cast it ... as an Adventure" (namedPermitAdventureOnly; actions/cast.ts)
  'feature:permit.cast.asAdventure',
  // std-rx3 (CR 118.9, 601.2b): "you may cast those cards without paying their mana costs" on a permission for named objects (isFreeCost, grantedAlternatives)
  'feature:permit.cast.free', 'feature:permit.play.free',
  // std-exile-play-2-3 (CR 118.9, 701.67a): "you may cast the exiled card ... by waterbending {X} rather than paying its mana cost, where X is its mana value" on a
  // permission for named objects (isWaterbendCost, grantedAlternatives)
  'feature:permit.cast.named.waterbend',
  // std-exile-play-2-4 (CR 611.2c-like): a resolved permission for the objects an `each` filter picks, locked as the effect begins (effects/handlers/lasting.ts)
  'feature:permit.play.lockedSet', 'feature:permit.cast.lockedSet',
  // std-rx27 (CR 607.2a, 601.3e, 609.4b, 118.9, 614.1c): a static linked cast permission with qualities and riders (isLinkedRiderPermit, linkedPermitUses)
  'feature:permit.cast.linked.of', 'feature:permit.cast.linked.anyManaType', 'feature:permit.cast.linked.oncePerTurn', 'feature:permit.cast.linked.entersWith',
  'feature:permit.cast.linked.free', 'feature:permit.cast.linked.thisTurn',
  'feature:permit.cast.linked.addCost', // std-exile-play-2-1 (CR 601.2f, 118.8): "by removing three counters from among creatures you control in addition to ..."

  // std-rx27 (CR 614.1c, 601.3e): "If you cast a creature spell this way, that creature enters with ..." on a top-card cast permission (topPermitFor)
  'feature:permit.cast.top.entersWith',
  // std-rx27 (CR 601.3, 305.1): "until end of turn, you may play a card exiled with ~": one card only (namedSingleKey; actions/cast.ts, actions/land.ts)
  'feature:permit.play.single', 'feature:permit.cast.single',
  // std-freecast-1 (CR 118.9, 601.2b, 601.2i, 102.1): "The first spell each player casts during each of their turns may be cast without paying its mana cost"
  // (isAltCostPermit with `firstSpellThisTurn`, grantedAlternatives)
  'feature:permit.cast.alternative.firstSpell',
  // std-freecast-5 (CR 702.170a, 702.170f, 116.2k): "You may plot nonland cards from the top of your library", "The top card of your library has plot. The plot cost is
  // equal to its mana cost." (isTopPlotPermit, topPlotUses; core/special/plot.ts)
  'permit:plot.top',
  // std-rx27 (CR 702.8a, 601.3b): "you may cast them as though they had flash" for the cards a linked ability exiled (statics/hooks.ts#castsAsInstant)
  'feature:permit.haveFlash.linked',
  // std-rx27 (CR 601.3, 305.1, 609.4b): "you may play cards you don't own with stash counters on them from exile" (isExileFilterPermit; linkedCandidates, linkedPermitUses)
  'permit:play.exile', 'permit:cast.exile', 'feature:permit.play.exile.anyManaType', 'feature:permit.cast.exile.anyManaType',
  // std-exile-play-1-1 (CR 118.9, 202.3): "If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost" on a top-card permission (topPermitFor)
  'feature:permit.play.top.lifeCost', 'feature:permit.cast.top.lifeCost',
  // std-exile-play-1-3 (CR 400.3, 601.2f, 614.1c): "players may play cards they exiled this way" (ownOnly), "Each spell cast this way costs {1} more to cast"
  // (namedPermitIncrease), "Each land played this way enters tapped" (namedPermitLandTapped), on permissions for named objects
  'feature:permit.play.ownOnly', 'feature:permit.cast.ownOnly', 'feature:permit.play.increase', 'feature:permit.cast.increase', 'feature:permit.play.landsEnterTapped',
  // p2-dig-1 (CR 401.2, 401.5): "Play with the top card of your library revealed" (core/view.ts#canSee, topCardRevealed below)
  'permit:revealTop',
];

/** The permission names exactly some objects: `of` is `{is}` alone and no other optional field is set. */
export function isObjectPermit(p: PermissionDef): boolean {
  if (p.action !== 'play' && p.action !== 'cast') return false;
  // std-rx3 (CR 118.9, 601.2b): "you may cast those cards without paying their mana costs": the one cost a permission for named objects may carry (isFreeCost)
  // std-exile-play-2-1 (CR 118.9): or "pay life equal to its mana value rather than pay its mana cost" (isLifeCostChange, namedLifeCost); std-exile-play-2-3 (CR 118.9,
  // 701.67a): or "by waterbending {N} rather than paying its mana cost" on a cast permission (isWaterbendCost, grantedAlternatives)
  // std-exile-play-1-3 (CR 601.2f): or "Each spell cast this way costs {1} more to cast", a fixed generic increase (isIncreaseCost, namedPermitIncrease)
  const altCost = p.costChange !== undefined && !isFreeCost(p.costChange) && !isLifeCostChange(p.costChange) && !(p.action === 'cast' && isWaterbendCost(p.costChange)) && !isIncreaseCost(p.costChange);
  if (p.from !== undefined || p.asThough !== undefined || p.count !== undefined || altCost || p.grants !== undefined) return false;
  if (p.fromTop !== undefined || p.oncePerTurn !== undefined) return false; // FAST5X E14: a top-card permission (below)
  if (p.addCost !== undefined || p.entersWith !== undefined) return false; // C10: honored on graveyard permissions only (fail closed)
  if (p.single !== undefined && p.single !== true) return false; // std-rx27: "a card": one card only (singleKey)
  if (p.ownOnly !== undefined && p.ownOnly !== true) return false; // std-exile-play-1-3: "cards they exiled this way" (namedObjects)
  if (p.landsEnterTapped !== undefined && (p.landsEnterTapped !== true || p.action !== 'play')) return false; // std-exile-play-1-3: a land is played, never cast (CR 305.1)
  if (p.graveyardInstead !== undefined && p.action !== 'cast') return false; // r5-repl: a spell cast with it only (a land played is never a spell, CR 305.1; wave 8 review: was cited as 305.9)
  // FAST5X E29: `anyManaType` (CR 609.4b) and `while` (a condition) are honored here; r5-repl: `graveyardInstead` (CR 614.1a) too
  const of = p.of as Record<string, unknown> | undefined;
  return of !== undefined && Object.keys(of).length === 1 && of['is'] !== undefined;
}

/**
 * std-rx3 (CR 118.9, 601.2b): is this cost change exactly "without paying its mana cost" (`{kind:'set', cost:{}}`: an alternative cost of nothing, CR 118.9)? A
 * permission for named objects with it lets the player cast them only that way (actions/cast.ts#castCheckIn) and offers the alternative (grantedAlternatives).
 */
export function isFreeCost(c: PermissionDef['costChange']): boolean {
  if (c === undefined || c.kind !== 'set' || c.cost === undefined) return false;
  const rec = c as unknown as Record<string, unknown>;
  const cost = c.cost as unknown as Record<string, unknown>;
  return Object.keys(rec).every((k) => rec[k] === undefined || k === 'kind' || k === 'cost') && Object.keys(cost).every((k) => cost[k] === undefined);
}

/**
 * std-exile-play-2-3 (CR 118.9, 701.67a, 202.3): is this cost change exactly "by waterbending {N} rather than paying its mana cost", N a whole number (the card's mana
 * value, fixed as the resolved effect began: effects/handlers/lasting-fix.ts)? `{kind:'set', cost:{other:[{kind:'action', action:'waterbend', arg:N}]}}` and nothing
 * else. A permission for named objects with it lets the player cast them only for that alternative cost (grantedAlternatives, actions/cast.ts#castCheckIn).
 */
export function isWaterbendCost(c: PermissionDef['costChange']): boolean {
  if (c === undefined || c.kind !== 'set' || c.cost === undefined) return false;
  const rec = c as unknown as Record<string, unknown>;
  const cost = c.cost as unknown as Record<string, unknown>;
  if (Object.keys(rec).some((k) => rec[k] !== undefined && k !== 'kind' && k !== 'cost') || Object.keys(cost).some((k) => cost[k] !== undefined && k !== 'other')) return false;
  const parts = c.cost.other ?? [];
  const p = parts[0] as unknown as Record<string, unknown> | undefined;
  return parts.length === 1 && p !== undefined && p['kind'] === 'action' && p['action'] === 'waterbend' && Object.keys(p).length === 3
    && typeof p['arg'] === 'number' && Number.isInteger(p['arg']) && (p['arg'] as number) >= 0;
}

/**
 * The objects a stored permission names, as the effect handler fixed them (a `fixed` reference: id and zone). std-exile-play-1-3 (CR 400.3): for `player`, only the
 * ones they own when the permission says so (`ownOnly`, "players may play cards they exiled this way").
 */
function namedObjects(p: PermissionDef, s: GameState, player: PlayerId): { id: ObjectId; zone: string }[] {
  const is = p.of?.is as ObjRef | undefined;
  if (is === undefined || is.ref !== 'fixed' || !('objects' in is)) return [];
  const all = (is.objects as { id: ObjectId; zone: string }[]) ?? [];
  return p.ownOnly === true ? all.filter((h) => s.objects[h.id]?.owner === player) : all;
}

/** std-exile-play-1-3 (CR 601.2f): exactly "costs {N} more to cast", a cost increase of generic mana only (`{kind:'increase', mana}`). */
export function isIncreaseCost(c: PermissionDef['costChange']): boolean {
  if (c === undefined || c.kind !== 'increase' || !Array.isArray(c.mana) || c.mana.length === 0) return false;
  const rec = c as unknown as Record<string, unknown>;
  return Object.keys(rec).every((k) => rec[k] === undefined || k === 'kind' || k === 'mana') && c.mana.every((m) => m.kind === 'generic' && typeof m.amount === 'number' && m.amount > 0);
}

/** The permissions for named objects that let `player` play (`land`) or cast `id` now, each with its source (the checks of namedPermitted). */
function namedUses(s: GameState, player: PlayerId, id: ObjectId, land: boolean): PermissionDef[] {
  const ctx = ruleContext(s);
  const o = s.objects[id];
  if (!ctx || !o) return [];
  const out: PermissionDef[] = [];
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'permit' || !isObjectPermit(e) || (land && e.action !== 'play')) continue;
    if (e.laterTurn === true && !(src.startedTurn !== undefined && s.turn.number > src.startedTurn)) continue;
    if (!refIncludes(cxOf(ctx, src), e.who, player)) continue;
    if (e.while !== undefined && !evalCondition(cxOf(ctx, src), e.while)) continue;
    if (e.single === true && (s.turnActivations[singleKeyOf(src)] ?? 0) >= 1) continue;
    if (namedObjects(e, s, player).some((h) => h.id === id && h.zone === o.zone)) out.push(e);
  }
  return out;
}

/**
 * std-exile-play-1-3 (CR 601.2f, 601.3): the cost increase of a spell `player` casts from `id` with a permission for named objects that says "Each spell cast this way
 * costs {1} more to cast" (Lightstall Inquisitor), as an additional mana cost; null when no such permission applies, or when another permission for the card that
 * has no increase applies too (the player casts it with that one, CR 601.3).
 */
export function namedPermitIncrease(s: GameState, player: PlayerId, id: ObjectId): CostDef | null {
  if (!s.continuousEffects.some((r) => r.effect.s === 'permit' && r.effect.costChange?.kind === 'increase')) return null;
  const uses = namedUses(s, player, id, false);
  if (uses.length === 0 || uses.some((e) => !isIncreaseCost(e.costChange))) return null;
  // trek-7 (CR 601.3; Zero, Incorporeal Sensate exiles Eternal Scourge, "You may cast this card from exile."): the player casts a card from exile with the permission of their
  // choosing: the card's own, with no increase ("a spell cast this way" is cast through the other one), is always the cheaper way
  if (exileFilterCovers(s, player, id)) return null;
  return { mana: [...uses[0]!.costChange!.mana!] };
}

/** trek-7 (CR 113.6, 601.3): does a static ability that lets `player` cast cards from exile by a description (isExileFilterPermit, "You may cast this card from exile") cover `id`? */
function exileFilterCovers(s: GameState, player: PlayerId, id: ObjectId): boolean {
  const o = s.objects[id];
  if (!o || o.kind !== 'card' || o.zone !== 'exile') return false;
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return ctx.sources.some((src) => {
    const e = src.effect;
    return e.s === 'permit' && isExileFilterPermit(e) && src.source !== null && src.order[1] === 0 && refIncludes(cxOf(ctx, src), e.who, player) && exileFilterNames(ctx, s, src, e, id);
  });
}

/**
 * std-exile-play-1-3 (CR 614.1c, 305.1): does the land `id` `player` plays now enter tapped because the permissions for named objects that let them play it all say
 * "Each land played this way enters tapped"? False when one without it applies (the player plays it with that one, CR 601.3) or none does.
 */
export function namedPermitLandTapped(s: GameState, player: PlayerId, id: ObjectId): boolean {
  if (!s.continuousEffects.some((r) => r.effect.s === 'permit' && r.effect.landsEnterTapped === true)) return false;
  const uses = namedUses(s, player, id, true);
  return uses.length > 0 && uses.every((e) => e.landsEnterTapped === true);
}

/**
 * The objects `player` may play (`land`: as a land) or cast now because of a permission of this kind, each still the same object in the same zone (CR 400.7).
 * `cast` permissions let a player cast the card, never play it as a land (CR 305.9: a land isn't cast).
 */
export function permittedObjects(s: GameState, player: PlayerId, land: boolean, paidOnly = false): ObjectId[] {
  // FAST5X E14: and the card on top of the player's library when a top-card permission may let them play or cast it (its qualities: castCheck, landCheck)
  // (std-rx3: `paidOnly` leaves out the permissions that let a card be cast only without paying its mana cost, isFreeCost)
  const named = namedPermitted(s, player, land, paidOnly);
  const top = topCandidates(s, player, land);
  const out = top.length === 0 ? named : [...named, ...top.filter((id) => !named.includes(id))];
  // GY1: and the cards in the player's own graveyard when a static "you may play lands from your graveyard" of theirs functions (land plays only, CR 305.9)
  // C10: and, to be cast, when a graveyard cast permission of theirs applies ("You may cast artifact spells from your graveyard"; qualities: castCheck)
  const gy = graveyardCandidates(s, player, land);
  const withGy = gy.length === 0 ? out : [...out, ...gy.filter((id) => !out.includes(id))];
  // r5-refs: and the cards a static "you may play cards exiled with ~" of one of the player's permanents names (linkedCandidates)
  const linked = linkedCandidates(s, player, land, paidOnly);
  return linked.length === 0 ? withGy : [...withGy, ...linked.filter((id) => !withGy.includes(id))];
}

function namedPermitted(s: GameState, player: PlayerId, land: boolean, paidOnly = false): ObjectId[] {
  if (!s.continuousEffects.some((r) => r.effect.s === 'permit')) return [];
  const ctx = ruleContext(s);
  if (!ctx) return [];
  const out: ObjectId[] = [];
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'permit' || !isObjectPermit(e) || (land && e.action !== 'play')) continue;
    // std-rx3: a land is played, never cast, so a free play permission plays it as any other (std-exile-play-2-3: a waterbend cost is an alternative cost only too;
    // std-exile-play-2-1: a life cost is how the card is cast with it, paid in castCheck; std-exile-play-1-3: an increase is paid with the mana cost)
    if (paidOnly && !land && e.costChange !== undefined && !isLifeCostChange(e.costChange) && !isIncreaseCost(e.costChange)) continue;
    // FAST5X E2 (CR 702.185a): "after the current turn has ended": only on a later turn than the one the resolved effect began in (a static ability has no
    // beginning, so such a permission of one never applies: fail closed)
    if (e.laterTurn === true && !(src.startedTurn !== undefined && s.turn.number > src.startedTurn)) continue;
    if (!refIncludes(cxOf(ctx, src), e.who, player)) continue;
    if (e.while !== undefined && !evalCondition(cxOf(ctx, src), e.while)) continue; // FAST5X E29: "you may play it if you control a Kavu", judged now
    if (e.single === true && (s.turnActivations[singleKeyOf(src)] ?? 0) >= 1) continue; // std-rx27: "a card": its one card was played this way
    for (const h of namedObjects(e, s, player)) {
      const o = s.objects[h.id];
      if (o !== undefined && o.zone === h.zone && o.kind === 'card' && o.zone !== 'battlefield' && o.zone !== 'stack' && !out.includes(h.id)) out.push(h.id);
    }
  }
  return out;
}

/** std-rx27: the counter of a one-card permission (`single`): its source's order, stable while the effect lasts. */
const singleKeyOf = (src: RuleSource): string => `single:${src.order.join('.')}`;

/**
 * std-rx27 (CR 601.3, 305.1): the counter to spend when `player` plays (`land`) or casts `id` with a permission for named objects, when every such permission
 * that allows it now is a one-card one (`single`); null when one without that limit allows it (the player uses that one, which spends nothing) or none does.
 * The first one-card permission in timestamp order is the one used.
 */
export function namedSingleKey(s: GameState, player: PlayerId, id: ObjectId, land: boolean): string | null {
  if (!s.continuousEffects.some((r) => r.effect.s === 'permit' && r.effect.single === true)) return null;
  const ctx = ruleContext(s);
  const o = s.objects[id];
  if (!ctx || !o) return null;
  let key: string | null = null;
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'permit' || !isObjectPermit(e) || (land && e.action !== 'play')) continue;
    if (e.laterTurn === true && !(src.startedTurn !== undefined && s.turn.number > src.startedTurn)) continue;
    if (!refIncludes(cxOf(ctx, src), e.who, player)) continue;
    if (e.while !== undefined && !evalCondition(cxOf(ctx, src), e.while)) continue;
    if (!namedObjects(e, s, player).some((h) => h.id === id && h.zone === o.zone)) continue;
    if (e.single !== true) return null;
    const k = singleKeyOf(src);
    if ((s.turnActivations[k] ?? 0) >= 1) continue;
    key ??= k;
  }
  return key;
}

/**
 * FAST5X E29 (CR 609.4b): does a permission that names `id` and lets `player` cast it now also say "mana of any type can be spent to cast that spell"? The
 * player chooses which permission they cast it with (CR 601.3); the one with the rider only allows more ways to pay, so it is the one used.
 */
export function anyManaTypePermit(s: GameState, player: PlayerId, id: ObjectId): boolean {
  if (!s.continuousEffects.some((r) => r.effect.s === 'permit' && r.effect.anyManaType === true)) return false;
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return ctx.sources.some((src) => {
    const e = src.effect;
    if (e.s !== 'permit' || e.anyManaType !== true || !isObjectPermit(e) || !refIncludes(cxOf(ctx, src), e.who, player)) return false;
    if (e.laterTurn === true && !(src.startedTurn !== undefined && s.turn.number > src.startedTurn)) return false;
    if (e.while !== undefined && !evalCondition(cxOf(ctx, src), e.while)) return false;
    return namedObjects(e, s, player).some((h) => h.id === id && s.objects[id]?.zone === h.zone);
  });
}

/**
 * r5-repl (CR 614.1a, 400.7): where a spell `player` casts from this object goes instead of a graveyard because a permission that names it says so ("You may
 * cast it this turn. If that spell would be put into a graveyard, exile it instead."), with the permission's source name for the log; undefined when no such
 * permission of `player`'s functions. A "your graveyard" permission (`yours`) applies only to a card `player` owns (the spell goes to its owner's graveyard,
 * CR 404.1). Several such permissions: the first in timestamp order (they would all say the same in the printed cards).
 */
export function graveyardInsteadPermit(s: GameState, player: PlayerId, id: ObjectId): { to: Destination; source: string } | undefined {
  if (!s.continuousEffects.some((r) => r.effect.s === 'permit' && r.effect.graveyardInstead !== undefined)) return undefined;
  const ctx = ruleContext(s);
  if (!ctx) return undefined;
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'permit' || e.action !== 'cast' || e.graveyardInstead === undefined || !isObjectPermit(e) || !refIncludes(cxOf(ctx, src), e.who, player)) continue;
    if (e.laterTurn === true && !(src.startedTurn !== undefined && s.turn.number > src.startedTurn)) continue;
    if (e.while !== undefined && !evalCondition(cxOf(ctx, src), e.while)) continue;
    if (!namedObjects(e, s, player).some((h) => h.id === id && s.objects[id]?.zone === h.zone)) continue;
    if (e.graveyardInstead.yours === true && s.objects[id]?.owner !== player) continue;
    return { to: JSON.parse(JSON.stringify(e.graveyardInstead.to)) as Destination, source: src.name };
  }
  return undefined;
}

/**
 * May `player` cast (or, with `land`, play as a land) this object from where it is because an effect allows it? For the card on top of the player's library
 * (FAST5X E14) "yes" may mean only that some top-card permission could: unless `namedPermit` holds, the caller checks the qualities on the face with
 * `topPermitFor` (CR 601.3e).
 */
export function playPermitted(s: GameState, player: PlayerId, id: ObjectId, land: boolean): boolean {
  return permittedObjects(s, player, land).includes(id);
}

/**
 * std-rx3 (CR 118.9, 601.2b, 601.3): may `player` cast `id` from where it is paying its costs as usual? False when only permissions that say "without paying its
 * mana cost" let them cast it (the card may then be cast for that alternative cost only, grantedAlternatives).
 */
export function paidCastPermitted(s: GameState, player: PlayerId, id: ObjectId): boolean {
  return permittedObjects(s, player, false, true).includes(id);
}

/**
 * r5-dig (CR 715.3, 715.3a): do the permissions that name `id` and let `player` cast it now all say "as an Adventure"? Then the card may be cast this way only as
 * its Adventure (actions/cast.ts); false when none applies or one of them lets it be cast as any face.
 */
export function namedPermitAdventureOnly(s: GameState, player: PlayerId, id: ObjectId): boolean {
  if (!s.continuousEffects.some((r) => r.effect.s === 'permit' && r.effect.asAdventure === true)) return false;
  const ctx = ruleContext(s);
  if (!ctx) return false;
  let any = false;
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'permit' || !isObjectPermit(e) || !refIncludes(cxOf(ctx, src), e.who, player)) continue;
    if (e.laterTurn === true && !(src.startedTurn !== undefined && s.turn.number > src.startedTurn)) continue;
    if (e.while !== undefined && !evalCondition(cxOf(ctx, src), e.while)) continue;
    if (!namedObjects(e, s, player).some((h) => h.id === id && s.objects[id]?.zone === h.zone)) continue;
    if (e.asAdventure !== true) return false;
    any = true;
  }
  return any;
}

/** FAST5X E14: is `id` allowed by a permission that names it (FAST4 T31), so that no top-card permission is needed? */
export function namedPermit(s: GameState, player: PlayerId, id: ObjectId, land: boolean): boolean {
  return namedPermitted(s, player, land).includes(id);
}

// ---- FAST5X E14: the top card of a library (CR 401.5, 601.3, 305.1) ------------------------------------------------------------------------------------

/** The optional fields of a permission (a `lookAt` honored here has none of them). */
const OPTIONAL_FIELDS = ['of', 'from', 'asThough', 'count', 'costChange', 'grants', 'laterTurn', 'fromTop', 'oncePerTurn', 'anyManaType', 'while', 'addCost', 'entersWith', 'graveyardInstead', 'firstSpellThisTurn', 'plotCost'] as const;

/**
 * FAST5X E14: a permission for the card on top of a library: "You may cast creature spells from the top of your library", "You may play lands from the top of
 * your library", "Once each turn, you may cast an instant or sorcery spell from the top of your library" (CR 601.3, 305.1). `of` (the qualities, CR 601.3e)
 * and, for `cast`, `oncePerTurn` are the only other fields honored (capability `permit:<action>.top`, `feature:permit.cast.oncePerTurn`).
 */
export function isTopPermit(p: PermissionDef): boolean {
  if ((p.action !== 'play' && p.action !== 'cast') || p.fromTop !== true) return false;
  if (p.from !== undefined || p.asThough !== undefined || p.count !== undefined || p.grants !== undefined || p.laterTurn !== undefined) return false;
  // std-exile-play-1-1 (CR 118.9): the one cost honored here is "pay life equal to its mana value rather than pay its mana cost" (topPermitFor)
  if (p.costChange !== undefined && !isLifeCostChange(p.costChange)) return false;
  if (p.anyManaType !== undefined || p.while !== undefined) return false; // FAST5X E29: honored on named objects only
  if (p.addCost !== undefined) return false; // C10: honored on graveyard permissions only (fail closed)
  // std-rx27 (CR 614.1c): "If you cast a creature spell this way, that creature enters with ...": a cast permission's rider, for the spells `entersWithIf` describes
  if (p.entersWith !== undefined && !(p.action === 'cast' && p.entersWithIf !== undefined && validCounters(p.entersWith))) return false;
  if (p.entersWithIf !== undefined && p.entersWith === undefined) return false;
  if (p.graveyardInstead !== undefined) return false; // r5-repl: honored on named objects only (fail closed)
  return p.oncePerTurn === undefined || p.action === 'cast';
}

/** "You may look at the top card of your library any time" (CR 401.5): `lookAt` with no optional field. */
const isLookAt = (p: PermissionDef): boolean => p.action === 'lookAt' && OPTIONAL_FIELDS.every((k) => p[k] === undefined);

/** The actions during which a top card that changes can't be looked at until the action is finished (CR 401.5: casting, activating, a special action). */
const LOOK_FROZEN: ReadonlySet<string> = new Set(['cast', 'activate', 'playLand', 'special']);

/**
 * FAST5X E14 (CR 401.2, 401.5, 609.4): may `viewer` look at this library card now? Only the top card of the viewer's own library, while a `lookAt` permission
 * of theirs functions ("You may look at the top card of your library any time": the players of `who`, each at their own library). CR 401.5: if the top card
 * changes while that player is casting a spell, activating an ability or taking a special action, the new top card can't be looked at until the action is
 * finished: during a suspended action of that kind (the state it started from is `suspended.base`) only the card that was on top then may be looked at.
 * Nobody else sees it (core/view.ts#canSee: a library is hidden, CR 400.2).
 */
export function topCardVisibleTo(s: GameState, id: ObjectId, owner: PlayerId, viewer: PlayerId): boolean {
  if (owner !== viewer || s.zones.library[owner]?.[0] !== id) return false;
  const susp = s.suspended;
  if (susp !== null && susp !== undefined && LOOK_FROZEN.has(susp.action.type) && susp.base.zones.library[owner]?.[0] !== id) return false;
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return ctx.sources.some((src) => src.effect.s === 'permit' && isLookAt(src.effect) && refIncludes(cxOf(ctx, src), src.effect.who, owner));
}

// ---- std-freecast-5: plot from the top of your library (CR 702.170a, 702.170f, 116.2k, 401.5) -------------------------------------------------------------

/**
 * std-freecast-5: is this a top-card plot permission this module honors? Action 'plot', `fromTop`, `who` exactly "you", and exactly one of `of` ("You may plot
 * nonland cards from the top of your library": which cards) or `plotCost: 'manaCost'` ("The top card of your library has plot. The plot cost is equal to its mana
 * cost."); no other field (fail closed).
 */
export function isTopPlotPermit(p: PermissionDef): boolean {
  if (p.s !== 'permit' || p.action !== 'plot' || p.fromTop !== true) return false;
  const rec = p as unknown as Record<string, unknown>;
  if (Object.keys(rec).some((k) => rec[k] !== undefined && !['s', 'who', 'action', 'fromTop', 'of', 'plotCost'].includes(k))) return false;
  const who = p.who as unknown as Record<string, unknown>;
  if (Object.keys(who).filter((k) => who[k] !== undefined).length !== 1 || who['ref'] !== 'you') return false;
  if (p.plotCost !== undefined && p.plotCost !== 'manaCost') return false;
  return (p.of === undefined) !== (p.plotCost === undefined);
}

/**
 * std-freecast-5 (CR 702.170a, 702.170f, 401.5): the top card of `player`'s library when a static ability lets them plot it from there now (a permission with `of`
 * the card matches), and the plot costs it has: its own plot costs (`printed`, read from its characteristics by the caller) and, for each "has plot. The plot cost
 * is equal to its mana cost" permission, its mana cost (none for a card with no mana cost). Only while the player may look at that card (CR 400.2: fail closed,
 * a card nobody can see is never offered); null when none applies. The source must have the ability (a static ability of an object, CR 113.6, 611.3a).
 */
export function topPlotUses(s: GameState, player: PlayerId): { id: ObjectId; manaCost: boolean } | null {
  const id = s.zones.library[player]?.[0];
  const o = id !== undefined ? s.objects[id] : undefined;
  const ctx = ruleContext(s);
  if (!ctx || !o || o.kind !== 'card' || o.owner !== player) return null;
  let allowed = false;
  let manaCost = false;
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'permit' || !isTopPlotPermit(e) || src.source === null || src.order[1] !== 0) continue;
    if (!refIncludes(cxOf(ctx, src), e.who, player)) continue;
    if (e.plotCost === 'manaCost') { manaCost = true; continue; }
    const cx: EvalCx = { s, all: ctx.view, source: src.source, controller: src.controller };
    if (objectMatches(cx, id!, anyZone(e.of!)) === true) allowed = true; // a filter the hooks can't evaluate matches nothing (fail closed)
  }
  if (!allowed || !topCardVisibleTo(s, id!, player, player)) return null;
  return { id: id!, manaCost };
}

/** p2-dig-1: "Play with the top card of your library revealed" / "Players play with the top card of their libraries revealed": `revealTop` with no optional field. */
const isRevealTop = (p: PermissionDef): boolean => p.action === 'revealTop' && OPTIONAL_FIELDS.every((k) => p[k] === undefined);

/**
 * p2-dig-1 (CR 401.2, 401.5, 609.4): is this library card revealed to every player now? Only the card on top of its owner's library while a `revealTop` permission whose
 * `who` includes the owner functions ("play with the top card of your library revealed": each player of `who` at their own library). CR 401.5: if the top card changes
 * while its owner is casting a spell, activating an ability or taking a special action, the new top card is not revealed until the action is finished (as for
 * topCardVisibleTo). Read by core/view.ts#canSee for every viewer.
 */
export function topCardRevealed(s: GameState, id: ObjectId, owner: PlayerId): boolean {
  if (s.zones.library[owner]?.[0] !== id) return false;
  const susp = s.suspended;
  if (susp !== null && susp !== undefined && LOOK_FROZEN.has(susp.action.type) && susp.base.zones.library[owner]?.[0] !== id) return false;
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return ctx.sources.some((src) => src.effect.s === 'permit' && isRevealTop(src.effect) && refIncludes(cxOf(ctx, src), src.effect.who, owner));
}

/**
 * FAST5X E25: a permission to look at face-down permanents, "You may look at face-down creatures your opponents control any time", "until end of turn, you may
 * look at face-down creatures you don't control any time": `lookAt` whose only optional field is `of`, a filter that says `faceDown: true` (model/cap-walk.ts
 * names it `permit:lookAt.faceDown`).
 */
export const isFaceDownLook = (p: PermissionDef): boolean =>
  p.action === 'lookAt' && p.of !== undefined && p.of.faceDown === true && OPTIONAL_FIELDS.every((k) => k === 'of' || p[k] === undefined);

/**
 * FAST5X E25 (CR 708.5, 609.4, 400.2): may `viewer` look at this face-down permanent now? CR 708.5 lets only its controller look at it; a `lookAt` permission of
 * the viewer whose `of` matches the permanent (judged on what everybody sees of it: a face-down 2/2 creature, its controller) lets that player look too, for as
 * long as the permission functions (a static ability, or a resolved effect while it lasts). Nobody else sees it.
 */
export function faceDownVisibleTo(s: GameState, id: ObjectId, viewer: PlayerId): boolean {
  const o = s.objects[id];
  if (!o || !o.faceDown || o.zone !== 'battlefield' || o.kind === 'ability') return false;
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return ctx.sources.some((src) => {
    const e = src.effect;
    if (e.s !== 'permit' || !isFaceDownLook(e)) return false;
    const cx = cxOf(ctx, src);
    return refIncludes(cx, e.who, viewer) && objectMatches(cx, id, e.of!) === true;
  });
}

/** One top-card permission that could let `player` play or cast a card: its source and the key of its once-each-turn counter (null: no limit). */
interface TopHit {
  readonly src: RuleSource;
  readonly p: PermissionDef;
  readonly key: string | null;
}

/**
 * The top-card permissions that apply to `id` for `player` (their qualities not checked yet): the card is on top of the player's own library (CR 401.5, 400.3)
 * and the permission is the player's (`who`), for a land play (`land`: `play` only, CR 305.9) or a cast (`play` for a nonland card is casting it, CR 601.3).
 * A once-each-turn permission whose use this turn is spent is left out; one of a resolved effect or with no source object is never honored (fail closed).
 */
function topHits(ctx: RuleContext, s: GameState, player: PlayerId, id: ObjectId, land: boolean): TopHit[] {
  if (s.zones.library[player]?.[0] !== id) return [];
  const out: TopHit[] = [];
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'permit' || !isTopPermit(e) || (land && e.action !== 'play')) continue;
    if (!refIncludes(cxOf(ctx, src), e.who, player)) continue;
    let key: string | null = null;
    if (e.oncePerTurn === true) {
      if (src.source === null || src.order[1] !== 0) continue; // a static ability of an object only
      key = `${src.source}|top:${src.order[3]}:${src.order[4]}`;
      if ((s.turnActivations[key] ?? 0) >= 1) continue; // CR 601.3: "once each turn"
    }
    out.push({ src, p: e, key });
  }
  return out;
}

/** The card on top of `player`'s library when a top-card permission could let them play it (`land`) or cast it now (qualities checked by castCheck). */
function topCandidates(s: GameState, player: PlayerId, land: boolean): ObjectId[] {
  const top = s.zones.library[player]?.[0];
  if (top === undefined) return [];
  const ctx = ruleContext(s);
  if (!ctx || topHits(ctx, s, player, top, land).length === 0) return [];
  return [top];
}

/**
 * FAST5X E14: which top-card permission lets `player` cast (or, with `land`, play as a land) the card `id`, seen as `chars` (the face being cast or played:
 * CR 601.3e, 712.12)? Null when none does. A permission without a once-each-turn limit is used first (the player chooses which permission applies, CR 601.3;
 * using one without a limit spends nothing), else the first once-each-turn one in timestamp order; `key` is its counter, which actions/cast.ts#castSpell
 * spends as the card moves to the stack.
 */
export function topPermitFor(s: GameState, player: PlayerId, id: ObjectId, land: boolean, chars: Chars): TopUse | null {
  const ctx = ruleContext(s);
  const o = s.objects[id];
  if (!ctx || !o || o.zone !== 'library') return null;
  let view: CharsView | undefined;
  let found: TopUse | undefined;
  for (const h of topHits(ctx, s, player, id, land)) {
    let ok = h.p.of === undefined;
    if (!ok) {
      // CR 601.3e: a spell is judged as the spell it would be, on the stack (the haveFlash test of statics/hooks.ts#castsAsInstant); a land as the face played
      view ??= land ? ctx.view.with(s, new Map([[id, chars]])) : ctx.view.with(overlayZone(s, id, 'stack'), new Map([[id, chars]]));
      const cx: EvalCx = { s: view.s, all: view, source: h.src.source, controller: h.src.controller };
      ok = objectMatches(cx, id, h.p.of!, land ? undefined : spellActor(o)) === true; // a filter the hooks can't evaluate matches nothing (fail closed)
    }
    if (!ok) continue;
    // std-rx27 (CR 614.1c, 601.3e): the "enters with" rider, for a spell `entersWithIf` describes (as the spell it would be); a filter the hooks can't evaluate
    // makes the permission unusable rather than drop the rider (fail closed)
    let enters: CounterSpec[] | undefined;
    if (!land && h.p.entersWith !== undefined) {
      view ??= ctx.view.with(overlayZone(s, id, 'stack'), new Map([[id, chars]]));
      const cx: EvalCx = { s: view.s, all: view, source: h.src.source, controller: h.src.controller };
      const m = objectMatches(cx, id, h.p.entersWithIf!, spellActor(o));
      if (m === undefined) continue;
      if (m) enters = h.p.entersWith;
    }
    // std-exile-play-1-1 (CR 118.9, 305.9): a spell cast with a permission that says "pay life equal to its mana value rather than pay its mana cost" is cast for that
    // cost; a land is played, never cast, so a land play pays nothing
    const life = !land && h.p.costChange !== undefined;
    const use: TopUse = { key: h.key, ...(enters !== undefined ? { entersWith: enters, source: h.src.name } : {}), ...(life ? { lifeCost: true as const } : {}) };
    // a permission without a limit or a rider is used first (it spends nothing and adds nothing; the player chooses, CR 601.3), else the first one; one with
    // no cost before one with the life cost
    if (h.key === null && enters === undefined && !life) return use;
    const better = found === undefined || (found.lifeCost === true ? !life : !life && found.key !== null && h.key === null);
    if (better) found = use;
  }
  return found ?? null;
}

/** FAST5X E14: the top-card permission a cast or land play uses (topPermitFor). */
export interface TopUse {
  /** the counter of its once-each-turn limit, or null */
  readonly key: string | null;
  /** std-rx27: the counters the permanent enters with, and the permission's source */
  readonly entersWith?: CounterSpec[];
  readonly source?: string;
  /** std-exile-play-1-1 (CR 118.9): the spell is cast for life equal to its mana value rather than its mana cost (lifeCostOf) */
  readonly lifeCost?: true;
}

/** std-rx27: counters of a rider: each a kind and a positive fixed number. */
const validCounters = (cs: readonly CounterSpec[]): boolean => Array.isArray(cs) && cs.length > 0 && cs.every((c) => typeof c.kind === 'string' && typeof c.count === 'number' && c.count > 0);

// ---- GY1: "You may play lands from your graveyard" (CR 305.1, 116.2a, 404.1) --------------------------------------------------------------------------

/** The fields of the one graveyard land permission honored: `{s:'permit', who:{ref:'you'}, action:'play', of:{types:['Land']}, from:'graveyard'}`. */
const GRAVEYARD_LAND_KEYS: readonly string[] = ['s', 'who', 'action', 'of', 'from'];

/**
 * GY1: is this exactly "You may play lands from your graveyard"? `who` is `{ref:'you'}`, `of` is the land card type alone, `from` the graveyard, and no other
 * field is set (an extra quality, a cost, a count, a top-card or once-each-turn rider, ...: fail closed).
 */
export function isGraveyardLandPermit(p: PermissionDef): boolean {
  if (p.s !== 'permit' || p.action !== 'play' || p.from !== 'graveyard') return false;
  const rec = p as unknown as Record<string, unknown>;
  const keys = Object.keys(rec).filter((k) => rec[k] !== undefined);
  if (keys.length !== GRAVEYARD_LAND_KEYS.length || !GRAVEYARD_LAND_KEYS.every((k) => keys.includes(k))) return false;
  const who = p.who as unknown as Record<string, unknown>;
  if (Object.keys(who).filter((k) => who[k] !== undefined).length !== 1 || who['ref'] !== 'you') return false;
  return isGraveyardLandFilter(p.of as Record<string, unknown> | undefined);
}

const BASIC_LAND_TYPES: readonly string[] = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];

/**
 * GY1: the cards "you may play ... from your graveyard" names as lands: lands (`{types:['Land']}`); std-rl (CR 205.3i, 305.1): or lands of one land type,
 * "Forests" (a basic land type, `{subtypes:['Forest']}`, which only lands have) or "Desert lands" (`{types:['Land'], subtypes:['Desert']}`). Nothing else.
 */
function isGraveyardLandFilter(of: Record<string, unknown> | undefined): boolean {
  if (of === undefined) return false;
  const keys = Object.keys(of).filter((k) => of[k] !== undefined);
  if (keys.length === 0 || keys.some((k) => k !== 'types' && k !== 'subtypes')) return false;
  const types = of['types'];
  const subtypes = of['subtypes'];
  if (types !== undefined && !(Array.isArray(types) && types.length === 1 && types[0] === 'Land')) return false;
  if (subtypes === undefined) return types !== undefined;
  return Array.isArray(subtypes) && subtypes.length === 1 && typeof subtypes[0] === 'string' && (types !== undefined || BASIC_LAND_TYPES.includes(subtypes[0]));
}

/** std-rl: does a land permission's `of` cover this card: a land subtype it names is printed on one of the card's faces (CR 205.3i). */
function landPermitCovers(s: GameState, id: ObjectId, of: PermissionDef['of']): boolean {
  const sub = of?.subtypes;
  if (sub === undefined || sub.length === 0) return true;
  const o = s.objects[id];
  const def = o === undefined ? undefined : s.defs[o.defId];
  return def !== undefined && def.faces.some((f) => sub.every((t) => f.subtypes.includes(t)));
}

// ---- C10: casting from the graveyard and playing cards from it (CR 601.3, 601.3e, 305.1, 404.1) --------------------------------------------------------

/** The card types of a permanent card (CR 110.4, 205.2a): what "a permanent card" is as an `of` filter. */
export const PERMANENT_CARD_TYPES: readonly CardType[] = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'];

/**
 * trek-11 (CR 400.11, 305.1, 601.3, 404.1): is this exactly "Once during each of your turns, you may play a permanent card you own from outside the game or from your
 * graveyard" (The Holodeck)? `{s:'permit', who:{ref:'you'}, action:'play', of:{types: the six permanent card types}, from:'graveyard', alsoOutside:true, oncePerTurn:true}`
 * and no other field (an extra quality, a cost, a count, a resolved effect's `who`, a missing limit: fail closed). `of` is judged on the card as the spell it would be (a
 * land is never a spell, CR 305.9) and, for a land card, by its type: a land card is played as a land (CR 305.1), any other permanent card is cast (CR 601.3).
 */
export function isPermanentPlayPermit(p: PermissionDef): boolean {
  if (p.s !== 'permit' || p.action !== 'play' || p.from !== 'graveyard' || p.alsoOutside !== true || p.oncePerTurn !== true) return false;
  const rec = p as unknown as Record<string, unknown>;
  const keys = Object.keys(rec).filter((k) => rec[k] !== undefined);
  if (keys.length !== 7 || !['s', 'who', 'action', 'of', 'from', 'alsoOutside', 'oncePerTurn'].every((k) => keys.includes(k))) return false;
  const who = p.who as unknown as Record<string, unknown>;
  if (Object.keys(who).filter((k) => who[k] !== undefined).length !== 1 || who['ref'] !== 'you') return false;
  const of = p.of as unknown as Record<string, unknown> | undefined;
  if (of === undefined || Object.keys(of).filter((k) => of[k] !== undefined).length !== 1) return false;
  const types = of['types'];
  return Array.isArray(types) && types.length === PERMANENT_CARD_TYPES.length && PERMANENT_CARD_TYPES.every((t) => types.includes(t));
}

/** The optional fields a graveyard permission may have besides `of` (a `play` permission has none of them). */
const GRAVEYARD_CAST_FIELDS: readonly string[] = ['addCost', 'entersWith', 'oncePerTurn', 'exileOnLeave' /* std-rx24: jump-start (CR 702.133a) */, 'single', 'entersSubtypes' /* std-freecast-2 */, 'graveyardInstead' /* p2-graveyard-2 (CR 614.1a) */];

/**
 * C10: is this a graveyard permission this module honors? "You may cast artifact spells from your graveyard [by paying 3 life in addition to paying their
 * other costs]", "Once during each of your turns, you may cast a creature spell from your graveyard", "You may cast ~ from your graveyard" (`of`
 * `{self: true}`: the card itself, a static ability that functions in the graveyard, CR 113.6), "You may play cards / lands from your graveyard":
 *  - `who` is exactly `{ref:'you'}` (or, made by a resolving effect, the one player it was fixed as) and `from` the graveyard: the cards a player owns in
 *    their own graveyard (CR 404.1);
 *  - `cast` with any `of` (the qualities of the spell, CR 601.3e; none: "spells") and, optionally, an additional cost (`addCost`, CR 601.2f, 118.8), a
 *    once-each-turn limit (`oncePerTurn`) and the counters the permanent enters with (`entersWith`, CR 614.1c);
 *  - `play` with no `of` ("cards": a land play or a cast, CR 305.1, 601.3) or exactly the land card type ("lands") and no other field.
 * Any other field or form is never read as this (fail closed). Which source a permission may come from is `gyHits`'s.
 */
export function isGraveyardPermit(p: PermissionDef): boolean {
  if (p.s !== 'permit' || p.from !== 'graveyard' || (p.action !== 'cast' && p.action !== 'play')) return false;
  if (p.alsoOutside !== undefined) return isPermanentPlayPermit(p); // trek-11: the field is honored on that one form only
  const rec = p as unknown as Record<string, unknown>;
  // std-rx27 (CR 305.2): a land permission may be once each turn too ("During each of your turns, you may play a land ... from your graveyard")
  const allowed = p.action === 'cast' ? ['s', 'who', 'action', 'from', 'of', ...GRAVEYARD_CAST_FIELDS] : ['s', 'who', 'action', 'from', 'of', ...(p.of !== undefined ? ['oncePerTurn'] : [])];
  if (Object.keys(rec).some((k) => rec[k] !== undefined && !allowed.includes(k))) return false;
  // "you": a resolved effect has fixed it as the player it began for (effects/handlers/lasting-fix.ts, CR 611.2c), one player either way
  const who = p.who as unknown as Record<string, unknown>;
  const fixedOne = who['ref'] === 'fixed' && Array.isArray(who['players']) && (who['players'] as unknown[]).length === 1 && Object.keys(who).filter((k) => who[k] !== undefined).length === 2;
  if (!fixedOne && (Object.keys(who).filter((k) => who[k] !== undefined).length !== 1 || who['ref'] !== 'you')) return false;
  if (p.action === 'play' && p.of !== undefined && !isGraveyardLandPermit({ ...p, who: { ref: 'you' }, oncePerTurn: undefined })) return false;
  if (p.of?.is !== undefined) return false; // a permission for named objects is FAST4 T31's (isObjectPermit)
  if (p.entersWith !== undefined && !(Array.isArray(p.entersWith) && p.entersWith.length > 0 && p.entersWith.every((c) => typeof c.kind === 'string' && typeof c.count === 'number' && c.count > 0))) return false;
  // std-freecast-2 (CR 614.1c, 205.1b): "... and is a Vampire in addition to its other types", recorded with the counters of `entersWith` only
  if (p.entersSubtypes !== undefined && !(p.entersWith !== undefined && Array.isArray(p.entersSubtypes) && p.entersSubtypes.length > 0 && p.entersSubtypes.every((x) => typeof x === 'string' && x.length > 0))) return false;
  // std-freecast-2 (CR 601.3): "you may cast a creature spell from your graveyard this turn": one spell (`single`), never with a once-each-turn limit too
  if (p.single !== undefined && (p.single !== true || p.action !== 'cast' || p.oncePerTurn !== undefined)) return false;
  // p2-graveyard-2 (CR 614.1a, 400.7): "If a spell cast this way would be put into your graveyard, exile it instead" (Kess, Dissident Mage): into exile, nothing else
  if (p.graveyardInstead !== undefined && !(p.action === 'cast' && JSON.stringify(p.graveyardInstead.to) === '{"zone":"exile"}')) return false;
  return p.oncePerTurn === undefined || p.oncePerTurn === true;
}

/** One graveyard permission that could let `player` play or cast a card: its source and the key of its once-each-turn counter (null: no limit). */
interface GyHit {
  readonly src: RuleSource;
  readonly p: PermissionDef;
  readonly key: string | null;
}

/**
 * C10: the graveyard permissions that apply to `player` now (the qualities of a card not checked yet), for a land play (`land`: `play` only, CR 305.9) or a
 * cast (`play` lets a nonland card be cast, CR 601.3). A static ability of an object (the source must still have it: CR 113.6, 611.3a; its condition, "during
 * your turn", is judged by statics/rule-sources.ts) or a resolved effect while it lasts ("until end of turn, ...", CR 611.2a). A once-each-turn permission is
 * a static ability's only, and is left out once its use this turn is spent (CR 400.7: a new object has a new one).
 */
function gyHits(ctx: RuleContext, s: GameState, player: PlayerId, land: boolean): GyHit[] {
  const out: GyHit[] = [];
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'permit' || !isGraveyardPermit(e) || (land && e.action !== 'play')) continue;
    if (!land && e.action === 'play' && e.of !== undefined && !isPermanentPlayPermit(e)) continue; // "play lands": never a cast (CR 305.9); trek-11: "play a permanent card" casts the nonland ones
    if (!refIncludes(cxOf(ctx, src), e.who, player)) continue;
    const isStatic = src.source !== null && src.order[1] === 0;
    let key: string | null = null;
    if (e.oncePerTurn === true) {
      if (!isStatic) continue; // a resolved effect's limit has no counter here (fail closed)
      key = `${src.source}|gy:${src.order[3]}:${src.order[4]}`;
      if ((s.turnActivations[key] ?? 0) >= 1) continue; // "once during each of your turns"
    }
    // std-freecast-2 (CR 601.3): "you may cast a creature spell from your graveyard this turn": a resolved effect's permission for ONE spell, counted under the
    // effect's order (`single:<order>`, as std-rx27's one-card permissions); the counter is per turn, so only a "this turn" effect has this form (its template)
    if (e.single === true) {
      if (isStatic) continue; // a static ability's "a spell" is a once-each-turn limit (fail closed)
      key = singleKeyOf(src);
      if ((s.turnActivations[key] ?? 0) >= 1) continue;
    }
    // the card itself ("You may cast ~ from your graveyard"): only the static ability of that card, where it functions (CR 113.6)
    if (e.of?.self === true && !isStatic) continue;
    out.push({ src, p: e, key });
  }
  return out;
}

/** The cards `player` owns in their own graveyard (CR 404.1). */
function ownGraveyard(s: GameState, player: PlayerId): ObjectId[] {
  return (s.zones.graveyard[player] ?? []).filter((id) => {
    const o = s.objects[id];
    return o !== undefined && o.kind === 'card' && o.zone === 'graveyard' && o.owner === player;
  });
}

// ---- CLOUD std-fdn: "You can spend mana of any type to cast creature spells" (CR 609.4b) ---------------------------------------------------------------

/**
 * The exact form honored: `{s:'permit', who, action:'spendMana', asThough:'any type' | 'any color', of}` and no other field (anything more fails closed).
 * Standard round I adds 'any color' ("You may spend mana as though it were mana of any color to cast Case spells", Case File Auditor).
 */
export function isSpendAnyTypePermit(p: PermissionDef): boolean {
  return p.action === 'spendMana' && (p.asThough === 'any type' || p.asThough === 'any color') && p.of !== undefined && Object.keys(p).every((k) => ['s', 'who', 'action', 'asThough', 'of'].includes(k));
}

/**
 * CLOUD std-fdn (CR 609.4b, 601.2h, 601.3e): may `player` spend mana of any type to cast this card as `chars`, because of a static ability ("You can spend
 * mana of any type to cast creature spells", Vizier of the Menagerie)? The spell is judged as the spell it would be, on the stack (as topPermitFor does). Only a
 * static ability of an object honors it (a resolved effect with this form is not read: fail closed).
 * Standard round I (CR 609.4b, 107.4c): `'color'` when the only permission that applies is "as though it were mana of any color" (a {C} symbol still needs
 * colorless mana); `true` when one says "any type" (it wins).
 */
export function staticAnyManaType(s: GameState, player: PlayerId, id: ObjectId, chars: Chars): boolean | 'color' {
  const ctx = ruleContext(s);
  const o = s.objects[id];
  if (!ctx || !o) return false;
  let view: CharsView | undefined;
  let found: boolean | 'color' = false;
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'permit' || !isSpendAnyTypePermit(e) || src.source === null || src.order[1] !== 0 || !refIncludes(cxOf(ctx, src), e.who, player)) continue;
    view ??= ctx.view.with(overlayZone(s, id, 'stack'), new Map([[id, chars]]));
    const cx: EvalCx = { s: view.s, all: view, source: src.source, controller: src.controller };
    if (objectMatches(cx, id, e.of!, spellActor(o)) !== true) continue; // a filter the hooks can't evaluate matches nothing (fail closed)
    if (e.asThough === 'any type') return true;
    found = 'color';
  }
  return found;
}

/** std-rx32: the exact form honored, `{s:'permit', who, action:'spendMana', asThough:'any color', of, abilities:true}` and no other field. */
export function isSpendAnyColorAbilitiesPermit(p: PermissionDef): boolean {
  return p.action === 'spendMana' && p.asThough === 'any color' && p.abilities === true && p.of !== undefined && Object.keys(p).every((k) => ['s', 'who', 'action', 'asThough', 'of', 'abilities'].includes(k));
}

/**
 * std-rx32 (CR 609.4b, 602.2b): may `player` spend mana as though it were mana of any color to activate an ability of `source`, because of a static ability ("You may
 * spend mana as though it were mana of any color to activate abilities of creatures you control", Agatha's Soul Cauldron)? The source is matched as it is now; a filter
 * the hooks can't evaluate matches nothing (fail closed). Only a static ability of an object honors it.
 */
export function staticAnyColorForAbility(s: GameState, player: PlayerId, source: ObjectId): boolean {
  const ctx = ruleContext(s);
  if (!ctx || !s.objects[source]) return false;
  return ctx.sources.some((src) => {
    const e = src.effect;
    if (e.s !== 'permit' || !isSpendAnyColorAbilitiesPermit(e) || src.source === null || src.order[1] !== 0 || !refIncludes(cxOf(ctx, src), e.who, player)) return false;
    return objectMatches(cxOf(ctx, src), source, e.of!) === true;
  });
}

/**
 * C10 (and GY1): the cards `player` may try to play as a land (`land`) or cast from their own graveyard because a graveyard permission of theirs applies.
 * Which face is a land, the timing and the land plays left are actions/land.ts#landCheck's (CR 305.1-305.3, 712.12: a nonland card is refused there); which
 * cards a cast permission covers, and how, is graveyardPermitUses's, read by actions/cast.ts#castCheck.
 */
function graveyardCandidates(s: GameState, player: PlayerId, land: boolean): ObjectId[] {
  const yard = s.zones.graveyard[player];
  if (yard === undefined || yard.length === 0) return [];
  const ctx = ruleContext(s);
  if (!ctx) return [];
  const hits = gyHits(ctx, s, player, land);
  // std-rl: a land permission of one land type ("You may play Forests from your graveyard") covers only the lands of that type
  if (hits.length > 0) return land ? ownGraveyard(s, player).filter((id) => hits.some((h) => landPermitCovers(s, id, h.p.of))) : ownGraveyard(s, player);
  return land ? discardedSelfLands(ctx, s, player) : []; // r3-mech: mayhem on a land (the card itself only)
}

/**
 * std-rx27 (CR 305.2, 601.3): the once-each-turn counter a land play of `id` from `player`'s own graveyard spends: null when a graveyard land permission without
 * a limit covers it (the player uses that one) or none does; else the first once-each-turn one's (actions/land.ts#playLand spends it).
 */
export function graveyardLandKey(s: GameState, player: PlayerId, id: ObjectId): string | null {
  const o = s.objects[id];
  if (!o || o.zone !== 'graveyard' || o.owner !== player) return null;
  const ctx = ruleContext(s);
  if (!ctx) return null;
  let key: string | null = null;
  // trek-11: a permission that cannot reach outside the game is spent first (the Holodeck's shared use stays for the cards only it can play)
  const hits = [...gyHits(ctx, s, player, true)].sort((a, b) => Number(a.p.alsoOutside === true) - Number(b.p.alsoOutside === true));
  for (const h of hits) {
    if (!landPermitCovers(s, id, h.p.of)) continue;
    if (h.key === null) return null;
    key ??= h.key;
  }
  return key;
}

/**
 * trek-11 (CR 400.11, 305.1, 305.2): the permission a land play of the card staged from outside the game spends: `{key}` of the once-each-turn counter (the same one a
 * graveyard land play or cast of that permission spends, so the two places share one use a turn), or null when no permission covers cards outside the game now.
 */
export function outsideLandKey(s: GameState, player: PlayerId, id: ObjectId): { key: string | null } | null {
  const o = s.objects[id];
  if (!o || o.kind !== 'card' || o.fromOutside !== true || o.zone !== 'hand' || o.owner !== player) return null;
  const ctx = ruleContext(s);
  if (!ctx) return null;
  let key: string | null | undefined;
  for (const h of gyHits(ctx, s, player, true)) {
    if (h.p.alsoOutside !== true) continue;
    key ??= h.key;
  }
  return key === undefined ? null : { key };
}

/** trek-11: does a permission that covers cards `player` owns outside the game apply to them now (not spent this turn), and do they own any? A cheap test before staging a card. */
export function outsidePermitAvailable(s: GameState, player: PlayerId): boolean {
  if ((s.outside?.[player]?.length ?? 0) === 0) return false;
  const ctx = ruleContext(s);
  if (!ctx) return false;
  return gyHits(ctx, s, player, true).some((h) => h.p.alsoOutside === true);
}

// ---- Cloud r3-mech: mayhem with no cost (CR 702.187a-b, 305.1) -------------------------------------------------------------------------------------------

/**
 * Cloud r3-mech: is this exactly the permission of mayhem without a cost (a land card: "You may play this card from your graveyard if you discarded it this
 * turn. Timing rules still apply.", CR 702.187a-b)? `{s:'permit', who:{ref:'you'}, action:'play', of:{self:true}, from:'graveyard', discardedThisTurn:true}` and
 * no other field (keywords/data/mayhem.json writes it). Any other form is never read as this (fail closed).
 */
export function isDiscardedSelfPlayPermit(p: PermissionDef): boolean {
  if (p.s !== 'permit' || p.action !== 'play' || p.from !== 'graveyard' || p.discardedThisTurn !== true) return false;
  const rec = p as unknown as Record<string, unknown>;
  if (Object.keys(rec).some((k) => rec[k] !== undefined && !['s', 'who', 'action', 'of', 'from', 'discardedThisTurn'].includes(k))) return false;
  const who = p.who as unknown as Record<string, unknown>;
  const of = (p.of ?? {}) as Record<string, unknown>;
  return Object.keys(who).filter((k) => who[k] !== undefined).length === 1 && who['ref'] === 'you'
    && Object.keys(of).filter((k) => of[k] !== undefined).length === 1 && of['self'] === true;
}

/**
 * Cloud r3-mech (CR 702.187b, 400.7, 113.6): the land cards in `player`'s graveyard whose own mayhem permission functions there and that `player` discarded this
 * turn: this turn's history has a discard (CR 701.9) whose subject is this very object, by its owner (as actions/cast.ts#discardedThisTurn reads it for
 * mayhem's cast; a card that left the graveyard and came back is a new object). Only the static ability of the card itself (CR 113.6), never a resolved
 * effect. Timing and the land plays left are actions/land.ts#landCheck's ("Timing rules still apply", CR 305.1-305.2).
 */
function discardedSelfLands(ctx: RuleContext, s: GameState, player: PlayerId): ObjectId[] {
  const out: ObjectId[] = [];
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'permit' || !isDiscardedSelfPlayPermit(e) || src.source === null || src.order[1] !== 0) continue;
    const o = s.objects[src.source];
    if (o === undefined || o.kind !== 'card' || o.zone !== 'graveyard' || o.owner !== player || out.includes(o.id)) continue;
    if (!refIncludes(cxOf(ctx, src), e.who, player)) continue;
    const discarded = s.history.some((h) => h.turn === s.turn.number && h.ev === 'action' && h.facts['verb'] === 'discard' && h.subject === o.id && (h.actor === undefined || h.actor === o.owner));
    if (discarded) out.push(o.id);
  }
  return out;
}

/**
 * C10: one way a graveyard permission lets a player cast a card: the counter key of a once-each-turn limit (spent by actions/cast.ts#castSpell as the card
 * moves to the stack), the additional cost (CR 601.2f) and the counters the permanent enters with (CR 614.1c), and the name of the source for the log.
 */
export interface GraveyardUse {
  readonly key: string | null;
  readonly addCost?: CostDef;
  readonly entersWith?: CounterSpec[];
  /** std-rx24 (CR 702.133a): the spell cast this way is exiled instead of put anywhere else any time it would leave the stack (jump-start). */
  readonly exileOnLeave?: true;
  /** std-freecast-2 (CR 614.1c, 205.1b): the subtypes the permanent it becomes has in addition to its other types (PermissionDef.entersSubtypes). */
  readonly entersSubtypes?: string[];
  /** p2-graveyard-2 (CR 614.1a): the spell cast this way goes there instead of a graveyard (PermissionDef.graveyardInstead; `yours`: only into your graveyard). */
  readonly graveyardInstead?: { to: Destination; yours?: true };
  readonly source: string;
}

/**
 * C10 (CR 601.3, 601.3e): the ways `player` may cast the card `id` from their own graveyard, seen as `chars` (the face being cast, as the spell it would be),
 * one per different way: permissions with the same additional cost and the same counters are one way (a permission without a once-each-turn limit is used
 * first: using it spends nothing; else the first in timestamp order). Several different ways are for the player to choose (core/legal.ts offers each as
 * the cast method `permission:<n>`, actions/cast.ts#castMethods). Empty when none applies.
 */
export function graveyardPermitUses(s: GameState, player: PlayerId, id: ObjectId, chars: Chars): GraveyardUse[] {
  const o = s.objects[id];
  if (!o || o.kind !== 'card' || o.zone !== 'graveyard' || o.owner !== player) return [];
  return permitUsesOf(s, player, id, chars, false);
}

/**
 * trek-11 (CR 400.11, 400.11b, 601.3, 601.3e): the ways `player` may cast the card staged from outside the game (`GameObject.fromOutside`, core/zones.ts#stageFromOutside),
 * seen as `chars` (the face being cast, as the spell it would be). Only a permission that covers cards outside the game (`alsoOutside`, The Holodeck) applies, and the
 * use it spends is the same once-each-turn counter as its graveyard casts and land plays: one permission for both places, once a turn in all. Empty when none applies.
 */
export function outsideCastUses(s: GameState, player: PlayerId, id: ObjectId, chars: Chars): GraveyardUse[] {
  const o = s.objects[id];
  if (!o || o.kind !== 'card' || o.fromOutside !== true || o.zone !== 'hand' || o.owner !== player) return [];
  return permitUsesOf(s, player, id, chars, true);
}

function permitUsesOf(s: GameState, player: PlayerId, id: ObjectId, chars: Chars, outside: boolean): GraveyardUse[] {
  const ctx = ruleContext(s);
  const o = s.objects[id];
  if (!ctx || !o) return [];
  let view: CharsView | undefined;
  const ways = new Map<string, GraveyardUse>();
  const extra = new Map<string, GraveyardUse[]>(); // std-rx27: the other once-each-turn ways of the same signature
  // trek-11: a graveyard play defaults to a permission that cannot reach outside the game first, so the Holodeck's shared use is kept for the cards only it can play
  const hits = [...gyHits(ctx, s, player, false)].sort((a, b) => Number(a.p.alsoOutside === true) - Number(b.p.alsoOutside === true));
  for (const h of hits) {
    if (outside && h.p.alsoOutside !== true) continue; // trek-11: only a permission that names cards outside the game
    let ok = h.p.of === undefined;
    if (!ok) {
      // CR 601.3e: judged as the spell it would be, on the stack (as topPermitFor); a filter the hooks can't evaluate matches nothing (fail closed)
      view ??= ctx.view.with(overlayZone(s, id, 'stack'), new Map([[id, chars]]));
      const cx: EvalCx = { s: view.s, all: view, source: h.src.source, controller: h.src.controller };
      ok = objectMatches(cx, id, h.p.of!, spellActor(o)) === true;
    }
    if (!ok) continue;
    const sig = JSON.stringify([h.p.addCost ?? null, h.p.entersWith ?? null, h.p.exileOnLeave ?? null, h.p.entersSubtypes ?? null, h.p.graveyardInstead ?? null]);
    // std-rx27 (CR 601.3): two once-each-turn permissions with different counters are different ways ("a permanent spell of each permanent type": an artifact
    // creature card may use the artifact one or the creature one, the player's choice); a permission without a limit is still used first (it spends nothing)
    const prev = ways.get(sig);
    if (prev !== undefined && prev.key === null) continue;
    const use: GraveyardUse = { key: h.key, ...(h.p.addCost !== undefined ? { addCost: h.p.addCost } : {}), ...(h.p.entersWith !== undefined ? { entersWith: h.p.entersWith } : {}), ...(h.p.exileOnLeave === true ? { exileOnLeave: true as const } : {}), ...(h.p.entersSubtypes !== undefined ? { entersSubtypes: h.p.entersSubtypes } : {}), ...(h.p.graveyardInstead !== undefined ? { graveyardInstead: h.p.graveyardInstead } : {}), source: h.src.name };
    if (h.key === null) { ways.set(sig, use); continue; }
    if (prev === undefined) { ways.set(sig, use); continue; }
    if (![prev, ...(extra.get(sig) ?? [])].some((u) => u.key === h.key)) extra.set(sig, [...(extra.get(sig) ?? []), use]);
  }
  return [...ways.entries()].flatMap(([sig, u]) => (u.key === null ? [u] : [u, ...(extra.get(sig) ?? [])]));
}

/** C10: the cast method that picks the n-th way of graveyardPermitUses (1-based), when there are several. */
export const GRAVEYARD_METHOD = 'permission';
export const graveyardMethod = (n: number): string => `${GRAVEYARD_METHOD}:${n}`;
/** The way a `permission:<n>` method picks (1-based), or null for any other method. */
export function graveyardMethodIndex(method: string): number | null {
  const m = /^permission:(\d+)$/.exec(method);
  return m ? Number(m[1]) : null;
}

// ---- r3-cost: alternative costs a static ability gives other spells (CR 118.9, 601.2b, 601.3e) ---------------------------------------------------------

/**
 * r3-cost: is this an alternative cost a static ability gives other spells? "You may pay {W}{U}{B}{R}{G} rather than pay the mana cost for spells you cast"
 * (Leyline of Mutation), "You may cast spells from your hand without paying their mana costs" (Omniscience), "You may cast Dragon spells without paying their
 * mana costs" (Dracogenesis), "Once each turn, you may pay {0} rather than pay the mana cost for a spell you cast from exile" (Warped Space). The form:
 * `action` 'cast', `who` exactly `{ref:'you'}`, `costChange` `{kind:'set', cost}` and nothing else in it (`cost` `{}`: "without paying their mana costs",
 * CR 118.9), optionally `of` (the spells, as each would be on the stack, CR 601.3e; where it is cast from is `of.castFrom`, CR 601.2a) and `oncePerTurn`
 * (one spell each turn per source object, CR 400.7), and no other field. It permits nothing else (no `from`): the card must be castable from where it is
 * anyway (CR 601.3: the hand, or another effect's permission). Any other form is never read as this (fail closed).
 */
export function isAltCostPermit(p: PermissionDef): boolean {
  if (p.s !== 'permit' || p.action !== 'cast' || p.costChange === undefined) return false;
  const rec = p as unknown as Record<string, unknown>;
  if (Object.keys(rec).some((k) => rec[k] !== undefined && !['s', 'who', 'action', 'of', 'costChange', 'oncePerTurn', 'firstSpellThisTurn'].includes(k))) return false;
  // std-freecast-1: the first spell of all the player casts this turn (turnStats.spellsCast), so with no `of` ("the first creature spell" would need a count of those)
  if (p.firstSpellThisTurn !== undefined && (p.firstSpellThisTurn !== true || p.of !== undefined)) return false;
  const who = p.who as unknown as Record<string, unknown>;
  // std-freecast-1 (CR 102.1): or "each player ... during each of their turns", the active player, with `firstSpellThisTurn` only
  if (Object.keys(who).filter((k) => who[k] !== undefined).length !== 1 || !(who['ref'] === 'you' || (who['ref'] === 'active' && p.firstSpellThisTurn === true))) return false;
  const cc = p.costChange as unknown as Record<string, unknown>;
  if (p.costChange.kind !== 'set' || p.costChange.cost === undefined || Object.keys(cc).some((k) => cc[k] !== undefined && !['kind', 'cost', 'name'].includes(k))) return false;
  if (p.of?.is !== undefined) return false; // a permission for named objects is FAST4 T31's (isObjectPermit)
  return p.oncePerTurn === undefined || p.oncePerTurn === true;
}

/** r3-cost: one alternative cost a static ability gives a spell: the cast method that picks it, the cost, its once-each-turn counter (null: no limit). */
export interface GrantedAlternative {
  readonly method: string;
  readonly cost: CostDef;
  /** The name the spell records as the alternative cost paid (`CostsPaid.alternative`, read by `wasCast.via`). */
  readonly name: string;
  readonly key: string | null;
  /** The source's name, for the label and the log. */
  readonly source: string;
}

/**
 * r3-cost: the cast methods of granted alternative costs are `grantedCost:<source>:<ability>:<effect>` (core/legal.ts offers each; a card's own second
 * alternative cost named "alternative" is `alternative:2`, actions/cast-options.ts#uniqueName, so the prefix is a different word).
 */
export const GRANTED_ALT_METHOD = 'grantedCost';
export const isGrantedAltMethod = (method: string | undefined): boolean => method !== undefined && method.startsWith(`${GRANTED_ALT_METHOD}:`);
/** std-rx3: the cast method of the alternative cost of nothing a permission for named objects gives (grantedAlternatives). */
export const isNamedFreeMethod = (method: string | undefined): boolean => method !== undefined && method.startsWith(`${GRANTED_ALT_METHOD}:named:`);

/**
 * r3-cost (CR 118.9, 601.2b, 601.3e): the alternative costs static abilities give `player` for casting the card `id` from where it is, seen as `chars` (the face
 * being cast, as the spell it would be on the stack, cast from its zone: `of.castFrom`). A static ability of an object only (its condition is judged by
 * statics/rule-sources.ts, CR 611.3a); a once-each-turn one whose use this turn is spent is left out. Empty when none applies (most games: no such source).
 */
export function grantedAlternatives(s: GameState, player: PlayerId, id: ObjectId, chars: Chars): GrantedAlternative[] {
  const o = s.objects[id];
  if (!o || o.kind !== 'card' || o.zone === 'stack' || o.zone === 'battlefield') return [];
  const out: GrantedAlternative[] = [];
  // std-freecast-1 (CR 118.9, 601.2b, 611.2): "the next red or green creature spell you cast this turn can be cast without paying its mana cost": a waiting `free`
  // rider of this player whose filter the card matches, as the spell it would be (CR 601.3e); takeNextSpellRiders uses it up as the next matching spell is cast
  const free = (s.turn.nextSpell ?? []).map((r, i) => [r, i] as const).filter(([r]) => r.rider === 'free' && r.player === player);
  if (free.length > 0) {
    const s2 = overlayZone(s, id, 'stack');
    const view = charsViewOf(s).with(s2, new Map([[id, { ...chars, controller: player }]]));
    for (const [r, i] of free) {
      const cx: EvalCx = { s: view.s, all: view, source: r.sourceId ?? null, controller: r.controller };
      if (r.filter !== undefined && objectMatches(cx, id, r.filter, spellActor(o)) !== true) continue; // a filter the hooks can't evaluate matches nothing
      out.push({ method: `${GRANTED_ALT_METHOD}:next:${i}`, cost: {}, name: 'granted', key: null, source: nextSourceName(s, r.sourceId) });
    }
  }
  const ctx = ruleContext(s);
  if (!ctx || !ctx.sources.some((src) => src.effect.s === 'permit' && src.effect.costChange !== undefined)) return out;
  let view: CharsView | undefined;
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'permit' || !isAltCostPermit(e) || src.source === null || src.order[1] !== 0) continue; // a static ability of an object only
    if (!refIncludes(cxOf(ctx, src), e.who, player)) continue;
    // std-freecast-1 (CR 601.2b, 601.2i): "the first spell each player casts during each of their turns": only while the player has cast no spell this turn
    if (e.firstSpellThisTurn === true && (s.players.find((p) => p.id === player)?.turnStats.spellsCast ?? 0) > 0) continue;
    const at = `${src.source}:${src.order[3]}:${src.order[4]}`;
    const key = e.oncePerTurn === true ? `${src.source}|alt:${src.order[3]}:${src.order[4]}` : null;
    if (key !== null && (s.turnActivations[key] ?? 0) >= 1) continue; // "once each turn"
    if (e.of !== undefined) {
      view ??= ctx.view.with(overlayZone(s, id, 'stack'), new Map([[id, chars]]));
      const cx: EvalCx = { s: view.s, all: view, source: src.source, controller: src.controller };
      if (objectMatches(cx, id, e.of, spellActor(o)) !== true) continue; // a filter the hooks can't evaluate matches nothing (fail closed)
    }
    out.push({ method: `${GRANTED_ALT_METHOD}:${at}`, cost: e.costChange!.cost!, name: e.costChange!.name ?? 'granted', key, source: src.name });
  }
  // std-rx3 (CR 118.9, 601.2b, 400.7): "until end of turn, you may cast those cards without paying their mana costs": a permission for named objects (a static ability
  // or a resolved effect) gives each of them, while it is still the same object where it was named, the alternative cost of nothing
  for (const src of ctx.sources) {
    const e = src.effect;
    // std-exile-play-2-3 (CR 118.9, 701.67a): and the alternative cost "waterbend {N}" of such a permission (isWaterbendCost), cast only
    const wb = e.s === 'permit' && e.action === 'cast' && isWaterbendCost(e.costChange);
    if (e.s !== 'permit' || (e.action !== 'cast' && e.action !== 'play') || !isObjectPermit(e) || !(isFreeCost(e.costChange) || wb)) continue;
    if (e.laterTurn === true && !(src.startedTurn !== undefined && s.turn.number > src.startedTurn)) continue;
    if (e.single === true && (s.turnActivations[singleKeyOf(src)] ?? 0) >= 1) continue; // std-rx27: its one card was played this way
    if (!refIncludes(cxOf(ctx, src), e.who, player)) continue;
    if (e.while !== undefined && !evalCondition(cxOf(ctx, src), e.while)) continue;
    if (!namedObjects(e, s, player).some((h) => h.id === id && h.zone === o.zone)) continue;
    out.push({ method: `${GRANTED_ALT_METHOD}:named:${src.order.join('.')}`, cost: wb ? (JSON.parse(JSON.stringify(e.costChange!.cost)) as CostDef) : {}, name: 'granted', key: null, source: src.name });
  }
  // std-rx27 (CR 118.9, 607.2a): and the free linked permissions for the card in exile (linkedFreeAlternatives)
  if (o.zone === 'exile') out.push(...linkedFreeAlternatives(s, player, id, chars));
  return out;
}

/** std-freecast-1: the name of the source of a `nextSpell` rider, for the label of its cast method. */
function nextSourceName(s: GameState, id: ObjectId | undefined): string {
  const o = id !== undefined ? s.objects[id] : undefined;
  return (o && s.defs[o.defId]?.name) ?? 'an effect';
}

// ---- Standard round 5, r5-refs: "You may play cards exiled with ~" (CR 607.2a, 601.3, 305.1, 611.3a) -----------------------------------------------

/**
 * r5-refs: is this exactly a permission for the cards the object's linked ability exiled ("You may play cards exiled with ~", "You may play lands and cast spells
 * from among cards exiled with ~", "During your turn, you may play cards exiled with ~": the condition is the static ability's, judged by
 * statics/rule-sources.ts)? `who` is `{ref:'you'}`, `of` is `{is: {ref:'linked', link}}` alone (no quality to check on the spell, CR 601.3e) and no other field
 * is set (a cost, a count, "as though", any type of mana ...: fail closed). Capability `permit:<action>.linked`.
 */
export function isLinkedPermit(p: PermissionDef): boolean {
  if (p.s !== 'permit' || (p.action !== 'play' && p.action !== 'cast')) return false;
  const rec = p as unknown as Record<string, unknown>;
  // std-ru: and the life cost of the spells cast with it, exactly `{kind:'set', life:'manaValue'}` (linkedPermitLifeCost)
  if (Object.keys(rec).some((k) => rec[k] !== undefined && !['s', 'who', 'action', 'of'].includes(k) && !(k === 'costChange' && isLifeCostChange(p.costChange)))) return false;
  const who = p.who as unknown as Record<string, unknown>;
  if (Object.keys(who).filter((k) => who[k] !== undefined).length !== 1 || who['ref'] !== 'you') return false;
  const of = p.of as Record<string, unknown> | undefined;
  if (of === undefined || Object.keys(of).filter((k) => of[k] !== undefined).length !== 1) return false;
  const is = of['is'] as Record<string, unknown> | undefined;
  return is !== undefined && is['ref'] === 'linked' && typeof is['link'] === 'string' && Object.keys(is).length === 2;
}

/**
 * r5-refs (CR 607.2a, 601.3, 305.1, 400.7): the cards `player` may play (`land`: as a land) or cast because a linked permission of a static ability applies: the
 * cards the source's linked ability exiled and that are still the same objects in exile (a card that left exile is a new object, CR 400.7). Only a static
 * ability of an object that is functioning (CR 611.3a; a resolved effect with this form is never read: fail closed). `cast` lets a card be cast, never played
 * as a land (CR 305.9). Timing, costs and every other check of casting or playing stay actions/cast.ts's and actions/land.ts's.
 */
/** std-ru: exactly "pay life equal to its mana value rather than pay its mana cost" (`CostChange.life`, CR 118.9). */
function isLifeCostChange(c: PermissionDef['costChange']): boolean {
  return JSON.stringify(c) === '{"kind":"set","life":"manaValue"}';
}

/**
 * std-ru (CR 118.9, 601.2b, 601.2f, 202.3, 107.3b): the alternative cost of a spell `player` casts from the card `id` with a linked permission that says "If you cast a
 * spell this way, pay life equal to its mana value rather than pay its mana cost" (Valgavoth, Terror Eater): life equal to the mana value of `chars` (the face being
 * cast) with X = 0 (audit-fix-1, CR 107.3b: the alternative cost has no {X}, lifeCostOf). Null when no such permission covers the card, or when
 * another permission (one with no cost, or for this very object) could let the player cast it too: then the card is cast as those allow (the players settle a
 * second way by hand). The cost is not optional: a spell cast with this permission is cast for it (CR 118.9: "rather than pay its mana cost").
 */
export function linkedPermitLifeCost(s: GameState, player: PlayerId, id: ObjectId, chars: Chars): CostDef | 'unsupported' | null {
  const o = s.objects[id];
  if (!o || o.kind !== 'card') return null;
  const ctx = ruleContext(s);
  if (!ctx) return null;
  // std-exile-play-2-1 (CR 118.9, 611.2a, 400.7): the resolved permissions that name this very card ("You may play those cards this turn. If you cast a spell this
  // way, pay life ..."), in any zone: one with no cost lets it be cast as usual; a free one is its own way to cast it (grantedAlternatives)
  const named = namedLifeCost(s, ctx, player, id);
  if (named === 'plain') return null;
  let costed = named === 'costed';
  for (const src of ctx.sources) {
    if (o.zone !== 'exile') break;
    const e = src.effect;
    if (e.s !== 'permit' || !(isLinkedPermit(e) || isLinkedRiderPermit(e)) || src.source === null || src.order[1] !== 0) continue;
    if (!refIncludes(cxOf(ctx, src), e.who, player)) continue;
    const link = (e.of!.is as unknown as { link: string }).link;
    const covers = (readLink(s.objects[src.source], link)?.objects ?? []).some((h) => h.id === id && h.zone === 'exile');
    if (!covers) continue;
    // a linked permission with no life cost covers it too (r5-refs' plain form, or std-rx27's rider form): the card is cast as that one allows
    if (!isLifeCostChange(e.costChange)) return null;
    costed = true;
  }
  if (!costed || (named === 'none' && namedPermit(s, player, id, false))) return null;
  return lifeCostOf(chars);
}

/**
 * std-ru (CR 118.9, 202.3): "pay life equal to its mana value rather than pay its mana cost" for the face `chars`: life equal to its mana value with X = 0.
 * audit-fix-1 (CR 107.3b, 601.2b; unverified): this alternative cost has no {X}, so the only legal value of an X in the spell's mana cost is 0 (the Bolas's Citadel
 * ruling); the cost carries no X, so actions/cast.ts announces none (costHasX) and the spell's X is 0. 'unsupported' for a Y or Z (fail closed: the cast is refused).
 * std-exile-play-1-1: shared with the top-card permissions (actions/cast.ts).
 */
export function lifeCostOf(chars: Chars): CostDef | 'unsupported' {
  const variables = (chars.manaCost ?? []).filter((sym) => sym.kind === 'variable');
  if (variables.some((v) => v.name !== 'X')) return 'unsupported'; // a Y or Z: not counted here (fail closed: the cast is refused, castCheck)
  return { other: [{ kind: 'payLife', amount: manaValue(chars.manaCost, 0) }] };
}

/**
 * std-exile-play-2-1 (CR 118.9, 601.3, 611.2a, 400.7): how the resolved permissions for named objects that let `player` play or cast `id` now treat its cost:
 * 'plain' when one of them has no cost change (the card may be cast paying its costs as usual), 'costed' when one says "pay life equal to its mana value rather
 * than pay its mana cost" and none is plain, 'none' when no such permission names it (or only free ones do: "without paying its mana cost" is its own way, cast
 * with the granted alternative cost, grantedAlternatives). Checked as namedPermitted checks them (a later turn, the condition, a used one-card permission).
 */
function namedLifeCost(s: GameState, ctx: RuleContext, player: PlayerId, id: ObjectId): 'plain' | 'costed' | 'none' {
  const o = s.objects[id];
  if (!o || !s.continuousEffects.some((r) => r.effect.s === 'permit' && r.effect.costChange?.life !== undefined)) return 'none';
  let out: 'costed' | 'none' = 'none';
  for (const src of ctx.sources) {
    const e = src.effect;
    if (e.s !== 'permit' || !isObjectPermit(e) || !refIncludes(cxOf(ctx, src), e.who, player)) continue;
    if (e.laterTurn === true && !(src.startedTurn !== undefined && s.turn.number > src.startedTurn)) continue;
    if (e.while !== undefined && !evalCondition(cxOf(ctx, src), e.while)) continue;
    if (e.single === true && (s.turnActivations[singleKeyOf(src)] ?? 0) >= 1) continue;
    if (!namedObjects(e, s, player).some((h) => h.id === id && h.zone === o.zone)) continue;
    if (e.costChange === undefined) return 'plain';
    if (isLifeCostChange(e.costChange)) out = 'costed';
  }
  return out;
}

function linkedCandidates(s: GameState, player: PlayerId, land: boolean, paidOnly = false): ObjectId[] {
  if (s.zones.exile.length === 0) return [];
  const ctx = ruleContext(s);
  if (!ctx) return [];
  const out: ObjectId[] = [];
  for (const src of ctx.sources) {
    const e = src.effect;
    // std-rx27: and the rider form (isLinkedRiderPermit), cast only; its qualities and its once-each-turn limit are linkedPermitUses's, read by castCheck
    // (`paidOnly` leaves out the ones that let a card be cast only without paying its mana cost, as namedPermitted does)
    const byFilter = e.s === 'permit' && isExileFilterPermit(e); // std-rx27: the cards in exile a description names
    if (e.s !== 'permit' || !(isLinkedPermit(e) || isLinkedRiderPermit(e) || byFilter) || (land && e.action !== 'play')) continue;
    if (paidOnly && isFreeCost(e.costChange)) continue;
    if (src.source === null || src.order[1] !== 0) continue; // a static ability of an object only
    if (!refIncludes(cxOf(ctx, src), e.who, player)) continue;
    if (byFilter) {
      for (const id of s.zones.exile) if (!out.includes(id) && exileFilterNames(ctx, s, src, e, id)) out.push(id);
      continue;
    }
    const link = (e.of!.is as unknown as { link: string }).link;
    for (const h of readLink(s.objects[src.source], link)?.objects ?? []) {
      const o = s.objects[h.id];
      if (o !== undefined && o.zone === 'exile' && h.zone === 'exile' && o.kind === 'card' && !out.includes(h.id)) out.push(h.id);
    }
  }
  return out;
}

// ---- std-rx27: linked cast permissions with riders (CR 607.2a, 601.3, 601.3e, 609.4b, 118.9, 614.1c, 400.7) ---------------------------------------------

/** std-rx27: the riders a static linked cast permission may carry besides `of` (each honored by linkedPermitUses and actions/cast.ts; anything else fails closed). */
const LINKED_RIDER_FIELDS: readonly string[] = ['anyManaType', 'oncePerTurn', 'entersWith', 'costChange', 'addCost' /* std-exile-play-2-1 */];

/**
 * std-rx27: the link of a filter that names the cards a linked ability exiled (`{is: {ref:'linked', link}, ...qualities}`), whether it says "exiled with ~ this
 * turn" (`putThereThisTurn: true`: judged on the card where it is, CR 400.7, never on the spell it would be) and the qualities besides those (null: none), or
 * undefined when the filter has no such `is`, a `zone` (the cards are in exile wherever the filter would look: a zone of its own is another form) or a
 * `putThereFrom`.
 */
export function linkedOf(of: PermissionDef['of']): { link: string; quality: PermissionDef['of'] | null; thisTurn: boolean } | undefined {
  if (of === undefined) return undefined;
  const is = of.is as unknown as Record<string, unknown> | undefined;
  if (is === undefined || is['ref'] !== 'linked' || typeof is['link'] !== 'string' || Object.keys(is).length !== 2 || of.zone !== undefined) return undefined;
  if (of.putThereFrom !== undefined || (of.putThereThisTurn !== undefined && of.putThereThisTurn !== true)) return undefined;
  const rest = Object.fromEntries(Object.entries(of).filter(([k, v]) => k !== 'is' && k !== 'putThereThisTurn' && v !== undefined)) as NonNullable<PermissionDef['of']>;
  return { link: is['link'], quality: Object.keys(rest).length === 0 ? null : rest, thisTurn: of.putThereThisTurn === true };
}

/**
 * std-rx27: is this a static linked cast permission with riders: "You may cast Dinosaur creature spells from among cards you own exiled with this creature. If
 * you cast a spell this way, that creature enters with a finality counter on it.", "Once each turn, you may cast a spell with mana value 3 or less from among
 * cards exiled with ~ this turn without paying its mana cost", "you may cast cards exiled with ~ ... Mana of any type can be spent to cast those spells"?
 * `action` 'cast', `who` exactly you, `of` the linked cards (linkedOf) with qualities the rule hooks evaluate (CR 601.3e: judged on the spell as it would be),
 * and only these riders: `anyManaType` (CR 609.4b), `oncePerTurn` (one spell each turn per source object, CR 400.7), `entersWith` (CR 614.1c) and a
 * `costChange` that is exactly "without paying its mana cost" (isFreeCost, CR 118.9). The plain form with no rider and no quality is r5-refs' isLinkedPermit.
 * Capability `permit:cast.linked` with `feature:permit.cast.linked.<rider>` (model/cap-walk.ts).
 */
export function isLinkedRiderPermit(p: PermissionDef): boolean {
  if (p.s !== 'permit' || p.action !== 'cast' || isLinkedPermit(p)) return false;
  const rec = p as unknown as Record<string, unknown>;
  if (Object.keys(rec).some((k) => rec[k] !== undefined && !['s', 'who', 'action', 'of', ...LINKED_RIDER_FIELDS].includes(k))) return false;
  const who = p.who as unknown as Record<string, unknown>;
  if (Object.keys(who).filter((k) => who[k] !== undefined).length !== 1 || who['ref'] !== 'you') return false;
  const lk = linkedOf(p.of);
  if (lk === undefined) return false;
  if (p.costChange !== undefined && !isFreeCost(p.costChange)) return false;
  // std-exile-play-2-1 (CR 601.2f, 118.8): "by removing three counters from among creatures you control in addition to paying their other costs": an additional
  // cost of each spell cast with it, paid with its other costs (actions/cast.ts); never on a free one (no such wording)
  if (p.addCost !== undefined && (p.costChange !== undefined || typeof p.addCost !== 'object' || p.addCost === null)) return false;
  if (p.entersWith !== undefined && !(Array.isArray(p.entersWith) && p.entersWith.length > 0 && p.entersWith.every((c) => typeof c.kind === 'string' && typeof c.count === 'number' && c.count > 0))) return false;
  return (p.oncePerTurn === undefined || p.oncePerTurn === true) && (p.anyManaType === undefined || p.anyManaType === true);
}

/**
 * std-rx27 (CR 601.3, 305.1, 609.4b, 122.1): is this a static permission for the cards in exile a description names, "During your turn, you may play cards you
 * don't own with stash counters on them from exile, and mana of any type can be spent to cast those spells."? `action` play or cast, `who` exactly you, `from`
 * exile, `of` the description (no `is` and no `zone` of its own; judged on the card where it is, in exile, CR 400.7) and only the rider `anyManaType` (CR
 * 609.4b). Its condition is the static ability's (statics/rule-sources.ts). Capability `permit:<action>.exile` with `feature:permit.<action>.exile.anyManaType`.
 */
export function isExileFilterPermit(p: PermissionDef): boolean {
  if (p.s !== 'permit' || (p.action !== 'play' && p.action !== 'cast') || p.from !== 'exile' || p.of === undefined) return false;
  const rec = p as unknown as Record<string, unknown>;
  if (Object.keys(rec).some((k) => rec[k] !== undefined && !['s', 'who', 'action', 'from', 'of', 'anyManaType'].includes(k))) return false;
  const who = p.who as unknown as Record<string, unknown>;
  if (Object.keys(who).filter((k) => who[k] !== undefined).length !== 1 || who['ref'] !== 'you') return false;
  // trek-7 (CR 113.6, 601.3; Khan, Vengeful Heart): "You may cast this card from exile", a static ability of the card itself that functions in exile (`of` exactly
  // `{self: true}`: the source, judged where it is by exileFilterNames); `self` beside any quality is another form
  if (p.of.is !== undefined || p.of.zone !== undefined) return false;
  if (p.of.self !== undefined && !(p.of.self === true && Object.keys(p.of).filter((k) => (p.of as Record<string, unknown>)[k] !== undefined).length === 1)) return false;
  return p.anyManaType === undefined || p.anyManaType === true;
}

/** std-rx27: does the static exile permission of `src` (isExileFilterPermit) name `id`, a card in exile, judged as it is there (CR 400.7)? */
function exileFilterNames(ctx: RuleContext, s: GameState, src: RuleSource, p: PermissionDef, id: ObjectId): boolean {
  const o = s.objects[id];
  if (src.source === null || o === undefined || o.zone !== 'exile' || o.kind !== 'card') return false;
  const cx: EvalCx = { s: ctx.view.s, all: ctx.view, source: src.source, controller: src.controller };
  return objectMatches(cx, id, p.of!, spellActor(o)) === true; // a filter the hooks can't evaluate matches nothing (fail closed)
}

/**
 * std-rx27 (CR 400.7): was `id` put into the zone it is in this turn ("exiled with ~ this turn")? Its zoneChange history entry of this turn (the object a zone
 * change made has that entry's subject id), read here as rules/history.ts#putThereThisTurn reads it (statics import no rules module but base-chars, design 5.4).
 */
const putThereThisTurn = (s: GameState, o: { id: ObjectId; zone: string }): boolean =>
  s.history.some((e) => e.turn === s.turn.number && e.ev === 'zoneChange' && e.subject === o.id && e.facts['to'] === o.zone);

/** std-rx27: does the static linked permission of `src` name `id`, still the same object in exile (CR 400.7, 607.2a)? */
function linkNames(s: GameState, src: RuleSource, link: string, id: ObjectId): boolean {
  if (src.source === null || s.objects[id]?.zone !== 'exile') return false;
  return (readLink(s.objects[src.source], link)?.objects ?? []).some((h) => h.id === id && h.zone === 'exile');
}

/**
 * std-rx27: one way a linked permission lets a player cast a card from exile: the counter key of a once-each-turn limit (spent by actions/cast.ts#castSpell as
 * the card moves to the stack), whether mana of any type may be spent (CR 609.4b), the counters the permanent enters with (CR 614.1c), whether it is only
 * "without paying its mana cost" (CR 118.9: then it is offered as the granted alternative cost of grantedAlternatives, which spends the key), and the name of
 * the source for the log.
 */
export interface LinkedUse {
  readonly key: string | null;
  readonly anyManaType?: true;
  readonly entersWith?: CounterSpec[];
  readonly free?: true;
  /** std-exile-play-2-1 (CR 601.2f, 118.8): the additional cost of a spell cast this way. */
  readonly addCost?: CostDef;
  readonly source: string;
}

/**
 * std-rx27 (CR 601.3, 601.3e, 607.2a): the ways `player` may cast the card `id` from exile because a static linked permission of an object applies (the plain
 * r5-refs form and the rider form), seen as `chars` (the face being cast, judged as the spell it would be on the stack; that it is the very card the linked
 * ability exiled is judged where it is, CR 400.7). One per different way, as graveyardPermitUses: a permission with no once-each-turn limit is used first.
 */
export function linkedPermitUses(s: GameState, player: PlayerId, id: ObjectId, chars: Chars): LinkedUse[] {
  const o = s.objects[id];
  if (!o || o.kind !== 'card' || o.zone !== 'exile') return [];
  const ctx = ruleContext(s);
  if (!ctx) return [];
  let view: CharsView | undefined;
  const ways = new Map<string, LinkedUse>();
  for (const src of ctx.sources) {
    const e = src.effect;
    const byFilter = e.s === 'permit' && isExileFilterPermit(e); // std-rx27: the cards in exile a description names (no once-each-turn limit, nothing free)
    if (e.s !== 'permit' || !(isLinkedPermit(e) || isLinkedRiderPermit(e) || byFilter)) continue;
    if (src.source === null || src.order[1] !== 0) continue; // a static ability of an object only
    if (!refIncludes(cxOf(ctx, src), e.who, player)) continue;
    if (byFilter) {
      if (!exileFilterNames(ctx, s, src, e, id)) continue;
      const use: LinkedUse = { key: null, ...(e.anyManaType === true ? { anyManaType: true as const } : {}), source: src.name };
      ways.set(JSON.stringify([use.anyManaType ?? null, null, null]), use);
      continue;
    }
    const lk = linkedOf(e.of)!;
    if (!linkNames(s, src, lk.link, id)) continue;
    if (lk.thisTurn && !putThereThisTurn(s, o)) continue; // "exiled with ~ this turn": the card was put into exile this turn (CR 400.7)
    let key: string | null = null;
    if (e.oncePerTurn === true) {
      key = `${src.source}|lnk:${src.order[3]}:${src.order[4]}`;
      if ((s.turnActivations[key] ?? 0) >= 1) continue; // "once each turn"
    }
    if (lk.quality !== null && lk.quality !== undefined) {
      view ??= ctx.view.with(overlayZone(s, id, 'stack'), new Map([[id, chars]]));
      const cx: EvalCx = { s: view.s, all: view, source: src.source, controller: src.controller };
      if (objectMatches(cx, id, lk.quality, spellActor(o)) !== true) continue; // a filter the hooks can't evaluate matches nothing (fail closed)
    }
    const free = isFreeCost(e.costChange);
    const use: LinkedUse = {
      key, ...(e.anyManaType === true ? { anyManaType: true as const } : {}), ...(e.entersWith !== undefined ? { entersWith: e.entersWith } : {}),
      ...(free ? { free: true as const } : {}), ...(e.addCost !== undefined ? { addCost: e.addCost } : {}), source: src.name,
    };
    const sig = JSON.stringify([use.anyManaType ?? null, use.entersWith ?? null, use.free ?? null, use.addCost ?? null]);
    const prev = ways.get(sig);
    if (prev !== undefined && (prev.key === null || key !== null)) continue;
    ways.set(sig, use);
  }
  return [...ways.values()];
}

/** std-rx27: the cast method of the alternative cost of nothing a linked permission gives (grantedAlternatives); a named-free method (isNamedFreeMethod). */
export const LINKED_FREE_METHOD = `${GRANTED_ALT_METHOD}:named:linked:`;
export const isLinkedFreeMethod = (method: string | undefined): boolean => method !== undefined && method.startsWith(LINKED_FREE_METHOD);

/**
 * std-rx27 (CR 118.9, 601.2b): the alternative costs of nothing the free linked permissions give `player` for `id` in exile ("... from among cards exiled with ~
 * this turn without paying its mana cost"), each with its once-each-turn key (spent by actions/cast.ts#castSpell with the granted alternative).
 */
function linkedFreeAlternatives(s: GameState, player: PlayerId, id: ObjectId, chars: Chars): GrantedAlternative[] {
  return linkedPermitUses(s, player, id, chars).filter((u) => u.free === true)
    .map((u, i) => ({ method: `${LINKED_FREE_METHOD}${i + 1}`, cost: {}, name: 'granted', key: u.key, source: u.source }));
}

/**
 * std-rx27 (CR 702.8a, 601.3b, 607.2a, 400.7): of a "haveFlash" permission whose `of` names the cards a linked ability exiled ("you may cast them as though they
 * had flash"): is `id` one of them, still in exile (the identity is judged where the card is; its qualities, if any, as the spell, by the caller)? Undefined
 * when `of` names no linked cards (the caller judges it as before).
 */
export function linkedFlashNames(s: GameState, src: RuleSource, p: PermissionDef, id: ObjectId): { quality: PermissionDef['of'] | null } | false | undefined {
  const lk = linkedOf(p.of);
  if (lk === undefined) return undefined;
  if (src.order[1] !== 0 || !linkNames(s, src, lk.link, id)) return false; // a static ability of an object only
  if (lk.thisTurn && !putThereThisTurn(s, s.objects[id]!)) return false;
  return { quality: lk.quality };
}
