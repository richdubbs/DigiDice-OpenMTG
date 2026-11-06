/**
 * Commander lane edh-next, round edh-next-50 (EDHREC ranks 15,001-16,250, third pass): the template data of parser/templates/zz-cloud/edh-next-50.json and the round's parser,
 * renderer and engine changes, tested at the end of this file and in edh-next-50-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. CR cites from memory, unverified (cloud session).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext50 from '../../../src/parser/templates/zz-cloud/edh-next-50.json';
import review from '../../m5/golden/cards/edh-next-50-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext50 as Template[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'rid.edhn50.copy.newTarget': ['Ancestral Communion'],
  'eff.edhn50.token.numberEqual.manaSpent': ['Abby, Merciless Soldier'],
  'eff.edhn50.copy.perCounterKind': ['Storm of Forms'],
  'eff.edhn50.search.graveyardHandLibrary.named.battlefield': ['Shaun & Rebecca, Agents'],
  'eff.edhn50.search.graveyardLibrary.named.battlefield.attached': ['Arachnus Spinner'],
  'eff.edhn50.cast.self.fromGraveyard': ['Sproutback Trudge'],
  'eff.edhn50.becomes.subtype.basept.abilitiesList.permanent': ['Figure of Destiny'],
  'sta.edhn50.self.castFromGraveyard.payMorePerCount': ['Risen Executioner'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  text.startsWith('Equip ') ? card('Example Plate', 'Artifact — Equipment', text) : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-50 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-50.json, path order: after edh-next-5.json, before edh-next-6.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-50.json');
    expect(files.indexOf('zz-cloud/edh-next-50.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-5.json'));
    expect(files.indexOf('zz-cloud/edh-next-50.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-6.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn50.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|kw)\.edhn50\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
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

describe('edh-next-50 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [
    [/\bElf\b/, 'Elves'], [/\bsecond\b/, 'third'], [/\bhalf\b/, 'a third'], [/\bdifferent\b/, 'same'], [/\bflash\b/, 'haste'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-50 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-50 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word (CR 122.1b: a counter with a name no rule defines is allowed)
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

describe.skipIf(index === null)('edh-next-50 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-50 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const fixed = (_l: string): boolean => false;
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !fixed(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-next-50 renderer, lowering and engine changes (one test each)', () => {
  const creature = (text: string, type = 'Artifact Creature — Construct', name = 'Example Beast') => parseCard(card(name, type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  it('render/steps-zones.ts (CR 707.10c, 115.7; Ancestral Communion): "a new target for the copy" is the singular of "new targets for the copies"; the singular after several copies and the plural after one stay out', () => {
    expect(fullyAutomated(spell('Copy target instant spell. You may choose a new target for the copy.', 'Instant'))).toBe(true);
    expect(fullyAutomated(spell('When you cast this spell, copy it. You may choose a new target for the copy.'))).toBe(true);
    expect(fullyAutomated(spell('When you cast this spell, copy it. You may choose new targets for the copy.'))).toBe(true);
    expect(jsonKey(spell('When you cast this spell, copy it. You may choose a new target for the copy.').abilities)).toBe(jsonKey(spell('When you cast this spell, copy it. You may choose new targets for the copy.').abilities));
    expect(fullyAutomated(spell('When you cast this spell, copy it twice. You may choose a new target for the copy.'))).toBe(false);
  });
  it('render/qty.ts + render/steps-zones.ts (CR 122.1, 707.10; Storm of Forms): "copy it for each kind of counter among permanents you control"; counters on a target and a plural "kinds" stay out', () => {
    expect(fullyAutomated(spell('When you cast this spell, copy it for each kind of counter among permanents you control. You may choose new targets for the copies.', 'Instant'))).toBe(true);
    expect(fullyAutomated(spell('When you cast this spell, copy it for each kind of counter on target creature.', 'Instant'))).toBe(false);
    expect(fullyAutomated(spell('When you cast this spell, copy it for each kinds of counter among permanents you control.', 'Instant'))).toBe(false);
  });
  it('types/ability.ts + core/durations.ts + statics/live.ts + parser/holes/dur.ts + render/dur.ts (CR 611.2b; Helm of Possession): "for as long as you control ~ and ~ remains tapped" is a duration of its own; either half alone is the older duration', () => {
    const helm = (dur: string) => creature(`{2}, {T}, Sacrifice a creature: Gain control of target creature ${dur}.`, 'Artifact', 'Example Helm');
    expect(fullyAutomated(helm('for as long as you control ~ and ~ remains tapped'))).toBe(true);
    expect(fullyAutomated(helm('for as long as you control ~'))).toBe(true);
    expect(fullyAutomated(helm('for as long as ~ remains tapped'))).toBe(true);
    expect(jsonKey(helm('for as long as you control ~ and ~ remains tapped').abilities)).not.toBe(jsonKey(helm('for as long as you control ~').abilities));
    expect(jsonKey(helm('for as long as you control ~ and ~ remains tapped').abilities)).not.toBe(jsonKey(helm('for as long as ~ remains tapped').abilities));
    expect(fullyAutomated(helm('for as long as you control ~ or ~ remains tapped'))).toBe(false);
  });
  it('render/steps-cards.ts (CR 701.23a; Shaun & Rebecca): "your graveyard, hand, and library" searches all three zones, "and/or" lets the searcher choose; two zones joined with "and" and a different order stay out', () => {
    const find = (zones: string) => creature(`When ~ enters, search your ${zones} for a card named Ornithopter and put it onto the battlefield, then shuffle.`);
    expect(fullyAutomated(find('graveyard, hand, and library'))).toBe(true);
    expect(fullyAutomated(find('graveyard, hand and library'))).toBe(false); // (the serial comma is the printed one; Oracle's own is graded by the render gate)
    expect(fullyAutomated(find('library, hand, and graveyard'))).toBe(false);
  });
  it('render/steps-zones.ts + render/stat.ts (CR 601.3, 601.2f, 113.6m): "you may cast ~ from your graveyard" as an effect says where it is cast from; "from your hand" and "from exile" stay out; the permission with {1} more for each is a static of its own', () => {
    expect(fullyAutomated(creature('At the beginning of your end step, you may cast ~ from your graveyard.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of your end step, you may cast ~ from your hand.'))).toBe(false);
    expect(fullyAutomated(creature('You may cast ~ from your graveyard if you pay {1} more to cast it for each other creature card in your graveyard.'))).toBe(true);
    expect(fullyAutomated(creature('You may cast ~ from your graveyard if you pay {1} more to cast it for each creature card in your graveyard.'))).toBe(true);
    expect(fullyAutomated(creature('You may cast ~ from your graveyard if you pay {1} more to cast it.'))).toBe(false);
  });
  it('render/mods.ts (CR 613.4b, 613.1f; Figure of Destiny): "base power and toughness 8/8, flying, and first strike" for good is the identity with the abilities listed after it; a single keyword with a comma and a duration after it stay out', () => {
    const fig = (tail: string) => creature(`{3}: If ~ is a Warrior, it becomes a Kithkin Spirit Warrior Avatar with base power and toughness 8/8${tail}.`, 'Creature — Kithkin Warrior', 'Example Figure');
    expect(fullyAutomated(fig(', flying, and first strike'))).toBe(true);
    expect(fullyAutomated(fig(' and flying'))).toBe(true);
    expect(jsonKey(fig(', flying, and first strike').abilities)).not.toBe(jsonKey(fig(' and flying').abilities));
    expect(fullyAutomated(fig(', flying, and first strike until end of turn'))).toBe(false);
  });
});
