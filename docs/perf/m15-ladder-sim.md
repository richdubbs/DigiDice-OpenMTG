# Milestone 15 ladder simulation (M15-6)

Written 2026-10-22 for work package M15-6 of `docs/design/m15-ladder.md` (in the private archive; "the design" below): simulation and tuning of
the ladder's ratings, matchmaking, seasons and abuse thresholds before the first season. Everything here runs in process and is deterministic:
synthetic players, a seeded random source, the simulation's own fake clock, no network. The tables come from
`packages/ladder/scripts/simulate.ts`; the slow suite (`OPENMTG_SLOW=1 npx vitest run packages/ladder/test/sim`) asserts the targets and bounds at
smaller sizes. Nothing in `packages/ladder/src` was changed: the recommendations are the owner's to adopt (design 19).

## Summary

**The targets of 17.11 and the bounds of section 7, with the owner's defaults.** "Matched" is the design's own check model (opponents rated at
their true skill and matched at the player's rating); "met" takes the opponents the real matcher gave in a simulated population of 2,000
accounts, with their noisy ratings and true skills (method below).

| Measure | Target or bound | Measured with the defaults | Verdict |
|---|---|---|---|
| Median rating error after 30 games, 1v1, 1,000 players (accounts that joined an established ladder) | under 60 | 57.2 (the slow suite's seed); 51.2 with another; 59.7 and 61.2 with 2,000; 75.8 with 4,000 | pass at 1,000; **fails in larger ladders** |
| Median rating error after 30 pods, 1,000 players | under 80 shown points | 55.4 (the slow suite's seed); 49.0 and 57.0 with others; 49.0-59.0 from 500 to 4,000 accounts | pass |
| Season shortfall of a true-1800 player at 10 games a month (matched, as section 7) | under 25 | 13.9 (pods 8.3) | pass |
| Median 1v1 wait with 50 players online | under 30 s | 20.0 s | pass |
| Honest play: no `oneSided` or `sandbagging` report, under 1 in 1,000 accounts reported (2027-03 on) | 0, 0, < 0.1% | 1v1: 72 of 1,956 accounts (3.7%), 62 `sandbagging` reports; pods: 51 of 1,306 (3.9%), 7 `oneSided`, 63 `sandbagging` | **fail** |
| Matcher tick with 2,000 entries | under 50 ms on the owner's machine | 1v1 10.4 ms; pods 100-110 ms on this shared machine | 1v1 pass; **pods above** |
| S1 (a) rank at a close the day after stopping | ≤ 2% | matched 1.32% / 0.53%; met 0.57% / 0.07% (1v1 / pods) | pass |
| S1 (b) stopping when the standing gets there | ≤ 6% | matched 4.94% / 2.54%; met 2.90% / 0.72% | pass |
| S1 (c) stopping for a Laser-or-better badge | ≤ 1% | matched 0.78% / 0.05%; met **2.89%** / 0.49% | matched pass; **1v1 met fails** |
| S2 best of 5 on the leaderboard after 10 games | ≤ 6% | matched 4.47% / 0.52%; met 1.92% / 0.04% | pass |
| S2 best of 5 with a Laser-or-better badge | ≤ 5% | matched 3.44% / 0.15%; met **12.66%** / 1.80% | matched pass; **1v1 met fails** |
| S3 Circuit-or-better badge after the reset and 5 games | ≤ 15% | matched 11.58% / 10.06%; met 4.01% / 3.01% | pass |

**Every bound of section 7 holds on the design's own check model, in both ladders.** Against the opponents the matcher gave, the pod ladder still
meets every bound, and **the 1v1 ladder fails the two badge bounds**: S1 (c) at 2.89% (bound 1%) and S2 (b) at 12.66% (bound 5%). Two 17.11
targets fail with the defaults as well: honest play files reports of several kinds, and the pod tick with 2,000 entries takes about twice 50 ms
here. The 1v1 rating-error target holds for the 1,000 players it names, but not in larger ladders.

**Recommendations** (the owner's defaults stay where nothing is wrong):

| Knob | Default | Recommended | Why |
|---|---|---|---|
| `BADGE_CAREER_GAMES` | 30 | **55** | The smallest value tried that meets S1 (c) and S2 (b) against the matcher's opponents with 2,000 accounts (0.76%, 3.96%; 50 gives 1.04%, 4.56%; with 1,000 accounts 40 is enough). It costs casual players badges: a 10-a-month player's seasons with a badge fall from 65% to 27%. |
| `ABUSE_RULES` | section 11.1 | **`smurfRating` 2000, `smurfWinShare` 0.9, `smurfMinGames` 20; `sandbaggingFall` 200, `sandbaggingQuitShare` 0.9; `ratingTransferGain` 200, `ratingTransferOpponentShare` 0.75; `oneSidedGames` 8, `oneSidedWinShare` 0.875, `oneSidedQuickShare` 0.75; `repeatedPairingPods` 8** | Meets the honest-play target in both ladders (2027-03 on: 1v1 0 of 1,956 accounts reported, pods 1 of 1,306; in small ladders of 500 and 450 accounts none; no `oneSided` or `sandbagging`). It still reports 60% (1v1) and 70% (pods) of injected true-2000 smurfs by `smurf`, and 75% / 83% of injected sandbaggers by `sandbagging`. The `smurf` part is not robust: about 0.5-0.7% of active honest newcomers are reported. |
| Pod search (`src/match/pods.ts`, M15-4's) | 9.3's search | prune before the set enumeration | Same results, a fraction of the time (the tick section). |
| σ0, `idleVolPerDay` | 0.06, 0.06 | keep | Every bound holds at 0.04-0.06; σ0 0.07 and `idleVolPerDay` 0.08 fail S1 bounds; `idleVolPerDay` 0.03 leaves a parked rating unprovisional for 340 days. |
| Pod τ | 25/300 | keep | At real activity the daily drift sets a pod rating's resting σ (about 4.2, 82 shown points at 30 pods a month), not τ: a pod between equals moves +22 / −32 (1v1: ±16), and τ up to 25/100 changes nothing measurable. |
| Season pull | 5% | keep, and watch the spread | It holds the stretch (slope 1.23 at 2,000 accounts against 1.35 with no pull) for a shortfall of 13.9 at 10 a month. 10% narrows the stretch (1.14) but leaves a true-1800 player 32 short on the matched model (target under 25) and does not fix the badge bounds; 7.5% meets the error target at 2,000 accounts, nothing tried meets it at 4,000. If the active ratings' SD grows season over season, the design's range (up to 10%) is the lever. |
| Windows | ±100, +50 every 15 s, ±400 / 500, everyone after 5 min | keep | 20 s median 1v1 wait at 50 online; the variants trade a few seconds for a few points of spread. |
| `podThreeAfterMs` | 2 min | keep (owner's choice) | Below 200 online 85-100% of pods start with 3 after 2 minutes; 4 minutes halves that at 200 online for a median wait of 100 s instead of 76 s. |
| `LEADERBOARD_K` | 2 | keep | K 1 or 1.5 fails S1 (a) and S2 (a) (3.4% and 10.9% at K 1); K 2 orders by skill nearly as well (Spearman 0.910 against 0.915). |
| Tier floors | 1300, 1425, 1550, 1675, 1800 | keep, both ladders | The pod distribution's tier shares are within 1.7 points of the 1v1 one's (floors that copy the 1v1 shares exactly: 1295, 1425, 1540, 1665, 1790). |

**What the design did not expect:**

- **The rating scale stretches**, more the more players there are. In a population of fixed skills matched by rating, shown ratings spread wider
  than the true skills: the slope of rating on skill is 1.04 with 500 accounts, 1.12 with 1,000, 1.23 with 2,000 and 1.47 with 4,000 (5% pull),
  and the season pull is what holds it (1.35 with no pull, 1.14 with 10%, 1.03 with 20% at 2,000 accounts). Opponents near a high rating are
  weaker than their rating on average (a rating is skill plus noise), so a strong player must climb above its skill to meet its equals; the
  nearer the matcher's partners, the more so. It costs no ordering (Spearman with skill 0.91) but moves everything measured on the absolute
  scale: the rating error (75.8 after 30 games with 4,000 accounts), the tier shares (Wire 13%, Prism 5% with 2,000 accounts, against 6.3's 9%
  and 2%), and the badge bounds, since a fixed floor such as Laser's sits lower in true skill.
- **Pod ratings are not slow.** 5.2 expects an active pod player near σ 1.6 moving 4-6 points a pod; the daily drift keeps a player with a pod a
  day near σ 4.2, so a pod moves +22 / −32, and a settled pod rating turns provisional after about 71 days (6.2: 124). The same holds in 1v1:
  at one game a day the time away adds as much as σ0 does, the resting deviation is about 77, not 61, and a settled rating turns provisional
  after about 78 days, not 99.
- **Most pods are 3-player** unless about 500 players are online: the 3-player start after 2 minutes comes before a fourth player within the
  window.
- **Honest play trips most heuristics at the default thresholds**: strong newcomers (`smurf`), losing streaks with ordinary concessions
  (`sandbagging`), one big win after a break (`ratingTransfer`), heavy players who meet often in a small ladder (`oneSided`).

## How it was simulated

**Synthetic players.** Each account has a true skill in shown points, drawn from N(1500, 130) (the design's assumed skill spread, 6.3), and a
fixed activity of 5, 10, 30 or 100 games a month (a quarter each). True outcomes use the ladder's own scales: in 1v1, A beats B with
1 / (1 + 10^(−(sA − sB) / 400)), and 0.5% of games are draws; in a pod, each player's performance is (s − 1500) / 173.7178 plus a standard
Gumbel deviate and the pod finishes in that order, a Plackett-Luce draw in which any two players finish in the 1v1 logistic order (Luce's choice
axiom; the slow suite checks it on 40,000 pods). How honest losses end is an assumption, stated because the abuse rules read it: 33% conceded,
2% left, 2% timed out, 1% disconnected, the rest out by life, library or poison; 2% of losses conceded on turn 1 or 2; games last 5 + Poisson(4)
turns (pods 8 + Poisson(6)).

**The population** (`test/sim/population.ts`). Accounts arrive over the first 14 days from a launch on 2027-01-01 (season 2027-01); 10% of
accounts quit each month and are replaced by new ones of the same activity, so later seasons are a stationary mix of old and new accounts.
Players come online in sessions (1 to 5 games, by activity) and queue in **the real rated matcher** (`createRatedMatcher`, M15-4) with entries
built as `LadderService.entryFor` builds them (rating and deviation from `ratingNow`, placement, the last 3 games' opponents). The matcher runs on
the simulation's `FakeClock` and is ticked as hosted's timer wheel ticks it, once a second; to be fast the simulation ticks only at the seconds
where a tick can form a match, and the slow suite checks that this gives exactly the matches of a tick every second. A matched player passes the
anonymous ready check after 2-10 s or misses it (1%; missed checks get the escalating cooldowns of 8.6), a queued player gives up after 20
minutes, games last 12-28 minutes (pods 45-90). Games are rated with the ladder's math (time away, the lazy monthly reset, placement, tiers with
the buffer, season records); seasons close as the service closes them (final standings at the season's end, competition ranks, badges). M15-5's
real abuse checker runs as the service runs it.

**It is the ladder's math.** The simulation re-implements only what reads a swept constant, from the package's own parameter-free cores
(`glicko2Period`, `plackettLuceTerms`, `tierOf`, `tierAfter`, ...). With the defaults it equals the package to the last bit: `model.test.ts`
compares it with `rateOneVsOne`, `ratePod`, `seasonReset`, `ratingNow`, `provisionalFrom`, `standingOf`, `badgeTier`, M15-3's
`computeApplication` and the season close on thousands of fixed cases; `service.test.ts` runs a small population's log through the real
`LadderService` on the memory store, with the real checker and a daily sweep, and every rating row, season record (finals and badges included)
and report is the simulation's.

**The solo model** (`test/sim/solo.ts`) plays one account at a time, for the tens of thousands of careers the gaming scenarios need, against
one of two opponent pools:

- **matched**: the design's own check model (section 7): every opponent is rated and skilled at the player's current rating, deviation 60;
- **met**: the opponents the real matcher gave in a stationary population (2027-03 on): for a player rated R (in placement or not), the opponents
  of a game in which a seat stood at about R, with their ratings, deviations and **true** skills then. It carries the stretch: an opponent rated
  1700 is weaker than 1700 on average, and a sparse queue pairs a high rating with a lower one once the window widens. Over an account's
  first 30 games its rating error against these opponents is the population's own (results, "The solo model's opponents"); against matched
  opponents it is a fifth to a third smaller.

**Determinism.** Every random stream is a named fork of a seeded xoshiro128** (`test/sim/rng.ts`); no file of the simulation reads
`Math.random` or `Date.now` (the slow suite checks the sources); times are whole milliseconds of the simulation's clock. Seeds are given with
each table. Wall times depend on the machine: these runs shared 4 CPUs with other jobs.

## Results

### The stationary population

Two populations of 2,000 accounts at a time (seed `stationary`; 10% churn a month, so 3,508 and 3,560 accounts over the run), from the launch on
2027-01-01 through the close of 2027-08: 277,674 1v1 games (45 s of wall time) and 177,392 pods (2.7 min). "Established" accounts were created
from 2027-03-01 on, when the ladder had settled; the launch cohort in the first 30 days. Seasons 2027-03 to 2027-08 are the stationary
distribution.

**Rating error after k games and after k pods** (median |shown rating − true skill| right after the k-th career game; the median shown deviation
then, of established accounts):

| k | 1v1 launch | 1v1 established | deviation | pods launch | pods established | deviation |
|---|--:|--:|--:|--:|--:|--:|
| 5 | 118.7 | 108.5 | 156.1 | 67.4 | 68.8 | 130.8 |
| 10 | 98.5 | 90.2 | 120.4 | 62.5 | 65.8 | 116.6 |
| 15 | 90.7 | 79.0 | 103.9 | 65.1 | 62.4 | 106.6 |
| 20 | 82.0 | 67.3 | 94.1 | 62.4 | 59.9 | 99.8 |
| 30 | 75.2 | **59.7** | 82.7 | 60.2 | **53.6** | 89.9 |
| 50 | 65.6 | 51.0 | 73.9 | 55.9 | 48.6 | 81.4 |
| 100 | 55.2 | 40.4 | 70.5 | 52.3 | 46.6 | 74.7 |

(Samples: 2,083 to 891 launch accounts and 1,102 to 352 established ones in 1v1 as k grows; about the same in pods. The 90th percentiles are
in the script's output: 147 after 30 games in 1v1, 123 after 30 pods.) 17.11 names 1,000 players: with 1,000 accounts (the slow suite's
population, seed `stationary`) the errors after 30 games and 30 pods are 57.2 and 55.4, both under target; with these 2,000 the 1v1 error is
59.7, a third of a point under, and the next section shows it grow past 60 in larger ladders: the stretch makes ratings "wrong" by tens of
points even where they order players well. Placement (10 games) ends at a median deviation of 120 for established newcomers and 129 at the
launch (6.2 expects 109.7 against settled opponents and 123.5 from a cold start). A pod rating starts closer (its σ0 of 161 shown points is
less than 1v1's 350), so its error is smaller early and falls more slowly.

**Tier shares by games a month** (the tier of the shown rating at the season's end, fresh, of every placed account with a game in the season;
then its season badge):

| 1v1, games a month | player-seasons | Wire | Circuit | Pulse | Arc | Laser | Prism | deviation at the end | season games | rating − skill |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 5 | 2,689 | 14.2% | 21.1% | 24.5% | 21.7% | 12.8% | 5.7% | 119.3 | 5 | 3.3 |
| 10 | 2,994 | 13.6% | 20.2% | 25.6% | 23.2% | 12.2% | 5.2% | 100.4 | 9 | 0.8 |
| 30 | 3,211 | 13.2% | 20.8% | 24.8% | 25.0% | 12.3% | 4.0% | 79.8 | 27 | −3.8 |
| 100 | 3,279 | 12.4% | 20.8% | 27.5% | 21.3% | 13.4% | 4.6% | 68.3 | 92 | −1.6 |

| pods, games a month | player-seasons | Wire | Circuit | Pulse | Arc | Laser | Prism | deviation at the end | season games | rating − skill |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 5 | 2,712 | 14.5% | 20.1% | 26.9% | 23.1% | 11.0% | 4.4% | 130.2 | 5 | −3.7 |
| 10 | 2,980 | 14.5% | 19.9% | 28.1% | 22.3% | 11.4% | 3.8% | 109.8 | 9 | −8.5 |
| 30 | 3,216 | 15.5% | 19.7% | 26.8% | 21.8% | 12.0% | 4.1% | 84.5 | 27 | −4.6 |
| 100 | 3,287 | 11.7% | 20.6% | 27.5% | 23.9% | 12.0% | 4.4% | 62.4 | 92 | −2.3 |

| Badge shares, 1v1 / pods | Wire | Circuit | Pulse | Arc | Laser | Prism | no badge |
|---|--:|--:|--:|--:|--:|--:|--:|
| 5 a month | 1.9% / 2.3% | 4.0% / 3.9% | 4.3% / 4.3% | 3.6% / 4.3% | 1.8% / 1.5% | 0.9% / 0.6% | 83.4% / 83.1% |
| 10 a month | 8.2% / 9.5% | 13.4% / 12.9% | 17.8% / 19.2% | 15.2% / 15.1% | 7.4% / 7.6% | 3.3% / 2.1% | 34.7% / 33.6% |
| 30 a month | 11.4% / 13.5% | 19.9% / 18.9% | 22.4% / 24.4% | 23.8% / 20.8% | 10.7% / 9.9% | 3.5% / 3.7% | 8.3% / 8.8% |
| 100 a month | 11.9% / 11.1% | 20.8% / 19.3% | 25.8% / 28.0% | 21.9% / 22.7% | 12.6% / 12.0% | 4.1% / 4.0% | 2.9% / 2.9% |

Activity changes the tier shares little: the median shown rating is unbiased at every activity (the last column), and a casual player's larger
deviation spreads its rating a little wider. The badge needs 5 post-placement games in the season and 30 career games, so a 5-game month almost
never gives one and a 10-game month two times in three.

**The distribution and the floors.** Shown ratings at the seasons' ends (12,173 1v1 player-seasons): mean 1502, SD 178.5 against a true-skill SD
of 129.4, correlation with skill 0.891; 5th/25th/50th/75th/95th percentiles 1208 / 1377 / 1500 / 1628 / 1797. Pods (12,195): mean 1496, SD 179.7
(skill SD 130.7), correlation 0.905; 1203 / 1376 / 1500 / 1617 / 1786. With the default floors:

| | Wire | Circuit | Pulse | Arc | Laser | Prism |
|---|--:|--:|--:|--:|--:|--:|
| 1v1 | 13.3% | 20.7% | 25.7% | 22.8% | 12.7% | 4.8% |
| pods | 14.0% | 20.1% | 27.3% | 22.8% | 11.6% | 4.2% |
| design 6.3's estimate (spread 150) | 9% | 22% | 32% | 25% | 10% | 2% |

The pod floors that would give pods the 1v1 shares are 1295, 1425, 1540, 1665, 1790, within 10 points of the defaults, so the pod simulation
gives no reason for floors of its own: **keep the defaults for both ladders.** Both ladders spread wider than 6.3 assumed because of the stretch
below; if the owner wants 6.3's shares, floors of about 1240, 1405, 1565, 1710, 1860 give them at this population size, but the stretch depends
on how many play, so that is better decided from the first real season's distribution (the floors change only at a season start anyway).

**Drift.** The mean shown rating stays within 5 points of 1500 in every season of both ladders (risk 5 does not show). What moves is the spread:

| season | 1v1 rating SD | slope on skill | pods rating SD | slope on skill |
|---|--:|--:|--:|--:|
| 2027-01 | 200.6 | 1.357 | 178.4 | 1.198 |
| 2027-02 | 192.8 | 1.313 | 175.2 | 1.218 |
| 2027-03 | 184.1 | 1.253 | 176.5 | 1.234 |
| 2027-04 | 180.9 | 1.246 | 178.7 | 1.239 |
| 2027-05 | 178.2 | 1.223 | 179.2 | 1.250 |
| 2027-06 | 175.9 | 1.207 | 181.4 | 1.254 |
| 2027-07 | 175.4 | 1.212 | 180.2 | 1.243 |
| 2027-08 | 176.5 | 1.229 | 182.4 | 1.251 |

(The true skills' SD is 126-133 throughout.) The launch's high deviations stretch 1v1 most in its first months; it settles at a slope of about
1.22. Pods settle at about 1.25.

**Leaderboard order and `LEADERBOARD_K`.** The final boards of seasons 2027-03 to 2027-08 (eligible accounts) ordered by the standing at other
values of K: the rank correlation with true skill, who fills the top 10%, and how far the order moves from the order by shown rating:

| K | 1v1: Spearman with skill | top 10% at 100 a month | at ≤ 10 a month | rank move | pods: Spearman | top 10% at 100 | at ≤ 10 | rank move |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| 1 | 0.915 | 48.2% | 18.3% | 1.5% | 0.924 | 49.8% | 12.3% | 2.3% |
| 1.5 | 0.913 | 50.6% | 16.2% | 2.3% | 0.918 | 53.5% | 10.0% | 3.5% |
| 2 | 0.910 | 52.9% | 14.3% | 3.0% | 0.911 | 56.5% | 8.2% | 4.6% |
| 2.5 | 0.905 | 54.5% | 12.9% | 3.8% | 0.902 | 60.0% | 6.7% | 5.7% |
| 3 | 0.901 | 56.9% | 11.2% | 4.5% | 0.891 | 63.2% | 5.0% | 6.7% |

Risk 14 is real but small: at K 2 heavy players hold 53% of the top 10% (48% at K 1), and the order is 3% of the board away from the rating
order. A larger K orders slightly less by skill, a smaller one slightly more, but the gaming scenarios decide K (the sweeps: K 1 and 1.5 fail
S1 (a) and S2 (a)).

**The session model's waits and rematches.** With players online in sessions (2,000 accounts: a median of 33 online in 1v1, 110 in pods): 1v1
median wait 30.1 s, 90th percentile 152 s; pods 90.1 s and 283 s, and **88.5% of pods were 3-player**. Nobody gave up (20 minutes of patience).
Rematches of one of the last 3 games (only under the relaxation): 0.01% of 1v1 games, 0.15% of pods; matches formed relaxed or with a member
past 5 minutes: 4.4% and 4.7% in 1v1, 24.8% and 26.0% in pods. In the smaller report-rate populations (1,500 and 1,000 accounts): rematches 0.03%
of 1v1 games and 3.05% of pods, and no pair met 5 times (pods 6) within 7 days.

### The cold start: the first leaderboard rows

The same runs' first season (2,000 accounts arriving over 14 days from the launch; a row needs placement, 10 season games and a deviation now
under 120):

| | first row | 10 rows | 50 rows | 100 rows | career games at a launch account's first row (median, 10th-90th pct) | days after its creation | launch accounts on the board within January |
|---|--:|--:|--:|--:|--:|--:|--:|
| 1v1 | 29.5 h | 56.3 h | 104.3 h | 137.9 h | 12 (10-14) | 5.4 | 53.4% |
| pods | 49.9 h | 72.9 h | 113.2 h | 141.5 h | 12 (10-14) | 5.4 | 53.4% |

The first rows come about a day (1v1) or two (pods) after the launch, from the heaviest players, and an account's first row comes 2 games after
placement in both ladders (6.2 expected one game in 1v1 and "a few pods"). Most of the 47% not on the board within January are casual: an
account with 5 games a month cannot play 10 in its first month.

### The rating spread by population size and pull

The stretch, measured directly: stationary runs as above with other numbers of accounts and other pulls (seeds `spread/<accounts>/<pull>`;
seasons 2027-03 to 2027-08: the median accounts online, the shown ratings' SD (true skills' SD about 130) and slope on the true skill (means over
the seasons), the rating error after 30 games of accounts that joined the established ladder, and the Wire and Prism shares with the default
floors):

1v1:

| accounts | pull | online | rating SD | slope | error after 30 (established) | Wire | Prism | time |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| 500 | 0.05 | 9 | 151.8 | 1.038 | 45.3 | 8.8% | 2.6% | 9.7 s |
| 1,000 | 0.05 | 17 | 163.5 | 1.120 | 51.2 | 10.8% | 3.9% | 16.6 s |
| 2,000 | 0.05 | 33 | 180.4 | 1.231 | 61.2 | 14.1% | 4.7% | 38.3 s |
| 4,000 | 0.05 | 66 | 211.8 | 1.467 | 75.8 | 18.7% | 8.5% | 1.7 min |
| 2,000 | 0 | 34 | 196.8 | 1.352 | 72.9 | 15.4% | 6.8% | 47.6 s |
| 2,000 | 0.1 | 33 | 165.5 | 1.143 | 54.2 | 12.0% | 3.2% | 41.8 s |
| 2,000 | 0.2 | 33 | 153.0 | 1.027 | 52.9 | 9.7% | 2.3% | 43.8 s |
| 2,000 | 0.075 | 33 | 174.2 | 1.187 | 55.1 | 12.8% | 4.4% | 0.9 min |
| 4,000 | 0.075 | 66 | 202.0 | 1.368 | 69.1 | 16.6% | 7.5% | 2.0 min |
| 4,000 | 0.1 | 66 | 190.5 | 1.323 | 65.6 | 15.6% | 5.8% | 1.9 min |

pods:

| accounts | pull | online | rating SD | slope | error after 30 (established) | Wire | Prism | time |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| 500 | 0.05 | 28 | 168.3 | 1.139 | 56.5 | 13.3% | 3.0% | 21.7 s |
| 1,000 | 0.05 | 56 | 175.3 | 1.194 | 49.0 | 13.0% | 4.3% | 49.0 s |
| 2,000 | 0.05 | 112 | 179.1 | 1.225 | 55.6 | 13.8% | 4.4% | 2.7 min |
| 4,000 | 0.05 | 221 | 191.0 | 1.326 | 59.0 | 15.4% | 5.7% | 11.2 min |
| 2,000 | 0 | 111 | 184.2 | 1.284 | 55.7 | 14.4% | 5.0% | 2.4 min |
| 2,000 | 0.1 | 111 | 174.5 | 1.205 | 51.6 | 13.0% | 4.3% | 2.3 min |
| 2,000 | 0.2 | 111 | 163.0 | 1.103 | 48.7 | 12.4% | 2.8% | 2.2 min |

In both ladders the stretch grows with the number of players online, because the matcher's partners get nearer in rating, and the season pull
holds it back. The mean rating does not drift. With the defaults the 1v1 rating error after 30 games passes 17.11's 60 at 1,000 accounts (the
size the target names) and fails from about 2,000 on (59.7 and 61.2 with two seeds; 75.8 with 4,000). A larger pull narrows the stretch but
does not remove it at 4,000 accounts (7.5%: 69.1; 10%: 65.6; at 2,000 accounts 7.5% gives 55.1; a smaller σ0 does not either, the sweeps),
and it costs strong players: on the design's matched model a 10% pull leaves a true-1800 player at 10 games a month about 32 points short of
its skill (target under 25), a 20% pull about 49. **No knob of the sweep meets every target in a large 1v1 ladder.** The pod error after 30 pods stays under 60 at every size (target 80).
The stretch changes no ordering (Spearman with skill about 0.91 at every size and K above), so this report does not recommend a larger pull
now; it recommends watching it: the SD of the active shown ratings at each season's close is observable, and if it grows season over season
(in this simulation above about 190 in 1v1), the design's allowed range for the pull (up to 10%) is the lever, at a season start, together
with floors read from that season's distribution.

**With a 10% pull** (the script's `pullmet` section): a stationary 1v1 population of 2,000 with a 10% pull (seed `stationary`; slope 1.130,
error after 30 games 54.7) and the scenarios against its matcher's opponents (seeds `met/...`):

| bound | measured | bound |  |
|---|--:|--:|--:|
| S1 rank at a close the day after stopping | 0.71% | ≤ 2% | pass |
| S1 stopping when the standing gets there | 3.73% | ≤ 6% | pass |
| S1 stopping for a Laser-or-better badge | 2.50% | ≤ 1% | **FAIL** |
| S2 best of 5 on the leaderboard after 10 games | 2.57% | ≤ 6% | pass |
| S2 best of 5 with a Laser-or-better badge | 11.17% | ≤ 5% | **FAIL** |
| S3 Circuit-or-better badge after 5 games | 9.78% | ≤ 15% | pass |
| season shortfall of a true-1800 player at 10 games a month | -23.9 | < 25 | pass |

Shortfall of a true-1800 player at 5/10/30/100 games a month against these opponents: −4.3 / −23.9 / −50.0 / −63.7 (above its skill). The
pull narrows the stretch but hardly changes the badge bounds: a lucky account's rating holds because its opponents' true skills sit below their
ratings, not because of the scale's width. Only the badge's career games fix them (next sections).

### The solo model's opponents against the population

A new player's median rating error after k games (skills N(1500, 130), one game a day; seed `validate`, 1,500 players) against matched
opponents and against the opponents the matcher gave in the 2,000-account populations, beside those populations' own accounts that joined the
established ladder:

| k | 1v1 (Glicko-2): matched | met | population (established) |
|---|--:|--:|--:|
| 5 | 92.0 | 105.1 | 108.5 |
| 10 | 73.0 | 89.4 | 90.2 |
| 20 | 54.3 | 66.1 | 67.3 |
| 30 | 43.7 | 57.2 | 59.7 |
| 50 | 37.7 | 54.1 | 51.0 |
| 100 | 38.0 | 49.5 | 40.4 |

| k | pods (Weng-Lin): matched | met | population (established) |
|---|--:|--:|--:|
| 5 | 60.9 | 64.5 | 68.8 |
| 10 | 55.8 | 61.7 | 65.8 |
| 20 | 44.4 | 58.1 | 59.9 |
| 30 | 44.3 | 58.6 | 53.6 |
| 50 | 36.8 | 55.2 | 48.6 |
| 100 | 36.1 | 58.0 | 46.6 |

The met opponents reproduce the population's error over an account's first 30 games in both ladders (the span of S2 and of most S1 stops);
matched opponents give a fifth to a third less. Past about 50 games the met model's error drifts above the population's (its opponents do not
answer back), so for S1's accounts that play on past 50 games it is on the pessimistic side: a check beside the design's matched model, not a
replacement for it.

### The season shortfall

A true-1800 player's shown rating at its seasons' ends (months 3-8 of a career that starts at a season start; section 7's table; seeds
`scenarios/shortfall/<games>`, 1,200 careers at 10 games a month):

| games a month | 1v1 matched: rating at the end | shortfall | Prism badge | deviation at the end | pods matched: shortfall | Prism badge |
|---|--:|--:|--:|--:|--:|--:|
| 5 | 1775.9 | 24.1 | 18.2% | 110.9 | 14.7 | 19.4% |
| 10 | 1786.1 | **13.9** | 38.1% | 92.9 | **8.3** | 40.9% |
| 30 | 1796.1 | 3.9 | 44.1% | 73.7 | 4.6 | 43.4% |
| 100 | 1799.6 | 0.4 | 43.6% | 64.6 | 0.8 | 44.8% |

Section 7 computed 1780, 1786, 1796 and 1799 for 1v1 with a 5% pull: about the same. **Target met** (under 25 at 10 games a month). Against the
matcher's opponents there is no shortfall at all: a true-1800 player ends its seasons 32-77 points above 1800 in 1v1 and about 90-100 above in
pods, the stretch again.

### The gaming scenarios S1-S3

The scenarios as section 7 defines them (`test/sim/scenarios.ts`): S1 a new true-1500 account plays one game an hour (up to 200, all in one
season) and stops (a) at its first game after placement with a rating of at least 1675 and a deviation of at most 120, the season closing the
next day: does it rank at or above the median honest true-1675 player with 30 games a month (the yardstick)? (b) as soon as its standing at a
close the next day would; (c) as soon as its season median would give a Laser-or-better badge. S2 the best of 3, 5 or 10 new true-1500 accounts:
(a) on the leaderboard at or above the yardstick after 10 games, (b) a Laser-or-better badge after 30 games each. S3 a true-1250 player rated
exactly 1250 (deviation 60) plays 5 games after the reset and stops. The rates count every account (or group) that tried.

Sizes: 1v1 20,000 S1 accounts, 8,000 S2 groups (of 10, split into 3, 5 and 10), 20,000 S3 players, 800 honest careers for the yardstick; pods
12,000, 5,000, 12,000 and 600. Seeds `scenarios/...` (matched) and `met/...`; 33 s, 49 s, 1.4 min and 1.5 min.

| Bound | 1v1 matched | 1v1 met | pods matched | pods met | bound |
|---|--:|--:|--:|--:|--:|
| yardstick (median final standing of honest true-1675 players) | 1524 | 1571 | 1518 | 1560 | |
| S1: accounts that meet (a)'s stopping condition within 200 games | 8.2% | 15.8% | 3.5% | 7.7% | (design: 7-8%) |
| S1 (a) rank at a close the day after it stops | 1.32% | 0.57% | 0.53% | 0.07% | ≤ 2% |
| S1 (b) stopping as soon as the standing gets there | 4.94% | 2.90% | 2.54% | 0.72% | ≤ 6% |
| S1 (c) stopping as soon as the median gives Laser | 0.78% | **2.89%** | 0.05% | 0.49% | ≤ 1% |
| S2 best of 3 / 5 / 10 on the leaderboard after 10 games | 2.70 / 4.47 / 8.82% | 1.15 / 1.92 / 3.81% | 0.31 / 0.52 / 1.04% | 0.02 / 0.04 / 0.08% | best of 5 ≤ 6% |
| S2 best of 3 / 5 / 10 with a Laser badge | 2.06 / 3.44 / 6.73% | 7.78 / **12.66** / 23.66% | 0.09 / 0.15 / 0.30% | 1.09 / 1.80 / 3.52% | best of 5 ≤ 5% |
| S3 Circuit-or-better badge | 11.58% | 4.01% | 10.06% | 3.01% | ≤ 15% |
| S3 from a true-1250 player's own stationary rating (3 months at 30 a month) | 25.40% | 4.70% | 21.38% | 2.38% | |
| … the same players playing their whole month instead | 17.40% | 2.45% | 12.96% | 0.46% | |

On the design's matched opponents every bound holds in both ladders, and the 1v1 numbers are section 7's (1.4%, 4.5%, 0.7%; 5.3% and 3.5%;
12%). The pod ladder is much harder to game: a pod rating starts closer to the middle (σ0 161 shown points, not 350) and moves less in a pod a
lucky account wins.

Against the opponents the matcher gave, the leaderboard bounds get easier (the honest yardstick rises with the stretch) and the badge bounds get
harder: a lucky true-1500 account keeps a high rating longer when its opponents' true skills sit below their ratings, and Laser's fixed floor of
1675 is about 1640 in true skill on a scale stretched 1.22 times. **S1 (c) 2.89% and S2 (b) 12.66% fail in 1v1.** The badge section gives the
smallest change that meets them.

S3 passes everywhere. Its last two rows show what the bound's scenario leaves out: a true-1250 player whose rating moved with its own games
often sits near 1300 already; 25% of them get Circuit after the reset and 5 games, against 17% when they play their whole month: the reset
and stopping after 5 games add about 8 points over honest play (against the matcher's opponents, about 2).

### The badge's career games

S1 (c) and S2 (b) with `BADGE_CAREER_GAMES` at other values, against the opponents the matcher gave in the 2,000-account populations (S2's
accounts play that many games; seeds `badge/...`, the report's sizes), and what each value costs honest players: the share of the stationary
population's player-seasons (2027-03 to 2027-08) that earn a badge, by games a month.

| career games | 1v1 S1 (c) | ≤ 1% | 1v1 S2 (b), best of 5 | ≤ 5% | honest 1v1 seasons with a badge, 5 / 10 / 30 / 100 a month | pods S1 (c) | pods S2 (b) | honest pod seasons with a badge |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| 30 (default) | 2.85% | **fail** | 12.69% | **fail** | 17% / 65% / 92% / 97% | 0.45% | 1.70% | 17% / 66% / 91% / 97% |
| 40 | 1.60% | **fail** | 7.75% | **fail** | 5% / 48% / 89% / 96% | 0.13% | 0.52% | 4% / 49% / 88% / 96% |
| 50 | 1.04% | **fail** | 4.56% | pass | 0% / 34% / 85% / 95% | 0.07% | 0.19% | 0% / 34% / 84% / 95% |
| **55** | **0.76%** | pass | **3.96%** | pass | 0% / 27% / 84% / 94% | 0.06% | 0.15% | 0% / 27% / 82% / 94% |
| 60 | 0.55% | pass | 2.79% | pass | 0% / 22% / 82% / 94% | 0.01% | 0.11% | 0% / 21% / 80% / 94% |
| 70 | 0.40% | pass | 1.61% | pass | | | | |

S1 (a) and S2 (a) do not depend on it (1v1: 0.6-0.7% and 1.8-2.1% in every row; pods under 0.1%). The 70 row is a separate run of the same
functions with the same seeds. In the slow suite's 1,000-account population, where the opponents' ratings are less stretched, 40 already meets
both bounds: the more players, the more career games the badge needs to stay out of a lucky account's reach.

**Smallest change that meets the failing bounds: `BADGE_CAREER_GAMES` 30 → 55.** Its cost is real: a player with 10 games a month earns no
badge in its first five seasons instead of its first three, and the share of 10-a-month seasons with a badge falls from 65% to 27% (30 a month:
92% to 84%). A larger pull is no substitute: with a 10% pull S1 (c) is still 2.50% and S2 (b) 11.17% (the pull section). Not measured here:
floors that follow the stretch (on a scale stretched 1.22 times, Laser's 1675 is about 1640 in true skill), a per-ladder change at a season
start that would leave casual players' badges alone. The owner decides; 55 is the one constant found that meets both bounds at both population
sizes measured.

### Waits by population and the window sweep

Always-online populations (each player queues again 1-5 minutes after a game, ratings established at skill plus noise, 1% of ready checks
missed; seeds `waits/<n>`, 2 days after a day's warm-up):

1v1 (11.6 s):

| online | matches | median wait | 90th pct | median rating spread | median skill gap | relaxed | past 5 min |
|---|--:|--:|--:|--:|--:|--:|--:|
| 10 | 624 | 75.5 s | 504.2 s | 131 | 128 | 31.9% | 40.2% |
| 20 | 1,306 | 45.8 s | 297.2 s | 121 | 112 | 16.5% | 18.6% |
| 50 | 3,418 | 20.0 s | 119.8 s | 84 | 76 | 2.6% | 2.7% |
| 100 | 6,883 | 15.2 s | 76.0 s | 69 | 66 | 0.5% | 0.5% |
| 200 | 13,942 | 4.8 s | 44.4 s | 59 | 51 | 0.5% | 0.5% |
| 500 | 35,058 | 1.1 s | 21.1 s | 51 | 47 | 0.1% | 0.1% |


pods (30.3 s):

| online | matches | median wait | 90th pct | median rating spread | median skill gap | relaxed | past 5 min | pods of 3 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| 12 | 161 | 600.2 s | 689.7 s | 150 | 175 | 95.7% | 96.3% | 100.0% |
| 20 | 253 | 583.1 s | 1343.1 s | 171 | 156 | 90.1% | 94.5% | 99.2% |
| 50 | 676 | 162.5 s | 600.3 s | 200 | 167 | 65.2% | 71.2% | 99.4% |
| 100 | 1,382 | 105.2 s | 346.0 s | 192 | 174 | 36.2% | 39.6% | 95.8% |
| 200 | 2,711 | 76.4 s | 207.2 s | 147 | 147 | 8.8% | 9.5% | 84.8% |
| 500 | 6,217 | 51.5 s | 126.6 s | 131 | 127 | 2.1% | 2.1% | 55.3% |

**17.11's target holds:** with 50 players online the median 1v1 wait is 20.0 s (target under 30 s). Below 20 online a 1v1 player waits about a
minute and sometimes for the 5-minute 'everyone' window; above 100 a wait is seconds. **Pods need many more players**: with 12-20 online the
median wait is 10 minutes (the rematch relaxation: the same few players just played each other), with 50 online about 3 minutes, and pods of 4
are rare until about 500 are online, because the 3-player start after 2 minutes comes first.

**The window sweep** (seed `windows/<n>`, the same populations):

1v1:

| policy | online | matches | median wait | 90th pct | median rating spread | median skill gap | relaxed | past 5 min |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| defaults (±100, +50 / 15 s, cap 400 / 500) | 20 | 1,334 | 36.3 s | 264.3 s | 105 | 101 | 12.2% | 14.9% |
| defaults (±100, +50 / 15 s, cap 400 / 500) | 50 | 3,391 | 23.4 s | 125.5 s | 84 | 78 | 3.0% | 3.1% |
| defaults (±100, +50 / 15 s, cap 400 / 500) | 200 | 13,917 | 4.8 s | 45.2 s | 60 | 53 | 0.3% | 0.3% |
| start ±50 | 20 | 1,317 | 45.7 s | 245.5 s | 95 | 105 | 10.3% | 11.6% |
| start ±50 | 50 | 3,373 | 31.0 s | 149.1 s | 72 | 77 | 4.4% | 4.6% |
| start ±50 | 200 | 13,826 | 15.2 s | 60.4 s | 39 | 46 | 0.3% | 0.3% |
| start ±150 | 20 | 1,335 | 30.2 s | 234.0 s | 117 | 105 | 7.7% | 11.5% |
| start ±150 | 50 | 3,409 | 15.8 s | 117.2 s | 107 | 88 | 2.1% | 2.1% |
| start ±150 | 200 | 13,954 | 1.9 s | 33.5 s | 78 | 62 | 0.2% | 0.2% |
| +25 / 15 s | 20 | 1,305 | 49.2 s | 280.7 s | 100 | 100 | 14.2% | 16.7% |
| +25 / 15 s | 50 | 3,378 | 29.3 s | 159.8 s | 77 | 70 | 6.2% | 6.2% |
| +25 / 15 s | 200 | 13,884 | 3.8 s | 51.0 s | 56 | 50 | 0.6% | 0.7% |
| +100 / 15 s | 20 | 1,342 | 30.1 s | 238.4 s | 101 | 106 | 8.5% | 12.6% |
| +100 / 15 s | 50 | 3,415 | 16.5 s | 107.6 s | 89 | 93 | 1.0% | 1.1% |
| +100 / 15 s | 200 | 13,960 | 6.0 s | 38.6 s | 61 | 56 | 0.0% | 0.0% |
| cap 300 / 400 | 20 | 1,341 | 32.0 s | 273.5 s | 101 | 101 | 12.8% | 16.9% |
| cap 300 / 400 | 50 | 3,387 | 23.1 s | 142.7 s | 85 | 80 | 5.0% | 5.0% |
| cap 300 / 400 | 200 | 13,887 | 5.1 s | 45.4 s | 59 | 50 | 0.4% | 0.4% |
| everyone after 3 min | 20 | 1,337 | 33.8 s | 223.6 s | 104 | 101 | 22.1% | 32.8% |
| everyone after 3 min | 50 | 3,399 | 22.7 s | 120.4 s | 87 | 85 | 8.9% | 9.5% |
| everyone after 3 min | 200 | 13,937 | 5.2 s | 45.2 s | 59 | 53 | 1.2% | 1.3% |
| pods of 3 after 4 min | 20 | 1,334 | 36.3 s | 264.3 s | 105 | 101 | 12.2% | 14.9% |
| pods of 3 after 4 min | 50 | 3,391 | 23.4 s | 125.5 s | 84 | 78 | 3.0% | 3.1% |
| pods of 3 after 4 min | 200 | 13,917 | 4.8 s | 45.2 s | 60 | 53 | 0.3% | 0.3% |

pods:

| policy | online | matches | median wait | 90th pct | median rating spread | median skill gap | relaxed | past 5 min | pods of 3 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| defaults (±100, +50 / 15 s, cap 400 / 500) | 20 | 252 | 560.9 s | 1360.9 s | 140 | 129 | 88.9% | 93.3% | 100.0% |
| defaults (±100, +50 / 15 s, cap 400 / 500) | 50 | 683 | 168.2 s | 600.1 s | 153 | 144 | 58.1% | 71.3% | 99.3% |
| defaults (±100, +50 / 15 s, cap 400 / 500) | 200 | 2,704 | 76.4 s | 211.7 s | 151 | 148 | 10.0% | 10.6% | 84.9% |
| start ±50 | 20 | 252 | 568.7 s | 1369.3 s | 134 | 132 | 95.6% | 97.2% | 100.0% |
| start ±50 | 50 | 677 | 179.8 s | 600.4 s | 147 | 145 | 69.9% | 72.5% | 99.3% |
| start ±50 | 200 | 2,718 | 86.1 s | 225.4 s | 149 | 147 | 13.8% | 13.9% | 86.6% |
| start ±150 | 20 | 248 | 579.0 s | 1362.6 s | 151 | 121 | 86.3% | 93.5% | 100.0% |
| start ±150 | 50 | 683 | 156.8 s | 600.2 s | 148 | 146 | 46.9% | 66.3% | 99.0% |
| start ±150 | 200 | 2,657 | 70.5 s | 200.1 s | 160 | 153 | 7.8% | 9.3% | 81.3% |
| +25 / 15 s | 20 | 254 | 481.7 s | 1485.5 s | 141 | 128 | 83.9% | 94.9% | 100.0% |
| +25 / 15 s | 50 | 684 | 170.8 s | 600.4 s | 151 | 144 | 62.3% | 71.8% | 99.6% |
| +25 / 15 s | 200 | 2,692 | 84.0 s | 245.5 s | 126 | 128 | 18.1% | 18.6% | 83.0% |
| +100 / 15 s | 20 | 249 | 506.0 s | 1380.0 s | 133 | 129 | 85.1% | 94.8% | 100.0% |
| +100 / 15 s | 50 | 664 | 159.9 s | 600.3 s | 168 | 145 | 59.2% | 69.7% | 97.6% |
| +100 / 15 s | 200 | 2,664 | 66.2 s | 196.2 s | 171 | 164 | 6.7% | 7.7% | 79.1% |
| cap 300 / 400 | 20 | 252 | 560.9 s | 1360.9 s | 140 | 129 | 88.9% | 93.3% | 100.0% |
| cap 300 / 400 | 50 | 676 | 164.8 s | 600.4 s | 157 | 143 | 60.7% | 71.2% | 98.2% |
| cap 300 / 400 | 200 | 2,701 | 75.3 s | 211.1 s | 148 | 149 | 11.4% | 12.3% | 83.6% |
| everyone after 3 min | 20 | 254 | 558.7 s | 1325.2 s | 148 | 129 | 88.2% | 97.2% | 99.6% |
| everyone after 3 min | 50 | 682 | 153.4 s | 600.6 s | 166 | 150 | 70.8% | 84.3% | 98.7% |
| everyone after 3 min | 200 | 2,672 | 73.1 s | 180.8 s | 165 | 159 | 33.6% | 37.1% | 79.8% |
| pods of 3 after 4 min | 20 | 252 | 551.7 s | 1303.5 s | 172 | 126 | 90.9% | 93.7% | 100.0% |
| pods of 3 after 4 min | 50 | 670 | 231.9 s | 600.4 s | 144 | 142 | 57.2% | 70.6% | 94.9% |
| pods of 3 after 4 min | 200 | 2,420 | 100.0 s | 241.0 s | 177 | 164 | 15.0% | 16.4% | 50.7% |

The window variants move 1v1 waits by a few seconds at 50 online and the match quality by a few points: a wider start (±150) cuts the median
wait at 50 online from 23 to 16 s for a rating spread of 107 instead of 84; the defaults meet the target, so **keep them**. In pods the window
hardly matters; the time before a 3-player start does: 4 minutes instead of 2 halves the 3-player share at 200 online (85% to 51%) for a
median wait of 100 s instead of 76. That is the owner's choice between waits and full pods; the design's 2 minutes stays. (The 1v1 rows
of that variant equal the defaults: 1v1 has no 3-player start.)

### Rematches and abuse reports

M15-5's real checker runs as the service runs it (`afterGame` after every game, `afterMiss` after every missed ready check, `daily` at 00:20 UTC
with the seasons closed since), over an index of the simulated history whose answers follow the memory store's; reports are counted as the
service files them, one per kind, ladder, accounts and 7-day window (`service.test.ts` checks that the same reports come out of the real
service). The default thresholds run inline; each candidate set replays the same calls in the same order. The kinds share no threshold, so a
kind's count under a set depends only on that kind's values. "From 2027-03" is the stationary period after the launch months. Runs: 1v1 1,500
accounts at a time (seed `reports`, 150 days, 126,205 games; 4.3 min inline, 11.1 min of replays), pods 1,005 (55,281 pods; 3.5 and 8.0 min).
Rematches of one of the last 3 games: 0.03% of 1v1 games and 3.05% of pods; no pair met 5 times (pods 6) within 7 days.

Candidate sets (each changes only the thresholds named):

- mild: `smurfRating` 1900, `smurfWinShare` 0.85; `sandbaggingQuitShare` 0.75; `ratingTransferGain` 200; `oneSidedGames` 6,
  `oneSidedQuickShare` 0.75
- medium: `smurfRating` 1950, `smurfWinShare` 0.9, `smurfMinGames` 20; `sandbaggingQuitShare` 0.9; `ratingTransferGain` 200,
  `ratingTransferOpponentShare` 0.75; `oneSidedGames` 6, `oneSidedQuickShare` 0.75
- strong: `smurfRating` 2000, `smurfWinShare` 0.9, `smurfMinGames` 20; `sandbaggingFall` 200, `sandbaggingQuitShare` 0.9;
  `ratingTransferGain` 250, `ratingTransferOpponentShare` 0.75; `oneSidedGames` 8, `oneSidedWinShare` 0.875, `oneSidedQuickShare` 0.75
- **recommended**: strong with medium's `ratingTransferGain` 200 and `repeatedPairingPods` 8 (its `ratingTransfer` counts are medium's,
  every other kind's strong's; `repeatedPairing` filed nothing in these two runs at 6 pods, so none at 8 either; see the small ladders below)

**Honest play**, accounts reported among the accounts that played (all; launch months; from 2027-03 on):

| thresholds | 1v1 all | 1v1 launch | 1v1 from 2027-03 | pods all | pods launch | pods from 2027-03 | meets 17.11, 1v1 / pods |
|---|--:|--:|--:|--:|--:|--:|--:|
| defaults | 259 / 2,198 | 196 / 1,734 | 72 / 1,956 (3.68%) | 157 / 1,454 | 118 / 1,149 | 51 / 1,306 (3.91%) | fail / fail |
| mild | 72 | 60 | 12 (0.61%) | 24 | 20 | 5 (0.38%) | fail / fail |
| medium | 26 | 25 | 1 (0.05%) | 6 | 6 | 1 (0.08%) | fail (1 `sandbagging`) / pass |
| strong | 13 | 13 | 0 | 2 | 1 | 1 (0.08%) | pass / pass |
| recommended | | | **0** | | | **1 (0.08%)** | **pass / pass** |

Reports from 2027-03 on by kind, reports (accounts), 1v1 \| pods:

| kind | defaults | mild | medium | strong and recommended |
|---|--:|--:|--:|--:|
| `smurf` | 47 (23) \| 19 (10) | 16 (8) \| 1 (1) | 0 \| 1 (1) | 0 \| 1 (1) |
| `sandbagging` | 62 (33) \| 63 (36) | 7 (4) \| 7 (4) | 1 (1) \| 0 | 0 \| 0 |
| `ratingTransfer` | 12 (17) \| 0 | 0 \| 0 | 0 \| 0 | 0 \| 0 |
| `oneSided` | 0 \| 7 (6) | 0 \| 0 | 0 \| 0 | 0 \| 0 |
| `repeatedPairing`, `earlyConcessions`, `parkedHigh`, `capStall`, `dodging` | 0 \| 0 | 0 \| 0 | 0 \| 0 | 0 \| 0 |

Over the whole run, launch included, the defaults report 12% (1v1) and 11% (pods) of every account, most of them `smurf` reports at the launch,
when every account is new and the strongest climb fast. With strong's thresholds the launch months report 13 of 1,734 1v1 accounts and 1 of
1,149 pod accounts: the strongest newcomers, which is what the rule looks for. In an earlier, smaller 1v1 run (1,000 accounts) the defaults also
filed 4 `oneSided` reports from 2027-03 on, and `ratingTransferGain` 200 alone (mild) 6, which is why the recommendation keeps the 0.75 share.

**Why honest play trips the defaults.**

- `smurf` fires on an honest strong newcomer: an account at most 30 days old reaching a shown rating of 1800 within 30 games, or winning 80% of
  15. A smurf is a strong player on a new account; results alone cannot tell it from an honest one, only how strong it must be.
- `sandbagging` fires on an honest losing streak: a fall of 150 within 7 days with half of its losses conceded, left or timed out, then a rise of
  100. With a third of honest losses conceded, half of a streak's losses are quits often enough, and heavy players (and pod players, who "lose"
  three seats in four and move about 25 points a pod) fall 150 in a bad week and climb back the next. The recommendation asks for 90% quits and
  a 200-point fall; a real sandbagger concedes all of them.
- `ratingTransfer` fires when one big win is half of a week's gain: a player back from a break (deviation 100-150) gains 40-80 points from one
  upset.
- `oneSided` fires on two heavy players of different skill who meet 5 times in 30 days in a small ladder: 4 of 5 to the stronger one, and with a
  third of losses conceded, half of the games "end quickly".

**The smurf rule over new accounts** (honest newcomers of skill N(1500, 130) and smurfs of skill N(2000, 60), each a new account playing 30 or
100 games a month against the opponents the matcher gave in the 2,000-account populations; the share reported within its first 30 days and 30
games; seeds `smurf-honest/<games>` and `smurf-smurf/<games>`, 20,000 honest newcomers and 2,000 smurfs per activity in 1v1, 12,000 and 1,200
in pods; with 5 or 10 games a month a newcomer is still in placement after 30 days and cannot be reported):

| `smurfRating` | won at least, of at least | | 1v1 honest, 30 / 100 a month | 1v1 smurfs | pods honest | pods smurfs |
|---|--:|--:|--:|--:|--:|--:|
| 1800 (default) | 80%, 15 (default) | | 10.10% / 9.70% | 100% / 100% | 9.65% / 8.98% | 100% / 100% |
| 1900 | 85%, 15 | mild | 3.06% / 3.03% | 96% / 96% | 2.63% / 2.57% | 100% / 99% |
| 1950 | 90%, 20 | medium | 1.40% / 1.43% | 87% / 88% | 1.20% / 1.07% | 98% / 97% |
| **2000** | **90%, 20** | **strong, recommended** | **0.56% / 0.70%** | **73% / 76%** | **0.52% / 0.47%** | **91% / 90%** |
| 2050 | 90%, 20 | | 0.32% / 0.38% | 61% / 67% | 0.20% / 0.18% | 76% / 75% |
| 2050 | 95%, 20 | | 0.20% / 0.19% | 49% / 52% | 0.20% / 0.18% | 76% / 75% |
| 2100 | 95%, 20 | | 0.08% / 0.11% | 35% / 38% | 0.05% / 0.03% | 51% / 52% |
| never | 95%, 20 | | 0.06% / 0.07% | 31% / 32% | 0.01% / 0.00% | 8% / 10% |

(The full grid of 35 settings per ladder is the script's `smurf` section.)

At the default thresholds about one active honest newcomer in ten is reported; the recommended 2000 / 90% of 20 reports about 0.5-0.7% of them
and still 73-76% (1v1) and 90% (pods) of true-2000 smurfs. A strict reading of 17.11 (under 1 in 1,000 of all accounts, newcomers included) is
met in the main runs above (0 and 1 accounts) but not reliably: with 10% of accounts new each month, about 0.1% of all accounts is reported in a
quarter, and the sensitivity run below found 2 of 1,310. Only about 2100 and 95% of 20 (0.03-0.11% of active newcomers) meets it every time,
and that rule reports a third (1v1) to a half (pods) of the smurfs. That trade is the owner's; the recommendation takes the stronger detection.

**Detection in the population.** The same runs with 20 smurfs (true skill N(2000, 60), arriving from day 60, 30 or 100 games a month) and 12
sandbaggers (established heavy players rated 1600 or more who concede every game of a week on turn 2-4, then play honestly), 1,005 (1v1) and 673
(pods) honest accounts at a time, seed `abusers` (the injected accounts' own rule):

| thresholds | smurfs as `smurf`, 1v1 / pods | sandbaggers as `sandbagging`, 1v1 / pods |
|---|--:|--:|
| defaults | 100% / 100% | 75% / 92% |
| mild | 80% / 100% | 75% / 83% |
| medium | 70% / 85% | 75% / 83% |
| strong and recommended | 60% / 70% | 75% / 83% |

The sandbaggers' concessions on turn 2 also fire `earlyConcessions` (22 reports in 1v1, 21 in pods, under every set). The smurfs a set misses
meet the leaderboard's and the badge's own defenses (S1, S2) and `parkedHigh`.

**Small ladders** (the slow suite's runs, seed `reports-test`, 120 days; the script's `small` section): a 1v1 ladder of 500 accounts (33,196
games) and a pod ladder of 450 (18,361 pods), where the same few players meet often (22% of pods repeat one of a player's last 3 pods under the
relaxation, and 7 pairs met in 6 pods within 7 days):

| thresholds | 1v1: accounts reported from 2027-03 | by kind | pods: accounts reported from 2027-03 | by kind |
|---|--:|--:|--:|--:|
| defaults | 33 / 584 | `oneSided` 12 (11), `smurf` 3 (1), `ratingTransfer` 8 (14), `sandbagging` 13 (8) | 65 / 527 | `repeatedPairing` 8 (10), `oneSided` 51 (38), `smurf` 18 (8), `sandbagging` 31 (17) |
| recommended | **0** | none | **0** | none |
| recommended with `repeatedPairingPods` 6 | 0 | none | 10 / 527 | `repeatedPairing` 8 (10) |

A small ladder is where the defaults misfire most (5.7% and 12.3% of accounts), and where pods' repeated pairing at 6 pods in 7 days reports
honest regulars: hence `repeatedPairingPods` 8 in the recommendation (in a separate run of the same functions 8, 10 and 12 all gave 0 here;
the 1v1 ladder's repeated pairing gave 0 at 5, 7 and 10 games).

**Sensitivity to the honest endings** (seed `concede`; half of all honest losses conceded instead of a third; recommended thresholds, inline):
1v1 (1,005 accounts, 83,914 games): 2 of 1,310 accounts reported from 2027-03 on, both `smurf` (8 reports); no `oneSided`, `sandbagging` or
`ratingTransfer`. Pods (673 accounts, 36,954 pods): none of 871. So the recommendation's `sandbagging` and `oneSided` thresholds hold when
concessions are more common; the miss is `smurf` (above). Earlier runs of this section with medium's `oneSided` (6 meetings) and pods' repeated
pairing at 6 filed 2 `oneSided` reports and one `repeatedPairing` report in the same pods run, which is why the recommendation takes strong's
`oneSided` (8 meetings, 7 of 8 won) and 8 pods.

### The matcher's tick with 2,000 entries

A fresh matcher holding n entries, one timed `tick` (15 repeats after a warm-up; seed `tick`; Node 22 on this machine, 4 CPUs shared with
other jobs). `queue`: shown ratings N(1500, 150), waits spread over 6 minutes, 10% in placement, 3 recent games each; most entries are
matched. `stuck`: every entry entered in the last 15 s and the ratings are spaced so that nothing may be matched (1v1 101 apart, pods 40): the
whole search runs and forms nothing.

| ladder | entries | queue: matches | median ms | max ms | stuck: median ms | max ms |
|---|--:|--:|--:|--:|--:|--:|
| 1v1 | 500 | 249 | 1.9 | 10.0 | 0.5 | 2.1 |
| 1v1 | 1,000 | 499 | 4.7 | 7.2 | 1.4 | 5.5 |
| 1v1 | 2,000 | 999 | **10.4** | 13.1 | **1.9** | 15.8 |
| pods | 500 | 124 | 31.5 | 73.7 | 27.7 | 110.7 |
| pods | 1,000 | 249 | 49.6 | 66.4 | 51.1 | 61.3 |
| pods | 2,000 | 498 | **100.3** | 138.1 | **109.7** | 162.7 |

The 1v1 tick meets 17.11's 50 ms with room. The pod tick is linear in the queue (about 0.05 ms an entry: 9.3's O(n · 220)) and takes about
twice 50 ms at 2,000 entries here; an idle desktop is faster, but probably not twice. A pod queue of 2,000 is far from what the populations above
produce (a median of 3 queued with 110 online), so this matters only at a scale the ladder is not near. The fix belongs to M15-4's
`src/match/pods.ts` and changes no result: when neither the anchor nor any candidate has waited 5 minutes, a candidate farther than the anchor's
window can be in no allowed set (any set holding it has a spread above that window), so dropping such candidates before the 220-set enumeration,
and filling the 12 × 12 pair table only for the pairs a set reaches, leaves a handful of sets an anchor in the stuck shape.

## Sweeps

The knobs of the M15-6 row, one at a time, on the design's matched opponents (seeds `sweep/<value>/...`, the smaller "sweep" sizes: S1 6,000
accounts in 1v1 and 4,000 in pods, so a bound's value moves by a few tenths of a point between tables), and the population columns from
stationary runs of 1,000 accounts. "Resting deviation" is the median shown deviation right after a game of a settled player at 10, 30 and 100
games a month; "win/loss" what a game between two such equals (pods: first and last of four) does at 30 a month; "half a +200 change" how many
games a settled player whose skill rose by 200 needs to show half of it; "provisional after" the days without a game until a settled player at 30
a month turns provisional; "error" a new player's median error after 10 and 30 games against established opponents. The shortfall column is
noisy at these sizes (about ±5: the default pull gives 16.6, 12.9 and 20.6 in three tables here against 13.9 at the report's size).

**What the sweeps say.** σ0 and `idleVolPerDay` above the defaults make S1 easier (σ0 0.07: S1 (a) 2.1%, (b) 6.3%; `idleVolPerDay` 0.08:
(b) 6.4%) and below them change little but slow a parked rating's turn to provisional (`idleVolPerDay` 0.03: 340 days). A smaller σ0
narrows the stretch of a 1,000-account population (slope 1.04 at 0.04 against 1.10) but not of larger ones (in a separate run of the same
functions with the spread section's seeds: 2,000 accounts slope 1.21 and error after 30 games 61.9, 4,000 accounts 1.39 and 71.5), so the
defaults stay. Pod τ hardly matters, since the daily drift sets a pod rating's resting deviation. The pull trades the
shortfall against the stretch (and at 20% lifts S3 to 42%). K below 2 fails S1 (a) and S2 (a) in 1v1; above 2 it orders less by skill and
favours the heaviest players more.

### σ0 (1v1)

| value | resting deviation 10/30/100 a month | win/loss at 30 a month | games to half a +200 change at 30 | provisional after (days) | error after 10/30 games | S1 a/b/c | S2 best of 5 | S3 | shortfall at 10 | bounds |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| σ0 0.04 | 95 / 73 / 58 | +15 / -15 | 16 | 83.0 | 61 / 44 | 1.0% / 3.5% / 0.6% | 4.2% / 3.6% | 12.0% | 15.4 | all pass |
| σ0 0.05 | 96 / 75 / 62 | +16 / -16 | 15 | 80.5 | 66 / 45 | 1.1% / 4.2% / 0.8% | 4.7% / 3.9% | 11.0% | 11.9 | all pass |
| σ0 0.06 (default) | 97 / 77 / 65 | +16 / -16 | 15 | 77.8 | 73 / 40 | 1.4% / 5.3% / 0.7% | 4.9% / 3.5% | 12.0% | 16.6 | all pass |
| σ0 0.07 | 98 / 80 / 69 | +17 / -17 | 12 | 74.3 | 71 / 39 | 2.1% / 6.3% / 0.9% | 5.1% / 3.1% | 11.2% | 14.7 | **2 fail** |
| σ0 0.08 | 99 / 82 / 73 | +18 / -18 | 12 | 71.0 | 72 / 53 | 3.0% / 8.2% / 0.8% | 5.7% / 3.2% | 11.7% | 15.5 | **2 fail** |

| value | population error 10/30/100 (established) | deviation at season end, 30 a month | rating SD (last season) | slope |
|---|--:|--:|--:|--:|
| σ0 0.04 | 73.5 / 51.7 / 29.5 | 75.3 | 149.2 | 1.036 |
| σ0 0.05 | 80.4 / 49.6 / 34.6 | 78.2 | 159.6 | 1.089 |
| σ0 0.06 (default) | 80.0 / 50.2 / 39.2 | 80.6 | 158.5 | 1.096 |
| σ0 0.07 | 91.2 / 58.5 / 44.9 | 83.2 | 162.5 | 1.111 |
| σ0 0.08 | 85.9 / 54.5 / 47.6 | 86.5 | 168.7 | 1.134 |

### idleVolPerDay (1v1; the pods' drift follows it, 5.2)

| value | resting deviation 10/30/100 a month | win/loss at 30 a month | games to half a +200 change at 30 | provisional after (days) | error after 10/30 games | S1 a/b/c | S2 best of 5 | S3 | shortfall at 10 | bounds |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| idleVolPerDay 0.03 | 89 / 72 / 62 | +14 / -14 | 16 | 340.5 | 58 / 40 | 0.7% / 2.6% / 0.7% | 3.1% / 3.7% | 11.8% | 17.1 | all pass |
| idleVolPerDay 0.045 | 93 / 74 / 64 | +15 / -15 | 14 | 145.6 | 82 / 47 | 1.3% / 3.7% / 0.9% | 3.8% / 3.4% | 11.8% | 9.7 | all pass |
| idleVolPerDay 0.06 (default) | 97 / 77 / 65 | +17 / -17 | 15 | 77.6 | 74 / 39 | 1.4% / 4.3% / 0.7% | 4.3% / 3.2% | 11.4% | 12.9 | all pass |
| idleVolPerDay 0.08 | 104 / 82 / 68 | +19 / -19 | 12 | 39.7 | 69 / 50 | 1.7% / 6.4% / 0.5% | 5.9% / 3.0% | 11.8% | 7.8 | **1 fail** |
| idleVolPerDay 0.1 | 111 / 87 / 71 | +21 / -21 | 9 | 22.6 | 75 / 43 | 2.7% / 10.2% / 0.7% | 7.3% / 3.9% | 11.5% | 8.6 | **3 fail** |

### Pod τ

| value | resting deviation 10/30/100 a month | win/loss at 30 a month | games to half a +200 change at 30 | provisional after (days) | error after 10/30 games | S1 a/b/c | S2 best of 5 | S3 | shortfall at 10 | bounds |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| τ 25/300 (default) | 105 / 82 / 62 | +22 / -32 | 8 | 70.9 | 52 / 41 | 0.4% / 2.9% / 0.1% | 0.7% / 0.3% | 10.7% | 5.2 | all pass |
| τ 25/200 | 106 / 82 / 62 | +22 / -32 | 8 | 70.7 | 53 / 43 | 0.6% / 2.8% / 0.0% | 0.5% / 0.2% | 10.3% | 6.4 | all pass |
| τ 25/150 | 106 / 82 / 63 | +22 / -32 | 8 | 70.1 | 47 / 42 | 0.4% / 2.8% / 0.1% | 0.7% / 0.2% | 10.2% | 5.1 | all pass |
| τ 25/100 | 106 / 83 / 66 | +23 / -33 | 8 | 68.6 | 58 / 46 | 0.5% / 3.3% / 0.0% | 0.6% / 0.1% | 10.3% | 8.1 | all pass |

| value | population error 10/30/100 (established) | deviation at season end, 30 a month | rating SD (last season) | slope |
|---|--:|--:|--:|--:|
| τ 25/300 (default) | 58.8 / 57.4 / 43.3 | 84.2 | 168.6 | 1.216 |
| τ 25/200 | 64.8 / 51.2 / 47.3 | 83.6 | 165.0 | 1.167 |
| τ 25/150 | 63.0 / 51.6 / 45.2 | 85.4 | 174.2 | 1.188 |
| τ 25/100 | 61.3 / 54.4 / 43.5 | 86.3 | 173.9 | 1.252 |

### The season pull

1v1 (Glicko-2), matched opponents (shortfall of a true-1800 player at 5/10/30/100 games a month; S3):

| pull | shortfall 5 / 10 / 30 / 100 | Prism badge at 10 | S3 exact | S3 stationary |
|---|--:|--:|--:|--:|
| 0 | 1.6 / 8.0 / 0.2 / 1.9 | 43.5% | 4.73% | 17.92% |
| 0.025 | 10.2 / 14.3 / 2.2 / 2.0 | 39.5% | 4.33% | 20.83% |
| 0.05 | 18.0 / 20.6 / 4.7 / 2.5 | 34.2% | 11.82% | 23.83% |
| 0.1 | 34.5 / 31.7 / 8.1 / 2.3 | 25.3% | 10.48% | 31.75% |
| 0.2 | 58.7 / 49.4 / 15.9 / 3.0 | 13.0% | 42.28% | 49.92% |

1v1 (Glicko-2), populations of 1,000:

| pull | error 10/30/100 (established) | rating SD by season | slope (last season) | mean rating (last season) | Prism share at 5/10/30/100 a month |
|---|--:|--:|--:|--:|--:|
| 0 | 82.0 / 57.7 / 37.3 | 191 → 179 → 172 → 167 → 167 → 168 → 167 → 169 | 1.143 | 1487.2 | 3.6% / 1.5% / 3.3% / 3.9% |
| 0.05 | 77.3 / 53.7 / 43.1 | 199 → 186 → 178 → 174 → 167 → 166 → 167 → 164 | 1.089 | 1504.5 | 4.1% / 4.4% / 3.6% / 3.4% |
| 0.1 | 77.6 / 45.7 / 31.0 | 187 → 173 → 164 → 157 → 152 → 156 → 157 → 153 | 1.042 | 1496.5 | 2.3% / 2.8% / 3.0% / 2.2% |

pods (Weng-Lin), matched opponents (shortfall of a true-1800 player at 5/10/30/100 games a month; S3):

| pull | shortfall 5 / 10 / 30 / 100 | Prism badge at 10 | S3 exact | S3 stationary |
|---|--:|--:|--:|--:|
| 0 | 8.2 / 7.1 / 1.6 / 1.4 | 44.8% | 5.22% | 16.63% |
| 0.025 | 12.7 / 9.3 / 2.0 / 1.5 | 43.5% | 6.68% | 17.63% |
| 0.05 | 15.9 / 10.8 / 2.0 / 1.2 | 39.5% | 10.50% | 19.75% |
| 0.1 | 22.0 / 14.5 / 3.2 / 1.4 | 35.0% | 19.23% | 24.75% |
| 0.2 | 35.2 / 22.2 / 5.2 / 1.6 | 25.8% | 37.13% | 37.75% |

pods (Weng-Lin), populations of 1,000:

| pull | error 10/30/100 (established) | rating SD by season | slope (last season) | mean rating (last season) | Prism share at 5/10/30/100 a month |
|---|--:|--:|--:|--:|--:|
| 0 | 67.9 / 50.5 / 44.8 | 172 → 166 → 173 → 173 → 174 → 170 → 168 → 170 | 1.211 | 1492.9 | 4.4% / 2.8% / 3.8% / 4.0% |
| 0.05 | 60.9 / 57.0 / 42.8 | 170 → 164 → 170 → 169 → 174 → 172 → 172 → 175 | 1.227 | 1496.0 | 5.5% / 2.8% / 3.0% / 2.4% |
| 0.1 | 55.7 / 57.4 / 39.7 | 174 → 166 → 171 → 172 → 168 → 169 → 168 → 164 | 1.152 | 1494.0 | 3.6% / 4.1% / 4.9% / 2.8% |

### LEADERBOARD_K

1v1 (Glicko-2), matched opponents:

| K | yardstick | S1 (a) rank | S1 (b) standing stop | S2 best of 3 / 5 / 10 board |
|---|--:|--:|--:|--:|
| 1 | 1597.0 | 3.37% | 5.72% | 6.66% / 10.86% / 20.68% |
| 1.5 | 1560.0 | 2.22% | 5.08% | 4.70% / 7.72% / 15.04% |
| 2 | 1523.0 | 1.40% | 4.75% | 2.84% / 4.68% / 9.16% |
| 2.5 | 1486.0 | 1.22% | 5.23% | 1.92% / 3.16% / 6.16% |
| 3 | 1449.0 | 1.00% | 5.87% | 1.33% / 2.20% / 4.24% |

pods (Weng-Lin), matched opponents:

| K | yardstick | S1 (a) rank | S1 (b) standing stop | S2 best of 3 / 5 / 10 board |
|---|--:|--:|--:|--:|
| 1 | 1598.0 | 0.97% | 2.33% | 1.10% / 1.83% / 3.60% |
| 1.5 | 1559.0 | 0.60% | 1.95% | 0.62% / 1.03% / 2.07% |
| 2 | 1521.0 | 0.45% | 2.05% | 0.28% / 0.47% / 0.93% |
| 2.5 | 1482.0 | 0.38% | 3.40% | 0.10% / 0.17% / 0.33% |
| 3 | 1444.0 | 0.33% | 7.17% | 0.04% / 0.07% / 0.13% |


## Assumptions and limits

- **Skills are fixed and players honest**, except the injected abusers. No player improves, tilts or switches decks; real ratings move more.
  The skill spread (SD 130) is the design's assumption: a wider real spread widens the ratings and moves every tier share.
- **How honest games end** (a third of losses conceded) is an assumption the abuse thresholds lean on; the sensitivity rows show by how much.
- **Population size matters**: the stretch, waits, rematches, repeated pairings and the cold start depend on how many play at once; each table
  gives its size. The report-rate runs use 1,000-1,500 accounts at a time (about 17-25 online in 1v1): a small, busy ladder.
- **Pods are not political** here: no kingmaking, alliances or friends (risk 3). Seats are independent Plackett-Luce draws.
- **No caps, deletions, moderators or blocks**: no game reaches a per-game cap (so `capStall` never has evidence), nobody is deleted, reset,
  unlisted or blocked, every account is listed and has its own address.
- **Matched and met opponents bracket the scenarios**: matched is the design's own, optimistic check; met takes the opponents a population gave
  but does not let the scenario accounts change that population back (they are few next to it in real play), and its stretch is that of the
  population it came from (2,000 accounts).
- **Wall times** were measured on 4 CPUs that other jobs shared, so the tick times are on the slow side of an idle desktop's; the owner can check
  the 50 ms target on the owner's machine with `--sections=tick`.

## Reproducing

```
npm ci
OPENMTG_SLOW=1 npx vitest run packages/ladder/test/sim --maxWorkers=1     # the slow suite
npx tsx packages/ladder/scripts/simulate.ts                                # every table (sections can run on their own, in parallel)
npx tsx packages/ladder/scripts/simulate.ts --sections=tick                # the tick on this machine
```

Sections: `tick`, `stationary`, `validate`, `spread`, `pullmet`, `scenarios`, `badge`, `waits`, `sweeps`, `reports`, `small` and `concede`
(the last three take `--ladders=` to split them), `smurf`; `--quick` runs smaller sizes. Their run times here, at the report's sizes with up to
five of them running at once on the 4 shared CPUs: tick 8 s, stationary 3.5 min, validate 4.9 min, spread 27 min, pullmet 1.9 min, scenarios
4.3 min, badge 20 min, waits 1.8 min, sweeps 15.6 min, reports 26 min (1v1) and 19 min (pods), small 4.6 min, concede 4.6 min, smurf 30 s
after the stationary runs. The slow suite: 40 tests in 5.1 minutes (`--maxWorkers=1`; the stationary populations 1.9 min, the honest-play
reports 1.8 min, the scenarios 56 s). Files: `packages/ladder/test/sim/` (the model, the population, the solo model, the scenarios, the
measurements, the recommendation, the slow tests) and `packages/ladder/scripts/simulate.ts`.
