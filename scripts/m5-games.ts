/**
 * Milestone 5 verification games and spot-check sample (M5Z review: the W3b verification in STATUS.md must be reproducible, and milestone 6's gates re-run
 * the same check).
 *
 *   npx tsx scripts/m5-games.ts [--seed S] [--games N] [--actions N] [--every N] [--spot N] [--json FILE]
 *
 * 1. Compiles the local Oracle index with the game path (`compileCard`, the default compiler a decklist uses). `--every N` keeps every N-th card in
 *    `oracle_id` order (a faster, still deterministic sample; default 1 = the whole index, about 100 s).
 * 2. Deck candidates: `full` cards of layout `normal`, legal in at least one format, that are not lands, with a mana cost without {X} of mana value 1-5
 *    and at most two colors.
 * 3. Plays `--games` two-player games (default 10) of at most `--actions` actions (default 400). For each game a seeded RNG picks two colors per player and
 *    36 spells (up to two copies each) of those colors, plus 24 basic lands; the milestone 3 random bot (test/m3/bot.ts) plays both sides. Counted:
 *    exceptions thrown by `applyAction`, rejected actions (the bot only plays what `legalActions` lists, so any rejection is an engine bug), `manualResolve`
 *    prompts (a full card must never ask to be resolved by hand, design 10.3) with their card and prompt, and whether `replay` of the action log
 *    reproduces the final state exactly (determinism).
 * 4. Spot-check sample: `--spot` (default 40) full cards drawn with the seed from ALL full cards, printed with their Oracle text and the rendered text of
 *    their abilities, for a human to compare.
 *
 * Exit code 1 when any exception, rejection, manual prompt or replay mismatch happened. Everything is a function of the seed and the index: two runs on
 * the same index print the same numbers. Input: <repo>/.cache/scryfall (override with OPENMTG_CACHE_DIR). No network, no clock in the results.
 */
import { writeFileSync } from 'node:fs';
import { CardDatabase } from '../packages/cards/src/database';
import { byOracleId } from '../packages/cards/src/coverage/corpus';
import {
  applyAction, compileCard, createGame, randomInt, renderAbility, replay, seedRng, type Action, type CardDef, type GameConfig, type GameState, type OracleCard,
  type RngState,
} from '../packages/engine/src/index';
import { Bot } from '../packages/engine/test/m3/bot';

interface Options { seed: string; games: number; actions: number; every: number; spot: number; json?: string }

function options(argv: string[]): Options {
  const o: Options = { seed: 'm5z', games: 10, actions: 400, every: 1, spot: 40 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    switch (argv[i]) {
      case '--seed': o.seed = String(v); i++; break;
      case '--games': o.games = Number(v); i++; break;
      case '--actions': o.actions = Number(v); i++; break;
      case '--every': o.every = Math.max(1, Number(v)); i++; break;
      case '--spot': o.spot = Number(v); i++; break;
      case '--json': o.json = String(v); i++; break;
      default: throw new Error(`unknown option ${argv[i]}`);
    }
  }
  return o;
}

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
const BASIC: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

interface Candidate { card: OracleCard; def: CardDef }

/** Legal in at least one format (when the index carries legalities): keeps out un-cards, tokens and other out-of-game objects. */
function legalSomewhere(c: OracleCard): boolean {
  const l = (c as { legalities?: Record<string, string> }).legalities;
  return l === undefined || Object.values(l).some((v) => v === 'legal');
}

function isCandidate(c: OracleCard, def: CardDef): boolean {
  if (def.automation.level !== 'full' || c.layout !== 'normal' || !legalSomewhere(c)) return false;
  if (/\bLand\b/.test(c.type_line ?? '') || !c.mana_cost || /\{X\}/.test(c.mana_cost)) return false;
  const mv = c.cmc ?? 0;
  return mv >= 1 && mv <= 5 && (c.colors ?? []).length <= 2;
}

/** `n` distinct items of `xs` chosen with `rng` (Fisher-Yates prefix). */
function sample<T>(rng: RngState, xs: readonly T[], n: number): T[] {
  const a = [...xs];
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i++) {
    const j = i + randomInt(rng, a.length - i);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, k);
}

function buildDeck(rng: RngState, pool: readonly Candidate[]): { deck: string[]; colors: string[]; defs: CardDef[] } {
  const colors = sample(rng, COLORS, 2);
  const fits = pool.filter((p) => (p.card.colors ?? []).every((c) => colors.includes(c as (typeof COLORS)[number])));
  const picks = sample(rng, fits, 18);
  const deck: string[] = [];
  for (const p of picks) deck.push(p.def.id, p.def.id);
  while (deck.length < 36 && picks.length > 0) deck.push(picks[randomInt(rng, picks.length)]!.def.id);
  for (let i = 0; i < 24; i++) deck.push(BASIC[colors[i % 2]!]!);
  return { deck, colors, defs: picks.map((p) => p.def) };
}

interface GameReport { game: number; colors: string[][]; actions: number; ended: boolean; exception?: string; rejected?: string; manual: { card: string; prompt: string }[]; replayExact: boolean }

function playGame(index: number, config: GameConfig, colors: string[][], maxActions: number): GameReport {
  const bot = new Bot(`${config.seed}:bot`);
  const report: GameReport = { game: index, colors, actions: 0, ended: false, manual: [], replayExact: false };
  let s: GameState = createGame(config);
  const actions: Action[] = [];
  for (let i = 0; i < maxActions && !s.result && s.pending; i++) {
    if (s.pending.kind === 'manualResolve') report.manual.push({ card: s.pending.sourceName, prompt: s.pending.text });
    let action: Action;
    try {
      action = bot.next(s);
      const r = applyAction(s, action);
      if (r.error) {
        report.rejected = `${JSON.stringify(action)}: ${r.error.message} (${r.error.rules.join(', ')})`;
        break;
      }
      s = r.state;
    } catch (e) {
      report.exception = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
      break;
    }
    actions.push(action);
  }
  report.actions = actions.length;
  report.ended = s.result !== null && s.result !== undefined;
  try {
    const again = replay(config, actions);
    report.replayExact = again.errors.length === 0 && JSON.stringify(again.state) === JSON.stringify(s);
  } catch {
    report.replayExact = false;
  }
  return report;
}

async function main(): Promise<number> {
  const o = options(process.argv.slice(2));
  const db = await CardDatabase.open();
  const all = [...db.cards()].sort(byOracleId).filter((_, i) => i % o.every === 0);
  const basics = new Map<string, CardDef>();
  const full: Candidate[] = [];
  const pool: Candidate[] = [];
  let compiled = 0;
  for (const card of all) {
    let def: CardDef;
    try {
      def = compileCard(card);
    } catch {
      continue; // the compile pipeline never throws (C1); a throw is reported by the coverage tool, not here
    }
    compiled++;
    if (def.automation.level === 'full') full.push({ card, def });
    if (isCandidate(card, def)) pool.push({ card, def });
  }
  for (const card of [...db.cards()]) if (Object.values(BASIC).includes(card.name) && !basics.has(card.name)) basics.set(card.name, compileCard(card));
  console.log(`index: ${all.length} cards (every ${o.every}), compiled ${compiled}, full ${full.length}, deck candidates ${pool.length}`);

  const reports: GameReport[] = [];
  for (let g = 0; g < o.games; g++) {
    const rng = seedRng(`${o.seed}:deck:${g}`);
    const a = buildDeck(rng, pool);
    const b = buildDeck(rng, pool);
    const defs = [...new Map([...a.defs, ...b.defs, ...basics.values()].map((d) => [d.id, d])).values()];
    const config: GameConfig = {
      seed: `${o.seed}:game:${g}`,
      players: [{ name: 'Alice', deck: a.deck, stops: { fullControl: true } }, { name: 'Bob', deck: b.deck, stops: { fullControl: true } }],
      defs,
    };
    const r = playGame(g, config, [a.colors, b.colors], o.actions);
    reports.push(r);
    console.log(`game ${g} (${a.colors.join('')} vs ${b.colors.join('')}): ${r.actions} actions, ${r.ended ? 'ended' : 'not ended'}, replay ${r.replayExact ? 'exact' : 'MISMATCH'}`
      + `${r.exception ? `, EXCEPTION ${r.exception.split('\n')[0]}` : ''}${r.rejected ? `, REJECTED ${r.rejected}` : ''}${r.manual.length ? `, ${r.manual.length} manual prompts` : ''}`);
    for (const m of r.manual) console.log(`  manual prompt: ${m.card}: ${m.prompt}`);
  }
  const sum = (f: (r: GameReport) => number): number => reports.reduce((n, r) => n + f(r), 0);
  console.log(`games: ${reports.length}, actions ${sum((r) => r.actions)}, exceptions ${sum((r) => (r.exception ? 1 : 0))}, rejected ${sum((r) => (r.rejected ? 1 : 0))}, `
    + `manualResolve prompts ${sum((r) => r.manual.length)}, replay exact ${sum((r) => (r.replayExact ? 1 : 0))} of ${reports.length}`);

  const spot = sample(seedRng(`${o.seed}:spot`), full, o.spot).sort((x, y) => (x.card.name < y.card.name ? -1 : 1));
  console.log(`\nspot-check sample: ${spot.length} full cards (seed ${o.seed}:spot)`);
  for (const { card, def } of spot) {
    console.log(`\n== ${card.name} (${card.type_line})\n   oracle:   ${(card.oracle_text ?? '').replace(/\n/g, '\n             ')}`);
    for (const f of def.faces) {
      for (const ab of f.abilities) {
        const lines = renderAbility(ab, { selfNames: [f.name], selfTypes: [...f.types, ...f.subtypes] });
        console.log(`   rendered: ${lines.join(' | ')}`);
      }
    }
  }
  if (o.json) writeFileSync(o.json, `${JSON.stringify({ seed: o.seed, every: o.every, games: reports, spot: spot.map((x) => x.card.name) }, null, 2)}\n`);
  const bad = sum((r) => (r.exception ? 1 : 0) + (r.rejected ? 1 : 0) + r.manual.length + (r.replayExact ? 0 : 1));
  return bad > 0 ? 1 : 0;
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 2; });
