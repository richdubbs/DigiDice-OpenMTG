/**
 * std-mana-1 (CR 106.6, 601.2h, 611.2c, 400.7a, 101.2; cites from memory, unverified): riders on mana that do something to the spell the mana is spent on,
 * without limiting what the mana may pay for (`ManaSpentRider`): "If that mana is spent on a Dragon creature spell, it gains haste until end of turn." As the
 * spell's costs are paid (CR 601.2h), each rider carried by a unit spent on it applies once if the spell matches the rider's spells, read with the mana's
 * controller as "you" and the mana's source as the source: a keyword is a layer 6 effect on the spell until end of turn (CR 611.2c: a fixed set), which a
 * permanent spell carries onto the battlefield (CR 400.7a, core/move-parts/spell-effects.ts); "that spell can't be countered" leaves the flag the counter op
 * reads (CR 101.2). Two units with the same rider apply it once.
 */
import type { ManaSpentRider, ObjectFilter } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { ManaUnit } from '../types/state';
import { matchesFilter } from '../rules/filter';
import { filterCtxOutside } from '../rules/filter-env';
import type { Game } from './game';

/** actions/cast.ts#FLAG_CANT_BE_COUNTERED (statics/hooks.ts#CANT_BE_COUNTERED_FLAG), spelled here so this module does not import the cast action. */
const FLAG_CANT_BE_COUNTERED = 'cantBeCountered';

export function applySpentRiders(g: Game, player: PlayerId, spellId: ObjectId, spent: readonly ManaUnit[]): void {
  const spell = g.s.objects[spellId];
  if (!spell?.stack) return;
  const seen = new Set<string>();
  for (const u of spent) {
    const r: ManaSpentRider | undefined = u.rider;
    if (r === undefined) continue;
    const key = `${u.sourceId ?? ''}|${JSON.stringify(r)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ctx = filterCtxOutside(g.s, { controller: player, ...(u.sourceId !== undefined ? { sourceId: u.sourceId } : {}) });
    if (!matchesFilter(g.s, spell, { ...(r.spells as ObjectFilter), zone: 'any' }, ctx)) continue;
    if (r.cantBeCountered === true && !(spell.stack.flags ?? []).includes(FLAG_CANT_BE_COUNTERED)) (spell.stack.flags ??= []).push(FLAG_CANT_BE_COUNTERED);
    if (r.gains !== undefined) {
      const src = u.sourceId !== undefined ? g.s.objects[u.sourceId] : undefined;
      g.s.continuousEffects.push({
        id: g.newEffectId(),
        source: src ? { id: src.id, zone: src.zone } : null,
        sourceName: src ? g.nameOf(src.id) : 'mana',
        controller: player,
        timestamp: g.newTimestamp(),
        startedTurn: g.s.turn.number,
        duration: { d: 'endOfTurn' },
        effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id: spellId, zone: 'stack' }] }, mods: [{ layer: 6, add: [structuredClone(r.gains)] }] },
      });
    }
    g.log(`${g.nameOf(spellId)} ${r.gains !== undefined ? `gains ${r.gains.keyword} until end of turn` : "can't be countered"}: mana with that rider was spent on it.`, { rules: ['CR 106.6', r.gains !== undefined ? 'CR 611.2c' : 'CR 101.2'], level: 'info' });
  }
}
