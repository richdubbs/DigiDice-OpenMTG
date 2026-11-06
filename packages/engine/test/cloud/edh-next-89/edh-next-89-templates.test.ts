/**
 * Commander worker, round edh-next-89 (top-rank part 5, EDHREC ranks 10,501-12,000; code edhn89): the template data of parser/templates/zz-cloud/edh-next-89.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-89-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhN89 from '../../../src/parser/templates/zz-cloud/edh-next-89.json';
import review from '../../m5/golden/cards/edh-next-89-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhN89 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the one card of the EDHREC top 20,000 whose Oracle text prints each wording (opened by the owner: commander request 2026-10-27, more cards 2026-10-30)
  'eff.edhn89.counter.unless.discardCard': ['Reality Smasher'],
  'eff.edhn89.ifSelfHasCounters.removeThemAndTransform': ['Smoldering Egg // Ashmouth Dragon'],
  'eff.edhn89.anyOpponent.mayHaveSelfDealDamage': ['Vexing Devil'],
  'eff.edhn89.exchange.yourLife.power': ['Evra, Halcyon Witness'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability text, on a creature. */
const parsedWith = (_t: Template, text: string) => parseCard(card('Example Beast', 'Creature — Wizard', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;

describe('edh-next-89 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-89.json, path order: after edh-next-81.json, before edh-next-9.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-89.json');
    expect(files.indexOf('zz-cloud/edh-next-89.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-81.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhn89.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm|kw)\.edhn89\./);
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

describe('edh-next-89 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/\btwo\b/, 'three'], [/\bhaste\b/, 'flying'], [/\bWalls\b/, 'Wall'], [/\bone\b/, 'two']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-89 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-89 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // the name of a kind of counter is an open class of words (`CounterKind`): any word names one
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

describe.skipIf(index === null)('edh-next-89 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-89 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



describe('edh-next-89 parser, renderer and engine changes (one test each)', () => {
  const creature = (text: string) => parseCard(card('Example Beast', 'Creature — Wizard', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/filter.ts, render/np.ts (CR 508.1a, 400.7): "that didn\'t attack or enter this turn" is both negations on one object; a single negation, "or" with another word, and "attack or enter" without "didn\'t" are not that reading', () => {
    const a = creature('At the beginning of your end step, put a +1/+1 counter on each creature you control that didn\'t attack or enter this turn.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"attackedThisTurn":false');
    expect(JSON.stringify(a.abilities)).toContain('"enteredThisTurn":false');
    expect(fullyAutomated(creature('At the beginning of your end step, put a +1/+1 counter on each creature you control that didn\'t attack this turn.'))).toBe(true);
    expect(JSON.stringify(creature('At the beginning of your end step, put a +1/+1 counter on each creature you control that didn\'t attack this turn.').abilities)).not.toContain('"enteredThisTurn"');
    expect(fullyAutomated(creature('At the beginning of your end step, put a +1/+1 counter on each creature you control that didn\'t attack or block this turn.'))).toBe(false);
    expect(fullyAutomated(creature('At the beginning of your end step, put a +1/+1 counter on each creature you control that attacked or entered this turn.'))).toBe(false);
  });
  it('render/steps-lasting.ts#delay (CR 603.7, 603.4): a delayed trigger whose one instruction is a negated condition is also said "unless"; an "unless" that is not at the delayed trigger (the instruction before it) is the other reading', () => {
    const a = creature('When ~ enters, create a 1/1 red Elemental creature token. At the beginning of the next end step, exile that token unless you control an artifact.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"cond":"not"');
    expect(JSON.stringify(creature('When ~ enters, create a 1/1 red Elemental creature token. At the beginning of the next end step, exile that token unless you pay {1}.').abilities)).not.toContain('"cond":"not"'); // a payment is the other reading (pay)
  });
  it('render/steps-zones.ts#createToken (CR 111.4, 608.2c): "create that many tokens. They have ..." is read for the amount of the triggering event; for a fixed number it says "create two ... tokens. They have ..." as before', () => {
    const a = creature('Whenever ~ deals combat damage to a player, create that many 0/1 colorless Eldrazi Spawn creature tokens. They have "Sacrifice this token: Add {C}."');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"count":{"q":"eventAmount"}');
    expect(fullyAutomated(creature('Whenever ~ deals combat damage to a player, create two 0/1 colorless Eldrazi Spawn creature tokens. They have "Sacrifice this token: Add {C}."'))).toBe(true);
    expect(fullyAutomated(creature('Whenever ~ deals combat damage to a player, create that many 0/1 colorless Eldrazi Spawn creature tokens. They have "Sacrifice this token: Add {C}." again'))).toBe(false);
  });
  it('render/steps-life.ts (CR 601.2h, 608.2h): "put a number of <kind> counters on ~ equal to the amount of mana spent to cast that spell" says the amount after the recipient; "that spell" is the cast event\'s spell', () => {
    const a = creature('Whenever you cast an instant or sorcery spell, put a number of +1/+1 counters on ~ equal to the amount of mana spent to cast that spell.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"q":"spellManaSpent"');
    expect(fullyAutomated(creature('Whenever you cast an instant or sorcery spell, put a number of +1/+1 counters on ~ equal to the amount of mana spent to cast that spell unless it is blue.'))).toBe(false);
  });
  it('parser/holes/vocab.ts (CR 122.1b): "ember" names a counter kind', () => {
    expect(fullyAutomated(creature('When ~ enters, put an ember counter on ~.'))).toBe(true);
  });
  it('render/fold-edhn89.ts (CR 122.1, 701.28a): "Then if ~ has N or more X counters on it, remove them and transform ~" needs a preceding instruction and one number; with "fewer", without "Then", or as the first instruction it is not the reading', () => {
    const lead = 'Whenever you cast a noncreature spell, put a time counter on ~. ';
    expect(fullyAutomated(creature(`${lead}Then if ~ has three or more time counters on it, remove them and transform ~.`))).toBe(true);
    expect(fullyAutomated(creature(`${lead}Then if ~ has three or fewer time counters on it, remove them and transform ~.`))).toBe(false);
    expect(fullyAutomated(creature('Whenever you cast a noncreature spell, then if ~ has three or more time counters on it, remove them and transform ~.'))).toBe(false);
  });
  it('render/steps-life.ts#putCounters (CR 608.2d, 107.3): "distribute X +1/+1 counters among any number of creatures you control, where X is ..." is a distribution of a computed total among a described group; a fixed number, a target group and "where X is" with a different group are the other readings', () => {
    const spell = (text: string) => parseCard(card('Example Rite', 'Instant', text), OPTS).faces[0]!;
    const a = spell('Distribute X +1/+1 counters among any number of creatures you control, where X is the amount of {S} spent to cast this spell.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"distribute":true');
    expect(fullyAutomated(spell('Distribute X +1/+1 counters among any number of creatures you control, where X is the amount of {S} spent to cast this spell and more.'))).toBe(false);
    expect(fullyAutomated(spell('Distribute X +1/+1 counters among any number of creatures you control.'))).toBe(false);
  });
});
