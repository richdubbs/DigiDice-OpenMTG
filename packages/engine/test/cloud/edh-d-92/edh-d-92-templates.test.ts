/**
 * edh-d-92 (Commander coordinator D, band 5,001-10,000, group counters): the template data of parser/templates/zz-cloud/edh-d-92.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-d-92-scenarios.test.ts.
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
import edhD92 from '../../../src/parser/templates/zz-cloud/edh-d-92.json';
import review from '../../m5/golden/cards/edh-d-92-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD92 as Template[];
const MECH_COUNT = 9;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the card of the EDHREC band 5,001-10,000 that prints the wording and is full (each wording is printed on that one card; owner's standing rule 2026-10-27)
  'eff.edhd92.exile.filterCardFromEachGraveyard': ['Summon: Esper Valigarmanda'],
  'eff.edhd92.cast.linkedExiled.anyType': ['Summon: Esper Valigarmanda'],
  'sta.edhd92.yourTurn.group.are.subtypes.have': ["Gourmand's Talent"],
  'eff.edhd92.counters.doubleOnSelf.ifPowerAtMost': ['Lily Bowen, Raging Grandma'],
  'eff.edhd92.counters.removeAllButOne.gainPerRemoved': ['Lily Bowen, Raging Grandma'],
  'eff.edhd92.amassZombie.thenArmyDealsOwnPower': ['Widespread Brutality'],
  'eff.edhd92.player.tapsUntapped.perCounterOnSelf': ['Tangle Wire'],
  'eff.edhd92.chooseTarget.permanentOrSuspended.mayRemoveOrPutTime': ["Jhoira's Timebug"],
  'eff.edhd92.exileTop.nonlandTimeCountersMv.gainsSuspend': ['The Parting of the Ways'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^[+\u2212-]\d+:/.test(text) || /loyalty counter/.test(text) ? card('Example Sage', 'Legendary Planeswalker — Example', text, { loyalty: '4' }) :
  /enchanted (creature|land|artifact|permanent|enchantment)/.test(text) ? card(
    'Example Boon', 'Enchantment — Aura', text) :
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-92 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-92.json, path order: after edh-d-9) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-92.json');
    expect(files.indexOf('zz-cloud/edh-d-92.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-9.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhd92.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhd92\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
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

describe('edh-d-92 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\beach graveyard\b/, "each opponent's graveyard"], [/\bmana of any type\b/, 'mana of any color'], [/\bin addition to their other types and have\b/, 'and have'], [/\b16 or less\b/, '16 or greater'],
    [/\ball but one\b/, 'all'], [/\b1 life for each\b/, '2 life for each'], [/\bits power to\b/, 'its toughness to'], [/\buntapped\b/, 'tapped'], [/\bremove a time counter from it or put another\b/, 'put another'],
    [/\bequal to its mana value\b/, 'equal to its power'], [/\bnonland card\b/, 'creature card'], [/\byou own\b/, 'an opponent owns'],
  ];

  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-92 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-92 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // an invented word before "counter" is a counter kind (CR 122.1): any word names one
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 120_000); // like the other rounds' G2 guards: one parse per word of each example
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-d-92 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-92 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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





describe('edh-d-92 parser, lowering and lint changes (one test each)', () => {
  const face = (name: string, type: string, text: string, pt?: [string, string]) => parseCard(card(name, type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
  it('lower/ability.ts LINKED_EXILED_CARD + parse.ts#exiledCardLinkable (CR 607.2a): "the exiled card" of an ability that exiles nothing itself is the linked exile', () => {
    const f = face('Example Warden', 'Creature — Human Cleric', 'When Example Warden enters, exile target creature an opponent controls until Example Warden leaves the battlefield.\nWhenever Example Warden attacks, target Human gets +X/+X until end of turn, where X is the power of the exiled card.', ['2', '2']);
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities[1])).toContain('"of":{"ref":"linked","link":"exiled"}');
  });
  it('review fix (Summoner\'s Egg, Clone Shell): with a bare "it" in the same ability the link is not offered, so "it" can\'t become the dying object (fail closed)', () => {
    const f = face('Example Egg', 'Artifact Creature — Construct', 'Imprint — When Example Egg enters, you may exile a card from your hand face down.\nWhen Example Egg dies, turn the exiled card face up. If it\'s a creature card, put it onto the battlefield under your control.', ['0', '4']);
    expect(fullyAutomated(f)).toBe(false);
    expect(JSON.stringify(f.abilities[1])).not.toContain('"what":{"ref":"event","role":"subject"},"to":{"zone":"battlefield"');
  });
  it('parse.ts#exiledCardLinkable: the singular "the exiled card" is not linked to an instruction that exiles several cards (p2-refs-1\'s near misses stay refused)', () => {
    expect(fullyAutomated(face('Example Hoarder', 'Creature — Rat', 'When Example Hoarder enters, exile up to two target artifacts.\nWhen Example Hoarder dies, return ~ and the exiled card to their owner\'s hand.', ['1', '1']))).toBe(false);
    expect(fullyAutomated(face('Example Hoarder', 'Creature — Rat', 'When Example Hoarder enters, exile target artifact.\nWhen Example Hoarder dies, return ~ and the exiled card to their owner\'s hand.', ['1', '1']))).toBe(true);
  });
  it('model/lint-flow.ts review fix (CR 608.2d, 101.4; King Narfi\'s Betrayal): "you may exile a creature card from each graveyard" was refused here (one yes/no in the engine) and is read since edh-d-99 as one choice per graveyard; without "may" it is read', () => {
    // combined copy: edh-d-99 (King Narfi's Betrayal, render/fold-edhd99.ts#mayExileOneFromEachGraveyard) reads it as one optional choice per graveyard (chooseObjects perPlayer, min 0 max 1; CR 101.4)
    expect(fullyAutomated(face('Example Rite', 'Sorcery', 'You may exile a creature card from each graveyard.'))).toBe(true);
    expect(JSON.stringify(face('Example Rite', 'Sorcery', 'You may exile a creature card from each graveyard.').abilities)).toContain('"min":0,"max":1,"perPlayer"');
    expect(fullyAutomated(face('Example Rite', 'Sorcery', 'Exile a creature card from each graveyard.'))).toBe(true);
  });
  it('holes/filter.ts CONTROL_TAILS (CR 115.9b): "a spell that targets a creature you don\'t control" has one reading, the controller phrase on the creature', () => {
    const f = face('Example Ranger', 'Creature — Elf', 'Whenever you cast a spell that targets a creature you don\'t control, draw a card.', ['2', '2']);
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain('"targets":{"ref":"each","filter":{"types":["Creature"],"not":{"controller":"you"}}}');
  });
  it('holes/object.ts (CR 701.47c): "the Army you amassed" is the amassed Army', () => {
    const f = face('Example Muster', 'Sorcery', 'Amass Zombies 2. The Army you amassed deals 2 damage to each non-Army creature.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"source":{"ref":"bound"');
  });
  it('holes/qty.ts + rules/history.ts (CR 208.1, 700.4): "the total power of Goblins that died this turn" is the zone-change history summed by power; "the number of" stays a count', () => {
    const sum = face('Example Toll', 'Sorcery', 'Each opponent loses life equal to the total power of Goblins that died this turn.');
    expect(fullyAutomated(sum)).toBe(true);
    expect(JSON.stringify(sum.abilities)).toContain('"sum":"power"');
    expect(JSON.stringify(face('Example Toll', 'Sorcery', 'Each opponent loses life equal to the number of Goblins that died this turn.').abilities)).not.toContain('"sum"');
  });
});
