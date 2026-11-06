/**
 * What an Aura, Equipment or Fortification may be attached to (CR 303.4, 301.5, 702.5a, 702.16c-d). Used by the state-based actions
 * 704.5m, 704.5n and 704.5p and by the targeting of Aura spells (CR 303.4a).
 */
import type { EffectProgram, KeywordAbilityDef } from '../types/ability';
import type { PlayerId } from '../types/ids';
import type { GameObject, GameState } from '../types/state';
import { charsOfObject, type Chars } from './characteristics';
import { matchesFilter, setCouldEnchantCheck } from './filter';
import { filterCtxOutside } from './filter-env';
import { gameOf, hookpoints } from './hookpoints';

export const isAura = (c: Chars): boolean => c.subtypes.includes('Aura');
export const isEquipment = (c: Chars): boolean => c.subtypes.includes('Equipment');
export const isFortification = (c: Chars): boolean => c.subtypes.includes('Fortification');

/** An enchant filter's zone is the battlefield (or unstated): the only kind of object this engine attaches an Aura to (CR 303.4a, 303.4f). */
const battlefieldOnly = (zone: unknown): boolean => zone === undefined || zone === 'battlefield' || (Array.isArray(zone) && zone.length === 1 && zone[0] === 'battlefield');

/** edh-perms-4 (CR 702.5a, 303.4a): an enchant filter whose only zone is a graveyard ("Enchant creature card in a graveyard", Animate Dead). */
const graveyardOnly = (zone: unknown): boolean => zone === 'graveyard' || (Array.isArray(zone) && zone.length === 1 && zone[0] === 'graveyard');

/**
 * The enchant ability that restricts an Aura (CR 702.5a), or undefined when the engine did not understand the card's restriction. An enchant ability
 * whose filter names another zone ("Enchant creature card in a graveyard", CR 115.1, 303.4a) is not understood: the targeting and attachment code here
 * reads objects on the battlefield only, so treating it as a battlefield filter would target the wrong objects (WP18 review).
 * edh-perms-4: the graveyard restriction is understood by `auraRestriction` below, which only the places that handle it use (casting, resolving and the
 * state-based action 704.5m); every other reader (an Aura put onto the battlefield without being cast, a token Aura, attaching with an effect) still gets
 * `undefined` for it and keeps its manual behaviour.
 */
export const enchantRestriction = (c: Chars): KeywordAbilityDef | undefined => c.keywords.find((k) => k.keyword === 'enchant' && battlefieldOnly(k.filter?.zone));

/** edh-perms-4: the enchant ability of an Aura that enchants a card in a graveyard (CR 303.4a, 702.5a), if the Aura has one. */
export const graveyardEnchantRestriction = (c: Chars): KeywordAbilityDef | undefined => c.keywords.find((k) => k.keyword === 'enchant' && k.player === undefined && graveyardOnly(k.filter?.zone));

/** edh-perms-4: the enchant ability the Aura spell / Aura permanent is judged by: a battlefield restriction, else a graveyard one (never both at once in printed cards). */
export const auraRestriction = (c: Chars): KeywordAbilityDef | undefined => enchantRestriction(c) ?? graveyardEnchantRestriction(c);

/** The zone an understood enchant restriction looks in (CR 303.4a): a graveyard for `graveyardEnchantRestriction`, else the battlefield. */
const restrictionZone = (kw: KeywordAbilityDef): 'graveyard' | 'battlefield' => (kw.player === undefined && graveyardOnly(kw.filter?.zone) ? 'graveyard' : 'battlefield');

/** CR 303.4a: the target an Aura spell requires, built from its enchant ability. Null for anything that is not an Aura with an understood restriction. */
export function auraTargetProgram(c: Chars): EffectProgram | null {
  if (!isAura(c) || c.types.includes('Instant') || c.types.includes('Sorcery')) return null;
  const kw = auraRestriction(c);
  if (!kw) return null;
  return {
    targets: [{
      id: 't0',
      kind: kw.player !== undefined ? 'player' : 'object',
      ...(kw.player !== undefined ? { players: { who: kw.player } } : { filter: { ...(kw.filter ?? {}), zone: restrictionZone(kw) } }),
      min: 1,
      max: 1,
      // WP18: the compile pipeline's enchant keyword carries its restriction in `filter`/`player` only (milestone 4 also copied the words into `quality`),
      // so the prompt is read from the keyword's own text ("Enchant creature" -> "creature")
      text: kw.quality ?? (kw.text.replace(/^enchant\s+/i, '').trim() || 'object or player'),
    }],
    steps: [],
  };
}

const isPlayerId = (s: GameState, id: string): boolean => s.players.some((p) => p.id === id);

/** Can an Aura with these characteristics enchant this player (CR 702.5a, "Enchant player" / "Enchant opponent")? */
export function auraCanEnchantPlayer(s: GameState, aura: GameObject, kw: KeywordAbilityDef, player: PlayerId): boolean {
  const p = s.players.find((x) => x.id === player);
  if (!p || p.hasLost || kw.player === undefined) return false;
  if (kw.player !== 'any' && !(kw.player === 'opponent' && player !== aura.controller)) return false;
  return hookpoints.canAttach(gameOf(s), aura.id, player) === null; // WP31: "can't be enchanted" effects on players (CR 303.4c, 101.2)
}

/** Can the Aura (object `aura`, characteristics `ac`) enchant the object `target`? Protection forbids it (CR 702.16c). */
export function auraCanEnchantObject(s: GameState, aura: GameObject, ac: Chars, kw: KeywordAbilityDef, target: GameObject): boolean {
  const zone = restrictionZone(kw);
  if (kw.player !== undefined || target.zone !== zone || target.id === aura.id) return false; // an Aura can't enchant itself (CR 303.4d)
  if (!matchesFilter(s, target, { ...(kw.filter ?? {}), zone }, filterCtxOutside(s, { controller: aura.controller, sourceId: aura.id }))) return false; // WP30: the enchant filter reads references and quantities like any other
  // edh-perms-4 (CR 702.16a, 113.6, Scryfall ruling 2016-06-08 of Animate Dead): protection, shroud and "can't be enchanted" effects are about permanents; a card in a graveyard has none
  return zone === 'graveyard' || hookpoints.canAttach(gameOf(s), aura.id, target.id) === null; // protection (CR 702.16c) and "can't be enchanted" effects
}

/**
 * CR 704.5m: is this Aura attached legally? `null` means the engine can't tell because it did not understand the card's enchant restriction
 * (that text is shown as manual); such an Aura is left alone.
 */
export function auraAttachedLegally(s: GameState, aura: GameObject, ac: Chars): boolean | null {
  const kw = auraRestriction(ac);
  if (!kw) return null;
  if (aura.attachedTo === undefined) return false;
  if (isPlayerId(s, aura.attachedTo)) return auraCanEnchantPlayer(s, aura, kw, aura.attachedTo);
  const target = s.objects[aura.attachedTo];
  return target !== undefined && auraCanEnchantObject(s, aura, ac, kw, target);
}

/** CR 704.5n: is this Equipment / Fortification attached to a legal permanent? (Equipment: a creature; Fortification: a land; not protected from it, CR 702.16d.) */
export function equipmentAttachedLegally(s: GameState, o: GameObject, c: Chars): boolean {
  if (o.attachedTo === undefined || isPlayerId(s, o.attachedTo)) return false;
  const target = s.objects[o.attachedTo];
  if (!target || target.zone !== 'battlefield' || target.id === o.id) return false;
  const tc = charsOfObject(s, target);
  if (!tc.types.includes(isEquipment(c) ? 'Creature' : 'Land')) return false; // CR 301.5c, 301.6
  return hookpoints.canAttach(gameOf(s), o.id, target.id) === null; // protection (CR 702.16d) and "can't be equipped" effects
}

// edh-d-24 (CR 303.4a, 702.5a): the filter `couldEnchant` asks whether an Aura's enchant restriction accepts a permanent (rules/filter.ts can't import this module)
setCouldEnchantCheck((s, o, c, host) => {
  const kw = isAura(c) ? enchantRestriction(c) : undefined;
  return kw !== undefined && auraCanEnchantObject(s, o, c, kw, host);
});
