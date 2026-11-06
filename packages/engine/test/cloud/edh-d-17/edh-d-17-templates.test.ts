/**
 * Commander coordinator D, round edh-d-17 (EDHREC ranks 13,751-15,000, fifth pass): the template data of parser/templates/zz-cloud/edh-d-17.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-d-17-scenarios.test.ts.
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
import edhD17 from '../../../src/parser/templates/zz-cloud/edh-d-17.json';
import review from '../../m5/golden/cards/edh-d-17-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD17 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27, more cards 2026-10-30)
  'eff.edhd17.then.return.landOrKind.yourHand': ['Roots of Wisdom'],
  'eff.edhd17.dig.putAll.revealed.chosen.hand.rest.bottomAny': ['Brass Herald'],
  'eff.edhd17.prevent.all.toObj.dur.byChosenColor': ['Avacyn, Guardian Angel'],
  'eff.edhd17.prevent.all.toPlayerOrPlaneswalker.dur.byChosenColor': ['Avacyn, Guardian Angel'],
}
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || /^As this /.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-17 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-17.json, path order: after edh-d-12.json, before edh-d-2.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-17.json');
    expect(files.indexOf('zz-cloud/edh-d-17.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-12.json'));
    expect(files.indexOf('zz-cloud/edh-d-17.json')).toBeLessThan(files.indexOf('zz-cloud/edh-d-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhd17.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm|dl)\.edhd17\./);
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

describe('edh-d-17 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-d-17 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-17 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-d-17 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-17 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const FIXED_WORDING = new Set<string>(['eff.edhd17.dig.putAll.revealed.chosen.hand.rest.bottomAny']); // its first line, "As this creature enters, choose a creature type.", is the common choose line of the linked ability; the dig line differs
    const verbatim = MECH.filter((t) => !FIXED_WORDING.has(t.id)).flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-d-17 renderer, lowering and engine changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Elf') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  it('parser/holes/qty.ts, render/qty.ts (CR 208.1, 608.2c, 701.21a): "the total power of the creatures sacrificed this way" is the sum over the creatures one earlier sacrifice bound; "the greatest power among" keeps its reading, and a total of creatures not sacrificed is not it', () => {
    const t = spell('Each player sacrifices a creature of their choice. Create an X/X black Demon creature token with flying, where X is the total power of the creatures sacrificed this way.');
    expect(fullyAutomated(t)).toBe(true);
    expect(JSON.stringify(t.abilities)).toContain('"sum":true');
    expect(fullyAutomated(spell('Each player sacrifices a creature of their choice. Create an X/X black Demon creature token with flying, where X is the greatest power among creatures sacrificed this way.'))).toBe(true);
    expect(fullyAutomated(spell('Each player sacrifices a creature of their choice. Create an X/X black Demon creature token with flying, where X is the total power of the creatures blorfty this way.'))).toBe(false);
    expect(fullyAutomated(spell('Create an X/X black Demon creature token with flying, where X is the total power of the creatures sacrificed this way.'))).toBe(false);
  });
  it('render/fold.ts#putAllFromGroupAndRest (CR 607.2d, 701.20a): "creature cards of the chosen type revealed this way" goes into your hand only; the same words onto the battlefield are not read', () => {
    const base = 'As this creature enters, choose a creature type.\nWhen this creature enters, reveal the top four cards of your library. Put all creature cards of the chosen type revealed this way ';
    expect(fullyAutomated(creature(`${base}into your hand and the rest on the bottom of your library in any order.`, 'Artifact Creature — Golem'))).toBe(true);
    expect(fullyAutomated(creature(`${base}onto the battlefield and the rest on the bottom of your library in any order.`, 'Artifact Creature — Golem'))).toBe(false);
  });
  it('parser/holes/filter.ts, render/np.ts (CR 205.2a, 715.1): "an instant card, a sorcery card, or a card that has an Adventure" is a list of three kinds; two kinds with "or" and a repeated kind are not that reading', () => {
    const cost = (kinds: string) => creature(`This spell costs {1} less to cast for each card you own in exile and in your graveyard that's ${kinds}.`);
    expect(fullyAutomated(cost('an instant card, a sorcery card, or a card that has an Adventure'))).toBe(true);
    expect(fullyAutomated(cost('an instant card, a sorcery card, or a card that has a blorfty'))).toBe(false);
    expect(fullyAutomated(cost('an instant card, an instant card, or a card that has an Adventure'))).toBe(false);
  });
  it('render/np.ts (CR 406.1, 108.3): "cards with flashback you own in exile" counts the cards in exile with the keyword that you own; an opponent\'s and the graveyard are other counts', () => {
    const power = (zone: string) => creature(`This creature's power and toughness are each equal to the number of cards with flashback you own ${zone}.`);
    expect(fullyAutomated(power('in exile'))).toBe(true);
    expect(fullyAutomated(power('in blorfty'))).toBe(false);
  });
  it('render/fold-edhd17.ts (CR 707.2, 109.2): "Each other creature becomes a copy of target nonlegendary creature until end of turn" names the target once, after the copy words; a duration missing is not that reading', () => {
    expect(fullyAutomated(spell('Each other creature becomes a copy of target nonlegendary creature until end of turn.'))).toBe(true);
    expect(fullyAutomated(spell('Each other creature becomes a copy of target nonlegendary creature.'))).toBe(false);
  });
});
