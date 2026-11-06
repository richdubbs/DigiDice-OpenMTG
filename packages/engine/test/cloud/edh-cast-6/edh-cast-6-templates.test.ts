/**
 * Commander lane edh-cast, round edh-cast-6: the template data of parser/templates/zz-cloud/edh-cast-6.json ("creature cards you own that aren't on the battlefield have flash",
 * "noncreature spells your opponents cast cost {2} more to cast until your next turn", "put a +1/+1 counter or a
 * loyalty counter on it", "spells you cast with mana value 5 or greater cost {1} less to cast and can't be countered", "abilities you activate that aren't mana abilities cost {2}
 * less to activate ...", "whenever a spell or ability you control counters a spell") and the parser, renderer and engine changes of the round (one test each at the end). Guard G9
 * (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10),
 * checked against the local index when it is present. The behavior is in edh-cast-6-scenarios.test.ts. CR cites checked against the Comprehensive Rules 2026-09-25
 * (media.wizards.com), see the record.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCast6 from '../../../src/parser/templates/zz-cloud/edh-cast-6.json';
import review from '../../m5/golden/cards/edh-cast-6-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCast6 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT, owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'sta.edhc6.cardsOwn.notBattlefield.haveFlash': ['Teferi, Mage of Zhalfir'],
  'eff.edhc6.dur.costMore.opp.after': ['Elspeth Conquers Death'],
  'eff.edhc6.counters.choice2.eachNamed': ['Elspeth Conquers Death'],
  'cm.edhc6.spells.less.mv.cantBeCountered': ['Thryx, the Sudden Storm'],
  'cm.edhc6.abilities.notMana.less.floorOne': ['Zirda, the Dawnwaker'],
  'trg.edhc6.youControl.counters.spell': ['Baral, Chief of Compliance'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, triggered). */
const SPELL = new Set<string>(['eff.edhc6.dur.costMore.opp.after', 'eff.edhc6.counters.choice2.eachNamed']);
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id)
    ? parseCard(card('Example Plan', 'Sorcery', text), OPTS)
    : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-cast-6 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-cast-6.json, path order: after edh-cast-3, before edh-combat-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-cast-6.json');
    expect(files.indexOf('zz-cloud/edh-cast-6.json')).toBeGreaterThan(files.indexOf('zz-cloud/cmd5.json'));
    expect(files.indexOf('zz-cloud/edh-cast-6.json')).toBeLessThan(files.indexOf('zz-cloud/edh-combat-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhc6.* (or sta., cm., trg.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg)\.edhc6\./);
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

describe('edh-cast-6 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bless\b/, 'more'], [/\bmore\b/, 'less'], [/\bgreater\b/, 'less'], [/\bown\b/, 'control'], [/\byou\b/, 'your opponents'], [/\bflash\b/, 'haste'], [/\bcounters\b/, 'copies'],
    [/\bcountered\b/, 'copied'], [/\bcreature\b/i, 'land'], [/\bspell\b/, 'ability'], [/\bnext turn\b/, 'turn'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-cast-6 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-cast-6 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any word (CR 122.1): "a blorfty counter" is a counter kind, not nonsense
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

describe.skipIf(index === null)('edh-cast-6 design 6.10 (local index): synthetic examples', () => {
  it('no edh-cast-6 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('edh-cast-6 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Creature — Golem', name = 'Example Relic') => parseCard(card(name, type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
  it('render/stat.ts (CR 601.3b, 702.8a, 109.5): "<type> cards you own that aren\'t on the battlefield have flash" is the permission of each player for the spells of that type you own; another owner, another zone or another keyword is not that reading', () => {
    expect(fullyAutomated(face("Creature cards you own that aren't on the battlefield have flash."))).toBe(true);
    expect(fullyAutomated(face("Creature cards you control that aren't on the battlefield have flash."))).toBe(false);
    expect(fullyAutomated(face("Red creature cards you own that aren't on the battlefield have flash."))).toBe(false);
    expect(fullyAutomated(face("Creature cards you own that aren't on the battlefield have haste."))).toBe(false);
  });
  it('render/stat.ts (CR 601.2f, 202.3; family plain-spells-mana-value-after-caster): "Spells you cast with mana value N or greater cost {1} less" (spells of any kind) passes the gate; less than N or other casters do not', () => {
    expect(fullyAutomated(face('Spells you cast with mana value 5 or greater cost {1} less to cast.'))).toBe(true);
    expect(fullyAutomated(face('Spells you cast with mana value 5 or less cost {1} less to cast.'))).toBe(false);
    expect(fullyAutomated(face('Spells your opponents cast with mana value 5 or greater cost {1} less to cast.'))).toBe(false);
  });
  it('render/stat.ts (CR 601.2f, 101.2, 701.6a; family cost-less-and-cant-be-countered): the reduction and "can\'t be countered" of the same spells you cast are one sentence; a different second half is not', () => {
    expect(fullyAutomated(face("Spells you cast with mana value 5 or greater cost {1} less to cast and can't be countered."))).toBe(true);
    expect(fullyAutomated(face("Creature spells you cast with mana value 5 or greater cost {1} less to cast and can't be countered."))).toBe(true);
    expect(fullyAutomated(face("Spells you cast with mana value 5 or greater cost {1} less to cast and can't be copied."))).toBe(false);
  });
  it('render/stat.ts, statics/costmods.ts (CR 605.1a, 602.2b): `exceptMana` is the abilities that are not mana abilities; the same words with another caster, a keyword or an increase are other sentences', () => {
    const floor = ' This effect can\'t reduce the mana in that cost to less than one mana.';
    expect(fullyAutomated(face(`Abilities you activate that aren't mana abilities cost {2} less to activate.${floor}`))).toBe(true);
    expect(fullyAutomated(face(`Abilities you activate that aren't mana abilities cost {2} more to activate.${floor}`))).toBe(false);
    expect(fullyAutomated(face(`Abilities your opponents activate that aren't mana abilities cost {2} less to activate.${floor}`))).toBe(false);
    expect(fullyAutomated(face(`Equip abilities you activate that aren't mana abilities cost {2} less to activate.${floor}`))).toBe(false);
  });
  it('render/fold-stddsk.ts (CR 122.1b, 608.2d): "put a <kind> counter or a <kind> counter on it" is the choice among the kinds; "and", a number of counters or a group is not', () => {
    expect(fullyAutomated(face('Put a +1/+1 counter or a loyalty counter on target creature you control.', 'Sorcery'))).toBe(true);
    expect(fullyAutomated(face('Put a +1/+1 counter and a loyalty counter on target creature you control.', 'Sorcery'))).toBe(true); // the two-kinds "and" template of t28 (both counters, no choice)
    const both = JSON.stringify(face('Put a +1/+1 counter and a loyalty counter on target creature you control.', 'Sorcery').abilities);
    const either = JSON.stringify(face('Put a +1/+1 counter or a loyalty counter on target creature you control.', 'Sorcery').abilities);
    expect(either).toContain('chooseValue');
    expect(both).not.toContain('chooseValue');
    expect(fullyAutomated(face('Put a +1/+1 counter or two loyalty counters on target creature you control.', 'Sorcery'))).toBe(false);
  });
  it('triggers/normalize.ts, render/evt.ts (CR 701.6a, 603.2): the counter action carries the player in control of the countering spell or ability; only "a spell or ability you control counters a spell" is said', () => {
    expect(fullyAutomated(face('Whenever a spell or ability you control counters a spell, draw a card.'))).toBe(true);
    expect(fullyAutomated(face('Whenever a spell or ability an opponent controls counters a spell, draw a card.'))).toBe(false);
    expect(fullyAutomated(face('Whenever a spell or ability you control counters an ability, draw a card.'))).toBe(false);
  });
});
