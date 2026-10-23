/**
 * p2-modal-2 (lane p2-modal): the round's parser, model and renderer changes (no template file):
 *   - "Choose one at random --" (lower/ability.ts#modalHeader, `ModeSpec.random`, render/program.ts), never in a reflexive trigger's header;
 *   - "Choose one at random. If <condition>, you choose one instead." (lower/ability.ts#randomOrChosen, `override.chosen`);
 *   - a mode-count override reads this turn's history as the modes are chosen (model/forms.ts position 'mode', actions/announce.ts#modeLimits);
 *   - the modes of a chapter ability (lower/ability.ts#chapter);
 *   - a mode labeled with the card's own name ("• Typhoid Mary -- Draw a card.", parser/segment.ts#bulletMode).
 * Wordings are synthetic (design 6.10), checked against the local index when it is present. The behavior is in p2-modal-2-scenarios.test.ts. CR cites from
 * memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { programForms } from '../../../src/model/forms';
import type { EffectProgram } from '../../../src/types/ability';
import review from '../../m5/golden/cards/p2-modal-2-review.json';
import { card, fullyAutomated } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const face = (type: string, text: string, pt?: [string, string], name = 'Example Codex') => parseCard(card(name, type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');
const json = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);

const RANDOM = 'When ~ enters, choose one at random --\n• Draw a card.\n• You gain 2 life.';
const CHOSEN = 'When ~ enters, choose one at random. If you discarded a card this turn, you choose one instead.\n• Draw a card.\n• You gain 2 life.';
const HISTORY = 'Choose one. If a creature died this turn, you may choose both instead.\n• Draw a card.\n• You gain 2 life.';
const SAGA = '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after II.)\nI, II -- Choose one at random --\n• Draw a card.\n• You gain 2 life.';
const NAMED = 'When ~ enters, choose one --\n• Bright -- Draw a card.\n• Example Codex -- You gain 2 life.';
const READINGS = [RANDOM, CHOSEN, HISTORY, SAGA, NAMED];

describe('p2-modal-2 golden cards', () => {
  it('every golden card of the round is pinned full', () => {
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
  });
});

describe('p2-modal-2 (CR 700.2): "Choose one at random --"', () => {
  it('reads as one mode picked at random (ModeSpec.random), renders back, and asks for the capability feature:modes.random', () => {
    const f = face('Creature — Human', RANDOM, ['1', '1']);
    expect(fullFace(f), JSON.stringify(f.gate)).toBe(true);
    expect(json(f)).toContain('"random":true');
    const program = (f.abilities[0] as { effect: EffectProgram }).effect;
    expect(programForms(program)).toContain('feature:modes.random');
  });
  it('a spell\'s header reads the same', () => {
    expect(fullFace(face('Sorcery', 'Choose one at random --\n• Draw a card.\n• You gain 2 life.'))).toBe(true);
  });
  it('fail closed: "choose two at random" has no reading (only one mode at random)', () => {
    expect(fullFace(face('Sorcery', 'Choose two at random --\n• Draw a card.\n• You gain 2 life.\n• Scry 2.'))).toBe(false);
  });
  it('fail closed: a reflexive "When you do, choose one at random --" is not read as modes the player chooses', () => {
    expect(json(face('Creature — Human', 'When ~ enters, you may pay {1}. When you do, choose one at random --\n• Draw a card.\n• You gain 2 life.', ['1', '1']))).not.toMatch(/"modes":\{"min":1,"max":1,"options"/);
  });
});

describe('p2-modal-2 (CR 700.2, 603.3c): "you choose one instead"', () => {
  it('reads the override that lets the player choose (override.chosen) with its condition, and renders back', () => {
    const f = face('Creature — Human', CHOSEN, ['1', '1']);
    expect(fullFace(f), JSON.stringify(f.gate) + JSON.stringify(f.diagnostics)).toBe(true);
    expect(json(f)).toContain('"chosen":true');
    expect(json(f)).toContain('"random":true');
  });
  it('fail closed: "choose one instead" without "you" is not this reading', () => {
    expect(json(face('Creature — Human', 'When ~ enters, choose one at random. If you discarded a card this turn, choose one instead.\n• Draw a card.\n• You gain 2 life.', ['1', '1']))).not.toContain('"chosen":true');
  });
});

describe('p2-modal-2 (CR 601.2b, 603.3c): a mode-count override reads this turn\'s history', () => {
  it('"If a creature died this turn, you may choose both instead." is read as the modes are chosen', () => {
    const f = face('Sorcery', HISTORY);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    const program = (f.abilities[0] as { effect: EffectProgram }).effect;
    expect(programForms(program)).toContain('feature:announce.happened.turn');
  });
});

describe('p2-modal-2 (CR 714.2, 700.2): a chapter ability with modes', () => {
  it('"I, II -- Choose one at random --" keeps its modes and renders back', () => {
    const f = face('Enchantment — Saga', SAGA);
    expect(fullFace(f), JSON.stringify(f.gate)).toBe(true);
    expect(json(f)).toContain('"kind":"chapter"');
    expect(json(f)).toContain('"random":true');
  });
  it('a chapter whose header the model cannot state stays not full', () => {
    expect(fullFace(face('Enchantment — Saga', '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after II.)\nI, II -- Choose one that you didn\'t choose --\n• Draw a card.\n• You gain 2 life.'))).toBe(false);
  });
});

describe('p2-modal-2 (CR 207.2d): a mode labeled with the card\'s own name', () => {
  it('"• Example Codex -- You gain 2 life." on a card named Example Codex: the name is the mode\'s label, the effect reads, and it renders back', () => {
    const f = face('Creature — Human', NAMED, ['1', '1']);
    expect(fullFace(f), JSON.stringify(f.gate) + JSON.stringify(f.diagnostics)).toBe(true);
    expect(json(f)).toContain('"label":"Bright"');
  });
  it('fail closed: the name followed by more words before the dash is no label of this reading', () => {
    expect(fullFace(face('Creature — Human', 'When ~ enters, choose one --\n• Bright -- Draw a card.\n• Example Codex Rises -- You gain 2 life.', ['1', '1']))).toBe(false); // "~ Rises" is neither the name alone nor a flavor word (labels.ts refuses "~")
  });
});

const index = localIndex();

describe.skipIf(index === null)('p2-modal-2 design 6.10 (local index): synthetic wordings', () => {
  it('no line of the wordings this round tests is a line of a real card', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) if (typeof text === 'string') for (const l of text.split('\n')) lines.add(l.replaceAll(c.name, '~').trim());
    const verbatim = READINGS.filter((x) => x.split('\n').some((l) => !/^\(/.test(l) && !/^• /.test(l) && lines.has(l.trim())));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
