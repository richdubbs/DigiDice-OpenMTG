/**
 * Standard round P (std-rp, Commander precon cards, tuning half): the template data of parser/templates/zz-cloud/std-rp.json (a static "prevent all damage that
 * would be dealt to <filter>", "<obj> becomes a N/N [color] <subtypes> [artifact] creature with <abilities> until end of turn") and the parser and renderer
 * changes of the round (Cond readings, the "other" antecedent rule, two event wordings). Guard G9 (design 6.8): every example lowers with its template, is automated and passes
 * the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of
 * any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present.
 * The behavior is in std-rp-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRp from '../../../src/parser/templates/zz-cloud/std-rp.json';
import review from '../../m5/golden/cards/cloud-std-rp-review.json';
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRp as Template[];
const MECH_COUNT = 5;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-rp template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rp.json, after std-r9.json, before std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rp.json');
    expect(files.indexOf('zz-cloud/std-rp.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-r9.json'));
    expect(files.indexOf('zz-cloud/std-rp.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    expect(files.indexOf('zz-cloud/std-rp.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdrp.* or sta.stdrp.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.stdrp\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, hand-verified golden cards of the tuning half that use it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
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

describe('std-rp guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('std-rp guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-rp guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('std-rp design 6.10 (local index): synthetic examples', () => {
  it('no std-rp line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


// ---- the parser and renderer changes of the round, one test each ----------------------------------------------------------------------------------------------

const faceOf = (type: string, text: string, pt0: boolean) => parseCard(card('Example Brute', type, text, pt0 ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
const creature = (text: string) => faceOf('Creature — Elf Warrior', text, true);
const enchantment = (text: string) => faceOf('Enchantment', text, false);
const isFull = (f: ReturnType<typeof creature>): boolean => fullyAutomated(f);
const abilityOf = (f: ReturnType<typeof creature>, kind: string): Record<string, unknown> => (bare(f.abilities) as Record<string, unknown>[]).find((a) => a['kind'] === kind)!;

describe('std-rp Cond (CR 601.2a, 603.4, 608.3): "if you cast it from your hand" of the object\'s own enters trigger', () => {
  it('reads the cast record\'s zone of the object itself', () => {
    const f = creature('When this creature enters, if you cast it from your hand, draw a card.');
    expect(isFull(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(abilityOf(f, 'triggered')['interveningIf']).toEqual({ cond: 'wasCast', from: 'hand' });
  });
  it('another creature\'s enters trigger ("it" is not the object itself) and another player\'s hand are not read', () => {
    expect(isFull(enchantment('Whenever a creature enters, if you cast it from your hand, draw a card.'))).toBe(false);
    expect(isFull(creature("When this creature enters, if you cast it from an opponent's hand, draw a card."))).toBe(false);
  });
});

describe('std-rp Cond (CR 700.8): "if you have a full party"', () => {
  it('is the party size of you at its most, four', () => {
    const f = creature('When this creature enters, if you have a full party, draw a card.');
    expect(isFull(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(abilityOf(f, 'triggered')['interveningIf']).toEqual({ cond: 'compare', left: { q: 'partySize', of: { ref: 'you' } }, op: '>=', right: 4 });
  });
  it('"a party" or "a full army" are not read', () => {
    expect(isFull(creature('When this creature enters, if you have a party, draw a card.'))).toBe(false);
    expect(isFull(creature('When this creature enters, if you have a full army, draw a card.'))).toBe(false);
  });
});

describe('std-rp Cond (CR 119.3, 120.3a): "an opponent / a player / you lost N or more life this turn"', () => {
  const read = (who: string) => abilityOf(enchantment(`At the beginning of your end step, if ${who} lost 3 or more life this turn, draw a card.`), 'triggered')['interveningIf'];
  it('reads countPlayers with lostLifeIs for an opponent and a player, and the life you lost for you', () => {
    expect(read('an opponent')).toEqual({ cond: 'compare', left: { q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, lostLifeIs: { op: '>=', n: 3 } }, op: '>=', right: 1 });
    expect(read('a player')).toEqual({ cond: 'compare', left: { q: 'countPlayers', of: { ref: 'each', who: 'player' }, lostLifeIs: { op: '>=', n: 3 } }, op: '>=', right: 1 });
    expect(read('you')).toEqual({ cond: 'compare', left: { q: 'lifeLostThisTurn', of: { ref: 'you' } }, op: '>=', right: 3 });
  });
  it('"or fewer" and "gained" are not this reading', () => {
    expect(isFull(enchantment('At the beginning of your end step, if an opponent lost 3 or fewer life this turn, draw a card.'))).toBe(false);
    expect(JSON.stringify(abilityOf(enchantment('At the beginning of your end step, if an opponent gained 3 or more life this turn, draw a card.'), 'triggered') ?? null)).not.toContain('lostLifeIs');
  });
  it('the capability is installed (effects/eval.ts, statics/match.ts) and the walker asks for it', () => {
    expect(ENGINE_CAPABILITIES.has('feature:q.countPlayers.lostLifeIs')).toBe(true);
    const f = enchantment('At the beginning of your end step, if an opponent lost 3 or more life this turn, draw a card.');
    expect(capabilitiesOfDef(f.abilities[0] as never)).toContain('feature:q.countPlayers.lostLifeIs');
  });
});

describe('std-rp antecedents (CR 109.2, 102.2; design 6.4): "other" and a same-sentence group of the other controller', () => {
  it('"destroy all creatures your opponents control, then tap all other creatures you control": "other" is other than ~', () => {
    const f = creature('When this creature enters, destroy all creatures your opponents control, then tap all other creatures you control.');
    expect(isFull(f), JSON.stringify(f.diagnostics)).toBe(true);
  });
  it('a group that may share objects with the "other" group stays a second candidate (manual)', () => {
    expect(isFull(creature('When this creature enters, destroy all creatures with flying, then tap all other creatures you control.'))).toBe(false);
  });
});

describe('std-rp renderer (CR 400.3, 700.4): "is put into your graveyard from the battlefield"', () => {
  it('a subject you own is said by the zone', () => {
    const f = enchantment('Whenever a nontoken creature is put into your graveyard from the battlefield, you gain 1 life.');
    expect(isFull(f), JSON.stringify(f.gate)).toBe(true);
    expect(JSON.stringify(abilityOf(f, 'triggered')['trigger'])).toContain('"owner":"you"');
  });
  it('"a graveyard" is not "your graveyard" (different JSON)', () => {
    const a = enchantment('Whenever a nontoken creature is put into your graveyard from the battlefield, you gain 1 life.');
    const b = enchantment('Whenever a nontoken creature is put into a graveyard from the battlefield, you gain 1 life.');
    expect(jsonKey(a.abilities)).not.toBe(jsonKey(b.abilities));
  });
});

describe('std-rp parser and renderer (CR 400.3, 601.2a): "whenever you cast a spell from your graveyard"', () => {
  it('the spell is one you own, cast from a graveyard', () => {
    const f = enchantment('Whenever you cast a spell from your graveyard, you gain 1 life.');
    expect(isFull(f), JSON.stringify(f.gate)).toBe(true);
    expect(abilityOf(f, 'triggered')['trigger']).toEqual({ on: [{ ev: 'cast', player: 'you', spell: { owner: 'you' }, from: 'graveyard' }] });
  });
  it('"from a graveyard" keeps no owner (different JSON)', () => {
    const a = enchantment('Whenever you cast a spell from your graveyard, you gain 1 life.');
    const b = enchantment('Whenever you cast a spell from a graveyard, you gain 1 life.');
    expect(jsonKey(a.abilities)).not.toBe(jsonKey(b.abilities));
  });
});
