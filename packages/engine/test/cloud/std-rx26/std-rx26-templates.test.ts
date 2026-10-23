/**
 * std-rx26 (card wave 2, slice s10): the template data of parser/templates/zz-cloud/std-rx26.json and the round's parser, lowering and renderer support:
 * "the next <spell> you cast this turn has affinity for <filter> | convoke | improvise" (nextSpell rider `keyword`, render/steps-stdr10.ts); "Plotting cards from your
 * hand costs {N} less" (costMod `applies.plot`, render/stat.ts); "whenever you discover" and "discover again for the same value" (an `eventAmount` of a discover
 * event, model/lint-roles.ts, render/steps-lasting.ts); "distribute N <kind> counters among any number of <filter>" on resolution (putCounters `distribute`,
 * render/steps-life.ts); "<player> gains control of <targets>" and "draw a card for each one they gained control of this way" (render/steps-cards.ts).
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. The behavior is in std-rx26-scenarios.test.ts. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx26 from '../../../src/parser/templates/zz-cloud/std-rx26.json';
import review from '../../m5/golden/cards/cloud-std-rx26-review.json';
import r3cost from '../../m5/golden/cards/cloud-r3-cost-review.json';
import r4copy from '../../m5/golden/cards/cloud-r4-copy-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RX26 = stdRx26 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const GOLDEN = [...(review as Golden), ...(r3cost as Golden), ...(r4copy as Golden)];
const goldenUsing = (id: string): string[] => GOLDEN.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on one golden card because Oracle prints the wording on that
 * card only among the cards that may be evidence, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.stdrx26.nextSpell.has.affinity': 'Don & Raph, Hard Science',
  'sta.stdrx26.plotting.fromHand.costsLess': 'Doc Aurlock, Grizzled Genius',
  'trg.stdrx26.you.discover': "Curator of Sun's Creation",
  'eff.stdrx26.discover.again.sameValue': "Curator of Sun's Creation",
  'eff.stdrx26.distribute.counters.anyNumber.nontarget': 'Crashing Wave',
  'eff.stdrx26.player.gainControl.targets': 'Coveted Falcon',
  'eff.stdrx26.draw.forEach.gainedControl': 'Coveted Falcon',
};
/** No usable evidence yet (the other printings are not Standard): capped at partial (design 6.9). */
const EXPERIMENTAL: ReadonlySet<string> = new Set(['eff.stdrx26.nextSpell.has.convoke', 'eff.stdrx26.nextSpell.has.improvise']);

/** The type line an example is an ability of: an activated ability on an artifact, a trigger or a static ability on a creature, anything else a sorcery. */
const typeOf = (text: string): string => (/^\{/.test(text) ? 'Artifact' : /^(When|Whenever|Flying|Plotting)\b/.test(text) ? 'Creature — Human' : 'Sorcery');
const face = (text: string, type = typeOf(text)) => parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');

describe('std-rx26 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx26.json, after zz-cloud/std-rx24.json, before zz-cloud/std-rx3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx26.json');
    expect(files.indexOf('zz-cloud/std-rx26.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rx24.json'));
    expect(files.indexOf('zz-cloud/std-rx26.json')).toBeLessThan(files.indexOf('zz-cloud/std-rx3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RX26.map((t) => t.id).sort()).toEqual([...Object.keys(NARROW), ...EXPERIMENTAL].sort());
    for (const t of RX26) {
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe(EXPERIMENTAL.has(t.id) ? 'experimental' : 'stable');
      if (!EXPERIMENTAL.has(t.id)) expect(goldenUsing(t.id), t.id).toEqual([NARROW[t.id]]);
      else expect(goldenUsing(t.id), t.id).toEqual([]);
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RX26) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'whenever', 'again', 'distribute']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rx26 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RX26) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        if (!EXPERIMENTAL.has(t.id)) expect(fullyAutomated(f), e.text).toBe(true);
      }
      for (const c of t.counterExamples) {
        const f = face(c, typeOf(t.examples[0]!.text));
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [[/\bthis turn\b/, 'this game'], [/\bless\b/, 'more'], [/\bthe same value\b/, 'a different value'], [/\bany number of\b/, 'up to two'],
    [/\bgained control\b/, 'lost control'], [/\byour hand\b/, 'your graveyard'], [/\byou cast\b/, 'an opponent casts']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx26 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RX26) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          const f = face(m, typeOf(e.text));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rx26 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RX26) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          // CR 122.1: any word names a kind of counter, so the word before "counters" may be anything (an invented kind is a real reading)
          if (words[i + 1] === 'counters') return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rx26 parser, lowering and renderer support', () => {
  it('CR 601.2a, 702.41a: "the next noncreature spell you cast this turn has affinity for artifacts" is a nextSpell rider `keyword` with the keyword\'s filter', () => {
    const f = face('{T}: The next noncreature spell you cast this turn has affinity for artifacts.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"rider":"keyword","keyword":{"kind":"keyword","keyword":"affinity","text":"affinity","filter":{"types":["Artifact"]}}');
  });
  it('a rider keyword other than affinity, convoke and improvise is not offered (cascade has no template; the capability walk refuses it)', () => {
    expect(understood(face('{T}: The next spell you cast this turn has cascade.'))).toBe(false);
  });
  it('CR 702.170a: "Plotting cards from your hand costs {2} less" is a costMod of the plot action only (not of spells)', () => {
    const f = face('Plotting cards from your hand costs {2} less.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"applies":{"plot":true,"caster":"you"}');
  });
  it('CR 701.57a: "discover again for the same value" outside a discover trigger has no amount to read: not understood', () => {
    expect(understood(face('Whenever you scry, discover again for the same value.'))).toBe(false);
  });
  it('CR 608.2d: "distribute ... among any number of target creatures" stays the target division of FAST4 T28 (announced on casting)', () => {
    const f = face('Distribute two +1/+1 counters among any number of target creatures you control.');
    expect(JSON.stringify(f.abilities)).not.toContain('"distribute":true');
  });
  it('CR 613.1b: one target is std-woe\'s singular control change (no binding); "each one they gained control of" needs the plural one before it (lint: unbound name)', () => {
    const one = face('Target opponent gains control of target artifact you control.');
    expect(one.templatesUsed).toContain('eff.stdwoe.player.gainControl');
    expect(JSON.stringify(one.abilities)).not.toContain('gainedControl');
    expect(understood(face('Draw a card for each one they gained control of this way.'))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rx26 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx26 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = RX26.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
