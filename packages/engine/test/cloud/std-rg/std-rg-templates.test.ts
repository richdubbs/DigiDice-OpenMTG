/**
 * Standard round G (std-rg; slot G of the parallel rounds F-J): the template data of parser/templates/zz-cloud/std-rg.json and the parser, lowering and renderer
 * changes of the round, one test each with its negative case. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render
 * gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example
 * never leaves an automated card (G2). Every wording is synthetic (design 6.10), checked against the local index when it is present. The behavior is in
 * std-rg-scenarios.test.ts.
 *
 *   parser/holes/cond.ts            "there are N or more loyalty counters among Jaces you control" (CR 122.1)    render/cond.ts, actions/announce-cond.ts
 *   parser/holes/core.ts, front/lexicon-index.ts  the number words 21-99 ("twenty-five")                       render/equivalence.ts (the gate's normalizer)
 *   parser/holes/vocab.ts           "Equipment" is its own plural ("any number of target Equipment you control")
 *   parser/holes/object.ts          "all but the bottom card of each opponent's library"                        effects/refs.ts, render/refs.ts
 *   (dropped at the merge of main 22cc3eb) "it" after "Whenever enchanted creature attacks or blocks" (CR 508.1, 509.1) is std-rx16's reading now
 *   parser/lower/riders.ts          a rider after a reflexive "When you do, you may cast ..." (CR 603.12)
 *   parser/holes/misc.ts            "hexproof from each of its colors" (CR 702.11d, 105.2)                      rules/protection.ts, render/kw.ts
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { CRITICAL_WORDS } from '../../../src/parser/lower/units';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRg from '../../../src/parser/templates/zz-cloud/std-rg.json';
import review from '../../m5/golden/cards/cloud-std-rg-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RG = stdRg as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, an Aura or Equipment line on an Aura, anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (/^Enchanted creature\b/.test(text)) return card('Example Aura', 'Enchantment — Aura', `Enchant creature\n${text}`);
  if (/^Equipped creature\b/.test(text)) return card('Example Blade', 'Artifact — Equipment', `${text}\nEquip {2}`);
  if (t.kind === 'effect' && !text.includes(':') && !text.includes('~') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const CREATURE = (text: string): OracleCard => card('Test Shade', 'Creature — Shade', text, { power: '2', toughness: '2' });
const AURA = (text: string): OracleCard => card('Test Mantle', 'Enchantment — Aura', `Enchant creature\n${text}`);
const SORCERY = (text: string): OracleCard => card('Test Rite', 'Sorcery', text);
const WALKER = (text: string): OracleCard => card('Test Sage', 'Legendary Planeswalker — Jace', text, { loyalty: '4' });
const parsed = (c: OracleCard) => parseCard(c, OPTS).faces[0]!;
const json = (c: OracleCard): string => JSON.stringify(parsed(c).abilities);
const full = (c: OracleCard): boolean => fullyAutomated(parsed(c));
/** The activation restriction was left to the controller to attest (`onlyIf ask`, CR 602.5b): the condition is not understood. */
const asks = (c: OracleCard): boolean => json(c).includes('"cond":"ask"');

/** Every synthetic wording of the tests below (design 6.10: none is a real Oracle line). */
const WORDINGS: string[] = [];
const w = (text: string): string => { WORDINGS.push(text); return text; };

describe('std-rg template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rg.json, after std-otj.json, before std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rg.json');
    expect(files.indexOf('zz-cloud/std-rg.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-otj.json'));
    expect(files.indexOf('zz-cloud/std-rg.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(RG.length).toBe(1); // the attach-targets template was dropped for std-rx32's identical eff.stdrx32.attach.targets (merge of main 6d05fb5)
    for (const t of RG) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.stdrg\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 (deviation recorded in the PR): a stable template has its evidence, one hand-verified golden card that uses it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of RG.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word or phrase a pattern spells out (parser/lower/units.ts#CRITICAL_WORDS) is listed in `consumes`', () => {
    for (const t of RG) {
      const literal = ` ${t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ')} `;
      for (const w of CRITICAL_WORDS) if (literal.includes(` ${w} `)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('std-rg guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RG) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        // an experimental template whose wording the stable templates also lower to the same result gives way to them (design 6.9, G10)
        const fellBack = t.status === 'experimental' && f.diagnostics.some((d) => d.code === 'experimental' && d.message.includes(t.id));
        expect(f.templatesUsed.includes(t.id) || fellBack, `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = text.includes('\n') ? [] : [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bany number of\b/, 'two'], [/\bup to two\b/, 'three'],
    [/\blegendary\b/, 'snow'], [/\bEnchanted\b/, 'Equipped'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rg guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RG) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-rg guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RG) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((x, i) => {
          if (x === '~' || x === '~.' || x === '~,' || /^"?\{/.test(x) || x.includes('\n')) return;
          const end = x.match(/[.,:"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

// ---- the hole readings, the lowering and the renderer -----------------------------------------------------------------------------------------------------------

describe('Cond "there are N or more <kind> counters among <objects>" (parser/holes/cond.ts, actions/announce-cond.ts, render/cond.ts; CR 122.1, 602.5b)', () => {
  it('"Activate only if there are 12 or more loyalty counters among Jaces you control." is the summed counters of those objects, read at announcement', () => {
    const c = WALKER(w('0: Draw a card. Activate only if there are 12 or more loyalty counters among Jaces you control.'));
    expect(asks(c)).toBe(false);
    expect(json(c)).toContain('"left":{"q":"counters","on":{"ref":"each","filter":{"subtypes":["Jace"],"controller":"you"}},"kind":"loyalty"},"op":">=","right":12');
  });
  it('a singular description ("a Jace you control") and "or fewer" are not this reading', () => {
    expect(asks(WALKER(w('0: Draw a card. Activate only if there are 12 or more loyalty counters among a Jace you control.')))).toBe(true);
    expect(asks(WALKER(w('0: Draw a card. Activate only if there are 12 or fewer loyalty counters among Jaces you control.')))).toBe(true);
  });
});

describe('the number words past twenty (parser/holes/core.ts#NUMBER_WORDS; render/equivalence.ts normalizer)', () => {
  it('"twenty-five" is 25, "thirty" is 30, in a quantity and in a gate comparison', () => {
    const c25 = WALKER(w('0: Draw a card. Activate only if there are twenty-five or more loyalty counters among Jaces you control.'));
    expect(asks(c25)).toBe(false);
    expect(json(c25)).toContain('"right":25');
    const c30 = WALKER(w('0: Draw a card. Activate only if there are thirty or more loyalty counters among Jaces you control.'));
    expect(asks(c30)).toBe(false);
    expect(json(c30)).toContain('"right":30');
  });
  it('an invented compound ("twenty-eleven", "forty-zero") is no number', () => {
    expect(asks(WALKER(w('0: Draw a card. Activate only if there are twenty-eleven or more loyalty counters among Jaces you control.')))).toBe(true);
    expect(asks(WALKER(w('0: Draw a card. Activate only if there are forty-zero or more loyalty counters among Jaces you control.')))).toBe(true);
  });
});

describe('"Equipment" is its own plural (parser/holes/vocab.ts#SAME_PLURAL; CR 205.3g)', () => {
  it('"Tap any number of target Equipment you control." is a target spec of any number of Equipment', () => {
    const c = SORCERY(w('Tap any number of target Equipment you control.'));
    expect(full(c)).toBe(true);
    expect(json(c)).toContain('"min":0,"max":"any"');
  });
  it('"target Equipment" without a number is still one target, and "Equipments" is no word', () => {
    expect(json(SORCERY(w('Tap target Equipment you control.')))).toContain('"min":1,"max":1');
    expect(full(SORCERY(w('Tap any number of target Equipments you control.')))).toBe(false);
  });
});

describe('Objs "all but the bottom card of <player>\'s library" (parser/holes/object.ts#allButBottom, effects/refs.ts, render/refs.ts; CR 401.1, 401.2)', () => {
  it('"Exile all but the bottom card of each opponent\'s library." is every card of those libraries except the bottom one', () => {
    const c = SORCERY(w('Exile all but the bottom card of each opponent\'s library.'));
    expect(full(c)).toBe(true);
    expect(json(c)).toContain('"what":{"ref":"topCards","player":{"ref":"each","who":"opponent"},"count":0,"allButBottom":1}');
  });
  it('"all but the top card" and "all but the bottom two cards" are not this reading', () => {
    expect(full(SORCERY(w('Exile all but the top card of each opponent\'s library.')))).toBe(false);
    expect(full(SORCERY(w('Exile all but the bottom two cards of each opponent\'s library.')))).toBe(false);
  });
});

describe('design 6.4, CR 508.1, 509.1: "it" after "Whenever enchanted creature attacks or blocks" is the enchanted creature (std-rx16\'s reading, parser/lower/scope.ts#roleObject; this round\'s own copy was dropped at the merge of main 22cc3eb)', () => {
  it('"Whenever enchanted creature attacks or blocks, tap it." names the creature that attacked or blocked (the enchanted creature)', () => {
    const c = AURA(w('Whenever enchanted creature attacks or blocks, tap it.'));
    expect(full(c)).toBe(true);
    expect(json(c)).toContain('"what":{"ref":"event","role":"subject"}');
  });
  it('with a target of the same sort named before it, the pronoun has two candidates and the sentence stays manual', () => {
    expect(full(AURA(w('Whenever enchanted creature attacks or blocks, tap target creature. Untap it.')))).toBe(true);
    expect(full(AURA(w('Whenever enchanted creature attacks or blocks, you gain 1 life and tap target creature an opponent controls, then untap it.')))).toBe(false);
  });
  it('a mix of the creature itself and enchanted creature (different subjects) leaves "it" unresolved', () => {
    expect(full(CREATURE(w('Whenever ~ attacks or enchanted creature blocks, tap it.')))).toBe(false);
  });
});

describe('CR 603.12, 608.2c: a rider after a reflexive trigger\'s "you may cast" modifies that cast (parser/lower/riders.ts)', () => {
  it('"... When you do, you may cast target instant card with mana value 1 from your graveyard without paying its mana cost. If that spell would be put into your graveyard, exile it instead."', () => {
    const c = CREATURE(w('{T}: Put a coin counter on this creature. When you do, you may cast target instant card with mana value 2 or less from your graveyard without paying its mana cost. If that spell would be put into your graveyard, exile it instead.'));
    expect(full(c)).toBe(true);
    expect(json(c)).toContain('"op":"reflexive"');
    expect(json(c)).toContain('"graveyardInstead":{"to":{"zone":"exile"},"yours":true}');
  });
  it('the rider is not carried into a reflexive trigger whose last instruction is not a cast', () => {
    const c = CREATURE(w('{T}: Put a coin counter on this creature. When you do, draw a card. If that spell would be put into your graveyard, exile it instead.'));
    expect(full(c)).toBe(false);
  });
});

describe('hexproof "from each of its colors" (parser/holes/misc.ts#qualityAt, rules/protection.ts#canBeTargeted, render/kw.ts; CR 702.11d, 105.2)', () => {
  it('"Each other Elf you control has hexproof from each of its colors." grants hexproof with the quality of the permanent own colors', () => {
    const c = CREATURE(w('Each other Elf you control has hexproof from each of its colors.'));
    expect(full(c)).toBe(true);
    expect(json(c)).toContain('"keyword":"hexproof","quality":"ownColors"');
  });
  it('only hexproof reads it: "protection from each of its colors" stays manual, as does "hexproof from each of its types"', () => {
    expect(full(CREATURE(w('Each other Elf you control has protection from each of its colors.')))).toBe(false);
    expect(full(CREATURE(w('Each other Elf you control has hexproof from each of its types.')))).toBe(false);
  });
});

describe('design 6.10: the wordings of this file are synthetic', () => {
  it('none is a line of a real card (local index, when present)', () => {
    const idx = localIndex();
    if (idx === null) return;
    const lines = new Set(idx.flatMap((c) => (c.oracle_text ?? '').split('\n').map((l) => l.trim().toLowerCase())));
    for (const t of WORDINGS) for (const line of t.split('\n')) if (!/^enchant /i.test(line)) expect(lines.has(line.trim().toLowerCase()), line).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rg design 6.10 (local index): synthetic examples', () => {
  it('no std-rg line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = RG.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
