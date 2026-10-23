/**
 * W3b (W3 gap 1): the game's default compiler parses with the engine's static import of the template files (packages/engine/src/parser/template-set.ts),
 * the coverage tools read the same files from disk (src/coverage/templates.ts#loadTemplates). They must be the same set in the same order, so the coverage
 * command measures what a decklist card gets: a template file added, removed or reordered without the import module fails here.
 */
import { describe, expect, it } from 'vitest';
import { TEMPLATE_FILES, TEMPLATE_SET, defaultCompileSources } from '@openmtg/engine';
import { createCoverageEngine, GAME_PIPELINE } from '../../src/coverage/engine';
import { templateSet } from './support';

describe('W3b: the default compiler\'s template set is every template file, in path order', () => {
  it('parser/template-set.ts imports every file under parser/templates, in the order loadTemplates reads them', () => {
    const disk = templateSet();
    expect(disk.problems).toEqual([]);
    expect(TEMPLATE_FILES.map((f) => [f.file, f.templates.length])).toEqual(disk.files.map((f) => [f.file, f.count]));
    expect(TEMPLATE_SET.map((t) => t.id)).toEqual(disk.templates.map((t) => t.id));
    expect(JSON.stringify(TEMPLATE_SET)).toBe(JSON.stringify(disk.templates));
  });
  it('the default compile sources parse with it, and the coverage engine without --templates is the game path', () => {
    expect(defaultCompileSources().parse.templates.map((t) => t.id)).toEqual(TEMPLATE_SET.map((t) => t.id));
    const e = createCoverageEngine();
    expect(e.pipeline()).toBe(GAME_PIPELINE);
    expect(e.parseOptions.templates.map((t) => t.id)).toEqual(TEMPLATE_SET.map((t) => t.id));
  });
});
