// @vitest-environment node
/**
 * Godot plan phase 2: the server's start-up announcement (src/main.ts). With `--announce-json` (or OPENMTG_ANNOUNCE_JSON=1) the first line on stdout is
 * one JSON object {port, token, url} that a shell starting the server (the Godot app) reads; the token is the table channel's per-launch token (a socket
 * without an Origin is let in with it). Without the flag the output starts with the usual "running at" line, which scripts/play.mjs reads.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', '..');
const SERVER_MAIN = path.join(ROOT, 'packages', 'server', 'src', 'main.ts');

const procs: ChildProcess[] = [];
const dirs: string[] = [];
afterAll(() => {
  for (const p of procs) if (p.exitCode === null) p.kill();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Start the server and resolve with its stdout lines once `count` lines arrived. */
function start(args: string[], env: Record<string, string> = {}, count = 2): Promise<string[]> {
  const dir = mkdtempSync(path.join(tmpdir(), 'openmtg-announce-'));
  dirs.push(dir);
  const p = spawn(process.execPath, ['--import', 'tsx', SERVER_MAIN, '--port', '0', '--api-only', ...args], {
    cwd: ROOT, env: { ...process.env, OPENMTG_ANNOUNCE_JSON: '', OPENMTG_CACHE_DIR: path.join(dir, 'scryfall'), OPENMTG_PACKS_DIR: path.join(dir, 'packs'), ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  procs.push(p);
  let out = '';
  let err = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the server did not start:\n${out}\n${err}`)), 60_000);
    p.stdout!.on('data', (b: Buffer) => {
      out += b.toString();
      const lines = out.split('\n');
      if (lines.length > count) {
        clearTimeout(timer);
        resolve(lines.slice(0, count));
      }
    });
    p.stderr!.on('data', (b: Buffer) => (err += b.toString()));
    p.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the server exited with ${code}:\n${out}\n${err}`));
    });
  });
}

/** Whether the table channel lets in a socket with no Origin and this token in its URL. */
function tableAccepts(port: number, token: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/table?token=${encodeURIComponent(token)}`);
    ws.on('open', () => {
      ws.close();
      resolve(true);
    });
    ws.on('unexpected-response', () => resolve(false));
    ws.on('error', () => resolve(false));
  });
}

describe('the start-up announcement (--announce-json)', () => {
  it('--announce-json: the first line is exactly {port, token, url}, then the usual line; the token opens the table channel', async () => {
    const [first, second] = await start(['--announce-json']);
    const a = JSON.parse(first!) as Record<string, unknown>;
    expect(Object.keys(a)).toEqual(['port', 'token', 'url']);
    expect(Number.isInteger(a['port']) && (a['port'] as number) > 0).toBe(true);
    expect(a['token']).toMatch(/^[0-9a-f]{32,}$/);
    expect(a['url']).toBe(`http://127.0.0.1:${a['port'] as number}`);
    expect(first).toBe(JSON.stringify(a)); // one compact JSON object, nothing else on the line
    expect(second).toBe(`OpenMTG by DigiDice is running at ${a['url'] as string}`);
    const status = await fetch(`${a['url'] as string}/api/status`);
    expect(status.status).toBe(200);
    expect(await tableAccepts(a['port'] as number, a['token'] as string)).toBe(true);
    expect(await tableAccepts(a['port'] as number, 'ab'.repeat(32))).toBe(false);
  }, 90_000);

  it('OPENMTG_ANNOUNCE_JSON=1 does the same', async () => {
    const [first] = await start([], { OPENMTG_ANNOUNCE_JSON: '1' }, 1);
    expect(Object.keys(JSON.parse(first!) as object)).toEqual(['port', 'token', 'url']);
  }, 90_000);

  it('without it the first line is the usual one and no token is printed', async () => {
    const [first] = await start([], {}, 1);
    expect(first).toMatch(/^OpenMTG by DigiDice is running at http:\/\/127\.0\.0\.1:\d+$/);
  }, 90_000);
});
