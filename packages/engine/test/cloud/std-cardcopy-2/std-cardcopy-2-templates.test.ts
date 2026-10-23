/**
 * Lane std-cardcopy, round std-cardcopy-2: the template data of parser/templates/zz-cloud/std-cardcopy-2.json (a token copy of the card another ability of the
 * object exiled, for each opponent and attacking that opponent; a choice of a creature that saddled it this turn; one card exiled with the object put onto the
 * battlefield with additional counters; "It gains this card's other abilities"), and the round's parser and renderer changes (a choice of one object is the
 * discourse focus, model/focus.ts#chosenOne; parser/parse.ts#fillOtherAbilities; the renderer's wordings of those shapes).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-cardcopy-2-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, fillOtherAbilities, parseCard } from '../../../src/parser/parse';
import { chosenOne, focusEffect } from '../../../src/model/focus';
import type { AbilityDef } from '../../../src/types/ability';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdCardcopy2 from '../../../src/parser/templates/zz-cloud/std-cardcopy-2.json';
import review from '../../m5/golden/cards/cloud-std-cardcopy-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdCardcopy2 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.stdcardcopy2.forEachOpponent.copy.linkedExiled.attacking': 'Mardu Siegebreaker',
  'eff.stdcardcopy2.linked.putOne.bf.additionalCounters': 'Sothera, the Supervoid',
  'eff.stdcardcopy2.gains.otherAbilitiesOfCard': 'Symbiote Spider-Man',
  // std-promote-4: stable on its one card (6.9 narrow-wording deviation), golden in cloud-std-cardcopy-2-review.json
  'eff.stdcardcopy2.choose.saddledThisTurn': 'Calamity, Galloping Inferno',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>();
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Instant', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('std-cardcopy-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-cardcopy-2.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-cardcopy-2.json');
    expect(files.indexOf('zz-cloud/std-cardcopy-2.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-cardcopy-2.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdcardcopy2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.stdcardcopy2\./);
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
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
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

describe('std-cardcopy-2 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\beach opponent\b/, 'each player'], [/\bthat opponent\b/, 'that player'], [/\btapped token\b/, 'untapped token'], [/\bthe exiled card\b/, 'the exiled cards'],
    [/\bsaddled it\b/, 'crewed it'], [/\bthis turn\b/, 'last turn'], [/\bunder your control\b/, "under its owner's control"], [/\badditional\b/, 'fewer'],
    [/\bother abilities\b/, 'activated abilities'], [/\bgains this card's\b/, "loses this card's"], [/\byou control\b/, 'an opponent controls'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-cardcopy-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-cardcopy-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
          const f = parsedWith(t, mutated);
          // a cost part the model cannot state is no `op: manual` (it is a manual cost part): the card is partial, so it counts as not automated here
          expect(fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"'), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-cardcopy-2 design 6.10 (local index): synthetic examples', () => {
  it('no std-cardcopy-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('std-cardcopy-2 parser and renderer changes (one test each)', () => {
  const creature = (text: string) => parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('model/focus.ts#chosenOne (CR 608.2c, 608.2d): a choice of exactly one object by you is the focus; a choice of two, by another player or at random is not', () => {
    const one = { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: {} }, min: 1, max: 1, as: 'chosen' };
    expect(chosenOne(one)).toEqual({ ref: 'bound', name: 'chosen' });
    expect(focusEffect(one)).toEqual({ kind: 'object', on: { ref: 'bound', name: 'chosen' } });
    expect(chosenOne({ ...one, max: 2 })).toBeNull();
    expect(chosenOne({ ...one, who: { ref: 'each', who: 'opponent' } })).toBeNull();
    expect(chosenOne({ ...one, random: true })).toBeNull();
    expect(chosenOne({ ...one, perPlayer: { ref: 'each', who: 'player' } })).toBeNull();
  });
  it('parser/lower/anaphora.ts#focusWithin and focusAt: "choose a creature you control and/. create a token that\'s a copy of it" on a permanent copies the chosen creature', () => {
    for (const text of ["Whenever ~ attacks, choose a creature you control and create a token that's a copy of it.", "Whenever ~ attacks, choose a creature you control. Create a token that's a copy of it."]) {
      const f = creature(text);
      expect(fullyAutomated(f), text).toBe(true);
      expect(JSON.stringify(f.abilities), text).toContain('"op":"copy","what":{"ref":"bound","name":"chosen"}');
    }
  });
  it('parser/parse.ts#fillOtherAbilities (CR 613.1f): the grant gets copies of the other abilities without source ranges; with a manual one, or two grants, it is unlinked', () => {
    const grant: AbilityDef = { kind: 'activated', text: 'g', cost: {}, effect: { targets: [], steps: [{ op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, add: [], otherAbilitiesOfCard: true }] }] }] } } as unknown as AbilityDef;
    const other = { kind: 'keyword', keyword: 'flying', text: 'Flying', src: [0], prov: { by: 'keyword', id: 'flying' } } as unknown as AbilityDef;
    const ok = fillOtherAbilities([other, grant]);
    expect(ok.unlinked).toEqual([]);
    expect(JSON.stringify(ok.producers.get(1))).toContain('"add":[{"kind":"keyword","keyword":"flying","text":"Flying"}]');
    const manual = { kind: 'manual', text: 'x', reason: 'r', shape: 'static' } as unknown as AbilityDef;
    expect(fillOtherAbilities([manual, grant]).unlinked).toEqual([1]);
    expect(fillOtherAbilities([grant, grant]).unlinked).toEqual([0, 1]);
    expect(fillOtherAbilities([grant]).unlinked).toEqual([0]);
  });
  it('render/steps-zones.ts (CR 508.4): one tapped token copy attacking a named player has a wording; untapped, it has none (the sentence stays manual)', () => {
    const exile = 'When ~ enters, exile another target creature you control until ~ leaves the battlefield.\n';
    expect(fullyAutomated(creature(`${exile}Whenever ~ attacks, for each opponent, create a tapped token that's a copy of the exiled card attacking that opponent.`))).toBe(true);
    expect(fullyAutomated(creature(`${exile}Whenever ~ attacks, for each opponent, create a token that's a copy of the exiled card attacking that opponent.`))).toBe(false);
  });
  it('render/fold.ts#linkedReturnOne (CR 122.6): the linked card put onto the battlefield with one kind of additional counters, "an additional" for one', () => {
    const exile = 'When ~ enters, exile up to two target creatures an opponent controls.\n';
    expect(fullyAutomated(creature(`${exile}When ~ dies, put a creature card exiled with ~ onto the battlefield under your control with an additional +1/+1 counter on it.`))).toBe(true);
    expect(fullyAutomated(creature(`${exile}When ~ dies, put a creature card exiled with ~ onto the battlefield under your control with three additional +1/+1 counters on it.`))).toBe(true);
  });
  it('render/mods.ts#otherAbilitiesSentence (CR 611.2a): the grant is said only for good; "until end of turn" leaves the sentence manual', () => {
    const lead = 'Flying\n{1}, Exile ~ from your graveyard: Target creature you control ';
    expect(fullyAutomated(creature(`${lead}gains this card's other abilities.`))).toBe(true);
    expect(fullyAutomated(creature(`${lead}gains this card's other abilities until end of turn.`))).toBe(false);
  });
});
