/**
 * Unsanctioned cards (design 12.3). Owner: WP24 (part of the card pool, cards/pool.ts re-exports it). A separate module so that
 * cards/compile.ts can apply it without importing the rest of the pool (which loads the capability model).
 *
 * CR 100.7 names the cards the rules do not cover: silver-border and acorn cards and the Mystery Booster / Unknown Event playtest cards. Their text may refer
 * to things outside the game rules, so the engine automates nothing they say (never silently wrong). What it keeps are the keyword abilities the compiler
 * recognized (CR 702): a keyword means exactly what the Comprehensive Rules say whatever card it is printed on, and the engine's procedures read them
 * (enchant gives an Aura spell its target, CR 303.4a; flying limits blocks, CR 702.9b). Making them manual would not leave those rules to the players: the
 * engine would cast the Aura with no target and offer illegal blocks. The card's level stays `manual` (design 12.1).
 */
import type { AbilityDef, ManualAbilityDef } from '../types/ability';
import type { AbilityAutomation } from '../types/automation';
import type { CardDef } from '../types/card';

const SHAPES: Readonly<Record<string, ManualAbilityDef['shape']>> = {
  spell: 'spell', activated: 'activated', triggered: 'triggered', chapter: 'triggered', static: 'static', keyword: 'static', classLevel: 'static', levelBracket: 'static',
};

export const UNSANCTIONED_REASON = 'unsanctioned: a card the rules do not cover (CR 100.7: silver border, acorn stamp or playtest card), resolved by hand';

/** Abilities that stay native on an unsanctioned card: keyword abilities (their meaning is the CR's, CR 702.1). */
const keepsNative = (a: AbilityDef): boolean => a.kind === 'keyword';

/**
 * One ability as a manual ability. An activated ability keeps its cost (paying it is a rule the engine knows, CR 602.2b); the rest is done by hand.
 * W3b: like the degrade pass (model/degrade.ts), an activated or triggered ability keeps its restrictions and the zones it functions in
 * (types/ability.ts#ManualAbilityDef: CR 602.5b, 602.5d, 603.2h, 113.6), so "Exile this card from your hand: Add ..." is never offered by hand on the
 * battlefield (actions/activate.ts#manualManaDenial).
 */
function asManual(a: AbilityDef): AbilityDef {
  if (a.kind === 'manual' || keepsNative(a)) return a;
  const m: ManualAbilityDef = { kind: 'manual', text: a.text, reason: UNSANCTIONED_REASON, shape: SHAPES[a.kind] ?? 'unknown' };
  if (a.label !== undefined) m.label = a.label;
  if (a.kind === 'activated') {
    m.cost = a.cost;
    if (a.isMana === true) m.mana = true;
    if (a.sorcerySpeed === true) m.sorcerySpeed = true;
    if (a.onlyIf !== undefined) m.onlyIf = a.onlyIf.cond === 'ask' ? a.onlyIf : { cond: 'ask', text: a.text };
  }
  if ((a.kind === 'activated' || a.kind === 'triggered') && a.limit !== undefined) m.limit = a.limit;
  if ((a.kind === 'activated' || a.kind === 'triggered') && a.zone !== undefined) m.zone = a.zone;
  return m;
}

const manualUnit = (a: AbilityDef): AbilityAutomation => ({ level: 'manual', manual: [{ path: '', text: a.text, reason: UNSANCTIONED_REASON, impact: 'ability' }] });

/**
 * A card the rules do not cover (CR 100.7): flagged `unsanctioned`, every ability manual except keyword abilities, and the card `manual` whatever the
 * compiler understood. Idempotent; the definition given is not changed.
 */
export function markUnsanctioned(def: CardDef): CardDef {
  const faces = def.faces.map((f) => ({ ...f, abilities: f.abilities.map(asManual) }));
  const units = faces.map((f, i) => ({
    abilities: f.abilities.map((a, j): AbilityAutomation => (keepsNative(a) ? (def.automation.faces?.[i]?.abilities[j] ?? { level: 'full', manual: [] }) : manualUnit(a))),
  }));
  const texts = faces.flatMap((f) => f.abilities.filter((a) => !keepsNative(a)).map((a) => a.text)).filter((t) => t.trim() !== '');
  return {
    ...def,
    faces,
    automation: { ...def.automation, level: 'manual', faces: units, unsupported: [...new Set(texts)], autoRatio: 0 },
    unsanctioned: true,
  };
}
