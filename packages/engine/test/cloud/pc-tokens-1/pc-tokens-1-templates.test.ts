/**
 * Lane pc-tokens, round pc-tokens-1 (Commander precon decks: tokens): the template data of parser/templates/zz-cloud/pc-tokens-1.json, the moved-words reading "that was
 * destroyed this way" (parser/holes/moved-words.ts#RELATIVE_FRONTS; render/moved.ts#movedCountParts), the renderer reading of "poison counters your opponents have"
 * (render/qty.ts), the fold `eachExplores` (render/fold-pctokens1.ts), the quantity marker of "For each opponent who does" (parser/chart.ts, lower/conditions.ts#resolveMayCount;
 * render/steps-flow.ts#repeat). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example
 * does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in pc-tokens-1-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/pc-tokens-1.json';
import review from '../../m5/golden/cards/pc-tokens-1-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 5;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A spell: the sentences of a sorcery. */
const parse = (text: string, type = 'Sorcery', pt?: { power: string; toughness: string }) => parseCard(card('Example Ooze', type, text, pt ?? {}), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('pc-tokens-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/pc-tokens-1.json, after p2-zone-moves-1, before r3-choose) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/pc-tokens-1.json');
    expect(files.indexOf('zz-cloud/pc-tokens-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-zone-moves-1.json'));
    expect(files.indexOf('zz-cloud/pc-tokens-1.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.pctokens1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.pctokens1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record): each wording is printed on one or two precon cards, so each template is stable on hand-verified golden cards (fewer than three)', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual([
      'eff.pctokens1.eachOpponentMay.create', 'eff.pctokens1.eachOpponentMay.drawAndCreate', 'eff.pctokens1.forEach.explores', 'eff.pctokens1.forEachOpponentWhoDoes',
      'eff.pctokens1.token.you.forEach',
    ]);
    expect(evidence('eff.pctokens1.forEach.explores')).toEqual(['Hakbal of the Surging Soul']);
    expect(evidence('eff.pctokens1.token.you.forEach')).toEqual(['Syphon Flesh']);
    expect(evidence('eff.pctokens1.eachOpponentMay.create').sort()).toEqual(['Tempt with Vengeance', 'Tempting Contract']);
    expect(evidence('eff.pctokens1.eachOpponentMay.drawAndCreate')).toEqual(['Tempt with Bunnies']);
    expect(evidence('eff.pctokens1.forEachOpponentWhoDoes').sort()).toEqual(['Tempt with Bunnies', 'Tempt with Vengeance', 'Tempting Contract']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('pc-tokens-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/\bEach opponent may\b/, 'Each opponent'], [/\bwho does\b/, "who doesn't"], [/\bfor each opponent\b/, 'for each player'], [/\bexplores\b/, 'connives'],
    [/\bYou create\b/, 'Each opponent creates'], [/\bcontrol\b/, 'control or'], [/\bdestroyed this way\b/, 'destroyed this turn'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('pc-tokens-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('pc-tokens-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('pc-tokens-1 lowering, holes and renderer: the readings that are no template of their own', () => {
  it('CR 608.2c, 608.2h, 400.7: "a <description> you controlled that was destroyed this way" is a count of the destroyed objects that were yours as they last existed (`resultCount.which.controller`)', () => {
    const f = parse('Destroy all creatures. Then create a 2/2 black Zombie creature token for each nontoken creature you controlled that was destroyed this way.');
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"which":{"token":false,"types":["Creature"],"controller":"you"}');
    // only the clause with "you controlled" is a reading (the plain "creature that was destroyed this way" has no wording in the renderer: the gate refuses it)
    expect(fullyAutomated(parse('Destroy all creatures. Then create a 2/2 black Zombie creature token for each creature that was destroyed this way.'))).toBe(false);
    // "you controlled" with no passive, a plural clause with a singular verb, or another controller is no reading
    expect(fullyAutomated(parse('Destroy all creatures. Then create a 2/2 black Zombie creature token for each creature you controlled.'))).toBe(false);
    expect(fullyAutomated(parse('Destroy all creatures. Then create a 2/2 black Zombie creature token for each creature an opponent controlled that was destroyed this way.'))).toBe(false);
    // the clause names one instruction: with no destroy before it, the count has nothing to read
    expect(fullyAutomated(parse('Draw a card. Then create a 2/2 black Zombie creature token for each creature you controlled that was destroyed this way.'))).toBe(false);
  });
  it('CR 122.1f, 102.3: "for each poison counter your opponents have" counts the poison counters of every opponent together; "that player has" stays a single player\'s', () => {
    const f = parse('Create a 1/1 green Insect creature token for each poison counter your opponents have.');
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"q":"counters","on":{"ref":"each","who":"opponent"},"kind":"poison"');
    const x = parse('Create X 1/1 green Insect creature tokens, where X is the number of poison counters your opponents have.');
    expect(fullyAutomated(x), JSON.stringify(x.gate)).toBe(true);
    expect(fullyAutomated(parse('Create a 1/1 green Insect creature token for each poison counter each opponent has.'))).toBe(false);
    expect(fullyAutomated(parse('Create a 1/1 green Insect creature token for each poison counter you have.'))).toBe(true);
  });
  it('CR 608.2c, 608.2d: "For each opponent who does" reads the `may` of a group right before it; with no such `may` (a single player, an "otherwise", another step) the sentence is manual', () => {
    const f = parse('Each opponent may create a Food token. For each opponent who does, you create a Food token.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"op":"repeat","times":{"q":"resultCount","step":"did"}');
    expect(fullyAutomated(parse('You may create a Food token. For each opponent who does, you create a Food token.'))).toBe(false);
    expect(fullyAutomated(parse('Target opponent may create a Food token. For each opponent who does, you create a Food token.'))).toBe(false);
    expect(fullyAutomated(parse('Each opponent may create a Food token. Draw a card. For each opponent who does, you create a Food token.'))).toBe(false);
    // not contagious: the other instructions of the ability stay (guard G10; the sentence before is not understood here)
    const kept = parse('Put a +1/+1 counter on each creature you control. Each opponent may put a +1/+1 counter on each creature they control. For each opponent who does, put a +1/+1 counter on each creature you control.');
    expect(kept.abilities.every((a) => (a as { kind: string }).kind !== 'manual'), JSON.stringify(kept.diagnostics)).toBe(true);
  });
});

describe('pc-tokens-1 engine capabilities', () => {
  it('the explore of a group is the existing `action:explore` over a `forEach`; no new capability is needed', () => {
    expect(ENGINE_CAPABILITIES.has('action:explore')).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('pc-tokens-1 design 6.10 (local index): synthetic examples', () => {
  it('no pc-tokens-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
