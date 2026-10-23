/**
 * CLOUD std-dft (Aetherdrift Standard backlog; open cards: the tuning half and Standard-legal cards, design 6.12): the template data of parser/templates/zz-cloud/std-dft.json and the readings the slice added beside
 * it (parser/holes/cond.ts: "it's (not) their turn", an odd or even number of counters; lower/ability.ts: a cycled card named as the source of damage; the X of
 * a cycling cost, model/lint-nodes.ts; render/: "and/or" lists, the serial comma after "reveal it", quoted dash-cost keyword grants, base power and toughness of a
 * set "equal to" a quantity; design 6.8 G6).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10); the real cards each template reads are checked against the local index when it is present.
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the std-dft templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { cyclingHasX, defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { validateAbility } from '../../../src/model/validate';
import stddft from '../../../src/parser/templates/zz-cloud/std-dft.json';
import review from '../../m5/golden/cards/cloud-std-dft-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex, openCards, openToTuning } from '../../m5/parser/support';

const STDDFT = stddft as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards, or, for a sentence fewer real cards print, every card of the TUNING half that
 * prints it (design 6.12: the held-out half is never looked at). `pending`: a card that prints the line but is not automated yet for a reason outside the
 * template (another sentence of the card), with that reason.
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; pending?: Readonly<Record<string, string>>; line: RegExp }>> = {
  'sta.stddft.otherturns.is.artifactcreature': { cards: ['Midnight Mangler'], line: /During turns other than yours, this \w+ is an artifact creature/ },
  'eff.stddft.discard.chosen.thendraw': {
    cards: ['Oildeep Gearhulk'], line: /that player discards that card, then draws a card/,
    pending: { 'Concealing Curtains // Revealing Eye': 'open since the hash split of 2026-10-19; its "that player" has two compatible antecedents after "target opponent reveals their hand" (unbound-reference, design 6.4), so the sentence stays manual' },
  },
  'rep.stddft.damage.plus.yourSource.toOpponentOrTheirPermanent': { cards: ['Far Fortune, End Boss'], line: /If a source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus \d+ instead/ },
  'eff.stddft.thenIf.oddCounters': { cards: ['Sab-Sunen, Luxa Embodied'], line: /Then if [^.,]+ has an odd number of counters on it/ },
  // Sanctum of All is HELD_OUT: no open card prints the line now
  'eff.stddft.search.libraryAndOrGraveyard.battlefield': { cards: ['Sanctum of All'], line: /search your library and\/or graveyard for [^.]*? and put it onto the battlefield/ },
  'trg.stddft.cardsExiledFromGraveyardsAndOrBattlefield.batch.yourTurn': { cards: ['Ketramose, the New Dawn'], line: /Whenever one or more cards are put into exile from graveyards and\/or the battlefield during your turn/ },
  'trg.stddft.selfBecomesTapped.yourTurn': { cards: ['Interface Ace'], line: /Whenever (this \w+|~) becomes tapped during your turn/ },
  // merge line D: "<several target players> each mill N cards" is read by eff.mill since std-otj's player hole takes the "each" (parser/holes/player.ts; same JSON as
  // the dropped duplicate eff.stddft.players.eachMill and std-hob's eff.stdhob.players.each.mill), so the whole corpus of the line is checked under eff.mill
  'eff.mill': {
    cards: ['Riverchurn Monument'], line: /target players each mill \w+ cards/,
    pending: { 'Homer, the Hermit': 'its "where X is twice the number of Crabs, Lobsters, Nautiluses, Starfish, and/or Trilobites you control" is not read yet' },
  },
  'eff.stddft.players.eachMill.ownGraveyardSize': { cards: ['Riverchurn Monument'], line: /each mill cards equal to the number of cards in their graveyard/ },
  'eff.stddft.become.artifactcreatures.each': {
    cards: ['Start Your Engines'], line: /\w+ you control become artifact creatures until end of turn/, // Start Your Engines is HELD_OUT
    pending: {
      'Push the Limit': 'its first sentences ("Return all Mount and Vehicle cards ... Sacrifice them at the beginning of the next end step.") are the eoe slice\'s shape (backlog/shared-shapes.md)',
      'Armed and Armored': 'open since the hash split of 2026-10-19; reads the line with the template and compiles full, not hand-verified golden evidence yet (design 6.9)',
      'The Thanos-Copter': 'open since the hash split of 2026-10-19; reads the line with the template and compiles full, not hand-verified golden evidence yet (design 6.9)',
    },
  },
  'eff.stddft.pump.eachOther.nonartifactCreature': { cards: ['Winter, Cursed Rider'], line: /Each other nonartifact creature gets/ },
  'eff.stddft.mayHave.basePT.equalTo.each': {
    cards: ['Sita Varma, Masked Racer'], line: /you may have the base power and toughness of [^.]* become equal to/,
    pending: { 'Exuberant Wolfbear': 'open since the hash split of 2026-10-19; "of target Human you control become equal to ~\'s power and toughness" (a target in the set, a source\'s P/T as the quantity) is not a wording the template reads (no-template)' },
  },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** The golden entries that name a template among the ones they were verified against ("(a, b)" lists). */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const namesTemplate = (verified: string, id: string): boolean => new RegExp(`[(, ]${escapeRe(id)}[,)]`).test(verified);

/** The type line of the examples of the static templates (the object the static ability is on); the others are placed by `exampleCard`. */
const STATIC_TYPES: Readonly<Record<string, string>> = {
  'sta.stddft.otherturns.is.artifactcreature': 'Artifact — Vehicle',
  'rep.stddft.damage.plus.yourSource.toOpponentOrTheirPermanent': 'Creature — Human Mercenary',
  'sta.stddft.have.basePT.are.subtypes.inaddition': 'Enchantment',
};
/** A synthetic card in which a std-dft example is an ability of the right kind (a trigger or an activated ability is a creature's, an instruction a sorcery's). */
function exampleCard(text: string, id?: string): OracleCard {
  const type = id === undefined ? undefined : STATIC_TYPES[id];
  if (type !== undefined) return card('Example Thing', type, text);
  if (/^(when|whenever|at) /im.test(text) || /^[^.\n]*\}:/m.test(text)) return card('Example Brute', 'Creature — Elf Warrior', text);
  return card('Example Volley', 'Sorcery', text);
}
const parsedWith = (text: string, id?: string) => parseCard(exampleCard(text, id), OPTS).faces[0]!;

describe('std-dft template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-dft.json, path order: after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-dft.json');
    expect(files.indexOf('zz-cloud/std-dft.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-dft.json')).toBeLessThan(files.indexOf('zz-fast1/t4.json'));
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(STDDFT.map((t) => t.id)).toEqual([
      'sta.stddft.otherturns.is.artifactcreature', 'eff.stddft.discard.chosen.thendraw', 'eff.stddft.then.return.choose.yourHand',
      'rep.stddft.damage.plus.yourSource.toOpponentOrTheirPermanent', 'eff.stddft.thenIf.oddCounters', 'sta.stddft.have.basePT.are.subtypes.inaddition',
      'eff.stddft.search.libraryAndOrGraveyard.reveal.hand', 'eff.stddft.search.libraryAndOrGraveyard.battlefield', 'eff.stddft.search.graveyardHandAndOrLibrary.battlefield',
      'eff.stddft.shuffle.ifSearchedLibrary', 'eff.stddft.lose.keyword.each', 'trg.stddft.cardsExiledFromGraveyardsAndOrBattlefield.batch.yourTurn',
      'trg.stddft.selfBecomesTapped.yourTurn', 'eff.stddft.players.eachMill.ownGraveyardSize', 'eff.stddft.become.artifactcreatures.each',
      'eff.stddft.pump.eachOther.nonartifactCreature', 'eff.stddft.mayHave.basePT.equalTo.each',
    ]);
    for (const t of STDDFT) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rep|rid)\.stddft\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three hand-verified golden cards, or every tuning-half card that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of STDDFT.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => namesTemplate(g.verified, t.id)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of STDDFT) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('std-dft guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of STDDFT) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text, t.id);
      for (const e of t.examples) {
        const f = parsedWith(e.text, t.id);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(fullyAutomated(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c, t.id);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/and\/or/, 'or'], [/ your turn/, ' each turn'], [/other than yours/, 'other than its owner\'s'], [/an odd number/, 'an even number'], [/plus 1/, 'plus 2'],
    [/an opponent controls/, 'you control'], [/two cards/, 'three cards'], [/reveal it, /, ''], [/your hand/, 'your graveyard'], [/become artifact creatures/, 'become enchantment creatures'],
    [/nonartifact/, 'nonland'], [/base power and toughness/, 'power and toughness'], [/in addition to their other types/, 'in addition to their other colors'],
    [/lose /, 'gain '], [/becomes tapped/, 'becomes untapped'], [/then draws/, 'then discards'], [/each mill/, 'each draw'], [/shuffle/, 'draw a card'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('std-dft guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of STDDFT) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(e.text, t.id);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(m, t.id);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-dft guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of STDDFT) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        const starts = words.map((_, i) => words.slice(0, i).join(' ').length + (i > 0 ? 1 : 0));
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          // the kind of a counter is any word (CR 122.1: "a blorfty counter" is a counter of that kind), not a word of the template
          if (/^counters?$/.test(words[i + 1] ?? '')) return;
          // a word of the label before a dash ("Max speed — ..."): an invented label is an ability word, which has no rules meaning (CR 207.2c); the
          // coverage G2 counts such mutations apart and does not judge them (packages/cards/src/coverage/mutation.ts)
          const lineStart = e.text.lastIndexOf('\n', starts[i]!) + 1;
          const dash = e.text.indexOf(' — ', lineStart);
          const lineEnd = e.text.indexOf('\n', lineStart);
          if (!w.includes('\n') && dash >= 0 && (lineEnd < 0 || dash < lineEnd) && starts[i]! < dash) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated, t.id)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-dft readings beside the template file', () => {
  const face = (type: string, text: string) => parseCard(card('Example Card', type, text), OPTS).faces[0]!;
  it('CR 603.4, 102.1: "if it\'s not their turn" is the turn of the player the event names; "if it\'s their turn" the opposite', () => {
    const not = face('Creature — Minotaur', "Whenever a player casts a spell, if it's not their turn, this creature deals 2 damage to them.");
    expect(fullyAutomated(not)).toBe(true);
    expect(bare(not.abilities)[0]).toMatchObject({ interveningIf: { cond: 'not', of: { cond: 'turnOf', whose: { ref: 'event', role: 'player' } } } });
    const is = face('Creature — Minotaur', "Whenever a player casts a spell, if it's their turn, this creature deals 2 damage to them.");
    expect(fullyAutomated(is)).toBe(true);
    expect(bare(is.abilities)[0]).toMatchObject({ interveningIf: { cond: 'turnOf', whose: { ref: 'event', role: 'player' } } });
  });
  it('CR 122.1: "an even number of counters" (zero is even) and "an odd number of counters" are the parity of the count of every kind of counter', () => {
    const f = face('Creature — God', '~ can\'t attack or block unless it has an even number of counters on it.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(bare(f.abilities))).toContain('"floorDiv"');
  });
  it('CR 702.29c, 609.7a: "When you cycle ~, it deals 1 damage to each opponent" names the cycled card as the source; moving the card itself stays manual (CR 113.6k)', () => {
    const src = face('Creature — Elemental', 'Cycling {1}{R}\nWhen you cycle ~, it deals 1 damage to each opponent.');
    expect(fullyAutomated(src)).toBe(true);
    expect(bare(src.abilities)[1]).toMatchObject({ kind: 'triggered', zone: ['graveyard'], effect: { steps: [{ op: 'damage', source: { ref: 'event', role: 'subject' } }] } });
    expect(fullyAutomated(face('Creature — Elemental', 'Cycling {1}{R}\nWhen you cycle ~, return it to your hand.'))).toBe(false);
    expect(fullyAutomated(face('Creature — Elemental', 'Cycling {1}{R}\nWhen you cycle ~, it deals damage equal to its power to each opponent.'))).toBe(false);
  });
  it('CR 107.3a, 702.29a: X in "when you cycle ~" is the X of a cycling cost with X, only there (parser/parse.ts#cyclingHasX, model/lint-nodes.ts)', () => {
    const withX = { name: 'Example Card', layout: 'normal', mana_cost: '{2}{G}', type_line: 'Creature — Spider', oracle_text: 'Cycling {X}{G}{G}\nWhen you cycle this card, destroy up to one target artifact with mana value X.' } as OracleCard;
    expect(cyclingHasX(withX)).toBe(true);
    expect(cyclingHasX({ ...withX, oracle_text: 'Cycling {2}{G}\nWhen you cycle this card, draw a card.' } as OracleCard)).toBe(false);
    expect(cyclingHasX({ ...withX, oracle_text: 'Plainscycling {X}{1}' } as OracleCard)).toBe(true);
    const cycled = parseCard(withX, OPTS).faces[0]!;
    expect(fullyAutomated(cycled)).toBe(true);
    // the lint: an X in the cycle trigger is defined only with the flag, and only for the trigger on cycling this card
    const trigger = cycled.abilities[1]!;
    expect(validateAbility(trigger, { cardHasX: false }).filter((i) => i.code === 'bad-var')).not.toEqual([]);
    expect(validateAbility(trigger, { cardHasX: false, cyclingX: true }).filter((i) => i.code === 'bad-var')).toEqual([]);
    const enters = face('Creature — Spider', 'Cycling {X}{G}{G}\nWhen ~ enters, destroy up to one target artifact with mana value X.');
    expect(fullyAutomated(enters)).toBe(false);
  });
  it('CR 702.21a: a granted keyword whose cost is not only mana is quoted as Oracle prints it (render/mods.ts); a mana cost is not', () => {
    const quoted = face('Creature — Human', 'Artifacts you control have "Ward—Pay 2 life."');
    expect(fullyAutomated(quoted)).toBe(true);
    expect(quoted.gate.every((g) => g.ok)).toBe(true);
    const plain = face('Creature — Human', 'Artifacts you control have ward {2}.');
    expect(fullyAutomated(plain)).toBe(true);
    expect(plain.gate.every((g) => g.ok)).toBe(true);
  });
  it('CR 109.2, 115.3: "each other nonartifact creature" on a spell, or after a sentence that names a target, is not "other than ~" (stays manual)', () => {
    expect(fullyAutomated(face('Sorcery', 'Each other nonartifact creature gets -1/-1 until end of turn.'))).toBe(false);
    expect(fullyAutomated(face('Creature — Human', '{T}: Target creature gets +1/+1 until end of turn. Each other nonartifact creature gets -1/-1 until end of turn.'))).toBe(false);
  });
});

const index = localIndex();
/**
 * Design 6.12: the cards this slice may read (test/m5/parser/support.ts#openCards): the tuning half of the local index (the cards whose key hashes even,
 * parser/metrics.ts#halfOfKey, the split of cards/coverage/corpus.ts#halvesOf) and every Standard-legal card (both halves open, owner decision 2026-10-17).
 * The half is a property of the card, so a Scryfall refresh does not move the cards below between the halves.
 */
/**
 * Cards this slice read while the halves still alternated by position (before 2026-10-19), which the hash split put in the held-out half and which are not
 * Standard-legal (docs/CARD_AUTOMATION.md section 4): no longer read, scanned or used as evidence. Their golden entries were verified while they were
 * tuning-half cards and stay; the owner may strip them as round 4's r4-dig precedent did. The test below fails when one of them becomes open again (a
 * format change), so it can be re-examined.
 */
const HELD_OUT: Readonly<Record<string, string>> = {
  'Sanctum of All': 'eff.stddft.search.libraryAndOrGraveyard.battlefield, eff.stddft.shuffle.ifSearchedLibrary: held-out since the hash split of 2026-10-19 (design 6.12)',
  'Start Your Engines': 'eff.stddft.become.artifactcreatures.each: held-out since the hash split of 2026-10-19 (design 6.12)',
  'Takenuma, Abandoned Mire': 'eff.stddft.then.return.choose.yourHand: held-out since the hash split of 2026-10-19 (design 6.12)',
  'Kudo, King Among Bears': 'sta.stddft.have.basePT.are.subtypes.inaddition: held-out since the hash split of 2026-10-19 (design 6.12)',
  'Raised by Giants': 'sta.stddft.have.basePT.are.subtypes.inaddition: held-out since the hash split of 2026-10-19 (design 6.12)',
  'The First Doctor': 'eff.stddft.search.libraryAndOrGraveyard.reveal.hand, eff.stddft.shuffle.ifSearchedLibrary: held-out since the hash split of 2026-10-19 (design 6.12)',
  'Mishra, Artificer Prodigy': 'eff.stddft.search.graveyardHandAndOrLibrary.battlefield, eff.stddft.shuffle.ifSearchedLibrary: held-out since the hash split of 2026-10-19 (design 6.12)',
  'Gate to the Afterlife': 'eff.stddft.search.graveyardHandAndOrLibrary.battlefield, eff.stddft.shuffle.ifSearchedLibrary: held-out since the hash split of 2026-10-19 (design 6.12)',
  'Exterminatus': 'eff.stddft.lose.keyword.each: held-out since the hash split of 2026-10-19 (design 6.12)',
};

describe.skipIf(index === null)('std-dft design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads (open cards, design 6.12)', () => {
  const open = openCards(index ?? []);
  it('every card listed as held-out is in the index, in the held-out half and not Standard-legal (re-examine it when this fails)', () => {
    for (const name of Object.keys(HELD_OUT)) {
      const c = (index ?? []).find((x) => x.name === name);
      expect(c, name).toBeDefined();
      expect(openToTuning(c!), `${name}: ${HELD_OUT[name]}`).toBe(false);
    }
  });

  const texts = (c: OracleCard): string[] => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].filter((x): x is string => typeof x === 'string');
  it('no line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of texts(c)) {
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|Vehicle|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = STDDFT.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('the cards named as the whole corpus of a sentence are every open card that prints it (less the held-out ones, plus the pending ones, with their reasons)', () => {
    const mismatches: Record<string, { found: string[]; named: string[] }> = {};
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = [...new Set(open.filter((c) => texts(c).some((x) => w.line.test(x))).map((c) => c.name))].sort();
      const named = [...w.cards.filter((c) => !(c in HELD_OUT)), ...Object.keys(w.pending ?? {})].sort();
      if (JSON.stringify(found) !== JSON.stringify(named)) mismatches[id] = { found, named };
    }
    expect(mismatches).toEqual({});
  }, 120_000);

  // the try step on real cards: each card's line is read by the named template, and the card (or the ability) passes the exact render gate
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'sta.stddft.otherturns.is.artifactcreature': ['Midnight Mangler'],
    'eff.stddft.discard.chosen.thendraw': ['Oildeep Gearhulk'],
    'eff.stddft.then.return.choose.yourHand': ['Carrion Cruiser', 'Fell Gravship'], // Takenuma, Abandoned Mire: HELD_OUT
    'rep.stddft.damage.plus.yourSource.toOpponentOrTheirPermanent': ['Far Fortune, End Boss'],
    'eff.stddft.thenIf.oddCounters': ['Sab-Sunen, Luxa Embodied'],
    'sta.stddft.have.basePT.are.subtypes.inaddition': ['March of the World Ooze'], // Kudo, King Among Bears, Raised by Giants: HELD_OUT
    'eff.stddft.search.libraryAndOrGraveyard.reveal.hand': ['Fang-Druid Summoner', 'Delivery Moogle', 'Rhythmic Water Vortex'], // The First Doctor: HELD_OUT
    // eff.stddft.search.libraryAndOrGraveyard.battlefield: its only card, Sanctum of All, is HELD_OUT
    'eff.stddft.search.graveyardHandAndOrLibrary.battlefield': ['Dark Supplicant'], // Mishra, Artificer Prodigy, Gate to the Afterlife: HELD_OUT
    'eff.stddft.shuffle.ifSearchedLibrary': ['Fang-Druid Summoner', 'Delivery Moogle', 'Dark Supplicant'], // Mishra, Artificer Prodigy: HELD_OUT
    'eff.stddft.lose.keyword.each': ['Spectacular Pileup', 'Whiteout'], // Exterminatus: HELD_OUT
    'trg.stddft.cardsExiledFromGraveyardsAndOrBattlefield.batch.yourTurn': ['Ketramose, the New Dawn'],
    'trg.stddft.selfBecomesTapped.yourTurn': ['Interface Ace'],
    'eff.mill': ['Riverchurn Monument'], // merge line D: the general reading (std-otj's player hole) of "any number of target players each mill two cards"
    'eff.stddft.players.eachMill.ownGraveyardSize': ['Riverchurn Monument'],
    // eff.stddft.become.artifactcreatures.each: its only verified card, Start Your Engines, is HELD_OUT
    'eff.stddft.pump.eachOther.nonartifactCreature': ['Winter, Cursed Rider'],
    'eff.stddft.mayHave.basePT.equalTo.each': ['Sita Varma, Masked Racer'],
  };
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it and pass the render gate`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        expect(open.includes(oracle!), `${name} is an open card (tuning half or Standard-legal, design 6.12)`).toBe(true);
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        // every ability that is not manual passes the gate (Sanctum of All and Gate to the Afterlife are partial for another ability or sentence)
        expect(parsed.faces.every((f) => f.gate.every((g, i) => g.ok || f.abilities[i]?.kind === 'manual')), name).toBe(true);
      }
    }, 60_000);
  }

  // the Standard backlog cards of the slice this branch makes fully automated (the golden review checks their JSON: test/m5/golden/cards/cloud-std-dft-review.json)
  const MADE_FULL = [
    'Adrenaline Jockey', 'Agonasaur Rex', 'Carrion Cruiser', 'Chitin Gravestalker', 'Fang-Druid Summoner', 'Far Fortune, End Boss', 'Interface Ace', 'Ketramose, the New Dawn',
    'Magmakin Artillerist', 'Midnight Mangler', 'Oildeep Gearhulk', 'Sab-Sunen, Luxa Embodied', 'Spectacular Pileup', "Valor's Flagship", 'Webstrike Elite',
    'Winter, Cursed Rider', 'March of the World Ooze', 'Riverchurn Monument', 'Sita Varma, Masked Racer',
  ];
  it(`the ${MADE_FULL.length} Standard backlog cards the slice makes full compile to full`, () => {
    for (const name of MADE_FULL) {
      const oracle = (index ?? []).find((c) => c.name === name);
      expect(oracle, name).toBeDefined();
      expect(open.includes(oracle!), `${name} is an open card of the backlog (tuning half or Standard-legal, design 6.12)`).toBe(true);
      expect(compileCard(oracle!).automation.level, name).toBe('full');
    }
  }, 120_000);
});
