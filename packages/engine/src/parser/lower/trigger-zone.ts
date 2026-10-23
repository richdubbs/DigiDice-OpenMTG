/**
 * Where a triggered ability functions when that is not only the battlefield (CR 113.6k, 113.6m). Added by the WP19 review to the WP17 driver
 * (lower/ability.ts#triggered): the engine collects a triggered ability without `zone` on the battlefield only (triggers/collect.ts), so a trigger that
 * functions elsewhere must never be handed out as an automated battlefield trigger. Such an ability is a manual triggered ability ("Trigger now", design
 * 6.6) that functions in the zones named here. Pure; text-based where the effect is not understood (the effect sentence is often manual).
 */
import type { TriggerDef, ZoneName } from '../../types/ability';

/** Verbs of `action` events that happen to a permanent on the battlefield (CR 701): a self trigger on them can trigger there (CR 113.6). */
const BATTLEFIELD_VERBS: ReadonlySet<string> = new Set(['sacrifice', 'destroy', 'tap', 'untap', 'attach', 'transform', 'regenerate', 'exploit' /* std-rx17: the exploiting creature is on the battlefield (CR 702.110b) */]);
/** Where a card is after a keyword action done to it outside the battlefield (CR 702.29c: "from whatever zone the card winds up in"). */
const AFTER_VERB: Readonly<Record<string, ZoneName>> = { discard: 'graveyard', cycle: 'graveyard', mill: 'graveyard', counter: 'graveyard', exile: 'exile', reveal: 'hand' };
const ZONE_WORDS: Readonly<Record<string, ZoneName>> = { graveyard: 'graveyard', hand: 'hand', library: 'library', exile: 'exile' };
const zones = (z: ZoneName | ZoneName[] | undefined): ZoneName[] => (z === undefined ? [] : [z].flat());

/**
 * "[move] ~ from your graveyard", "cast ~ from your graveyard", "~ from exile", "if ~ is in your graveyard". FAST4 T31: also ~ listed with a target card from
 * the same zone ("Return ~ and target land card from your graveyard to the battlefield tapped": "from your graveyard" says where both are).
 */
// Standard round 3, r3-trig (CR 113.6m): the lookbehind had a raw backspace character where `\b` was meant, so "named ~" was never excluded; and not after "on"
// ("the number of coin counters on ~ from your graveyard", Wishing Well): there "~" is what the counters are on, and "from your graveyard" ends the description
// of the card the instruction names before it, which is not ~
const MOVES_OR_READS = /(?<!\bnamed |\bon )~ (?:and target [a-z' -]+? card )?(?:from|is in) (?:your |its owner's |their |a |an opponent's |the )?(graveyard|hand|library|exile)\b/i;
/** CR 113.6m exception: an earlier part of the effect puts ~ into that zone ("exile it. ... return ~ from exile"). */
const PUTS_INTO: Readonly<Record<string, RegExp>> = {
  exile: /\bexiles? (?:it|~)\b/i,
  graveyard: /\b(?:it|~) into (?:your|its owner's|their) graveyard\b/i,
  hand: /\b(?:it|~) to (?:your|its owner's|their) hand\b/i,
  library: /\b(?:it|~) (?:into|on top of|on the bottom of) (?:your|its owner's|their) library\b/i,
};

/** Text outside quoted abilities: a granted ability functions on the object that gets it, not on this one (CR 113.6, 113.1c). */
const unquoted = (text: string): string => text.replace(/["“][^"”]*["”]/g, ' ');

export interface OffBattlefield {
  zone: ZoneName[];
  reason: string;
  /** FAST5 T37: the ability is automated (a triggered ability with this `zone`), not a manual one: only "When you cycle ~" with an effect that does not name ~ (CR 702.29d). */
  automate?: boolean;
  /**
   * CLOUD std-dft (merge line D): the effect may name ~ only as the source of damage (lower/ability.ts#cycledCardOnlyAsSource): "When you cycle ~", whose card is
   * in the graveyard it triggered from (CR 702.29c, 609.7a). std-sos's graveyard triggers that move ~ out of the graveyard (CR 113.6m) do not set it.
   */
  onlyAsSource?: boolean;
  /** Standard round 3, r3-trig: the zones of the manual triggered ability when the automation does not go through (the zones it had before this slice: G10). */
  manualZone?: ZoneName[];
}

/**
 * The zones a triggered ability functions in when that is not the battlefield alone, with the reason; null when it functions on the battlefield as usual
 * (CR 113.6). `rest` is the normalized text after the trigger clause (intervening "if" included; `~` is the object itself).
 *  - 113.6k: a trigger condition on ~ that cannot trigger from the battlefield: ~ put into another zone without leaving the battlefield ("put into a
 *    graveyard from anywhere", "is exiled"), a keyword action done to ~ outside the battlefield ("When you discard / cycle ~", CR 702.29c), "When you cast
 *    ~". Leaves-the-battlefield conditions look back (CR 603.10a) and enters conditions are seen on the battlefield (CR 603.6a): those function there.
 *  - 113.6m: the effect or an intervening "if" moves ~ out of, or reads ~ in, another zone ("return ~ from your graveyard", "if ~ is in your graveyard"),
 *    unless the trigger condition or an earlier part of the effect puts ~ into that zone, or ~ is an Aura and the trigger is the enchanted object leaving
 *    the battlefield. "This ability also triggers if ~ is in your graveyard" adds that zone to the battlefield.
 */
export function offBattlefield(trigger: TriggerDef, rest: string): OffBattlefield | null {
  const entersZones: ZoneName[] = [];
  let auraLeaves = false;
  for (const p of trigger.on) {
    if (p.ev === 'zoneChange' && p.subject.self === true) {
      const from = zones(p.from);
      const to = zones(p.to);
      entersZones.push(...to);
      if (!from.includes('battlefield') && !to.includes('battlefield')) {
        // p2-c-cast-zone-1 (CR 113.6k, 400.7, 603.6c): "When ~ is put into your graveyard from your library" (Narcomoeba) triggers from the graveyard it was put into:
        // triggers/normalize.ts names the card's new object in that public zone as the event's subject, and triggers/collect.ts collects the abilities that work there
        // from the cards in graveyards. Automated when the whole effect is understood (lower/ability.ts#triggered), the graveyard only, from a zone other than the battlefield
        const intoGraveyard = to.length === 1 && to[0] === 'graveyard' && from.length > 0 && trigger.on.length === 1;
        return { zone: to, reason: 'a trigger condition on ~ that cannot trigger from the battlefield functions where it can trigger (CR 113.6k): not automated by this parser version', ...(intoGraveyard ? { automate: true } : {}) };
      }
    }
    if (p.ev === 'zoneChange' && p.subject.attachedToSource === true && zones(p.from).includes('battlefield')) auraLeaves = true;
    if (p.ev === 'action' && p.object?.self === true && !BATTLEFIELD_VERBS.has(p.verb)) {
      const z = AFTER_VERB[p.verb];
      // FAST5 T37 (CR 702.29d, 113.6k): "When you cycle ~" triggers from the graveyard, where the cycled card now is (engine: actions/activate.ts emits the
      // 'cycle' action for the discarded card). Automated only when the effect does not name the card itself or a pronoun (the card is no longer where it was) and asks no payment on resolution (an {X} payment has no chooser there: the lint makes the step manual, which G10 counts as a loss of the kept effect)
      // CLOUD std-dft: a pronoun or "~" is now judged on the lowered effect instead (lower/ability.ts#cycledCardOnlyAsSource): "It gains trample" names the
      // target, and "it deals 1 damage to each opponent" names the cycled card as the source of the damage (CR 702.29c, 609.7a, 113.7a); any other use of the card
      // (moving it, counting it) stays manual as before. A payment on resolution still keeps the trigger manual.
      if (p.verb === 'cycle' && trigger.on.length === 1 && p.actor === 'you' && !/\bpay\b/i.test(unquoted(rest))) {
        return { zone: ['graveyard'], reason: `"${p.verb}" done to ~ cannot trigger from the battlefield (CR 113.6k, 702.29c): not automated by this parser version`, automate: true, onlyAsSource: true };
      }
      // Standard round 3, r3-trig (CR 701.9a, 113.6k, 702.35a): "When you discard this card" triggers from the zone the discarded card went to: the graveyard, or
      // exile when madness (or another replacement) exiled it instead (CR 702.35a: it is still discarded). triggers/normalize.ts names the card in that public zone
      // as the discard action's subject, so the ability is collected from there. Automated under the same terms as the cycle trigger above (the effect names
      // the card at most as the source of damage, and asks no payment on resolution); a discard into a hidden zone (a library) names no object there: no trigger
      if (p.verb === 'discard' && trigger.on.length === 1 && p.actor === 'you' && !/\bpay\b/i.test(unquoted(rest))) {
        return { zone: ['graveyard', 'exile'], manualZone: ['graveyard'], reason: `"${p.verb}" done to ~ cannot trigger from the battlefield (CR 113.6k, 702.29c): not automated by this parser version`, automate: true, onlyAsSource: true };
      }
      return { zone: z ? [z] : [], reason: `"${p.verb}" done to ~ cannot trigger from the battlefield (CR 113.6k, 702.29c): not automated by this parser version` };
    }
    if (p.ev === 'cast' && p.spell?.self === true) return { zone: ['stack'], reason: 'a cast trigger of ~ functions on the stack (CR 113.6k): not automated by this parser version' };
  }
  const m = selfZoneMention(rest);
  if (m === null || auraLeaves) return null;
  const zone = m.zone;
  if (entersZones.includes(zone) || m.putThereFirst) return null;
  const also = /\balso triggers if ~ is in\b/i.test(unquoted(rest));
  // std-sos (CR 113.6m, 603.3a): a trigger that moves ~ out of its owner's graveyard ("Whenever ..., you may pay {W/B}. If you do, return ~ from your graveyard to your hand") is automated
  // with `zone: ['graveyard']` when its whole effect is understood (lower/ability.ts checks that); the engine collects it from the cards in graveyards (triggers/collect.ts).
  // Cloud std-woe made the same rule for "~ from your graveyard" moves (CR 400.7: a card that left the graveyard is a new object the effect does not find); merge line CD
  // keeps std-sos's, which also covers a trigger that checks ~ in the graveyard, and both slices' tests pass with it
  return { zone: also ? ['battlefield', zone] : [zone], reason: `the ability moves or checks ~ in the ${zone}, so it functions ${also ? 'there too' : 'only there'} (CR 113.6m): not automated by this parser version`, ...(!also && zone === 'graveyard' ? { automate: true } : {}) };
}

/**
 * CR 113.6m, read from the text (quoted abilities skipped): the first zone other than the battlefield that `text` moves ~ out of or reads ~ in ("return ~
 * from your graveyard", "if ~ is in your hand"), and whether an earlier part of the same text puts ~ into that zone ("exile ~. ... return ~ from exile").
 * Shared by triggered abilities (above) and activated ones (lower/activation.ts#activationZone). `~` is the object itself.
 */
export function selfZoneMention(text: string): { zone: ZoneName; putThereFirst: boolean } | null {
  const t = unquoted(text);
  const m = MOVES_OR_READS.exec(t);
  if (m === null) return null;
  const zone = ZONE_WORDS[m[1]!.toLowerCase()]!;
  return { zone, putThereFirst: PUTS_INTO[zone]!.test(t.slice(0, m.index)) };
}

/**
 * FAST5X E6 (CR 113.6k, 702.170a): the zones a triggered ability AUTOMATICALLY functions in when its trigger condition on ~ can happen in one zone only and the
 * engine collects triggered abilities there (triggers/collect.ts collects an ability with `zone` from the objects in that zone): "When this card becomes
 * plotted" (a plotted card is a card in exile). Null for every other trigger (the battlefield as usual, or `offBattlefield`'s manual reading).
 */
export function homeZone(trigger: TriggerDef): ZoneName[] | null {
  const [p] = trigger.on;
  if (trigger.on.length !== 1 || p === undefined || p.ev !== 'becomes' || p.what !== 'plotted' || p.by !== undefined) return null;
  return p.object.self === true && Object.keys(p.object).length === 1 ? ['exile'] : null;
}
