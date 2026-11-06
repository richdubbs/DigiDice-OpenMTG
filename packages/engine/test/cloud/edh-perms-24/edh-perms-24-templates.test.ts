/**
 * Commander lane edh-perms, round edh-perms-24: the template data of parser/templates/zz-cloud/edh-perms-24.json (others enter with a computed number of counters and as a subtype,
 * "Kicker {X}. X can't be 0.", a choice between removing a chosen counter and putting another, a choice between tapping and untapping, "it and others each get a pump and gain",
 * a token replacement that chooses between two token descriptions) and the round's parser, lowering and renderer changes, tested at the end of this
 * file and in edh-perms-24-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { instantiate, validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm24 from '../../../src/parser/templates/zz-cloud/edh-perms-24.json';
import review from '../../m5/golden/cards/edh-perms-24-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm24 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards of the EDHREC top 5,000 (or elsewhere only on cards out of reach), with their template tests (G9, G2) and played scenarios. Listed in
 * the round's record for the owner (DECIDED BY DEFAULT, owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'rep.edhpm24.others.enters.numberAdditionalCounters.andSubtype': ['Master Biomancer'],
  'kw.edhpm24.kicker.x.notZero': ['Thieving Skydiver'],
  'eff.edhpm24.instructionChoice.removeOrPutThatCounter': ['Clockspinning'],
  'eff.edhpm24.instructionChoice.tapOrUntap': ['Turnabout'],
  'eff.edhpm24.objAnd.objs.eachGet.pt.andGain': ['Haunted One'],
  'rep.edhpm24.tokens.mayInstead.thatMany.orThatMany': ['Jinnie Fay, Jetmir\'s Second'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind (an Aura for "Enchant ...", a trigger or "{cost}:" is a permanent's, an effect on its own a spell's). */
function exampleCard(text: string): OracleCard {
  if (/^\{[^}]*\}[^:]*:/.test(text)) return card('Example Relic', 'Artifact', text);
  if (/^(Each |If you would |Kicker |When |Whenever |At )/.test(text)) return card('Example Brute', 'Creature — Elf Warrior', text, { power: '2', toughness: '2' });
  return card('Example Volley', 'Sorcery', text);
}
const parsedWith = (_t: Template, text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('edh-perms-24 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-24.json, path order: after edh-perms-2, before edh-perms-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-24.json');
    expect(files.indexOf('zz-cloud/edh-perms-24.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-2.json'));
    expect(files.indexOf('zz-cloud/edh-perms-24.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids end with the round code edhpm24', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|rep|kw)\.edhpm24\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
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

describe('edh-perms-24 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/in addition to its other types/, 'instead of its other types'], [/ and as /, ' or as '], [/X can't be 0/, "X can't be 2"], [/Kicker/, 'Multikicker'], [/ or put another of those counters on /, ' and put another of those counters on '],
    [/, or untap/, ', then untap'], [/ each get /, ' get '], [/ and gain /, ' and lose '], [/ you may instead /, ' instead '], [/ or that many /, ' and that many '], [/you control/, 'an opponent controls'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-perms-24 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-24 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter kind is any word (Oracle invents them)
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

describe.skipIf(index === null)('edh-perms-24 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-24 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-perms-24 parser, lowering and renderer changes (one test each)', () => {
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  const permanent = (text: string, type = 'Creature — Elf Warrior') => parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
  it('parser/parse.ts#cardHasXCost + keywords/data/kicker.json (CR 107.3, 601.2b, 702.33a): "Kicker {X}. X can\'t be 0." announces X for the kicker (xMin 1); other minimums or other keywords are not read', () => {
    const ok = permanent("Kicker {X}. X can't be 0.\nWhen this creature enters, if it was kicked, draw X cards.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"xMin":1');
    expect(fullyAutomated(permanent("Kicker {X}. X can't be 1.\nWhen this creature enters, if it was kicked, draw X cards."))).toBe(false);
    expect(fullyAutomated(permanent("Multikicker {X}. X can't be 0.\nWhen this creature enters, if it was kicked, draw X cards."))).toBe(false);
    expect(fullyAutomated(permanent('Kicker {X}\nWhen this creature enters, if it was kicked, draw X cards.'))).toBe(true); // edh-next-23 (Verdeloth the Ancient): a bare "Kicker {X}" announces X too (CR 107.3, 702.33a), with no minimum
  });
  it('effects/handlers/counters.ts + render/steps-life.ts (CR 122.1, 608.2d): "remove that counter" is the kind chosen by the choose-a-counter step before it; alone it is not read', () => {
    expect(fullyAutomated(spell('Choose a counter on target creature. Remove that counter from that creature or put another of those counters on it.'))).toBe(true);
    expect(fullyAutomated(spell('Remove that counter from target creature or put another of those counters on it.'))).toBe(false);
  });
  it('parser/holes/object.ts (CR 608.2c): "that permanent or card" is the object of a target "permanent or suspended card" only', () => {
    expect(fullyAutomated(spell('Choose a counter on target permanent or suspended card. Remove that counter from that permanent or card or put another of those counters on it.'))).toBe(true);
    expect(fullyAutomated(spell('Choose a counter on target creature. Remove that counter from that permanent or card or put another of those counters on it.'))).toBe(false);
  });
  it('render/np.ts (CR 607.2d): the chosen type may come before or after the controller, "permanents of the chosen type target player controls"', () => {
    expect(fullyAutomated(spell('Choose artifact, creature, or land. Tap all untapped permanents of the chosen type target player controls, or untap all tapped permanents of that type that player controls.'))).toBe(true);
  });
  it('render/mods.ts (review): "it and other creatures" is read only when the trigger\'s event object is the source itself; for another creature "other" would mean other than that creature', () => {
    expect(fullyAutomated(permanent('Whenever this creature attacks, it and other Elves you control each get +1/+0 and gain trample until end of turn.'))).toBe(true);
    expect(fullyAutomated(permanent('Whenever a creature you control attacks, it and other creatures you control each get +1/+0 and gain trample until end of turn.'))).toBe(false);
  });
  it('the kicker needs the X (review): "Kicker {2}{G}. X can\'t be 0." is not read', () => {
    expect(fullyAutomated(permanent("Kicker {2}{G}. X can't be 0."))).toBe(false);
  });
});
