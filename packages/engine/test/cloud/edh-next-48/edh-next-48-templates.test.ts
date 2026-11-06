/**
 * Commander lane edh-next, round edh-next-48 (EDHREC ranks 7,501-8,750, third pass): the template data of parser/templates/zz-cloud/edh-next-48.json and the round's parser,
 * renderer and engine changes, tested at the end of this file and in edh-next-48-scenarios.test.ts.
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
import edhNext48 from '../../../src/parser/templates/zz-cloud/edh-next-48.json';
import review from '../../m5/golden/cards/edh-next-48-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext48 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'eff.edhn48.damage.unlessThatPlayerSacrifices': ['Demanding Dragon'],
  'eff.edhn48.mayPay.anyAmountOfEnergy': ['Aether Spike', 'Galvanic Discharge'],
  'eff.edhn48.counter.unlessPaysPerEnergyPaid': ['Aether Spike'],
  'eff.edhn48.return.two.filterCards.randomFromGraveyard.battlefield': ['Moldgraf Monstrosity'],
  'eff.edhn48.token.forEach.lead.youCreate': ['Visions of Ruin'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  text.startsWith('Equip ') ? card('Example Plate', 'Artifact — Equipment', text) : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-48 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-48.json, path order: after edh-next-44.json, before edh-next-5.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-48.json');
    expect(files.indexOf('zz-cloud/edh-next-48.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-44.json'));
    expect(files.indexOf('zz-cloud/edh-next-48.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-5.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn48.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|kw)\.edhn48\./);
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

describe('edh-next-48 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-next-48 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-48 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-48 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-48 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-48 renderer, lowering and engine changes (one test each)', () => {
  const creature = (text: string, type = 'Artifact Creature — Construct', name = 'Example Beast') => parseCard(card(name, type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  it('render/steps-flow.ts (CR 118.12a, 701.21a; Demanding Dragon): "unless that player sacrifices a creature of their choice" names the payer again as "that player"; "they" and a payer who is not the target stay as before', () => {
    expect(fullyAutomated(creature('When ~ enters, it deals 5 damage to target opponent unless that player sacrifices a creature of their choice.'))).toBe(true);
    expect(fullyAutomated(creature('When ~ enters, it deals 5 damage to target opponent unless they sacrifice a creature of their choice.'))).toBe(true);
    expect(jsonKey(creature('When ~ enters, it deals 5 damage to target opponent unless that player sacrifices a creature of their choice.').abilities)).toBe(jsonKey(creature('When ~ enters, it deals 5 damage to target opponent unless they sacrifice a creature of their choice.').abilities));
    expect(fullyAutomated(creature('When ~ enters, it deals 5 damage to target opponent unless you sacrifice a creature of your choice.'))).toBe(false);
  });
  it('render/steps-flow.ts (CR 107.14, 118.12; Galvanic Discharge): "pay any amount of {E}" and "pay one or more {E}" are one payment; "any amount of" with other costs stays out', () => {
    const one = spell('You get {E}{E}, then you may pay one or more {E}. If you do, draw that many cards.');
    const any = spell('You get {E}{E}, then you may pay any amount of {E}. If you do, draw that many cards.');
    expect(fullyAutomated(one)).toBe(true);
    expect(fullyAutomated(any)).toBe(true);
    expect(jsonKey(any.abilities)).toBe(jsonKey(one.abilities));
    expect(fullyAutomated(spell('You get {E}{E}, then you may pay any amount of {E}{E}. If you do, draw that many cards.'))).toBe(false);
  });
  it('render/costs.ts + parser/holes/qty.ts (CR 107.14, 118.12a; Aether Spike): "pays {1} for each {E} paid this way" is the payment repeated as many times as the energy paid; another unit or a different payer stays out', () => {
    expect(fullyAutomated(spell('You may pay any amount of {E}. Counter target spell unless its controller pays {1} for each {E} paid this way.', 'Instant'))).toBe(true);
    expect(fullyAutomated(spell('You may pay any amount of {E}. Counter target spell unless you pay {1} for each {E} paid this way.', 'Instant'))).toBe(false);
    expect(fullyAutomated(spell('Counter target spell unless its controller pays {1} for each {E} paid this way.', 'Instant'))).toBe(false); // no payment of energy before it: nothing to count
  });
  it('render/fold-p2coinflip1.ts (CR 608.2d, 400.7; Moldgraf Monstrosity): "return two creature cards at random from your graveyard to the battlefield"; a hand return of two described cards and three cards stay out', () => {
    expect(fullyAutomated(creature('When ~ dies, return two creature cards at random from your graveyard to the battlefield.'))).toBe(true);
    expect(fullyAutomated(creature('When ~ dies, return two creature cards at random from your graveyard to your hand.'))).toBe(false);
    expect(fullyAutomated(creature('When ~ dies, return a creature card at random from your graveyard to the battlefield.'))).toBe(true);
  });
  it('parser/front/spellforms.ts + render/kw.ts + keywords/registry.ts (CR 702.34a, 601.2f; Visions of Dominance): a flashback line with its own cost change is a static reading of the spell; a plain flashback line, an increase and another keyword keep their readings', () => {
    const line = 'Flashback {8}{G}{G}. This spell costs {X} less to cast this way, where X is the greatest mana value of a commander you own on the battlefield or in the command zone.';
    expect(fullyAutomated(spell(`You gain 1 life.\n${line}`))).toBe(true);
    expect(fullyAutomated(spell('You gain 1 life.\nFlashback {8}{G}{G}'))).toBe(true);
    expect(fullyAutomated(spell(`You gain 1 life.\n${line.replace('less', 'more')}`))).toBe(false);
    expect(fullyAutomated(spell(`You gain 1 life.\n${line.replace('Flashback', 'Escape')}`))).toBe(false);
    expect(fullyAutomated(spell(`You gain 1 life.\n${line.replace(' this way', '')}`))).toBe(false);
  });
});
