/**
 * CLOUD C2 (revealed-information and hand statics; the hand-size part): the template data of parser/templates/zz-cloud/c2.json ("Your maximum hand size is
 * two", "Your maximum hand size is equal to <quantity>", "Each opponent's maximum hand size is three", "Each player has no maximum hand size", "Players have
 * no maximum hand size", "As long as <condition>, you have no maximum hand size", "You have no maximum hand size for the rest of the game") and the renderer
 * readings they needed (render/stat.ts: "players have ...", "... for the rest of the game"; design 6.8 G6).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10); the real cards each template reads are checked against the local index when it is present, and
 * the hand-verified golden entries (test/m5/golden/cards/cloud-c2-review.json) against their Oracle text here as well.
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the C2 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import c2 from '../../../src/parser/templates/zz-cloud/c2.json';
import review from '../../m5/golden/cards/cloud-c2-review.json';
import { checkGolden, type GoldenEntry } from '../../m5/golden/harness';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const C2 = c2 as Template[];

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a C2 example is an ability of the right kind (an effect on its own a spell's, a static an enchantment's). */
function exampleCard(text: string): OracleCard {
  if (/^draw /i.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Prism', 'Enchantment', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

/**
 * The Oracle text of the golden cards, as the reviewer remembers it (Scryfall was not reachable from the cloud session that wrote this family). With a
 * local index, the index's own text is used and must agree (below), so a wrong memory fails here rather than passing silently.
 */
const ORACLE: Readonly<Record<string, OracleCard>> = {
  'Null Profusion': { name: 'Null Profusion', layout: 'normal', mana_cost: '{4}{B}{B}', type_line: 'Enchantment', oracle_text: 'Skip your draw step.\nWhenever you play a card, draw a card.\nYour maximum hand size is two.' } as OracleCard,
  Recycle: { name: 'Recycle', layout: 'normal', mana_cost: '{4}{G}{G}', type_line: 'Enchantment', oracle_text: 'Skip your draw step.\nWhenever you play a card, draw a card.\nYour maximum hand size is two.' } as OracleCard,
  'Anvil of Bogardan': { name: 'Anvil of Bogardan', layout: 'normal', mana_cost: '{2}', type_line: 'Artifact', oracle_text: "Players have no maximum hand size.\nAt the beginning of each player's draw step, that player draws an additional card, then discards a card." } as OracleCard,
  'Sea Gate Restoration // Sea Gate, Reborn': {
    name: 'Sea Gate Restoration // Sea Gate, Reborn', layout: 'modal_dfc', card_faces: [
      { name: 'Sea Gate Restoration', mana_cost: '{4}{U}{U}{U}', type_line: 'Sorcery', oracle_text: 'Draw cards equal to the number of cards in your hand plus one. You have no maximum hand size for the rest of the game.' },
      { name: 'Sea Gate, Reborn', mana_cost: '', type_line: 'Land', oracle_text: "As this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {U}." },
    ],
  } as OracleCard,
  'Ancient Silver Dragon': { name: 'Ancient Silver Dragon', layout: 'normal', mana_cost: '{6}{U}{U}', type_line: 'Creature — Elder Dragon', power: '8', toughness: '8', oracle_text: 'Flying\nWhenever this creature deals combat damage to a player, roll a d20. Draw cards equal to the result. You have no maximum hand size for the rest of the game.' } as OracleCard,
};

describe('C2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/c2.json, path order: after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/c2.json');
    expect(files.indexOf('zz-cloud/c2.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/c2.json')).toBeLessThan(files.indexOf('zz-fast1/t4.json'));
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(C2.map((t) => t.id)).toEqual([
      'sta.c2.maxhand.your.n', 'sta.c2.maxhand.your.equalto', 'sta.c2.maxhand.player.n', 'sta.c2.nomaxhand.player', 'sta.c2.nomaxhand.players', 'sta.c2.nomaxhand.aslongas',
      'eff.c2.nomaxhand.restofgame',
    ]);
    for (const t of C2) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.c2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable C2 template has its evidence: at least three hand-verified golden cards', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of C2.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of C2) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('C2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of C2) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(fullyAutomated(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
  it('the lowered JSON is the rule the engine reads (statics/hooks.ts#maxHandSize; CR 402.2, 611.2a)', () => {
    expect(bare(parsedWith('Your maximum hand size is three.').abilities)).toMatchObject([{ kind: 'static', effects: [{ s: 'rule', rule: 'maxHandSize', player: { ref: 'you' }, value: 3 }] }]);
    expect(bare(parsedWith("Each opponent's maximum hand size is three.").abilities)).toMatchObject([{ kind: 'static', effects: [{ s: 'rule', rule: 'maxHandSize', player: { ref: 'each', who: 'opponent' }, value: 3 }] }]);
    expect(bare(parsedWith('Players have no maximum hand size.').abilities)).toMatchObject([{ kind: 'static', effects: [{ s: 'rule', rule: 'handSizeNoLimit', player: { ref: 'each', who: 'player' } }] }]);
    const rest = bare(parsedWith('Draw two cards. You have no maximum hand size for the rest of the game.').abilities) as { effect: { steps: unknown[] } }[];
    expect(rest[0]!.effect.steps[1]).toMatchObject({ op: 'effect', duration: { d: 'permanent' }, effects: [{ s: 'rule', rule: 'handSizeNoLimit', player: { ref: 'you' } }] });
  });
  it('the existing "You have no maximum hand size." static keeps its own template (sta.rule.nomaxhand) and JSON', () => {
    const f = parsedWith('You have no maximum hand size.');
    expect(f.templatesUsed).toEqual(['sta.rule.nomaxhand']);
    expect(fullyAutomated(f)).toBe(true);
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/maximum/, 'minimum'], [/hand size/, 'library size'], [/ no maximum/, ' a maximum'], [/ is (?=[a-z])/, ' is increased by '], [/rest of the game/, 'rest of the turn'],
    [/Each opponent's/, 'Your'], [/^Players/, 'Opponents'], [/As long as/, 'If'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('C2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of C2) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('C2 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of C2) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();
/** The Oracle card of a golden entry: the local index's when there is one, else the remembered text above (null: neither; the entry is skipped). */
const oracleOf = (name: string): OracleCard | null => (index ?? []).find((c) => c.name === name) ?? ORACLE[name] ?? null;

describe('C2 golden entries (test/m5/golden/cards/cloud-c2-review.json) against the Oracle text (design 6.8 G10)', () => {
  const golden = (review as Omit<GoldenEntry, 'source'>[]).map((g) => ({ ...g, source: 'cloud-c2-review.json' }) as GoldenEntry);
  for (const g of golden) {
    it.skipIf(oracleOf(g.card) === null)(`${g.card}: no mismatch, no card lint error${g.expect === 'full' ? ', every golden ability fully understood' : ''}`, () => {
      const r = checkGolden(g, oracleOf(g.card)!, OPTS);
      expect(r.mismatches, g.card).toEqual([]);
      expect(r.cardLint, g.card).toEqual([]);
      expect(r.ratchet, g.card).toBeUndefined();
      expect(r.matched + r.partialAgree, g.card).toBeGreaterThan(0);
    });
  }
  it('Sea Gate Restoration // Sea Gate, Reborn compiles to a full card', () => {
    expect(compileCard(oracleOf('Sea Gate Restoration // Sea Gate, Reborn')!).automation.level).toBe('full');
  });
});

describe.skipIf(index === null)('C2 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no C2 line of an example or counter-example (of a pattern with slots) is a line of a real card', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) lines.add(l.trim());
      }
    }
    // a pattern with no slot ("Players have no maximum hand size") is one fixed sentence: its examples can only be that sentence, so they are exempt
    const withSlots = C2.filter((t) => /\{[a-z]+:/.test(t.pattern));
    const verbatim = withSlots.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].flatMap((x) => x.split('\n')).filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('the remembered Oracle text of each golden card is the index\'s text', () => {
    for (const [name, mine] of Object.entries(ORACLE)) {
      const real = (index ?? []).find((c) => c.name === name);
      expect(real, name).toBeDefined();
      const text = (c: OracleCard): string[] => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].filter((x): x is string => typeof x === 'string');
      expect(text(real!), name).toEqual(text(mine));
    }
  }, 120_000);
});
