/**
 * The Home screen's roadmap panel (right side, the mirror of the automation panel on the left): what is coming for players, as a glowing timeline from
 * what is in progress now to what comes later. The items are in roadmap.ts (public, player-facing only).
 */
import measured from './coverage-stats.json';
import type { CoverageStats } from './HomeProgress';
import { ROADMAP, STATUS_LABEL, type RoadmapItem } from './roadmap';

export function HomeRoadmap({ items = ROADMAP, stats = measured as CoverageStats }: { items?: readonly RoadmapItem[]; stats?: CoverageStats }) {
  const standard = stats.formats.find((f) => f.key === 'standard');
  const standardPct = standard && standard.cards ? ((100 * standard.full) / standard.cards).toFixed(1) : undefined;
  return (
    <aside className="home-roadmap hud-panel" aria-label="Roadmap">
      <header className="hp-head">
        <span className="hp-kicker">Roadmap</span>
        <h2 className="hp-title neon-title">What's coming</h2>
      </header>
      <ol className="rm-list">
        {items.map((item, i) => (
          <li key={item.title} className={`rm-item rm-${item.status}`} style={{ animationDelay: `${300 + i * 110}ms` }}>
            <span className="rm-node" aria-hidden="true" />
            <div className="rm-body">
              <span className="rm-status">{STATUS_LABEL[item.status]}</span>
              <h3 className="rm-title">{item.title}</h3>
              <p className="rm-text">
                {item.text}
                {item.standardProgress && standardPct && <strong className="rm-progress"> {standardPct}% there.</strong>}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p className="hp-foot">Plans can change.</p>
    </aside>
  );
}
