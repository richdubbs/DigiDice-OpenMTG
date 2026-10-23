/** RPL-4 test helpers: a recorded local game played by the AI, a fixed report environment, and the fixture report of the script's tests. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { BugReportFile } from '@openmtg/engine';
import { LocalConnection } from '../../src/connection/LocalConnection';
import { bugReport, type ReportEnvironment } from '../../src/bugs/report';
import { GameRecorder } from '../../src/replays/recorder';
import { duel, playUntil, settle, testClock, testEnv } from '../replays/helpers';

/** A report environment that does not depend on the page (the browser, the settings and one caught error, all fixed). */
export const FIXED_ENV: ReportEnvironment = {
  app: { version: '0.0.0-test', commit: 'testcommit' },
  browser: { userAgent: 'TestBrowser/1.0', language: 'en-GB', screen: 'window 1280x720, screen 1920x1080, 1x' },
  settings: { animationSpeed: 'normal', reducedMotion: false, tableLayout: 'shared', sound: true, ownTurnStops: 'main1 declareBlockers main2' },
  errors: [{ message: '[GameScreen] concede rejected Error: test', stack: 'Error: test\n    at concede (GameScreen.tsx:1:1)', time: '2026-10-22T12:00:05.000Z' }],
};

/** A hot-seat duel recorded as it is played (RPL-1's recorder), the AI making `moves` actions, one second apart. */
export async function recordedDuel(seed: string, moves: number, startingLife = 6) {
  const clock = testClock();
  const env = testEnv({ now: clock.now });
  const conn = new LocalConnection(duel(seed, startingLife));
  const recorder = GameRecorder.start(conn, { format: 'casual' }, env);
  await playUntil(conn, () => conn.session.actions.length >= moves, 3000, () => clock.advance(1000));
  await settle();
  return { conn, recorder, env, clock };
}

/** Where the script's fixture report is kept (a report of a hot-seat duel, made mid-game). */
export const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'duel.openmtg-bug-report');

/** The words and card of the fixture report. */
export const FIXTURE_WORDS = 'Test Shock was cast at Bob, but his life did not go down.\nI expected 2 damage.';
export const FIXTURE_CARD = 'Test Shock';
/** How many actions the fixture's game had when the report was made. */
export const FIXTURE_ACTIONS = 30;

/** Make the fixture report (only when it is to be written again: `OPENMTG_WRITE_BUG_FIXTURE=1`, see bug-script.test.ts). */
export async function makeFixtureReport(): Promise<BugReportFile> {
  const { recorder } = await recordedDuel('rpl4-fixture', FIXTURE_ACTIONS);
  const replay = recorder.live.soFar!();
  const made = bugReport({ replay, at: replay.play!.actions.length - 1, holds: 'game' }, { words: FIXTURE_WORDS, card: FIXTURE_CARD }, FIXED_ENV);
  if (!made.ok) throw new Error(made.error.message);
  return made.value;
}

/** The fixture report as stored (gzipped JSON). */
export function fixtureBytes(): Uint8Array {
  return new Uint8Array(readFileSync(FIXTURE_PATH));
}

/** The fixture report, parsed (a fresh copy, to change). */
export function fixtureReport(): BugReportFile {
  return JSON.parse(gunzipSync(readFileSync(FIXTURE_PATH)).toString('utf8')) as BugReportFile;
}
