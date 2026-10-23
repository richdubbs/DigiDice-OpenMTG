// The Home screen's automation panel (screens/HomeProgress.tsx): one progress bar per measured group, Standard first, the values from the stats file.
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomeProgress, type CoverageStats } from '../src/screens/HomeProgress';
import { HomeRoadmap } from '../src/screens/HomeRoadmap';
import { ROADMAP } from '../src/screens/roadmap';
import measured from '../src/screens/coverage-stats.json';

const STATS: CoverageStats = {
  measured: '2026-10-18',
  revision: 'abcdef12',
  all: { cards: 1000, full: 640, partial: 200, manual: 160 },
  formats: [
    { key: 'standard', label: 'Standard', cards: 200, full: 187, partial: 10, manual: 3 },
    { key: 'modern', label: 'Modern', cards: 500, full: 360, partial: 100, manual: 40 },
  ],
  standardSets: [
    { code: 'FDN', name: 'Foundations', released: '2024-11-15', cards: 100, full: 100, partial: 0, manual: 0 },
    { code: 'BLB', name: 'Bloomburrow', released: '2024-08-02', cards: 50, full: 40, partial: 8, manual: 2 },
  ],
};

describe('HomeProgress', () => {
  it('shows Standard first, then all cards, the formats and each Standard set, with the measured values', () => {
    render(<HomeProgress stats={STATS} />);
    const bars = screen.getAllByRole('progressbar');
    expect(bars.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Standard: cards fully automated',
      'All cards: cards fully automated',
      'Modern: cards fully automated',
      'FDN: cards fully automated',
      'BLB: cards fully automated',
    ]);
    expect(bars[0]!.getAttribute('aria-valuenow')).toBe('93.5');
    expect(bars[0]!.getAttribute('aria-valuetext')).toBe('93.5%, 187 of 200 cards');
    expect(bars[1]!.getAttribute('aria-valuenow')).toBe('64');
    // Without animation (tests have no matchMedia) the numbers are the final ones at once.
    expect(screen.getByText('93.5%')).toBeTruthy();
    expect(screen.getByText(/13 to go/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Standard sets' })).getByText('100.0%')).toBeTruthy();
    expect(screen.getByText(/Measured 2026-10-18 \(abcdef12\)/)).toBeTruthy();
  });

  it('shows the upcoming Star Trek set as its currently known cards, completed vs not completed', () => {
    const upcoming = [
      { code: 'TRK', name: 'Star Trek', released: '2026-11-13', sets: ['TRC', 'TRK'], cards: 129, full: 113, partial: 12, manual: 4, notInIndex: 2 },
      { code: 'MDD', name: 'Marvel: Darkhold Destiny', released: '2027-04-09', sets: ['MDD'], cards: 13, full: 8, partial: 4, manual: 1, notInIndex: 0 },
    ];
    render(<HomeProgress stats={{ ...STATS, upcoming }} />);
    const spot = screen.getByRole('region', { name: 'Star Trek: currently known cards' });
    expect(within(spot).getByText(/Upcoming set · out November 13, 2026/)).toBeTruthy();
    expect(spot.textContent).toContain('131 currently known cards: 113 completed · 18 not completed (2 not in our card data yet)');
    expect(within(spot).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('86.3');
    expect(screen.queryByText(/Darkhold/)).toBeNull();
  });

  it('lists the roadmap in order, with its status, and the Standard progress on the finished Standard item', () => {
    render(<HomeRoadmap stats={STATS} />);
    const items = within(screen.getByRole('complementary', { name: 'Roadmap' })).getAllByRole('listitem');
    expect(items.length).toBe(ROADMAP.length);
    expect(within(items[0]!).getByText('Done')).toBeTruthy();
    expect(within(items[0]!).getByRole('heading', { name: 'Every Standard card' })).toBeTruthy();
    expect(within(items[0]!).getByText(/93\.5% there/)).toBeTruthy();
    expect(within(items[items.length - 1]!).getByText('Later')).toBeTruthy();
  });

  it('reads the checked-in stats file', () => {
    const stats = measured as CoverageStats;
    expect(stats.formats[0]!.key).toBe('standard');
    expect(stats.all.full).toBeLessThanOrEqual(stats.all.cards);
    for (const s of stats.standardSets) expect(s.full + s.partial + s.manual).toBe(s.cards);
    render(<HomeProgress />);
    const spotlight = stats.upcoming?.some((u) => u.code === 'TRK') ? 1 : 0;
    expect(screen.getAllByRole('progressbar').length).toBe(1 + 1 + spotlight + (stats.formats.length - 1) + stats.standardSets.length);
  });
});
