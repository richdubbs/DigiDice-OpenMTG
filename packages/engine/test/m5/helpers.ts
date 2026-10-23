/**
 * Shared helpers for the milestone 5 tests (`test/m5/<area>/*.test.ts`). Every work package writes its tests in its own folder and imports from here.
 *
 *  - the scenario helpers of milestones 3 and 4 (real fixture cards placed into zones, driven by real actions and answers);
 *  - the legacy-step helpers of the milestone 3 synthetic cards;
 *  - `expectNotImplemented`, which pins that a skeleton stub fails loudly and names its work package;
 *  - the source tree of the engine as data (`engineModules`), for tests about the module graph.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { RuleHookProvider } from '../../src/rules/hookpoints';
import { staticsProvider } from '../../src/statics/hooks';

export * from '../m4/helpers';
export { advanceTo, castAuto, labels, legal, life, passBoth, pool, put, reject } from '../m3/scenario';
export { activated, keyword, legacySteps, spellAbility, synth, targetCreature, targetOpponentCreature, targetPlayer } from '../m3/synthetic';

/** Absolute path of `packages/engine/src`. */
export const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');

/**
 * Run `fn` with a fake statics provider: the functions of `fake` replace those of the engine's real `staticsProvider` (WP16's), so the real call-sites
 * (legalActions, castCheck, targetOptions, the auto-payer...) consult them through rules/hookpoints.ts. Always restored: the real functions come back
 * (WP16: before, the provider was empty and the fakes were simply deleted).
 */
export function withStatics<T>(fake: Partial<Omit<RuleHookProvider, 'name'>>, fn: () => T): T {
  const target = staticsProvider as unknown as Record<string, unknown>;
  const keys = Object.keys(fake);
  const saved = new Map(keys.filter((k) => Object.hasOwn(target, k)).map((k) => [k, target[k]]));
  try {
    for (const k of keys) target[k] = (fake as Record<string, unknown>)[k];
    return fn();
  } finally {
    for (const k of keys) {
      if (saved.has(k)) target[k] = saved.get(k);
      else delete target[k];
    }
  }
}

/** `fn` throws the skeleton's "not implemented: WPn" error for exactly this work package. */
export function expectNotImplemented(fn: () => unknown, wp: string): void {
  expect(fn).toThrow(`not implemented: ${wp}`);
}

export interface ImportEdge {
  /** Module path relative to src, without extension ("rules/hookpoints"; a directory module is "keywords/hooks/index"). */
  to: string;
  /** `import type` / `export type` / every specifier inline-`type`: erased at compile time, so it cannot create a runtime cycle. */
  typeOnly: boolean;
}

export interface EngineModule {
  /** Path relative to src without extension. */
  id: string;
  /** Top-level directory ("rules", "core", ...) or "." for the files directly under src. */
  layer: string;
  imports: ImportEdge[];
}

/** Every TypeScript module under src with its relative imports resolved to other modules (imports of packages and JSON are ignored). */
export function engineModules(): EngineModule[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) files.push(p);
    }
  };
  walk(SRC_ROOT);
  const id = (p: string): string => relative(SRC_ROOT, p).replace(/\\/g, '/').replace(/\.ts$/, '');
  const known = new Set(files.map(id));
  const importRe = /^\s*(?:import|export)\s+(type\s+)?([^'"]*?)\s*from\s*['"](\.[^'"]+)['"]/gm;
  return files.map((file) => {
    const text = readFileSync(file, 'utf8');
    const imports: ImportEdge[] = [];
    for (const m of text.matchAll(importRe)) {
      const target = id(resolve(dirname(file), m[3]!));
      const to = known.has(target) ? target : known.has(`${target}/index`) ? `${target}/index` : null;
      if (!to) continue;
      const specifiers = m[2]!.trim();
      const allInlineType = !m[1] && /^\{[^}]*\}$/.test(specifiers) && specifiers.slice(1, -1).split(',').filter((x) => x.trim() !== '').every((x) => /^\s*type\s/.test(x));
      imports.push({ to, typeOnly: m[1] !== undefined || allInlineType });
    }
    const mid = id(file);
    return { id: mid, layer: mid.includes('/') ? mid.split('/')[0]! : '.', imports };
  });
}
