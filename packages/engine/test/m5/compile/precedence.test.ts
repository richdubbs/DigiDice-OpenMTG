/**
 * WP18: precedence and overlay (design 11.1, 11.5, 12.5, cards/pipeline.ts contract): per face, a pack entry whose textHash matches > the parser; trusted
 * LLM entries overlay ONLY units the parser left manual; the parser wins a disagreement. Entries are structure only (stripped, hydrated from the player's
 * own text). The matrix: source x hash x model version x review state x trust x high risk.
 */
import { describe, expect, it } from 'vitest';
import {
  ABILITY_MODEL_VERSION, ENGINE_CAPABILITIES, compileCard, defaultCompileSources, overlayFace, stripAbility, textHash,
  type AbilityDef, type CardDef, type CompileSources, type CompiledCardEntry, type LlmTrust, type ReviewState, type StoredAbility,
} from '../../../src/index';
import { abilities, card, compile, creature, kinds } from './helpers';

const TEXT = '{T}: Draw a card.\nFrobnicate the quux.';
const OID = '00000000-0000-4000-8000-0000000000aa';
// a creature: its two lines are two abilities (an instant's lines merge into one spell ability, design D25)
const theCard = creature(TEXT, { name: 'Test Draw', oracle_id: OID });
const HASH = textHash([TEXT]);

/** A parser that knows nothing: every unit it reads is manual, so an overlay may replace it. */
const blind = (over: Partial<CompileSources> = {}): Partial<CompileSources> => ({ parse: { ...defaultCompileSources().parse, templates: [] }, ...over });

/** The stored form (no text) of "{T}: Draw a card." as the template parser compiles it: what a reviewed pack or LLM entry would hold. */
const drawStored = stripAbility(compileCard(creature('{T}: Draw a card.')).faces[0]!.abilities[0]!);
/** The same for a one-line instant, "Draw a card.". */
const spellStored = stripAbility(compileCard(card('Draw a card.')).faces[0]!.abilities[0]!);
const ONE_LINE = 'Draw a card.';
const oneLine = card(ONE_LINE, { oracle_id: OID });

function entry(over: Partial<CompiledCardEntry> = {}): CompiledCardEntry {
  return { oracleId: OID, textHash: HASH, modelVersion: ABILITY_MODEL_VERSION, faces: [{ abilities: [{ ...drawStored, src: [0] }] }], review: 'reviewed', source: 'llm', flags: [], ...over };
}
const spellEntry = (over: Partial<CompiledCardEntry> = {}): CompiledCardEntry => entry({ textHash: textHash([ONE_LINE]), faces: [{ abilities: [{ ...spellStored, src: [0] }] }], ...over });
const at = (s: StoredAbility, src: number[]): StoredAbility => ({ ...s, src });

/** Levels of the face's abilities (design 10.3). */
const levels = (def: CardDef): string[] => def.automation.faces![0]!.abilities.map((a) => a.level);
const map = (e: CompiledCardEntry): Map<string, CompiledCardEntry> => new Map([[e.oracleId, e]]);

describe('the data these tests use', () => {
  it('a stored ability is structure only: no text', () => {
    expect(JSON.stringify(drawStored)).not.toContain('Draw a card');
    expect(drawStored['kind']).toBe('activated');
  });
  it('the blind parser leaves both lines manual (it reads the {T} cost, not the effect: the ability is manual by design 10.3)', () => {
    const { def } = compile(theCard, blind());
    expect(def.automation.faces![0]!.abilities.map((a) => a.level)).toEqual(['manual', 'manual']);
  });
});

describe('design 12.5: a pack entry with a matching textHash wins for the face', () => {
  it('a hand-written pack entry replaces the parser for the face (source pack, prov pack, reviewed)', () => {
    const e = entry({ source: 'hand', review: 'unreviewed', faces: [{ abilities: [at(drawStored, [0]), { kind: 'manual', shape: 'unknown', reason: 'not in the pack', src: [1] }] }] });
    const { def, report } = compile(theCard, { pack: map(e) });
    expect(report.faces[0]!.source).toBe('pack');
    expect(report.pack).toBeNull();
    expect(kinds(def)).toEqual(['activated', 'manual']);
    expect(abilities(def)[0]).toMatchObject({ text: '{T}: Draw a card.', prov: { by: 'pack', reviewed: true } });
    expect(def.automation).toMatchObject({ source: 'pack', level: 'partial', review: 'reviewed' });
  });

  it('even over a parser that understood the face (the pack is the higher source)', () => {
    const { def, report } = compile(oneLine, { pack: map(spellEntry({ source: 'hand' })) });
    expect(report.faces[0]!.source).toBe('pack');
    expect(abilities(def)[0]!.prov).toMatchObject({ by: 'pack' });
    expect(def.automation.level).toBe('full');
  });

  const cases: [string, Partial<CompiledCardEntry>, string][] = [
    ['an erratum (textHash differs)', { textHash: textHash(['{T}: Draw two cards.\nFrobnicate the quux.']) }, 'hash'],
    ['a newer model version', { modelVersion: ABILITY_MODEL_VERSION + 1 }, 'model'],
    ['another number of faces', { faces: [{ abilities: [] }, { abilities: [] }] }, 'faces'],
    ['a rejected entry', { review: 'rejected' }, 'trust'],
    ['unreviewed LLM data in a pack', { review: 'unreviewed', source: 'llm' }, 'trust'],
    ['autoverified LLM data with a highRisk flag', { review: 'autoverified', flags: ['highRisk:replacement'] }, 'trust'],
  ];
  it.each(cases)('is not used for %s: the parser drives the face and the report says why', (_name, over, why) => {
    const { def, report } = compile(theCard, blind({ pack: map(entry(over)) }));
    expect(report.pack).toBe(why);
    expect(report.faces[0]!.source).toBe('parser');
    expect(levels(def)).toEqual(['manual', 'manual']);
    if (why === 'model') expect(def.automation.requiresEngine).toContain(`model:${ABILITY_MODEL_VERSION + 1}`);
  });

  it('an entry whose stored ability points outside the player\'s lines is refused at hydration (never half-applied)', () => {
    const { def, report } = compile(theCard, blind({ pack: map(entry({ source: 'hand', faces: [{ abilities: [at(drawStored, [7])] }] })) }));
    expect(report.pack).toBe('hydrate');
    expect(levels(def)).toEqual(['manual', 'manual']);
  });

  it('autoverified LLM data in a pack (no high risk) drives play but caps the card at partial (design 10.4)', () => {
    const { def } = compile(oneLine, blind({ pack: map(spellEntry({ review: 'autoverified' })) }));
    expect(abilities(def)[0]).toMatchObject({ kind: 'spell' });
    expect(def.automation.level).toBe('partial');
  });

  it('a pack face that lists `covers` overlays like LLM data: only the parser\'s manual units', () => {
    const e = entry({ source: 'hand', faces: [{ abilities: [at(drawStored, [0])], covers: [{ line: 0, sentence: 0 }] }] });
    const { def, report } = compile(theCard, blind({ pack: map(e) }));
    expect(report.faces[0]).toMatchObject({ source: 'parser', overlaid: [0] });
    expect(kinds(def)).toEqual(['activated', 'manual']);
    expect(def.automation.source).toBe('pack');
  });
});

describe('design 11.1, 11.5: trusted LLM entries overlay only the units the parser left manual', () => {
  const matrix: [ReviewState, LlmTrust, boolean, 'full' | 'partial' | null][] = [
    ['reviewed', 'off', false, null],
    ['reviewed', 'reviewed', true, 'full'],
    ['reviewed', 'autoverified', true, 'full'],
    ['autoverified', 'off', false, null],
    ['autoverified', 'reviewed', false, null],
    ['autoverified', 'autoverified', true, 'partial'],
    ['unreviewed', 'autoverified', false, null],
    ['rejected', 'autoverified', false, null],
  ];
  it.each(matrix)('review %s under trust %s: used %s', (review, trust, used, level) => {
    const { def, report } = compile(oneLine, blind({ llm: map(spellEntry({ review })), trust }));
    expect(abilities(def)[0]!.kind).toBe(used ? 'spell' : 'manual');
    if (used) {
      expect(report.faces[0]!.overlaid).toEqual([0]);
      expect(def.automation.level).toBe(level);
      expect(def.automation.source).toBe('llm-cache');
      expect(abilities(def)[0]!.prov).toMatchObject({ by: 'llm', ...(review === 'reviewed' ? { reviewed: true } : {}) });
    } else {
      expect(report.llm).toBe('trust');
      expect(def.automation.level).toBe('manual');
    }
  });

  it('autoverified data with a highRisk flag is never used without review', () => {
    const e = spellEntry({ review: 'autoverified', flags: ['highRisk:copy'] });
    expect(compile(oneLine, blind({ llm: map(e), trust: 'autoverified' })).report.llm).toBe('trust');
  });

  it('an overlay replaces only its own unit; the other manual line stays manual', () => {
    const { def } = compile(theCard, blind({ llm: map(entry()), trust: 'reviewed' }));
    expect(kinds(def)).toEqual(['activated', 'manual']);
    expect(def.automation.level).toBe('partial');
  });

  it('`covers` limits an overlay to the listed lines', () => {
    const e = entry({ faces: [{ abilities: [at(drawStored, [0])], covers: [{ line: 1, sentence: 0 }] }] });
    expect(levels(compile(theCard, blind({ llm: map(e), trust: 'reviewed' })).def)).toEqual(['manual', 'manual']);
  });

  it('an erratum discards the entry (textHash), whatever the trust', () => {
    const e = entry({ textHash: textHash(['{T}: Draw two cards.\nFrobnicate the quux.']) });
    const { def, report } = compile(theCard, blind({ llm: map(e), trust: 'autoverified' }));
    expect(report.llm).toBe('hash');
    expect(levels(def)).toEqual(['manual', 'manual']);
  });

  it('an LLM ability that does not mean its line fails the exact render gate and stays manual (design 6.8 G6)', () => {
    const wrong = stripAbility(compileCard(creature('{T}: Draw two cards.')).faces[0]!.abilities[0]!);
    const { def } = compile(theCard, blind({ llm: map(entry({ faces: [{ abilities: [at(wrong, [0])] }] })), trust: 'reviewed' }));
    expect(abilities(def)[0]).toMatchObject({ kind: 'manual' });
    expect((abilities(def)[0] as { reason: string }).reason).toMatch(/gate-mismatch/);
    expect(def.automation.level).toBe('manual');
  });

  it('a unit the parser accepted is never replaced, even by trusted data (the default templates read "{T}: Draw a card.")', () => {
    const { def, report } = compile(theCard, { llm: map(entry()), trust: 'reviewed' });
    expect(abilities(def)[0]!.prov).toMatchObject({ by: 'template' });
    expect(report.faces[0]!.overlaid).toEqual([]);
    expect(report.disagreements).toEqual([]); // the same canonical JSON: no disagreement
  });
});

describe('overlayFace (design 11.1 authority rule) on synthetic units', () => {
  const draw = (n: number, src: number[]): AbilityDef => ({ kind: 'spell', text: 'x', src, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: n }] } });
  const manual = (src: number[]): AbilityDef => ({ kind: 'manual', text: 'x', src, reason: 'no template', shape: 'spell' });

  it('replaces a manual unit in place, keeps the order of the face', () => {
    const r = overlayFace([draw(1, [0]), manual([1]), draw(1, [2])], [draw(3, [1])], ENGINE_CAPABILITIES);
    expect(r.abilities.map((a) => a.src)).toEqual([[0], [1], [2]]);
    expect(r.abilities[1]).toMatchObject({ kind: 'spell' });
    expect(r.overlaid).toEqual([1]);
  });

  it('the parser wins a disagreement and it is reported (the entry deserves templates:disagree)', () => {
    const r = overlayFace([draw(1, [0])], [draw(2, [0])], ENGINE_CAPABILITIES);
    expect(r.abilities[0]).toEqual(draw(1, [0]));
    expect(r.disagreements).toEqual([[0]]);
    expect(overlayFace([draw(1, [0])], [{ ...draw(1, [0]), text: 'other words', prov: { by: 'llm' } }], ENGINE_CAPABILITIES).disagreements).toEqual([]);
  });

  it('a unit with an automated part is not overlaid (only units the parser left manual)', () => {
    const keyword: AbilityDef = { kind: 'keyword', keyword: 'flying', text: 'Flying', src: [0] };
    const r = overlayFace([keyword, manual([0])], [draw(1, [0])], ENGINE_CAPABILITIES);
    expect(r.abilities).toEqual([keyword, manual([0])]);
  });

  it('an overlay ability without src, or for a line the face does not have, is ignored', () => {
    const noSrc = { ...draw(1, [0]) } as AbilityDef;
    delete noSrc.src;
    const r = overlayFace([manual([0])], [noSrc, draw(1, [5])], ENGINE_CAPABILITIES);
    expect(r.abilities).toEqual([manual([0])]);
  });
});
