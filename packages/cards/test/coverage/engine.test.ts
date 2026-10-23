/**
 * WP25: the template set and the compile adapter the coverage tools run on (design 6.1, 6.9, 10.2, 10.3). The adapter uses WP18's compileCardV2 when it
 * is implemented, and otherwise the same steps in the same order (parse, degrade per face, classify with the caps of 10.4).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_TEMPLATES, ENGINE_CAPABILITIES, type AbilityDef, type OracleCard, type ParseResult } from '@openmtg/engine';
import { fixtureCards, sampleCards } from '../../src/coverage/corpus';
import { cardLintErrors, compileFromParse, createCoverageEngine } from '../../src/coverage/engine';
import { loadTemplates } from '../../src/coverage/templates';
import { fixtureRuns, fullEngine, synthetic, templateSet } from './support';

// M12F (STATUS "Wave M12" gap 9): whole-fixture work (compiling, the CLI, the smoke run) sits near Vitest's 5 s default under load: an explicit
// timeout for every test here (a test's own longer one still applies).
describe('WP25 template set (design 6.3, 6.9): every merged template file, read in path order', { timeout: 60_000 }, () => {
  it('holds every bootstrap template of WP17 and is well formed (rules cited, examples, two counter-examples, unique ids, patterns compile)', () => {
    const set = templateSet();
    const ids = new Set(set.templates.map((t) => t.id));
    for (const t of BOOTSTRAP_TEMPLATES) expect(ids.has(t.id), t.id).toBe(true);
    expect(set.files.map((f) => f.file)).toContain('bootstrap.json');
    expect(set.problems).toEqual([]);
  });
  it('reports a file that is not JSON or not an array instead of skipping it silently, and reads files in path order', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wp25-templates-'));
    mkdirSync(path.join(dir, 'effect'));
    writeFileSync(path.join(dir, 'b.json'), '{"not":"an array"}');
    writeFileSync(path.join(dir, 'a.json'), JSON.stringify(BOOTSTRAP_TEMPLATES.slice(0, 2)));
    writeFileSync(path.join(dir, 'effect', 'c.json'), '[ broken');
    const set = loadTemplates(dir);
    expect(set.files).toEqual([{ file: 'a.json', count: 2 }]);
    expect(set.problems.map((p) => p.id)).toEqual(['b.json', 'effect/c.json']);
    expect(set.templates.map((t) => t.id)).toEqual(BOOTSTRAP_TEMPLATES.slice(0, 2).map((t) => t.id));
  });
});

describe('WP25 compile adapter (design 6.1 steps 2-9)', { timeout: 60_000 }, () => {
  it('names the pipeline it measures: compileCardV2 once WP18 is merged, the announced fallback before', () => {
    fixtureRuns();
    expect(['compileCardV2', 'parse+degrade (WP18 not merged)']).toContain(fullEngine().pipeline());
  }, 60_000); // the first test of the file compiles every fixture card (fixtureRuns, cached for the others): about 5 s alone, over the 5 s default on a loaded machine
  it('CR 120.3 (Lightning Bolt): a card every node of which the engine has is full; its parse is kept for the parser metrics', () => {
    const bolt = fixtureRuns().find((r) => r.card.name === 'Lightning Bolt')!;
    expect(bolt.level).toBe('full');
    expect(bolt.parse.faces[0]!.templatesUsed).toContain('eff.damage');
    expect(bolt.def!.faces[0]!.abilities[0]!.kind).toBe('spell');
  });
  it('guard G8: removing a capability demotes exactly the cards that use it (op:damage)', () => {
    const without = createCoverageEngine({ templates: templateSet().templates, caps: new Set([...ENGINE_CAPABILITIES].filter((c) => c !== 'op:damage')) });
    const RANK = { manual: 0, partial: 1, full: 2 } as const;
    let demoted = 0;
    for (const r of fixtureRuns()) {
      const after = without.run(r.card);
      const usesDamage = r.def !== null && JSON.stringify(r.def.faces.map((f) => f.abilities)).includes('"op":"damage"');
      if (usesDamage) {
        expect(after.requiresEngine, r.card.name).toContain('op:damage');
        expect(RANK[after.level], r.card.name).toBeLessThanOrEqual(RANK[r.level]);
        if (r.level === 'full') expect(after.level, r.card.name).not.toBe('full');
        if (after.level !== r.level) demoted++;
      } else expect(after.level, r.card.name).toBe(r.level);
    }
    expect(demoted).toBeGreaterThan(0);
  }, 60_000); // compiles every fixture card twice (954 at the FAST5X batch 1 merge into main): over 5 s on a loaded machine
  it('the fallback path classifies like design 10.3: experimental templates cap at partial (10.4); forceFallback is honored', () => {
    const exp = { ...BOOTSTRAP_TEMPLATES.find((t) => t.id === 'eff.draw.you')!, status: 'experimental' as const };
    const engine = createCoverageEngine({ templates: [...BOOTSTRAP_TEMPLATES.filter((t) => t.id !== 'eff.draw.you'), exp], forceFallback: true });
    const run = engine.run(synthetic('Quiet Study', 'Sorcery', 'Draw two cards.'));
    expect(engine.pipeline()).toBe('parse+degrade (WP18 not merged)');
    expect(run.parse.faces[0]!.experimental).toEqual(['eff.draw.you']);
    expect(run.level).toBe('partial');
  });
  it('contract C1: never throws, whatever the input; an unknown mana symbol is a manual card, never a crash', () => {
    const engine = fullEngine();
    const bad = [
      synthetic('Odd Cost', 'Creature — Golem', '', { mana_cost: '{D}' }),
      { name: 'Broken', layout: 'normal' } as OracleCard,
      synthetic('Garbage', 'Instant', '}{ ::: ~~~ "unbalanced (paren'),
    ];
    for (const c of bad) {
      const r = engine.run(c);
      expect(['full', 'partial', 'manual']).toContain(r.level);
    }
    const odd = engine.run(bad[0]!);
    if (odd.def === null) expect(odd.error).toMatch(/^compileCard: /);
  });
});

describe('WP25 compile adapter: the card-level lint of design 6.1 step 8 (linked abilities, CR 607.1, 607.2a)', { timeout: 60_000 }, () => {
  // the shape found with the WP19-WP23 templates (Fiend Hunter): the enters ability exiles WITHOUT `link`, the leaves ability returns "the exiled card"
  const card = synthetic('Warden of Nets', 'Creature — Human Cleric', 'When this creature enters, you may exile another target creature.\nWhen this creature leaves the battlefield, return the exiled card to the battlefield under its owner\'s control.');
  const etb = (link?: string): AbilityDef => ({
    kind: 'triggered', text: 'When this creature enters, you may exile another target creature.', src: [0],
    trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] },
    effect: { targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'another target creature', filter: { types: ['Creature'], other: true } }], steps: [{ op: 'may', who: { ref: 'you' }, do: [{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'exile' }, ...(link ? { link } : {}) }] }] },
  }) as unknown as AbilityDef;
  const ltb = {
    kind: 'triggered', text: "When this creature leaves the battlefield, return the exiled card to the battlefield under its owner's control.", src: [1],
    trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield' }] },
    effect: { targets: [], steps: [{ op: 'move', what: { ref: 'linked', link: 'exiled' }, to: { zone: 'battlefield', controller: 'owner' } }] },
  } as unknown as AbilityDef;
  const parse = (abilities: AbilityDef[]): ParseResult => ({ parserVersion: 'test', faces: [{ abilities, ledger: [], diagnostics: [], gate: [], templatesUsed: [], experimental: [] }] });
  it('CR 607.2a: a return of "the exiled card" that no ability produces is never automated: the card is not full and the lint of the compiled card is clean', () => {
    const r = compileFromParse(card, parse([etb(), ltb]), ENGINE_CAPABILITIES, 'test');
    expect(r.def).not.toBeNull();
    expect(cardLintErrors(r.def!.faces)).toEqual([]);
    expect(r.def!.automation.level).not.toBe('full');
    const back = r.def!.faces[0]!.abilities[1]!;
    expect(JSON.stringify(back)).not.toContain('"ref":"linked"');
    // W3 integration: since WP20's review the card-wide degrade (model/degrade-card.ts) already taints the reader ("link ... is produced by no understood
    // ability"), before the card lint of this adapter would; either way the return is a manual step that names the link and CR 607.1
    expect(JSON.stringify(back)).toMatch(/(card lint \(design 6\.1 step 8\): link \\"exiled\\" is read here but no ability of this card produces it|tainted: link \\"exiled\\" is produced by no understood ability, so this reads nothing) \(CR 607\.1\)/);
    // the enters ability itself is understood and stays automated (exiling is right; only the return reads nothing)
    expect(r.def!.faces[0]!.abilities[0]!.kind).toBe('triggered');
  });
  it('CR 607.2a: with the link produced, both abilities stay automated and the card is full', () => {
    const r = compileFromParse(card, parse([etb('exiled'), ltb]), ENGINE_CAPABILITIES, 'test');
    expect(cardLintErrors(r.def!.faces)).toEqual([]);
    expect(r.def!.automation.level).toBe('full');
  });
});

describe('WP25 corpus sampling', { timeout: 60_000 }, () => {
  it('is deterministic and in oracle_id order (the order of the retention split, design 6.12)', () => {
    const all = fixtureCards();
    const ids = all.map((c) => c.oracle_id ?? c.name);
    expect([...ids].sort()).toEqual(ids);
    expect(sampleCards(all, { every: 10 }).map((c) => c.name)).toEqual(all.filter((_, i) => i % 10 === 0).map((c) => c.name));
    expect(sampleCards(all, { limit: 3, match: 'bolt' }).every((c) => c.name.toLowerCase().includes('bolt'))).toBe(true);
  });
});
