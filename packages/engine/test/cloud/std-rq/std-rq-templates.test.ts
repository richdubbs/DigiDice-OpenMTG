/**
 * Standard round std-rq (card wave 2, slice s1): the template data of parser/templates/zz-cloud/std-rq.json and the parser, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-rq-scenarios.test.ts. CR cites
 * from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRq from '../../../src/parser/templates/zz-cloud/std-rq.json';
import review from '../../m5/golden/cards/cloud-std-rq-review.json';
import t50Review from '../../m5/golden/cards/fast5-t50-review.json';
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRq as Template[];
const MECH_COUNT = 8;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-rq template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rq.json, after std-rp.json, before std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rq.json');
    expect(files.indexOf('zz-cloud/std-rq.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rp.json'));
    expect(files.indexOf('zz-cloud/std-rq.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    expect(files.indexOf('zz-cloud/std-rq.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdrq.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.stdrq\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, hand-verified golden cards that use it (the review file pins each card as full; a card that is also the evidence of a promotion of the T50 round is in that round\'s file, CARD_AUTOMATION.md section 6)', () => {
    const golden = [...(review as { card: string; verified: string; expect?: string }[]), ...(t50Review as { card: string; verified: string; expect?: string }[]).filter((g) => g.verified.includes('std-rq'))];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
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

describe('std-rq guard G9 (design 6.8): examples and counter-examples', () => {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\buntil end of turn\b/, 'until your next turn'], [/\bor more\b/, 'or fewer'], [/\beach\b/, 'all'], [/\bget\b/, 'gain'], [/\bgain\b/, 'lose'], [/\bhas\b/, 'loses'],
    [/\bDuring your turn\b/, 'During your end step'], [/\bflash\b/, 'haste'], [/\bits owner's control\b/, 'your control'], [/\binto your hand\b/, 'onto the battlefield'],
    [/\bmilled this way\b/, 'discarded this way'], [/\bloses all abilities\b/, 'loses flying'], [/\bmana cost\b/, 'power'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rq guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-rq guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        const labelEnd = words.indexOf('--'); // a flavor word before "--" has no rules meaning (CR 207.2d): any words may stand there
        words.forEach((w, i) => {
          if (i <= labelEnd) return;
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // the word in front of "counter(s)" is an open class by design (6.11, the CounterKind hole), as wp22-mutation.test.ts
          const end = w.match(/[.,]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rq design 6.10 (local index): synthetic examples', () => {
  it('no std-rq line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});



// ---- the parser, renderer and engine changes of the round, one test each -------------------------------------------------------------------------------------

const faceOf = (type: string, text: string, pt0: boolean) => parseCard(card('Example Brute', type, text, pt0 ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
const creature = (text: string) => faceOf('Creature — Elf Warrior', text, true);
const sorcery = (text: string) => faceOf('Sorcery', text, false);
const enchantment = (text: string) => faceOf('Enchantment', text, false);
const isFull = (f: ReturnType<typeof creature>): boolean => fullyAutomated(f);
const json = (f: ReturnType<typeof creature>): string => JSON.stringify(bare(f.abilities));

describe('std-rq quantities (CR 603.2c, 608.2c): "for each card discarded this way" of a discard trigger with no discard of its own', () => {
  it('is the amount of the triggering discard (eventAmount)', () => {
    const f = creature('Whenever you discard one or more cards, ~ gets +1/+0 until end of turn for each card discarded this way.');
    expect(isFull(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(json(f)).toContain('{"q":"eventAmount"}');
  });
  it('a narrower description, or a trigger that is not a discard, is not read', () => {
    expect(isFull(creature('Whenever you discard one or more cards, ~ gets +1/+0 until end of turn for each creature card discarded this way.'))).toBe(false);
    expect(isFull(creature('Whenever you draw one or more cards, ~ gets +1/+0 until end of turn for each card discarded this way.'))).toBe(false);
  });
});

describe('std-rq renderer (CR 122.1): "for each counter on <object>" counts the counters of every kind', () => {
  it('reads and prints counters of kind any', () => {
    const f = creature("At the beginning of each player's upkeep, that player adds {G} for each counter on ~.");
    expect(isFull(f), JSON.stringify(f.gate)).toBe(true);
    expect(json(f)).toContain('"kind":"any"');
  });
});

describe('std-rq Cond (CR 608.2d, 101.4): "If a player does" / "If no one does" only after "any opponent may"', () => {
  it('after a "you may" the words are not printed back: not automated', () => {
    expect(isFull(sorcery('You may draw a card. If a player does, you gain 2 life.'))).toBe(false);
    expect(isFull(sorcery('You may draw a card. If no one does, you gain 2 life.'))).toBe(false);
  });
  it('after "any opponent may" both are read and the may is anyOne', () => {
    const f = sorcery('Any opponent may sacrifice a creature of their choice. If a player does, you draw a card.');
    expect(isFull(f), JSON.stringify(f.gate)).toBe(true);
    expect(json(f)).toContain('"anyOne":true');
  });
});

describe('std-rq antecedents (CR 608.2c, design 6.4): what an earlier instruction of the same branch names', () => {
  it('"If you do, tap ~ and put a +1/+1 counter on it": "it" is ~', () => {
    const f = creature('At the beginning of combat on your turn, you may sacrifice an artifact. If you do, tap ~ and put a +1/+1 counter on it.');
    expect(isFull(f), JSON.stringify(f.diagnostics)).toBe(true);
  });
  it('with a target in the branch too, "it" stays ambiguous (manual)', () => {
    expect(isFull(creature('At the beginning of combat on your turn, you may sacrifice an artifact. If you do, tap ~ and target creature and put a +1/+1 counter on it.'))).toBe(false);
  });
});

describe('std-rq focus (CR 406.1, 608.2c; model/focus.ts): the card "exile cards ... until you exile a nonland card" stopped at', () => {
  it('is the "it" of the next sentence on a permanent (not the permanent itself)', () => {
    const f = enchantment('When this enchantment enters, exile cards from the top of your library until you exile a nonland card. You may cast it without paying its mana cost.');
    expect(isFull(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(json(f)).not.toContain('"what":{"ref":"self"}');
  });
});

describe('std-rq op cast.maxManaValue (CR 601.2, 202.3): "if that spell\'s mana value is N or less"', () => {
  it('is a capability of the engine and the walker asks for it', () => {
    expect(ENGINE_CAPABILITIES.has('op:cast.maxManaValue')).toBe(true);
    const f = sorcery("Exile cards from the top of your library until you exile a nonland card. You may cast it without paying its mana cost if that spell's mana value is 4 or less.");
    expect(isFull(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(capabilitiesOfDef(f.abilities[0] as never)).toContain('op:cast.maxManaValue');
  });
});

describe('std-rq event (CR 702.194a): "~ becomes tapped to pay a teamwork cost"', () => {
  it('reads becomes teamworkCostPaid by the object itself; the capability is installed', () => {
    const f = creature('Whenever ~ becomes tapped to pay a teamwork cost, you gain 1 life.');
    expect(isFull(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(json(f)).toContain('"what":"teamworkCostPaid"');
    expect(ENGINE_CAPABILITIES.has('feature:ev.becomes.teamworkCostPaid')).toBe(true);
  });
  it('"becomes tapped to pay a crew cost" is not this reading', () => {
    expect(isFull(creature('Whenever ~ becomes tapped to pay a crew cost, you gain 1 life.'))).toBe(false);
  });
});

describe('std-rq sentences (CR 500.8, 508.1c): "... additional combat phase. Only <creatures> can attack during that combat phase." is one instruction', () => {
  it('joins the two sentences into one extraPhase with attackers', () => {
    const f = sorcery('After this phase, there is an additional combat phase. Only Goblin creatures can attack during that combat phase.');
    expect(isFull(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(json(f)).toContain('"attackers":');
  });
  it('"Only ... can block" is not joined', () => {
    expect(isFull(sorcery('After this phase, there is an additional combat phase. Only Goblin creatures can block during that combat phase.'))).toBe(false);
  });
});

describe('std-rq renderer (CR 120.3, 608.2h): N damage "for each of those cards that are still exiled"', () => {
  it('prints the fixed amount for each card of the binding still in exile', () => {
    const f = sorcery('Exile the top two cards of your library. At the beginning of the next end step, ~ deals 1 damage to each opponent for each of those cards that are still exiled.');
    expect(isFull(f), JSON.stringify(f.gate)).toBe(true);
    expect(json(f)).toContain('"zone":"exile"');
  });
});

describe('std-rq renderer (CR 401.1, 608.2h): "cards from the top of your library equal to <amount>"', () => {
  it('is the top cards of that many', () => {
    const f = sorcery('Exile cards from the top of your library equal to the number of Elves you control.');
    expect(isFull(f), JSON.stringify(f.gate)).toBe(true);
    expect(json(f)).toContain('"ref":"topCards"');
  });
});
