/**
 * trek-1 (lane trek, Star Trek): the template data of parser/templates/zz-cloud/trek-1.json ("{Dur}, X gets +N/+N and becomes a <type>" and "X gets +N/+N and becomes
 * a <type> {Dur}", "assimilate <card>", "X doesn't untap during its controller's untap step and can't be beamed up", "X can't be beamed up"), and the round's
 * keyword, parser and renderer changes (the keyword Beam me up, a keyword newer than the CR whose reminder text is its rule source; the type set said after the
 * other changes, render/mods.ts family type-set-anywhere; the shared subject of the untap and beam me up restrictions, render/stat.ts; assimilate only of one
 * target card in a graveyard, render/steps-lasting.ts). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render
 * gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an
 * example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is
 * in trek-1-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout); beam me up and assimilate have no rule number in the
 * 2026-09-25 edition.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { compileCard } from '../../../src/index';
import { keywordRegistry } from '../../../src/keywords/registry';
import trek1 from '../../../src/parser/templates/zz-cloud/trek-1.json';
import ownReview from '../../m5/golden/cards/trek-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = trek1 as Template[];
const MECH_COUNT = 5;
const review = ownReview as { card: string; verified: string; expect?: string }[];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only (the Star Trek ones are new mechanics of one set), with their template tests (G9, G2) and played scenarios. Listed in the round's
 * record for the owner. rst.trek1.cantBeamUp has no card and stays experimental.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.trek1.pump.becomes.subtype.lead': "I'm a Doctor, Not a . . .",
  'eff.trek1.pump.becomes.subtype.trail': 'Ursine Champion',
  'eff.trek1.assimilate': 'Borg Queen, Perfection Manifest',
  'rst.trek1.untapstep.cantBeamUp': 'Marooned',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an Aura's or Equipment's static, a creature's trigger or activation, an instant. */
const parsedWith = (_t: Template, text: string) => {
  if (/^Enchanted /.test(text)) return parseCard(card('Example Snare', 'Enchantment — Aura', `Enchant creature\n${text}`), OPTS).faces[0]!;
  if (/^Equipped /.test(text)) return parseCard(card('Example Harness', 'Artifact — Equipment', `${text}\nEquip {1}`), OPTS).faces[0]!;
  if (/^Creatures /.test(text)) return parseCard(card('Example Field', 'Enchantment', text), OPTS).faces[0]!;
  if (/^(\{|When )/.test(text)) return parseCard(card('Example Lurker', 'Creature — Human', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  return parseCard(card('Example Order', 'Instant', text), OPTS).faces[0]!;
};

describe('trek-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-1.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-1.json');
    expect(files.indexOf('zz-cloud/trek-1.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/trek-1.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (eff|rst).trek1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|rst)\.trek1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
    expect(MECH.find((t) => t.id === 'rst.trek1.cantBeamUp')?.status).toBe('experimental'); // no card prints it alone
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = review.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`) || g.verified.includes(`${t.id})`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review) expect(g.expect, g.card).toBe('full');
    for (const g of review) expect(g.verified, g.card).toMatch(/CR \d{3}/);
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

describe('trek-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/\bbecomes\b/, 'is'], [/\bgets\b/, 'has'], [/\buntil end of turn\b/, 'until your next turn'], [/\bcan't\b/, 'can'], [/\bbeamed up\b/, 'beamed down'],
    [/\bits controller's\b/, 'your'], [/\bassimilate\b/, 'return'], [/\bfrom a graveyard\b/, 'from exile'], [/\bfrom your graveyard\b/, 'from your hand'],
    [/\bcreature card\b/, 'creature'], [/\byou control\b/, 'an opponent controls'], [/\band\b/, 'or'], [/\bGiant\b/, 'Giant in addition to its other types'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/this turn" or a swapped key word never gives the example's JSON`, () => {
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

describe('trek-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('trek-1 design 6.10 (local index): synthetic examples', () => {
  it('no trek-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const json = (v: unknown): string => JSON.stringify(v);

describe('trek-1 keyword: Beam me up (Star Trek reminder text; CR 702 number unverified), a keyword newer than the CR edition (rule "reminder")', () => {
  it('the registry has it under rule "reminder", implemented, with its alternative cost from the graveyard', () => {
    const d = keywordRegistry.get('beam me up');
    expect(d?.rule).toBe('reminder');
    expect(d?.status).toBe('implemented');
    expect(ENGINE_CAPABILITIES.has('keyword:beam me up')).toBe(true);
  });
  it('"Beam me up {3}{U}" with its reminder text is a keyword line; the expansion is a graveyard alternative cost that returns a creature you control and exiles the spell', () => {
    const f = parseCard(card('Example Transport', 'Sorcery', "You gain 3 life.\nBeam me up {3}{U} (You may cast this card from your graveyard for {3}{U} if you also return a creature you control to its owner's hand. Then exile this spell.)"), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f.abilities)).toContain('"kind":"keyword","keyword":"beam me up"');
    const [st] = keywordRegistry.expand(f.abilities.find((a) => a.kind === 'keyword')! as never, { granted: false, faceName: 'Example Transport', types: ['Sorcery'], keyPrefix: 'k:0:1' });
    expect(json(st)).toContain('"s":"alternativeCost","name":"beam me up"');
    expect(json(st)).toContain('{"kind":"returnToHand","filter":{"types":["Creature"],"controller":"you"},"count":1,"beamUp":true}');
    expect(json(st)).toContain('"from":"graveyard","exileOnLeave":true');
  });
  it('a misspelled or bare keyword is not automated ("Beam me up" with no cost needs feature:keyword.missing.cost; "Beam me down {2}{U}" is no keyword)', () => {
    for (const text of ['You gain 3 life.\nBeam me up', 'You gain 3 life.\nBeam me down {2}{U}']) {
      expect(compileCard(card('Example Transport', 'Sorcery', text)).automation.level, text).not.toBe('full');
    }
  });
});

describe('trek-1 renderer (render/mods.ts, family type-set-anywhere; CR 613.1d, 613.4c): a resolved effect\'s creature types set may be said after the other changes', () => {
  it('"until end of turn, X gets +N/+N and becomes a <type>" passes the gate (the readings themselves: test/m5/render/equivalence.test.ts, type-set-anywhere)', () => {
    const f = parsedWith(MECH[0]!, 'Until end of turn, target creature gets +2/+0 and becomes a Spirit.');
    expect(f.gate.every((g) => g.ok)).toBe(true);
    expect(json(f.abilities)).toContain('"mods":[{"layer":4,"subtypes":{"set":["Spirit"]}},{"layer":"7c","power":2,"toughness":0}]');
  });
  it('an ADDED type is not a set type ("in addition to its other types" keeps the other reading)', () => {
    const f = parsedWith(MECH[0]!, 'Until end of turn, target creature gets +2/+0 and becomes a Spirit in addition to its other types.');
    expect(json(f.abilities)).not.toContain('"set":["Spirit"]');
  });
});

describe('trek-1 renderer (render/stat.ts): the untap restriction and "can\'t be beamed up" of one object, the subject said once', () => {
  it('"Enchanted creature doesn\'t untap during its controller\'s untap step and can\'t be beamed up" is one static ability of two restrictions', () => {
    const f = parsedWith(MECH[3]!, "Enchanted creature doesn't untap during its controller's untap step and can't be beamed up.");
    expect(automated(f.abilities)).toBe(true);
    expect(json(f.abilities)).toContain('"action":"untapDuringUntapStep"},{"s":"restrict","subject":{"ref":"attachedTo"},"mode":"cant","action":"beBeamedUp"}');
  });
  it('the restriction said first, or "can\'t be beamed up" of another object, is not this reading', () => {
    expect(fullyAutomated(parsedWith(MECH[3]!, "Enchanted creature can't be beamed up and doesn't untap during its controller's untap step."))).toBe(false);
  });
});

describe('trek-1 renderer (render/steps-lasting.ts): assimilate is said only of one target card in a graveyard, by you', () => {
  it('"assimilate target creature card from an opponent\'s graveyard" is automated; "assimilate target creature" (a permanent) is not', () => {
    expect(fullyAutomated(parsedWith(MECH[2]!, "When ~ dies, assimilate target creature card from an opponent's graveyard."))).toBe(true);
    expect(fullyAutomated(parsedWith(MECH[2]!, 'When ~ dies, assimilate target creature.'))).toBe(false);
    expect(fullyAutomated(parsedWith(MECH[2]!, 'When ~ dies, assimilate up to two target creature cards from a graveyard.'))).toBe(false);
  });
});
