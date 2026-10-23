/**
 * rules/hookpoints.ts: the ONE place engine call-sites ask "may this happen?". Owner: WP0 (final after WP0; never edited by later packages).
 *
 * Why it exists: keyword hooks (WP3) and static restrictions (WP16) both need to be consulted at the same call-sites (combat declaration,
 * targeting, casting, activating, ...). If both packages edited rules/combat-rules.ts, rules/targets.ts and actions/cast.ts they would collide.
 * WP0 rewired every call-site ONCE to call a function of this file; each package contributes a provider object registered below.
 * Every function returns the first denial any provider produces ("can't" beats "can", CR 101.2) or null.
 *
 * Milestone 4 checked keywords inline at these call-sites. WP0 moved that logic, unchanged, into the keyword provider
 * (keywords/hooks/index.ts); WP3 splits it per keyword. The statics provider (statics/hooks.ts) is empty until WP16.
 *
 * WP0 REVIEW CHANGES (before the freeze): `canCast` knows the face and the way it is cast; the boolean queries know the game, the object and the player; a
 * keyword denial can be waived by a permission (`Denial.waivedBy`, `permits`) so "attack as though it didn't have defender" is expressible. See review-hookpoints.test.ts.
 *
 * WP0 DEVIATION from the contract text: hooks take a `GameLike` (anything with the state in `s`, which a `Game` is) instead of a `Game`, because the
 * milestone 3/4 rule checks that call them are pure functions of a `GameState` (legalActions, auto-pass) and have no `Game`. Providers only read `g.s`.
 */
import type { Denial } from './denial';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameState } from '../types/state';
import type { Chars } from './characteristics';
import type { PaymentOption } from '../keywords/types';
import type { CostDef } from '../types/ability';
import { keywordProvider } from '../keywords/hooks';
import { staticsProvider } from '../statics/hooks';
import { holdStill } from '../statics/stable-scope';

/** How a spell is being cast, for `canCast`: the alternative way ("flashback"), and whether both halves of a fuse split card are cast together (CR 702.102a). */
export interface CastVia {
  method?: string;
  fused?: boolean;
  /**
   * M6-0 (m6 design 2.6, INTERFACE CHANGE, additive): the characteristics a cast option gives the spell from the moment it is announced (face down, prototyped,
   * back face up: CR 708.4, 718.3a-b, 712.8c; actions/cast-options.ts#CastOptionProvider.charsOverride), so "can't cast" effects judge the spell it will be.
   */
  chars?: Chars;
}

/**
 * A question a provider answers with yes/no: does a permission waive the keyword denial between `subject` and `other` (CR 609.4)? For
 * `attackAsThoughNoDefender` the subject is the attacker and `other` what it attacks; for `blockAsThough` the subject is the blocker, `other` the attacker, and
 * `asThough` the evasion keyword ("flying", "shadow", "horsemanship", "intimidate", "fear", "skulk", "landwalk") the permission ignores.
 */
export interface PermitQuery {
  action: 'attackAsThoughNoDefender' | 'blockAsThough' | 'targetAsThoughNoHexproof'; // std-rx32: for targetAsThoughNoHexproof the subject is the target
  subject: ObjectId;
  other: ObjectId | PlayerId;
  asThough?: string;
}

/** What counters a spell or ability (CR 701.6a): the countering spell, or the source of the countering ability, and its controller (WP31 review). */
export interface CounterBy {
  source: ObjectId;
  controller: PlayerId;
}

/** What a hook may read: the game state. A `Game` (core/game.ts) is a `GameLike`; so is `{ s }` made from a `GameState`. */
export interface GameLike {
  readonly s: GameState;
}

/** Everything a provider may veto. Providers implement the subset they care about. */
export interface RuleHookProvider {
  name: 'keywords' | 'statics';
  canAttack?(g: GameLike, attacker: ObjectId, defender: PlayerId | ObjectId): Denial | null; // CR 508.1, 702.3b
  canBlock?(g: GameLike, blocker: ObjectId, attacker: ObjectId): Denial | null; // CR 509.1a-b: evasion keywords, protection, "can't block", "can't be blocked by"
  blockSetValid?(g: GameLike, attacker: ObjectId, blockers: ObjectId[]): Denial | null; // CR 509.1b: menace
  /** `source` is the spell or the permanent with the ability (null when unknown); an object that has left the game is read from last known information. */
  canBeTargeted?(g: GameLike, target: ObjectId | PlayerId, source: ObjectId | null, controller: PlayerId): Denial | null; // CR 115: hexproof, shroud, protection, "can't be the target"
  /** `face` is the face being cast (CR 709.3a, 712.11, 715.3: only that half is evaluated; the object in hand has the combined or front characteristics); `via` how. */
  canCast?(g: GameLike, spell: ObjectId, player: PlayerId, face: number, via: CastVia): Denial | null; // CR 601.3: "can't cast", castFromZone
  canActivate?(g: GameLike, source: ObjectId, abilityKey: string, player: PlayerId): Denial | null; // CR 602.5
  /** WP31 INTERFACE CHANGE (review): `face` is the face the land is played with (CR 712.12), so "can't enter the battlefield" sees the permanent it would be (CR 614.17d). */
  canPlayLand?(g: GameLike, land: ObjectId, player: PlayerId, face?: number): Denial | null; // CR 305.2 (rule mod landPlays)
  canAttach?(g: GameLike, attachment: ObjectId, host: ObjectId): Denial | null; // CR 702.16c-d, 704.5m-n
  /** WP31 INTERFACE CHANGE (review): `by` is the spell or ability countering it (its source and controller), for "can't be countered by blue spells" (CR 101.2). */
  canBeCountered?(g: GameLike, spell: ObjectId, by?: CounterBy): Denial | null; // CR 101.2: "can't be countered"
  /**
   * Boolean/number queries (no denial text needed). `undefined` = no opinion. They know the game, the object and the player so that state-dependent permissions
   * ("you may cast spells as though they had flash", "activate abilities as though they had haste") can be evaluated; `c` is the object's characteristics.
   */
  attackTaps?(g: GameLike, attacker: ObjectId, player: PlayerId, c: Chars): boolean | undefined; // vigilance: false = attacking doesn't cause it to tap
  summoningSick?(g: GameLike, object: ObjectId, player: PlayerId, c: Chars): boolean | undefined; // haste: false = not subject to summoning sickness
  /** r4-fxz (additive): "you may activate abilities of creatures you control as though those creatures had haste" (CR 302.6, 602.5a, 609.4): true = its {T} and {Q} abilities may be activated, never its attacks */
  activatesAsThoughHaste?(g: GameLike, object: ObjectId, player: PlayerId, c: Chars): boolean | undefined;
  castsAsInstant?(g: GameLike, spell: ObjectId, player: PlayerId, c: Chars): boolean | undefined; // flash: true = may be cast any time it could be an instant
  /** r4-mech INTERFACE CHANGE (additive), CR 606.3: true = the player may activate the loyalty abilities of this permanent any time they could cast an instant. */
  loyaltyAsInstant?(g: GameLike, source: ObjectId, player: PlayerId): boolean | undefined;
  /** FAST5 T56 INTERFACE CHANGE (additive): the amounts of generic mana the permissions that let this spell be cast as though it had flash for a price ask (CR 601.2f, 601.3b). */
  castFlashCosts?(g: GameLike, spell: ObjectId, player: PlayerId, c: Chars): number[];
  /**
   * std-rx10 INTERFACE CHANGE (additive): the additional costs the permissions that let this spell be cast as though it had flash for a cost other than mana ask
   * ("if you behold a Dragon as an additional cost to cast it", CR 601.2b, 601.2f, 601.3b, 118.8).
   */
  castFlashAddCosts?(g: GameLike, spell: ObjectId, player: PlayerId, c: Chars): CostDef[];
  /** Does a permission waive the keyword denial of this query (`Denial.waivedBy`)? CR 609.4. Only a denial marked `waivedBy` is ever dropped. */
  permits?(g: GameLike, query: PermitQuery): boolean;
  paymentOptions?(g: GameLike, spell: ObjectId, caster: PlayerId): PaymentOption[]; // convoke, improvise, delve, emerge: the options of the CASTER (CR 702.51a)
}

/** The registered providers. The order is irrelevant: any denial wins. Read lazily, because the provider modules import rules code that imports this file. */
export type Providers = readonly RuleHookProvider[];
const providers = (): Providers => [keywordProvider, staticsProvider];

export interface Hookpoints {
  canAttack(g: GameLike, attacker: ObjectId, defender: PlayerId | ObjectId): Denial | null;
  canBlock(g: GameLike, blocker: ObjectId, attacker: ObjectId): Denial | null;
  blockSetValid(g: GameLike, attacker: ObjectId, blockers: ObjectId[]): Denial | null;
  canBeTargeted(g: GameLike, target: ObjectId | PlayerId, source: ObjectId | null, controller: PlayerId): Denial | null;
  canCast(g: GameLike, spell: ObjectId, player: PlayerId, face: number, via: CastVia): Denial | null;
  canActivate(g: GameLike, source: ObjectId, abilityKey: string, player: PlayerId): Denial | null;
  canPlayLand(g: GameLike, land: ObjectId, player: PlayerId, face?: number): Denial | null;
  canAttach(g: GameLike, attachment: ObjectId, host: ObjectId): Denial | null;
  canBeCountered(g: GameLike, spell: ObjectId, by?: CounterBy): Denial | null;
  attackTaps(g: GameLike, attacker: ObjectId, player: PlayerId, c: Chars): boolean; // true unless some provider says false
  summoningSick(g: GameLike, object: ObjectId, player: PlayerId, c: Chars): boolean; // true unless some provider says haste
  activatesAsThoughHaste(g: GameLike, object: ObjectId, player: PlayerId, c: Chars): boolean; // r4-fxz: false unless some provider permits it
  castsAsInstant(g: GameLike, spell: ObjectId, player: PlayerId, c: Chars): boolean; // false unless some provider says flash
  loyaltyAsInstant(g: GameLike, source: ObjectId, player: PlayerId): boolean; // r4-mech: false unless some provider permits it (CR 606.3)
  castFlashCosts(g: GameLike, spell: ObjectId, player: PlayerId, c: Chars): number[]; // FAST5 T56: [] unless a permission lets it be cast as though it had flash for a price
  castFlashAddCosts(g: GameLike, spell: ObjectId, player: PlayerId, c: Chars): CostDef[]; // std-rx10: [] unless a permission lets it be cast so for an additional cost
  paymentOptions(g: GameLike, spell: ObjectId, caster: PlayerId): PaymentOption[];
}

/**
 * Combine providers into the hookpoints call-sites use. A denial from any provider wins ("can't" beats "can", CR 101.2); the boolean queries start
 * from the rules default (a creature taps to attack, is summoning sick, a spell is not an instant) and any provider's explicit answer overrides it.
 * Exported so tests can combine fake providers; the engine uses `hookpoints` below.
 */
export function createHookpoints(providers: () => Providers): Hookpoints {
  // P1 (performance): every question is a read of `g.s` that does not change it ("Providers only read `g.s`", above), so it holds the state still: the
  // providers' characteristics and rule-effect lookups check their caches once per question instead of once per provider and object.
  const firstDenial = (ask: (p: RuleHookProvider) => Denial | null | undefined, waiver?: { g: GameLike; subject: ObjectId; other: ObjectId | PlayerId }, g?: GameLike): Denial | null =>
    g === undefined ? denialOf(ask, waiver) : holdStill(g.s, () => denialOf(ask, waiver));
  const denialOf = (ask: (p: RuleHookProvider) => Denial | null | undefined, waiver?: { g: GameLike; subject: ObjectId; other: ObjectId | PlayerId }): Denial | null => {
    for (const p of providers()) {
      const d = ask(p);
      if (!d) continue;
      // A denial that a keyword rule itself produced is dropped when a permission waives exactly that rule for this subject (CR 609.4); any other denial wins.
      const w = d.waivedBy;
      if (w && waiver) {
        const query: PermitQuery = { action: w.action, subject: waiver.subject, other: waiver.other, ...(w.asThough !== undefined ? { asThough: w.asThough } : {}) };
        if (providers().some((q) => q.permits?.(waiver.g, query) === true)) continue;
      }
      return d;
    }
    return null;
  };
  return {
    canAttack: (g, attacker, defender) => firstDenial((p) => p.canAttack?.(g, attacker, defender), { g, subject: attacker, other: defender }, g),
    canBlock: (g, blocker, attacker) => firstDenial((p) => p.canBlock?.(g, blocker, attacker), { g, subject: blocker, other: attacker }, g),
    blockSetValid: (g, attacker, blockers) => firstDenial((p) => p.blockSetValid?.(g, attacker, blockers), undefined, g),
    canBeTargeted: (g, target, source, controller) => firstDenial((p) => p.canBeTargeted?.(g, target, source, controller), { g, subject: target, other: source ?? controller }, g),
    canCast: (g, spell, player, face, via) => firstDenial((p) => p.canCast?.(g, spell, player, face, via), undefined, g),
    canActivate: (g, source, abilityKey, player) => firstDenial((p) => p.canActivate?.(g, source, abilityKey, player), undefined, g),
    canPlayLand: (g, land, player, face) => firstDenial((p) => p.canPlayLand?.(g, land, player, face), undefined, g),
    canAttach: (g, attachment, host) => firstDenial((p) => p.canAttach?.(g, attachment, host), undefined, g),
    canBeCountered: (g, spell, by) => firstDenial((p) => p.canBeCountered?.(g, spell, by), undefined, g),
    attackTaps: (g, attacker, player, c) => holdStill(g.s, () => providers().every((p) => p.attackTaps?.(g, attacker, player, c) !== false)),
    summoningSick: (g, object, player, c) => holdStill(g.s, () => !providers().some((p) => p.summoningSick?.(g, object, player, c) === false)),
    activatesAsThoughHaste: (g, object, player, c) => holdStill(g.s, () => providers().some((p) => p.activatesAsThoughHaste?.(g, object, player, c) === true)),
    castsAsInstant: (g, spell, player, c) => holdStill(g.s, () => providers().some((p) => p.castsAsInstant?.(g, spell, player, c) === true)),
    loyaltyAsInstant: (g, source, player) => holdStill(g.s, () => providers().some((p) => p.loyaltyAsInstant?.(g, source, player) === true)),
    castFlashCosts: (g, spell, player, c) => holdStill(g.s, () => providers().flatMap((p) => p.castFlashCosts?.(g, spell, player, c) ?? [])),
    castFlashAddCosts: (g, spell, player, c) => holdStill(g.s, () => providers().flatMap((p) => p.castFlashAddCosts?.(g, spell, player, c) ?? [])),
    paymentOptions: (g, spell, caster) => holdStill(g.s, () => providers().flatMap((p) => p.paymentOptions?.(g, spell, caster) ?? [])),
  };
}

/** The hookpoints of the engine: the keyword provider and the statics provider. */
export const hookpoints: Hookpoints = createHookpoints(providers);

/** Wrap a state for a hook call: `hookpoints.canAttack(gameOf(s), ...)`. */
export const gameOf = (s: GameState): GameLike => ({ s });
