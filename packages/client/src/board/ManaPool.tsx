/** A player's mana pool (CR 106.4): units grouped by type, with a count; restricted or snow mana is marked with an asterisk (CR 106.6). */
import type { ManaType, ManaUnit } from '@openmtg/engine';
import { ManaTypeGlyph } from './ManaSymbols';

const ORDER: readonly ManaType[] = ['W', 'U', 'B', 'R', 'G', 'C'];

export function ManaPool({ pool, ownerName }: { pool: readonly ManaUnit[]; ownerName: string }) {
  if (pool.length === 0) return null;
  const groups = ORDER.map((t) => ({ t, units: pool.filter((u) => u.type === t) })).filter((g) => g.units.length > 0);
  return (
    <div className="mana-pool" role="list" aria-label={`${ownerName}'s mana pool`} title="Mana pool (CR 106.4); it empties at the end of each step and phase (CR 500.5)">
      {groups.map(({ t, units }) => {
        const special = units.filter((u) => u.restriction || u.snow).length;
        return (
          <span key={t} role="listitem" className="pool-unit" aria-label={`${units.length} {${t}}${special ? `, ${special} with a restriction or snow` : ''}`}>
            <ManaTypeGlyph type={t} />
            <span className="count">×{units.length}</span>
            {special > 0 && <span className="pool-note">*</span>}
          </span>
        );
      })}
    </div>
  );
}
