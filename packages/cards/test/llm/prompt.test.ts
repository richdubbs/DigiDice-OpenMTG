/** WP26: the prompt shape of design 11.2 (cached SYSTEM prefix, per-card USER message) and the examples. */
import { describe, expect, it } from 'vitest';
import { fixtureCards } from '../../src/coverage/corpus';
import { buildExamples, CANONICAL_NAMES } from '../../src/llm/examples';
import { faceViews, splitSentences } from '../../src/llm/face-lines';
import { PROMPT_VERSION, loadSchemaText, nearestExamples, repairPrompt, systemPrompt, userPrompt } from '../../src/llm/prompt';
import { cardWork } from '../../src/llm/work';
import { defaultCompileSources } from '@openmtg/engine';
import { bareSources, fixture, synth } from './support';

describe('prompt (design 11.2)', () => {
  const ex = buildExamples(fixtureCards());
  it('five canonical examples, all fully automated cards, and a pool of verified others', () => {
    expect(ex.canonical).toHaveLength(CANONICAL_NAMES.length);
    expect(ex.pool.length).toBeGreaterThan(50);
    expect(JSON.stringify(ex.canonical)).not.toMatch(/"text"|"prov"/);
  });
  it('the SYSTEM message is stable (no per-card content) and carries the schema, glossary and examples', () => {
    const schema = loadSchemaText();
    const a = systemPrompt(schema, ex.canonical);
    expect(a).toBe(systemPrompt(schema, ex.canonical));
    expect(a).toContain(`Prompt version ${PROMPT_VERSION}`);
    expect(a).toContain('"AbilityDef"');
    expect(a).toMatch(/Ops \(EffectStep.op\): .*damage/);
    expect(a).toMatch(/Keywords .*flying/);
    expect(a).toContain('[0] "~ deals 3 damage to any target."');
  });
  it('the USER message: lines with indices, what the parser understood, the needed lines and the diagnostics', () => {
    const card = synth('bbbb-0001', 'Test Pinger', 'Creature — Goblin', 'Haste\nWhen this creature enters, it deals 1 damage to any target. Then draw a card.');
    const work = cardWork(card, bareSources())!;
    const views = faceViews(card, bareSources().parse);
    const u = userPrompt(work, views, nearestExamples(['deals 1 damage to any target'], ex.pool, 2));
    expect(u).toContain('Card: bbbb-0001');
    expect(u).toContain('[0] "Haste"');
    expect(u).toMatch(/\[1\] "When ~ enters, it deals 1 damage to any target. Then draw a card."\s+sentences: \(0\) "When ~ enters, it deals 1 damage to any target." \(1\) "Then draw a card."/);
    expect(u).toMatch(/Already understood by the parser \(do not redo\): \[\{"kind":"keyword","keyword":"haste"/);
    expect(u).toContain('Needed: lines [[1]]');
    expect(u).toMatch(/Parser diagnostics for \[1\]: /);
    expect(u).toContain('Verified examples of similar text:');
    expect(u).not.toContain('Test Pinger'); // the card is named by oracle_id; "~" stands for its name
  });
  it('the USER message carries the parser\'s own "stuck at ... expected ..." diagnostic (design 11.1 repair mode, 11.2)', () => {
    const card = fixture('Liliana of the Veil');
    const work = cardWork(card, defaultCompileSources())!;
    const u = userPrompt(work, faceViews(card, defaultCompileSources().parse), []);
    expect(u).toMatch(/Parser diagnostics for \[2\]: .*stuck at "Separate", expected: "<Dur>", /);
  });
  it('the SYSTEM glossary lists the event roles of design 3.5 (CR 603)', () => {
    const s = systemPrompt('{}', []);
    expect(s).toMatch(/Event roles .*: .*zoneChange: subject, player; .*damage: source, object, recipient/);
  });
  it('the repair message carries the gate and its diagnostic', () => {
    expect(repairPrompt('render', 'gate-mismatch: rendered "x", Oracle "y"')).toMatch(/rejected by the render check: gate-mismatch/);
  });
  it('sentences split at sentence ends outside quotes', () => {
    expect(splitSentences('Draw a card. Then discard a card.')).toEqual(['Draw a card.', 'Then discard a card.']);
    expect(splitSentences('Creatures you control have "{T}: Add {G}. Draw a card."')).toEqual(['Creatures you control have "{T}: Add {G}. Draw a card."']);
  });
});
