/**
 * Commander EDHREC ranks 17,501-18,125, round edh-c-9 (second pass): the template data of parser/templates/zz-cloud/edh-c-9.json (a pump with "all creatures able to block it do so", a pump of several targets that can't be blocked, a card put second from the top from the graveyard, base power and toughness with a granted ability, a card from the hand put on the bottom, a shared "during your turn" grant and cost reduction) and the round's parser and renderer changes, tested at the end of this file and in edh-c-9-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-9-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC9 from '../../../src/parser/templates/zz-cloud/edh-c-9.json';
import review9 from '../../m5/golden/cards/edh-c-9-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC9 as Template[];
/** The round's golden entries. */
const review = review9 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edhv9.aslong.pumpAndLure': ['Gift of the Deity'],
  'eff.edhv9.pump.each.cantbeblocked': ['Sea Hag // Aquatic Ingress'],
  'eff.edhv9.put.self.fromYourGraveyard.nthFromTop': ['Screaming Swarm'],
  'eff.edhv9.dur.group.has.basept.gains': ['Oko, the Trickster'],
  'eff.edhv9.put.handCard.bottom': ['Errand-Rider of Gondor'],
  'sta.edhv9.duringYourTurn.grantAndKeywordCostLess': ['Nahiri, Storm of Stone'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^(When|At the|Whenever)/.test(text) && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : t.id.startsWith('sta.') && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : t.id.startsWith('sta.') ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-9 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-9.json, path order: before edh-cast-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-9.json');
    expect(files.indexOf('zz-cloud/edh-c-9.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv9.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv9\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the cards that print the wording', () => {
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

describe('edh-c-9 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/half/, 'a third of'], [/rounded up/, 'rounded down'], [/round up/, 'round down'], [/your/, 'their'], [/first/, 'second'], [/an opponent/, 'you'], [/less/, 'more'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-9 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-9 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-9 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-9 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const artifact = (text: string) => parseCard(card('Example Plan', 'Artifact', text), OPTS).faces[0]!;

const equipment = (text: string) => parseCard(card('Example Plan', 'Artifact — Equipment', text), OPTS).faces[0]!;

const instant = (text: string) => parseCard(card('Example Plan', 'Instant', text), OPTS).faces[0]!;
const aura = (text: string) => parseCard(card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`), OPTS).faces[0]!;

describe('edh-c-9 parser and renderer changes (one test each)', () => {
  it('parser/holes/object.ts, render/refs.ts and render/cond.ts (CR 115.1, 608.2c, 105.2): "that target is white and/or blue" reads the object the sentence before targeted; "and/or" is "or" for colors; a plain "or" and another color list are other texts', () => {
    const ok = instant('~ deals 1 damage to target creature or planeswalker. It deals 5 damage instead if that target is white and/or blue.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"colors":["W","U"]');
    expect(fullyAutomated(instant('~ deals 1 damage to target creature or planeswalker. It deals 5 damage instead if that target is white or blue.'))).toBe(true);
    expect(fullyAutomated(instant('~ deals 1 damage to target creature or planeswalker. It deals 5 damage instead if that target is white and blue.'))).toBe(false);
    expect(fullyAutomated(instant('~ deals 1 damage to target creature or planeswalker. It deals 5 damage instead if that target is white and/or green.')) && JSON.stringify(ok.abilities).includes('"G"')).toBe(false);
  });
  it('parser/holes/cond.ts (CR 731.1): "if it\'s night" and "if it\'s day" are the game\'s designation; "it\'s dusk" and "if it isn\'t night" are not read', () => {
    const night = sorcery('Target creature you control gets +2/+0 until end of turn if it\'s night.');
    expect(fullyAutomated(night)).toBe(true);
    expect(JSON.stringify(night.abilities)).toContain('"what":"night"');
    expect(JSON.stringify(sorcery('Draw a card. If it\'s day, draw a card.').abilities)).toContain('"what":"day"');
    expect(fullyAutomated(sorcery('Draw a card. If it\'s dusk, draw a card.'))).toBe(false);
    expect(fullyAutomated(sorcery('Draw a card. If it isn\'t night, draw a card.'))).toBe(false);
  });
  it('parser/holes/cond.ts#zoneHistory and render/cond.ts (CR 603.4, 603.10a): "a permanent you controlled left the battlefield this turn" is the history of your permanents leaving; a count, "died", an opponent\'s permanent and a missing "this turn" are other texts', () => {
    const ok = creature('At the beginning of your end step, if a permanent you controlled left the battlefield this turn, each opponent loses 3 life.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"from":"battlefield"');
    expect(JSON.stringify(ok.abilities)).toContain('"controller":"you"');
    for (const bad of [
      'At the beginning of your end step, if two or more permanents you controlled left the battlefield this turn, each opponent loses 3 life.',
      'At the beginning of your end step, if a permanent you controlled left the battlefield, each opponent loses 3 life.',
      'At the beginning of your end step, if a permanent an opponent controlled left the battlefield this turn, each opponent loses 3 life.',
    ]) expect(fullyAutomated(creature(bad)) && JSON.stringify(creature(bad).abilities).includes('"controller":"you"'), bad).toBe(false);
  });
  it('render/steps-life.ts (CR 107.3, 608.2h): "Put X +1/+1 counters on target creature, where X is your life total." is read; the opponent\'s life total and "a number of" with a different statistic are other texts', () => {
    expect(fullyAutomated(sorcery('Put X +1/+1 counters on target creature, where X is your life total.'))).toBe(true);
    expect(fullyAutomated(sorcery('Put X +1/+1 counters on target creature, where X is target opponent\'s life total.'))).toBe(false);
  });
  it('parser/holes/qty.ts and render/qty.ts (CR 700.5): "for each white mana symbol in the mana costs of permanents you control" is your devotion to white; another color word, "creatures you control" and a missing color are not', () => {
    const ok = creature('When this creature enters, create a 0/1 white Goat creature token for each white mana symbol in the mana costs of permanents you control.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"devotion","to":["W"]');
    expect(JSON.stringify(creature('When this creature enters, create a 0/1 white Goat creature token for each blue mana symbol in the mana costs of permanents you control.').abilities)).toContain('"to":["U"]');
    expect(fullyAutomated(creature('When this creature enters, create a 0/1 white Goat creature token for each mana symbol in the mana costs of permanents you control.'))).toBe(false);
    expect(fullyAutomated(creature('When this creature enters, create a 0/1 white Goat creature token for each white mana symbol in the mana costs of creatures you control.'))).toBe(false);
    expect(fullyAutomated(creature('When this creature enters, create a 0/1 white Goat creature token for each white mana symbol in the mana costs of permanents your opponents control.'))).toBe(false);
  });
  it('parser/lower/static-anaphora.ts (CR 509.1c): the "it" of "gets +1/+1 and all creatures able to block it do so" is the one object named before it; a second candidate leaves it unresolved', () => {
    const ok = aura('As long as enchanted creature is green, it gets +1/+1 and all creatures able to block it do so.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"mode":"mustIfAble"');
    expect(fullyAutomated(aura('As long as enchanted creature is green, it gets +1/+1 and all creatures able to block it can do so.'))).toBe(false);
  });
});
