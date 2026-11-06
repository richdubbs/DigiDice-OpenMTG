/**
 * edh-zones-22 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-22.json and the round's other changes: "creatures and/or other planeswalkers"
 * (parser/holes/filter.ts#orPhrases, render/np.ts), "put into a graveyard this way" for destroyed targets (parser/lower/mentions.ts#destroyedTargetsOf), "<cards> revealed this way" after a
 * counted reveal until (Discourse.revealedUntil), the reveal-until branch kept with its follower (parser/lower/conditions.ts#absorbFollowers), the names a branch not taken would bind
 * (effects/handlers/control.ts#bindUnrun, model/lint-flow.ts), "put there from their library this turn" (filter `putThereFrom: 'library'`), a copy of the card a random choice exiled
 * (parser/lower/normalize.ts#castsCopyOfUnexiled) and the permission that gives the abilities a permanent enters with (PermissionDef.entersAbilities). Guard G9 and G2 as the earlier rounds
 * run them; examples are synthetic (design 6.10). The behavior is in edh-zones-22-scenarios.test.ts. CR cites checked against the 2026-09-25 text.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones22 from '../../../src/parser/templates/zz-cloud/edh-zones-22.json';
import review from '../../m5/golden/cards/edh-zones-22-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ22 = edhZones22 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

const IDS = [
  'eff.edhz22.sacrifice.oneOfThem',
  'sta.edhz22.once.playLandOrCastPermanent.entersWith',
  'eff.edhz22.mayPut.handCard.bf.attackingWhom',
  'eff.edhz22.putAll.revealedUntil.graveyard.restBottomRandom',
  'eff.edhz22.exile.randomFromGraveyard.nonlandCard',
];
/** The type line an example is printed on. */
const typeOf = (text: string): string => (/^(\{5\}, \{T\}: You gain|Once during|Whenever ~ attacks)/.test(text) ? 'Creature — Pirate' : /^(\{2\}, \{T\}|At the beginning)/.test(text) ? 'Artifact' : /^Whenever one or more/.test(text) ? 'Enchantment' : 'Sorcery');
const face = (text: string, typeLine: string) =>
  parseCard(card('Example Relic', typeLine, text, { ...(typeLine.includes('Creature') ? { power: '2', toughness: '2' } : {}), ...(/\bX\b/.test(text) ? { mana_cost: '{X}' } : {}) }), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic', extra: Record<string, unknown> = {}) =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}), ...extra } as OracleCard);
const withX = (text: string): Record<string, unknown> => (/\bX\b/.test(text) ? { mana_cost: '{X}' } : {});
const level = (type: string, text: string, name?: string): string => compiled(type, text, name, withX(text)).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name, withX(text)).faces);
const strip = (a: string): string => a.replace(/"oracleText":"[^"]*"/g, '').replace(/"text":"[^"]*"/g, '').replace(/"src":\[[^\]]*\]/g, '');
const same = (a: string, b: string): boolean => strip(a) === strip(b);

describe('edh-zones-22 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-22.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-22.json');
    expect(files.indexOf('zz-cloud/edh-zones-22.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-2.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-22.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ22.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ22) {
      expect(t.id, t.id).toMatch(/^(eff|rep|sta)\.edhz22\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) {
      expect(g.expect, g.card).toBe('full');
      expect(g.verified, g.card).toMatch(/CR \d{3}/);
    }
    // narrow wordings (one or two cards of the index print them), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.edhz22.sacrifice.oneOfThem')).toEqual(["Descendants' Fury"]);
    expect(goldenUsing('sta.edhz22.once.playLandOrCastPermanent.entersWith')).toEqual(['Serra Paragon']);
    expect(goldenUsing('eff.edhz22.mayPut.handCard.bf.attackingWhom')).toEqual(['Zara, Renegade Recruiter']);
    expect(goldenUsing('eff.edhz22.putAll.revealedUntil.graveyard.restBottomRandom')).toEqual(['Old Stickfingers']);
    expect(goldenUsing('eff.edhz22.exile.randomFromGraveyard.nonlandCard')).toEqual(['Wondrous Crucible']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ22) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'random']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-22 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ22) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text, typeOf(t.examples[0]!.text));
      for (const e of t.examples) {
        const f = face(e.text, typeOf(e.text));
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c, typeOf(t.examples[0]!.text));
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bor less\b/, 'or greater'], [/\bmana value\b/, 'power'], [/\bgraveyard\b/, 'hand'], [/\bbottom\b/, 'top'], [/\bthe rest\b/, 'a card'], [/\bone of them\b/, 'two of them'], [/\bat random\b/, 'of your choice'], [/\bplaneswalker\b/, 'creature'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-22 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ22) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text, typeOf(e.text));
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m, typeOf(e.text));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-zones-22 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ22) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any name (CR 122.1)
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    }, 600_000); // one parse per word of every example
  }
});

describe('edh-zones-22 "creatures and/or other planeswalkers" (parser/holes/filter.ts#orPhrases, render/np.ts; CR 109.2, 205.2a)', () => {
  const t = (what: string): string => `Destroy up to two target ${what}.`;
  it('is a creature, or a planeswalker other than the source (`other` on the planeswalkers only)', () => {
    expect(level('Planeswalker — Test', `−3: ${t('creatures and/or other planeswalkers')}`)).toBe('full');
    const j = json('Planeswalker — Test', `−3: ${t('creatures and/or other planeswalkers')}`);
    expect(j).toContain('"anyOf":[{"types":["Creature"]},{"other":true,"types":["Planeswalker"]}]');
    expect(level('Sorcery', 'Destroy target creature or other planeswalker.')).toBe('full');
  });
  it('near misses: "and/or" before a plain type list, "other" on the first noun and a different noun are the existing readings or other JSON', () => {
    expect(same(json('Sorcery', t('creatures and/or other planeswalkers')), json('Sorcery', t('creatures and/or planeswalkers')))).toBe(false);
    expect(same(json('Sorcery', t('creatures and/or other planeswalkers')), json('Sorcery', t('creatures and/or other artifacts')))).toBe(false);
    expect(level('Sorcery', t('other creatures and/or planeswalkers'))).not.toBe('full');
    expect(json('Sorcery', t('creatures and/or planeswalkers'))).toContain('"types":["Creature","Planeswalker"]'); // the plain coordination keeps its reading
  });
});

describe('edh-zones-22 "each card put into a graveyard this way" after a destroy of targets (parser/lower/mentions.ts#destroyedTargetsOf; CR 701.8a, 608.2c)', () => {
  it('is the cards that went to a graveyard, a card filter on the destroy step\'s group (`isCard`)', () => {
    const j = json('Sorcery', 'Destroy up to three target creatures. Return each card put into a graveyard this way to the battlefield under your control.');
    expect(level('Sorcery', 'Destroy up to three target creatures. Return each card put into a graveyard this way to the battlefield under your control.')).toBe('full');
    expect(j).toContain('"zone":"graveyard"');
    expect(j).toContain('"isCard":true');
  });
  it('near misses: one target (no group of cards), another zone and another verb stay manual or other JSON', () => {
    expect(level('Sorcery', 'Destroy target creature. Return each card put into a graveyard this way to the battlefield under your control.')).not.toBe('full');
    expect(level('Sorcery', 'Exile up to three target creatures. Return each card put into a graveyard this way to the battlefield under your control.')).not.toBe('full');
  });
});

describe('edh-zones-22 "<cards> revealed this way" after a counted reveal until (Discourse.revealedUntil; CR 701.20a)', () => {
  it('reads the X cards the reveal stopped at, only after a COUNTED reveal until', () => {
    expect(level('Sorcery', 'Reveal cards from the top of your library until you reveal X land cards. Put all land cards revealed this way into your graveyard, then put the rest on the bottom of your library in a random order.')).not.toBe('manual');
    // the cards revealed this way are the ones the reveal stopped at: another description is another group (review)
    expect(level('Creature — Horror', 'When you cast this spell, reveal cards from the top of your library until you reveal X creature cards. Put all Horror cards revealed this way into your graveyard, then put the rest on the bottom of your library in a random order.')).not.toBe('full');
    expect(level('Sorcery', 'Reveal cards from the top of your library until you reveal a land card. Put all land cards revealed this way into your graveyard, then put the rest on the bottom of your library in a random order.')).not.toBe('full');
  });
});

describe('edh-zones-22 "If you do, ..." with the sentence after it kept with a reveal until (parser/lower/conditions.ts#absorbFollowers)', () => {
  it('the card put onto the battlefield and the rest on the bottom are the branch\'s: nothing is read that is bound on one path alone', () => {
    const text = 'You may sacrifice a creature. If you do, reveal cards from the top of your library until you reveal a creature card. Put that card onto the battlefield and the rest on the bottom of your library in a random order.';
    expect(level('Sorcery', text)).toBe('full');
  });
});

describe('edh-zones-22 the names a branch not taken would bind (effects/handlers/control.ts#bindUnrun, model/lint-flow.ts; CR 608.2c)', () => {
  const t = (rest: string): string => `Look at the top five cards of your library. You may sacrifice a creature. If you do, you may put a creature card from among them onto the battlefield.${rest}`;
  it('an instruction after the branch that reads what the branch chose is understood: "Put the rest on the bottom" is the cards looked at less the chosen one', () => {
    expect(level('Sorcery', t(' Put the rest on the bottom of your library in a random order.'))).toBe('full');
  });
  it('near miss: a name the branch binds and a later step REbinds is not exported', () => {
    expect(level('Sorcery', t(' Put that card into your hand.'))).not.toBe('full');
  });
});

describe('edh-zones-22 "that was put there from their library this turn" (filter `putThereFrom: library`; CR 400.7, 404.1)', () => {
  const t = (what: string): string => `Return target creature card in an opponent's graveyard that ${what} to the battlefield under your control.`;
  it('is a card put into the graveyard this turn from its owner\'s library', () => {
    expect(level('Sorcery', t('was put there from their library this turn'))).toBe('full');
    expect(json('Sorcery', t('was put there from their library this turn'))).toContain('"putThereFrom":"library"');
  });
  it('near misses: the battlefield, anywhere, and another zone are other readings or manual', () => {
    expect(json('Sorcery', t('was put there from the battlefield this turn'))).toContain('"putThereFrom":"battlefield"');
    expect(json('Sorcery', t('was put there this turn'))).not.toContain('putThereFrom');
    expect(level('Sorcery', t('was put there from their hand this turn'))).not.toBe('full');
  });
});

describe('edh-zones-22 "Copy it. You may cast the copy without paying its mana cost." after a random exile (parser/lower/normalize.ts#castsCopyOfUnexiled; CR 707.12)', () => {
  it('a copy of the card a random choice exiled is understood, a copy of another card is not', () => {
    expect(level('Sorcery', 'Exile a nonland card at random from your graveyard. Copy it. You may cast the copy without paying its mana cost.')).toBe('full');
    expect(level('Sorcery', 'Exile a nonland card at random from your graveyard. Copy target instant spell. You may cast the copy without paying its mana cost.')).not.toBe('full');
  });
});

describe('edh-zones-22 the permission that gives the abilities a permanent enters with (PermissionDef.entersAbilities; CR 305.1, 601.3, 614.1c)', () => {
  const t = (n: number, extra = ''): string => `Once during each of your turns, you may play a land from your graveyard or cast a permanent spell with mana value ${n} or less from your graveyard. If you do, it gains "When this permanent is put into a graveyard from the battlefield, exile it and you gain 2 life."${extra}`;
  it('is one permission with the limit on both the land play and the cast', () => {
    expect(level('Creature — Angel', t(3))).toBe('full');
    const j = json('Creature — Angel', t(3));
    expect(j).toContain('"s":"permit"');
    expect(j).toContain('"oncePerTurn":true');
    expect(j).toContain('"manaValue":{"op":"<=","value":3}');
    expect(j).toContain('"entersAbilities"');
  });
  it('near misses: another number is other JSON; a creature-only spell, a land only and another rider are other readings or manual', () => {
    expect(same(json('Creature — Angel', t(3)), json('Creature — Angel', t(2)))).toBe(false);
    expect(level('Creature — Angel', t(3).replace('a permanent spell', 'a creature spell'))).not.toBe('full');
    expect(level('Creature — Angel', t(3).replace('If you do, it gains', 'If you do, it enters with'))).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-22 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-22 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = EZ22.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
