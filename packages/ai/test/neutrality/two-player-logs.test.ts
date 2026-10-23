/**
 * Two-player neutrality of the AI (docs/design/m12-multiplayer.md D16, D17, section 9): AI-against-AI two-player games from a fixed set of seeds play the
 * same action logs, byte for byte, as on the base the golden file was recorded on. Milestone 12's engine, cards and AI packages (M12-1, M12-2, M12-3,
 * M12-6) must leave every two-player game exactly as it was; this test is that gate for the AI's games (the M3 soak, with OPENMTG_SLOW=1, is the gate for
 * the random bot's; test/m5/run/replay.test.ts and test/m1/replay.test.ts for recorded logs).
 *
 * The golden file (two-player-logs.golden.json) holds, per game, the number of actions, the SHA-256 of the JSON action log, the turn count and the result.
 * It is recorded on a base, never on the branch under test: a package that intends to change two-player play (none in milestone 12) records it again with
 * OPENMTG_RECORD_AI_LOGS=1 in its own commit, saying why. OPENMTG_AI_LOGS_DIR=<dir> also writes each full log there, to diff a divergence.
 *
 * Slow suite (whole games): run with OPENMTG_SLOW=1 (npm run test:all does).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it } from 'vitest';
import { commanderOptions, type GameConfig } from '@openmtg/engine';
import { compiledDefs } from '../../../engine/test/fixtures';
import { describeSlow } from '../../../engine/test/slow';
import { DECKS, gameConfig, RG_STOMPY, WB_REMOVAL } from '../decks';
import { aiAgent, playGame } from '../harness';

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'two-player-logs.golden.json');

interface GameRecord { seed: string; actions: number; sha256: string; turns: number; winner: string | null }

/** Six normal games over the three deck pairings and two two-player Commander games (CR 903; M11's rules, 40 life, the 21-damage rule). */
function configs(): { seed: string; config: GameConfig }[] {
  const out: { seed: string; config: GameConfig }[] = [];
  for (let i = 0; i < 6; i++) {
    const seed = `m12-neutral-ai-${i}`;
    out.push({ seed, config: gameConfig(seed, DECKS[i % 3]!, DECKS[(i + 1) % 3]!) });
  }
  for (let i = 0; i < 2; i++) {
    const seed = `m12-neutral-ai-commander-${i}`;
    const base = gameConfig(seed, WB_REMOVAL, RG_STOMPY);
    const commanders = ['Isamaru, Hound of Konda', 'Kitchen Finks'];
    const defs = [...(base.defs as ReturnType<typeof compiledDefs>), ...compiledDefs(commanders)];
    out.push({
      seed,
      config: {
        ...base, defs,
        players: base.players.map((p, j) => ({ ...p, commanders: [commanders[j]!] })),
        options: { ...base.options, commander: commanderOptions('commander') },
      },
    });
  }
  return out;
}

describeSlow('M12 two-player neutrality: AI-against-AI action logs are byte-identical to the base (m12 design D16)', () => {
  const records: GameRecord[] = [];
  beforeAll(() => {
    const dir = process.env['OPENMTG_AI_LOGS_DIR'];
    for (const { seed, config } of configs()) {
      const g = playGame(config, { p1: aiAgent(`${seed}-one`), p2: aiAgent(`${seed}-two`) });
      const json = JSON.stringify(g.actions);
      if (dir) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${seed}.json`), json);
      }
      records.push({ seed, actions: g.actions.length, sha256: createHash('sha256').update(json).digest('hex'), turns: g.state.turn.number, winner: g.state.result?.winner ?? null });
    }
    if (process.env['OPENMTG_RECORD_AI_LOGS'] === '1') writeFileSync(GOLDEN, `${JSON.stringify(records, null, 2)}\n`);
  }, 600_000);

  it('every game plays the recorded action log', () => {
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as GameRecord[];
    console.log(`M12 AI logs: ${records.length} games, ${records.reduce((n, r) => n + r.actions, 0)} actions`);
    expect(records).toEqual(golden);
  });
});
