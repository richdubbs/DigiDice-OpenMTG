/**
 * WP18 review fixes: one describe per finding, each named after the rule or design section it pins. Synthetic cards (design 6.10) unless a card's own
 * structure is the point.
 */
import { describe, expect, it } from 'vitest';
import {
  ABILITY_MODEL_VERSION, BOOTSTRAP_TEMPLATES, ENGINE_CAPABILITIES, charsOfObject, compileCard, defaultCompileSources, overlayFace, spansOf, stripAbility, textHash, trusted,
  type AbilityDef, type CardDef, type CompileSources, type CompiledCardEntry, type ManualAbilityDef, type OracleCard, type StoredAbility,
} from '../../../src/index';
import { auraTargetProgram } from '../../../src/rules/attachment';
import { abilities, card, compile, creature, kinds } from './helpers';
import { act, find, scenario } from '../../m3/scenario';

const OID = '00000000-0000-4000-8000-0000000000bb';
const map = (e: CompiledCardEntry): Map<string, CompiledCardEntry> => new Map([[e.oracleId, e]]);
/** The default sources with the bootstrap templates only (W3b: the default compiler parses with the whole set; a test that needs a manual sentence uses these). */
const boot = (over: Partial<CompileSources> = {}): Partial<CompileSources> => ({ parse: { ...defaultCompileSources().parse, templates: [...BOOTSTRAP_TEMPLATES] }, ...over });
const blind = (over: Partial<CompileSources> = {}): Partial<CompileSources> => ({ parse: { ...defaultCompileSources().parse, templates: [] }, ...over });
const levels = (def: CardDef, face = 0): string[] => def.automation.faces![face]!.abilities.map((a) => a.level);
const reasonOf = (a: AbilityDef | undefined): string => (a?.kind === 'manual' ? a.reason : '');

/** The stored form (no text) of every ability of a card as the default compiler reads it: what a reviewed pack or LLM entry for it would hold. */
const storedOf = (c: OracleCard): StoredAbility[] => compileCard(c).faces[0]!.abilities.map((a) => stripAbility(a));
function entryFor(text: string, stored: StoredAbility[], over: Partial<CompiledCardEntry> = {}): CompiledCardEntry {
  return { oracleId: OID, textHash: textHash([text]), modelVersion: ABILITY_MODEL_VERSION, faces: [{ abilities: stored }], review: 'reviewed', source: 'hand', flags: [], ...over };
}

describe('design 6.8 G6 on a keyword line (CR 702): pack and LLM keyword abilities are gated per line, as the parser\'s are', () => {
  const TEXT = 'Flying, vigilance\nWhen this creature enters, draw a card.';
  const c = creature(TEXT, { oracle_id: OID });

  it('CR 702.9, 702.20: a reviewed hand-written pack entry for "Flying, vigilance" keeps a card the parser fully automates full', () => {
    expect(compile(c).def.automation.level).toBe('full');
    const { def, report } = compile(c, { pack: map(entryFor(TEXT, storedOf(c))) });
    expect(report.faces[0]!.source).toBe('pack');
    expect(kinds(def)).toEqual(['keyword', 'keyword', 'triggered']);
    expect(def.automation.level).toBe('full');
  });

  it('CR 702.9, 702.20: an overlay of a keyword line the parser left manual drives play (a pack face with `covers`, the overlay path LLM data takes)', () => {
    const stored = storedOf(c);
    const e = entryFor(TEXT, [stored[0]!, stored[1]!], { faces: [{ abilities: [stored[0]!, stored[1]!], covers: [{ line: 0, sentence: 0 }] }] });
    const { def, report } = compile(c, blind({ pack: map(e) }));
    expect(report.faces[0]!.overlaid).toEqual([0]);
    expect(abilities(def).slice(0, 2)).toMatchObject([{ kind: 'keyword', keyword: 'flying', prov: { by: 'pack' } }, { kind: 'keyword', keyword: 'vigilance', prov: { by: 'pack' } }]);
  });

  it('design 6.8 G6: a keyword group that does not render as its whole line ("Flying" alone for "Flying, vigilance") is manual', () => {
    const stored = storedOf(c);
    const { def } = compile(c, { pack: map(entryFor(TEXT, [stored[0]!, stored[2]!])) });
    expect(abilities(def)[0]).toMatchObject({ kind: 'manual' });
    expect(reasonOf(abilities(def)[0])).toMatch(/gate-mismatch/);
  });
});

describe('design 10.3, D14: native recognizer output passes the exact render gate like every other source', () => {
  it('D14: "Protection from black and from red" is automated by the native recognizer only since the renderer prints it (FAST2 T7, CR 702.16g)', () => {
    const { def, report } = compile(creature('Protection from black and from red'));
    expect(report.faces[0]!.nativeLines).toEqual([0]);
    expect(report.faces[0]!.nativeUngated).toEqual([]);
    expect(def.automation.level).toBe('full');
  });

  it('D14: a keyword line the renderer cannot print yet ("protection from black, from red, and from green") is not automated by the native recognizers', () => {
    const { def, report } = compile(creature('Protection from black, from red, and from green'));
    expect(report.faces[0]!.nativeLines).toEqual([]);
    expect(def.automation.level).not.toBe('full');
  });

  it('design 10.5: native output carries its own provenance (prov.by "native"), never a template id no template file has', () => {
    // W3b: "Add {W}" and (after the template review) "Add {G}{G}" are stable templates' now; FAST2 T7: "Add {U}{U}{U}" too, so a keyword line no
    // template reads ("protection from X and from Y", CR 702.16g) is the recognizer's gated reading
    const { def, report } = compile(creature('Protection from black and from red'));
    expect(report.faces[0]!.nativeLines).toEqual([0]);
    expect(abilities(def).map((a) => a.prov)).toEqual([{ by: 'native', id: 'keyword:protection' }, { by: 'native', id: 'keyword:protection' }]);
  });
});

describe('design 10.4, 10.6: Alchemy digital-only cards are manual', () => {
  it('design 10.4: set_type "alchemy" caps the card at manual and no ability runs by itself', () => {
    const { def } = compile(creature('Flying\nWhen this creature enters, draw a card.', { set_type: 'alchemy' }));
    expect(def.automation.level).toBe('manual');
    expect(def.automation.unsupported.some((u) => /digital-only \(Alchemy\)/.test(u))).toBe(true);
    expect(kinds(def)).toEqual(['manual', 'manual']);
    expect(levels(def)).toEqual(['manual', 'manual']);
  });
});

describe('CR 202.1b, 202.3, 107.4: a face with a mana symbol CR 107.4 does not define', () => {
  it('CR 202.1b: the card is manual (the engine cannot cast it), the reason says what the engine allows and that the mana value is unknown', () => {
    const def = compileCard(creature('Flying', { mana_cost: '{8}{C/P}{C/P}' }));
    expect(def.faces[0]!.manaCost).toBeNull();
    expect(def.automation.level).toBe('manual');
    const last = abilities(def).at(-1) as ManualAbilityDef;
    expect(last.shape).toBe('static'); // not asked as a resolution step of an instant or sorcery
    expect(last.reason).not.toMatch(/cast and pay for it by hand/);
    expect(last.reason).toMatch(/can't cast/);
    expect(last.reason).toMatch(/mana value/);
    expect(levels(def).every((l) => l === 'manual')).toBe(true);
  });
});

describe('design 11.1: overlays and the parser\'s units', () => {
  const TEXT = 'When this creature enters, draw a card. You gain 2 life.';
  const c = creature(TEXT, { oracle_id: OID });

  it('design 11.1 repair mode: an entry for the manual sentence of a partly automated unit is not a disagreement; it is reported as not applied', () => {
    // W3b: the whole template set reads "You gain 2 life." too; the subject is a unit with a manual step, so this test parses with the bootstrap set
    const parser = compile(c, boot()).def.faces[0]!.abilities[0]!;
    expect(parser.kind).toBe('triggered'); // the bootstrap templates read the trigger and "draw a card"; "You gain 2 life." is a manual step
    const repaired = JSON.parse(JSON.stringify(stripAbility(parser))) as { effect: { steps: Record<string, unknown>[] } };
    const steps = repaired.effect.steps;
    const manualAt = steps.findIndex((s) => s['op'] === 'manual');
    expect(manualAt).toBe(1);
    steps[manualAt] = { op: 'gainLife', who: { ref: 'you' }, amount: 2 };
    const e = entryFor(TEXT, [], { source: 'llm', faces: [{ abilities: [repaired as StoredAbility], covers: [{ line: 0, sentence: 1 }] }] });
    const { def, report } = compile(c, boot({ llm: map(e), trust: 'reviewed' }));
    expect(report.disagreements).toEqual([]);
    expect(report.faces[0]!.overlaid).toEqual([]);
    expect(report.notApplied).toEqual([{ face: 0, src: [0], reason: 'repair overlays unsupported' }]);
    expect(abilities(def)[0]!.prov).toMatchObject({ by: 'template' }); // the parser wins
  });

  it('design 11.1: an overlay that contradicts a step the parser accepted is a disagreement, one that only fills its manual step is a repair', () => {
    const trigger = (steps: unknown[]): AbilityDef => ({ kind: 'triggered', text: 'x', src: [0], trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] }, effect: { targets: [], steps } } as unknown as AbilityDef);
    const draw = (n: number): unknown => ({ op: 'draw', who: { ref: 'you' }, count: n });
    const gain = { op: 'gainLife', who: { ref: 'you' }, amount: 2 };
    const parser = trigger([draw(1), { op: 'manual', reason: 'no template' }]);
    expect(overlayFace([parser], [trigger([draw(2), gain])], ENGINE_CAPABILITIES)).toMatchObject({ disagreements: [[0]], notApplied: [] });
    expect(overlayFace([parser], [trigger([draw(1), gain])], ENGINE_CAPABILITIES)).toMatchObject({ disagreements: [], notApplied: [{ src: [0], reason: 'repair overlays unsupported' }] });
  });

  it('design 10.1, 11.1: a unit the parser accepted but this build cannot run (unavailable, not manual) is never replaced by an overlay', () => {
    const draw = (n: number): AbilityDef => ({ kind: 'spell', text: 'x', src: [0], effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: n }] } });
    const caps = new Set([...ENGINE_CAPABILITIES].filter((x) => x !== 'op:draw'));
    const r = overlayFace([draw(1)], [draw(2)], caps);
    expect(r.abilities).toEqual([draw(1)]);
    expect(r.overlaid).toEqual([]);
    expect(r.disagreements).toEqual([[0]]);
  });
});

describe('design 11.5, 11.3 step 9: the trust policy', () => {
  const stored = stripAbility(compileCard(card('Draw a card.')).faces[0]!.abilities[0]!);
  const e = (over: Partial<CompiledCardEntry>): CompiledCardEntry => ({ ...entryFor('Draw a card.', [{ ...stored, src: [0] }]), ...over });

  it('design 11.5: LLM data inside a pack follows the player\'s llmTrust setting; only hand-written data bypasses it', () => {
    expect(trusted(e({ source: 'llm', review: 'reviewed' }), 'off', 'pack')).toBe(false);
    expect(trusted(e({ source: 'llm', review: 'autoverified' }), 'off', 'pack')).toBe(false);
    expect(trusted(e({ source: 'llm', review: 'autoverified' }), 'reviewed', 'pack')).toBe(false);
    expect(trusted(e({ source: 'llm', review: 'reviewed' }), 'reviewed', 'pack')).toBe(true);
    expect(trusted(e({ source: 'llm', review: 'autoverified' }), 'autoverified', 'pack')).toBe(true);
    expect(trusted(e({ source: 'hand', review: 'unreviewed' }), 'off', 'pack')).toBe(true);
  });

  it('design 11.3 step 9, 1.1.17: high risk is computed from the JSON: an autoverified entry with a copy or replacement node and no flag is refused', () => {
    const copy: StoredAbility = { kind: 'spell', src: [0], effect: { targets: [], steps: [{ op: 'copy', what: { ref: 'self' }, who: { ref: 'you' } }] } };
    const replace: StoredAbility = { kind: 'static', src: [0], effects: [{ s: 'replace' }] };
    const layer2: StoredAbility = { kind: 'static', src: [0], effects: [{ s: 'continuous', affected: { ref: 'self' }, mods: [{ layer: 2, controller: { ref: 'you' } }] }] };
    for (const a of [copy, replace, layer2]) {
      expect(trusted(e({ source: 'llm', review: 'autoverified', faces: [{ abilities: [a] }] }), 'autoverified', 'llm'), JSON.stringify(a)).toBe(false);
      expect(trusted(e({ source: 'llm', review: 'reviewed', faces: [{ abilities: [a] }] }), 'autoverified', 'llm'), JSON.stringify(a)).toBe(true);
    }
  });

  it('design 11.5: the default trust setting is autoverified', () => {
    expect(defaultCompileSources().trust).toBe('autoverified');
  });
});

describe('design 10.3, 10.5, 12.4: a capped layout is manual in its level, its abilities and its spans alike', () => {
  // M6-4 lifted the meld cap (cards/layout-support/dfc.ts), M6-9 the mutate cap; the same holds for every layout still capped (planar here)
  it('design 12.4: a capped layout\'s abilities are demoted with the cap\'s reason; the spans paint them manual', () => {
    const def = compileCard(creature('Flying\nWhen this creature enters, draw a card.', { layout: 'planar' }));
    expect(def.automation.level).toBe('manual');
    expect(kinds(def)).toEqual(['manual', 'manual']);
    expect(levels(def)).toEqual(['manual', 'manual']);
    expect(reasonOf(abilities(def)[0])).toMatch(/layout planar/);
    expect(spansOf(def, 0).filter((s) => s.status === 'auto')).toEqual([]);
  });
});

describe('design 10.5: spans of an understood cost', () => {
  it('design 10.5 "Understood costs stay plain": the cost of a manual activated ability is painted auto, the effect manual', () => {
    const def = compileCard(card('{2}, {T}: Frobnicate the quux.', { type_line: 'Artifact' }));
    const text = def.faces[0]!.oracleText;
    const shown = spansOf(def, 0).map((s) => [s.status, text.slice(s.range[0], s.range[1])]);
    expect(shown).toEqual([['auto', '{2}, {T}:'], ['manual', 'Frobnicate the quux.']]);
  });
});

describe('CR 709.5: Room doors (split cards with a shared type line)', () => {
  const room = (left: string, right: string): OracleCard => ({
    name: 'Test Hall // Test Vault', oracle_id: OID, layout: 'split', type_line: 'Enchantment — Room // Enchantment — Room', mana_cost: '{1}{W} // {3}{W}',
    card_faces: [
      { name: 'Test Hall', type_line: 'Enchantment — Room', mana_cost: '{1}{W}', oracle_text: left },
      { name: 'Test Vault', type_line: 'Enchantment — Room', mana_cost: '{3}{W}', oracle_text: right },
    ],
  }) as OracleCard;

  it('CR 709.5c-e (FAST5X E8): the unlocked designations are implemented, so a Room is no longer capped: its door abilities compile like any other', () => {
    const def = compileCard(room('Creatures you control get +1/+0.', 'Whenever a creature you control dies, draw a card.'));
    expect(def.automation.level).toBe('full');
    expect(def.faces.flatMap((f) => f.abilities.map((a) => a.kind))).toEqual(['static', 'triggered']);
    expect(def.automation.requiresEngine ?? []).not.toContain('feature:room.doors');
  });

  it('CR 709.5: a Room on the battlefield with no door unlocked does not pump creatures (a locked door has no rules text)', () => {
    const def = compileCard(room('Creatures you control get +1/+0.', 'Draw a card.'));
    const s = scenario(['Grizzly Bears'], { defs: [def], p1: { battlefield: ['Grizzly Bears', def.name] } });
    expect(charsOfObject(s, s.objects[find(s, 'Grizzly Bears', 'battlefield')]!)).toMatchObject({ power: '2' });
  });
});

describe('design 10.3, 12.5: pack and LLM data must claim every line exactly once', () => {
  const TEXT = '{T}: Draw a card.\nAt the beginning of your upkeep, you lose 5 life.';
  const c = creature(TEXT, { oracle_id: OID });

  it('design 10.3: a pack face that leaves a line unclaimed is refused (the parser drives the face), never full with the line silently gone', () => {
    const stored = storedOf(c);
    const { def, report } = compile(c, blind({ pack: map(entryFor(TEXT, [stored[0]!])) }));
    expect(report.pack).toBe('coverage');
    expect(report.faces[0]!.source).toBe('parser');
    expect(def.automation.level).not.toBe('full');
    expect(abilities(def)).toHaveLength(2);
  });

  it('CR 603.2: a pack face with the same ability twice for one line is refused (it would trigger twice)', () => {
    const stored = storedOf(c);
    const { report } = compile(c, blind({ pack: map(entryFor(TEXT, [stored[0]!, stored[0]!, stored[1]!])) }));
    expect(report.pack).toBe('coverage');
  });

  it('CR 603.2: an LLM overlay that repeats a triggered ability for one line is not applied', () => {
    const t = creature('When this creature enters, draw a card.', { oracle_id: OID });
    const stored = storedOf(t);
    const e = entryFor('When this creature enters, draw a card.', [stored[0]!, stored[0]!], { source: 'llm' });
    const { def, report } = compile(t, blind({ llm: map(e), trust: 'reviewed' }));
    expect(report.faces[0]!.overlaid).toEqual([]);
    expect(abilities(def)).toHaveLength(1);
    expect(report.notApplied).toEqual([{ face: 0, src: [0], reason: expect.stringMatching(/two abilities/) }]);
  });
});

describe('CR 303.4a, 702.5a, 115.1: an enchant ability that names a zone other than the battlefield', () => {
  it('CR 702.5a: "Enchant creature card in a graveyard" is not automated (the engine attaches Auras only to permanents)', () => {
    const { def } = compile(card('Enchant creature card in a graveyard', { type_line: 'Enchantment — Aura' }));
    expect(abilities(def)[0]).toMatchObject({ kind: 'manual' });
    expect(def.automation.requiresEngine).toContain('feature:enchant.zone');
  });

  it('CR 303.4a: an Aura whose enchant keyword names the graveyard never targets a creature on the battlefield', () => {
    const def = compileCard(card('Enchant creature card in a graveyard', { name: 'Test Animate', type_line: 'Enchantment — Aura', mana_cost: '{1}{B}' }), () => ({
      abilities: [{ kind: 'keyword', keyword: 'enchant', text: 'Enchant creature card in a graveyard', filter: { types: ['Creature'], zone: 'graveyard', isCard: true } }], unsupported: [],
    }));
    let s = scenario(['Grizzly Bears', 'Hill Giant', 'Swamp'], { defs: [def], p1: { hand: ['Test Animate'], battlefield: ['Swamp', 'Swamp', 'Grizzly Bears'], graveyard: ['Hill Giant'] } });
    const aura = s.objects[find(s, 'Test Animate', 'hand')]!;
    expect(auraTargetProgram(charsOfObject(s, aura))).toBeNull(); // the restriction is not understood: no target from the battlefield (milestone 4 behavior)
    s = act(s, { type: 'cast', player: 'p1', card: aura.id });
    expect(JSON.stringify(s.pending)).not.toContain(find(s, 'Grizzly Bears', 'battlefield'));
  });
});

describe('design 8.8 (determinism and replay): the default compiler\'s capability set is installed once', () => {
  it('a second install of another set throws; installing the same set again is a no-op; the setter is not part of the public API', async () => {
    const compileModule = await import('../../../src/cards/compile');
    const index = await import('../../../src/index');
    expect('installEngineCapabilities' in index).toBe(false);
    expect(() => compileModule.installEngineCapabilities(ENGINE_CAPABILITIES)).not.toThrow();
    expect(() => compileModule.installEngineCapabilities(new Set())).toThrow(/installed once/);
    expect(defaultCompileSources().caps).toBe(ENGINE_CAPABILITIES);
  });
});
