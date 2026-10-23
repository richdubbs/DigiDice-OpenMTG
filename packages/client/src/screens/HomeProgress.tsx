/**
 * The Home screen's automation panel (left side): how close the card pool is to playing fully by the rules engine, as glowing neon bars that fill up when
 * Home opens. Standard is the headline (the project finishes Standard first), then all cards, the upcoming Star Trek set (its cards known so
 * far), the other formats and each Standard set. The numbers are measured, not live: scripts/coverage-stats.ts writes
 * coverage-stats.json from a whole-index snapshot after each merge wave. A card counts as done only when it is full (every ability automated; partial and
 * manual cards are played partly or wholly by hand).
 */
import { useEffect, useState, type ReactNode } from 'react';
import measured from './coverage-stats.json';

/** The upcoming set shown on its own (stats.upcoming has every set not out yet). */
const SPOTLIGHT_SET = 'TRK';

export interface Counts {
  cards: number;
  full: number;
  partial: number;
  manual: number;
}
export interface CoverageStats {
  measured: string;
  revision: string;
  all: Counts;
  formats: (Counts & { key: string; label: string })[];
  standardSets: (Counts & { code: string; name: string; released: string })[];
  /** Sets not out yet, with their child sets: the cards known so far (notInIndex: known cards our card data does not have yet). */
  upcoming?: (Counts & { code: string; name: string; released: string; sets: string[]; notInIndex: number })[];
}

const pct = (c: Counts) => (c.cards ? (100 * c.full) / c.cards : 0);
const fmt = (n: number) => n.toLocaleString('en-US');

/** Reduced motion: the system setting or the UI profile's "Animated backgrounds" off (data-motion, profiles.ts). Also when the browser can't tell (tests). */
function stillMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off';
}

/** A number that counts up from 0 to `to` over `ms` after `delay` ms, eased like the bar it labels; the final value at once when motion is off. */
function useCountUp(to: number, ms: number, delay: number): number {
  const [still] = useState(stillMotion);
  const [v, setV] = useState(still ? to : 0);
  useEffect(() => {
    if (still) {
      setV(to);
      return;
    }
    let frame = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      setV(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, ms, delay, still]);
  return v;
}

function Bar({
  label,
  counts,
  size,
  delay,
  title,
  note,
}: {
  label: string;
  counts: Counts;
  size: 'hero' | 'big' | 'mid' | 'set';
  delay: number;
  title?: string;
  /** Replaces the "N of M cards" line under the bar. */
  note?: ReactNode;
}) {
  const p = pct(counts);
  const shown = useCountUp(p, size === 'set' ? 1100 : 1700, delay);
  const togo = counts.cards - counts.full;
  return (
    <div className={`hp-bar hp-${size}${p >= 100 ? ' is-done' : ''}`} title={title}>
      <div className="hp-label">
        <span className="hp-name">{label}</span>
        <span className="hp-pct">{shown.toFixed(1)}%</span>
      </div>
      <div
        className="hp-track"
        role="progressbar"
        aria-label={`${label}: cards fully automated`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(p * 10) / 10}
        aria-valuetext={`${p.toFixed(1)}%, ${fmt(counts.full)} of ${fmt(counts.cards)} cards`}
      >
        <div className="hp-fill" style={{ width: `${p}%`, animationDelay: `${delay}ms` }} />
      </div>
      {note ? (
        <div className="hp-count">{note}</div>
      ) : size !== 'set' && (
        <div className="hp-count">
          {fmt(counts.full)} of {fmt(counts.cards)} cards
          {togo > 0 ? <span className="hp-togo"> · {fmt(togo)} to go</span> : <span className="hp-togo"> · complete</span>}
        </div>
      )}
    </div>
  );
}

export function HomeProgress({ stats = measured as CoverageStats }: { stats?: CoverageStats }) {
  const standard = stats.formats.find((f) => f.key === 'standard');
  const others = stats.formats.filter((f) => f.key !== 'standard');
  const spot = stats.upcoming?.find((u) => u.code === SPOTLIGHT_SET);
  const out = spot && new Date(`${spot.released}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return (
    <aside className="home-progress hud-panel" aria-label="Card automation progress">
      <header className="hp-head">
        <span className="hp-kicker">Rules engine progress</span>
        <h2 className="hp-title neon-title">Cards automated</h2>
      </header>
      {standard && <Bar label="Standard" counts={standard} size="hero" delay={250} />}
      <Bar label="All cards" counts={stats.all} size="big" delay={550} />
      {spot && (
        <section className="hp-spot" aria-label={`${spot.name}: currently known cards`}>
          <span className="hp-spot-kicker">Upcoming set · out {out}</span>
          <Bar
            label={spot.name}
            counts={{ ...spot, cards: spot.cards + spot.notInIndex }}
            size="big"
            delay={700}
            note={
              <>
                {fmt(spot.cards + spot.notInIndex)} currently known cards: <span className="hp-done">{fmt(spot.full)} completed</span>
                <span className="hp-togo"> · {fmt(spot.partial + spot.manual + spot.notInIndex)} not completed</span>
                {spot.notInIndex > 0 && ` (${fmt(spot.notInIndex)} not in our card data yet)`}
              </>
            }
          />
        </section>
      )}
      <div className="hp-group">
        {others.map((f, i) => (
          <Bar key={f.key} label={f.label} counts={f} size="mid" delay={800 + i * 120} />
        ))}
      </div>
      {stats.standardSets.length > 0 && (
        <section className="hp-sets" aria-label="Standard sets">
          <h3 className="hp-sub">Standard sets</h3>
          <div className="hp-sets-list">
            {stats.standardSets.map((s, i) => (
              <Bar key={s.code} label={s.code} counts={s} size="set" delay={1300 + i * 60} title={`${s.name}: ${fmt(s.full)} of ${fmt(s.cards)} cards fully automated`} />
            ))}
          </div>
        </section>
      )}
      <p className="hp-foot">
        Fully automated: the engine plays every ability. Measured {stats.measured}
        {stats.revision ? ` (${stats.revision})` : ''}.
      </p>
    </aside>
  );
}
