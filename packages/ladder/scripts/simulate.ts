/**
 * M15-6: the ladder simulation's report (design 16, M15-6; 17.11). Runs the measurements of test/sim/measure.ts at the report's sizes and prints
 * the tables of docs/perf/m15-ladder-sim.md as Markdown, each section with its seeds, sizes and wall time. Everything is in process (no network,
 * owner rule) and deterministic: the same command prints the same numbers on any machine, except the wall times and the tick timings.
 *
 *   npx tsx packages/ladder/scripts/simulate.ts                       every section at the report's sizes (about an hour on 4 shared CPUs)
 *   npx tsx packages/ladder/scripts/simulate.ts --sections=tick,waits   some sections (tick, stationary, validate, spread, pullmet, scenarios,
 *                                                                       badge, waits, sweeps, reports, small, concede, smurf)
 *   npx tsx packages/ladder/scripts/simulate.ts --quick                 smaller sizes (a smoke run; the numbers are noisier)
 *   npx tsx packages/ladder/scripts/simulate.ts --out=FILE              also write the Markdown to FILE
 *   npx tsx packages/ladder/scripts/simulate.ts --sections=reports --ladders=pod-commander    the reports section for one ladder
 *
 * The slow suite (OPENMTG_SLOW=1 npx vitest run packages/ladder/test/sim) asserts the targets and bounds at its own, smaller sizes.
 */
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { TIER_IDS, TIER_NAMES, type RatingModel } from '../src/api';
import type { AbuseRules } from '../src/abuse/types';
import {
  boundChecks, floorAdvice, honestReports, honestReportsWith, kSweep, LEADERBOARD_KS, meetsHonestTarget, metPool, pullSweep, scenarioSet, SCENARIO_SIZES, soloSweep,
  stationary, TARGETS, waitsByPopulation, WINDOW_VARIANTS, type HonestReportsResult, type ScenarioSet, type StationaryResult, type SweepRow,
  type WaitRow,
} from '../test/sim/measure';
import { DEFAULT_SIM_PARAMS, simParams, type SimLadder, type SimParams } from '../test/sim/params';
import { CANDIDATE_ABUSE_RULES, RECOMMENDED } from '../test/sim/recommend';
import { newPlayerError, smurfRates, type SmurfThresholds } from '../test/sim/scenarios';
import { matchedOpponents } from '../test/sim/solo';
import { HONEST_ENDINGS } from '../test/sim/truth';
import { timeTick } from '../test/sim/tick';

type Section =
  | 'tick' | 'stationary' | 'validate' | 'spread' | 'pullmet' | 'scenarios' | 'badge' | 'waits' | 'sweeps' | 'reports' | 'small' | 'concede'
  | 'smurf';
const ALL: readonly Section[] = [
  'tick', 'stationary', 'validate', 'spread', 'pullmet', 'scenarios', 'badge', 'waits', 'sweeps', 'reports', 'small', 'concede', 'smurf',
];

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const sectionArg = args.find((a) => a.startsWith('--sections='));
const sections: Section[] = sectionArg === undefined ? [...ALL] : (sectionArg.slice('--sections='.length).split(',') as Section[]);
for (const s of sections) if (!ALL.includes(s)) throw new Error(`simulate: unknown section ${s} (${ALL.join(', ')})`);
const outArg = args.find((a) => a.startsWith('--out='));
const laddersArg = args.find((a) => a.startsWith('--ladders='));
/** The reports section's ladders (it is the slow one: two processes can run one ladder each). */
const REPORT_LADDERS = (laddersArg === undefined ? ['1v1-standard', 'pod-commander'] : laddersArg.slice('--ladders='.length).split(',')) as SimLadder[];

const SIZE = quick
  ? { stationaryPlayers: 500, scenario: SCENARIO_SIZES.sweep, waitDays: 1, reportPlayers: 400, reportDays: 100, sweepPlayers: 400, tickRepeats: 5 }
  : { stationaryPlayers: 2000, scenario: SCENARIO_SIZES.report, waitDays: 2, reportPlayers: 1500, reportDays: 150, sweepPlayers: 1000, tickRepeats: 15 };

const LADDER_OF: Readonly<Record<RatingModel, SimLadder>> = { glicko2: '1v1-standard', wenglin: 'pod-commander' };
const MODEL_NAME: Readonly<Record<RatingModel, string>> = { glicko2: '1v1 (Glicko-2)', wenglin: 'pods (Weng-Lin)' };

// ---- Markdown -------------------------------------------------------------------------------------------------------------------------------

const out: string[] = [];
function print(line = ''): void {
  out.push(line);
  console.log(line);
}

function table(headers: readonly string[], rows: readonly (readonly (string | number)[])[]): void {
  print(`| ${headers.join(' | ')} |`);
  print(`|${headers.map((_, i) => (i === 0 ? '---' : '--:')).join('|')}|`);
  for (const r of rows) print(`| ${r.map(String).join(' | ')} |`);
  print();
}

const pct = (x: number | null, d = 1) => (x === null || Number.isNaN(x) ? 'n/a' : `${(100 * x).toFixed(d)}%`);
const n0 = (x: number | null) => (x === null || !Number.isFinite(x) ? 'n/a' : Math.round(x).toLocaleString('en-US'));
const n1 = (x: number | null) => (x === null || !Number.isFinite(x) ? 'n/a' : x.toFixed(1));
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const mins = (ms: number) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : secs(ms));
const pass = (ok: boolean) => (ok ? 'pass' : '**FAIL**');

async function timed<T>(f: () => Promise<T> | T): Promise<{ value: T; ms: number }> {
  const t = performance.now();
  const value = await f();
  return { value, ms: performance.now() - t };
}

// ---- sections -------------------------------------------------------------------------------------------------------------------------------

function sectionTick(): void {
  print('## The matcher\'s tick with 2,000 entries');
  print();
  print(`Seed \`tick\`; ${SIZE.tickRepeats} timed ticks of a fresh matcher per row after one warm-up tick; ${process.version}, ${process.platform}.`);
  print();
  const rows: (string | number)[][] = [];
  for (const ladder of ['1v1-standard', 'pod-commander'] as const) {
    for (const n of [500, 1000, 2000]) {
      for (const shape of ['queue', 'stuck'] as const) {
        const t = timeTick(ladder, shape, n, SIZE.tickRepeats);
        rows.push([ladder, n0(n), shape, n0(t.matches), t.medianMs.toFixed(1), t.maxMs.toFixed(1)]);
      }
    }
  }
  table(['ladder', 'entries', 'shape', 'matches formed', 'median ms', 'max ms'], rows);
}

const stationaryRuns = new Map<SimLadder, StationaryResult>();

async function getStationary(ladder: SimLadder): Promise<StationaryResult> {
  let s = stationaryRuns.get(ladder);
  if (s === undefined) {
    s = await stationary(ladder, { players: SIZE.stationaryPlayers, seed: 'stationary' });
    stationaryRuns.set(ladder, s);
  }
  return s;
}

async function sectionStationary(): Promise<void> {
  print('## The stationary population');
  print();
  const one = await getStationary('1v1-standard');
  const pod = await getStationary('pod-commander');
  for (const s of [one, pod]) {
    print(`### ${s.ladder}`);
    print();
    print(`Seed \`${s.seed}\`; ${n0(s.players)} accounts at a time (${n0(s.accounts)} over the run, 10% churn a month), skills N(1500, 130), activity 5/10/30/100 games a month (a quarter each), arrivals over the first 14 days from 2027-01-01, ${s.days} days (seasons 2027-01 to 2027-08); ${n0(s.games)} games; ${mins(s.wallMs)}.`);
    print();
    print('Rating error |shown rating − true skill| right after the k-th career game: the launch cohort (accounts created in the first 30 days, whose opponents were new too) and the accounts that joined an established ladder (from 2027-03).');
    print();
    table(['k', 'launch: n', 'median', '90th pct', 'mean signed', 'median deviation', 'established: n', 'median', '90th pct', 'mean signed', 'median deviation'],
      s.errors.map((e) => [e.k, e.cold.n, n1(e.cold.median), n1(e.cold.p90), n1(e.cold.meanSigned), n1(e.cold.deviation), e.late.n, n1(e.late.median), n1(e.late.p90), n1(e.late.meanSigned), n1(e.late.deviation)]));
    print('Tier shares by games a month, seasons 2027-03 to 2027-08 (the tier of the shown rating at the season\'s end, fresh; then the season badge, "none" when the account had no badge):');
    print();
    table(['games a month', 'player-seasons', ...TIER_IDS.map((t) => TIER_NAMES[t]), 'median deviation at the end', 'median season games', 'mean rating − skill'],
      s.tiers.map((t) => [t.gpm, n0(t.n), ...t.tiers.map((x) => pct(x)), n1(t.deviation), n0(t.games), n1(t.bias)]));
    table(['games a month (badges)', ...TIER_IDS.map((t) => TIER_NAMES[t]), 'none'], s.tiers.map((t) => [t.gpm, ...t.badges.map((x) => pct(x))]));
    print(`Shown ratings at the seasons' ends (all activity, ${n0(s.dist.n)} player-seasons): mean ${n1(s.dist.mean)}, SD ${n1(s.dist.sd)} (true skills SD ${n1(s.dist.skillSd)}), correlation with skill ${s.dist.corr.toFixed(3)}; 5th/25th/50th/75th/95th percentiles ${s.dist.q.map(n0).join(' / ')}.`);
    print();
    print('Drift by season (placed accounts with a game in the season): mean shown rating and mean skill, their SDs, and the slope of the shown rating on the true skill.');
    print();
    table(['season', 'accounts', 'mean rating', 'mean skill', 'rating SD', 'skill SD', 'slope'], s.drift.map((d) => [d.season, d.n, n1(d.meanDisplay), n1(d.meanSkill), n1(d.sd), n1(d.skillSd), d.slope.toFixed(3)]));
    print(`The cold start (season 2027-01): the live leaderboard first held 1, 10, 50 and 100 rows after ${s.board.fillHours.map((h) => (h === null ? 'never' : `${h.toFixed(1)} h`)).join(', ')}; the launch cohort's accounts first stood on it at career game ${n1(s.board.firstGames.median)} (median; 10th-90th percentile ${n1(s.board.firstGames.p10)}-${n1(s.board.firstGames.p90)}), ${n1(s.board.firstDays)} days after they were made; ${pct(s.board.firstShare)} of them did within the season.`);
    print();
    print(`Session model (players come online in sessions, give up after 20 minutes): median wait ${secs(s.waits.median)}, 90th percentile ${secs(s.waits.p90)}; median online ${n0(s.waits.onlineMedian)}, queued ${n0(s.waits.queuedMedian)}; give-ups ${pct(s.waits.giveUpShare, 2)} of queue entries. Rematches of a last-3 game ${pct(s.rematchShare, 2)} of games; matches formed relaxed ${pct(s.relaxedShare)}, with a member past 5 minutes ${pct(s.everyoneShare)}${s.ladder === 'pod-commander' ? `, pods of 3 ${pct(s.threeShare)}` : ''}.`);
    print();
    print(`The S1/S2 yardstick measured in the population: honest accounts within 50 of 1675 in skill with 30 games a month have a median final standing of ${n1(s.baseline.median)} (${s.baseline.n} player-seasons).`);
    print();
    print('The final boards (eligible accounts, seasons 2027-03 to 2027-08) ordered by the standing at other values of LEADERBOARD_K: rank correlation with true skill, the share of the top 10% that play 100 or 10 and fewer games a month, and the mean rank move against the order by shown rating (share of the board).');
    print();
    table(['K', 'Spearman with skill', 'top 10%: 100 a month', 'top 10%: ≤ 10 a month', 'rank move'], s.leaderboard.map((l) => [l.k, l.spearman.toFixed(3), pct(l.topHeavy), pct(l.topLight), pct(l.displacement)]));
  }
  const f = floorAdvice(one, pod, DEFAULT_SIM_PARAMS.floors1v1);
  print('### Floors');
  print();
  print('Tier shares of the two stationary distributions with the default floors (1300, 1425, 1550, 1675, 1800), all activity together, and the pod floors that would give the pod ladder the 1v1 shares:');
  print();
  table(['', ...TIER_IDS.map((t) => TIER_NAMES[t])], [['1v1', ...f.shares1v1.map((x) => pct(x))], ['pods', ...f.sharesPod.map((x) => pct(x))], ['pods − 1v1 (points)', ...f.podMinus1v1.map((x) => (100 * x).toFixed(1))]]);
  print(`Pod floors with the 1v1 shares: ${f.matchedPodFloors.join(', ')}.`);
  print();
  print(`17.11 targets: median error after 30 games (1v1, established) ${n1(one.errors.find((e) => e.k === 30)!.late.median)} < ${TARGETS.error30.glicko2}: ${pass(one.errors.find((e) => e.k === 30)!.late.median < TARGETS.error30.glicko2)}; after 30 pods ${n1(pod.errors.find((e) => e.k === 30)!.late.median)} < ${TARGETS.error30.wenglin}: ${pass(pod.errors.find((e) => e.k === 30)!.late.median < TARGETS.error30.wenglin)}.`);
  print();
}

async function sectionValidate(): Promise<void> {
  print('## The solo model\'s opponents against the population');
  print();
  print('A new player\'s median rating error after k games (skills N(1500, 130), one game a day; seed `validate`, 1,500 players) against matched opponents and against the opponents the matcher gave in the stationary population, beside the population\'s own accounts that joined the established ladder:');
  print();
  const ks = [5, 10, 20, 30, 50, 100];
  for (const model of ['glicko2', 'wenglin'] as const) {
    const st = await getStationary(LADDER_OF[model]);
    const matched = newPlayerError(model, DEFAULT_SIM_PARAMS, ks, 1500, 'validate', matchedOpponents());
    const met = newPlayerError(model, DEFAULT_SIM_PARAMS, ks, 1500, 'validate', metPool(st));
    table(['k', `${MODEL_NAME[model]}: matched`, 'met', 'population (established)'], ks.map((k, i) => [
      k, n1(matched[i]!.median), n1(met[i]!.median), n1(st.errors.find((e) => e.k === k)?.late.median ?? null),
    ]));
  }
}

async function sectionPullMet(): Promise<void> {
  print('## The 1v1 bounds against the matcher\'s opponents with a 10% pull');
  print();
  const p = simParams({ pull: 0.1 });
  const st = await stationary('1v1-standard', { players: SIZE.stationaryPlayers, params: p, seed: 'stationary' });
  const sc = scenarioSet('glicko2', p, SIZE.scenario.glicko2, metPool(st), 'met');
  print(`A stationary 1v1 population of ${n0(SIZE.stationaryPlayers)} with a 10% pull (seed \`stationary\`; slope ${st.drift.at(-1)!.slope.toFixed(3)}, error after 30 games ${n1(st.errors.find((e) => e.k === 30)!.late.median)}) and the scenarios against its matcher's opponents (seeds \`met/...\`):`);
  print();
  table(['bound', 'measured', 'bound', ''], scenarioRows(sc));
  print(`Shortfall of a true-1800 player at 5/10/30/100 games a month against these opponents: ${sc.shortfall.map((r) => n1(r.shortfall)).join(' / ')}.`);
  print();
}

async function sectionSpread(): Promise<void> {
  print('## The rating spread by population size and pull');
  print();
  print('Stationary runs as above (seed `spread/<size>/<pull>`); seasons 2027-03 to 2027-08: the median accounts online, the shown ratings\' SD (true skills SD about 130) and the slope of the shown rating on the true skill (mean over the seasons), the rating error after 30 games of accounts that joined the established ladder, and the Wire and Prism shares with the default floors.');
  print();
  for (const ladder of ['1v1-standard', 'pod-commander'] as const) {
    const rows: (string | number)[][] = [];
    const runs: [number, number][] = [
      [500, 0.05], [1000, 0.05], [2000, 0.05], [4000, 0.05], [2000, 0], [2000, 0.1], [2000, 0.2],
      ...(ladder === '1v1-standard' ? ([[2000, 0.075], [4000, 0.075], [4000, 0.1]] as [number, number][]) : []),
    ];
    for (const [players, pull] of quick ? runs.filter(([n]) => n <= 1000) : runs) {
      const s = await stationary(ladder, { players, params: simParams({ pull }), seed: `spread/${players}/${pull}`, population: { recordMetFromMs: undefined } });
      const late = s.drift.filter((d) => d.season >= '2027-03');
      const avg = (f: (d: (typeof late)[0]) => number) => late.reduce((a, d) => a + f(d), 0) / late.length;
      const all = s.tiers.reduce((a, t) => a + t.n, 0);
      const tierShare = (i: number) => s.tiers.reduce((a, t) => a + t.tiers[i]! * t.n, 0) / all;
      rows.push([n0(players), pull, n0(s.waits.onlineMedian), n1(avg((d) => d.sd)), avg((d) => d.slope).toFixed(3), n1(s.errors.find((e) => e.k === 30)!.late.median), pct(tierShare(0)), pct(tierShare(5)), mins(s.wallMs)]);
    }
    print(`${ladder}:`);
    print();
    table(['accounts', 'pull', 'online', 'rating SD', 'slope', 'error after 30 (established)', 'Wire', 'Prism', 'time'], rows);
  }
}

function scenarioRows(s: ScenarioSet): (string | number)[][] {
  return boundChecks(s).map((b) => [b.name, b.name.startsWith('season') ? n1(b.value) : pct(b.value, 2), b.name.startsWith('season') ? `< ${b.bound}` : `≤ ${pct(b.bound, 0)}`, pass(b.pass)]);
}

function printScenarioSet(s: ScenarioSet, sizes: { s1: number; s2Groups: number; s3: number; honest: number }): void {
  print(`${MODEL_NAME[s.model]}, ${s.pool} opponents (yardstick ${n1(s.baseline)}; S1 ${n0(sizes.s1)} accounts, S2 ${n0(sizes.s2Groups)} groups of 10 split into 3, 5 and 10, S3 ${n0(sizes.s3)} players; ${mins(s.wallMs)}):`);
  print();
  table(['bound', 'measured', 'bound', ''], scenarioRows(s));
  print(`S1: ${pct(s.s1.stops)} of the accounts meet (a)'s stopping condition within 200 games. S2 rows: ${s.s2.map((r) => `best of ${r.k}: leaderboard ${pct(r.leaderboard, 2)}, badge ${pct(r.badge, 2)}`).join('; ')}. S3: exactly 5 games from 1250 ${pct(s.s3.exact, 2)}; from a stationary true-1250 rating ${pct(s.s3.stationary, 2)}, against ${pct(s.s3.honestMonth, 2)} when the same players play their whole month.`);
  print();
  if (s.shortfall.length > 0) {
    print('Season shortfall of a true-1800 player (months 3-8):');
    print();
    table(['games a month', 'mean rating at the season\'s end', 'shortfall', 'Prism badge', 'median deviation at the end'], s.shortfall.map((r) => [r.gpm, n1(r.meanDisplay), n1(r.shortfall), pct(r.prism), n1(r.deviation)]));
  }
}

async function sectionScenarios(): Promise<void> {
  print('## The gaming scenarios S1-S3 and the season shortfall');
  print();
  print('Seeds `scenarios/...` (matched) and `met/...` (opponents the matcher gave in the stationary population of the section above).');
  print();
  for (const model of ['glicko2', 'wenglin'] as const) {
    const sizes = SIZE.scenario[model];
    printScenarioSet(scenarioSet(model, DEFAULT_SIM_PARAMS, sizes, matchedOpponents(), 'scenarios'), sizes);
    const st = await getStationary(LADDER_OF[model]);
    printScenarioSet(scenarioSet(model, DEFAULT_SIM_PARAMS, sizes, metPool(st), 'met'), sizes);
  }
}

async function sectionBadge(): Promise<void> {
  print('## The badge\'s career games against the opponents the matcher gave');
  print();
  print('S1 (c) and S2 (b) with BADGE_CAREER_GAMES at other values (S2\'s accounts play that many games), met opponents, seeds `badge/...`; and what it costs honest players: the share of the stationary population\'s player-seasons (2027-03 to 2027-08) that earn a badge, by games a month.');
  print();
  for (const model of ['glicko2', 'wenglin'] as const) {
    const sizes = SIZE.scenario[model];
    const st = await getStationary(LADDER_OF[model]);
    const pool = metPool(st);
    const rows: (string | number)[][] = [];
    for (const c of [30, 40, 50, 55, 60]) {
      const sc = scenarioSet(model, simParams({ badgeCareerGames: c }), sizes, pool, 'badge', false);
      const b = boundChecks(sc);
      const get = (prefix: string) => b.find((x) => x.name.startsWith(prefix))!;
      const honest = [5, 10, 30, 100].map((g) => {
        const xs = st.badgeSeasons.filter((x) => x.gpm === g);
        return pct(xs.filter((x) => x.badge && x.careerGames >= c).length / Math.max(1, xs.length), 0);
      }).join(' / ');
      rows.push([c, pct(get('S1 stopping for').value, 2), pass(get('S1 stopping for').pass), pct(get('S2 best of 5 with').value, 2), pass(get('S2 best of 5 with').pass), pct(get('S1 rank').value, 2), pct(get('S2 best of 5 on').value, 2), honest, mins(sc.wallMs)]);
    }
    print(`${MODEL_NAME[model]}:`);
    print();
    table(['career games', 'S1 (c) badge stop', '≤ 1%', 'S2 best of 5 badge', '≤ 5%', 'S1 (a) rank', 'S2 best of 5 board', 'honest seasons with a badge, 5/10/30/100 a month', 'time'], rows);
  }
}

function waitRows(rows: readonly WaitRow[], pods: boolean): (string | number)[][] {
  return rows.map((r) => [r.online, n0(r.matches), secs(r.median), secs(r.p90), n0(r.spread), n0(r.skillGap), pct(r.relaxed), pct(r.everyone), ...(pods ? [pct(r.threes)] : [])]);
}

async function sectionWaits(): Promise<void> {
  print('## Waits by population');
  print();
  print(`Always-online populations (everyone queues again 1-5 minutes after a game, established ratings), seeds \`waits/<n>\`, ${SIZE.waitDays} days after a day's warm-up; 1% of ready checks missed.`);
  print();
  for (const ladder of ['1v1-standard', 'pod-commander'] as const) {
    const pods = ladder === 'pod-commander';
    const online = pods ? [12, 20, 50, 100, 200, 500] : [10, 20, 50, 100, 200, 500];
    const { value, ms } = await timed(() => waitsByPopulation(ladder, online, { days: SIZE.waitDays }));
    print(`${ladder} (${mins(ms)}):`);
    print();
    table(['online', 'matches', 'median wait', '90th pct', 'median rating spread', 'median skill gap', 'relaxed', 'past 5 min', ...(pods ? ['pods of 3'] : [])], waitRows(value, pods));
    if (!pods) {
      const fifty = value.find((r) => r.online === 50)!;
      print(`17.11 target: with 50 online the median 1v1 wait ${secs(fifty.median)} < ${secs(TARGETS.wait50Ms)}: ${pass(fifty.median < TARGETS.wait50Ms)}.`);
      print();
    }
  }
  print('### The window sweep');
  print();
  for (const ladder of ['1v1-standard', 'pod-commander'] as const) {
    const pods = ladder === 'pod-commander';
    const rows: (string | number)[][] = [];
    for (const v of WINDOW_VARIANTS) {
      for (const r of await waitsByPopulation(ladder, pods ? [20, 50, 200] : [20, 50, 200], { days: SIZE.waitDays, policy: v.policy, seed: 'windows' })) {
        rows.push([v.name, ...waitRows([r], pods)[0]!]);
      }
    }
    print(`${ladder}:`);
    print();
    table(['policy', 'online', 'matches', 'median wait', '90th pct', 'median rating spread', 'median skill gap', 'relaxed', 'past 5 min', ...(pods ? ['pods of 3'] : [])], rows);
  }
}

function sweepTable(rows: readonly SweepRow[]): void {
  table(['value', 'resting deviation 10/30/100 a month', 'win/loss at 30 a month', 'games to half a +200 change at 30', 'provisional after (days)', 'error after 10/30 games', 'S1 a/b/c', 'S2 best of 5', 'S3', 'shortfall at 10', 'bounds'],
    rows.map((r) => {
      const m = (g: number) => r.movement.find((x) => x.gpm === g)!;
      const b = r.bounds;
      return [
        r.label, [10, 30, 100].map((g) => n0(m(g).restAfterGame)).join(' / '), `+${n0(m(30).win)} / ${n0(m(30).loss)}`, n0(m(30).halfGapGames), n1(m(30).provisionalDays),
        `${n0(m(30).error10)} / ${n0(m(30).error30)}`, [b[0]!, b[1]!, b[2]!].map((x) => pct(x.value)).join(' / '), `${pct(b[3]!.value)} / ${pct(b[4]!.value)}`, pct(b[5]!.value),
        n1(b[6]!.value), b.every((x) => x.pass) ? 'all pass' : `**${b.filter((x) => !x.pass).length} fail**`,
      ];
    }));
}

async function sectionSweeps(): Promise<void> {
  print('## Sweeps');
  print();
  print('On the matched opponents (the design\'s check model), seeds `sweep/<value>/...`; "error" is a new player against established opponents, one game a day. The population columns are stationary runs of the given size.');
  print();
  const sizes1 = SCENARIO_SIZES.sweep.glicko2;
  const sizesP = SCENARIO_SIZES.sweep.wenglin;
  const popError = async (ladder: SimLadder, p: Readonly<SimParams>, label: string) => {
    const s = await stationary(ladder, { players: SIZE.sweepPlayers, params: p, seed: `sweep-pop/${label}` });
    const e = (k: number) => s.errors.find((x) => x.k === k)!.late.median;
    const last = s.drift.at(-1)!;
    return { s, cells: [n1(e(10)), n1(e(30)), n1(e(100)), n1(s.tiers.find((t) => t.gpm === 30)!.deviation), n1(last.sd), last.slope.toFixed(3)] };
  };
  const popHeaders = ['population error 10/30/100 (established)', 'deviation at season end, 30 a month', 'rating SD (last season)', 'slope'];

  print('### σ0 (1v1)');
  print();
  const sigma = [0.04, 0.05, 0.06, 0.07, 0.08].map((v) => ({ label: `σ0 ${v}${v === 0.06 ? ' (default)' : ''}`, params: simParams({ vol0: v }) }));
  sweepTable(soloSweep('glicko2', sigma, sizes1));
  const sigmaPop: (string | number)[][] = [];
  for (const v of sigma) {
    const { cells } = await popError('1v1-standard', v.params, v.label);
    sigmaPop.push([v.label, `${cells[0]} / ${cells[1]} / ${cells[2]}`, cells[3]!, cells[4]!, cells[5]!]);
  }
  table(['value', ...popHeaders], sigmaPop);

  print('### idleVolPerDay (1v1; the pods\' drift follows it, 5.2)');
  print();
  const idle = [0.03, 0.045, 0.06, 0.08, 0.1].map((v) => ({ label: `idleVolPerDay ${v}${v === 0.06 ? ' (default)' : ''}`, params: simParams({ idleVolPerDay: v }) }));
  sweepTable(soloSweep('glicko2', idle, sizes1));

  print('### Pod τ');
  print();
  const tau = [300, 200, 150, 100].map((d) => ({ label: `τ 25/${d}${d === 300 ? ' (default)' : ''}`, params: simParams({ podTau: 25 / d }) }));
  sweepTable(soloSweep('wenglin', tau, sizesP));
  const tauPop: (string | number)[][] = [];
  for (const v of tau) {
    const { cells } = await popError('pod-commander', v.params, v.label);
    tauPop.push([v.label, `${cells[0]} / ${cells[1]} / ${cells[2]}`, cells[3]!, cells[4]!, cells[5]!]);
  }
  table(['value', ...popHeaders], tauPop);

  print('### The season pull');
  print();
  for (const model of ['glicko2', 'wenglin'] as const) {
    const rows = pullSweep(model, [0, 0.025, 0.05, 0.1, 0.2], model === 'glicko2' ? sizes1 : sizesP);
    print(`${MODEL_NAME[model]}, matched opponents (shortfall of a true-1800 player at 5/10/30/100 games a month; S3):`);
    print();
    table(['pull', 'shortfall 5 / 10 / 30 / 100', 'Prism badge at 10', 'S3 exact', 'S3 stationary'], rows.map((r) => [
      r.pull, r.shortfall.map((x) => n1(x.shortfall)).join(' / '), pct(r.shortfall.find((x) => x.gpm === 10)!.prism), pct(r.s3.exact, 2), pct(r.s3.stationary, 2),
    ]));
    const pop: (string | number)[][] = [];
    for (const pull of [0, 0.05, 0.1]) {
      const { s, cells } = await popError(LADDER_OF[model], simParams({ pull }), `pull ${pull}`);
      const top = s.tiers.map((t) => pct(t.tiers[5]!)).join(' / ');
      pop.push([pull, `${cells[0]} / ${cells[1]} / ${cells[2]}`, s.drift.map((d) => n0(d.sd)).join(' → '), cells[5]!, n1(s.drift.at(-1)!.meanDisplay), top]);
    }
    print(`${MODEL_NAME[model]}, populations of ${n0(SIZE.sweepPlayers)}:`);
    print();
    table(['pull', 'error 10/30/100 (established)', 'rating SD by season', 'slope (last season)', 'mean rating (last season)', 'Prism share at 5/10/30/100 a month'], pop);
  }

  print('### LEADERBOARD_K');
  print();
  for (const model of ['glicko2', 'wenglin'] as const) {
    const rows = kSweep(model, LEADERBOARD_KS, model === 'glicko2' ? sizes1 : sizesP);
    print(`${MODEL_NAME[model]}, matched opponents:`);
    print();
    table(['K', 'yardstick', 'S1 (a) rank', 'S1 (b) standing stop', 'S2 best of 3 / 5 / 10 board'], rows.map((r) => [
      r.k, n1(r.baseline), pct(r.s1.rankAtClose, 2), pct(r.s1.standingStop, 2), r.s2.map((x) => pct(x.leaderboard, 2)).join(' / '),
    ]));
  }
}

function reportTable(r: HonestReportsResult): void {
  const withAbusers = r.sets[0]!.smurfsCaught !== null;
  print(`${r.ladder}: seed \`${r.seed}\`, ${n0(r.players)} accounts at a time, ${r.days} days from the launch, ${n0(r.games)} games; the run with the checks inline ${mins(r.wallMs)}, the replays ${mins(r.replayMs)}. Rematches of a last-3 game ${pct(r.rematchShare, 2)} of games; ${r.repeatedPairs} pairs met 5 times (pods 6) within 7 days.`);
  print();
  const kinds = r.sets[0]!.kinds.filter((k) => r.sets.some((s) => s.kinds.find((x) => x.kind === k.kind)!.reports > 0)).map((k) => k.kind);
  const head = withAbusers
    ? ['thresholds', 'accounts reported (all)', 'honest accounts reported', ...kinds, 'smurfs caught (smurf)', 'sandbaggers caught (sandbagging)']
    : ['thresholds', 'accounts reported (all)', 'launch months', 'from 2027-03', 'meets 17.11', ...kinds];
  table(head, r.sets.map((s) => {
    const cells = kinds.map((kind) => {
      const k = s.kinds.find((x) => x.kind === kind)!;
      return `${k.reports} (${k.lateReports} late)`;
    });
    return withAbusers
      ? [s.name, `${s.accounts} / ${s.played}`, s.honestAccounts, ...cells, pct(s.smurfsCaught), pct(s.sandbaggersCaught)]
      : [s.name, `${s.accounts} / ${s.played}`, `${s.launchAccounts} / ${s.launchPlayed}`, `${s.lateAccounts} / ${s.latePlayed} (${pct(s.lateAccounts / Math.max(1, s.latePlayed), 2)})`, pass(meetsHonestTarget(s)), ...cells];
  }));
}

async function sectionReports(): Promise<void> {
  print('## Abuse reports over honest play');
  print();
  print('M15-5\'s real checker (afterGame after every game, afterMiss after every missed ready check, daily at 00:20 UTC with the seasons closed since), reports counted as the service files them (one per kind, ladder, accounts and 7-day window). The default thresholds run inline; each candidate set replays the same calls. "Late" counts reports filed from 2027-03-01 on. Candidate sets:');
  print();
  const same = Object.entries(CANDIDATE_ABUSE_RULES).find(([, r]) => JSON.stringify(r) === JSON.stringify(RECOMMENDED.abuseRules));
  const sets: Record<string, Readonly<AbuseRules>> = same === undefined ? { ...CANDIDATE_ABUSE_RULES, recommended: RECOMMENDED.abuseRules } : { ...CANDIDATE_ABUSE_RULES };
  for (const [name, rules] of Object.entries(sets)) print(`- ${name}${same?.[0] === name ? ' (recommended)' : ''}: ${Object.entries(rules).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  print();
  for (const ladder of REPORT_LADDERS) {
    const players = ladder === '1v1-standard' ? SIZE.reportPlayers : Math.round(SIZE.reportPlayers * 0.67);
    const h = await honestReports(ladder, sets, { players, days: SIZE.reportDays, seed: 'reports' });
    reportTable(h);
    print(`Honest play in ${ladder}, per kind: reports from 2027-03-01 on (accounts) under each set:`);
    print();
    table(['kind', ...h.sets.map((x) => x.name)], h.sets[0]!.kinds.map((k0) => [k0.kind, ...h.sets.map((x) => {
      const k = x.kinds.find((y) => y.kind === k0.kind)!;
      return `${k.lateReports} (${k.lateAccounts})`;
    })]));
    const abusers = { smurfs: 20, sandbaggers: 12, fromDay: 60 };
    print(`With ${abusers.smurfs} smurfs (new accounts of true skill N(2000, 60), from day ${abusers.fromDay}) and ${abusers.sandbaggers} sandbaggers (established heavy players conceding every game for 7 days on turn 2-4, then playing honestly):`);
    print();
    reportTable(await honestReports(ladder, sets, { players: Math.round(players * 0.67), days: SIZE.reportDays, seed: 'abusers', abusers }));
  }
}

async function sectionSmall(): Promise<void> {
  print('## Abuse reports in small ladders');
  print();
  print('Honest play in a 1v1 ladder of 500 accounts and a pod ladder of 450 (seed `reports-test`, the slow suite\'s, 120 days): the defaults inline, then the recommended thresholds, and the recommended ones with pods\' repeated pairing at the default 6.');
  print();
  const sets: Record<string, Readonly<AbuseRules>> = {
    recommended: RECOMMENDED.abuseRules,
    'recommended, repeatedPairingPods 6': { ...RECOMMENDED.abuseRules, repeatedPairingPods: 6 },
  };
  for (const ladder of REPORT_LADDERS) {
    const r = await honestReports(ladder, sets, { players: ladder === '1v1-standard' ? 500 : 450, days: 120, seed: 'reports-test' });
    print(`${ladder}: ${n0(r.games)} games, rematches of a last-3 game ${pct(r.rematchShare, 2)} of games, ${r.repeatedPairs} pairs that met 5 times (pods 6) within 7 days; ${mins(r.wallMs)} inline, ${mins(r.replayMs)} of replays.`);
    print();
    table(['thresholds', 'accounts reported from 2027-03', 'meets 17.11', 'reports from 2027-03 (accounts), by kind'], r.sets.map((s) => [
      s.name, `${s.lateAccounts} / ${s.latePlayed}`, pass(meetsHonestTarget(s)),
      s.kinds.filter((k) => k.lateReports > 0).map((k) => `${k.kind} ${k.lateReports} (${k.lateAccounts})`).join(', ') || 'none',
    ]));
  }
}

async function sectionConcede(): Promise<void> {
  print('## How much the recommended thresholds lean on the honest endings');
  print();
  for (const ladder of REPORT_LADDERS) {
    const players = ladder === '1v1-standard' ? SIZE.reportPlayers : Math.round(SIZE.reportPlayers * 0.67);
    // half of all honest losses conceded instead of a third
    const endings = { ...HONEST_ENDINGS, concession: 0.5 };
    const sens = await honestReportsWith(ladder, RECOMMENDED.abuseRules, { players: Math.round(players * 0.67), days: SIZE.reportDays, seed: 'concede', endings });
    const k = (kind: string) => sens.summary.kinds.find((x) => x.kind === kind)!;
    print(`${ladder} (seed \`concede\`, ${n0(Math.round(players * 0.67))} accounts, ${n0(sens.games)} games, ${mins(sens.wallMs)}): with half of all honest losses conceded instead of a third, the recommended thresholds report ${sens.summary.lateAccounts} of ${sens.summary.latePlayed} accounts from 2027-03 on (${sens.summary.kinds.filter((x) => x.lateReports > 0).map((x) => `${x.kind} ${x.lateReports}`).join(', ') || 'no report'}; oneSided ${k('oneSided').lateReports}, sandbagging ${k('sandbagging').lateReports}); meets 17.11: ${pass(meetsHonestTarget(sens.summary))}.`);
    print();
  }
}

async function sectionSmurf(): Promise<void> {
  print('## The smurf rule over new accounts');
  print();
  print('New accounts against the opponents the matcher gave in the stationary population (seeds `smurf-honest/<games>` and `smurf-smurf/<games>`): the share the smurf rule would report within their first 30 days (at most 30 games), honest newcomers of skill N(1500, 130) and smurfs of skill N(2000, 60), at 30 and 100 games a month (with 5 or 10 a month a newcomer is still in placement after 30 days and cannot be reported).');
  print();
  const grid: SmurfThresholds[] = [];
  for (const rating of [1800, 1900, 1950, 2000, 2050, 2100, 99999]) {
    for (const [winShare, minGames] of [[0.8, 15], [0.85, 15], [0.9, 20], [0.95, 20], [2, 30]] as const) grid.push({ rating, winShare, minGames });
  }
  for (const model of ['glicko2', 'wenglin'] as const) {
    const st = await getStationary(LADDER_OF[model]);
    const pool = metPool(st);
    const n = model === 'glicko2' ? 20_000 : 12_000;
    const { value, ms } = await timed(() => {
      const honest = [30, 100].map((gpm) => smurfRates(model, DEFAULT_SIM_PARAMS, grid, n, `smurf-honest/${gpm}`, (r) => r.normal(1500, 130), gpm, pool));
      const smurf = [30, 100].map((gpm) => smurfRates(model, DEFAULT_SIM_PARAMS, grid, Math.round(n / 10), `smurf-smurf/${gpm}`, (r) => r.normal(2000, 60), gpm, pool));
      return { honest, smurf };
    });
    print(`${MODEL_NAME[model]} (${n0(n)} honest newcomers and ${n0(n / 10)} smurfs at each activity; ${mins(ms)}):`);
    print();
    table(['shown rating reached', 'or won', 'of at least', 'honest at 30 / 100 a month', 'smurfs at 30 / 100 a month'], grid.map((t, k) => [
      t.rating > 9000 ? 'never' : t.rating, t.winShare > 1 ? 'never' : pct(t.winShare, 0), t.winShare > 1 ? '' : t.minGames,
      `${pct(value.honest[0]![k]!, 2)} / ${pct(value.honest[1]![k]!, 2)}`, `${pct(value.smurf[0]![k]!, 0)} / ${pct(value.smurf[1]![k]!, 0)}`,
    ]));
  }
}

// ---- main -----------------------------------------------------------------------------------------------------------------------------------

const started = performance.now();
print(`<!-- scripts/simulate.ts ${quick ? '--quick ' : ''}--sections=${sections.join(',')} -->`);
print();
print(`Recommended (test/sim/recommend.ts): ${JSON.stringify(RECOMMENDED)}`);
print();
for (const s of sections) {
  const { ms } = await timed(async () => {
    if (s === 'tick') sectionTick();
    else if (s === 'stationary') await sectionStationary();
    else if (s === 'spread') await sectionSpread();
    else if (s === 'validate') await sectionValidate();
    else if (s === 'pullmet') await sectionPullMet();
    else if (s === 'scenarios') await sectionScenarios();
    else if (s === 'badge') await sectionBadge();
    else if (s === 'waits') await sectionWaits();
    else if (s === 'sweeps') await sectionSweeps();
    else if (s === 'reports') await sectionReports();
    else if (s === 'concede') await sectionConcede();
    else if (s === 'small') await sectionSmall();
    else await sectionSmurf();
  });
  print(`<!-- section ${s}: ${mins(ms)} -->`);
  print();
}
print(`<!-- total ${mins(performance.now() - started)} -->`);
if (outArg !== undefined) writeFileSync(outArg.slice('--out='.length), `${out.join('\n')}\n`, 'utf8');
