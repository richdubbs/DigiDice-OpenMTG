/**
 * r4-cost (Standard round 4: costs, mana and choices; both halves of Standard, design 6.12 round 4): the template data of parser/templates/zz-cloud/r4-cost.json.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in the other files of this folder.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import r4cost from '../../../src/parser/templates/zz-cloud/r4-cost.json';
import review from '../../m5/golden/cards/cloud-r4-cost-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const R4 = r4cost as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards, or, for a sentence few real cards print, every one of them in the tuning half
 * (the line is how the local index finds them; the test at the end checks the list against the index).
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'eff.cost.self.less.yourTurn': { cards: ['Mental Modulation'], line: /costs \{\d+\} less to cast during your turn\./ },
  'eff.cost.self.less.asLongAs': { cards: ['Drag to the Roots', 'Gwaihir the Windlord'], line: /This spell costs \{\d+\} less to cast as long as / },
  'eff.cost.self.less.forEachAndEach': { cards: ['Gargantuan Leech'], line: /costs \{\d+\} less to cast for each [^.]+ and each / },
  'eff.cost.spells.less.forEach': { cards: ['Magnus the Red', 'Sokka, Swordmaster'], line: /spells you cast cost \{\d+\} less to cast for each (creature token|Ally) you control\./ },
  'eff.cost.spells.less.forEach.yourTurn': { cards: ['Temur Battlecrier'], line: /^During your turn, [^.]*spells you cast cost \{\d+\} less to cast for each /m },
  'eff.cost.spells.less.forEachCounterOnSelf': { cards: ['Animar, Soul of Elements'], line: /^[A-Z][a-z]+ spells you cast cost \{\d+\} less to cast for each \S+ counter on /m },
  'eff.cost.spells.and.less.forEachCounterOnSelf': { cards: ['Herald of War'], line: /^[A-Z][a-z]+ spells and [A-Z][a-z]+ spells you cast cost \{\d+\} less to cast for each \S+ counter on /m },
  'eff.cost.ability.less.yourTurn': { cards: ["Hylda's Crown of Winter"], line: /This ability costs \{\d+\} less to activate during your turn\./ },
  'eff.cost.mana.chooseColor.amountEqual': { cards: ['Three Tree City'], line: /Choose a color\. Add an amount of mana of that color equal to / },
  'eff.cost.mana.chooseColor.forEachPower': { cards: ['Loot, the Nexus', 'Selvala, Eager Trailblazer'], line: /Choose a color\. Add one mana of that color for each different power among / },
  'eff.cost.permit.self.graveyard.discardN': { cards: ['Alien Symbiosis'], line: /^You may cast this card from your graveyard by discarding (a|\w+) cards? in addition to paying its other costs\./m },
  'eff.cost.permit.self.graveyard.lifeAndSacrifice': { cards: ['Wickerfolk Indomitable'], line: /from your graveyard by paying \d+ life and sacrificing / },
  'eff.cost.permit.free.oncePerYourTurn.fromHand': { cards: ['Zaffai and the Tempests'], line: /^Once during each of your turns, you may cast an? [^.]+ from your hand without paying its mana cost\./m },
  'eff.cost.permit.alt.collectEvidence': { cards: ['Conspiracy Unraveler'], line: /You may collect evidence \d+ rather than pay the mana cost for / },
  'eff.cost.kw.equip.lessPerTargetColor': { cards: ['Dragonfire Blade'], line: /^Equip \{\d+\}\. This ability costs \{1\} less to activate for each color of the creature it targets\./m },
  'eff.cost.kw.equip.lessPerTargetCounter': { cards: ["Warrior's Blades"], line: /^Equip \{\d+\}\. This ability costs \{1\} less to activate for each \S+ counter on the creature it targets\./m },
  'eff.cost.ability.less.ifTargets': { cards: ['Raft Security Officer'], line: /This ability costs \{\d+\} less to activate if it targets / },
  'eff.cost.costmod.equipTargetingSelf': { cards: ['Dwarven Mauler'], line: /^Equip abilities you activate that target this creature cost \{\d+\} less to activate\./m },
  'eff.cost.ability.less.forEachOther': { cards: ['Balamb Garden, SeeD Academy // Balamb Garden, Airborne', "Tamiyo's Logbook"], line: /, \{T\}: [^.]+\. This ability costs \{1\} less to activate for each other / },
  'eff.cost.kw.equip.lessPerOther': { cards: ['Plate Armor'], line: /^Equip \{\d+\}\. This ability costs \{1\} less to activate for each other /m },
  'eff.cost.replace.others.enterAdditionalCounter.perOpponentLostLife': { cards: ['Gev, Scaled Scorch'], line: /enter with an additional \S+ counter on them for each opponent who lost life this turn\./ },
  'eff.cost.draw.perOpponentLostLife': { cards: ['Kaito, Bane of Nightmares'], line: /draw a card for each opponent who lost life this turn\./ },
  'eff.cost.cast.fromHand.free.mvAtMost': { cards: ['Tetsuo, Imperial Champion'], line: /from your hand with mana value less than or equal to the greatest mana value among [^.]+ without paying its mana cost\./ },
  'eff.cost.cast.fromHand.free.mvAtMostThatDamage': { cards: ['Buster Sword', 'Glamdring'], line: /from your hand with mana value less than or equal to that damage without paying its mana cost\./ },
  'eff.cost.spells.withAdventure.less': { cards: ['Beluna Grandsquall // Seek Thrills'], line: /spells you cast that have an Adventure cost \{\d+\} less to cast\./ },
  'eff.cost.costmod.keywordAbilities.ofOther': { cards: ['Hulk, Gamma Goliath'], line: /^Power-up abilities of other [^.]+ cost \{\d+\} less to activate\./m },
  'eff.cost.enters.choose.lorwynTribe': { cards: ['Dawn-Blessed Pennant', 'Eclipsed Realms'], line: /^As this \w+ enters, choose Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, or Treefolk\./m },
};

/** Golden entries pinned as pending (not full): a card whose other sentence another slice or engine family owns. (Wave 7 merge: Daring Waverider, Seifer Almasy
 * and The Dawning Archaic are full with r4-repl's exile replacement, rid.r4repl.cast.yourGraveyard.exileInstead. Standard round E: Dawn-Blessed Pennant ("the chosen
 * type" linked by parser/parse.ts#ENTERS_CHOICE) and Beluna Grandsquall // Seek Thrills (r4-dig's eff.r4dig.milled.putAll.hand promoted) are full.) */
// std-typechange-2: Kaito, Bane of Nightmares is full since its static ability's slice (sta.stdtc2.duringTurn.aslong.self.is.sized.creature.has) and ninjutsu (std-typechange-1)
const PENDING: ReadonlySet<string> = new Set(['Animar, Soul of Elements', 'Glamdring']);

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered, activated or static ability on a creature (an additional cost on an enchantment). */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind !== 'static' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  // a permanent spell's additional cost, then its enters trigger: the type line the coverage gate tries a static example under (cards coverage/mutation.ts)
  if (t.id.startsWith('eff.cost.kw.equip.')) return card('Example Blade', 'Artifact — Equipment', text);
  if (t.id === 'eff.cost.self.less.yourTurn' || t.id === 'eff.cost.self.less.asLongAs') return card('Example Volley', 'Instant', `${text}\nDraw a card.`);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('r4-cost template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/r4-cost.json, path order: after r3-fx, before std-) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/r4-cost.json');
    expect(files.indexOf('zz-cloud/r4-cost.json')).toBeGreaterThan(files.indexOf('zz-cloud/r3-fx.json'));
    expect(files.indexOf('zz-cloud/r4-cost.json')).toBeLessThan(files.indexOf('zz-cloud/std-blb.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.cost.*', () => {
    for (const t of R4) {
      expect(t.id, t.id).toMatch(/^eff\.cost\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three hand-verified golden cards, or every tuning card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of R4.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => (g.verified.match(/eff\.cost\.[A-Za-z0-9.]*[A-Za-z0-9]/g) ?? ([] as string[])).includes(t.id)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe(PENDING.has(g.card) ? undefined : 'full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of R4) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('r4-cost guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of R4) {
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
  const body = text.replace(/\.$/, '').replace(/\."$/, '"');
  const plain = text.endsWith('"') ? [] : [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const out = [...plain];
  const swaps: [RegExp, string][] = [
    [/\bless\b/, 'more'], [/\bone mana\b/, 'two mana'], [/\bwithout paying\b/, 'by paying'], [/\bfrom your hand\b/, 'from your graveyard'], [/\byou control\b/, 'your opponents control'],
    [/\bfrom exile\b/, 'from your hand'], [/\brather than\b/, 'in addition to'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('r4-cost guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of R4) {
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

describe('r4-cost guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of R4) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || w === "~'s" || /^"?\{/.test(w) || w.includes('\n')) return;
          // design 6.11: counter names are an open class ("N <word> counter(s)"): the word before "counter" may be any word
          if (/^counters?$/.test(words[i + 1] ?? '')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('r4-cost design 6.10 (local index): synthetic examples, the whole corpus of each sentence, real cards', () => {
  it('no r4-cost line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // eff.cost.enters.choose.lorwynTribe reads one fixed list of eight creature types that the cards print the same way (no invented wording can say it); its
    // examples' other lines are invented, so only that list line is exempt
    const FIXED_LINE = /^As ~ enters, choose Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, or Treefolk\.$/;
    const verbatim = R4.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !FIXED_LINE.test(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  it('each card named as the corpus of a sentence prints it (taken from the tuning half and Standard, which round 4 opens, design 6.12)', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      for (const name of w.cards) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        expect([c!.oracle_text, ...(c!.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x)), `${id}: ${name}`).toBe(true);
      }
    }
  });

  // the try step on real cards: each card reads its line with the named template, passes the exact render gate and is fully automated
  // the cards a sentence of another slice keeps partial are pending (PENDING): only the fully automated ones are checked here
  const REAL: Readonly<Record<string, readonly string[]>> = Object.fromEntries(Object.entries(WHOLE_CORPUS).map(([id, w]) => [id, w.cards.filter((c) => !PENDING.has(c))] as const).filter(([, cards]) => cards.length > 0));
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and are fully automated`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        expect(compileCard(oracle!).automation.level, name).toBe('full');
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
      }
    }, 60_000);
  }
});
