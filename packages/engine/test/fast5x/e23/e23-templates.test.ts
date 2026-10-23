/**
 * FAST5X E23: the template data of parser/templates/zz-fast5x/e23.json (mana spending restrictions, CR 106.6: "spend this mana only to <clauses>" over the
 * grammar of parser/holes/spend.ts, and "this mana can't be spent to cast <spells>") and the renderer that reads them back (render/steps-cards.ts). Guard G9
 * (design 6.8): every example lowers with its template, is automated and passes the exact render gate; every counter-example does not parse or parses to
 * different JSON; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e23 from '../../../src/parser/templates/zz-fast5x/e23.json';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { compileCard } from '../../../src/index';
import { automated, bare, fullyAutomated, jsonKey, localIndex } from '../../m5/templates/support';

const E23 = e23 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
const card = (text: string) => ({ name: 'Example Spring', layout: 'normal', type_line: 'Land', oracle_text: text }) as never;
const face = (text: string) => parseCard(card(text), OPTS).faces[0]!;
const restriction = (text: string): unknown => {
  const f = face(text);
  const a = f.abilities[f.abilities.length - 1] as unknown as { effect?: { steps: { restriction?: unknown }[] } };
  return a.effect?.steps.find((x) => x.restriction !== undefined)?.restriction;
};

describe('E23 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e23.json, path order after e22.json, before e24.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e23.json');
    expect(files.indexOf('zz-fast5x/e23.json')).toBe(files.indexOf('zz-fast5x/e22.json') + 1);
    expect(files.indexOf('zz-fast5x/e24.json')).toBe(files.indexOf('zz-fast5x/e23.json') + 1);
    expect(files.indexOf('zz-fast5x/e23.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    expect(E23.length).toBe(2);
    for (const t of E23) {
      expect(t.id, t.id).toMatch(/^rid\.e23\./);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
      // the fixed sentences of effect/mana.json and zz-fast5x/e8.json keep their templates: the general ones rank below them (design 6.3 rule 3)
      expect(t.priority, t.id).toBe(-1);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E23) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'first', 'rather', 'though', "can't"]) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('E23 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E23) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('E23 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of E23) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples.slice(0, 4)) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || w === '~.' || /^\{/.test(w)) return;
          const bad = w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty';
          const mutated = [...words.slice(0, i), bad, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(face(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('E23 lowering: what the shapes mean (CR 106.6)', () => {
  it('the sentences fixed templates already read keep their JSON (no ambiguity, guard G5); a stable fixed template keeps its sentence', () => {
    const fixed: [string, unknown, string | null][] = [
      ['{T}: Add {C}. Spend this mana only to cast a creature spell.', { spells: { types: ['Creature'] } }, 'rid.mana.creature'],
      ['{T}: Add {C}. Spend this mana only to cast an instant or sorcery spell.', { spells: { types: ['Instant', 'Sorcery'] } }, 'rid.mana.instantsorcery'],
      // experimental fixed templates: the stable general one reads them to the same JSON and wins (parser/parse.ts: stable readings first, design 6.9)
      ['{T}: Add {C}. Spend this mana only to cast a noncreature spell.', { spells: { notTypes: ['Creature'] } }, null],
      ['{T}: Add {C}. Spend this mana only to cast an artifact spell.', { spells: { types: ['Artifact'] } }, null],
      ['{T}: Add {R}. Spend this mana only to cast Room spells and unlock doors.', { spells: { subtypes: ['Room'] }, unlock: true }, null],
    ];
    for (const [text, r, id] of fixed) {
      const f = face(text);
      expect(restriction(text), text).toEqual(r);
      expect(f.gate.every((g) => g.ok), text).toBe(true);
      if (id !== null) expect(f.templatesUsed, text).toEqual(expect.arrayContaining([id]));
      if (id !== null) expect(f.templatesUsed, text).not.toContain('rid.e23.mana.spendOnly');
    }
    const pillar = 'As ~ enters, choose a creature type.\n{T}: Add {C}. Spend this mana only to cast a creature spell of the chosen type.';
    expect(restriction(pillar)).toEqual({ spells: { types: ['Creature'], chosen: { link: 'type', quality: 'creatureType' } } });
  });
  it('several spell descriptions are one `anyOf`; "a ... spell" and "... spells" are the same spells; "or to" and "and" join clauses the same way', () => {
    expect(restriction('{T}: Add {C}. Spend this mana only to cast a Bird spell or a Bat spell.')).toEqual({ spells: { anyOf: [{ subtypes: ['Bird'] }, { subtypes: ['Bat'] }] } });
    expect(restriction('{T}: Add {C}. Spend this mana only to cast Bird spells.')).toEqual(restriction('{T}: Add {C}. Spend this mana only to cast a Bird spell.'));
    const a = restriction('{T}: Add {C}. Spend this mana only to cast Elf spells and activate abilities of Elf sources.');
    expect(a).toEqual({ spells: { subtypes: ['Elf'] }, abilities: { subtypes: ['Elf'] } });
    expect(restriction('{T}: Add {C}. Spend this mana only to cast an Elf spell or to activate an ability of an Elf source.')).toEqual(a);
  });
  it('"a source of the chosen type" reads the creature type chosen as the source entered (link `type`, CR 607.2a)', () => {
    const text = 'As ~ enters, choose a creature type.\n{T}: Add {C}. Spend this mana only to cast a spell of the chosen type or activate an ability of a source of the chosen type.';
    expect(restriction(text)).toEqual({ spells: { chosen: { link: 'type', quality: 'creatureType' } }, abilities: { chosen: { link: 'type', quality: 'creatureType' } } });
    expect(face(text).gate.every((g) => g.ok)).toBe(true);
  });
  it('shapes the grammar refuses: a card, a singular "and" list, a target, an unknown verb, a second cast clause', () => {
    for (const text of [
      '{T}: Add {C}. Spend this mana only to cast a creature card.',
      '{T}: Add {C}. Spend this mana only to cast an instant and sorcery spell.',
      '{T}: Add {C}. Spend this mana only to activate an ability of target artifact.',
      '{T}: Add {C}. Spend this mana only to pay cumulative upkeep costs.',
      '{T}: Add {C}. Spend this mana only to cast creature spells or cast artifact spells.',
      "{T}: Add {C}. This mana can't be spent to activate abilities.",
    ]) expect(fullyAutomated(face(text)), text).toBe(false);
  });
  it('the whole restriction is in one number, and "and" joins clauses only in the plural (Oracle prints no other; FAST5 T48 guards)', () => {
    for (const text of [
      '{T}: Add {C}. Spend this mana only to cast an artifact spell or activate abilities of artifact sources.',
      '{T}: Add {C}. Spend this mana only to cast artifact spells or activate an ability of an artifact source.',
      '{T}: Add {C}. Spend this mana only to cast a Dragon spell or Omen spells.',
      '{T}: Add {C}. Spend this mana only to cast an enchantment spell, unlock doors, or turn a permanent face up.',
      '{T}: Add {C}. Spend this mana only to cast an artifact spell and activate an ability.',
      '{T}: Add {C}. Spend this mana only to cast an enchantment spell, unlock a door, and turn a permanent face up.',
    ]) expect(fullyAutomated(face(text)), text).toBe(false);
    expect(restriction('{T}: Add {C}. Spend this mana only to cast artifact spells and activate abilities.')).toEqual({ spells: { types: ['Artifact'] }, abilities: {} });
    expect(restriction('{T}: Add {C}. Spend this mana only to cast enchantment spells, unlock doors, and turn permanents face up.')).toEqual({ spells: { types: ['Enchantment'] }, unlock: true, turnFaceUp: {} });
  });
});

/**
 * FAST5X E23 reconciled with FAST5 T48: T48's nine mana-spend restriction riders (rid.t48.mana.*, zz-fast5/t48.json) are folded into the general reader
 * rid.e23.mana.spendOnly, the one owner of "spend this mana only to ..." (CR 106.6). Their reviewed G9 guards are kept here, group by group, with the same
 * checks T48 ran: each example is read by rid.e23.mana.spendOnly to the JSON T48's template built; no counter-example gives the JSON of its group's first
 * example; near-miss mutations fail or differ; a nonsense word never leaves an automated ability; the real cards T48 read are read the same way.
 *
 * Two T48 counter-examples are the same restriction under CR 106.6 and moved to the examples (their groups' `nowSame`), each replaced by a counter-example
 * that keeps the guard meaningful:
 *  - "cast Wizard and Cleric spells": a plural list of subtypes names the spells with any of them, as Oracle prints it ("Dwarf, Equipment, and Saga spells",
 *    Fíli and Kíli, Joyous; "instant, sorcery, Demon, and Spirit spells", Séance Board; "instant and sorcery spells", which T48 itself read so). The
 *    singular "a Wizard and Cleric spell" (one spell with both subtypes) is still refused.
 *  - "cast Wizard spells and activate abilities of Wizard sources": the plural clauses joined by "and" list the payments the mana may make (CR 106.6; Oracle
 *    prints "Spend this mana only to cast Elf spells and activate abilities of Elf sources", Woodland Weavemaster). The singular "a Wizard spell and
 *    activate an ability of a Wizard source", which Oracle never prints, is still refused, as is a mixed number.
 */
const W = ['Wizard'];
const FOLDED: { was: string; examples: [string, unknown][]; nowSame?: [string, unknown][]; counterExamples: string[]; plural: boolean }[] = [
  {
    was: 'rid.t48.mana.abilities', plural: true,
    examples: [['{T}: Add {R}{R}. Spend this mana only to activate abilities.', { abilities: {} }], ['{1}, {T}: Add {G}. Spend this mana only to activate abilities.', { abilities: {} }]],
    counterExamples: ['{T}: Add {R}{R}. Spend this mana only to activate abilities of creatures.', '{T}: Add {R}{R}. Spend this mana only to activate loyalty abilities.'],
  },
  {
    was: 'rid.t48.mana.spells.subtypes.plural', plural: true,
    examples: [
      ['{T}: Add two mana of any one color. Spend this mana only to cast Wizard or Cleric spells.', { spells: { subtypes: ['Wizard', 'Cleric'] } }],
      ['{T}: Add {R}{R}. Spend this mana only to cast Goblin or Elf spells.', { spells: { subtypes: ['Goblin', 'Elf'] } }],
    ],
    nowSame: [['{T}: Add two mana of any one color. Spend this mana only to cast Wizard and Cleric spells.', { spells: { subtypes: ['Wizard', 'Cleric'] } }]],
    counterExamples: [
      '{T}: Add two mana of any one color. Spend this mana only to cast a Wizard and Cleric spell.',
      '{T}: Add two mana of any one color. Spend this mana only to cast Wizard and Cleric cards.',
      '{T}: Add two mana of any one color. Spend this mana only to cast Wizard or Cleric spells or activate abilities.',
    ],
  },
  {
    was: 'rid.t48.mana.spells.subtypes.singular', plural: false,
    examples: [
      ['{T}: Add one mana of any color. Spend this mana only to cast a Wizard or Cleric spell.', { spells: { subtypes: ['Wizard', 'Cleric'] } }],
      ['{T}: Add {C}. Spend this mana only to cast an Elf or Goblin spell.', { spells: { subtypes: ['Elf', 'Goblin'] } }],
    ],
    counterExamples: ['{T}: Add one mana of any color. Spend this mana only to cast a Wizard and Cleric spell.', '{T}: Add one mana of any color. Spend this mana only to cast a Wizard or Cleric spell with flying.'],
  },
  {
    was: 'rid.t48.mana.spellsOrAbilities.subtypes.plural', plural: true,
    examples: [
      ['{T}: Add two mana in any combination of colors. Spend this mana only to cast Wizard spells or activate abilities of Wizard sources.', { spells: { subtypes: W }, abilities: { subtypes: W } }],
      ['{T}: Add {G}{G}. Spend this mana only to cast Elf spells or activate abilities of Elf sources.', { spells: { subtypes: ['Elf'] }, abilities: { subtypes: ['Elf'] } }],
    ],
    nowSame: [['{T}: Add two mana in any combination of colors. Spend this mana only to cast Wizard spells and activate abilities of Wizard sources.', { spells: { subtypes: W }, abilities: { subtypes: W } }]],
    counterExamples: [
      '{T}: Add two mana in any combination of colors. Spend this mana only to cast Wizard spells or activate an ability of a Wizard source.',
      '{T}: Add two mana in any combination of colors. Spend this mana only to cast Wizard spells or activate abilities of creatures.',
    ],
  },
  {
    was: 'rid.t48.mana.spellOrAbility.subtype', plural: false,
    examples: [
      ['{T}: Add one mana of any color. Spend this mana only to cast a Wizard spell or activate an ability of a Wizard source.', { spells: { subtypes: W }, abilities: { subtypes: W } }],
      ['{T}: Add {R}. Spend this mana only to cast an Elf spell or activate an ability of an Elf source.', { spells: { subtypes: ['Elf'] }, abilities: { subtypes: ['Elf'] } }],
    ],
    counterExamples: [
      '{T}: Add one mana of any color. Spend this mana only to cast a Wizard spell and activate an ability of a Wizard source.',
      '{T}: Add one mana of any color. Spend this mana only to cast a Wizard spell or activate an ability of a creature.',
    ],
  },
  {
    was: 'rid.t48.mana.artifactSpellOrAbilityOfArtifact', plural: false,
    examples: [
      ['{T}: Add {B}. Spend this mana only to cast an artifact spell or activate an ability of an artifact source.', { spells: { types: ['Artifact'] }, abilities: { types: ['Artifact'] } }],
      ['{T}: Add {C}{C}. Spend this mana only to cast an artifact spell or activate an ability of an artifact source.', { spells: { types: ['Artifact'] }, abilities: { types: ['Artifact'] } }],
    ],
    counterExamples: [
      '{T}: Add {B}. Spend this mana only to cast an artifact spell and activate an ability of an artifact source.',
      '{T}: Add {B}. Spend this mana only to cast an artifact spell or activate an ability of a creature source.',
    ],
  },
  {
    was: 'rid.t48.mana.artifactSpellOrAbility', plural: false,
    examples: [
      ['{T}: Add {B}. Spend this mana only to cast an artifact spell or activate an ability.', { spells: { types: ['Artifact'] }, abilities: {} }],
      ['{T}: Add {C}{C}. Spend this mana only to cast an artifact spell or activate an ability.', { spells: { types: ['Artifact'] }, abilities: {} }],
    ],
    counterExamples: ['{T}: Add {B}. Spend this mana only to cast an artifact spell and activate an ability.', '{T}: Add {B}. Spend this mana only to cast an artifact spell or activate an ability of an artifact source.'],
  },
  {
    was: 'rid.t48.mana.chosenTypeSpellOrAbility', plural: false,
    examples: [
      [
        'As ~ enters, choose a creature type.\n{1}, {T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type or activate an ability of a creature source of the chosen type.',
        { spells: { types: ['Creature'], chosen: { link: 'type', quality: 'creatureType' } }, abilities: { types: ['Creature'], chosen: { link: 'type', quality: 'creatureType' } } },
      ],
      [
        'As ~ enters, choose a creature type.\n{T}: Add {C}{C}. Spend this mana only to cast a creature spell of the chosen type or activate an ability of a creature source of the chosen type.',
        { spells: { types: ['Creature'], chosen: { link: 'type', quality: 'creatureType' } }, abilities: { types: ['Creature'], chosen: { link: 'type', quality: 'creatureType' } } },
      ],
    ],
    counterExamples: [
      'As ~ enters, choose a creature type.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type or activate an ability of a creature source.',
      'As ~ enters, choose a creature type.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type and activate an ability of a creature source of the chosen type.',
    ],
  },
  {
    was: 'rid.t48.mana.instantAndSorcery', plural: true,
    examples: [
      ['{T}: Add {G}{G}. Spend this mana only to cast instant and sorcery spells.', { spells: { types: ['Instant', 'Sorcery'] } }],
      ['{1}, {T}: Add two mana of any one color. Spend this mana only to cast instant and sorcery spells.', { spells: { types: ['Instant', 'Sorcery'] } }],
    ],
    counterExamples: ['{T}: Add {G}{G}. Spend this mana only to cast instant or creature spells.', '{T}: Add {G}{G}. Spend this mana only to cast instant and sorcery spells this turn.'],
  },
];

/** T48's near-miss mutations of one example (design 6.8 G9); `andOr` marks the swap of the first "or" / "and". */
function nearMisses(text: string): { text: string; andOr: boolean }[] {
  const sentences = text.split(/(?<=\.)\s+/);
  const last = sentences.length - 1;
  const body = sentences[last]!.replace(/\.$/, '');
  const before = sentences.slice(0, last).join(' ');
  const wrap = (m: string): string => `${before === '' ? '' : `${before} `}${m.replace(/\.$/, '')}.`;
  const out: { text: string; andOr: boolean }[] = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`].map((t) => ({ text: wrap(t), andOr: false }));
  const swaps: [RegExp, string, boolean][] = [
    [/\bor\b/, 'and', true], [/\band\b/, 'or', true], [/\bonly\b/, 'also', false], [/\bcast\b/, 'play', false], [/\bactivate\b/, 'sacrifice', false], [/\bartifact\b/, 'creature', false],
    [/\bmana\b/, 'life', false], [/\bsource\b/, 'spell', false], [/\bspells?\b/, 'permanents', false],
  ];
  for (const [re, by, andOr] of swaps) if (re.test(body)) out.push({ text: wrap(`${body.replace(re, by).replace(/\s+/g, ' ')}.`), andOr });
  return out;
}

describe('FAST5 T48 mana restrictions folded into rid.e23.mana.spendOnly: T48\'s reviewed G9 guards (CR 106.6)', () => {
  for (const g of FOLDED) {
    it(`${g.was}: the examples are read by rid.e23.mana.spendOnly to T48's JSON; no counter-example gives the first example's JSON`, () => {
      const first = face(g.examples[0]![0]);
      for (const [text, r] of [...g.examples, ...(g.nowSame ?? [])]) {
        const f = face(text);
        expect(f.templatesUsed, text).toContain('rid.e23.mana.spendOnly');
        expect(automated(f.abilities), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((x) => x.ok), `${text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(restriction(text), text).toEqual(r);
        expect(E23[0]!.examples.map((e) => e.text), text).toContain(text); // the template file carries them
      }
      for (const c of g.counterExamples) {
        const f = face(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
    it(`${g.was}: near-miss mutations fail or differ; in the plural, swapping "or" and "and" is the same restriction (CR 106.6)`, () => {
      for (const [text] of g.examples) {
        const orig = face(text);
        for (const m of nearMisses(text)) {
          if (m.text === text) continue;
          const f = face(m.text);
          const same = automated(f.abilities) && f.gate.every((x) => x.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities);
          // "Wizard or Cleric spells" / "Wizard and Cleric spells", "Elf spells or activate ..." / "Elf spells and activate ...", "instant and sorcery
          // spells" / "instant or sorcery spells" (Oracle prints both: Abstract Paintmage, Jaya Ballard): the same spells; never in the singular
          expect(same, m.text).toBe(m.andOr && g.plural);
        }
      }
    });
    it(`${g.was}: replacing any one word of an example by an invented word makes the card not fully automated (G2)`, () => {
      for (const [text] of g.examples) {
        const words = text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || /^\{/.test(w) || w.includes('\n')) return;
          const bad = w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty';
          const mutated = [...words.slice(0, i), bad, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(face(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();
/** The real cards T48's riders read (its hand-read READERS), each read by rid.e23.mana.spendOnly now. */
const T48_READERS: readonly string[] = [
  'Boommobile', 'Cryptic Trilobite', 'James, Wandering Dad // Follow Him', 'Omen Hawker', 'Pit Automaton', 'Redshift, Rocketeer Chief', 'The Enigma Jewel // Locus of Enlightenment',
  'Guidelight Optimizer', 'Cargo Ship', 'Fabrication Foundry', 'Oaken Siren', 'Secluded Courtyard', 'Abstract Paintmage', 'Daxiver, Izzet Electromancer', 'Paradigm Shifter',
  'Resonating Lute', 'Tablet of Discovery', "Ixalli's Lorekeeper", 'Jasmine Dragon Tea Shop', 'Intrepid Stablemaster', 'Mech Hangar', 'Tournament Grounds', 'Turtle Lair',
  'White Lotus Hideout', 'Flamebraider',
];
const DIGITAL_ONLY = new Set(['Daxiver, Izzet Electromancer', 'Paradigm Shifter']); // Alchemy: resolved by hand whatever their lines say (CR 100.7)

describe.skipIf(index === null)('FAST5 T48 mana restrictions folded (local index): the real cards T48 read', () => {
  it('each is read by rid.e23.mana.spendOnly, passes the render gate on that line and leaves no manual "spend this mana only" ability', () => {
    for (const name of T48_READERS) {
      const c = (index ?? []).find((x) => x.name === name);
      expect(c, name).toBeDefined();
      const faces = parseCard(c!, OPTS).faces;
      expect(faces.flatMap((f) => f.templatesUsed), name).toContain('rid.e23.mana.spendOnly');
      const def = compileCard(c!);
      const manual = DIGITAL_ONLY.has(name) ? [] : def.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' && /spend this mana only/i.test(a.text));
      expect(manual.map((a) => a.text), name).toEqual([]);
    }
  }, 120_000);
});
