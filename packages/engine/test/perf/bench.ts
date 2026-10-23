/**
 * Performance benchmark (package P1). Run from the repository root:
 *   npx tsx packages/engine/test/perf/bench.ts [soak] [real] [compile] [--games N] [--json FILE]
 * `compile` times a cold 60-card deck compile in a fresh process (module loading included, nothing cached), then a warm one: once under tsx (the
 * development loader, which transpiles and resolves each of the engine's ~340 files on load) and once from a single-file esbuild bundle of this script
 * (what a built server or client loads), when esbuild can be imported.
 * Prints latency statistics (median, p95, max in ms) and fingerprints of the played games: equal fingerprints mean identical games.
 */
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const want = (k: string) => args.includes(k) || !args.some((a) => ['soak', 'real', 'compile', '--compile-child'].includes(a));
const valueOf = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };

/** CPU time of this process since `c0` (less sensitive than wall time to other processes on a busy machine). */
function cpuSince(c0: NodeJS.CpuUsage): number {
  const d = process.cpuUsage(c0);
  return Math.round((d.user + d.system) / 1000);
}

async function compileChild(): Promise<void> {
  const t0 = performance.now();
  const engine = await import('../../src/index');
  const fixtures = await import('../fixtures');
  const { COMPILE_DECK } = await import('./decks');
  const t1 = performance.now();
  const cards = COMPILE_DECK.map(([n]) => fixtures.getCard(n));
  const defs = cards.map((c) => engine.compileCard(c));
  const t2 = performance.now();
  const again = cards.map((c) => engine.compileCard(c));
  const t3 = performance.now();
  const levels = defs.map((d) => d.automation.level).join(',');
  process.stdout.write(JSON.stringify({
    sinceProcessStartMs: Math.round(t2), // performance.now() counts from the start of the process: node, the loader, the engine's modules and the compile
    importMs: Math.round(t1 - t0), coldCompileMs: Math.round(t2 - t1), coldTotalMs: Math.round(t2 - t0), warmCompileMs: Math.round((t3 - t2) * 10) / 10,
    distinct: cards.length, cards: COMPILE_DECK.reduce((n, [, c]) => n + c, 0), same: JSON.stringify(defs) === JSON.stringify(again), levels,
  }));
}

/** The cold compile from a one-file bundle of this script (esbuild is a dependency of tsx and vitest, not of the project: skipped when absent). */
async function bundledCompile(self: string): Promise<unknown> {
  let build: (typeof import('esbuild'))['build'];
  try {
    ({ build } = await import('esbuild'));
  } catch {
    return null;
  }
  const outfile = path.join(tmpdir(), `openmtg-p1-bench-${process.pid}.mjs`);
  try {
    await build({ entryPoints: [self], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'error' });
    return JSON.parse(execFileSync(process.execPath, [outfile, '--compile-child'], { encoding: 'utf8' }));
  } finally {
    rmSync(outfile, { force: true });
  }
}

async function main(): Promise<void> {
  if (args.includes('--compile-child')) return compileChild();
  const out: Record<string, unknown> = {};
  const games = valueOf('--games');
  const { measureSoak, measureReal } = await import('./harness');
  if (want('compile')) {
    const self = fileURLToPath(import.meta.url);
    const text = execFileSync(process.execPath, [...process.execArgv, self, '--compile-child'], { encoding: 'utf8' });
    out.compile = JSON.parse(text);
    console.log('compile (tsx)', JSON.stringify(out.compile));
    const bundled = await bundledCompile(self);
    if (bundled !== null) {
      out.compileBundled = bundled;
      console.log('compile (bundled)', JSON.stringify(bundled));
    }
  }
  if (want('soak')) {
    const t0 = performance.now();
    const c0 = process.cpuUsage();
    const m = measureSoak(games ? Number(games) : undefined);
    out.soak = { wallMs: Math.round(performance.now() - t0), cpuMs: cpuSince(c0), play: m.play, all: m.all, legal: m.legal, tally: m.tally, fingerprint: m.fingerprint };
    console.log('soak', JSON.stringify(out.soak));
  }
  if (want('real')) {
    const t0 = performance.now();
    const c0 = process.cpuUsage();
    const m = measureReal();
    out.real = { wallMs: Math.round(performance.now() - t0), cpuMs: cpuSince(c0), play: m.play, legal: m.legal, actions: m.actions, winners: m.winners, fingerprint: m.fingerprint };
    console.log('real', JSON.stringify(out.real));
  }
  const file = valueOf('--json');
  if (file) writeFileSync(file, JSON.stringify(out, null, 2));
}

void main();
