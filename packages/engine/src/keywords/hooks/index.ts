/**
 * The keyword provider of rules/hookpoints.ts. Owner: WP3 (WP0 wrote it by moving milestone 4's inline keyword checks into one file; WP3 split it here).
 *
 * One module per keyword (`hooks/<keyword>.ts`) implements the `KeywordHooks` of design 7.3 for that keyword and nothing else. This file is the dispatcher:
 * it registers the implementations by canonical keyword name (`HOOK_IMPLS`), registers them with the keyword registry (`bindHooks`, so
 * `keywordRegistry.get(name).hookImpl` is filled), and adapts them to the `RuleHookProvider` the hookpoints call. A hook is asked for each keyword
 * the objects involved have NOW (through the characteristics function), so a keyword that is granted or removed is honored. Each call asks, in the fixed order of
 * `HOOK_ORDER`, only the keywords that are present, and returns the first denial; the order is that of milestone 4, so the first reason named is unchanged.
 *
 * Rules implemented (all CR 702): defender 3b, flying 9b / reach 17b, shadow 28b, horsemanship 31b, intimidate 13b, fear 36b, skulk 118b, landwalk 14c,
 * protection 16b-d, 16f, hexproof 11b/d, shroud 18a, menace 111b, vigilance 20b, haste 10b, flash 8a, convoke 51a, improvise 126a, delve 66a (std-tdm). The combat damage keywords (first strike, double
 * strike, trample, deathtouch, lifelink, infect, wither, toxic) and indestructible are read by the damage, destruction and state-based action code through the
 * characteristics (their `readers` in keywords/data say where); they have no hook because no hookpoint exists for them yet.
 */
import type { Denial } from '../../rules/denial';
import type { GameLike, RuleHookProvider } from '../../rules/hookpoints';
import type { ObjectId, PlayerId } from '../../types/ids';
import { keywordRegistry } from '../registry';
import type { HookName, KeywordHooks } from '../types';
import { cached, charsOfId, keywordNames, objectOf } from './common';
import { convokeHooks } from './convoke';
import { defenderHooks } from './defender';
import { delveHooks } from './delve';
import { fearHooks } from './fear';
import { flashHooks } from './flash';
import { flyingHooks } from './flying';
import { hasteHooks } from './haste';
import { hexproofHooks } from './hexproof';
import { horsemanshipHooks } from './horsemanship';
import { improviseHooks } from './improvise';
import { intimidateHooks } from './intimidate';
import { landwalkApplies, landwalkHooks } from './landwalk';
import { menaceHooks } from './menace';
import { protectionHooks } from './protection';
import { shadowHooks } from './shadow';
import { shroudHooks } from './shroud';
import { skulkHooks } from './skulk';
import { vigilanceHooks } from './vigilance';

export { landwalkApplies }; // the landwalk test is a keyword rule (CR 702.14c); the keyword provider owns it

/** Hook implementations by canonical keyword name (the keys are exactly the names whose data file lists hooks; a test pins both directions). */
export const HOOK_IMPLS: Readonly<Record<string, Partial<KeywordHooks>>> = {
  convoke: convokeHooks,
  defender: defenderHooks,
  delve: delveHooks, // std-tdm (CR 702.66a)
  fear: fearHooks,
  flash: flashHooks,
  flying: flyingHooks,
  haste: hasteHooks,
  hexproof: hexproofHooks,
  horsemanship: horsemanshipHooks,
  improvise: improviseHooks,
  intimidate: intimidateHooks,
  landwalk: landwalkHooks,
  menace: menaceHooks,
  protection: protectionHooks,
  shadow: shadowHooks,
  shroud: shroudHooks,
  skulk: skulkHooks,
  vigilance: vigilanceHooks,
};

/**
 * The keywords asked for each hook, in order (the order of milestone 4's checks: evasion first, protection last, so a creature that breaks several rules
 * names the same first reason as before). Every keyword with a hook is listed exactly once per hook it implements.
 */
export const HOOK_ORDER: Readonly<Partial<Record<HookName, readonly string[]>>> = {
  canAttack: ['defender'],
  canBeBlocked: ['flying', 'shadow', 'horsemanship', 'intimidate', 'fear', 'skulk', 'landwalk', 'protection'],
  blockSetValid: ['menace'],
  canBeTargetedBy: ['shroud', 'hexproof', 'protection'],
  canBeEnchantedBy: ['protection'],
  canBeEquippedBy: ['protection'],
  attackTaps: ['vigilance'],
  summoningSick: ['haste'],
  castTiming: ['flash'],
  paymentOptions: ['convoke', 'improvise', 'delve'],
};

keywordRegistry.bindHooks(HOOK_IMPLS);

type Impl<H extends HookName> = NonNullable<KeywordHooks[H]>;

/** The implementations of `hook` for the keywords in `present`, in `HOOK_ORDER`. */
function implsOf<H extends HookName>(hook: H, present: ReadonlySet<string>): Impl<H>[] {
  const out: Impl<H>[] = [];
  for (const name of HOOK_ORDER[hook] ?? []) {
    const impl = HOOK_IMPLS[name]?.[hook];
    if (present.has(name) && impl !== undefined) out.push(impl as Impl<H>);
  }
  return out;
}

function first(denials: Iterable<Denial | null>): Denial | null {
  for (const d of denials) if (d) return d;
  return null;
}

const isAura = (subtypes: readonly string[]): boolean => subtypes.includes('Aura');

export const keywordProvider: RuleHookProvider = {
  name: 'keywords',

  // CR 702.3b: defender.
  canAttack: (g, attacker, defender): Denial | null =>
    cached(() => {
      const c = charsOfId(g, attacker);
      if (c === null) return null;
      return first(implsOf('canAttack', keywordNames(c)).map((impl) => impl(g, attacker, defender)));
    }),

  // CR 509.1b: evasion abilities of the attacker (flying and reach, shadow, horsemanship, intimidate, fear, skulk, landwalk, protection).
  canBlock: (g, blocker, attacker): Denial | null =>
    cached(() => {
      const ac = charsOfId(g, attacker);
      const bc = charsOfId(g, blocker);
      if (ac === null || bc === null) return null;
      return first(implsOf('canBeBlocked', keywordNames(ac, bc)).map((impl) => impl(g, attacker, blocker)));
    }),

  // CR 702.111b: menace. A single blocker is not enough.
  blockSetValid: (g, attacker, blockers): Denial | null =>
    cached(() => {
      const ac = charsOfId(g, attacker);
      if (ac === null) return null;
      return first(implsOf('blockSetValid', keywordNames(ac)).map((impl) => impl(g, attacker, blockers)));
    }),

  // CR 115.1, 702.11b, 702.16b, 702.18a: shroud, hexproof (also "from X") and protection. Players have no such keywords yet.
  canBeTargeted: (g, target, source, controller): Denial | null =>
    cached(() => {
      const t = objectOf(g, target);
      if (t === undefined || t.zone !== 'battlefield') return null; // the keywords function on the battlefield only (CR 113.6, 702.16a)
      const tc = charsOfId(g, target);
      if (tc === null) return null;
      return first(implsOf('canBeTargetedBy', keywordNames(tc)).map((impl) => impl(g, target, source, controller)));
    }),

  // CR 702.16c-d: protection stops Auras and Equipment from being attached to the host. An Aura asks the enchant hooks, anything else the equip hooks.
  canAttach: (g, attachment, host): Denial | null =>
    cached(() => {
      const a = charsOfId(g, attachment);
      const h = charsOfId(g, host);
      if (a === null || h === null) return null;
      const hook: 'canBeEnchantedBy' | 'canBeEquippedBy' = isAura(a.subtypes) ? 'canBeEnchantedBy' : 'canBeEquippedBy';
      return first(implsOf(hook, keywordNames(h)).map((impl) => impl(g, attachment, host)));
    }),

  // CR 702.20b: vigilance. CR 702.10b: haste. CR 702.8a: flash. (They depend on the characteristics only; the game, object and player are for the statics provider.)
  attackTaps(g: GameLike, attacker: ObjectId, player: PlayerId, c): boolean | undefined {
    return implsOf('attackTaps', keywordNames(c)).some((impl) => impl(g, attacker, player, c) === false) ? false : undefined;
  },
  summoningSick(g: GameLike, object: ObjectId, player: PlayerId, c): boolean | undefined {
    return implsOf('summoningSick', keywordNames(c)).some((impl) => impl(g, object, player, c) === false) ? false : undefined;
  },
  castsAsInstant(g: GameLike, spell: ObjectId, player: PlayerId, c): boolean | undefined {
    return implsOf('castTiming', keywordNames(c)).some((impl) => impl(g, spell, player, c) === 'instant') ? true : undefined;
  },

  // CR 702.51a: convoke; CR 702.126a: improvise (FAST5X E26). Delve and emerge are not payment options here (rules/payment-options.ts). The options of every keyword the spell has.
  paymentOptions: (g, spell, caster) =>
    cached(() => {
      const c = charsOfId(g, spell);
      if (c === null) return [];
      return implsOf('paymentOptions', keywordNames(c)).flatMap((impl) => impl(g, spell, caster));
    }),
};
