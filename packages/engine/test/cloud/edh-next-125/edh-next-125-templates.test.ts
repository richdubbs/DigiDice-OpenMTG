/**
 * must-finish round edh-next-125 (becomes a creature, counters, artifacts): the template data of parser/templates/zz-cloud/edh-next-125.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-125-scenarios.test.ts.
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
import edhNext125 from '../../../src/parser/templates/zz-cloud/edh-next-125.json';
import review from '../../m5/golden/cards/edh-next-125-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext125 as Template[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full (one each)
  'sta.edhn125.duringYourTurn.each.isPTSubtypeCreature.inAddition.hasAbilities': ['Bello, Bard of the Brambles'],
  'eff.edhn125.return.bf.ifX.thosePermanentsAreSizedCreatures': ['Dance of the Manse'],
  'eff.edhn125.becomes.ptArtifactCreature.countersOnEachThatBecame': ['Rise and Shine'],
  'eff.edhn125.return.allCostExiledExceptSelf.tappedOwners': ['Mechtitan Core'],
  'eff.edhn125.youAndPlayer.eachGainControlOfOthersCreatures.eot': ['Reins of Power'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' })
    : card('Example Plan', 'Sorcery', text, /\bX\b/.test(text) ? { mana_cost: '{X}{U}' } : {}), OPTS).faces[0]!;

describe('edh-next-125 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-125.json, path order: after edh-next-12, before edh-next-13) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-125.json');
    expect(files.indexOf('zz-cloud/edh-next-125.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-12.json'));
    expect(files.indexOf('zz-cloud/edh-next-125.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-13.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhn125.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhn125\./);
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

describe('edh-next-125 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bcreature\b/, 'land'], [/\btapped\b/, 'untapped'], [/\bother\b/, 'all'], [/\bartifact\b/, 'enchantment'], [/\bgain control\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-125 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-125 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter's kind is any word (CR 122.1: "a blorfty counter" is a counter of that kind)
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

describe.skipIf(index === null)('edh-next-125 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-125 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




describe('edh-next-125 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, cost = '{2}') => parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: cost }), OPTS).faces[0]!;
  const relic = (text: string) => parseCard(card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/filter.ts#andPhrases (CR 205.2a, 205.3m; Bello): "each non-Equipment artifact and non-Aura enchantment you control with mana value 4 or greater" is either kind, the mana value said for both; a bare first half is not read so', () => {
    const f = relic('Each non-Equipment artifact and non-Aura enchantment you control with mana value 4 or greater is an Elemental in addition to its other types and has haste.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"anyOf":[{"notSubtypes":["Equipment"],"types":["Artifact"]},{"notSubtypes":["Aura"],"types":["Enchantment"]}],"controller":"you","manaValue"');
    expect(fullyAutomated(relic('Each artifact and non-Aura enchantment you control with mana value 4 or greater is an Elemental in addition to its other types and has haste.'))).toBe(false);
  });
  it('parser/holes/filter.ts#orPhrases + render/np.ts (CR 205.2a; Dance of the Manse): "artifact and/or non-Aura enchantment cards"; the singular "artifact and/or non-Aura enchantment card" stays unread', () => {
    expect(fullyAutomated(spell('Return up to two target artifact and/or non-Aura enchantment cards from your graveyard to your hand.'))).toBe(true);
    expect(fullyAutomated(spell('Return target artifact and/or non-Aura enchantment card from your graveyard to your hand.'))).toBe(false);
  });
  it('types/ability.ts Destination.becomes + render/steps-zones.ts (CR 614.1c, 613.4b): the condition on X is kept; a singular target is not "those permanents"', () => {
    const f = spell('Return up to X target artifact cards with mana value X or less from your graveyard to the battlefield. If X is 4 or more, those permanents are 3/3 creatures in addition to their other types.', '{X}{U}');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"becomes":{"types":["Creature"],"power":3,"toughness":3,"when":{"cond":"compare","left":{"q":"X"},"op":">=","right":4}}');
    expect(fullyAutomated(spell('Return target artifact card with mana value X or less from your graveyard to the battlefield. If X is 4 or more, those permanents are 3/3 creatures in addition to their other types.', '{X}{U}'))).toBe(false);
  });
  it('render/fold-edhn125.ts (CR 611.2c, 122.1; Rise and Shine): the counters go on the bound objects that are artifact creatures now', () => {
    const f = spell('Target noncreature artifact you control becomes a 0/0 artifact creature. Put four +1/+1 counters on each artifact that became a creature this way.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"which":{"allTypes":["Artifact","Creature"]}');
    // review: an object that may already be a creature did not "become a creature this way": no reading
    expect(fullyAutomated(spell('Target artifact you control becomes a 0/0 artifact creature. Put four +1/+1 counters on each artifact that became a creature this way.'))).toBe(false);
    expect(fullyAutomated(spell('Target permanent becomes a 0/0 artifact creature. Put four +1/+1 counters on each artifact that became a creature this way.'))).toBe(false);
  });
  it('parser/holes/cost.ts#exile + render/costs.ts (CR 118.3; Mechtitan Core): "Exile ~ and N other ... you control" is two parts; without "other" it is not read', () => {
    const f = relic('{3}, Exile this artifact and two other artifacts you control: Draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('{"kind":"exileFrom","zone":"battlefield","count":1,"self":true},{"kind":"exileFrom","zone":"battlefield","count":2,"filter":{"other":true');
  });
  it('render/steps-zones.ts (CR 105.2, 111.4; family token-all-colors): a named token of five colors is "Name, a ... token ... that\'s all colors"', () => {
    expect(fullyAutomated(spell('Create Brassjaw, a legendary 6/6 Golem artifact creature token with trample that\'s all colors.'))).toBe(true);
  });
  it('model/focus.ts#swappedGroups + render/steps-lasting.ts (CR 611.2c, 613.1b; Reins of Power): the swap names both groups for "those creatures"; one group alone is not a swap', () => {
    const f = spell('Choose target opponent. You and that opponent each gain control of all creatures the other controls until end of turn. Those creatures gain haste until end of turn.');
    expect(fullyAutomated(f)).toBe(true);
    expect(fullyAutomated(spell('You and target opponent each gain control of all creatures the other controls until end of turn. Those artifacts gain haste until end of turn.'))).toBe(false);
  });
});
