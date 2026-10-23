/**
 * FAST5 T52: the template data of parser/templates/zz-fast5/t52.json (delirium-style "N or more card types among cards in your graveyard", CR 205.2a) and
 * the readings it needed (design 6.8 G6):
 *  - the anthem with its condition first ("As long as there are four or more card types among cards in your graveyard, Insects and Spiders you control get
 *    +1/+1 and have deathtouch", CR 604.1, 611.3a, 613.4c, 613.1f);
 *  - a maximum hand size calculated from the same count ("each opponent's maximum hand size is equal to seven minus the number of those card types",
 *    CR 402.2): render/stat.ts#ruleMod;
 *  - "Then draw X cards, where X is the number of card types among ...", "Exile the top X cards of your library, where X is ..." (CR 107.3, 608.2h);
 *  - "Then if there are six or more card types among ..., double the number of +1/+1 counters on those creatures" (CR 701.10e);
 *  - the modal header "Choose one. If there are four or more card types among cards in your graveyard, choose one or more instead." (CR 700.2):
 *    parser/lower/ability.ts#modalOverride, render/program.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10): no example is a line of a real card.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t52 from '../../../src/parser/templates/zz-fast5/t52.json';
import { automated, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';
import { getCard } from '../../fixtures';
import review from '../../m5/golden/cards/fast5-t52-review.json';

const T52 = t52 as Template[];
const OPTS = defaultParseOptions();
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const parsedAs = (text: string, type: string) => parseCard({ name: 'Example Subject', layout: 'normal', type_line: type, oracle_text: text, mana_cost: '{1}', colors: [], keywords: [], ...(/Creature/.test(type) ? { power: '2', toughness: '2' } : {}) } as OracleCard, OPTS).faces[0]!;

describe('T52 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5/t52.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t52.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    for (const t of T52) {
      expect(t.id, t.id).toMatch(/^(sta|eff)\.t52\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T52 template has its evidence: three hand-verified golden cards, or every card of the corpus whose parse uses it', () => {
    const golden = review as { card: string; verified: string }[];
    // the only cards of the local index whose parse uses these templates (npm run cards -- try; checked over the whole index)
    const WHOLE_CORPUS: Record<string, string[]> = {
      'sta.t52.cardtypes.anthem.grant': ['The Swarmweaver'],
      'sta.t52.cardtypes.handsize.opponents': ['Winter, Misanthropic Guide'],
      'eff.t52.draw.whereX.cardtypes': ['Peer Past the Veil'],
      'eff.t52.thenIf.cardtypes.doubleCounters': ['Omnivorous Flytrap'],
      'eff.t52.exile.top.whereX.cardtypes': ['Loot, the Key to Everything'], // FAST5 T70: promoted with Loot's review (its last sentence is T70's)
    };
    for (const t of T52.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T52) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('T52 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T52) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const head = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(head.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/\bor more\b/, 'or fewer'], [/\bcard types\b/, 'colors'], [/\bopponent's\b/, 'your'], [/\bminus\b/, 'plus'], [/\bdraw\b/, 'discard'],
    [/\bdouble\b/, 'triple'], [/\bExile\b/, 'Destroy'], [/\bhave\b/, 'lose'], [/\bin your graveyard\b/, "in your opponents' graveyards"],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T52 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T52) {
    it(`${t.id}: an appended "unless/instead/at random/twice/until end of turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('T52 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T52) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          if (/^counters?$/.test(words[i + 1] ?? '')) return; // counter names are an open class (design 6.11, CR 122.1)
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T52 design 6.10: examples are synthetic', () => {
  it('no example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|Equipment|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = T52.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('T52 lowering: what the shapes mean', () => {
  const AMONG = { q: 'distinct', what: 'cardTypes', among: { ref: 'each', filter: { zone: 'graveyard', owner: 'you', isCard: true } } };
  const DELIRIUM = (n: number) => ({ cond: 'compare', left: AMONG, op: '>=', right: n });
  const THREE = '\n• You gain 3 life.\n• Each opponent loses 2 life.\n• Draw a card.';

  it('CR 205.2a, 613.4c, 613.1f: the anthem is a static with the condition, the P/T change and the keywords, on "each" of the filter', () => {
    const f = parsedAs('As long as there are three or more card types among cards in your graveyard, Elves and Wizards you control get +2/+0 and have trample.', 'Enchantment');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.abilities[0]).toMatchObject({
      kind: 'static', condition: DELIRIUM(3),
      effects: [{ s: 'continuous', affects: { ref: 'each', filter: { subtypes: ['Elf', 'Wizard'], controller: 'you' } }, mods: [{ layer: '7c', power: 2, toughness: 0 }, { layer: 6 }] }],
    });
  });
  it('CR 402.2: the hand size is a rule modification of each opponent, N minus the same count', () => {
    const f = parsedAs("As long as there are five or more card types among cards in your graveyard, each opponent's maximum hand size is equal to eight minus the number of those card types.", 'Enchantment');
    expect(fullyAutomated(f)).toBe(true);
    expect(f.abilities[0]).toMatchObject({
      kind: 'static', condition: DELIRIUM(5),
      effects: [{ s: 'rule', rule: 'maxHandSize', player: { ref: 'each', who: 'opponent' }, value: { q: 'math', op: '-', args: [8, AMONG] } }],
    });
  });
  it('CR 402.2: "those card types" are the card types the condition counted: a count of another set is no reading of it', () => {
    const f = parsedAs("As long as there are five or more card types among cards in your graveyard, each opponent's maximum hand size is equal to eight minus the number of card types among creatures you control.", 'Enchantment');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('CR 608.2h: "draw X cards, where X is ..." draws as many cards as there are types when the draw happens', () => {
    const f = parsedAs('Mill two cards. Then draw X cards, where X is the number of card types among cards in your graveyard.', 'Sorcery');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain(JSON.stringify({ op: 'draw', who: { ref: 'you' }, count: AMONG }));
  });
  it('CR 700.2: the modal override is "choose one or more" over three bullets, read when the modes are chosen; other counts stay manual', () => {
    const ok = parsedAs(`Choose one. If there are four or more card types among cards in your graveyard, choose one or more instead.${THREE}`, 'Sorcery');
    expect(fullyAutomated(ok)).toBe(true);
    expect(ok.abilities[0]).toMatchObject({ kind: 'spell', effect: { modes: { min: 1, max: 1, override: { when: DELIRIUM(4), min: 1, max: 3 } } } });
    // FAST5 batch 6 integration: FAST5X E22's general conditional mode count (parser/lower/ability.ts#conditionalModeCount, merged after T52's base) reads
    // two bullets as "one or both" (CR 700.2) and any condition the Cond hole reads exactly once, such as an opponent's graveyard
    const two = parsedAs('Choose one. If there are four or more card types among cards in your graveyard, choose one or more instead.\n• You gain 3 life.\n• Draw a card.', 'Sorcery');
    expect(two.abilities[0]).toMatchObject({ kind: 'spell', effect: { modes: { min: 1, max: 1, override: { when: DELIRIUM(4), min: 1, max: 2 } } } });
    const opp = parsedAs(`Choose one. If there are four or more card types among cards in an opponent's graveyard, choose one or more instead.${THREE}`, 'Sorcery');
    expect(opp.abilities[0]).not.toMatchObject({ effect: { modes: { override: { when: DELIRIUM(4) } } } });
    expect(fullyAutomated(parsedAs(`Choose one. If there are four or more card types among cards in your graveyard, choose two instead.${THREE}`, 'Sorcery'))).toBe(false);
    expect(fullyAutomated(parsedAs(`Choose one. If there are four or fewer card types among cards in your graveyard, choose one or more instead.${THREE}`, 'Sorcery'))).toBe(false);
  });
});

describe('T52 real cards (npm run cards -- try)', () => {
  it('the cards whose only blocker was one of these shapes compile full', () => {
    for (const name of ['The Swarmweaver', 'Winter, Misanthropic Guide', 'Peer Past the Veil', "Let's Play a Game", 'Omnivorous Flytrap']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
  it('Loot, the Key to Everything is full since FAST5 T70 (its last sentence, "You may play those cards this turn", is the shape of T70)', () => {
    expect(compileCard(getCard('Loot, the Key to Everything')).automation.level).toBe('full');
  });
});
