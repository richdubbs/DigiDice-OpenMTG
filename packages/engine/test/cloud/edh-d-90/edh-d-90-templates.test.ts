/**
 * Commander coordinator D, round edh-d-90 (EDHREC band 5,001-10,000, group combat): the template data of parser/templates/zz-cloud/edh-d-90.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-d-90-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD90 from '../../../src/parser/templates/zz-cloud/edh-d-90.json';
import review from '../../m5/golden/cards/edh-d-90-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD90 as Template[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edhd90.spells.costLess.perSharedCardType': ['Cemetery Prowler'],
  'eff.edhd90.opponents.blockIfAble.youChooseHow': ['Brutal Hordechief'],
  'eff.edhd90.untilEndOfDefendersNextTurn.getsCounters.wheneverTheyCast': ['Nuka-Nuke Launcher'],
  'eff.edhd90.you.mayExile.oneOf': ['Godsend'],
  'eff.edhd90.dur.playerMayPlay.theyAnyColor': ['Curse of Hospitality'],
  'eff.edhd90.you.maySacrifice.X': ['Campsite Cuisine'],
  'cm.edhd90.self.less.perOtherSpellThisTurn': ["Thrasta, Tempest's Roar"],
  'eff.edhd90.permit.play.oneOfGroup.free.durFirst': ['Fire Lord Ozai'],
}
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-90 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-90.json, path order: after edh-d-9.json, before edh-mana-keywords-1.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-90.json');
    expect(files.indexOf('zz-cloud/edh-d-90.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-9.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 90; ids are *.edhd90.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm)\.edhd90\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(90);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-d-90 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [[/\btwo\b/, 'three'], [/\bhaste\b/, 'flying'], [/\bWalls\b/, 'Wall'], [/\bone\b/, 'two']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-90 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-d-90 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-d-90 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-90 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    if (verbatim.length > 0) console.error('VERBATIM', JSON.stringify(verbatim));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-d-90 parser, lowering and renderer changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Elf') => parseCard(card('Example Relic', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/event.ts (CR 605.3b): "whenever a mana ability of ~ resolves" is the activation of a mana ability of the object; "an ability" or another object is not this reading', () => {
    expect(JSON.stringify(creature('Whenever a mana ability of ~ resolves, you gain 1 life.').abilities)).toContain('"ev":"activate","source":{"self":true},"manaAbility":true');
    expect(fullyAutomated(creature('Whenever an ability of ~ resolves, you gain 1 life.'))).toBe(false);
  });
  it('parser/holes/qty.ts + model/lint-nodes.ts (CR 106.3, 605.3b): "the amount of mana ~ produced" only in a trigger on a mana ability\'s activation', () => {
    expect(fullyAutomated(creature('Whenever a mana ability of ~ resolves, you gain life equal to the amount of mana ~ produced.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever ~ attacks, you gain life equal to the amount of mana ~ produced.'))).toBe(false);
  });
  it('parser/holes/event.ts, lower/scope.ts (CR 509.3c, 603.2c): "blocks or becomes blocked by one or more creatures" is one batch; "those creatures" are the other combatants', () => {
    const f = creature('Whenever ~ blocks or becomes blocked by one or more creatures, you may exile one of those creatures.');
    expect(JSON.stringify(f.abilities)).toContain('"batch":true');
    expect(JSON.stringify(f.abilities)).toContain('"is":{"ref":"event","role":"object"}');
    expect(fullyAutomated(creature('Whenever ~ blocks or becomes blocked by one or more Elves, you may exile one of those creatures.'))).toBe(false);
  });
  it('parser/lower/riders.ts (CR 106.4, 608.2c): "you don\'t lose this mana" reaches the one addMana past a gain of life; past a draw of mana-making steps it does not', () => {
    expect(fullyAutomated(creature("Whenever ~ attacks, add {R}{R} and you gain 2 life. Until end of turn, you don't lose this mana as steps and phases end."))).toBe(true);
    expect(fullyAutomated(creature("Whenever ~ attacks, add {R}{R} and create a Treasure token. Until end of turn, you don't lose this mana as steps and phases end."))).toBe(false);
  });
  it('parser/lower/edhd90.ts (CR 107.3): the X of "you may sacrifice X Foods" is the number sacrificed in a triggered ability only; an activated ability with {X} keeps its announced X', () => {
    expect(JSON.stringify(creature('Whenever you attack, you may sacrifice X Foods. When you do, up to X target attacking creatures each get +1/+0 until end of turn.').abilities)).toContain('"max":{"q":"resultCount","step":"sacrificedX"}');
    expect(JSON.stringify(creature('{X}, {T}: You may sacrifice X Foods. When you do, up to X target attacking creatures each get +1/+0 until end of turn.').abilities)).not.toContain('sacrificedX');
  });
  it('render/refs.ts (CR 109.2): a card in exile is never "that creature": the creature of the trigger is named so after a card was exiled', () => {
    expect(fullyAutomated(creature("Enchant player\nWhenever a creature deals combat damage to enchanted player, that player exiles the top card of their library. Until end of turn, that creature's controller may play that card and they may spend mana as though it were mana of any color to cast that spell.", 'Enchantment — Aura Curse'))).toBe(true);
  });
  it('keywords/data/trample-over-planeswalkers.json (CR 702.19c): the keyword line is a keyword ability; "trample over creatures" is not', () => {
    expect(JSON.stringify(creature('Trample over planeswalkers').abilities)).toContain('"keyword":"trample over planeswalkers"');
    expect(fullyAutomated(creature('Trample over creatures'))).toBe(false);
  });
});
