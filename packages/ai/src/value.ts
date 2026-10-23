/**
 * Rough values of objects, in "card points": what the bot is willing to trade, which target to aim removal at, which card to discard. Only visible
 * characteristics are read (rules/characteristics through the view).
 */
import { hasKeyword, ptNumbers, type Chars, type ObjectId } from '@openmtg/engine';
import { pt, type Ctx } from './context';
import { auraPolarity } from './intent';

/** Combat keywords (CR 702) and what they add to a creature's value. */
const KEYWORD_VALUE: Record<string, number> = {
  flying: 2, deathtouch: 2, lifelink: 1, 'first strike': 1, 'double strike': 3, trample: 0.5, vigilance: 0.5, haste: 0.5, hexproof: 1,
  indestructible: 3, menace: 1, reach: 0.5, protection: 1, shroud: 0.5, toxic: 1, infect: 1, wither: 0.5, landwalk: 0.5,
};

export function charsValue(c: Chars, power: number, toughness: number): number {
  if (c.types.includes('Creature')) {
    let v = 1 + power * 1.5 + toughness;
    for (const k of c.keywords) v += KEYWORD_VALUE[k.keyword] ?? 0.3;
    v += c.abilities.filter((a) => a.def.kind !== 'keyword' && a.def.kind !== 'manual' && !(a.def.kind === 'activated' && a.def.isMana)).length * 0.8;
    if (c.abilities.some((a) => a.def.kind === 'activated' && a.def.isMana)) v += 1; // a mana creature
    return v;
  }
  if (c.types.includes('Planeswalker')) return 4 + Number(c.loyalty ?? 3) * 1.2;
  if (c.types.includes('Land')) return 2;
  return 1.5 + c.manaValue;
}

/** Value of an object the bot can see (a hidden one is a 2/2-ish unknown). */
export function value(ctx: Ctx, id: ObjectId): number {
  const c = ctx.chars(id);
  if (!c) return 4;
  const { power, toughness } = pt(ctx, id);
  let v = charsValue(c, power, toughness);
  const o = ctx.view.objects[id];
  if (o?.zone === 'battlefield' && c.types.includes('Planeswalker')) v = 4 + (o.counters['loyalty'] ?? 0) * 1.2;
  if (o?.kind === 'token' || ctx.view.defs[o?.defId ?? '']?.isToken) v -= 0.5;
  if (o?.zone === 'battlefield' && c.types.includes('Creature') && neutralized(ctx, id)) v *= 0.25;
  return v;
}

/** A creature enchanted by an Aura that keeps it from attacking or blocking (Pacifism, CR 303.4) is hardly worth removing. */
function neutralized(ctx: Ctx, id: ObjectId): boolean {
  for (const other of ctx.view.zones.battlefield) {
    const o = ctx.view.objects[other];
    if (o?.attachedTo !== id) continue;
    const c = ctx.chars(other);
    if (!c?.subtypes.includes('Aura')) continue;
    const pol = auraPolarity(c.abilities.map((a) => a.def));
    if (pol?.polarity === 'harm') return true;
  }
  return false;
}

/** Value of a card as it would be on the battlefield (for cards in hand or on the stack): printed numbers. */
export function cardValue(c: Chars): number {
  const n = ptNumbers(c);
  return charsValue(c, Math.max(0, n.power ?? 0), n.toughness ?? 1);
}

export const isEvasive = (c: Chars): boolean => hasKeyword(c, 'flying') || hasKeyword(c, 'menace') || hasKeyword(c, 'trample');
