/**
 * Standard round 3, slice r3-trig (trigger conditions, tuning half): the template data of parser/templates/zz-cloud/r3-trig.json and the parser, lowering and
 * renderer support of the slice (the Event, Filter and Cond hole readings, the intervening "if" of a cast trigger, the cards' own discard and cast triggers). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6);
 * every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never
 * leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * r3-trig-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { CRITICAL_WORDS } from '../../../src/parser/lower/units';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import r3Trig from '../../../src/parser/templates/zz-cloud/r3-trig.json';
import review from '../../m5/golden/cards/cloud-r3-trig-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';
import { selfZoneMention } from '../../../src/parser/lower/trigger-zone';

const R3 = r3Trig as Template[];
const R3_COUNT = 6;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, an "As this artifact enters" on an artifact, anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (/\bthis artifact\b/.test(text)) return card('Example Relic', 'Artifact', text);
  if (t.kind === 'effect' && !text.includes(':') && !text.includes('~') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('r3-trig template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/r3-trig.json, after r3-fx.json, before std-blb.json and zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/r3-trig.json');
    expect(files.indexOf('zz-cloud/r3-trig.json')).toBeGreaterThan(files.indexOf('zz-cloud/r3-fx.json'));
    expect(files.indexOf('zz-cloud/r3-trig.json')).toBeLessThan(files.indexOf('zz-cloud/std-blb.json'));
    expect(files.indexOf('zz-cloud/r3-trig.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.r3trig.* or trg.r3trig.*', () => {
    expect(R3.length).toBe(R3_COUNT);
    for (const t of R3) {
      expect(t.id, t.id).toMatch(/^(eff|trg)\.r3trig\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: at least one hand-verified golden card that uses it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of R3.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word or phrase a pattern spells out (parser/lower/units.ts#CRITICAL_WORDS) is listed in `consumes`', () => {
    for (const t of R3) {
      const literal = ` ${t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ')} `;
      for (const w of CRITICAL_WORDS) if (literal.includes(` ${w} `)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('r3-trig guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of R3) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        // an experimental template whose wording the stable templates also lower to the same result gives way to them (design 6.9, G10: the "experimental" info
        // diagnostic names it)
        const fellBack = t.status === 'experimental' && f.diagnostics.some((d) => d.code === 'experimental' && d.message.includes(t.id));
        expect(f.templatesUsed.includes(t.id) || fellBack, `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = text.includes('\n') ? [] : [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\btarget opponent\b/, 'each opponent'], [/\btarget player\b/, 'each player'], [/\bany number of\b/, 'two'], [/\buntil end of turn\b/i, 'until your next turn'],
    [/\bwhenever you\b/, 'whenever an opponent'], [/\bor greater\b/, 'or less'], [/\bfrom you\b/, 'from an opponent'], [/\bfirst time\b/, 'second time'],
    [/\bgained life\b/, 'lost life'], [/\bmodal\b/, 'creature'], [/\bin addition to its other types\b/, 'in addition to its other colors'],
    [/\bdouble\b/i, 'triple'], [/\btriple\b/i, 'double'], [/\bgains\b/, 'loses'], [/\bodd or even\b/, 'a color'], [/\btapped and attacking\b/, 'tapped'],
    [/\ban opponent's control\b/, "its owner's control"], [/\bmay\b/, 'must'], [/\bscries\b/, 'surveils'], [/\bearthbend\b/, 'airbend'], [/\bX times\b/, 'twice'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('r3-trig guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of R3) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
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

describe('r3-trig guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of R3) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,:"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('r3-trig design 6.10 (local index): synthetic examples', () => {
  it('no r3-trig line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = R3.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

/** A one-card face for the parser checks below: the creature or spell the text is on. */
const face = (type: string, text: string) => parseCard(card('Example Brute', type, text, { power: '3', toughness: '3' }), OPTS).faces[0]!;

describe('r3-trig hole and lowering readings (no template of their own)', () => {
  it('CR 120.2, 603.2c: the Event hole reads "~ deals N or more damage" with no recipient (an occurrence total), and not a bare "permanent" (CR 109.2)', () => {
    const f = face('Creature — Spider', 'Whenever this creature deals 4 or more damage, draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"on":[{"ev":"damage","source":{"self":true},"amount":{"op":">=","value":4}}]');
    expect(fullyAutomated(face('Enchantment', 'Whenever a permanent you control deals 4 or more damage, draw a card.'))).toBe(false);
  });
  it('CR 111.1, 205.3: the Filter hole reads a comma between "nontoken" and another negation, "nontoken, non-Angel creature"', () => {
    const f = face('Enchantment', 'Whenever a nontoken, non-Angel creature you control dies, draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"token":false');
  });
  it('CR 701.9a, 113.6k, 702.35a: "When you discard this card" is automated in the graveyard and exile; with a payment on resolution it stays manual', () => {
    const f = face('Creature — Giant', 'When you discard this card, you gain 3 life.');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.abilities[0]).toMatchObject({ kind: 'triggered', zone: ['graveyard', 'exile'] });
    expect(fullyAutomated(face('Creature — Giant', 'When you discard this card, you may pay {1}. If you do, draw a card.'))).toBe(false);
  });
  it('CR 113.6k, 707.10: "When you cast this spell, copy this spell." is automated (the words "copy ~" end before a period)', () => {
    expect(fullyAutomated(face('Creature — Bird', 'When you cast this spell, copy this spell.'))).toBe(true);
  });
  it('CR 603.4: "if you\'ve cast another spell this turn" is read only in a cast trigger of the spell itself; elsewhere it is no condition this slice reads', () => {
    const sage = face('Creature — Bird', "When you cast this spell, if you've cast another spell this turn, copy this spell.");
    expect(fullyAutomated(sage)).toBe(true);
    expect(JSON.stringify(sage.abilities)).toContain('"spell":{"other":true,"zone":"stack"}');
    expect(fullyAutomated(face('Creature — Bird', "When this creature enters, if you've cast another spell this turn, draw a card."))).toBe(false);
  });
  it('CR 603.4, 606.3: "if you\'ve activated a loyalty ability this turn" is a history of the turn', () => {
    const f = face('Enchantment', "Whenever you attack, if you've activated a loyalty ability this turn, draw a card.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"event":{"ev":"activate","player":"you","ability":"loyalty"}');
  });
  it('CR 700.2, 603.3c: "the number of times you chose a mode for that spell" is read only when "that spell" is the spell of a cast trigger', () => {
    const modes = '--\n• Draw a card.\n• You gain 2 life.';
    expect(fullyAutomated(face('Enchantment', `Whenever you cast a modal spell, choose up to X, where X is the number of times you chose a mode for that spell ${modes}`))).toBe(true);
    expect(fullyAutomated(face('Enchantment', `Whenever a creature you control dies, choose up to X, where X is the number of times you chose a mode for that spell ${modes}`))).toBe(false);
  });
  it('CR 113.6m: "the number of coin counters on ~ from your graveyard" does not move or read ~ in the graveyard; "return ~ from your graveyard" still does', () => {
    expect(selfZoneMention('cast target instant card with mana value equal to the number of coin counters on ~ from your graveyard.')).toBeNull();
    expect(selfZoneMention('search your library for a card named ~ from your graveyard.')).toBeNull();
    expect(selfZoneMention('return ~ from your graveyard to your hand.')).toMatchObject({ zone: 'graveyard' });
  });
});
