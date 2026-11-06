/**
 * Commander lane edh-c, round edh-c-33 (EDHREC ranks 24,501-25,000): the template data of parser/templates/zz-cloud/edh-c-33.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-c-33-scenarios.test.ts.
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
import edhC33 from '../../../src/parser/templates/zz-cloud/edh-c-33.json';
import review from '../../m5/golden/cards/edh-c-33-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC33 as Template[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 30,000 that print each wording and are full
  'eff.edhv33.tap.anyNumber.creatures.may': ['Siege Striker'],
  'eff.edhv33.gain.perTappedThisWay': ['Harmony of Nature'],
  'eff.edhv33.return.upTo.theirOwnersHand': ['Kazandu Stomper'],
  'eff.edhv33.put.opponentGraveyard.bottomTheirLibrary': ['Landscaper Colos'],
  'sta.edhv33.aslong.self.extrablock': ['Foriysian Totem'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'ability' ? card('Example Beast', 'Creature — Beast', text, { power: '2', toughness: '2' }) : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-c-33 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-33.json, path order: after edh-c-3, before edh-perms-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-33.json');
    expect(files.indexOf('zz-cloud/edh-c-33.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-3.json'));
    expect(files.indexOf('zz-cloud/edh-c-33.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 33; ids are *.edhv33.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm)\.edhv33\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(33);
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

describe('edh-c-33 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bupTo\b/, 'x'], [/\bblue\b/, 'x'], [/\bplay lands\b/, 'x'], [/\bcreature tapped\b/, 'x'], [/\blife\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-33 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-33 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-33 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-33 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-c-33 renderer, lowering and parser changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  it('parser/holes/edhv33.ts + render/edhv33.ts (CR 508.1, 603.4): "didn\'t attack this turn" is about the source only; another object or a different verb stays manual', () => {
    expect(fullyAutomated(creature('At the beginning of your end step, if this creature didn\'t attack this turn, put a +1/+1 counter on it.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of your end step, if this creature didn\'t block this turn, put a +1/+1 counter on it.'))).toBe(false);
    expect(fullyAutomated(creature('At the beginning of your end step, if target creature didn\'t attack this turn, put a +1/+1 counter on it.'))).toBe(false);
  });
  it('parser/holes/edhv33.ts (CR 508.1, 509.1, 603.4): "attacked or blocked this turn" is both events of the source; "or" with a third event stays manual', () => {
    expect(fullyAutomated(creature('At the beginning of each end step, if this creature attacked or blocked this turn, its owner shuffles it into their library.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of each end step, if this creature attacked or died this turn, its owner shuffles it into their library.'))).toBe(false);
  });
  it('parser/holes/edhv33.ts (CR 305.1, 603.4): "you didn\'t play a land this turn"; another player or "cast" stays manual', () => {
    expect(fullyAutomated(creature('At the beginning of your end step, if you didn\'t play a land this turn, you may draw a card.', 'Artifact'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of your end step, if you didn\'t discard a card this turn, you may draw a card.', 'Artifact'))).toBe(false);
    expect(fullyAutomated(creature('At the beginning of your end step, if an opponent didn\'t play a land this turn, you may draw a card.', 'Artifact'))).toBe(false);
  });
  it('parser/holes/edhv33.ts (CR 725.1, 508.1b): "defending player is the monarch" as the condition of an attack restriction; another player stays manual', () => {
    expect(fullyAutomated(creature('This creature can\'t attack unless defending player is the monarch.'))).toBe(true);
    expect(fullyAutomated(creature('This creature can\'t attack unless target player is the monarch.'))).toBe(false);
  });
  it('render/fold.ts#chooseThenTapAny (CR 701.26a): "you may tap any number of untapped creatures you control" and the plain "tap any number" are one choice; other filters stay manual', () => {
    expect(fullyAutomated(creature('Whenever this creature attacks, you may tap any number of untapped creatures you control. This creature gets +1/+1 until end of turn for each creature tapped this way.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever this creature attacks, tap any number of untapped creatures you control. This creature gets +1/+1 until end of turn for each creature tapped this way.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever this creature attacks, you may tap any number of untapped artifacts you control. This creature gets +1/+1 until end of turn for each creature tapped this way.'))).toBe(false);
  });
  it('render/fold.ts (CR 701.24a, 400.3): "its owner shuffles it into their library" and "~\'s owner shuffles it into their library" for the object itself', () => {
    expect(fullyAutomated(creature('At the beginning of each end step, if this creature attacked or blocked this turn, its owner shuffles it into their library.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of each end step, this creature\'s owner shuffles it into their library.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of each end step, this creature\'s owner shuffles it into their hand.'))).toBe(false);
  });
  it('render/steps-zones.ts (CR 400.3): "on the bottom of their library" for a card of an opponent\'s graveyard; "your graveyard" or "their hand" stay different', () => {
    expect(fullyAutomated(spell('Put target card from an opponent\'s graveyard on the bottom of their library.'))).toBe(true);
    expect(fullyAutomated(spell('Put target card from your graveyard on the bottom of their library.'))).toBe(false);
  });
});
