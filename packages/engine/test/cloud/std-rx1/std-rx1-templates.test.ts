/**
 * Standard round rx1 (std-rx1, wave 2 slice s26): the template data of parser/templates/zz-cloud/std-rx1.json ("During combat, players can't cast spells or
 * activate abilities that aren't mana abilities") and the parser, lowering and renderer changes of the round: the condition "you control a prime number of
 * <permanents>" (parser/holes/cond.ts, render/cond.ts), a token's given name with an epithet (parser/holes/token.ts#epithet) and "that many" after an intervening
 * "if" that states a count (parser/lower/quantities.ts#primeCount, render/steps-life.ts#statedByIf). Guard G9 (design 6.8): every example lowers with its
 * template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or
 * differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against
 * the local index when it is present. The behavior is in std-rx1-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { isPrime } from '../../../src/types/ability';
import stdRx1 from '../../../src/parser/templates/zz-cloud/std-rx1.json';
import review from '../../m5/golden/cards/cloud-std-rx1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRx1 as Template[];
const MECH_COUNT = 3;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a static ability of a creature, an effect as a sorcery's spell text. */
const parsedWith = (t: Template, text: string) =>
  parseCard(t.kind === 'effect' ? card('Example Study', 'Sorcery', text) : card('Example Warden', 'Creature — Human Samurai', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Sage', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-rx1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx1.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx1.json');
    expect(files.indexOf('zz-cloud/std-rx1.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-rx1.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta.stdrx1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.stdrx1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 (narrow wordings, the deviation the round record names): a stable template has a hand-verified golden card that uses it', () => {
    // Each wording is printed on one card only (Yuriko, Blade of the Mighty; Zimone's Experiment), so it can never reach three golden cards: stable on one golden
    // card plus these template tests and the played scenarios, the practice of earlier rounds (docs/CARD_AUTOMATION.md section 5, "Narrow wordings").
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

describe('std-rx1 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [[/\bcombat\b/, 'your turn'], [/\bmana abilities\b/, 'loyalty abilities'], [/\baren't\b/, 'are'], [/\bcast spells or\b/, 'cast spells and'],
    [/\bup to\b/, 'exactly'], [/\ba random order\b/, 'any order'], [/\bbattlefield tapped\b/, 'battlefield'], [/\binto your hand\b/, 'into your graveyard'], [/\brevealed this way onto\b/, 'from among them onto']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-rx1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          const end = w.match(/[.,]+$/)?.[0] ?? '';
          const lead = w.includes('\n') ? `${w.slice(0, w.indexOf('\n') + 1)}` : '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rx1 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

// ---- render/stat.ts#combatCastActivateNonMana ---------------------------------------------------------------------------------------------------------------

describe('std-rx1 renderer (CR 601.3, 602.5, 605.1a, 506.1): the pair "can\'t cast spells" + "can\'t activate abilities that aren\'t mana abilities", during combat', () => {
  it('the two restrictions are one sentence; without `exceptMana` or outside combat the pair is not this sentence', () => {
    const ok = parsedWith(MECH[0]!, "During combat, players can't cast spells or activate abilities that aren't mana abilities.");
    expect(fullFace(ok)).toBe(true);
    const effects = (ok.abilities[0] as { effects: { exceptMana?: boolean; action: string }[] }).effects;
    expect(effects.map((e) => e.action)).toEqual(['cast', 'activate']);
    expect(effects[1]!.exceptMana).toBe(true);
    expect(fullFace(parsedWith(MECH[0]!, "During your turn, players can't cast spells or activate abilities that aren't mana abilities."))).toBe(false);
    expect(fullFace(parsedWith(MECH[0]!, "During combat, you can't cast spells or activate abilities that aren't mana abilities."))).toBe(false);
  });
});

// ---- parser/holes/cond.ts + render/cond.ts + rules/predicates.ts#isPrime: "you control a prime number of <permanents>" ----------------------------------

describe('std-rx1 condition (CR 107.1, 603.4): "you control a prime number of lands"', () => {
  it('isPrime: 2, 3, 5, 7, 11, 31, 37 are prime; 0, 1, 4, 9, 15, 33 and non-integers are not', () => {
    for (const n of [2, 3, 5, 7, 11, 31, 37]) expect(isPrime(n), String(n)).toBe(true);
    for (const n of [0, 1, 4, 9, 15, 33, -3, 2.5]) expect(isPrime(n), String(n)).toBe(false);
  });
  it('an intervening "if" of you is understood as the `prime` condition of a count of permanents you control', () => {
    const f = face('Enchantment', 'At the beginning of your end step, if you control a prime number of lands, draw a card.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"interveningIf":{"cond":"prime","of":{"q":"count","of":{"ref":"each","filter":{"types":["Land"],"controller":"you"}}}}');
  });
  it('of an opponent (one count per opponent, CR 102.3), negated, or with a singular noun it is not read', () => {
    expect(fullFace(face('Enchantment', 'At the beginning of your end step, if an opponent controls a prime number of lands, draw a card.'))).toBe(false);
    expect(fullFace(face('Enchantment', "At the beginning of your end step, if you don't control a prime number of lands, draw a card."))).toBe(false);
    expect(fullFace(face('Enchantment', 'At the beginning of your end step, if you control a prime number of land, draw a card.'))).toBe(false);
  });
});

// ---- parser/holes/token.ts#epithet: "Name, the Epithet, a <token>" -------------------------------------------------------------------------------------------

describe('std-rx1 token name (CR 111.4, 201.2): a given name with an epithet', () => {
  it('"Create Quillo, the Unbroken, a legendary 2/2 red Elemental creature token." names the token "Quillo, the Unbroken"', () => {
    const f = face('Sorcery', 'Create Quillo, the Unbroken, a legendary 2/2 red Elemental creature token.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"name":"Quillo, the Unbroken"');
  });
  it('without the article after the epithet, or with a lower-case epithet, it is not this reading', () => {
    expect(fullFace(face('Sorcery', 'Create Quillo, the Unbroken, legendary 2/2 red Elemental creature token.'))).toBe(false);
    expect(fullFace(face('Sorcery', 'Create Quillo, the unbroken, a legendary 2/2 red Elemental creature token.'))).toBe(false);
  });
});

// ---- parser/lower/quantities.ts#primeCount + render/steps-life.ts#statedByIf: "that many" of a stated count -------------------------------------------------

describe('std-rx1 lowering (CR 603.4, 608.2h): "that many" after "if you control a prime number of lands" is that count', () => {
  const ZIM = 'At the beginning of your end step, if you control a prime number of lands, create Quillo, the Unbroken, a legendary 0/0 red Elemental creature token, then put that many +1/+1 counters on it.';
  it('the counters put on the token are the number of lands you control (not the one token created)', () => {
    const f = face('Legendary Creature — Human Wizard', ZIM, ['1', '1']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"op":"putCounters","on":{"ref":"bound","name":"token"},"kind":"+1/+1","count":{"q":"count","of":{"ref":"each","filter":{"types":["Land"],"controller":"you"}}}');
  });
  it('without a stated count in the "if", "that many" after a created token keeps its old reading (refused: not one candidate)', () => {
    const f = face('Legendary Creature — Human Wizard', 'At the beginning of your end step, if you control seven or more lands, create Quillo, the Unbroken, a legendary 0/0 red Elemental creature token, then put that many +1/+1 counters on it.', ['1', '1']);
    expect(fullFace(f)).toBe(false);
  });
});

// ---- lower/mentions.ts (revealed this way of a chosen group) + render/fold.ts (chooseUpToFromGroupThenReveal, putAllRevealedSplit) -------------------------

describe('std-rx1 lowering and renderer (CR 701.20a, 608.2c, 401.4): the cards chosen and revealed from among a group are "<cards> revealed this way"', () => {
  const LOOK = 'Look at the top six cards of your library. You may reveal up to two artifact and/or enchantment cards from among them';
  it('"..., then put the rest on the bottom of your library in a random order" moves the cards not chosen; the split moves read the chosen group', () => {
    const f = face('Sorcery', `${LOOK}, then put the rest on the bottom of your library in a random order. Put all enchantment cards revealed this way onto the battlefield tapped and put all artifact cards revealed this way into your hand.`);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    const json = JSON.stringify(f.abilities);
    expect(json).toContain('"filter":{"is":{"ref":"bound","name":"them"},"not":{"is":{"ref":"bound","name":"chosen"}},"zone":"library"}');
    expect(json).toContain('"filter":{"anyOf":[{"types":["Enchantment"]}],"is":{"ref":"bound","name":"chosen"},"zone":"library"}},"to":{"zone":"battlefield","controller":{"ref":"you"},"tapped":true}');
  });
  it('"put all <cards> revealed this way into your hand and the rest ..." after a choice is not read as the rest of the looked-at cards (std-ro\'s "the rest" is the revealed group\'s): refused', () => {
    const f = face('Sorcery', `${LOOK}. Put all artifact cards revealed this way into your hand and the rest on the bottom of your library in any order.`);
    expect(fullFace(f)).toBe(false);
  });
  it('after a look with no reveal, "revealed this way" has no antecedent', () => {
    expect(fullFace(face('Sorcery', 'Look at the top six cards of your library. Put all enchantment cards revealed this way onto the battlefield tapped and put all artifact cards revealed this way into your hand.'))).toBe(false);
  });
});
