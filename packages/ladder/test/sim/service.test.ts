/**
 * M15-6 (slow suite): the simulation and the real service agree. A small population is simulated with its log on (every start, game end and missed
 * ready check), then the same events go through M15-3's LadderService on the memory store, with M15-5's real abuse checker and a sweep once a day
 * (as the simulation runs its daily checks): every rating row, every season record (finals and badges included) and every report the service
 * files is the simulation's own. So what the simulation measures at scale is what the built ladder would do with the same games.
 */
import { expect, it } from 'vitest';
import { describeSlow } from '../../../engine/test/slow';
import { LADDERS, type Place, type SeatNo } from '../../src/api';
import { createAbuseChecker } from '../../src/abuse/index';
import type { LedgerGameRecord } from '../../src/ledger';
import { createLadderService, createMemoryLadderStore, DEFAULT_LADDER_CONFIG } from '../../src/service/create';
import { REPORT_WINDOW_MS } from '../../src/service/reports';
import { FakeClock } from '../support/clock';
import { fixedRandom } from '../support/random';
import { nameOf, SimDirectory } from './abuse';
import { DESIGN_ABUSE_RULES } from './recommend';
import { DAY_MS } from './model';
import type { SimLadder } from './params';
import { lossRuleOf, Population, toSeasonRecord, type GameLog } from './population';

const iso = (ms: number) => new Date(ms).toISOString();
const SECRET = Buffer.alloc(32, 9).toString('base64url');

function recordOf(ladder: SimLadder, g: GameLog): LedgerGameRecord {
  const def = LADDERS[ladder];
  const firsts = g.ending.seats.filter((s) => s.place === 1).length;
  return {
    game: g.game, format: def.format, seats: g.accounts.length as 2 | 3 | 4, source: 'matched', ranked: true, ladder, outcome: firsts > 1 ? 'draw' : 'win',
    reason: firsts > 1 ? 'draw' : 'life', turns: g.ending.turns, actions: 0, startedAt: iso(g.startMs), endedAt: iso(g.endMs), engineBuild: 'sim',
    placements: g.accounts.map((account, i) => ({
      seat: (i + 1) as SeatNo, place: g.ending.seats[i]!.place as Place, loss: g.ending.seats[i]!.loss, lossRule: lossRuleOf(g.ending.seats[i]!.loss),
      outTurn: g.ending.seats[i]!.outTurn, account, name: nameOf(account), timeouts: 0, disconnectedMs: 0, timeUsedMs: 0,
    })),
  };
}

type Ev =
  | { t: number; k: 0; sweep: true }
  | { t: number; k: 1; miss: { match: string; accounts: string[] } }
  | { t: number; k: 2; start: GameLog }
  | { t: number; k: 3; end: GameLog };

describeSlow('M15-6: the simulation through the real LadderService', () => {
  for (const ladder of ['1v1-standard', 'pod-commander'] as SimLadder[]) {
    it(`${ladder}: the same rating rows, season records, closes and reports`, async () => {
      const startMs = Date.UTC(2027, 0, 17);
      const days = 42;
      const pop = new Population({
        ladder, players: ladder === '1v1-standard' ? 50 : 70, seed: `service-${ladder}`, days, startMs, arrivalDays: 3, activity: [30, 100], readyMiss: 0.03,
        churnPerMonth: 0, abuse: { rules: DESIGN_ABUSE_RULES }, log: true,
      });
      const r = await pop.run();
      expect(r.games).toBeGreaterThan(ladder === '1v1-standard' ? 1000 : 300);
      expect(r.seasons.length).toBeGreaterThanOrEqual(1);
      expect(r.readyChecksFailed).toBeGreaterThan(0);

      const clock = new FakeClock(startMs);
      const directory = new SimDirectory();
      for (const pl of r.players) directory.add(pl.account, iso(pl.createdMs));
      const store = createMemoryLadderStore({ random: fixedRandom('m15-6-service') });
      const svc = createLadderService({
        store, clock, accounts: directory, abuse: createAbuseChecker(DESIGN_ABUSE_RULES), ledger: null, replays: null,
        // a sink that refuses keeps every report pending, with its accounts, for the comparison
        moderation: { submit: async () => { throw new Error('moderation is not wired'); } },
        config: { ...DEFAULT_LADDER_CONFIG, firstSeason: '2027-01', secret: SECRET },
        log: { info: () => {}, warn: () => {} },
      });
      await svc.open();

      const events: Ev[] = [];
      for (let t = startMs + 20 * 60_000; t <= startMs + days * DAY_MS; t += DAY_MS) events.push({ t, k: 0, sweep: true });
      for (const m of r.log!.misses) events.push({ t: m.ms, k: 1, miss: m });
      for (const g of r.log!.games) {
        events.push({ t: g.startMs, k: 2, start: g });
        events.push({ t: g.endMs, k: 3, end: g });
      }
      events.sort((a, b) => a.t - b.t || a.k - b.k);
      for (const e of events) {
        clock.set(e.t);
        if (e.k === 0) await svc.sweep();
        else if (e.k === 1) await svc.readyCheckMissed(e.miss.match, e.miss.accounts as never);
        else if (e.k === 2) {
          await svc.registerStart({
            game: e.start.game, match: e.start.match, ladder, startedAt: iso(e.start.startMs),
            seats: e.start.accounts.map((account, i) => ({ seat: (i + 1) as SeatNo, account })),
          });
        } else {
          const res = await svc.intake(recordOf(ladder, e.end));
          expect(res.kind, e.end.game).toBe('applied');
        }
      }

      for (const pl of r.players) {
        const row = (await store.ratings(ladder, [pl.account])).get(pl.account) ?? null;
        if (pl.row === null) {
          expect(row).toBeNull();
          continue;
        }
        expect({ state: row!.state, season: row!.season, lastRatedAt: row!.lastRatedAt, games: row!.games, tier: row!.tier }, pl.account).toEqual({
          state: pl.row.state, season: pl.row.season, lastRatedAt: iso(pl.row.lastRatedMs!), games: pl.row.games, tier: pl.row.tier,
        });
        const records = await store.seasonRecords(pl.account);
        expect(records, pl.account).toEqual(pl.records.map((x) => toSeasonRecord(ladder, pl.account, x)).reverse());
      }
      for (const s of r.seasons) expect((await store.seasonRow(ladder, s.season))?.status).toBe('closed');

      // honest play in a small, busy ladder: 11.1's thresholds file reports here (docs/perf/m15-ladder-sim.md), so the comparison is not empty
      expect(r.tally!.reports).toBeGreaterThan(0);
      const reports = await store.reports(iso(0), 100_000);
      const keys = new Set(reports.map((x) => [x.kind, x.ladder ?? '', x.accounts.map((a) => a ?? '').join(','), String(Math.floor(Date.parse(x.createdAt) / REPORT_WINDOW_MS))].join('|')));
      expect([...keys].sort()).toEqual([...r.tally!.keys].sort());
    }, 600_000);
  }
});
