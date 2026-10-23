/**
 * RPL-0: the replay contracts run in the browser (replays design 4, D9): the new engine files import no Node module and use no Node global, and the
 * engine entry exports them. Node's zlib stays out of the engine (gzip.ts uses the web platform's CompressionStream).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as engine from '../../src/index';

const src = fileURLToPath(new URL('../../src/', import.meta.url));
const files = [
  'core/digest.ts', 'core/view-events.ts', 'core/view-patch.ts', 'core/view.ts', 'core/action-shape.ts', 'util/json-bounds.ts', 'util/shown-text.ts', 'rng.ts',
  ...readdirSync(join(src, 'replay')).map((f) => `replay/${f}`),
];

describe('RPL-0: the replay contracts are browser-safe', () => {
  it('import nothing from Node and use no Node global', () => {
    expect(files).toContain('replay/gzip.ts');
    for (const f of files) {
      const text = readFileSync(join(src, f), 'utf8');
      const imports = [...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/gms)].map((m) => m[1]!);
      for (const from of imports) expect(from.startsWith('.'), `${f} imports ${from}`).toBe(true);
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // the code, without its comments
      expect(code, f).not.toMatch(/\brequire\(|['"]node:|\bprocess\.|\bBuffer\b|\bzlib\b/);
    }
  });

  it('the engine entry exports the contracts', () => {
    for (const name of [
      'openView', 'ENGINE_VIEW_SCHEMA', 'eventsFor', 'UNSEEN_ID', 'gameDigest', 'checkpointDue', 'diffViews', 'applyViewPatch', 'checkReplay',
      'checkBugReport', 'readReplayFile', 'writeGzippedJson', 'upgradeReplay', 'checkpointsOf', 'cyrb128', 'startReplay', 'replayAction', 'actionShapeProblem',
      'checkRecordingView', 'recordingFrameView', 'PATCH_MAX_WORK', 'RECORDING_MAX_PATCH_RUN', 'replayedEventsFor', 'cleanText', 'hasControl',
    ]) expect(typeof (engine as Record<string, unknown>)[name], name).not.toBe('undefined');
  });
});
