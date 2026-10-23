// @vitest-environment node
/**
 * RPL-3: the online replay modules run in the browser: they import nothing from Node or from packages/net (Node only), use no Node global, and take from
 * the local server's package only its browser-safe contract (`@openmtg/server/online`, api.ts: types and plain constants).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FILES = ['recording.ts', 'hostReplay.ts', 'replays.ts', 'OnlineLink.ts', 'OnlineGamePanel.tsx', 'setup.tsx'];

describe('RPL-3: the online replay modules are browser-safe', () => {
  it('import nothing from Node or packages/net, and use no Node global', () => {
    for (const f of FILES) {
      const text = readFileSync(new URL(`../../src/online/${f}`, import.meta.url), 'utf8');
      const imports = [...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/gms)].map((m) => m[1]!);
      for (const from of imports) {
        expect(from.startsWith('node:') || from === '@openmtg/net' || from === '@openmtg/server', `${f} imports ${from}`).toBe(false);
      }
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/\brequire\(|['"]node:|\bprocess\.|\bBuffer\b|\bzlib\b/);
    }
  });
});
