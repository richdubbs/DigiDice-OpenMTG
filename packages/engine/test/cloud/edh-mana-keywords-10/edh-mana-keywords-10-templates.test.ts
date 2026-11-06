/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-10: the template data of parser/templates/zz-cloud/edh-mana-keywords-10.json (a card at random in a hand (Urza's Bauble); all cards
 * colorless and players spending mana as any color (Mycosynth Lattice); rolls of two dice with one result chosen, of X six-sided dice, with a subtracted number (Reckless Endeavor, Luck
 * Bobblehead, The Deck of Many Things); a tapped token for each result; a card at random returned from the graveyard; "when that creature dies"; "exile them again" (Lae'zel's
 * Acrobatics); madness paid in six colorless mana (Emrakul, the World Anew)), and the parser, renderer and engine changes of the round (one test each at the end). Guard G9 (design 6.8):
 * every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations
 * fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10). The behavior is in
 * edh-mana-keywords-10-scenarios.test.ts. CR cites checked against the Comprehensive Rules 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhMk10 from '../../../src/parser/templates/zz-cloud/edh-mana-keywords-10.json';
import review from '../../m5/golden/cards/edh-mana-keywords-10-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhMk10 as Template[];
const MECH_COUNT = 14;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21; the standing rule of 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards that print each wording and are full (Urza's Bauble, Reckless Endeavor and Emrakul are of the tuning half; the others are held-out, opened by the owner, commander request 2026-10-27)
  'eff.edhmk10.look.cardAtRandomInHand': ["Urza's Bauble"],
  'sta.edhmk10.allObjects.colorless': ['Mycosynth Lattice'],
  'sta.edhmk10.players.spend.anyColor': ['Mycosynth Lattice'],
  'eff.edhmk10.rollDie.twoD12.chooseOne': ['Reckless Endeavor'],
  'eff.edhmk10.rollDie.twoD6.chooseOne': ['Valiant Endeavor'],
  'eff.edhmk10.rollDie.twoD8.chooseOne': ['Arcane Endeavor'],
  'eff.edhmk10.rollDie.xSixSided': ['Luck Bobblehead'],
  'eff.edhmk10.token.tapped.forEachResult': ['Luck Bobblehead'],
  'eff.edhmk10.rollDie.d20.subtract': ['The Deck of Many Things'],
  'eff.edhmk10.return.aCard.randomFromGraveyard.hand': ['The Deck of Many Things'],
  'eff.edhmk10.delay.whenThatCreatureDies': ['The Deck of Many Things'],
  'eff.edhmk10.exile.again': ["Lae'zel's Acrobatics"],
  'eff.edhmk10.put.fromAnyGraveyard': ['The Deck of Many Things'],
  // Emrakul's keyword line ("Flying, protection from spells and from permanents that were cast this turn") is read by the keyword hole (provenance native), which the golden harness's
  // template-only parse does not follow: its golden entry has no `expect: "full"` (its other abilities are matched, the protection keywords stay pending there), the card is full by compileCard
  'kw.edhmk10.madness.paySixColorless': ['Emrakul, the World Anew'],
};
/** The golden entries not pinned `expect: "full"`, with the reason above. */
const NOT_PINNED: readonly string[] = ['Emrakul, the World Anew'];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>([
  'eff.edhmk10.rollDie.twoD12.chooseOne', 'eff.edhmk10.rollDie.twoD6.chooseOne', 'eff.edhmk10.rollDie.twoD8.chooseOne', 'eff.edhmk10.token.tapped.forEachResult', 'eff.edhmk10.return.aCard.randomFromGraveyard.hand', 'eff.edhmk10.delay.whenThatCreatureDies', 'eff.edhmk10.exile.again'
]);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Sorcery', text), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-mana-keywords-10 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-mana-keywords-10.json, path order: after edh-mana-keywords-1, before edh-mana-keywords-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-mana-keywords-10.json');
    expect(files.indexOf('zz-cloud/edh-mana-keywords-10.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-mana-keywords-1.json'));
    expect(files.indexOf('zz-cloud/edh-mana-keywords-10.json')).toBeLessThan(files.indexOf('zz-cloud/edh-mana-keywords-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 10; ids are trg./rid./eff./sta./kw.edhmk10.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|trg)\.edhmk10\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(10);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) {
      if (NOT_PINNED.includes(g.card)) expect(g.expect, g.card).toBeUndefined();
      else expect(g.expect, g.card).toBe('full');
    }
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

describe('edh-mana-keywords-10 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bat random\b/, 'face down'], [/\bd12\b/, 'd10'], [/\bd20\b/, 'd8'], [/\bsix-sided\b/, 'seven-sided'], [/\bsubtract\b/, 'add'], [/\beven result\b/, 'odd result'],
    [/\bagain\b/, 'twice'], [/\bdies\b/, 'is exiled'], [/\bpay six\b/, 'pay seven'], [/\bcolorless\b/, 'colored'], [/\bplayers may\b/, 'opponents may'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-mana-keywords-10 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-mana-keywords-10 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-mana-keywords-10 design 6.10 (local index): synthetic examples', () => {
  it('no edh-mana-keywords-10 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-mana-keywords-10 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Artifact', extra: { power?: string; toughness?: string } = {}) => parseCard(card('Example Relic', type, text, extra), OPTS).faces[0]!;
  /** The game's default compile (templates and the keyword hole), as a decklist card gets it. */
  const compiled = (text: string, type: string, pt?: [string, string]): boolean =>
    compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard).automation.level === 'full';
  it('model/cap-walk.ts (CR 608.2h, 605.3b; Glittering Stockpile): a mana ability that sacrifices its source may count the counters the source had; any other quantity of the source stays manual', () => {
    expect(compiled('{T}, Sacrifice this artifact: Add X mana of any one color, where X is the number of stash counters on this artifact.', 'Artifact')).toBe(true);
    expect(compiled('{T}, Sacrifice this artifact: Add X mana of any one color, where X is this artifact\'s mana value.', 'Artifact')).toBe(false);
    expect(compiled('{T}, Sacrifice this artifact: Add X mana of any one color, where X is the number of counters on this artifact.', 'Artifact')).toBe(false);
  });
  it('parser/lower/die-roll.ts (CR 706.3b; The Deck of Many Things): instructions between the roll and its table move into the roll (afterRoll); a sentence there that is not understood keeps the whole ability manual', () => {
    const rows = '\n1—9 | You gain 2 life.\n10—20 | Draw two cards.';
    const ok = face(`{T}: Roll a d20 and subtract the number of creatures you control. If the result is 0 or less, you lose 1 life.${rows}`);
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"afterRoll":[{"op":"if"');
    expect(fullyAutomated(face(`{T}: Roll a d20 and subtract the number of creatures you control. Blorfty the glorp.${rows}`))).toBe(false);
    expect(fullyAutomated(face(`{T}: Roll two d20. If the result is 0 or less, you lose 1 life.${rows}`))).toBe(false);
  });
  it('parser/holes/cond.ts (CR 706.2, 608.2h; Luck Bobblehead): "you rolled N exactly M times" counts the dice of the roll before showing N; another roller or another phrasing is not read', () => {
    const base = (cond: string) => `{T}: Roll X six-sided dice, where X is the number of creatures you control. If ${cond}, you win the game.`;
    expect(fullyAutomated(face(base('you rolled 6 exactly seven times')))).toBe(true);
    expect(fullyAutomated(face(base('you rolled 6 exactly seven times')))).toBe(true);
    expect(fullyAutomated(face(base('an opponent rolled 6 exactly seven times')))).toBe(false);
    expect(fullyAutomated(face(base('you rolled 6 at least seven times')))).toBe(false);
  });
  it('parser/holes/qty.ts (CR 706.2; Reckless Endeavor): "that result" and "the other result" are read; with no roll before them the ability does nothing (it fails to determine at run time)', () => {
    expect(fullyAutomated(face('Roll two d12 and choose one result. ~ deals damage equal to that result to each creature. Then create a number of Treasure tokens equal to the other result.', 'Sorcery'))).toBe(true);
    // edh-next-55: a lone d12 now parses (eff.edhn55.rollDie.d12), so the negative uses a die no template names
    expect(fullyAutomated(face('Roll a d13. ~ deals damage equal to the other result to each creature.', 'Sorcery'))).toBe(false);
  });
  it('parser/holes/p2copyperm1.ts (CR 205.1a, 707.9b; Machine God\'s Effigy): "except it\'s an artifact and it has ..." SETS the card type (the copied types and non-artifact subtypes are not copied); the bare "it\'s an artifact" stays unread', () => {
    const copy = (tail: string) => face(`You may have ~ enter as a copy of any creature on the battlefield, except ${tail}`);
    const ok = copy('it\'s an artifact and it has "{T}: Add {U}."');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"types":{"set":["Artifact"]}');
    expect(fullyAutomated(copy("it's an artifact."))).toBe(false);
    expect(fullyAutomated(copy('it\'s an artifact and it loses all other card types.'))).toBe(true); // edh-next-57: the bare type with "loses all other card types" is read for "it" now (types SET, CR 205.1a)
    expect(fullyAutomated(copy('it\'s an artifact in addition to its other types and it has "{T}: Add {U}."'))).toBe(true);
    expect(JSON.stringify(copy('it\'s an artifact in addition to its other types and it has "{T}: Add {U}."').abilities)).toContain('"types":{"add":["Artifact"]}');
  });
  it('rules/quality.ts, parser/holes/misc.ts (CR 702.16a-b; Emrakul, the World Anew): "protection from spells" and "protection from permanents that were cast this turn" are qualities, no other word is', () => {
    expect(compiled('Protection from spells', 'Creature', ['2', '2'])).toBe(true);
    expect(compiled('Protection from permanents that were cast this turn', 'Creature', ['2', '2'])).toBe(true);
    expect(compiled('Protection from permanents that were cast last turn', 'Creature', ['2', '2'])).toBe(false);
    expect(compiled('Protection from abilities', 'Creature', ['2', '2'])).toBe(false);
    expect(compiled('Protection from spells and from permanents that were cast this turn', 'Creature', ['2', '2'])).toBe(true);
  });
  it('render/np.ts, render/kw.ts, render/steps-zones.ts (families from-any-graveyard, madness-pay-colorless, exile-again-after-return): the new wordings render only for the shapes they say', () => {
    expect(fullyAutomated(face('Put a creature card from any graveyard onto the battlefield under your control.', 'Sorcery'))).toBe(true);
    expect(fullyAutomated(face('Put a creature card from any hand onto the battlefield under your control.', 'Sorcery'))).toBe(false);
    expect(fullyAutomated(face('Madness--Pay six {C}.', 'Creature', { power: '2', toughness: '2' }))).toBe(true);
    expect(fullyAutomated(face('Madness--Pay six {R}.', 'Creature', { power: '2', toughness: '2' }))).toBe(false);
    expect(fullyAutomated(face('Exile target creature you control. Return it to the battlefield under its owner\'s control, then exile it again.', 'Sorcery'))).toBe(true);
    expect(fullyAutomated(face('Exile target creature you control, then exile it again.', 'Sorcery'))).toBe(false);
  });
});
