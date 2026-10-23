/** WP26: every gate of design 11.3 with a mock model's replies (no API call), and the overlay-only rule of 11.1. */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, compileCardDetailed, defaultCompileSources, trusted, type CompiledCardEntry } from '@openmtg/engine';
import { faceViews } from '../../src/llm/face-lines';
import { unitGain } from '../../src/llm/gain';
import { runGates, type GateEnv } from '../../src/llm/gates';
import { CRITICAL_WORDS, highRiskFlags, missingCriticalWord } from '../../src/llm/risk';
import { cardWork, manualUnits } from '../../src/llm/work';
import { bareSources, fixture, goodReply, synth } from './support';
import { CRITICAL_WORDS as ENGINE_CRITICAL } from '../../../engine/src/parser/lower/units';
import { EVENT_ROLES as ENGINE_EVENT_ROLES } from '../../../engine/src/model/lint-roles';
import { EVENT_ROLES } from '../../src/llm/event-roles';

function env(name: string, smoke?: GateEnv['smoke']): GateEnv {
  const card = fixture(name);
  const work = cardWork(card, bareSources());
  if (!work) throw new Error(`${name}: nothing manual under the bare parser`);
  return { work, sources: bareSources(), views: faceViews(card, bareSources().parse), ...(smoke ? { smoke } : {}) };
}

const bolt = (): GateEnv => env('Lightning Bolt');

describe('design 11.1: work selection (the parser-manual units only)', () => {
  it('a card the parser fully understands has no work', () => {
    expect(cardWork(fixture('Lightning Bolt'), defaultCompileSources())).toBeNull();
  });
  it('only the lines the parser left manual are requested (Serra-like keyword line stays with the parser)', () => {
    const card = synth('aaaa-0001', 'Test Pinger', 'Creature — Goblin', 'Haste\nWhen this creature enters, it deals 1 damage to any target.');
    const w = cardWork(card, bareSources())!;
    expect(w.faces).toEqual([{ face: 0, units: [expect.objectContaining({ src: [1] })] }]);
    expect(manualUnits(w.def, 0).map((u) => u.src)).toEqual([[1]]);
  });
});

describe('design 11.3: the gates, rejected at the first failing one', () => {
  it('passes a correct reply (gates 1-7, 9)', () => {
    const e = bolt();
    const g = runGates(e, goodReply(e.work));
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.def.automation.level).toBe('full'); // reviewed for the gate run; the stored entry carries its own review state
    expect(g.flags).toEqual([]);
    expect(g.requiresEngine).toEqual([]);
    expect(JSON.stringify(g.faces)).not.toMatch(/"text"|"span"|"label"|"prov"|Lightning/); // stored form: structure only, no Oracle text (11.4)
    expect(g.faces[0]!.covers).toEqual([{ line: 0, sentence: 0 }]);
  });
  it('gate 1 json: not JSON, no faces, wrong face count', () => {
    const e = bolt();
    expect(runGates(e, 'Here you go: {')).toMatchObject({ ok: false, gate: 'json' });
    expect(runGates(e, '{"abilities": []}')).toMatchObject({ ok: false, gate: 'json' });
    expect(runGates(e, '{"faces": [{"abilities": []}, {"abilities": []}]}')).toMatchObject({ ok: false, gate: 'json' });
  });
  it('gate 1 tolerates a ```json fence', () => {
    const e = bolt();
    expect(runGates(e, `\`\`\`json\n${goodReply(e.work)}\n\`\`\``).ok).toBe(true);
  });
  it('gate 2 schema: an unknown op is rejected (hallucinated ops, 11.8)', () => {
    const e = bolt();
    const g = runGates(e, goodReply(e.work, (o) => { (o.faces[0]!.abilities[0]!['effect'] as { steps: Record<string, unknown>[] }).steps[0]!['op'] = 'obliterate'; }));
    expect(g).toMatchObject({ ok: false, gate: 'schema' });
  });
  it('authority: an ability without src, or for a line the parser understood, is refused (11.1 overlay-only)', () => {
    const e = bolt();
    expect(runGates(e, goodReply(e.work, (o) => { delete o.faces[0]!.abilities[0]!['src']; }))).toMatchObject({ ok: false, gate: 'authority' });
    const card = synth('aaaa-0002', 'Test Pinger Two', 'Creature — Goblin', 'Haste\nWhen this creature enters, it deals 1 damage to any target.');
    const w = cardWork(card, bareSources())!;
    const reply = JSON.stringify({ faces: [{ abilities: [{ kind: 'keyword', keyword: 'haste', src: [0] }] }] });
    const g = runGates({ work: w, sources: bareSources(), views: faceViews(card) }, reply);
    expect(g).toMatchObject({ ok: false, gate: 'authority' });
    if (!g.ok) expect(g.message).toMatch(/never redo a line the parser understood/);
  });
  it('gate 3 lint: a target reference no TargetSpec declares', () => {
    const e = bolt();
    const g = runGates(e, goodReply(e.work, (o) => { ((o.faces[0]!.abilities[0]!['effect'] as { steps: Record<string, unknown>[] }).steps[0]!['to'] as Record<string, unknown>)['id'] = 't7'; }));
    expect(g).toMatchObject({ ok: false, gate: 'lint' });
  });
  it('hydrate: a src line outside the card is refused (the entry would be discarded)', () => {
    const e = env('Fire // Ice');
    const g = runGates(e, goodReply(e.work, (o) => { (o.faces[0]!.abilities[0]!['effect'] as { steps: Record<string, unknown>[] }).steps[0]!['sentence'] = 9; }));
    expect(g).toMatchObject({ ok: false, gate: 'hydrate' });
  });
  it('gate 5 render: valid JSON that means something else than the text (3 damage written as 4)', () => {
    const e = bolt();
    const g = runGates(e, goodReply(e.work, (o) => { (o.faces[0]!.abilities[0]!['effect'] as { steps: Record<string, unknown>[] }).steps[0]!['amount'] = 4; }));
    expect(g).toMatchObject({ ok: false, gate: 'render' });
    if (!g.ok) expect(g.message).toMatch(/gate-mismatch/);
  });
  it('gate 5 render: a dropped filter word (nonblack) is refused', () => {
    const e = env('Doom Blade');
    const g = runGates(e, goodReply(e.work, (o) => {
      const t = (o.faces[0]!.abilities[0]!['effect'] as { targets: Record<string, unknown>[] }).targets[0]!;
      t['filter'] = { types: ['Creature'] };
    }));
    expect(g).toMatchObject({ ok: false, gate: 'render' });
  });
  it('gate 6 critical words (the helper: through runGates gate 5, the exact render gate, refuses a dropped word first, so gate 6 is a second net)', () => {
    expect(missingCriticalWord('Destroy target creature unless its controller pays 2 life.', 'Destroy target creature.')).toBe('unless');
    expect(missingCriticalWord('Each other creature gets +1/+1.', 'Each other creature gets +1/+1.')).toBeNull();
    expect(missingCriticalWord('Each other creature gets +1/+1.', 'Each creature gets +1/+1.')).toBe('each other');
    expect(missingCriticalWord('Draw up to two cards.', 'Draw two cards.')).toBe('up to');
  });
  it("gate 6 uses the parser's G3 list (no drift)", () => {
    expect([...CRITICAL_WORDS].sort()).toEqual([...ENGINE_CRITICAL].sort());
  });
  it("the prompt's event-role glossary is the engine's table of design 3.5 (no drift)", () => {
    expect(EVENT_ROLES).toEqual(ENGINE_EVENT_ROLES);
  });
  it('gate 7 smoke: a failure of the executability smoke test rejects the reply', () => {
    const e = env('Lightning Bolt', () => ({ failures: [{ kind: 'EngineBug', message: 'boom' }] }));
    expect(runGates(e, goodReply(e.work))).toMatchObject({ ok: false, gate: 'smoke', message: 'EngineBug: boom' });
    const ok = env('Lightning Bolt', () => ({ failures: [] }));
    expect(runGates(ok, goodReply(ok.work)).ok).toBe(true);
  });
  it('gate 7 smoke with the real harness on a real card', async () => {
    const { smokeCard } = await import('../../src/smoke/run');
    const e = env('Giant Growth', (def) => smokeCard(def, { turnCycle: false }));
    const g = runGates(e, goodReply(e.work));
    expect(g.ok).toBe(true);
  });
  it('gate 4 capability (G8): an op this engine lacks is recorded in requiresEngine and degraded to manual, not a failure', () => {
    const e = bolt();
    const caps = new Set([...ENGINE_CAPABILITIES].filter((c) => c !== 'op:damage'));
    const g = runGates({ ...e, sources: { ...bareSources(), caps } }, goodReply(e.work));
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.requiresEngine).toContain('op:damage');
    expect(g.def.automation.level).toBe('manual');
    expect(JSON.stringify(g.def.faces[0]!.abilities)).toMatch(/needs-engine/);
  });
  it('a unit answered only "manual" is left to the parser (design 11.1 manual gate); the rest of the reply is applied', () => {
    const e = env('Fire // Ice');
    const reply = goodReply(e.work, (o) => { o.faces[1]!.abilities = [{ kind: 'manual', shape: 'spell', reason: 'test', src: [0, 1] }]; });
    const g = runGates(e, reply);
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.faces[1]).toEqual({ abilities: [], covers: [] });
    expect(g.faces[0]!.abilities.length).toBeGreaterThan(0);
  });
});

describe('design 11.1 manual gate: an overlay must gain over the parser, never make play worse', () => {
  it('a reply of bare manual abilities is rejected at gate manual (nothing is stored)', () => {
    const e = bolt();
    const g = runGates(e, JSON.stringify({ faces: [{ abilities: [{ kind: 'manual', shape: 'spell', reason: 'x', src: [0] }] }] }));
    expect(g).toMatchObject({ ok: false, gate: 'manual' });
    if (!g.ok) expect(g.message).toMatch(/every ability for the line is manual/);
  });
  it('CR 606.4: an overlay that drops the loyalty cost the parser understood is refused (Liliana of the Veil)', () => {
    const e = env('Liliana of the Veil');
    const reply = JSON.stringify({ faces: [{ abilities: e.work.faces[0]!.units.map((u) => ({ kind: 'manual', shape: 'activated', reason: 'x', src: u.src })) }] });
    const g = runGates(e, reply);
    expect(g).toMatchObject({ ok: false, gate: 'manual' });
    if (!g.ok) expect(g.message).toMatch(/drops the cost\.loyalty the parser understood/);
  });
  it('unitGain: keeping every understood part and adding steps is a gain; the same parts with as many manual nodes is not', () => {
    const parser = [{ kind: 'activated', cost: { loyalty: -6 }, effect: { steps: [{ op: 'manual', reason: 'x' }] } }];
    expect(unitGain(parser, [{ kind: 'activated', cost: { loyalty: -6 }, effect: { steps: [{ op: 'draw' }] } }])).toEqual({ gain: true });
    expect(unitGain(parser, [{ kind: 'activated', cost: { loyalty: -6 }, effect: { steps: [{ op: 'manual', reason: 'y' }] } }])).toMatchObject({ gain: false });
    expect(unitGain(parser, [{ kind: 'manual', shape: 'activated', reason: 'x' }])).toMatchObject({ gain: false });
  });
});

describe('design 11.3 gate 9: risk flags', () => {
  it('names replacement, layers, control, exchange, delayed, copy, piles, emblem', () => {
    const abilities = [{ kind: 'static', statics: [{ s: 'replace' }, { s: 'continuous', mods: [{ layer: 2 }, { layer: '1a' }] }] }, { effect: { steps: [{ op: 'copy' }, { op: 'delay' }, { op: 'exchange' }, { op: 'piles' }, { op: 'createEmblem' }] } }];
    expect(highRiskFlags(abilities)).toEqual(['highRisk:control', 'highRisk:copy', 'highRisk:delayed', 'highRisk:emblem', 'highRisk:exchange', 'highRisk:layers', 'highRisk:piles', 'highRisk:replacement']);
    expect(highRiskFlags([{ effect: { steps: [{ op: 'damage' }] } }])).toEqual([]);
  });
  it("agrees with the engine's trust policy: an autoverified entry with a high-risk node is never trusted", () => {
    const entry = (abilities: Record<string, unknown>[]): CompiledCardEntry => ({ oracleId: 'x', textHash: '0'.repeat(64), modelVersion: 1, faces: [{ abilities }], review: 'autoverified', source: 'llm', flags: [] });
    for (const a of [{ effect: { steps: [{ op: 'copy' }] } }, { statics: [{ s: 'replace' }] }, { mods: [{ layer: 2 }] }, { effect: { steps: [{ op: 'damage' }] } }]) {
      expect(trusted(entry([a]), 'autoverified', 'llm')).toBe(highRiskFlags([a]).length === 0);
    }
  });
});

describe('design 11.1 authority inside the engine: the parser wins where it understood', () => {
  it('an LLM entry for a unit the parser accepted is not applied (the parser keeps the unit)', () => {
    const card = fixture('Lightning Bolt');
    const e = bolt();
    const g = runGates(e, goodReply(e.work));
    if (!g.ok) throw new Error('setup');
    const wrong = structuredClone(g.faces);
    ((wrong[0]!.abilities[0]!['effect'] as { steps: Record<string, unknown>[] }).steps[0]!)['amount'] = 4;
    const entry: CompiledCardEntry = { oracleId: card.oracle_id!, textHash: g.report.textHash, modelVersion: 1, faces: wrong, review: 'reviewed', source: 'llm', flags: [] };
    const r = compileCardDetailed(card, { ...defaultCompileSources(), llm: new Map([[card.oracle_id!, entry]]), trust: 'reviewed' });
    expect(r.report.faces[0]!.overlaid).toEqual([]);
    expect(r.report.notApplied.map((n) => n.src)).toEqual([[0]]);
    expect(r.def.automation.source).not.toBe('llm-cache');
    expect(JSON.stringify(r.def.faces[0]!.abilities[0])).toMatch(/"amount":3/);
    // the same, with an entry that passes the engine's gate but is a different reading: still the parser's (a disagreement, never an overlay)
    const same = structuredClone(g.faces);
    const ok = compileCardDetailed(card, { ...defaultCompileSources(), llm: new Map([[card.oracle_id!, { ...entry, faces: same }]]), trust: 'reviewed' });
    expect(ok.report.faces[0]!.overlaid).toEqual([]);
    expect(ok.def.automation.source).not.toBe('llm-cache');
  });
});
