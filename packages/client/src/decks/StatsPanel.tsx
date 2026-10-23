/**
 * Deck statistics (stats.ts) in the left column of Deck Details: creature / non-creature legend, an Arena-style mana curve (six bars, each split into
 * creatures and non-creatures, counts under the bars, the average), the land count, and the colors: symbols in costs with their share, and land sources.
 */
import { ARENA_BUCKETS, COLORS, COLOR_NAME, type DeckStats } from './stats';

const BUCKET_NAME: Record<(typeof ARENA_BUCKETS)[number], string> = { '1-': '1 or less', '2': '2', '3': '3', '4': '4', '5': '5', '6+': '6 or more' };

export function StatsPanel({ stats }: { stats: DeckStats }) {
  const totals = ARENA_BUCKETS.map((_, i) => (stats.curveCreature[i] ?? 0) + (stats.curveOther[i] ?? 0));
  const peak = Math.max(1, ...totals);
  const creatures = stats.curveCreature.reduce((a, b) => a + b, 0);
  const others = stats.curveOther.reduce((a, b) => a + b, 0);
  const usedColors = COLORS.filter((c) => stats.pips[c] > 0 || stats.sources[c] > 0);
  const pipTotal = COLORS.reduce((n, c) => n + stats.pips[c], 0);
  return (
    <section className="deck-stats" aria-label="Deck statistics">
      <p className="deck-legend">
        <span className="deck-legend-item">
          <span className="deck-swatch deck-swatch-creature" aria-hidden="true" /> Creatures <strong>{creatures}</strong>
        </span>
        <span className="deck-legend-item">
          <span className="deck-swatch deck-swatch-other" aria-hidden="true" /> NonCreatures <strong>{others}</strong>
        </span>
      </p>

      <div className="curve" role="list" aria-label="Mana curve">
        {ARENA_BUCKETS.map((b, i) => (
          <div key={b} className="curve-col" role="listitem" aria-label={`Mana value ${BUCKET_NAME[b]}: ${totals[i]}`}>
            <span className="curve-stack" style={{ height: `${(totals[i]! / peak) * 90}%` }}>
              <span className="curve-bar curve-other" style={{ flexGrow: stats.curveOther[i] ?? 0 }} />
              <span className="curve-bar curve-creature" style={{ flexGrow: stats.curveCreature[i] ?? 0 }} />
            </span>
            <span className="curve-count">{totals[i]}</span>
            <span className="curve-label">{b}</span>
          </div>
        ))}
      </div>
      <div className="deck-figures">
        <p className="deck-average">Average: {stats.average.toFixed(1)}</p>
        <p className="deck-lands">
          Lands: <strong>{stats.lands}</strong>
          {stats.notLoaded > 0 && <span className="muted"> ({stats.notLoaded} cards still loading or unknown)</span>}
        </p>
      </div>

      {usedColors.length === 0 ? (
        <p className="muted">No colored mana yet.</p>
      ) : (
        <table className="color-table">
          <thead>
            <tr>
              <th scope="col">Color</th>
              <th scope="col">Symbols</th>
              <th scope="col">Share</th>
              <th scope="col" title="Lands that can make this color">Lands</th>
            </tr>
          </thead>
          <tbody>
            {usedColors.map((c) => (
              <tr key={c} className={stats.pips[c] > 0 && stats.sources[c] === 0 ? 'warn' : undefined}>
                <th scope="row">
                  <span className={`deck-mana deck-mana-${c}`} aria-hidden="true">
                    {c}
                  </span>{' '}
                  <span className="color-name">{COLOR_NAME[c]}</span>
                </th>
                <td>{stats.pips[c]}</td>
                <td>{pipTotal ? `${Math.round((stats.pips[c] / pipTotal) * 100)}%` : '0%'}</td>
                <td>{stats.sources[c]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** The right column of Deck Details: cards by type, each type with its subtypes (Creature 18: Bird 1, Dragon 1, Human 9 ...). */
export function TypePanel({ stats }: { stats: DeckStats }) {
  return (
    <section className="deck-types" aria-label="Card types">
      {stats.groups.length === 0 ? (
        <p className="muted">No cards yet.</p>
      ) : (
        stats.groups.map((g) => (
          <div key={g.type} className="deck-type-group">
            <p className="deck-type-head">
              <span>{g.type}</span> <strong>{g.count}</strong>
            </p>
            {g.subtypes.length > 0 && (
              <ul className="deck-subtypes">
                {g.subtypes.map((s) => (
                  <li key={s.name}>
                    <span>{s.name}</span> <span>{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}
    </section>
  );
}
