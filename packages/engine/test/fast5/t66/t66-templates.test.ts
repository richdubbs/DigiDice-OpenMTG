/**
 * FAST5 T66 (T7-D removal, control change and library/graveyard to battlefield: "return each creature that isn't a ... to its owner's hand", "shuffle enchanted
 * creature into its owner's library", "manifests dread" for another player and for the owner of the exiled card, "the exiled card's owner creates an X/X token",
 * searches with a mana value or a permanent description, "put a creature card ... onto the battlefield tapped and attacking, where X is ...", "from your hand or
 * graveyard ... with a finality counter", "gain control of up to two target creatures with total mana value 6 or less", "destroy ... unless its controller has ~ deal
 * damage to them", "return up to two creature cards with total mana value 4 or less from your graveyard", "whose controller was dealt combat damage by ~ this turn",
 * "for each opponent, exile up to one target ... that player controls", "each opponent chooses a permanent they control of each permanent type and sacrifices the
 * rest"): the template data of parser/templates/zz-fast5/t66.json.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not
 * parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated
 * ability (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are
 * checked there too (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T66 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t66 from '../../../src/parser/templates/zz-fast5/t66.json';
import review from '../../m5/golden/cards/fast5-t66-review.json';
import t46Review from '../../m5/golden/cards/fast5-t46-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T66 = t66 as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/fast5-t66-review.json and the T46 entry of Severance
 * Priest), or, for a sentence that fewer real cards print, every one of them (the index check below proves there is no other). A card of that corpus may stay
 * partial for a reason outside the template (its golden entry is then not pinned `expect: "full"`).
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'eff.t66.return.each.notSubtypes': { cards: ['Summon: Leviathan'], line: /Return each creature that isn't an? [^.]+ to its owner's hand/ },
  'eff.t66.shuffle.enchanted.intoLibrary': { cards: ['Dramatic Accusation', 'Stay Hidden, Stay Silent'], line: /Shuffle enchanted creature into its owner's library/ },
  'eff.t66.player.manifestsDread': { cards: ['Fear of Impostors', 'Unwanted Remake'], line: /Its controller manifests dread/ },
  'eff.t66.exiledOwner.manifestsDread': { cards: ['Unidentified Hovership'], line: /the exiled card's owner manifests dread/i },
  'eff.t66.exiledOwner.token.mvX': { cards: ['Severance Priest', 'Skyclave Apparition'], line: /the exiled card's owner creates an X\/X [^.]+ token, where X is the mana value of the exiled card/i },
  'eff.t66.search.basicLandOrSubtype.bf': { cards: ['Dance of the Tumbleweeds', 'Shefet Monitor'], line: /[Ss]earch your library for a basic land card or an? [A-Z][a-z]+ card, put it onto the battlefield, then shuffle/ },
  'eff.t66.search.nonlandPermanent.mv.bf': { cards: ['Guardian Sunmare'], line: /search your library for a nonland permanent card with mana value \d+ or less, put it onto the battlefield, then shuffle/ },
  'eff.t66.search.may.reveal.hand.manaValueEither': { cards: ['Transit Mage'], line: /you may search your library for an? [a-z]+ card with mana value \d+ or \d+, reveal it, put it into your hand, then shuffle/ },
  'eff.t66.put.fromHand.tappedAttacking.whereX': { cards: ['Kinscaer Sentry', 'Paladin Elizabeth Taggerdy'], line: /you may put a creature card with mana value X or less from your hand onto the battlefield tapped and attacking, where X is/ },
  'eff.t66.put.fromHandOrGraveyard.finalityCounter': { cards: ['Kastral, the Windcrested'], line: /You may put an? [A-Z][a-z]+ creature card from your hand or graveyard onto the battlefield with a finality counter on it/ },
  'eff.t66.control.targets.dur': { cards: ['Harness by Force', 'The Super Hero Civil War'], line: /Gain control of (?:up to \w+|any number of) target creatures[^.]* (?:for as long as|until)/ },
  'eff.t66.destroy.unlessControllerHasDamagePower': { cards: ['Combustion Man'], line: /destroy target permanent unless its controller has [^.]+ deal damage to them equal to (?:his|her|its|their) power/ },
  'eff.t66.return.upTo.totalMv.fromGraveyard.bf': { cards: ['Lively Dirge'], line: /Return up to \w+ creature cards with total mana value \d+ or less from your graveyard to the battlefield/ },
  'eff.t66.destroy.each.controllerDealtCombatDamage': { cards: ['Steel Hellkite'], line: /Destroy each nonland permanent with mana value X whose controller was dealt combat damage by this creature this turn/ },
  'eff.t66.player.choosesPermanentOfEachType.sacrificesRest': { cards: ['Liliana, Dreadhorde General'], line: /Each opponent chooses a permanent they control of each permanent type and sacrifices the rest/ },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T66 example is an ability of the right kind: a creature for a triggered or activated line, a sorcery otherwise. */
const exampleCard = (_t: Template, text: string) => (/^(?:when|whenever|at)\b|^[^"]*:/i.test(text.replace(/^[^\n]*\n/, '')) ? card('Example Volley', 'Creature — Test', text, { power: '2', toughness: '2' }) : card('Example Volley', 'Sorcery', text));
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
/**
 * FAST5 batch 9 integration: FAST5X E25 (zz-fast5x/e25.json, merged first) reads three of these sentences with templates of its own, which win over T66's. The
 * card plays the same either way; the tests accept the E25 template that now reads the sentence.
 */
const SAME_SENTENCE_AS: Readonly<Record<string, readonly string[]>> = {
  'eff.t66.shuffle.enchanted.intoLibrary': ['eff.e25.shuffleEnchanted', 'eff.e25.shuffleEnchanted.manifestDread'], // the second: Stay Hidden, Stay Silent's whole line
  'eff.t66.player.manifestsDread': ['eff.e25.manifestDread.player'],
  'eff.t66.exiledOwner.manifestsDread': ['eff.e25.manifestDread.linkedOwner'],
};
const readsWith = (used: readonly string[], id: string): boolean => used.includes(id) || (SAME_SENTENCE_AS[id] ?? []).some((x) => used.includes(x));

describe('T66 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t66.json, after zz-fast5/t50.json, before zz-fast5x/ and zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t66.json');
    expect(files.indexOf('zz-fast5/t66.json')).toBeGreaterThan(files.indexOf('zz-fast5/t50.json'));
    expect(files.indexOf('zz-fast5/t66.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T66.length).toBe(16);
    for (const t of T66) {
      expect(t.id, t.id).toMatch(/^eff\.t66\./);
      expect(t.kind, t.id).toBe('effect');
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T66 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = [...(review as { card: string; verified: string }[]), ...(t46Review as { card: string; verified?: string }[]).filter((e): e is { card: string; verified: string } => e.verified !== undefined)];
    for (const t of T66.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(t.id)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole && cards.length < 3) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T66) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('T66 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T66) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(readsWith(f.templatesUsed, t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
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
  const sentences = text.split(/(?<=\.)\s+/);
  const last = sentences.length - 1;
  const body = sentences[last]!.replace(/\.$/, '');
  const before = sentences.slice(0, last).join(' ');
  const wrap = (m: string): string => `${before === '' ? '' : `${before} `}${m.replace(/\.$/, '')}.`;
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\btarget\b/, 'each'], [/\bfor each\b/, 'for'], [/\bgain\b/, 'lose'], [/\byou control\b/, 'an opponent controls'], [/\bthat\b/, 'another'], [/\bup to\b/, 'at least'],
    [/\bhand\b/, 'library'], [/\bor less\b/, 'or more'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map(wrap);
}

describe('T66 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T66) {
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

describe('T66 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T66) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^"?\{/.test(w) || w.includes('\n')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T66 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no T66 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          const plain = l.replace(/\s*\([^)]*\)\s*$/, '').trim(); // the reminder text is no part of the rule
          for (const x of [l, plain]) {
            lines.add(x.trim());
            lines.add(x.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
          }
        }
      }
    }
    const verbatim = T66.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split(/(?<=\.)\s+/).some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T66 line is read by the named template and passes the exact render gate, never manual on that line
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.t66.return.each.notSubtypes': ['Summon: Leviathan'],
    'eff.t66.shuffle.enchanted.intoLibrary': ['Dramatic Accusation', 'Stay Hidden, Stay Silent'],
    'eff.t66.player.manifestsDread': ['Unwanted Remake'],
    'eff.t66.exiledOwner.manifestsDread': ['Unidentified Hovership'],
    'eff.t66.exiledOwner.token.mvX': ['Severance Priest'],
    'eff.t66.search.basicLandOrSubtype.bf': ['Dance of the Tumbleweeds'],
    'eff.t66.search.nonlandPermanent.mv.bf': ['Guardian Sunmare'],
    'eff.t66.search.may.reveal.hand.manaValueEither': ['Transit Mage'],
    'eff.t66.put.fromHand.tappedAttacking.whereX': ['Kinscaer Sentry', 'Paladin Elizabeth Taggerdy'],
    'eff.t66.put.fromHandOrGraveyard.finalityCounter': ['Kastral, the Windcrested'],
    'eff.t66.control.targets.dur': ['The Super Hero Civil War'],
    'eff.t66.destroy.unlessControllerHasDamagePower': ['Combustion Man'],
    'eff.t66.return.upTo.totalMv.fromGraveyard.bf': ['Lively Dirge'],
    'eff.t66.destroy.each.controllerDealtCombatDamage': ['Steel Hellkite'],
    'eff.t66.exile.forEachOpponent.until': ['Celebrate the Mountain-king', 'Grasp of Fate', 'Haytham Kenway'],
    'eff.t66.player.choosesPermanentOfEachType.sacrificesRest': ['Liliana, Dreadhorde General'],
  };
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);
  const LINE = /search your library for a (?:basic land|nonland permanent)|manifests? dread|isn't a |shuffle enchanted|exiled card's owner|put (?:a|an) [^.]+ onto the battlefield|gain control of up to|unless its controller has|return up to \w+ creature cards|whose controller was dealt|for each opponent|permanent type|mana value 4 or 5/i;
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and leave no manual ability for it`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const used = parseCard(c!, OPTS).faces.flatMap((f) => f.templatesUsed);
        expect(readsWith(used, id), `${name}: ${used.join(', ')}`).toBe(true);
        const def = compileCard(c!);
        const manual = def.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' && LINE.test(a.text));
        expect(manual.map((a) => a.text), name).toEqual([]);
      }
    });
  }
});
